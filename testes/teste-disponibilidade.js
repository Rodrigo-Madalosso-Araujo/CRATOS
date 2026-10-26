/*
 * teste-disponibilidade.js — certidão de INDISPONIBILIDADE de convênio (1.9.0).
 *
 * Certidão de ESTADO, sempre com confirmação humana. Trava:
 *  1. Medição: só 502/503/504, sem conexão e sem resposta contam como falha; 500,
 *     401/403, 404, 200 e redirecionamento = "respondeu" (nada a certificar); para na
 *     1ª resposta; 3 tentativas com 10 s; PJe como CONTROLE (PJe fora = não certifica);
 *     sem cookies e sem seguir redirecionamento; só endereços já permitidos no manifest.
 *  2. Certidão: só de medição "indisponível"; relato objetivo (tentativas, controle,
 *     origem, confirmação humana), sem afirmar causa; nome no padrão CRATOS/.
 *  3. Painel: botão "Verificar disponibilidade" → resultado; certidão só no clique de
 *     confirmação.
 *  4. Fila: convênio sem resposta → mede sozinho; indisponível → oferece; a confirmação
 *     ENCERRA o convênio (ledger "indisponível") antes de gerar a certidão e a fila
 *     segue. Falha/pulo → mede no fundo e o relatório oferece a certidão.
 * Reprova a 1.8.7 (não há verificação de disponibilidade).
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { montarPainel } = require("./harness-painel.js");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const NOME = "teste-disponibilidade.js";
const oks = [], falhas = [];
const checar = (c, d) => (c ? oks : falhas).push(d);
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 30));
async function ate(cond, ms) { const t0 = Date.now(); while (Date.now() - t0 < (ms || 3000)) { try { if (cond()) return true; } catch (e) { /* nada */ } await tick(10); } return false; }
const NUM = "0000001-23.2025.5.18.0008";
const T0 = Date.parse("2026-10-22T14:00:00-03:00");

if (!fs.existsSync(path.join(SRC, "modulos", "disponibilidade.js"))) {
  console.log(`\n=== ${NOME} ===\n  FALHA  a versão em ${SRC} não tem a verificação de disponibilidade (modulos/disponibilidade.js).\n\n0 passaram — a suíte inteira reprova nesta versão.\n`);
  process.exit(1);
}

function modulo(roteiro) {
  const ctx = { console: { log() {}, warn() {}, error() {} }, URL, AbortController, setTimeout, clearTimeout, Date };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(SRC, "modulos", "disponibilidade.js"), "utf8") +
    "\nglobalThis.__M = ModuloDisponibilidade; globalThis.__A = DISPONIBILIDADE_ALVOS; globalThis.__C = DISPONIBILIDADE_CONTROLE;", ctx);
  const M = ctx.__M;
  const chamadas = [], esperas = [];
  let agora = T0;
  M.io = {
    agora: () => agora,
    esperar: async (ms) => { esperas.push(ms); agora += ms; },
    fetch: async (url, o) => {
      chamadas.push({ url, o });
      agora += 400;
      const passo = (roteiro[url.startsWith(ctx.__C) ? "pje" : "alvo"] || []).shift();
      if (passo instanceof Error) throw passo;
      return passo;
    },
  };
  return { M, chamadas, esperas, A: ctx.__A, C: ctx.__C };
}
const resp = (status, statusText, type) => ({ status, statusText: statusText || "", type: type || "basic" });
const erroRede = () => new TypeError("NetworkError when attempting to fetch resource.");
const abortado = () => { const e = new Error("aborted"); e.name = "AbortError"; return e; };

(async () => {
  /* ── 1. medição ────────────────────────────────────────────────────────── */
  {
    const t = modulo({ alvo: [resp(503, "Service Unavailable"), resp(502, "Bad Gateway"), erroRede()], pje: [resp(200, "OK")] });
    const m = await t.M.medir("RENAJUD");
    checar(m.ok && m.conclusao === "indisponivel" && m.tentativas.length === 3 && m.tentativas.every((x) => x.falhou) && m.controle && m.controle.ok,
      "503, 502 e sem conexão nas 3 tentativas + PJe respondendo = INDISPONÍVEL");
    checar(t.esperas.join(",") === "10000,10000" && t.chamadas.length === 4 && t.chamadas[3].url === t.C, "3 tentativas com 10 s de intervalo, depois o PJe (controle)");
    checar(t.chamadas.every((c) => c.o.credentials === "omit" && c.o.redirect === "manual" && c.o.cache === "no-store"),
      "⛔ medição sem cookies e sem seguir redirecionamento (não toca em sessão nem em outro domínio)");
    checar(/HTTP 503 Service Unavailable/.test(m.tentativas[0].mensagem) && /falha de conexão/.test(m.tentativas[2].mensagem) && m.host === "renajud.pdpj.jus.br",
      "cada tentativa anota a mensagem (código ou falha de conexão) e o endereço");
  }
  {
    const t = modulo({ alvo: [resp(503), resp(200, "OK")] });
    const m = await t.M.medir("CNIB");
    checar(m.conclusao === "respondeu" && m.tentativas.length === 2 && !m.controle, "respondeu na 2ª tentativa: para de insistir e não certifica");
  }
  for (const [st, nome] of [[500, "500"], [401, "401"], [403, "403"], [404, "404"]]) {
    const t = modulo({ alvo: [resp(st)] });
    const m = await t.M.medir("SNIPER");
    checar(m.conclusao === "respondeu" && m.tentativas.length === 1, `⛔ HTTP ${nome} = o sistema RESPONDEU (fica na faixa, nunca certidão de indisponibilidade)`);
  }
  {
    const t = modulo({ alvo: [resp(0, "", "opaqueredirect")] });
    const m = await t.M.medir("PREVJUD");
    checar(m.conclusao === "respondeu" && /redirecionou/.test(m.tentativas[0].mensagem), "redirecionamento para o login = respondeu");
  }
  {
    const t = modulo({ alvo: [abortado(), abortado(), abortado()], pje: [erroRede()] });
    const m = await t.M.medir("CCS");
    checar(m.conclusao === "controle_falhou" && /sem resposta em 15 segundos/.test(m.tentativas[0].mensagem),
      "⛔ convênio E PJe fora do ar: pode ser a rede da unidade — NÃO certifica");
  }
  {
    const t = modulo({});
    checar((await t.M.medir("SAB")).ok === false, "convênio sem verificação: recusa com motivo");
    const man = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8"));
    const casa = (url) => man.permissions.some((p) => {
      if (!/^https:\/\//.test(p)) return false;
      const rx = new RegExp("^https://" + p.slice(8).replace(/[.]/g, "\\.").replace(/\*/g, ".*") + "$");
      return rx.test(url);
    });
    const painel = fs.readFileSync(path.join(SRC, "conteudo", "painel.js"), "utf8");
    const ids = JSON.parse((painel.match(/const DISP_IDS = (\[[^\]]*\])/) || [])[1] || "[]");
    checar(ids.length === 8 && ids.every((id) => t.A[id]) && Object.values(t.A).every((a) => casa(a.url)) && casa(t.C),
      "⛔ todo endereço medido já tem permissão no manifest (nenhuma permissão nova) e cobre os convênios do painel");
  }

  /* ── 2. certidão ───────────────────────────────────────────────────────── */
  {
    const t = modulo({ alvo: [resp(503, "Service Unavailable"), resp(503, "Service Unavailable"), resp(504, "Gateway Timeout")], pje: [resp(200)] });
    const m = await t.M.medir("SERASAJUD");
    let fab = null;
    const r = await t.M.certidao({ idMedicao: m.id, numProcesso: NUM, origem: "fila" }, (o) => { fab = o; return { ok: true, filename: o.filename }; });
    const txt = (fab && fab.linhas || []).join("\n");
    checar(r.ok && fab.filename === "CRATOS/00000012320255180008_SERASAJUD indisponibilidade certidao.pdf" && fab.convenio === "SERASAJUD" &&
      fab.operacao === "indisponibilidade" && /INDISPONIBILIDADE DE SISTEMA CONVENIADO/.test(fab.titulo), "certidão: nome no padrão CRATOS/, convênio e operação no diário");
    checar(/processo nº 0000001-23\.2025\.5\.18\.0008/.test(txt) && /3 tentativa\(s\) de acesso ao endereço serasa-judicial\.serasaexperian\.com\.br, entre \d\d:\d\d:\d\d e \d\d:\d\d:\d\d/.test(txt) &&
      /- \d\d:\d\d:\d\d: HTTP 504 Gateway Timeout\./.test(txt) && /o PJe deste Tribunal respondeu normalmente \(verificação de controle\)/.test(txt),
      "certidão: relato objetivo — tentativas com hora e retorno, e o controle do PJe");
    checar(/detectada pelo CRATOS durante a execução dos convênios e confirmada pelo\(a\) responsável/.test(txt) && /deverá ser repetida oportunamente/.test(txt),
      "certidão: rastro (detectado pelo CRATOS, confirmado pelo responsável) e repetição da diligência");
    checar(!/(causa|culpa|instabilidade|falha do servidor|por motivo)/i.test(txt), "⛔ certidão não afirma causa");
    let fab2 = null;
    await t.M.certidao({ idMedicao: m.id, numProcesso: NUM, origem: "botao" }, (o) => { fab2 = o; return { ok: true }; });
    checar(/a pedido do\(a\) responsável por este ato, que confirmou o resultado/.test(fab2.linhas.join("\n")), "certidão pelo botão: \"a pedido do(a) responsável\"");
  }
  {
    const t = modulo({ alvo: [resp(200)] });
    const m = await t.M.medir("CENSEC");
    let chamou = false;
    const r = await t.M.certidao({ idMedicao: m.id, numProcesso: NUM }, () => { chamou = true; return { ok: true }; });
    checar(r.ok === false && !chamou, "⛔ sem medição \"indisponível\" (o sistema respondeu), NÃO gera certidão");
    const forjada = { ok: true, id: "x1", convenio: "../../X", rotulo: "X", host: "x", conclusao: "indisponivel", controle: { hora: new Date().toISOString(), ok: true },
      tentativas: [{ hora: new Date().toISOString(), mensagem: "HTTP 503", falhou: true }] };
    const r3 = await t.M.certidao({ medicao: forjada, idMedicao: "x1", numProcesso: NUM }, () => { chamou = true; return { ok: true }; });
    checar(r3.ok === false && !chamou && /Medição não encontrada/.test(r3.motivo),
      "⛔ medição que NÃO foi feita pelo fundo (forjada/enviada pelo painel) não vira certidão");
  }
  {
    const bg = fs.readFileSync(path.join(SRC, "background.js"), "utf8");
    const man = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8"));
    checar(/case "medir_disponibilidade":\s*return ModuloDisponibilidade\.medir\(msg\.convenioId\)/.test(bg) &&
      /case "certidao_indisponibilidade":\s*return ModuloDisponibilidade\.certidao\(msg, fabricarCertidaoTexto\)/.test(bg) &&
      man.background.scripts.includes("modulos/disponibilidade.js"), "fundo: rotas de medição e certidão; módulo no manifest");
    checar(/tipo: "indisponibilidade",\s*titulo: "Sistemas indisponíveis",\s*operacoes: \["indisponibilidade"\]/.test(bg) &&
      /não estavam disponíveis no momento da diligência/.test(bg),
      "⛔ juntada: a certidão de indisponibilidade tem família própria (é oferecida e marcada como juntada; nunca \"foram realizados\")");
  }

  /* ── 3. painel: botão ──────────────────────────────────────────────────── */
  const MED_INDISP = { ok: true, id: "med-1", convenio: "RENAJUD", rotulo: "RENAJUD", host: "renajud.pdpj.jus.br", conclusao: "indisponivel",
    medidoEm: "2026-10-22T17:00:40.000Z", controle: { hora: "2026-10-22T17:00:41.000Z", ok: true, mensagem: "HTTP 200" },
    tentativas: [{ hora: "2026-10-22T17:00:00.000Z", mensagem: "HTTP 503 Service Unavailable", falhou: true },
      { hora: "2026-10-22T17:00:20.000Z", mensagem: "HTTP 503 Service Unavailable", falhou: true },
      { hora: "2026-10-22T17:00:40.000Z", mensagem: "falha de conexão (o servidor não respondeu)", falhou: true }] };
  const MED_OK = { ok: true, convenio: "RENAJUD", rotulo: "RENAJUD", host: "renajud.pdpj.jus.br", conclusao: "respondeu",
    medidoEm: "2026-10-22T17:00:00.000Z", controle: null, tentativas: [{ hora: "2026-10-22T17:00:00.000Z", mensagem: "HTTP 200 OK", falhou: false }] };
  const abrir = async (medicao) => {
    const a = montarPainel(SRC, { responder: (msg) => {
      if (msg.tipo === "medir_disponibilidade") return Object.assign({}, medicao, { convenio: msg.convenioId });
      if (msg.tipo === "certidao_indisponibilidade") return { ok: true, filename: "CRATOS/x_RENAJUD indisponibilidade certidao.pdf" };
      return undefined;
    } });
    a.P.setProcesso({ numero: NUM, id: 1 });
    a.P.setPartes([{ nome: "FULANO DE TAL", cpfcnpj: "123.456.789-09", polo: "PASSIVO" }]);
    a.P.renderModoSelecao();
    await tick();
    return a;
  };
  {
    const a = await abrir(MED_INDISP);
    const sel = a.d.getElementById("cx-disp-conv");
    checar(sel && sel.options.length === 8 && a.d.getElementById("cx-disp-verificar"), "painel: \"Verificar disponibilidade do convênio\" com os 8 convênios");
    sel.value = "RENAJUD";
    a.d.getElementById("cx-disp-verificar").click();
    await ate(() => a.d.querySelector("#cx-disp-status .cx-disp-gerar"));
    const st = a.d.getElementById("cx-disp-status");
    checar(/não respondeu em 3 tentativa/.test(st.textContent) && /HTTP 503/.test(st.textContent) && !a.msgs.some((m) => m.tipo === "certidao_indisponibilidade"),
      "botão: mostra a medição e OFERECE a certidão — nada é gerado sem confirmação");
    st.querySelector(".cx-disp-gerar").click();
    await ate(() => /Certidão de indisponibilidade gerada/.test(st.textContent));
    const c = a.msgs.find((m) => m.tipo === "certidao_indisponibilidade");
    checar(c && c.origem === "botao" && c.numProcesso === NUM && c.idMedicao === "med-1" && !c.medicao, "confirmação: pede a certidão pelo identificador da medição (origem \"botão\", com o processo)");
  }
  {
    const a = await abrir(MED_OK);
    a.d.getElementById("cx-disp-verificar").click();
    await ate(() => /Nada a certificar/.test(a.d.getElementById("cx-disp-status").textContent));
    checar(!a.d.querySelector(".cx-disp-gerar"), "convênio respondeu: \"respondeu às HH:MM… Nada a certificar\", sem botão de certidão");
  }

  /* ── 4. fila ───────────────────────────────────────────────────────────── */
  const RENAJUD = { id: "RENAJUD", label: "RENAJUD", tipo: "interativo", ops: ["inclusao", "baixa"] };
  const CCS = { id: "CCS", label: "CCS (Bacen — relacionamentos)", tipo: "interativo", ops: ["consulta"] };
  const fila = async (convs, medicao) => {
    const a = montarPainel(SRC, { responder: (msg) => {
      if (msg.tipo === "medir_disponibilidade") return Object.assign({}, medicao, { convenio: msg.convenioId });
      if (msg.tipo === "certidao_indisponibilidade") return { ok: true, filename: "CRATOS/x indisponibilidade certidao.pdf" };
      return undefined;
    } });
    a.P.tempos.vigiaMs = 40;
    a.P.setProcesso({ numero: NUM, id: 1 });
    a.P.setModo("inclusao");
    a.d.querySelector(".cx-corpo").innerHTML = '<div id="cx-progresso"></div>';
    a.P.fila = convs; a.P.idx = 0; a.P.ledger = [];
    a.P.renderProgresso();
    await a.P.rodarProximoConvenio({ idProcesso: 1, numeroProcesso: NUM, base: "https://pje.trt18.jus.br", partes: [{ nome: "FULANO" }], xsrfToken: "" });
    return a;
  };
  {
    const a = await fila([RENAJUD, CCS], MED_INDISP);
    await ate(() => a.d.querySelector(".cx-disp-fila .cx-disp-gerar"), 3000);
    const caixa = a.d.querySelector(".cx-disp-fila");
    checar(caixa && a.P.idx === 0 && /Indisponível/.test(a.d.getElementById("cx-prog-RENAJUD").textContent),
      "fila: convênio sem resposta → o CRATOS mede sozinho e marca \"indisponível\", oferecendo a certidão (a fila espera)");
    caixa.querySelector(".cx-disp-gerar").click();
    await ate(() => a.msgs.some((m) => m.tipo === "certidao_indisponibilidade") && a.P.idx >= 1);
    const iFecha = a.msgs.findIndex((m) => m.tipo === "orq_fechar_aba" && m.convenioId === "RENAJUD");
    const iCert = a.msgs.findIndex((m) => m.tipo === "certidao_indisponibilidade");
    const e = a.P.ledger.find((x) => x.id === "RENAJUD");
    checar(e && e.status === "indisponivel" && iFecha >= 0 && iFecha < iCert && a.P.idx >= 1 &&
      a.msgs.some((m) => m.tipo === "orquestra_executar" && m.convenioId === "CCS"),
      "⛔ a confirmação ENCERRA o convênio (\"indisponível\") ANTES de gerar a certidão, e a fila segue");
    checar(a.msgs[iCert].origem === "fila", "certidão da fila: origem \"fila\"");
  }
  {
    const a = await fila([RENAJUD], MED_OK);
    await tick(250);
    checar(!a.d.querySelector(".cx-disp-gerar") && /Aguardando conclusão/.test(a.d.getElementById("cx-prog-RENAJUD").textContent) &&
      a.msgs.some((m) => m.tipo === "medir_disponibilidade"), "fila: mediu e o sistema respondeu → volta a aguardar, sem certidão");
  }
  {
    const a = await fila([CCS], MED_INDISP);
    a.P.tempos.vigiaMs = 100000;
    await a.w.Store.set("orq_conv_feito", { convenio: "CCS", numProcesso: NUM, ok: false, feitos: 0, motivo: "erro", em: Date.now() + 1000 });
    await ate(() => a.d.querySelector("#cx-relatorio .cx-disp-gerar"), 3000);
    const rel = a.d.getElementById("cx-relatorio");
    checar(rel && /o sistema estava indisponível/.test(rel.textContent) && rel.querySelector(".cx-disp-gerar"),
      "fila: convênio que FALHOU → mede no fundo; indisponível → o relatório final oferece a certidão");
  }

  console.log(`\n=== ${NOME} ===`);
  oks.forEach((d) => console.log("  ok   " + d));
  falhas.forEach((d) => console.log("  FALHA " + d));
  console.log(`\n${oks.length} passaram, ${falhas.length} falharam (${oks.length + falhas.length} asserções)\n`);
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.log("FALHA geral: " + e.stack); process.exit(1); });
