/*
 * conteudo/censec.js — content script do CENSEC / CEP (censec.org.br).
 *
 * ═══ COMO ESTE CONVÊNIO É DIFERENTE ═══
 * É o primeiro com API JSON de verdade. A busca do CEP é um
 * POST /api/atos/cep/busca que devolve TODOS os atos num array — a paginação da
 * tela é client-side. Então NÃO raspamos a tabela: dirigimos o formulário e
 * ESCUTAMOS a resposta que o próprio site recebe (conteudo/censec-api.js).
 * Isso mata de uma vez a armadilha de imprimir só a primeira página — que é o
 * motivo de o maisPJe precisar forçar "100 itens por página".
 *
 * ═══ ARMADILHAS (vistas no recon de 17/08) ═══
 *  - Os ids são do Angular Material (mat-input-5) e são GERADOS: mudam de ordem
 *    entre versões. Usamos formcontrolname, que é do reactive form.
 *  - O "Buscar" NASCE DESABILITADO (mesma história do CNIB): esperar habilitar,
 *    nunca clicar em botão cinza.
 *  - Existe <spa-captcha> na página. Não disparou no recon, mas o maisPJe trata:
 *    se aparecer, congelamos e esperamos você resolver.
 *  - O campo tem máscara ngx-mask; escrevemos só dígitos, como o maisPJe.
 */

(function iniciarCensec() {
  if (!/(^|\.)censec\.org\.br$/.test(location.hostname)) return;
  console.log("CRATOS/CENSEC: content script ativo em", location.pathname);

  /* Chave global liga/desliga: desligado, o CENSEC não age (nem gera certidão da
     busca nem dirige o fluxo). */
  let _cratosLigado = true;
  Store.ligada().then((v) => { _cratosLigado = v; }).catch(() => {});

  const ROTA_CEP = "/private/s/00000000-0000-0000-0000-000000000000/cep";
  const VALIDADE_ESTADO_MS = 30 * 60 * 1000;
  const ESPERA_RESPOSTA_MS = 60 * 1000;        // sem desafio na tela
  const LIMITE_CAPTCHA_MS = 5 * 60 * 1000;     // teto absoluto, com desafio
  const ESPERA_BOTAO_MS = 30 * 1000;           // renovação do token do Turnstile
  const EVENTO_BUSCA = "cratos:censec:busca";

  const SEL = {
    captcha: "spa-captcha",
    carregando: ".backdrop, .cdk-overlay-backdrop, lacm-loading",
  };

  /* ═══ COMO ACHAMOS O CAMPO DO CPF/CNPJ ═══
   * O maisPJe usa 'app-public-query input[formcontrolname="cpfCnpj"]'. No recon
   * de 17/08 NENHUM campo da tela tem o atributo formcontrolname — a versão atual
   * do CENSEC deve ter migrado para [formControl] (binding de propriedade, que
   * não deixa atributo no DOM). Ou seja: o seletor do maisPJe está prestes a
   * morrer, ou já morreu.
   * Então tentamos em cascata, do mais estável para o mais frágil, e o que NÃO
   * fazemos é cair em #mat-input-5: esse id é gerado pelo Angular Material e
   * muda de ordem — apontaria para "Identidade" num dia qualquer, e a gente
   * consultaria o documento errado sem perceber. Melhor parar do que errar. */
  function campoDocumento() {
    const tentativas = [
      'app-public-query input[formcontrolname="cpfCnpj"]',
      'input[formcontrolname="cpfCnpj"]',
      // ngx-mask do próprio campo: máscara de CPF||CNPJ é exclusiva dele
      'app-public-query input[mask^="000.000.000-00"]',
      'input[mask^="000.000.000-00"]',
    ];
    for (const s of tentativas) {
      const el = document.querySelector(s);
      if (el && visivel(el)) return el;
    }
    return campoPorRotulo(["documento", "cpf"]);
  }

  /* Última via honesta: o mat-form-field cujo rótulo fala em documento/CPF. */
  function campoPorRotulo(termos) {
    const campos = document.querySelectorAll("mat-form-field, .mat-mdc-form-field");
    for (const ff of campos) {
      const rot = norm((ff.querySelector("mat-label, label") || {}).textContent || "");
      if (!rot) continue;
      if (!termos.every((t) => rot.includes(t))) continue;
      const el = ff.querySelector("input");
      if (el && visivel(el)) return el;
    }
    return null;
  }

  injetarGrampo();

  // Fila de respostas da busca, alimentada pelo grampo no contexto da página.
  let aguardandoResposta = null;
  window.addEventListener(EVENTO_BUSCA, (ev) => {
    if (!_cratosLigado) return;   // extensão desligada
    let dados = null;
    try { dados = JSON.parse(ev.detail); } catch (e) { dados = { ok: false, erro: "resposta ilegível" }; }
    console.log("CRATOS/CENSEC: resposta da busca recebida (status " + (dados && dados.status) + ").");
    if (aguardandoResposta) { const r = aguardandoResposta; aguardandoResposta = null; r(dados); }
  });

  /* ═══ CANAL DE PARTES ═══
   * Pede ao grampo (contexto da página) as partes de uma lista de atos e espera a
   * resposta. O grampo faz o GET same-origin (cookie); aqui só orquestramos. */
  const EVENTO_PARTES_PEDIR = "cratos:censec:partes:pedir";
  const EVENTO_PARTES_RESP = "cratos:censec:partes:resposta";
  const ESPERA_PARTES_MS = 45 * 1000;
  let _seqPartes = 0;
  const _aguardandoPartes = new Map();   // reqId -> resolve

  window.addEventListener(EVENTO_PARTES_RESP, (ev) => {
    if (!_cratosLigado) return;
    let dados = null;
    try { dados = JSON.parse(ev.detail); } catch (e) { return; }
    const r = _aguardandoPartes.get(dados && dados.reqId);
    if (r) { _aguardandoPartes.delete(dados.reqId); r((dados && dados.resultados) || {}); }
  });

  /* Devolve { atoId -> {ok, partes:[{nome,documento,qualidade}]} } ou null no timeout. */
  function pedirPartes(atoIds, timeoutMs) {
    const ids = (atoIds || []).map((x) => String(x || "")).filter(Boolean);
    if (!ids.length) return Promise.resolve({});
    return new Promise((resolve) => {
      const reqId = "p" + (++_seqPartes) + "_" + Date.now();
      _aguardandoPartes.set(reqId, resolve);
      window.dispatchEvent(new CustomEvent(EVENTO_PARTES_PEDIR, {
        detail: JSON.stringify({ reqId, atoIds: ids }),
      }));
      setTimeout(() => {
        if (_aguardandoPartes.has(reqId)) { _aguardandoPartes.delete(reqId); resolve(null); }
      }, timeoutMs || ESPERA_PARTES_MS);
    });
  }

  Store.get("censec_estado").then(async (est) => {
    if (!(await Store.ligada())) { console.log("CRATOS/CENSEC: extensão desligada."); return; }
    if (!est || !est.ativo) return;
    const idade = Date.now() - new Date(est.abertoEm || 0).getTime();
    if (idade > VALIDADE_ESTADO_MS) {
      console.log("CRATOS/CENSEC: estado antigo — ignorando.");
      return;
    }
    vigiar(est).catch((e) => falhar(e));
  }).catch((e) => console.warn("CRATOS/CENSEC: erro ao ler estado:", e.message));

  /* O grampo precisa rodar no contexto da página (o content script vive num
     mundo isolado e não enxerga o fetch do app). */
  function injetarGrampo() {
    try {
      const s = document.createElement("script");
      s.src = browser.runtime.getURL("conteudo/censec-api.js");
      s.async = false;
      (document.head || document.documentElement).appendChild(s);
      s.onload = () => s.remove();
    } catch (e) {
      console.error("CRATOS/CENSEC: falha ao injetar o grampo:", e);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
   * O VIGIA — quem manda é o FORMULÁRIO estar na tela, não a URL.
   *
   * Havia aqui um `rotear()` que lia `location.pathname` UMA VEZ, no instante em
   * que o content script nascia, e decidia o destino para sempre. O recon de
   * 19/08 mostrou por que isso não podia dar certo:
   *
   *   13:29:06  pathname = "/"            ← volta do OIDC (censec.org.br/#id_token=…)
   *   13:29:09  pathname = ".../cep"      ← MESMO documento, formulário montado
   *
   * O Angular consome o hash do login e troca a rota por dentro, sem carregar
   * documento novo. Nascemos no piscar de olhos em que a URL ainda dizia "/",
   * concluímos "está na tela de login", demos return — e três segundos depois o
   * CEP estava montado na nossa frente, com a extensão estacionada. Content
   * script não roda de novo em troca de rota de SPA; ninguém nos acordava.
   *
   * Agora não decidimos: vigiamos. O gatilho é o campo do documento existir.
   * Onde estamos serve só para escolher a frase da faixa e para decidir se vale
   * navegar. Isso mata a classe inteira de bugs de tempo de rota — inclusive o
   * caso de você logar com a aba já aberta, em que o carregamento completo que a
   * versão anterior esperava simplesmente nunca vinha.
   * ═══════════════════════════════════════════════════════════════════════════ */
  const LIMITE_VIGIA_MS = 10 * 60 * 1000;   // teto: 10 min esperando login/tela

  async function vigiar(est) {
    const t0 = Date.now();
    let ultimoAviso = "";
    let esperandoNoCepDesde = 0;

    const dizer = (txt, cor) => {
      if (txt === ultimoAviso) return;      // não repinta a faixa a cada 500ms
      ultimoAviso = txt;
      avisar(txt, cor || "#facc15");
    };

    while (Date.now() - t0 < LIMITE_VIGIA_MS) {
      // 1. O gatilho: a tela do CEP está montada? Então trabalha, onde quer que seja.
      if (campoDocumento()) return fluxoConsulta(est);

      const p = location.pathname;

      // 2. Fora da área logada: só esperar. O login é seu, e o vigia continua de pé.
      if (!p.includes("/private/")) {
        dizer("aguardando seu login no CENSEC. Assim que a tela do CEP abrir, eu sigo sozinho.");

      // 3. Logado, mas noutra rota: leva até o CEP — uma vez só por execução.
      } else if (!p.includes("/cep")) {
        if (sessionStorage.getItem("cratos_censec_navegou") !== est.abertoEm) {
          sessionStorage.setItem("cratos_censec_navegou", est.abertoEm);
          console.log("CRATOS/CENSEC: logado em", p, "— indo para", ROTA_CEP);
          dizer("abrindo a consulta do CEP…");
          location.assign(ROTA_CEP);
          return;                            // este documento vai embora
        }
        dizer("esperando a tela do CEP abrir…");

      // 4. Na rota certa e sem formulário: o app está montando — ou empacou.
      } else {
        dizer("abrindo o CENSEC — esperando a tela do CEP montar…");
        if (esperandoNoCepDesde === 0) esperandoNoCepDesde = Date.now();

        /* Empacou de vez: uma recarga, só uma. É o que você fazia na mão fechando
           a janela. A trava carrega o carimbo da execução, então não vira laço. */
        if (Date.now() - esperandoNoCepDesde > 20000 &&
            sessionStorage.getItem("cratos_censec_recarregou") !== est.abertoEm) {
          sessionStorage.setItem("cratos_censec_recarregou", est.abertoEm);
          console.warn("CRATOS/CENSEC: 20s na rota do CEP sem formulário — recarregando uma vez.");
          dizer("o CENSEC não montou a tela do CEP. Recarregando a página uma vez…");
          location.reload();
          return;                            // este documento vai embora
        }
      }

      await sleep(500);
    }

    falhar(new Error("dez minutos sem a tela do CEP aparecer. Sessão caiu, ou o login não foi concluído."));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CONSULTA — um executado por vez, um PDF por executado
  // ══════════════════════════════════════════════════════════════════════════
  async function fluxoConsulta(est) {
    /* Chegamos aqui porque o vigia VIU o campo. Reconferimos mesmo assim: entre
       a checagem dele e esta linha o Angular pode ter redesenhado o formulário. */
    if (!(await esperar(campoDocumento, 10000))) {
      return falhar(new Error(
        "o campo 'Documento (CPF/CNPJ)' sumiu da tela do CEP. " +
        "Ou a sessão caiu, ou o CENSEC mudou o formulário — nesse caso, rode o recon de novo."));
    }

    const partes = est.partes || [];
    if (!partes.length) return falhar(new Error("nenhuma parte marcada no painel para consultar. Marque as partes no PJe "
      + "e execute de novo."));

    /* UMA PARTE QUE FALHA NÃO MATA A FILA.
       Antes, qualquer tropeço abortava tudo — e como a fila costuma ter várias
       partes, perder a última por causa da segunda é caro: você refaz o serviço
       inteiro. Agora cada parte é uma tentativa independente; no fim, o aviso
       diz quem entrou e quem não entrou, com o motivo. */
    const feitos = [];
    const falhados = [];

    for (let i = 0; i < partes.length; i++) {
      const parte = partes[i];
      const doc = digitos(parte.cpfcnpj);
      avisar(`consultando ${i + 1} de ${partes.length}: ${parte.nome}`, "#facc15");
      console.log(`CRATOS/CENSEC: [${i + 1}/${partes.length}] ${CratosMascara.nome(parte.nome)} (${CratosMascara.doc(doc)})`);

      let r;
      try {
        r = await consultarUm(parte, doc, i + 1);
      } catch (e) {
        r = { ok: false, motivo: String((e && e.message) || e) };
      }

      if (!r.ok) {
        console.error(`CRATOS/CENSEC: ${CratosMascara.nome(parte.nome)} FALHOU — ${r.motivo}`);
        falhados.push({ nome: parte.nome, motivo: r.motivo });
      } else {
        feitos.push({ nome: parte.nome, atos: r.atos.length, arquivo: r.arquivo });
        console.log(`CRATOS/CENSEC: ${CratosMascara.nome(parte.nome)} — ${r.atos.length} ato(s) -> ${r.arquivo ? "PDF gerado" : "(sem PDF)"}`);
      }

      // grava o andamento a cada parte: se a aba cair, sabemos onde parou
      await Store.set("censec_estado", Object.assign({}, est, {
        ativo: true, fase: "andando", feitos, falhados, indice: i + 1,
      }));

      /* Entre uma busca e outra o app precisa respirar: some o overlay de
         carregamento e o Turnstile emite um token novo (o anterior é de uso
         único). Sem essa pausa a próxima parte encontra o "Buscar" cinza. */
      if (i < partes.length - 1) {
        await esperarSumir(SEL.carregando, 20000);
        await sleep(1200);
      }
    }

    const total = feitos.reduce((s, f) => s + f.atos, 0);
    const semDoc = est.semDocumento || [];

    let msg = `consulta concluída: ${feitos.length} de ${partes.length} parte(s), ${total} ato(s).`;
    if (feitos.length) {
      msg += "\n" + feitos.map((f) => `· ${f.nome}: ${f.atos || "nada encontrado"}`).join("\n");
    }
    if (falhados.length) {
      msg += "\n\nNÃO consultei:\n" + falhados.map((f) => `· ${f.nome} — ${f.motivo}`).join("\n");
    }
    if (semDoc.length) {
      msg += "\n\nSem CPF/CNPJ no processo (não dá para consultar):\n" +
        semDoc.map((n) => `· ${n}`).join("\n");
    }
    avisar(msg, falhados.length ? "#facc15" : "#4ade80");

    await Store.set("censec_estado", Object.assign({}, est, {
      ativo: false,
      fase: falhados.length ? "concluido_com_falhas" : "concluido",
      feitos, falhados,
    }));
  }

  async function consultarUm(parte, doc, ordem) {
    await esperarSumir(SEL.carregando, 20000);

    // limpar e escrever (só dígitos — a máscara do campo formata sozinha)
    if (!(await escrever(campoDocumento, ""))) return { ok: false, motivo: "não limpei o campo" };
    if (!(await escrever(campoDocumento, doc, { porDigitos: true }))) {
      return { ok: false, motivo: "não consegui escrever o CPF/CNPJ" };
    }

    /* PACIÊNCIA COM O BOTÃO. O token do Turnstile é de USO ÚNICO: depois de cada
       busca o widget precisa emitir outro, e enquanto não emite o formulário fica
       inválido e o "Buscar" volta a ficar cinza. Da segunda parte em diante isso
       é o normal, não a exceção — por isso a espera aqui é generosa. */
    let botao = await esperarHabilitado(() => botaoBuscar(), 12000);
    if (!botao) {
      console.warn("CRATOS/CENSEC: 'Buscar' cinza — digitando caractere a caractere.");
      avisar(`esperando o CENSEC liberar o "Buscar" para ${parte.nome}…`, "#facc15");
      await digitar(campoDocumento, doc);
      botao = await esperarHabilitado(() => botaoBuscar(), ESPERA_BOTAO_MS);
    }
    if (!botao) {
      return { ok: false, motivo: "o botão 'Buscar' não habilitou (token do captcha não renovou?)" };
    }

    // arma a espera ANTES de clicar, para não perder a resposta
    const resposta = new Promise((resolve) => { aguardandoResposta = resolve; });
    botao.click();

    const dados = await esperarResposta(resposta);
    aguardandoResposta = null;
    if (!dados) return { ok: false, motivo: "o CENSEC não respondeu" };
    if (!dados.ok) return { ok: false, motivo: "o CENSEC respondeu HTTP " + dados.status };

    let atos = [];
    try {
      const json = JSON.parse(dados.corpo || "{}");
      atos = Array.isArray(json.atos) ? json.atos : [];
    } catch (e) {
      return { ok: false, motivo: "resposta da busca ilegível" };
    }

    const arquivo = await fabricarCertidao(parte, doc, atos, ordem);
    return { ok: true, atos, arquivo };   // arquivo = null quando a negativa está desligada
  }

  /* ═══ ESPERA DA RESPOSTA, COM PACIÊNCIA PARA O CAPTCHA ═══
   * Havia aqui uma guarda que congelava assim que <spa-captcha> aparecesse. Ela
   * estava ERRADA: o recon mostra que o componente existe na tela do CEP mesmo
   * sem desafio nenhum — o token do captcha vai no corpo da requisição, gerado
   * de forma invisível. Congelar por presença do elemento travaria TODA consulta
   * normal por 5 minutos.
   *
   * A postura certa é a inversa: esperamos a resposta normalmente e só damos
   * mais tempo se, além de não haver resposta, houver um desafio VISÍVEL na
   * tela. Um falso positivo do detector nunca trava nada — ele só estende um
   * prazo que já estava vencendo. */
  async function esperarResposta(promessa) {
    let chegou = null, resolvido = false;
    promessa.then((d) => { chegou = d; resolvido = true; });

    let prazo = Date.now() + ESPERA_RESPOSTA_MS;
    const limite = Date.now() + LIMITE_CAPTCHA_MS;
    let avisado = false;

    while (!resolvido && Date.now() < prazo && Date.now() < limite) {
      await sleep(300);
      if (desafioNaTela()) {
        prazo = Date.now() + ESPERA_RESPOSTA_MS;   // o relógio só corre sem desafio
        if (!avisado) {
          avisado = true;
          console.warn("CRATOS/CENSEC: desafio visível — esperando você resolver.");
          avisar("o CENSEC pediu um desafio (captcha). Resolva na tela que eu sigo sozinho.", "#facc15");
        }
      }
    }
    if (resolvido && avisado) avisar("desafio resolvido — retomando.", "#facc15");
    return resolvido ? chegou : null;
  }

  /* Desafio DE VERDADE, não o componente adormecido: precisa estar visível e ter
     altura de widget (o invisível fica com caixa zerada ou de poucos pixels), ou
     haver um iframe de captcha na tela. */
  function desafioNaTela() {
    for (const el of document.querySelectorAll(SEL.captcha)) {
      const r = el.getBoundingClientRect();
      if (r.width > 40 && r.height > 40) return true;
    }
    for (const f of document.querySelectorAll("iframe")) {
      const src = String(f.getAttribute("src") || "");
      if (!/recaptcha|hcaptcha|turnstile|challenge/i.test(src)) continue;
      const r = f.getBoundingClientRect();
      if (r.width > 40 && r.height > 40) return true;
    }
    return false;
  }

  // ── Certidão ──────────────────────────────────────────────────────────────
  async function fabricarCertidao(parte, doc, atos, ordem) {
    const est = (await Store.get("censec_estado")) || {};
    const cfg = est.config || {};

    /* Negativa desligada nas Preferências: não gera arquivo, mas a consulta
       continua contando como feita (o usuário viu na tela). */
    if (!atos.length && cfg.gerarNegativa === false) {
      console.log("CRATOS/CENSEC: sem atos e negativa desligada — nenhum PDF para", CratosMascara.nome(parte.nome));
      return null;
    }

    const proc = digitos(est.numProcesso);
    const nomeArq = doisPrimeiros(parte.nome);
    const pasta = String(cfg.pasta || "CRATOS").replace(/[\\:*?"<>|]/g, "").trim() || "CRATOS";
    /* ⛔ ORDINAL DA PARTE NO NOME (1E, 2E…). Duas partes homônimas (ex.: matriz e
       filial, mesmo nome, CPF/CNPJ diferentes) geravam o MESMO nome de arquivo —
       e aí (a) o Cofre, que guarda por nome, sobrescrevia uma certidão pela outra
       (PERDA de documento na juntada) e (b) o painel travava em "1 de 2". O
       ordinal por ordem de consulta torna cada arquivo único. (Campo, 03-04/09.) */
    const ne = Number(ordem) > 0 ? `${ordem}E_` : "";
    const filename = `${pasta}/${proc}_${ne}${nomeArq} CENSEC CEP.pdf`;

    const cab = atos.length
      ? `Certifico e dou fé que, nesta data (${dataBR()}), procedi à consulta à Central ` +
        `de Escrituras e Procurações (CEP), da CENSEC, em nome de ${parte.nome}, inscrito(a) ` +
        `no CPF/CNPJ sob o nº ${formatarDoc(doc)}, e que foram encontrados ${atos.length} ` +
        `ato(s) notarial(is), abaixo relacionado(s):`
      : `Certifico e dou fé que, nesta data (${dataBR()}), procedi à consulta à Central ` +
        `de Escrituras e Procurações (CEP), da CENSEC, em nome de ${parte.nome}, inscrito(a) ` +
        `no CPF/CNPJ sob o nº ${formatarDoc(doc)}, e que NÃO foram encontrados atos ` +
        `notariais registrados em seu nome.`;

    /* PARTES DE CADA ATO — só quando a preferência está ligada (chamada extra por
       ato). Uma falha aqui NÃO derruba a certidão: a linha do ato sai sem as
       partes e o resto segue. As partes vêm do grampo (fetch same-origin). */
    let partesPorAto = {};
    if (cfg.puxarPartes && atos.length) {
      const ids = atos.map((a) => a.id || a.atoId).filter(Boolean);
      if (ids.length) {
        try {
          const res = await pedirPartes(ids, ESPERA_PARTES_MS);
          if (res) partesPorAto = res;
          else console.warn("CRATOS/CENSEC: partes não vieram no prazo — certidão sai sem elas.");
        } catch (e) { console.warn("CRATOS/CENSEC: falha ao buscar partes:", e && e.message); }
      }
    }

    /* NÃO quebramos o parágrafo aqui. Cada item desta lista é uma linha LÓGICA;
       quem decide onde ela cabe é o gerarPDFTexto, que mede a largura real.
       Quebrar aqui por contagem de caractere e deixar o gerador reparticionar o
       resto produzia órfã: o pedaço de 90 caracteres dava 506pt numa caixa de
       495pt, o gerador cortava, e sobrava um "no" sozinho no meio da certidão. */
    const linhas = ["", cab, ""];

    atos.forEach((a, i) => {
      const livro = [a.livro, a.livroComplemento].filter(Boolean).join("");
      const folha = [a.folha, a.folhaComplemento].filter(Boolean).join("");
      linhas.push(`${i + 1}) ${dataDoAto(a.data)} - ${a.tipo || "?"} - ${a.qualidade || "?"}` +
        (livro ? ` - Livro ${livro}` : "") + (folha ? `, Fl. ${folha}` : ""));
      linhas.push(`     ${a.cartorioNome || ""}` +
        (a.cartorioMunicipio ? ` - ${a.cartorioMunicipio}/${a.cartorioUf || ""}` : "") +
        (a.cns ? ` - CNS ${formatarCns(a.cns)}` : ""));

      /* Partes do ato, quando pedidas e obtidas: nome, CPF/CNPJ formatado e
         qualidade. Cada parte é uma linha lógica (o gerarPDFTexto mede e quebra). */
      const idAto = a.id || a.atoId;
      const rp = idAto ? partesPorAto[idAto] : null;
      if (rp && rp.ok && Array.isArray(rp.partes) && rp.partes.length) {
        linhas.push("     Partes do ato:");
        rp.partes.forEach((p) => {
          const docFmt = p.documento ? formatarDoc(p.documento) : "sem CPF/CNPJ";
          const qual = p.qualidade ? ` - ${p.qualidade}` : "";
          linhas.push(`       - ${(p.nome || "(sem nome)")} - ${docFmt}${qual}`);
        });
      }
      linhas.push("");
    });

    /* STI, 21/08: sem "Emitido pelo sistema CRATOS" enquanto não homologar. */
    linhas.push("Era o que me cumpria certificar.");

    await browser.runtime.sendMessage({
      tipo: "fabricar_pdf",
      convenio: "CENSEC",
      numProcesso: est.numProcesso,
      titulo: atos.length ? "CERTIDÃO DE CONSULTA À CENSEC - CEP"
                          : "CERTIDÃO NEGATIVA DE CONSULTA À CENSEC - CEP",
      linhas,
      filename,
    }).catch(() => { /* Promise rejeita no FF mesmo baixando; presunção de sucesso */ });

    return filename;
  }

  // ── Preenchimento (mesma receita que o CNIB nos ensinou) ──────────────────
  /* achar é uma FUNÇÃO, não um seletor: o campo é reencontrado a cada tentativa
     porque o Angular recria o input quando o formulário se reinicializa. */
  async function escrever(achar, valor, opts) {
    const alvo = String(valor == null ? "" : valor);
    const porDigitos = !!(opts && opts.porDigitos);
    for (let t = 1; t <= 3; t++) {
      const el = achar();
      if (!el) { await sleep(400); continue; }
      el.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, alvo);
      disparar(el, "input");
      tecla(el, "keydown");
      tecla(el, "keyup");
      disparar(el, "change");
      el.blur();
      await sleep(350);
      const agora = (achar() || {}).value || "";
      const bate = porDigitos ? digitos(agora) === digitos(alvo) : norm(agora) === norm(alvo);
      if (bate) return true;
      console.warn(`CRATOS/CENSEC: o campo não fixou (${t}/3). Esperado "${alvo}", está "${agora}".`);
    }
    return false;
  }

  async function digitar(achar, texto) {
    const el = achar();
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    el.focus();
    setter.call(el, "");
    disparar(el, "input");
    for (const ch of String(texto)) {
      tecla(el, "keydown", ch);
      setter.call(el, el.value + ch);
      disparar(el, "input");
      tecla(el, "keyup", ch);
      await sleep(20);
    }
    disparar(el, "change");
    el.blur();
    return true;
  }

  function disparar(el, tipo) { el.dispatchEvent(new Event(tipo, { bubbles: true })); }
  function tecla(el, tipo, ch) {
    try {
      el.dispatchEvent(new KeyboardEvent(tipo, {
        key: ch || "0", keyCode: 48, which: 48, bubbles: true, cancelable: true,
      }));
    } catch (e) { disparar(el, tipo); }
  }

  function esperarHabilitado(acharFn, ms) {
    return esperar(() => {
      const el = acharFn();
      return el && !el.disabled && el.getAttribute("disabled") === null ? el : null;
    }, ms || 8000);
  }

  /* "Buscar" dentro do formulário de consulta. Escopo primeiro em
     app-public-query para não pegar um "Buscar" do menu ou de um overlay. */
  function botaoBuscar() {
    return botaoPorTexto("Buscar", "app-public-query") || botaoPorTexto("Buscar");
  }

  function botaoPorTexto(texto, escopoSel) {
    const alvo = norm(texto);
    const raiz = (escopoSel && document.querySelector(escopoSel)) || (escopoSel ? null : document);
    if (!raiz) return null;
    for (const b of raiz.querySelectorAll("button")) {
      if (!visivel(b)) continue;
      if (norm(b.textContent) === alvo) return b;
    }
    return null;
  }

  // ── Faixa de aviso (igual à do CNIB) ──────────────────────────────────────
  /* Delegação para comum/faixa.js — mesmo id ("cratos-censec-aviso"). */
  function avisar(texto, cor) { return CratosFaixa.mostrar("censec", texto, cor); }

  function falhar(e) {
    const msg = (e && e.message) || String(e);
    CratosFaixa.parar("censec", msg, { cauda: "Nenhuma consulta a mais foi feita." });
    Store.get("censec_estado").then((est) => {
      if (est) Store.set("censec_estado", Object.assign({}, est, { fase: "erro", erro: String(msg) }));
    }).catch(() => {});
  }

  // ── utilidades ────────────────────────────────────────────────────────────
  function esperar(fn, timeoutMs) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const tick = () => {
        let r = null;
        try { r = fn(); } catch (e) {}
        if (r) return resolve(r);
        if (Date.now() - t0 > (timeoutMs || 20000)) return resolve(null);
        setTimeout(tick, 250);
      };
      tick();
    });
  }
  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  /* Espera o overlay de carregamento SUMIR. Estava definido em SEL.carregando e
     nunca era usado — e é justamente o que separa uma busca da seguinte: enquanto
     ele está na tela o Angular ainda está montando o resultado, e mexer no
     formulário nesse momento é pedir para o clique se perder. */
  async function esperarSumir(seletor, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < (ms || 20000)) {
      const algum = Array.from(document.querySelectorAll(seletor)).some(visivel);
      if (!algum) return true;
      await sleep(200);
    }
    console.warn("CRATOS/CENSEC: o overlay de carregamento não sumiu; seguindo assim mesmo.");
    return false;
  }
  function norm(s) {
    return String(s == null ? "" : s).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ").trim().toLowerCase();
  }
  function digitos(s) { return String(s == null ? "" : s).replace(/\D/g, ""); }
  function visivel(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function doisPrimeiros(nome) {
    return String(nome || "").trim().split(/\s+/).slice(0, 2).join(" ")
      .replace(/[\/\\:*?"<>|]/g, "");
  }
  function formatarDoc(d) {
    const x = digitos(d);
    if (x.length === 11) return x.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
    if (x.length === 14) return x.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
    return x;
  }
  /* A API devolve o CNS como número (24729); a tela mostra 02.472-9. */
  function formatarCns(cns) {
    const d = String(cns == null ? "" : cns).replace(/\D/g, "").padStart(6, "0");
    return d.length === 6 ? `${d.slice(0, 2)}.${d.slice(2, 5)}-${d.slice(5)}` : String(cns);
  }
  function dataDoAto(iso) {
    if (!iso) return "sem data";
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso);
  }
  function dataBR() {
    const d = new Date(), p = (n) => String(n).padStart(2, "0");
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
  }
  function dataHoraBR() {
    const d = new Date(), p = (n) => String(n).padStart(2, "0");
    return `${dataBR()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  /* Não existe mais quebra de linha aqui. Quem mede largura e decide onde cortar
     é o gerarPDFTexto, no background — um lugar só, com as métricas da fonte. */

  /* Gancho de teste (jsdom): expõe o que a suíte exercita sem DOM real. */
  try { window.__cratosCensec = { fabricarCertidao, pedirPartes }; } catch (e) {}
})();
