/*
 * demo/demo-simulado.js — MODO DE DEMONSTRAÇÃO (2.0).
 *
 * Para testar o painel com o leitor de tela sem convênio, sem processo real e sem
 * dado de ninguém. Esta página da extensão carrega o painel.js DE VERDADE, mas por
 * trás dele põe um `browser` simulado:
 *
 *   - storage em memória (some ao fechar a aba; o storage da pessoa nem é lido,
 *     exceto o tema escolhido, só para a demonstração abrir com a mesma aparência);
 *   - um "fundo" de mentira que responde às mensagens do painel com estados
 *     fictícios (a fila anda sozinha, as coletas devolvem respostas inventadas);
 *   - um fetch de mentira para o SAB e a linha do tempo do PJe. O fetch de verdade
 *     NUNCA é chamado: qualquer outro endereço recebe uma recusa local.
 *
 * Nenhuma mensagem chega ao fundo real, exceto as duas que não mexem em dado:
 * abrir as Preferências e o atalho Alt+Shift+C, que o fundo repassa para cá.
 * Se não der para isolar o `browser`, o painel NÃO é carregado.
 */
(function () {
  "use strict";
  const real = (typeof browser !== "undefined") ? browser : null;
  const erro = (t) => { const el = document.getElementById("demo-erro"); if (el) { el.textContent = t; el.hidden = false; } };

  /* ── o processo fictício ───────────────────────────────────────────────── */
  const NUM = "0001234-56.2026.5.18.0099";
  const DIG = NUM.replace(/\D/g, "");
  const PROC = {
    id: 1, idProcesso: 1, numero: NUM,
    partes: [
      { nome: "EXEQUENTE EXEMPLO DA SILVA", cpfcnpj: "11122233396", polo: "ATIVO", tipoPessoa: "fisica" },
      { nome: "EMPRESA EXEMPLO LTDA", cpfcnpj: "11222333000181", polo: "PASSIVO", tipoPessoa: "juridica" },
      { nome: "SÓCIO EXEMPLO", cpfcnpj: "44455566610", polo: "PASSIVO", tipoPessoa: "fisica" },
    ],
  };
  /* Segundo processo fictício, com 150 partes (Rodrigo, 17/11: há ações com cem partes
     ou mais), para testar a janela "Escolher partes". Documentos inventados, sem dígito
     verificador válido. */
  const NUM2 = "0009876-54.2026.5.18.0099";
  const PROC2 = { id: 2, idProcesso: 2, numero: NUM2, partes: [] };
  const NOMES = ["ALVES", "BARBOSA", "CARDOSO", "DIAS", "ESTEVES", "FARIAS", "GOMES", "HOLANDA", "IGNACIO", "JARDIM"];
  for (let i = 1; i <= 150; i++) {
    const n = String(i).padStart(3, "0");
    const ativo = i <= 4;
    const pj = !ativo && i % 5 === 0;
    PROC2.partes.push({
      nome: ativo ? `EXEQUENTE EXEMPLO ${n} ${NOMES[i % 10]}` : pj ? `EMPRESA EXEMPLO ${n} ${NOMES[i % 10]} LTDA` : `EXECUTADO EXEMPLO ${n} ${NOMES[i % 10]}`,
      cpfcnpj: pj ? "900000" + String(i).padStart(8, "0") : "900" + String(i).padStart(8, "0"),
      polo: ativo ? "ATIVO" : "PASSIVO", tipoPessoa: pj ? "juridica" : "fisica",
    });
  }
  const ID_DEMO = /[?&]idProcesso=2(?:&|$)/.test(location.search) ? 2 : 1;
  const DIAS = (n) => new Date(Date.now() - n * 864e5).toISOString();

  /* ── storage em memória ────────────────────────────────────────────────── */
  const mem = {
    /* sem vara do e-CAC: mostra "configuração pendente"; juntada no fim da fila sob
       pedido (mostra o "Criar no processo", que aqui só avisa que é demonstração) */
    "cratos:config": { infojud: { colheitaAutomatica: "nao" }, juntada: { automatica: "nao" } },
    ["cratos:diario:" + DIG]: { numProcesso: DIG, itens: [{ arquivo: "CRATOS/" + DIG + "_RENAJUD inclusao.pdf", convenio: "RENAJUD" }] },
  };
  const ouvintesStorage = [];
  const avisar = (changes) => ouvintesStorage.slice().forEach((f) => { try { f(changes, "local"); } catch (e) { /* nada */ } });
  const storageLocal = {
    async get(k) {
      if (k == null) return Object.assign({}, mem);
      const ks = Array.isArray(k) ? k : (typeof k === "object" ? Object.keys(k) : [k]);
      const o = {};
      ks.forEach((x) => { if (x in mem) o[x] = mem[x]; });
      return o;
    },
    async set(o) {
      const ch = {};
      for (const k of Object.keys(o)) { ch[k] = { oldValue: mem[k], newValue: o[k] }; mem[k] = o[k]; }
      avisar(ch);
    },
    async remove(k) {
      const ch = {};
      (Array.isArray(k) ? k : [k]).forEach((x) => { ch[x] = { oldValue: mem[x], newValue: undefined }; delete mem[x]; });
      avisar(ch);
    },
  };
  const gravar = (k, v) => storageLocal.set({ ["cratos:" + k]: v });

  /* ── o "fundo" de mentira ──────────────────────────────────────────────── */
  const ouvintesMsg = [];
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  async function responder(m) {
    const tipo = m && m.tipo;
    switch (tipo) {
      case "capturar": await espera(400); return { ok: true, processo: String(m.idProcesso) === "2" ? PROC2 : PROC };
      case "historico_ler":
        return { ok: true, eventos: [
          { convenio: "INFOJUD", fase: "pedido", em: DIAS(6) },
          { convenio: "CCS", fase: "pedido", em: DIAS(20) },
          { convenio: "CCS", fase: "resposta", em: DIAS(12) },
          { convenio: "SERASAJUD", fase: "inclusao", em: DIAS(9) },
        ] };
      case "diario_ler":
        return { ok: true, diario: mem["cratos:diario:" + DIG], certidoes: [
          { titulo: "Convênios realizados", convenios: ["RENAJUD"], arquivos: [DIG + "_RENAJUD inclusao.pdf"], tipo: "realizados", familia: "realizados" },
        ] };
      case "orquestra_executar": return executarFicticio(m);
      case "coletar_achar":
        await espera(700);
        return { ok: true, naoLidas: 1, totalCasadas: 1,
          solicitacao: { numSolicitacao: "0000001", numProcesso: NUM, dataEnvio: new Date(DIAS(6)).toLocaleDateString("pt-BR"), lida: false } };
      case "coletar_tudo": case "coletar_colher": await espera(600); return { ok: false, motivo: "demonstracao", erro: "modo de demonstração: nada é baixado de verdade" };
      case "ccs_coletar":
        setTimeout(() => gravar("ccs_coleta_resultado", { numProcesso: DIG, resultados: [{ numero: "2026000123", tipo: "pdf", arquivos: 2, respondidas: 3, pendentes: 2 }] }), 1800);
        return { ok: true, direto: true, requisicoes: 1 };
      case "prevjud_coletar":
        setTimeout(() => gravar("prevjud_coleta_resultado", { numProcesso: DIG, resultados: [{ nome: "SÓCIO EXEMPLO", tipo: "processando" }] }), 1800);
        return { ok: true, pedidos: 1 };
      case "medir_disponibilidade": {
        await espera(1200);
        const h = (s) => new Date(Date.now() - s * 1000).toISOString();
        return { ok: true, conclusao: "respondeu", tentativas: [{ hora: h(2), mensagem: "respondeu (HTTP 200)" }], medidoEm: h(0) };
      }
      case "abrir_preferencias":
        try { if (real) await real.runtime.openOptionsPage(); } catch (e) { /* nada */ }
        return { ok: true };
      default: return { ok: true, demonstracao: true };
    }
  }
  /* Fila: o automático (INFOJUD) "conclui" sozinho; os interativos respondem
     "aguardando" e, pouco depois, mandam o sinal de conclusão — como no de verdade. */
  async function executarFicticio(m) {
    const id = String(m.convenioId || "");
    await espera(900);
    if (id === "INFOJUD") return { ok: true };
    setTimeout(() => {
      if (id === "SAB") { gravar("sab_estado", { ativo: true }).then(() => gravar("sab_estado", null)); return; }
      gravar("orq_conv_feito", { convenio: id, numProcesso: (m.ctx && m.ctx.numeroProcesso) || NUM, ok: true, feitos: 1, esperados: 1, em: Date.now() });
    }, 2600);
    return { ok: true, aguardando: true, esperados: 1 };
  }

  /* ── fetch de mentira (SAB e linha do tempo); nunca chama a rede ──────── */
  const resp = (corpo, status) => ({ ok: !status || status < 300, status: status || 200,
    json: async () => corpo, text: async () => JSON.stringify(corpo), arrayBuffer: async () => new ArrayBuffer(0) });
  const fetchFicticio = async (url) => {
    let u;
    try { u = new URL(String(url), location.href); } catch (e) { return resp({ mensagem: "endereço inválido" }, 400); }
    const c = u.pathname;
    await espera(250);
    if (c.endsWith("/sab-api/api/processos")) return resp({ resultado: [{ id: 900, numero: DIG, idPJe: 1 }] });
    if (c.endsWith("/sab-api/api/determinacoes")) {
      return resp({ resultado: [{ id: 43999, situacao: "EM_PROCESSAMENTO", processo: { id: 900, numero: DIG, idPJe: 1 }, ultimaSituacao: { ocorridoEm: DIAS(30) } }], pagina: 1, qtdPaginas: 1 });
    }
    if (/\/sab-api\/api\/determinacoes\/\d+\/ordens$/.test(c)) {
      return resp({ resultado: [
        { id: 1, numeroProtocolo: "20260000000001", situacao: "RESPONDIDA", dataProtocolo: DIAS(2), dataUltimoProtocolo: DIAS(2), tipoOrdem: "BLOQUEIO_DE_VALOR",
          bloqueios: [{ pessoa: { nome: "EMPRESA EXEMPLO LTDA" }, valorAplicado: 1000, valorBloqueado: 150, valorTransferido: 150, contas: [] }] },
        { id: 2, numeroProtocolo: "20260000000002", situacao: "ENVIADA", dataProtocolo: DIAS(1), dataUltimoProtocolo: DIAS(1), tipoOrdem: "BLOQUEIO_DE_VALOR", bloqueios: [] },
      ], pagina: 1, qtdPaginas: 1 });
    }
    if (/\/timeline$/.test(c)) {
      return resp([{ id: 300, titulo: "Convênios realizados", tipo: "Certidão", data: DIAS(15), ativo: true,
        anexos: [{ id: 301, titulo: DIG + "_EMPRESA EXEMPLO CNIB inclusao", data: DIAS(15) }] }]);
    }
    /* Qualquer outro endereço: recusa local, com o motivo dito na tela. */
    throw new Error("modo de demonstração: nada é juntado nem consultado de verdade (nenhum dado saiu desta página).");
  };

  /* ── o browser simulado ────────────────────────────────────────────────── */
  const falso = {
    __cratosDemo: true,
    storage: { local: storageLocal, onChanged: { addListener: (f) => ouvintesStorage.push(f), removeListener: (f) => { const i = ouvintesStorage.indexOf(f); if (i >= 0) ouvintesStorage.splice(i, 1); } } },
    runtime: {
      id: "cratos-demonstracao",
      getURL: (p) => (real ? real.runtime.getURL(p) : "../" + p),
      getManifest: () => (real ? real.runtime.getManifest() : { version: "demonstração" }),
      onMessage: { addListener: (f) => ouvintesMsg.push(f), removeListener: () => {} },
      sendMessage: async (m) => responder(m),
    },
  };

  try {
    Object.defineProperty(globalThis, "browser", { value: falso, configurable: true, writable: true });
    Object.defineProperty(globalThis, "fetch", { value: fetchFicticio, configurable: true, writable: true });
  } catch (e) { /* conferido abaixo */ }
  if (globalThis.browser !== falso || globalThis.fetch !== fetchFicticio) {
    erro("Não consegui isolar o modo de demonstração neste Firefox, então o painel não foi carregado. Nada foi feito.");
    return;
  }

  /* O atalho Alt+Shift+C: o fundo de verdade repassa para esta página. */
  if (real && real.runtime && real.runtime.onMessage) {
    real.runtime.onMessage.addListener((m) => {
      if (!m || m.tipo !== "cratos_atalho") return undefined;
      for (const f of ouvintesMsg) { const r = f(m, {}); if (r !== undefined) return r; }
      return undefined;
    });
  }
  /* Fechar a aba da demonstração não pergunta nada (o "arquivo não juntado" é fictício). */
  window.addEventListener("beforeunload", (e) => { e.stopImmediatePropagation(); }, true);

  /* O painel lê o processo do endereço, como no PJe (o fundo já abre com ?idProcesso=1;
     isto cobre quem abrir a página sem ele). */
  if (ID_DEMO === 2) {
    const h1 = document.querySelector("h1");
    if (h1) h1.textContent = "Processo " + NUM2 + " (fictício, 150 partes)";
    const lp = document.getElementById("demo-partes");
    if (lp) {
      lp.textContent = "";
      const li = document.createElement("li");
      li.textContent = "4 no polo ativo e 146 no polo passivo, todas fictícias. Abra Incluir e use \"Escolher partes…\".";
      lp.appendChild(li);
    }
  }
  if (!/[?&]idProcesso=/.test(location.search)) {
    try { history.replaceState(null, "", location.pathname + "?idProcesso=1"); } catch (e) { /* nada */ }
  }
  /* Tema: o mesmo que a pessoa escolheu (só leitura). */
  const lerTema = real && real.storage && real.storage.local
    ? real.storage.local.get("cratos:aparencia").then((o) => { if (o && o["cratos:aparencia"]) mem["cratos:aparencia"] = o["cratos:aparencia"]; }).catch(() => {})
    : Promise.resolve();

  /* Os mesmos arquivos, na mesma ordem, do content_script do painel no PJe. */
  const SCRIPTS = ["comum/storage.js", "comum/relatorio.js", "comum/faixa.js", "comum/novidades.js", "comum/sab-leitura.js",
    "comum/convenios-uso.js", "comum/situacao.js", "comum/tema.js", "conteudo/painel-estilo.js", "conteudo/painel.js"];
  const carregar = (i) => {
    if (i >= SCRIPTS.length) return;
    const s = document.createElement("script");
    s.src = "../" + SCRIPTS[i];
    s.onload = () => carregar(i + 1);
    s.onerror = () => erro("Não consegui carregar " + SCRIPTS[i] + ". O painel não abriu.");
    document.body.appendChild(s);
  };
  lerTema.then(() => carregar(0));
  globalThis.__cratosDemo = { mem, responder, fetchFicticio, SCRIPTS };
})();
