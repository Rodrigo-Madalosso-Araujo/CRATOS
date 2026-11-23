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
   * Pede ao grampo (contexto da página) as partes de uma lista de atos. O grampo faz o
   * GET same-origin (cookie); aqui só orquestramos.
   *
   * 1.9.8: até a 1.9.7 havia UM prazo de 45 s para TODOS os atos, e a resposta só vinha
   * inteira, no fim. Com muitas procurações passava disso e a certidão saía sem as partes
   * de nenhum ato. Agora cada ato chega sozinho (EVENTO_PARTES_ITEM), o andamento aparece,
   * e só se desiste depois de ESPERA_PARTES_MS SEM CHEGAR NADA. O que não veio fica de
   * fora do mapa — e a certidão diz "partes não obtidas", nunca que o ato não tem partes. */
  const EVENTO_PARTES_PEDIR = "cratos:censec:partes:pedir";
  const EVENTO_PARTES_RESP = "cratos:censec:partes:resposta";
  const EVENTO_PARTES_ITEM = "cratos:censec:partes:item";
  const ESPERA_PARTES_MS = 30 * 1000;      // sem nenhum ato novo nesse tempo → desiste do resto
  let _seqPartes = 0;
  const _aguardandoPartes = new Map();     // reqId -> { resolve, parciais, aoAndar, tocado }

  window.addEventListener(EVENTO_PARTES_ITEM, (ev) => {
    if (!_cratosLigado) return;
    let d = null;
    try { d = JSON.parse(ev.detail); } catch (e) { return; }
    const r = _aguardandoPartes.get(d && d.reqId);
    if (!r) return;
    r.parciais[d.atoId] = d.resultado || { ok: false };
    r.tocado = Date.now();
    try { if (r.aoAndar) r.aoAndar(d.feitos, d.total); } catch (e) { /* segue */ }
  });

  window.addEventListener(EVENTO_PARTES_RESP, (ev) => {
    if (!_cratosLigado) return;
    let dados = null;
    try { dados = JSON.parse(ev.detail); } catch (e) { return; }
    const r = _aguardandoPartes.get(dados && dados.reqId);
    if (r) { _aguardandoPartes.delete(dados.reqId); r.resolve(Object.assign({}, r.parciais, (dados && dados.resultados) || {})); }
  });

  /* Devolve { atoId -> {ok, partes:[{nome,documento,qualidade}]} } — o que chegou. Se
     parar de chegar, devolve o que já tinha (nunca null). */
  function pedirPartes(atoIds, aoAndar, esperaMs) {
    const ids = (atoIds || []).map((x) => String(x || "")).filter(Boolean);
    if (!ids.length) return Promise.resolve({});
    return new Promise((resolve) => {
      const reqId = "p" + (++_seqPartes) + "_" + Date.now();
      const reg = { resolve, parciais: {}, aoAndar, tocado: Date.now() };
      _aguardandoPartes.set(reqId, reg);
      window.dispatchEvent(new CustomEvent(EVENTO_PARTES_PEDIR, {
        detail: JSON.stringify({ reqId, atoIds: ids }),
      }));
      const espera = esperaMs || ESPERA_PARTES_MS;
      const vigia = setInterval(() => {
        if (!_aguardandoPartes.has(reqId)) { clearInterval(vigia); return; }
        if (Date.now() - reg.tocado > espera) {
          clearInterval(vigia);
          _aguardandoPartes.delete(reqId);
          console.warn(`CRATOS/CENSEC: partes pararam de chegar — ${Object.keys(reg.parciais).length} de ${ids.length} atos.`);
          resolve(Object.assign({}, reg.parciais));
        }
      }, 500);
    });
  }

  /* ═══ CORTINA (1.9.8, pedido do Rodrigo) ═══
   * Com muitas procurações o CENSEC ficava minutos sem dizer nada. A cortina cobre a tela
   * enquanto o CRATOS trabalha e diz em que pé está. Sai para o captcha (você resolve) e
   * no fim; o próprio CratosOverlay sai sozinho se ficar 3 min sem ser renovado. */
  function cortina(texto) {
    try { if (globalThis.CratosOverlay && !desafioNaTela()) globalThis.CratosOverlay.mostrar("CENSEC: " + texto); } catch (e) { /* segue */ }
  }
  function semCortina() { try { if (globalThis.CratosOverlay) globalThis.CratosOverlay.esconder(); } catch (e) { /* segue */ } }

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
    const periodo = est.periodo;
    if (!periodo || !periodo.inicio || !periodo.fim) {
      return falhar(new Error("a consulta chegou sem período (CRATOS antigo no painel?). Execute de novo pelo painel."));
    }
    const cfg = est.config || {};

    /* UMA PARTE QUE FALHA NÃO MATA A FILA.
       Cada parte é uma tentativa independente; no fim, o aviso diz quem entrou e quem
       não entrou, com o motivo.
       1.9.8: a certidão NÃO sai mais logo depois da CEP de cada parte. Primeiro a CEP de
       todas; depois, se ligada, a CANP de todas (no Signo, noutra aba); só então as
       certidões — cada uma com o bloco de São Paulo. */
    const feitos = [];
    const falhados = [];
    const resultados = [];   // { parte, doc, ordem, cep }

    for (let i = 0; i < partes.length; i++) {
      const parte = partes[i];
      const doc = digitos(parte.cpfcnpj);
      avisar(`consultando ${i + 1} de ${partes.length}: ${parte.nome}`, "#facc15");
      cortina(`parte ${i + 1} de ${partes.length} — consultando a CEP…`);
      console.log(`CRATOS/CENSEC: [${i + 1}/${partes.length}] ${CratosMascara.nome(parte.nome)} (${CratosMascara.doc(doc)})`);

      let r;
      try {
        r = await consultarParte(parte, doc, periodo, cfg, `parte ${i + 1} de ${partes.length}`);
      } catch (e) {
        r = { ok: false, motivo: String((e && e.message) || e) };
      }

      if (!r.ok) {
        console.error(`CRATOS/CENSEC: ${CratosMascara.nome(parte.nome)} FALHOU — ${r.motivo}`);
        falhados.push({ nome: parte.nome, motivo: r.motivo });
      } else {
        resultados.push({ parte, doc, ordem: i + 1, cep: r });
      }

      // grava o andamento a cada parte: se a aba cair, sabemos onde parou
      await Store.set("censec_estado", Object.assign({}, est, {
        ativo: true, fase: "andando", feitos, falhados, indice: i + 1,
      }));

      if (i < partes.length - 1) {
        await esperarSumir(SEL.carregando, 20000);
        await sleep(1200);
      }
    }

    /* CANP — atos de São Paulo (Signo). Só para quem a CEP consultou. */
    let canp = { estado: "desligada" };
    if (cfg.consultarCanp && resultados.length) {
      semCortina();
      canp = await consultarCanp(est, resultados.map((x) => ({ nome: x.parte.nome, doc: x.doc })), periodo);
    }

    for (const x of resultados) {
      cortina(`gerando a certidão de ${x.parte.nome}…`);
      const canpDaParte = canp.estado === "ok"
        ? (canp.porDoc[x.doc] || { ok: false, motivo: "sem resposta para esta parte" })
        : null;
      let arquivo = null;
      try {
        arquivo = await fabricarCertidao(x.parte, x.doc, x.cep, canp.estado, canpDaParte, canp.motivo, x.ordem);
      } catch (e) {
        falhados.push({ nome: x.parte.nome, motivo: "certidão não gerada: " + String((e && e.message) || e) });
        continue;
      }
      feitos.push({ nome: x.parte.nome, atos: x.cep.atos.length, completo: x.cep.completo, arquivo,
        canp: canpDaParte && canpDaParte.ok ? canpDaParte.total : null });
    }
    semCortina();

    const semDoc = est.semDocumento || [];
    let msg = `consulta concluída: ${feitos.length} de ${partes.length} parte(s) (${CratosPeriodo.frase(periodo)}).`;
    if (feitos.length) {
      msg += "\n" + feitos.map((f) => `· ${f.nome}: CEP ${f.atos || "nada encontrado"}` +
        (f.completo ? "" : " (PARCIAL — a CEP mostra no máximo 300 por busca)") +
        (f.canp != null ? ` · CANP ${f.canp || "nada"}` : "")).join("\n");
    }
    if (canp.estado === "falhou") msg += `\n\nCANP (São Paulo) NÃO consultada: ${canp.motivo}. As certidões dizem isso.`;
    if (falhados.length) {
      msg += "\n\nNÃO consultei:\n" + falhados.map((f) => `· ${f.nome} — ${f.motivo}`).join("\n");
    }
    if (semDoc.length) {
      msg += "\n\nSem CPF/CNPJ no processo (não dá para consultar):\n" +
        semDoc.map((n) => `· ${n}`).join("\n");
    }
    const alerta = falhados.length || canp.estado === "falhou" || feitos.some((f) => !f.completo);
    avisar(msg, alerta ? "#facc15" : "#4ade80");

    await Store.set("censec_estado", Object.assign({}, est, {
      ativo: false,
      fase: falhados.length ? "concluido_com_falhas" : "concluido",
      feitos, falhados,
    }));
  }

  /* ═══ CEP DE UMA PARTE, COM O TETO DE 300 (1.9.8) ═══
   * A CEP mostra no máximo 300 atos por busca ("Mostrando os primeiros 300 registros.
   * Favor refine sua busca"). Bateu no teto → divide o período ao meio e busca cada
   * metade, de novo e de novo, até MAX_BUSCAS buscas por parte. O que cobriu sem teto é
   * "coberto"; o que ficou de fora vai para a certidão como período NÃO coberto. Ato que
   * aparece em duas buscas conta uma vez (pelo id). */
  const TETO_CEP = 300;
  const MAX_BUSCAS = 10;

  async function consultarParte(parte, doc, periodo, cfg, onde) {
    const fila = [{ inicio: periodo.inicio, fim: periodo.fim }];
    const cobertos = [], naoCobertos = [];
    const atosPorId = new Map();
    let buscas = 0;
    while (fila.length) {
      const trecho = fila.shift();
      if (buscas >= MAX_BUSCAS) { naoCobertos.push(trecho); continue; }
      buscas++;
      cortina(`${onde} — CEP, busca ${buscas} (${CratosPeriodo.dmy(trecho.inicio)} a ${CratosPeriodo.dmy(trecho.fim)})…`);
      const r = await buscarCep(parte, doc, trecho);
      if (!r.ok) return r;                       // uma busca falhou: a parte toda falha (regra de ferro)
      for (const a of r.atos) {
        const k = String(a.id || a.atoId || JSON.stringify([a.data, a.livro, a.folha, a.cns, a.tipo]));
        if (!atosPorId.has(k)) atosPorId.set(k, a);
      }
      if (!r.noTeto) { cobertos.push(trecho); continue; }
      const metades = CratosPeriodo.dividir(trecho);
      if (metades) fila.push(metades[0], metades[1]);
      else naoCobertos.push(trecho);            // um dia só com 300+: não há como refinar
      avisar(`${parte.nome}: a CEP bateu no teto de ${TETO_CEP} — refinando pelo período (busca ${buscas} de até ${MAX_BUSCAS})…`, "#facc15");
      if (fila.length) { await esperarSumir(SEL.carregando, 20000); await sleep(1200); }
    }
    const atos = Array.from(atosPorId.values());

    /* PARTES DE CADA ATO — só com a preferência ligada (chamada extra por ato). */
    let partesPorAto = {};
    if (cfg.puxarPartes && atos.length) {
      const ids = atos.map((a) => a.id || a.atoId).filter(Boolean);
      cortina(`${onde} — buscando as partes dos atos: 0 de ${ids.length}…`);
      try {
        partesPorAto = await pedirPartes(ids, (feitos, total) => {
          cortina(`${onde} — buscando as partes dos atos: ${feitos} de ${total}…`);
        });
      } catch (e) { console.warn("CRATOS/CENSEC: falha ao buscar partes:", e && e.message); }
    }

    return {
      ok: true, atos, buscas, partesPorAto,
      completo: !naoCobertos.length,
      cobertos: CratosPeriodo.juntarTrechos(cobertos),
      naoCobertos: CratosPeriodo.juntarTrechos(naoCobertos),
    };
  }

  /* Uma busca na CEP: documento + período no formulário, clica, escuta a resposta e
     CONFERE que o servidor recebeu o documento e as datas pedidas. */
  async function buscarCep(parte, doc, trecho) {
    await esperarSumir(SEL.carregando, 20000);

    // limpar e escrever (só dígitos — a máscara do campo formata sozinha)
    if (!(await escrever(campoDocumento, ""))) return { ok: false, motivo: "não limpei o campo" };
    if (!(await escrever(campoDocumento, doc, { porDigitos: true }))) {
      return { ok: false, motivo: "não consegui escrever o CPF/CNPJ" };
    }
    /* 1.9.8: as datas — dd/mm/aaaa nos campos "Data inicial" e "Data final" */
    const dataIni = () => campoPorRotulo(["data", "inicial"]);
    const dataFim = () => campoPorRotulo(["data", "final"]);
    if (!dataIni() || !dataFim()) return { ok: false, motivo: "não achei os campos de data da CEP" };
    if (!(await escrever(dataIni, CratosPeriodo.dmy(trecho.inicio), { porDigitos: true })) ||
        !(await escrever(dataFim, CratosPeriodo.dmy(trecho.fim), { porDigitos: true }))) {
      return { ok: false, motivo: "não consegui escrever o período nos campos de data" };
    }

    /* PACIÊNCIA COM O BOTÃO. O token do Turnstile é de USO ÚNICO: depois de cada
       busca o widget precisa emitir outro, e enquanto não emite o formulário fica
       inválido e o "Buscar" volta a ficar cinza. Da segunda busca em diante isso
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

    /* O que foi ao servidor é o que vale: documento e datas conferidos. */
    const f = dados.filtro || {};
    if (digitos(f.cpfCnpj) !== doc) return { ok: false, motivo: "a busca saiu com outro CPF/CNPJ — nada certificado" };
    if (ymdLocal(f.dataInicio) !== trecho.inicio || ymdLocal(f.dataFim) !== trecho.fim) {
      return { ok: false, motivo: `a busca não saiu com o período pedido (${CratosPeriodo.dmy(trecho.inicio)} a ${CratosPeriodo.dmy(trecho.fim)}) — nada certificado` };
    }

    let json;
    try { json = JSON.parse(dados.corpo || "{}"); } catch (e) { return { ok: false, motivo: "resposta da busca ilegível" }; }
    const atos = Array.isArray(json.atos) ? json.atos : [];
    /* Teto: 300 atos, ou o `buscaTicket` preenchido (veio vazio em busca de 79 atos;
       suspeita de que venha cheio quando corta — confirmar ao vivo). Anotado no console. */
    const noTeto = atos.length >= TETO_CEP || !!json.buscaTicket;
    if (json.buscaTicket) console.warn("CRATOS/CENSEC: buscaTicket PREENCHIDO nesta busca (" + atos.length + " atos) — tratado como teto.");
    return { ok: true, atos, noTeto };
  }

  /* ISO do servidor ("2026-11-01T15:00:00.000Z") → data local "2026-11-01" */
  function ymdLocal(iso) {
    const d = new Date(String(iso || ""));
    if (isNaN(d.getTime())) return "";
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  /* ═══ CANP — atos de São Paulo, no Signo (1.9.8) ═══
   * O próprio CENSEC manda consultar os atos paulistas na CANP. O CRATOS abre o Signo
   * noutra aba (conteudo/signo.js faz a consulta lá) e espera o resultado pelo storage.
   * Login no Signo é da pessoa; se demorar mais que ESPERA_CANP_MS, segue sem a CANP —
   * e a certidão DIZ que São Paulo não foi consultado. */
  const ESPERA_CANP_MS = 10 * 60 * 1000;
  async function consultarCanp(est, partesDoc, periodo) {
    const carimbo = new Date().toISOString();
    await Store.set("canp_estado", {
      ativo: true, pedidoEm: carimbo, numProcesso: est.numProcesso,
      partes: partesDoc, periodo: { inicio: periodo.inicio, fim: periodo.fim }, fase: "aguardando",
    });
    avisar("consultando a CANP (atos de São Paulo) no Signo, na aba ao lado. Se ele pedir login, entre com o seu certificado — eu sigo sozinho.", "#facc15");
    try { await browser.runtime.sendMessage({ tipo: "canp_abrir" }); } catch (e) { /* a aba pode ter aberto mesmo assim */ }
    const t0 = Date.now();
    while (Date.now() - t0 < ESPERA_CANP_MS) {
      await sleep(1000);
      let c = null;
      try { c = await Store.get("canp_estado"); } catch (e) { c = null; }
      if (!c || c.pedidoEm !== carimbo) return { estado: "falhou", motivo: "a consulta à CANP foi interrompida" };
      if (c.fase === "concluido") {
        await Store.set("canp_estado", { ativo: false, pedidoEm: carimbo, fase: "recolhido" });   // não deixa atos guardados
        return { estado: "ok", porDoc: c.resultados || {} };
      }
      if (c.fase === "erro") {
        await Store.set("canp_estado", { ativo: false, pedidoEm: carimbo, fase: "recolhido" });
        return { estado: "falhou", motivo: c.erro || "erro no Signo" };
      }
    }
    await Store.set("canp_estado", { ativo: false, pedidoEm: carimbo, fase: "expirado" });
    return { estado: "falhou", motivo: "o Signo não respondeu em 10 minutos (login não concluído?)" };
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
        semCortina();                              // 1.9.8: o desafio é seu — a cortina sai
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
  const LISTA_MAX = 300;   // Rodrigo, 23/11: a certidão relaciona até 300 atos (o teto da própria CEP)

  /* "00000247" + "Livro de Notas" → "00000247 (Livro de Notas)"; "00000142" + "E" →
     "00000142E". Até a 1.9.7 colava tudo: "00000247Livro de Notas" (certidão real, 23/11). */
  function livroFolha(num, compl) {
    const n = String(num == null ? "" : num).trim(), c = String(compl == null ? "" : compl).trim();
    if (!c) return n;
    if (!n) return c;
    return /^[A-Za-z0-9]{1,2}$/.test(c) ? n + c : `${n} (${c})`;
  }
  const lista = (itens) => itens.length <= 1 ? (itens[0] || "") : itens.slice(0, -1).join(", ") + " e " + itens[itens.length - 1];
  const trechosTxt = (ts) => lista(ts.map((t) => `${CratosPeriodo.dmy(t.inicio)} a ${CratosPeriodo.dmy(t.fim)}`));

  /* Monta a certidão (puro: sem DOM, sem rede). `cep` = resultado de consultarParte;
     `canp` = { estado: "ok"|"falhou"|"desligada", parte?: {ok,total,atos,motivo}, motivo? }.
     Devolve { titulo, linhas, negativa, temAtos }. */
  function montarCertidao(o) {
    const { parte, doc, periodo, cep, canp, puxarPartes, hoje } = o;
    const P = CratosPeriodo;
    const atos = (cep.atos || []).slice().sort((x, y) => String(y.data || "").localeCompare(String(x.data || "")));
    const n = atos.length;
    const listados = atos.slice(0, LISTA_MAX);
    const quem = `em nome de ${parte.nome}, inscrito(a) no CPF/CNPJ sob o nº ${formatarDoc(doc)}`;
    let cab = `Certifico e dou fé que, nesta data (${hoje}), procedi à consulta à Central de Escrituras e ` +
      `Procurações (CEP), da CENSEC, ${quem}, abrangendo os ${P.frase(periodo)}`;
    if (cep.completo) {
      if (!n) cab += ", e que NÃO foram encontrados atos notariais registrados em seu nome nesse período.";
      else if (n > LISTA_MAX) cab += `, e que foram encontrados ${n} atos notariais, dos quais se relacionam abaixo os ${LISTA_MAX} mais recentes (os demais podem ser consultados na CENSEC):`;
      else cab += `, e que foram encontrados ${n} ato(s) notarial(is), abaixo relacionado(s):`;
    } else {
      cab += `. A CEP exibe no máximo ${TETO_CEP} atos por consulta e, mesmo com a consulta dividida em ` +
        `${cep.buscas} buscas por período, não foi possível cobrir todo o período: ` +
        (cep.cobertos.length ? `os atos de ${trechosTxt(cep.cobertos)} foram consultados integralmente, mas ` : "") +
        `nos períodos de ${trechosTxt(cep.naoCobertos)} podem existir outros atos, NÃO relacionados nesta certidão. ` +
        `Foram exibidos ${n} ato(s)` + (n > LISTA_MAX ? `, dos quais se relacionam abaixo os ${LISTA_MAX} mais recentes:` : ", abaixo relacionado(s):");
    }

    /* NÃO quebramos o parágrafo aqui: quem decide onde a linha cabe é o gerarPDFTexto. */
    const linhas = ["", cab, ""];
    listados.forEach((a, i) => {
      const livro = livroFolha(a.livro, a.livroComplemento);
      const folha = livroFolha(a.folha, a.folhaComplemento);
      linhas.push(`${i + 1}) ${dataDoAto(a.data)} - ${a.tipo || "?"} - ${a.qualidade || "?"}` +
        (livro ? ` - Livro ${livro}` : "") + (folha ? `, Fl. ${folha}` : ""));
      linhas.push(`     ${a.cartorioNome || ""}` +
        (a.cartorioMunicipio ? ` - ${a.cartorioMunicipio}/${a.cartorioUf || ""}` : "") +
        (a.cns ? ` - CNS ${formatarCns(a.cns)}` : ""));
      if (puxarPartes) {
        const idAto = a.id || a.atoId;
        const rp = idAto ? (cep.partesPorAto || {})[idAto] : null;
        if (rp && rp.ok && Array.isArray(rp.partes) && rp.partes.length) {
          linhas.push("     Partes do ato:");
          rp.partes.forEach((p) => {
            const docFmt = p.documento ? formatarDoc(p.documento) : "sem CPF/CNPJ";
            const qual = p.qualidade ? ` - ${p.qualidade}` : "";
            linhas.push(`       - ${(p.nome || "(sem nome)")} - ${docFmt}${qual}`);
          });
        } else if (rp && rp.ok) {
          linhas.push("     Partes do ato: a CEP não informou partes.");
        } else {
          linhas.push("     Partes do ato: não obtidas nesta consulta.");   // 1.9.8: nunca "sem partes"
        }
      }
      linhas.push("");
    });

    /* CANP — atos de São Paulo */
    const cp = canp || { estado: "desligada" };
    const r = cp.parte;
    let canpAtos = 0;
    /* em negrito, até os dois pontos (Rodrigo, 23/11) */
    linhas.push({ t: "ATOS PRATICADOS NO ESTADO DE SÃO PAULO — CANP (Central de Atos Notariais Paulista, consultada no Signo/CNB-SP):", negrito: true });
    if (cp.estado === "desligada") {
      linhas.push("A CANP não foi consultada, por configuração. Esta certidão não abrange os atos praticados no estado de São Paulo.");
    } else if (cp.estado !== "ok" || !r || !r.ok) {
      const mot = (r && r.motivo) || cp.motivo || "motivo não informado";
      linhas.push(`A CANP não pôde ser consultada nesta oportunidade (${mot}). Esta certidão não abrange os atos praticados no estado de São Paulo.`);
    } else {
      const total = Number(r.total) || 0;
      const lc = (r.atos || []).slice(0, LISTA_MAX);
      canpAtos = total;
      if (!total) {
        linhas.push(`Consultada a CANP no mesmo período, NÃO foram encontrados atos em nome da parte.`);
      } else {
        linhas.push(`Consultada a CANP no mesmo período, foram encontrados ${total} ato(s)` +
          (lc.length < total ? `, dos quais se relacionam abaixo os ${lc.length} primeiros (os demais podem ser consultados na CANP):` : ", abaixo relacionado(s):"));
        linhas.push("");
        lc.forEach((a, i) => {
          const livro = String(a.livroComplemento || a.livroInicial || "").trim();
          const folha = String(a.folhaComplemento || a.folhaInicial || "").trim();
          linhas.push(`${i + 1}) ${dataDoAto(a.dataAto)} - ${a.nomeTipoAto || "?"}` +
            (livro ? ` - Livro ${livro}` : "") + (folha ? `, Fl. ${folha}` : ""));
          linhas.push(`     ${a.nomeCartorio || ""}` + (a.municipio ? ` - ${a.municipio}/${a.uf || "SP"}` : "") +
            (a.numeroCns ? ` - CNS ${a.numeroCns}` : ""));
          linhas.push("");
        });
      }
    }
    linhas.push("");

    /* STI, 21/08: sem "Emitido pelo sistema CRATOS" enquanto não homologar. */
    linhas.push("Era o que me cumpria certificar.");

    const temAtos = n > 0 || canpAtos > 0;
    /* Negativa só quando NADA foi achado, a CEP foi completa e São Paulo foi consultado
       (ou deliberadamente não consultado, por configuração). CANP que falhou → não é
       negativa: não sabemos de São Paulo. */
    const negativa = !temAtos && cep.completo && (cp.estado === "desligada" || (cp.estado === "ok" && r && r.ok));
    return {
      titulo: negativa ? "CERTIDÃO NEGATIVA DE CONSULTA À CENSEC - CEP" : "CERTIDÃO DE CONSULTA À CENSEC - CEP",
      linhas, negativa, temAtos,
    };
  }

  async function fabricarCertidao(parte, doc, cep, canpEstado, canpParte, canpMotivo, ordem) {
    const est = (await Store.get("censec_estado")) || {};
    const cfg = est.config || {};
    const cert = montarCertidao({
      parte, doc, periodo: est.periodo, cep, puxarPartes: !!cfg.puxarPartes, hoje: dataBR(),
      canp: { estado: canpEstado, parte: canpParte, motivo: canpMotivo },
    });

    /* Negativa desligada nas Preferências: não gera arquivo, mas a consulta
       continua contando como feita (o usuário viu na tela). */
    if (cert.negativa && cfg.gerarNegativa === false) {
      console.log("CRATOS/CENSEC: sem atos e negativa desligada — nenhum PDF para", CratosMascara.nome(parte.nome));
      return null;
    }

    const proc = digitos(est.numProcesso);
    const nomeArq = doisPrimeiros(parte.nome);
    const pasta = String(cfg.pasta || "CRATOS").replace(/[\\:*?"<>|]/g, "").trim() || "CRATOS";
    /* ⛔ ORDINAL DA PARTE NO NOME (1E, 2E…): homônimos (matriz e filial) não colidem. */
    const ne = Number(ordem) > 0 ? `${ordem}E_` : "";
    const filename = `${pasta}/${proc}_${ne}${nomeArq} CENSEC CEP.pdf`;

    await browser.runtime.sendMessage({
      tipo: "fabricar_pdf",
      convenio: "CENSEC",
      numProcesso: est.numProcesso,
      titulo: cert.titulo,
      linhas: cert.linhas,
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
  try { window.__cratosCensec = { fabricarCertidao, pedirPartes, montarCertidao, consultarParte, buscarCep, livroFolha, consultarCanp }; } catch (e) {}
})();
