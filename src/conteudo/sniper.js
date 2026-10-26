/*
 * conteudo/sniper.js — content script do SNIPER (sniper.pdpj.jus.br).
 *
 * ═══ COMO ANDA ═══
 * O SNIPER é um app Angular: tudo acontece num documento só. O CRATOS
 *   1. injeta o grampo de LEITURA (conteudo/sniper-api.js), que repassa as respostas
 *      que a própria página recebe de sniper-api.pdpj.jus.br/v2/;
 *   2. espera o formulário (se pedir login, é você quem entra);
 *   3. informa o nº do processo e espera o SNIPER carregar as partes do polo passivo;
 *   4. ajusta as fontes conforme as Preferências (todas, de fábrica);
 *   5. clica em "Iniciar investigação" — e mais nada;
 *   6. lê, das respostas da API, o resultado de cada fonte e fabrica o RELATÓRIO e a
 *      CERTIDÃO (dois PDFs → background fabricar_pdf → Cofre + diário + pulso).
 *
 * ═══ REGRAS QUE NÃO SE DOBRAM ═══
 *  - NADA DE CONSTRIÇÃO: todo clique passa por `clicarSeguro`, que recusa elemento que
 *    remeta a bloqueio/restrição/constrição/penhora/indisponibilidade. O relatório
 *    não leva o "ID para bloqueio".
 *  - Erro de fonte nunca vira "nada encontrado"; fonte em andamento é certificada
 *    assim (o SNIPER não devolve nada depois — Rodrigo, 21/10).
 *  - Falha técnica (botão que não habilita, investigação que não cria) = faixa, NUNCA
 *    certidão.
 *  - O grafo de vínculos fica FORA. O cadastro da Receita de cada parte ("Mais detalhes") ENTRA
 *    no começo do relatório (1.7.1, pedido do Rodrigo: o juiz defere e espera todos os dados).
 *  - HTML dinâmico: este script não monta HTML (só a faixa, por textContent).
 */
(function iniciarSniper() {
  if (!/(^|\.)sniper\.pdpj\.jus\.br$/i.test(location.hostname)) return;
  console.log("CRATOS/SNIPER: content script ativo em", location.pathname);

  const VALIDADE_MS = 60 * 60 * 1000;      // login pode demorar; cada passo renova
  const ESPERA_FORM_MS = 10 * 60 * 1000;   // aguardando o login / a tela montar
  const ESPERA_BOTAO_MS = 20 * 1000;
  const ESPERA_CRIAR_MS = 60 * 1000;
  const ESPERA_FONTES_MS = 120 * 1000;
  const FOLGA_FINAL_MS = 3000;
  const ESPERA_INFO_MS = 15 * 1000;
  const PAUSA_ANTES_DE_FECHAR_MS = 2500;
  const AVISO_CORTINA = "O CRATOS está fazendo a investigação no SNIPER. Aguarde — não feche nem clique nesta aba.";
  const PASSO_MS = 500;

  /* As 8 fontes (espelho de modulos/sniper.js — content script não importa módulo). */
  const FONTES = [
    { slug: "sisbajud", rotulo: "Sisbajud (contas)", tela: "contas" },
    { slug: "renajud", rotulo: "Renajud (veículos)", tela: "veiculos" },
    { slug: "serp", rotulo: "SERP/ONR (imóveis)", tela: "imoveis" },
    { slug: "anacjud", rotulo: "AnacJud (aeronaves)", tela: "aeronaves" },
    { slug: "embarcacao", rotulo: "Tribunal Marítimo (embarcações)", tela: "embarcacoes" },
    { slug: "bem-declarado", rotulo: "TSE (bens declarados)", tela: "bens declarados" },
    { slug: "sngb", rotulo: "SNGB (bens apreendidos)", tela: "bens apreendidos" },
    { slug: "sancao", rotulo: "CGU (sanções diversas)", tela: "sancoes diversas" },
  ];
  const rotuloFonte = (slug) => (FONTES.find((f) => f.slug === slug) || { rotulo: slug }).rotulo;

  /* Campos que NUNCA vão para o relatório: identificadores internos e o de bloqueio. */
  const CAMPO_OCULTO = /^(id_para_bloqueio|id_parte|uuid|id)$/i;
  const TITULO_OCULTO = /bloque|^id\b|^id parte$/i;

  /* A trava. Texto, rótulo, título ou ícone que remeta a constrição → não clica. */
  const PROIBIDO = /bloque|bloqu|restri|constri|penhor|indisponib|\bblock|\block\b|gavel/i;

  /* Pontos de saída para o mundo — trocáveis no teste (jsdom não navega). */
  const io = {
    clicar: (el) => el.click(),
    voltar: () => history.back(),
    /* 1.7.2: fecha a aba do SNIPER (o background fecha a aba de quem pediu) */
    fecharAba: () => browser.runtime.sendMessage({ tipo: "sniper_fechar_aba" }).catch(() => {}),
    agora: () => Date.now(),
    esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
  };

  /* ── O GRAMPO e o que ele ouve ───────────────────────────────────────────── */
  const capturas = [];
  /* 1.9.0 (revisão de segurança): só se GUARDA o que a API respondeu enquanto houver
     tarefa do CRATOS. Sem tarefa, o ouvido sai e a lista é esvaziada. O grampo continua
     entrando cedo (o resultado da investigação chega ao abrir a página). */
  const ouvir = (ev) => {
    try {
      const d = JSON.parse(ev.detail);
      let json = null;
      try { json = d.corpo ? JSON.parse(d.corpo) : null; } catch (e) { /* não era JSON */ }
      let enviadoJson = null;
      try { enviadoJson = d.enviado ? JSON.parse(d.enviado) : null; } catch (e) { /* idem */ }
      capturas.push({ metodo: d.metodo, url: String(d.url || ""), status: d.status, json, enviado: enviadoJson });
    } catch (e) { /* evento malformado: ignora */ }
  };
  window.addEventListener("cratos:sniper:api", ouvir);
  function pararDeOuvir() {
    window.removeEventListener("cratos:sniper:api", ouvir);
    capturas.length = 0;
  }
  function injetarGrampo() {
    try {
      const s = document.createElement("script");
      s.src = browser.runtime.getURL("conteudo/sniper-api.js");
      s.async = false;
      (document.head || document.documentElement).appendChild(s);
      s.onload = () => s.remove();
    } catch (e) {
      console.error("CRATOS/SNIPER: falha ao injetar o grampo:", e);
    }
  }
  injetarGrampo();

  Store.get("sniper_estado").then(async (est) => {
    if (!(await Store.ligada())) { console.log("CRATOS/SNIPER: extensão desligada."); pararDeOuvir(); return; }
    if (!est || !est.ativo) { pararDeOuvir(); return; }
    const idade = io.agora() - new Date(est.abertoEm || 0).getTime();
    if (idade > VALIDADE_MS) { console.log("CRATOS/SNIPER: estado antigo — ignorando."); pararDeOuvir(); return; }
    await processar(est);
  }).catch((e) => falhar(null, e));

  /* ═══ O FLUXO ═══ */
  async function processar(est) {
    try {
      /* Aba recarregada DEPOIS do clique: não clica de novo (seria outra investigação). */
      if (est.fase === "investigando") {
        await encerrarSemCertidao(est, "a aba do SNIPER recarregou depois de iniciada a investigação" +
          (est.idInvestigacao ? ` (nº ${est.idInvestigacao})` : "") + ". Para não duplicar, o CRATOS não " +
          "iniciou outra. Confira no Histórico de investigações do SNIPER e certifique à mão, se for o caso");
        return;
      }

      avisar("aguardando o formulário do SNIPER (se pedir login, entre; eu sigo sozinho)…");
      const campoProc = await aguardar(() => campoProcesso(), ESPERA_FORM_MS, () => {
        if (termosNaTela()) avisar("o SNIPER está pedindo o aceite dos Termos de Uso. O aceite é seu: aceite na tela e eu sigo.");
      });
      if (!campoProc) throw new Error("o formulário do SNIPER (Nº do processo) não apareceu.");
      await salvar(est, { fase: "formulario" });
      /* 1.7.2 (Rodrigo, 21/10): a cortina do INFOJUD — daqui em diante quem mexe na tela é
         o CRATOS. Renovada a cada fase (ela some sozinha em 3 min, por segurança). */
      cortina();

      /* 3. nº do processo → partes */
      avisar("informando o processo e esperando o SNIPER carregar as partes…");
      const alvo = formatarProcesso(est.numeroDigitos);
      const { cap: capPartes } = await informarProcesso(campoProc, alvo);
      if (!capPartes) throw new Error("o SNIPER não carregou as partes do processo depois de colar e de digitar o número " +
        "(a resposta não chegou). Confira o número na tela.");
      const numUrl = digitos((capPartes.url.match(/\/v2\/processo\/([^/]+)\/passiva/i) || [])[1]);
      if (numUrl !== est.numeroDigitos) {
        throw new Error(`a tela do SNIPER está com outro processo (${formatarProcesso(numUrl)}). Nada foi iniciado.`);
      }
      const partes = (Array.isArray(capPartes.json) ? capPartes.json : [])
        .map((p) => ({ nome: String((p && p.nome) || "").trim(), doc: digitos(p && p.documento), selecionada: !(p && p.selecionada === false) }))
        .filter((p) => p.doc.length === 11 || p.doc.length === 14);
      if (!partes.length) {
        await encerrarSemCertidao(est, "o SNIPER não trouxe nenhuma parte com CPF/CNPJ no polo passivo deste processo. " +
          "Nada foi iniciado");
        return;
      }

      /* 4. fontes */
      const marcadas = await ajustarFontes(est.config.fontes || []);

      /* 5. o clique */
      const botao = await aguardar(() => { const b = botaoIniciar(); return b && !b.disabled ? b : null; }, ESPERA_BOTAO_MS);
      if (!botao) throw new Error("o botão \"Iniciar investigação\" não habilitou. Nada foi iniciado.");
      await salvar(est, { fase: "investigando", iniciadaEm: new Date(io.agora()).toISOString() });
      avisar("iniciando a investigação…");
      cortina();
      clicarSeguro(botao);

      /* 6. a investigação criada */
      const capCriar = await aguardar(() => capturas.find((c) => c.metodo === "POST" && /\/v2\/investigacao\/?(\?|$)/i.test(c.url)), ESPERA_CRIAR_MS);
      if (!capCriar) throw new Error("o SNIPER não confirmou a criação da investigação (a resposta não chegou). Confira no Histórico.");
      if (!(capCriar.status >= 200 && capCriar.status < 300)) {
        throw new Error(`o SNIPER recusou iniciar a investigação (HTTP ${capCriar.status}${mensagemDe(capCriar.json)}).`);
      }
      const enviado = capCriar.enviado || {};
      if (enviado.numero_processo && digitos(enviado.numero_processo) !== est.numeroDigitos) {
        throw new Error("o SNIPER registrou a investigação para outro processo. Confira no Histórico; não certifico.");
      }
      const id = String((String((capCriar.json || {}).url_investigacao || "").match(/(\d+)\/?\s*$/) || [])[1] || "");
      if (!id) throw new Error("o SNIPER criou a investigação, mas não informou o número. Confira no Histórico.");
      await salvar(est, { idInvestigacao: id });
      const enviadas = Array.isArray(enviado.sistemas) && enviado.sistemas.length ? enviado.sistemas.map(String) : marcadas;
      const docsEnviados = Array.isArray(enviado.doc_partes) ? enviado.doc_partes.map(digitos) : partes.filter((p) => p.selecionada).map((p) => p.doc);

      avisar(`investigação nº ${id} criada. Lendo o resultado de cada fonte…`);
      const rotaFonte = (slug) => new RegExp(`/v2/investigacao/${id}/sistemas/${slug.replace(/[-]/g, "\\-")}/?(\\?|$)`, "i");
      await aguardar(() => enviadas.every((s) => capturas.some((c) => rotaFonte(s).test(c.url))), ESPERA_FONTES_MS);
      await io.esperar(FOLGA_FINAL_MS);

      const capInfo = capturas.filter((c) => new RegExp(`/v2/investigacao/${id}/?(\\?|$)`, "i").test(c.url) && c.metodo === "GET").pop();
      if (capInfo && capInfo.json && capInfo.json.numero_processo) {
        const n16 = digitos(capInfo.json.numero_processo);
        if (n16 && est.numeroDigitos.indexOf(n16) !== 0) {
          throw new Error("a investigação aberta na tela é de outro processo. Não certifico; confira no SNIPER.");
        }
      }

      const fontes = enviadas.map((slug) => {
        const cap = capturas.filter((c) => rotaFonte(slug).test(c.url)).pop();
        return Object.assign({ slug, rotulo: rotuloFonte(slug) }, interpretarFonte(cap));
      });
      const investigadas = docsEnviados.map((d) => partes.find((p) => p.doc === d) || { nome: "", doc: d });

      /* 1.7.1 — cadastro da Receita de cada parte (o mesmo do "Mais detalhes"), pedido do
         Rodrigo (21/10): o SNIPER só o busca quando alguém abre a parte; o CRATOS abre, lê o
         que a tela recebeu (/v2/investigacao/{idParte}/info/) e volta aos resultados. */
      avisar("lendo os dados cadastrais de cada parte (Mais detalhes)…");
      cortina();
      const infos = await lerCadastros(investigadas.length);
      const cadastros = casarCadastros(investigadas, infos);
      const naoListadas = (est.docsPainel || []).filter((p) => !partes.some((x) => x.doc === p.doc));
      const naoConsultadas = FONTES.map((f) => f.slug).filter((s) => enviadas.indexOf(s) < 0);
      const dados = {
        numProcesso: est.numProcesso || formatarProcesso(est.numeroDigitos),
        numeroDigitos: est.numeroDigitos,
        id,
        criadaEm: capInfo && capInfo.json ? capInfo.json.created_at : null,
        consultaEm: new Date(io.agora()),
        iniciadaEm: est.iniciadaEm,
        investigadas,
        cadastros,
        fontes,
        naoConsultadas,
        naoListadas,
      };

      const base = `${pasta(est)}/${est.numeroDigitos}_${doisPrimeiros((investigadas[0] || {}).nome) || "parte"}`;
      const nomeRelatorio = `${base} SNIPER relatorio.pdf`.replace(/\s+/g, " ");
      const nomeCertidao = `${base} SNIPER certidao.pdf`.replace(/\s+/g, " ");
      await enviarPdf(est, "RELATÓRIO DE INVESTIGAÇÃO PATRIMONIAL — SNIPER (CNJ)", montarRelatorio(dados), nomeRelatorio, "relatorio");
      await enviarPdf(est, "CERTIDÃO — INVESTIGAÇÃO PATRIMONIAL (SNIPER/CNJ)", montarCertidao(dados, nomeRelatorio), nomeCertidao, "certidao");
      await salvar(est, { ativo: false, fase: "concluido" });
      tirarCortina();

      const resumo = fontes.map((f) => `${f.rotulo}: ${resumoCurto(f)}`).join(" · ");
      let txt = `investigação nº ${id} concluída e certificada. ${resumo}.`;
      if (naoListadas.length) {
        txt += ` Atenção: ${naoListadas.map((p) => p.nome || formatarDoc(p.doc)).join(", ")} não ` +
          `aparece(m) no polo passivo que o SNIPER trouxe, e não foi(ram) investigado(s).`;
      }
      txt += " Esta aba vai fechar sozinha.";
      CratosFaixa.mostrar("sniper", txt, naoListadas.length || fontes.some((f) => f.situacao === "erro" || f.situacao === "andamento" || f.situacao === "sem_resposta") ? "#facc15" : "#4ade80");
      /* 1.7.2 (Rodrigo, 21/10): fecha o SNIPER depois do download. Só no SUCESSO — em
         falha a aba fica aberta para conferência (por isso o SNIPER não está no
         HOST_CONVENIO do background, que o painel fecha em qualquer desfecho). */
      await io.esperar(PAUSA_ANTES_DE_FECHAR_MS);
      pararDeOuvir();
      io.fecharAba();
    } catch (e) {
      falhar(est, e);
    }
  }

  /* ═══ TELA ═══ */
  function campoProcesso() {
    return document.querySelector('input[formcontrolname="proc"]') ||
      Array.from(document.querySelectorAll("input")).find((i) => /n[ºo°]\s*do\s*processo/i.test(rotuloDe(i))) || null;
  }
  function botaoIniciar() {
    const campo = campoProcesso();
    const escopo = (campo && campo.closest("form")) || document;
    return Array.from(escopo.querySelectorAll("button")).find((b) => /iniciar\s+investiga/i.test(textoDe(b))) || null;
  }
  function termosNaTela() {
    const t = (document.body && document.body.textContent) || "";
    return /termos?\s+de\s+uso/i.test(t) && !!Array.from(document.querySelectorAll("button"))
      .find((b) => /aceit|concord|li e /i.test(textoDe(b)));
  }
  function rotuloDe(el) {
    if (!el) return "";
    const partes = [];
    if (el.id) { const l = document.querySelector(`label[for="${cssEsc(el.id)}"]`); if (l) partes.push(l.textContent); }
    const mat = el.closest("mat-checkbox, mat-form-field, label");
    if (mat) partes.push(mat.textContent);
    partes.push(el.getAttribute("aria-label") || "");
    return partes.join(" ").replace(/\s+/g, " ").trim();
  }
  function textoDe(el) {
    if (!el) return "";
    return [el.textContent, el.getAttribute && el.getAttribute("aria-label"), el.getAttribute && el.getAttribute("title"), el.value]
      .filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }
  const semAcento = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  /* A TRAVA de constrição. Lança: quem chama não consegue "esquecer" de conferir. */
  function clicarSeguro(el) {
    if (!el) throw new Error("elemento ausente para clicar.");
    const alvo = el.closest ? (el.closest("button, a, [role=button], mat-checkbox") || el) : el;
    const texto = textoDe(alvo) + " " + rotuloDe(el);
    if (PROIBIDO.test(texto)) {
      throw new Error("TRAVA: o CRATOS não clica em nada que remeta a bloqueio ou constrição no SNIPER (\"" +
        texto.slice(0, 60) + "\").");
    }
    io.clicar(el);
  }

  /* 1.7.1 — campo do processo. Teste ao vivo de 21/10: o "colar" do Rodrigo (Ctrl+V) faz o
     SNIPER carregar as partes na hora; o valor posto de uma vez pelo CRATOS NÃO — só destravou
     quando ele apagou um pedaço e redigitou. Então: cada TENTATIVA imita uma pessoa, e entre
     uma e outra o CRATOS confere se as partes CHEGARAM (a resposta da API), não o .value.
       1) apagar e digitar caractere por caractere (keydown/input/keyup), com a máscara —
          a que funcionou ao vivo (1.7.2 pôs na frente);
       2) colar (ClipboardEvent com o texto, como o Ctrl+V);
       3) idem, só os dígitos (máscara que insere a pontuação sozinha). */
  /* 1.7.2: a DIGITAÇÃO pegou de primeira no teste ao vivo (Rodrigo, 21/10) — vem antes. */
  const ESTRATEGIAS = ["digitar", "colar", "digitar_digitos"];
  const ESPERA_POR_TENTATIVA_MS = 6000;
  const partesChegaram = () => capturas.find((c) => /\/v2\/processo\/[^/]+\/passiva/i.test(c.url));

  async function informarProcesso(el, valor) {
    for (const modo of ESTRATEGIAS) {
      try { await tentarPreencher(el, valor, modo); } catch (e) { console.warn("CRATOS/SNIPER: tentativa", modo, "falhou:", e.message); }
      const cap = await aguardar(partesChegaram, ESPERA_POR_TENTATIVA_MS);
      if (cap) return { cap, modo };
    }
    return { cap: partesChegaram() || null, modo: null };
  }

  function definirValor(el, v) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v);
  }
  function teclar(el, tipo, ch) {
    try { el.dispatchEvent(new KeyboardEvent(tipo, { bubbles: true, cancelable: true, key: ch })); } catch (e) { /* nada */ }
  }
  async function limpar(el) {
    el.focus();
    try { el.select(); } catch (e) { /* nada */ }
    if (el.value) {
      teclar(el, "keydown", "Backspace");
      definirValor(el, "");
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
      teclar(el, "keyup", "Backspace");
    }
  }
  async function tentarPreencher(el, valor, modo) {
    await limpar(el);
    if (modo === "colar") {
      let tratado = false;
      try {
        const dt = new DataTransfer();
        dt.setData("text/plain", valor);
        tratado = !el.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt }));
      } catch (e) { /* ambiente sem ClipboardEvent: cai na inserção abaixo */ }
      if (!tratado || digitos(el.value) !== digitos(valor)) {
        definirValor(el, valor);
        el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste", data: valor }));
      }
    } else {
      const texto = modo === "digitar_digitos" ? digitos(valor) : valor;
      for (const ch of texto) {
        teclar(el, "keydown", ch);
        teclar(el, "keypress", ch);
        definirValor(el, el.value + ch);
        el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: ch }));
        teclar(el, "keyup", ch);
        await io.esperar(15);
      }
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  /* Marca/desmarca as fontes conforme as Preferências. Devolve os slugs marcados. */
  async function ajustarFontes(desejadas) {
    const caixas = Array.from(document.querySelectorAll('input[type="checkbox"]'));
    const marcadas = [];
    for (const f of FONTES) {
      const cx = caixas.find((c) => semAcento(rotuloDe(c)).indexOf("(" + f.tela + ")") >= 0);
      if (!cx) continue;
      const quer = desejadas.indexOf(f.slug) >= 0;
      if (!!cx.checked !== quer) { clicarSeguro(cx); await io.esperar(150); }
      if (cx.checked) marcadas.push(f.slug);
    }
    return marcadas;
  }

  /* ═══ CADASTRO DAS PARTES ("Mais detalhes") ═══ */
  const rxLinkParte = /investigacao-de-bens\/\d+\/parte\/(\d+)/;
  const linksParte = () => Array.from(document.querySelectorAll('a[href*="/parte/"]'))
    .filter((a) => rxLinkParte.test(String(a.getAttribute("href") || a.href || "")));
  async function lerCadastros(esperadas) {
    const lidos = [];
    const ids = [];
    /* os cartões das partes podem renderizar DEPOIS das respostas das fontes */
    await aguardar(() => linksParte().length >= Math.max(1, esperadas || 1), 10 * 1000);
    for (const a of linksParte()) {
      const idParte = (String(a.getAttribute("href") || a.href).match(rxLinkParte) || [])[1];
      if (idParte && ids.indexOf(idParte) < 0) ids.push(idParte);
    }
    for (const idParte of ids) {
      const rxInfo = new RegExp(`/v2/investigacao/${idParte}/info/?(\\?|$)`, "i");
      const rxProc = new RegExp(`/v2/investigacao/${idParte}/processos/?(\\?|$)`, "i");
      const acharInfo = () => capturas.find((c) => c.metodo === "GET" && rxInfo.test(c.url));
      const procs = () => capturas.filter((c) => c.metodo === "GET" && rxProc.test(c.url));
      let cap = acharInfo();
      let processos = null;
      const a = linksParte().find((x) => String(x.getAttribute("href") || x.href).indexOf(`/parte/${idParte}`) >= 0);
      if (a) {
        const urlAntes = location.href;
        let abriu = false;
        try { clicarSeguro(a); abriu = true; } catch (e) { console.warn("CRATOS/SNIPER:", e.message); }
        if (abriu) {
          if (!cap) cap = await aguardar(acharInfo, ESPERA_INFO_MS);
          /* 1.7.3 — aba "Processos" do "Mais detalhes" (pedido do Rodrigo, 21/10): ações em
             nome da parte. A aba é que dispara o /processos/. */
          processos = await lerProcessos(procs);
          if (location.href !== urlAntes) {
            io.voltar();
            await aguardar(() => location.href === urlAntes && linksParte().length, 8000);
          }
        }
      }
      const info = cap && cap.status >= 200 && cap.status < 300 && cap.json && typeof cap.json === "object" ? cap.json : null;
      if (info || processos) lidos.push({ idParte, info, processos });
    }
    return lidos;
  }

  /* Aba "Processos": clica, espera o /processos/ e, se a resposta disser que há mais
     páginas NO SERVIDOR, avança a paginação da tela até juntar tudo (teto de 20). Se a
     resposta já trouxer todos (paginação só da tela — o mais provável), não clica em nada. */
  async function lerProcessos(procs) {
    const aba = Array.from(document.querySelectorAll('[role="tab"], .mat-mdc-tab, .mdc-tab'))
      .find((t) => /^\s*processos\s*$/i.test(t.textContent || ""));
    if (!aba) return null;
    const antes = procs().length;
    try { clicarSeguro(aba); } catch (e) { return null; }
    const primeira = await aguardar(() => procs()[antes] || null, ESPERA_INFO_MS);
    if (!primeira) return null;
    if (!(primeira.status >= 200 && primeira.status < 300)) return { itens: [], total: null, erro: `HTTP ${primeira.status}` };
    let pag = paginaProcessos(primeira.json);
    const itens = pag.itens.slice();
    let paginas = 1;
    while ((pag.next || (pag.total != null && itens.length < pag.total)) && paginas < 20) {
      const prox = Array.from(document.querySelectorAll("button"))
        .find((b) => /pr[oó]xima p[aá]gina|next page/i.test(b.getAttribute("aria-label") || b.textContent || ""));
      if (!prox || prox.disabled) break;
      const n = procs().length;
      try { clicarSeguro(prox); } catch (e) { break; }
      const cap = await aguardar(() => procs()[n] || null, ESPERA_INFO_MS);
      if (!cap || !(cap.status >= 200 && cap.status < 300)) break;
      pag = paginaProcessos(cap.json);
      if (!pag.itens.length) break;
      itens.push(...pag.itens);
      paginas++;
    }
    const total = pag.total != null ? pag.total : null;
    return { itens: itens.map(normalizarProcesso), total };
  }
  function paginaProcessos(j) {
    if (Array.isArray(j)) return { itens: j, total: null, next: null };
    if (!j || typeof j !== "object") return { itens: [], total: null, next: null };
    const lista = [j.results, j.result, j.items, j.data, j.processos, j.content].find(Array.isArray) || [];
    const total = [j.count, j.total, j.totalElements, j.total_items, j.totalItens].find((x) => typeof x === "number");
    return { itens: lista, total: total != null ? total : null, next: j.next || null };
  }

  /* Uma ação → { numero, tribunal, classe (último nível), assunto, movimento }. Leitura
     tolerante aos nomes dos campos (a gravação da aba ainda não existe). */
  function normalizarProcesso(it) {
    const o = it && typeof it === "object" ? it : {};
    const chave = (rx) => { const k = Object.keys(o).find((x) => rx.test(x)); return k ? o[k] : undefined; };
    const nomeDe = (v) => {
      if (v == null) return "";
      if (typeof v === "string" || typeof v === "number") return String(v);
      if (Array.isArray(v)) return v.map(nomeDe).filter(Boolean).join("; ");
      return String(v.nome || v.descricao || v.name || v.label || v.titulo || "");
    };
    const ultimoNivel = (v) => {
      if (v == null) return "";
      if (Array.isArray(v)) return ultimoNivel(v[v.length - 1]);
      if (typeof v === "object") {
        const filho = v.filho || v.filhos || v.children || v.subclasse || v.sub;
        if (filho && (!Array.isArray(filho) || filho.length)) return ultimoNivel(filho);
        return nomeDe(v);
      }
      const partes = String(v).split(/\s*(?:\n|>|›|\|)\s*/).map((x) => x.trim()).filter(Boolean);
      return partes.length ? partes[partes.length - 1] : "";
    };
    const numero = String(chave(/^(numero|numero_?processo|numeroprocesso|processo|nr_?processo)$/i) || chave(/numero/i) || "");
    let movimento = chave(/movimento/i);
    if (movimento && typeof movimento === "object" && !Array.isArray(movimento)) {
      const data = movimento.data || movimento.dataHora || movimento.data_hora;
      movimento = (data ? dataHoraDe(data) + " — " : "") + nomeDe(movimento);
    }
    return {
      numero: digitos(numero).length === 20 ? formatarProcesso(numero) : numero,
      tribunal: nomeDe(chave(/^(tribunal|sigla_?tribunal|siglatribunal|orgao_?julgador_?tribunal)$/i) || chave(/tribunal/i)),
      classe: ultimoNivel(chave(/^classe/i) || chave(/classe/i)),
      assunto: nomeDe(chave(/^assunto/i) || chave(/assunto/i)),
      movimento: nomeDe(movimento),
    };
  }

  /* Casa cada cadastro com a parte pelo CPF/CNPJ que vem nele; o que não casar vai junto
     da primeira parte sem cadastro (ordem da tela). Cada entrada traz { info, processos }. */
  function casarCadastros(investigadas, lidos) {
    const docDe = (info) => {
      for (const k of Object.keys(info || {})) if (/^(cnpj|cpf)$/i.test(k.trim())) return digitos(info[k]);
      return "";
    };
    const sobra = (lidos || []).map((x) => (x && (x.info !== undefined || x.processos !== undefined) ? x : { info: x, processos: null }));
    const saida = investigadas.map((p) => {
      const i = sobra.findIndex((x) => docDe(x.info) === p.doc);
      const e = i >= 0 ? sobra.splice(i, 1)[0] : null;
      return { parte: p, info: e ? e.info : null, processos: e ? e.processos : null };
    });
    for (const e of sobra) {
      const vaga = saida.find((x) => !x.info && !x.processos && !docDe(e.info));
      if (vaga) { vaga.info = e.info; vaga.processos = e.processos; }
      else saida.push({ parte: { nome: "", doc: docDe(e.info) }, info: e.info, processos: e.processos });
    }
    return saida;
  }

  /* ═══ LEITURA DAS RESPOSTAS ═══ */
  /* situacao: com_resultado | sem_resultado | erro | andamento | sem_resposta */
  function interpretarFonte(cap) {
    if (!cap) return { situacao: "sem_resposta", itens: [], colunas: [], mensagem: "" };
    if (!(cap.status >= 200 && cap.status < 300) || !cap.json || typeof cap.json !== "object") {
      return { situacao: "erro", itens: [], colunas: [], mensagem: `HTTP ${cap.status}${mensagemDe(cap.json)}` };
    }
    const j = cap.json;
    const itens = Array.isArray(j.result) ? j.result : [];
    const colunas = colunasDe(j.fields, itens);
    const extra = j.extra || {};
    const ed = j.extra_data || {};
    if (extra.error_msg && !itens.length) return { situacao: "erro", itens, colunas, mensagem: String(extra.error_msg) };
    if (ed.on_going && !itens.length) return { situacao: "andamento", itens, colunas, mensagem: String(ed.status_msg || "") };
    if (itens.length) {
      return { situacao: "com_resultado", itens, colunas,
        mensagem: ed.on_going ? String(ed.status_msg || "pesquisa ainda em andamento") : (extra.error_msg ? String(extra.error_msg) : "") ,
        parcial: !!(ed.on_going || extra.error_msg) };
    }
    return { situacao: "sem_resultado", itens, colunas, mensagem: "" };
  }

  function colunasDe(fields, itens) {
    let cols = (Array.isArray(fields) ? fields : [])
      .filter((f) => f && f.name && !CAMPO_OCULTO.test(f.name) && !TITULO_OCULTO.test(String(f.title || "")));
    const naTabela = cols.filter((f) => f.show_in_table);
    if (naTabela.length) cols = naTabela;
    if (!cols.length && itens.length) {
      cols = Object.keys(itens[0] || {}).filter((k) => !CAMPO_OCULTO.test(k)).map((k) => ({ name: k, title: k }));
    }
    return cols.map((f) => ({ name: String(f.name), title: String(f.title || f.name) }));
  }

  function valorTexto(v) {
    if (v == null || v === "") return "—";
    if (typeof v === "boolean") return v ? "Sim" : "Não";
    if (Array.isArray(v)) return v.length ? v.map(valorTexto).join("; ") : "—";
    if (typeof v === "object") {
      return Object.keys(v).filter((k) => !CAMPO_OCULTO.test(k)).map((k) => `${k}: ${valorTexto(v[k])}`).join(", ") || "—";
    }
    return String(v).replace(/\s+/g, " ").trim();
  }

  function mensagemDe(json) {
    if (!json || typeof json !== "object") return "";
    const m = json.detail || json.message || json.error || json.erro || json.mensagem;
    return m ? ` — "${String(typeof m === "string" ? m : JSON.stringify(m)).slice(0, 200)}"` : "";
  }

  function resumoCurto(f) {
    switch (f.situacao) {
      case "com_resultado": return `${f.itens.length} resultado${f.itens.length === 1 ? "" : "s"}${f.parcial ? " (parcial)" : ""}`;
      case "sem_resultado": return "nenhum resultado";
      case "erro": return "erro da fonte";
      case "andamento": return "em andamento";
      default: return "sem resposta";
    }
  }

  /* ═══ OS DOIS PDFs ═══ */
  function montarRelatorio(d) {
    const L = ["",
      `Processo: ${d.numProcesso}`,
      `Investigação no SNIPER: nº ${d.id}` + (d.criadaEm ? ` (criada em ${dataHoraDe(d.criadaEm)})` : ""),
      `Data e hora da consulta: ${dataBR(d.consultaEm)} ${hm(d.consultaEm)}`,
      "", `Pessoas investigadas (${d.investigadas.length}):`];
    d.investigadas.forEach((p, i) => L.push(`${i + 1}) ${p.nome ? p.nome + " - " : ""}CPF/CNPJ ${formatarDoc(p.doc)}`));
    if (d.cadastros && d.cadastros.length) {
      L.push("", "DADOS CADASTRAIS (Receita Federal) E PROCESSOS DAS PARTES, conforme exibidos pelo SNIPER");
      d.cadastros.forEach((c, i) => {
        const p = c.parte || {};
        L.push(`${i + 1}) ${p.nome ? p.nome + " - " : ""}CPF/CNPJ ${formatarDoc(p.doc)}`);
        if (!c.info) L.push("   (dados cadastrais não obtidos do SNIPER)");
        else {
          for (const k of Object.keys(c.info)) {
            const v = c.info[k];
            if (k === "extra" && (!v || (typeof v === "object" && !Object.keys(v).length))) continue;
            L.push(`   ${k}: ${valorTexto(v)}`);
          }
        }
        const pr = c.processos;
        if (!pr) { L.push("   Processos em nome da parte: não obtidos do SNIPER."); return; }
        if (pr.erro) { L.push(`   Processos em nome da parte: o SNIPER retornou erro (${pr.erro}).`); return; }
        const parcial = pr.total != null && pr.itens.length < pr.total;
        L.push(`   PROCESSOS EM NOME DA PARTE (${parcial ? `${pr.itens.length} de ${pr.total}` : pr.itens.length}):`);
        if (!pr.itens.length) L.push("   nenhum.");
        pr.itens.forEach((x, k) => {
          const partes = [x.numero || "(sem número)", x.tribunal, x.classe, x.assunto ? `Assunto: ${x.assunto}` : "",
            x.movimento ? `Último movimento: ${x.movimento}` : ""].filter(Boolean);
          L.push(`   ${k + 1}) ${partes.join(" — ")}`);
        });
        if (parcial) L.push(`   (o SNIPER informou ${pr.total} processos; foram obtidos ${pr.itens.length}.)`);
      });
    }
    for (const f of d.fontes) {
      L.push("", `${f.rotulo.toUpperCase()} — ${resumoCurto(f)}`);
      if (f.situacao === "erro") L.push(`  A fonte retornou erro: ${f.mensagem || "(sem mensagem)"}.`);
      if (f.situacao === "andamento") L.push(`  Pesquisa em andamento no momento da consulta${f.mensagem ? ` ("${f.mensagem}")` : ""}.`);
      if (f.situacao === "sem_resposta") L.push("  O SNIPER não apresentou o resultado desta fonte até o momento da consulta.");
      if (f.situacao === "sem_resultado") L.push("  Nenhum registro encontrado.");
      if (f.parcial && f.mensagem) L.push(`  Observação do SNIPER: ${f.mensagem}.`);
      f.itens.forEach((it, i) => {
        f.colunas.forEach((c, k) => {
          L.push(`  ${k === 0 ? `${i + 1})` : "  "} ${c.title}: ${valorTexto(it ? it[c.name] : null)}`);
        });
        if (!f.colunas.length) L.push(`  ${i + 1}) ${valorTexto(it)}`);
      });
    }
    if (d.naoConsultadas.length) {
      L.push("", `Fontes não consultadas, por configuração do(a) usuário(a): ${d.naoConsultadas.map(rotuloFonte).join("; ")}.`);
    }
    L.push("", "Relatório gerado pelo CRATOS a partir dos dados exibidos pelo SNIPER no momento da consulta. " +
      "O grafo de vínculos não é reproduzido.");
    return L;
  }

  function montarCertidao(d, nomeRelatorio) {
    const quando = `${dataBR(d.consultaEm)}, às ${hm(d.consultaEm)}`;
    const L = ["",
      `Certifico e dou fé que, nesta data (${quando}), realizei investigação patrimonial no Sistema Nacional ` +
      `de Investigação Patrimonial e Recuperação de Ativos (SNIPER), do Conselho Nacional de Justiça, no ` +
      `processo nº ${d.numProcesso}, registrada no SNIPER sob o nº ${d.id}, com o resultado abaixo.`,
      "", `Pessoas investigadas (${d.investigadas.length}):`];
    d.investigadas.forEach((p, i) => L.push(`${i + 1}) ${p.nome ? p.nome + " - " : ""}CPF/CNPJ ${formatarDoc(p.doc)}`));
    L.push("", "Fontes consultadas e resultado:");
    d.fontes.forEach((f, i) => {
      let t;
      switch (f.situacao) {
        case "com_resultado":
          t = `${f.itens.length} registro${f.itens.length === 1 ? "" : "s"} encontrado${f.itens.length === 1 ? "" : "s"}` +
            (f.parcial && f.mensagem ? ` (o SNIPER indicou: "${f.mensagem}")` : "") + ".";
          break;
        case "sem_resultado": t = "nenhum registro encontrado."; break;
        case "erro":
          t = `a fonte retornou erro${f.mensagem ? ` ("${f.mensagem}")` : ""}; a consulta a esta fonte não pôde ser concluída.`;
          break;
        case "andamento":
          t = `pesquisa em andamento no momento da consulta${f.mensagem ? ` ("${f.mensagem}")` : ""}, sem resultado disponível.`;
          break;
        default: t = "o SNIPER não apresentou o resultado desta fonte até o momento da consulta.";
      }
      L.push(`${i + 1}) ${f.rotulo}: ${t}`);
    });
    if (d.naoConsultadas.length) {
      L.push("", `Fontes não consultadas, por configuração do(a) usuário(a): ${d.naoConsultadas.map(rotuloFonte).join("; ")}.`);
    }
    if (d.naoListadas.length) {
      L.push("", "Partes indicadas para a diligência que não constavam do polo passivo apresentado pelo SNIPER, e " +
        "por isso não foram investigadas: " +
        d.naoListadas.map((p) => `${p.nome ? p.nome + " - " : ""}CPF/CNPJ ${formatarDoc(p.doc)}`).join("; ") + ".");
    }
    if (d.fontes.some((f) => f.situacao === "erro" || f.situacao === "andamento" || f.situacao === "sem_resposta")) {
      L.push("", "As fontes com erro ou em andamento não tiveram resultado disponível até o momento desta certidão.");
    }
    L.push("", `O detalhamento dos registros encontrados consta do relatório anexo (${String(nomeRelatorio).split("/").pop()}), ` +
      "elaborado a partir dos dados exibidos pelo SNIPER no momento da consulta.");
    const temInfo = d.cadastros && d.cadastros.some((c) => c.info);
    const temProc = d.cadastros && d.cadastros.some((c) => c.processos && !c.processos.erro);
    if (temInfo || temProc) {
      L.push("", (temInfo && temProc
        ? "Os dados cadastrais das partes investigadas, conforme a Receita Federal, e os processos em nome delas, "
        : temInfo ? "Os dados cadastrais das partes investigadas, conforme a Receita Federal, "
          : "Os processos em nome das partes investigadas, ") +
        "tal como exibidos pelo SNIPER, também constam do relatório anexo.");
    }
    L.push("", `O grafo de vínculos não foi reproduzido; pode ser consultado no próprio SNIPER, investigação nº ${d.id}.`);
    L.push("", `A investigação foi iniciada pelo CRATOS, a pedido do(a) responsável por este ato` +
      (d.iniciadaEm ? `, em ${dataHoraDe(d.iniciadaEm)}` : "") + ". Nenhuma medida de constrição foi solicitada.");
    L.push("", "Era o que me cumpria certificar.");
    return L;
  }

  async function enviarPdf(est, titulo, linhas, filename, detalhe) {
    await browser.runtime.sendMessage({
      tipo: "fabricar_pdf",
      convenio: "SNIPER",
      numProcesso: est.numProcesso,
      operacao: "consulta",
      detalhe,
      titulo,
      linhas,
      filename,
    }).catch(() => { /* Promise rejeita no FF mesmo baixando; presunção de sucesso */ });
  }

  /* ═══ ESTADO, FAIXA, UTILITÁRIOS ═══ */
  async function aguardar(cond, ms, aCada) {
    const passos = Math.max(1, Math.ceil(ms / PASSO_MS));
    for (let i = 0; i <= passos; i++) {
      let r = null;
      try { r = cond(); } catch (e) { r = null; }
      if (r) return r;
      if (aCada && i % 10 === 0) { try { aCada(); } catch (e) { /* nada */ } }
      if (i < passos) await io.esperar(PASSO_MS);
    }
    return null;
  }
  async function salvar(est, patch) {
    const novo = Object.assign({}, est, patch, { abertoEm: new Date(io.agora()).toISOString() });
    Object.assign(est, novo);
    await Store.set("sniper_estado", novo);
    return novo;
  }
  async function encerrarSemCertidao(est, motivo) {
    await salvar(est, { ativo: false, fase: "sem_certidao", motivo });
    try {
      await Store.set("orq_conv_feito", {
        convenio: "SNIPER", numProcesso: est.numProcesso, operacao: "consulta",
        ok: false, feitos: 0, esperados: 2, motivo, em: io.agora(),
      });
    } catch (e) { /* nada */ }
    tirarCortina();
    CratosFaixa.mostrar("sniper", `${motivo}.`, "#facc15");
  }
  function falhar(est, e) {
    const msg = String((e && e.message) || e);
    pararDeOuvir();
    tirarCortina();
    CratosFaixa.parar("sniper", msg + " Nenhuma certidão foi gerada.");
    if (est) {
      Store.set("sniper_estado", Object.assign({}, est, { ativo: false, fase: "erro", erro: msg })).catch(() => {});
      Store.set("orq_conv_feito", {
        convenio: "SNIPER", numProcesso: est.numProcesso, operacao: "consulta",
        ok: false, feitos: 0, esperados: 2, motivo: msg, em: io.agora(),
      }).catch(() => {});
    }
  }
  function avisar(t) { return CratosFaixa.mostrar("sniper", t, "#facc15"); }
  function cortina() { try { if (typeof CratosOverlay !== "undefined") CratosOverlay.mostrar(AVISO_CORTINA); } catch (e) { /* nada */ } }
  function tirarCortina() { try { if (typeof CratosOverlay !== "undefined") CratosOverlay.esconder(); } catch (e) { /* nada */ } }

  function digitos(s) { return String(s == null ? "" : s).replace(/\D/g, ""); }
  function formatarProcesso(d) {
    const x = digitos(d);
    return x.length === 20 ? x.replace(/(\d{7})(\d{2})(\d{4})(\d)(\d{2})(\d{4})/, "$1-$2.$3.$4.$5.$6") : x;
  }
  function formatarDoc(d) {
    const x = digitos(d);
    if (x.length === 11) return x.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
    if (x.length === 14) return x.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
    return x || "(sem documento)";
  }
  function doisPrimeiros(nome) {
    return String(nome || "").trim().split(/\s+/).slice(0, 2).join(" ").replace(/[/\\:*?"<>|]/g, "");
  }
  function pasta(est) {
    return String(((est.config || {}).pasta) || "CRATOS").replace(/[\\:*?"<>|]/g, "").trim() || "CRATOS";
  }
  const p2 = (n) => String(n).padStart(2, "0");
  function dataBR(d) { return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`; }
  function hm(d) { return `${p2(d.getHours())}:${p2(d.getMinutes())}`; }
  function dataHoraDe(iso) {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? String(iso) : `${dataBR(d)} ${hm(d)}`;
  }
  function cssEsc(s) {
    return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  /* Ganchos de teste (jsdom). */
  if (typeof window !== "undefined") {
    window.__cratosSniper = {
      io, processar, capturas, interpretarFonte, colunasDe, valorTexto, montarRelatorio, montarCertidao,
      clicarSeguro, ajustarFontes, formatarProcesso, casarCadastros, normalizarProcesso, paginaProcessos,
    };
  }
})();
