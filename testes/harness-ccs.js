/*
 * harness-ccs.js — monta uma tela FICTÍCIA do CCS num jsdom e roda conteudo/ccs.js nela.
 * Usado pelas suítes teste-ccs-*.js. Não é suíte (não começa com "teste-").
 *
 * O jsdom não navega nem recarrega: o content script expõe os pontos de saída em
 * `window.__cratosCcs.io` e o harness os troca por gravadores ANTES de o fluxo começar
 * (o fluxo só anda depois do Store.get assíncrono).
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const F = require("./fixture-ccs.js");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const AGORA = Date.parse("2026-10-16T09:00:00-03:00");

function existeCcs() {
  return fs.existsSync(path.join(SRC, "conteudo", "ccs.js"));
}

function estadoBase(extra) {
  return Object.assign({
    ativo: true,
    modo: "requisicao",
    numProcesso: F.PROC_FMT,
    numeroDigitos: F.PROC,
    docs: [{ nome: "FULANO FICTICIO DA SILVA", doc: F.CPF, polo: "passivo" }],
    config: { aceitarTermo: false, envioAutomatico: false, criterio: "todas",
      esconderInativos: false, motivo: "Execução trabalhista", pasta: "CRATOS" },
    fase: "iniciado",
    abertoEm: new Date(AGORA).toISOString(),
  }, extra || {});
}

function montar(o) {
  const opts = o || {};
  const dom = new JSDOM(opts.tela, {
    url: opts.url || "https://www3.bcb.gov.br/ccs/qualquer.do?method=x",
    runScripts: "outside-only",
  });
  const w = dom.window;
  const mem = Object.assign({}, opts.mem || {});
  if (opts.estado) mem["cratos:ccs_estado"] = opts.estado;
  const r = { w, d: w.document, mem, msgs: [], faixas: [], paradas: [], nav: [], cliques: [],
    recargas: 0, baixados: [], logs: [], selecionouTodos: false };
  const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
  w.browser = {
    storage: {
      local: {
        get: async (k) => ({ [k]: clone(mem[k]) }),
        set: async (ob) => { for (const [k, v] of Object.entries(ob)) mem[k] = clone(v); },
        remove: async (k) => { delete mem[k]; },
      },
      onChanged: { addListener() {}, removeListener() {} },
    },
    runtime: {
      sendMessage: async (m) => {
        r.msgs.push(clone(m));
        if (opts.respostas && Object.prototype.hasOwnProperty.call(opts.respostas, m.tipo)) return opts.respostas[m.tipo];
        if (m.tipo === "ccs_pdf") return { ok: true, filename: `CRATOS/${F.PROC}_X_${m.doc} ${m.rotulo}.pdf` };
        return { ok: true };
      },
      getURL: (p) => "moz-extension://x/" + p,
      onMessage: { addListener() {} },
    },
  };
  w.CratosFaixa = {
    mostrar: (m, t, c) => { r.faixas.push({ t: String(t), c }); },
    parar: (m, t, op) => { r.paradas.push({ t: String(t), op }); },
    alertar() {}, dizer() {},
  };
  for (const k of ["log", "warn", "error", "debug"]) w.console[k] = (...a) => r.logs.push(a.map(String).join(" "));
  w.selecionarTodos = () => { r.selecionouTodos = true; };
  w.eval(fs.readFileSync(path.join(SRC, "comum", "storage.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(SRC, "conteudo", "ccs.js"), "utf8"));
  const api = w.__cratosCcs;
  r.api = api;
  if (api && api.io) {
    api.io.navegar = (u) => { r.nav.push(String(u)); };
    api.io.recarregar = () => { r.recargas++; };
    api.io.clicar = (el) => {
      if (opts.recusarClique && opts.recusarClique(el)) return;   // simula clique que não pega
      r.cliques.push(rotulo(el));
      if (el.type === "checkbox" || el.type === "radio") el.click();
    };
    api.io.agora = () => (opts.agora != null ? opts.agora : AGORA);
    api.io.esperar = async () => {};
    api.io.baixar = opts.baixar || (async (url) => {
      r.baixados.push(String(url));
      const b = F.PDF_BYTES;
      return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) };
    });
  }
  return r;
}

function rotulo(el) {
  if (!el) return "";
  if (el.type === "checkbox" || el.type === "radio") return `${el.type}:${el.name}:${el.value}`;
  return String(el.value || el.textContent || "").replace(/\s+/g, " ").trim();
}

async function ate(cond, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 1500)) {
    try { if (cond()) return true; } catch (e) {}
    await new Promise((res) => setTimeout(res, 10));
  }
  return false;
}
const tick = (ms) => new Promise((res) => setTimeout(res, ms || 60));

function relatorio(nome, oks, falhas) {
  console.log(`\n=== ${nome} ===`);
  oks.forEach((d) => console.log("  ok   " + d));
  falhas.forEach((d) => console.log("  FALHA " + d));
  console.log(`\n${oks.length} passaram, ${falhas.length} falharam (${oks.length + falhas.length} asserções)\n`);
  process.exit(falhas.length ? 1 : 0);
}

function reprovaSemModulo(nome) {
  console.log(`\n=== ${nome} ===`);
  console.log("  FALHA  a versão em " + SRC + " não tem o módulo CCS (conteudo/ccs.js com __cratosCcs).");
  console.log("\n0 passaram — a suíte inteira reprova nesta versão.\n");
  process.exit(1);
}

module.exports = { SRC, AGORA, F, existeCcs, estadoBase, montar, ate, tick, relatorio, reprovaSemModulo, rotulo };
