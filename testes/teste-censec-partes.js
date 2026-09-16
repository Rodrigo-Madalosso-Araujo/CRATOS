/*
 * teste-censec-partes.js — as partes de cada ato entram na certidão do CENSEC.
 *
 * Pedido do Rodrigo (16/09): na certidão do CEP, listar as partes de cada ato —
 * nome, CPF/CNPJ FORMATADO e qualidade (outorgante, outorgado…) — abaixo dos
 * dados que a certidão já traz, atrás de um checkbox nas Preferências.
 *
 * O dado não vem na busca; está em GET /api/busca-atos/cep/{atoId}/partes. O
 * content script (mundo isolado) não pode chamar isso autenticado (ARQ-516); quem
 * chama é o grampo, no contexto da página, same-origin — e CONFIRMADO no ambiente
 * real (16/09): autentica SÓ com o cookie (credentials:include + X-Subscription),
 * sem precisar montar Bearer.
 *
 * Aqui exercitamos o fluxo inteiro dentro da página (censec.js + censec-api.js):
 *  · LIGADO: a certidão lista as partes, com CPF formatado e qualidade, e o
 *    grampo chama o /partes só com o cookie (sem Authorization).
 *  · DESLIGADO (controle): não lista e nem chama o /partes (sem round-trip extra).
 *  · Partes falhando (HTTP 500): a certidão ainda é gerada, sem a seção de partes.
 *
 * Reprova a versão anterior (sem o canal de partes): lá não existe
 * __cratosCensec.fabricarCertidao e a certidão nunca lista partes.
 *
 * Rodar: node teste-censec-partes.js
 * Versão antiga: CRATOS_SRC=<pasta do xpi> node teste-censec-partes.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const falhas = [];
const oks = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 60));

const ATOS = [{
  id: "0fbe4c7a-1cd0-44cc-8a87-016d9a4d9eb1",
  data: "2008-08-27", tipo: "Escritura", qualidade: "Outorgante",
  livro: "101", folha: "161",
  cartorioNome: "1. REGISTRO CIVIL E TABELIONATO DE NOTAS",
  cartorioMunicipio: "GOIÂNIA", cartorioUf: "GO", cns: 24729,
}];
const RESP_PARTES = {
  totalCount: 2,
  items: [
    { nome: "MARIANA EXEMPLO DE SOUZA", qualidade: "Outorgante", numeroDocumento: "11144477735" },
    { nome: "FULANO DE TAL EXEMPLO", qualidade: "Outorgante", numeroDocumento: "52998224725" },
  ],
};
const PARTE = { nome: "FULANO DE TAL EXEMPLO" };

/* respostaPartes: objeto JSON do /partes; null => faz o /partes responder HTTP 500. */
function montar(puxarPartes, respostaPartes) {
  const dom = new JSDOM("<!doctype html><body></body>",
    { url: "https://www.censec.org.br/private/s/00000000-0000-0000-0000-000000000000/cep",
      runScripts: "outside-only" });
  const w = dom.window;
  const mem = {
    "cratos:censec_estado": {
      ativo: false,   // não dispara o fluxo no load; chamamos fabricarCertidao direto
      numProcesso: "0000001-23.2025.5.18.0008",
      config: { pasta: "CRATOS", gerarNegativa: true, puxarPartes: !!puxarPartes },
    },
  };
  const pdfs = [];
  const fetchCalls = [];
  w.browser = {
    storage: { local: {
      get: async (k) => ({ [k]: mem[k] }),
      set: async (o) => Object.assign(mem, o),
      remove: async () => {},
    }, onChanged: { addListener() {} } },
    runtime: {
      sendMessage: async (m) => { if (m && m.tipo === "fabricar_pdf") pdfs.push(m); return { ok: true }; },
      onMessage: { addListener() {} },
      getURL: (p) => "moz-extension://x/" + p,
    },
    downloads: { download: async () => 1 },
  };
  w.fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), init: init || {} });
    if (/\/partes/.test(String(url))) {
      if (!respostaPartes) return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => respostaPartes };
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
  };
  w.CratosFaixa = { parar() {}, alertar() {}, dizer() {}, mostrar() {} };
  w.console.log = () => {}; w.console.warn = () => {}; w.console.debug = () => {}; w.console.error = () => {};
  w.eval(fs.readFileSync(path.join(SRC, "comum", "storage.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(SRC, "conteudo", "censec.js"), "utf8"));
  // fetch já está montado ANTES do grampo, para o fetchOriginal dele capturar o mock
  w.eval(fs.readFileSync(path.join(SRC, "conteudo", "censec-api.js"), "utf8"));
  return { w, pdfs, fetchCalls, mem };
}

(async () => {

/* Gate: a versão precisa ter o canal de partes exposto. */
{
  const { w } = montar(true, RESP_PARTES);
  await tick();
  if (!w.__cratosCensec || typeof w.__cratosCensec.fabricarCertidao !== "function") {
    console.log("\n=== teste-censec-partes.js ===");
    console.log("  FALHA  a versão em " + SRC + " não tem o canal de partes do CENSEC " +
      "(__cratosCensec.fabricarCertidao) — a certidão não lista as partes de cada ato.");
    console.log("\n0 passaram — a suíte inteira reprova nesta versão.\n");
    process.exit(1);
  }
}

/* ── LIGADO ── */
{
  const { w, pdfs, fetchCalls } = montar(true, RESP_PARTES);
  await tick();
  await w.__cratosCensec.fabricarCertidao(PARTE, "52998224725", ATOS, 1);
  await tick();
  const linhas = (pdfs[0] && pdfs[0].linhas) || [];
  const texto = linhas.join("\n");

  checar(pdfs.length === 1, "gera uma certidão (fabricar_pdf)");
  checar(/Partes do ato:/.test(texto), "⛔ a certidão lista as partes de cada ato");
  checar(/MARIANA EXEMPLO DE SOUZA - 111\.444\.777-35 - Outorgante/.test(texto),
    "⛔ parte com nome, CPF FORMATADO e qualidade");
  checar(/FULANO DE TAL EXEMPLO - 529\.982\.247-25 - Outorgante/.test(texto),
    "a própria parte pesquisada também entra na lista do ato");
  // a linha do ato original continua lá (não substituímos, acrescentamos abaixo)
  checar(/1\) 27\/08\/2008 - Escritura - Outorgante/.test(texto),
    "os dados que a certidão já gerava continuam intactos");

  const chamada = fetchCalls.find((c) => /\/partes/.test(c.url));
  checar(!!chamada, "o grampo chamou o endpoint /partes");
  checar(chamada && /busca-atos\/cep\/0fbe4c7a-1cd0-44cc-8a87-016d9a4d9eb1\/partes/.test(chamada.url),
    "a URL usa o atoId certo (a.id)");
  checar(chamada && chamada.init.credentials === "include",
    "⛔ autentica só pelo cookie (credentials:include)");
  const h = (chamada && chamada.init.headers) || {};
  checar(!!h["X-Subscription"], "manda o X-Subscription");
  checar(!(h["Authorization"] || h["authorization"]),
    "não monta Bearer — o cookie basta (confirmado no ambiente real, 16/09)");
}

/* ── DESLIGADO (controle) ── */
{
  const { w, pdfs, fetchCalls } = montar(false, RESP_PARTES);
  await tick();
  await w.__cratosCensec.fabricarCertidao(PARTE, "52998224725", ATOS, 1);
  await tick();
  const texto = ((pdfs[0] && pdfs[0].linhas) || []).join("\n");
  checar(pdfs.length === 1, "desligado: a certidão continua sendo gerada");
  checar(!/Partes do ato:/.test(texto), "desligado: NÃO lista partes");
  checar(!fetchCalls.some((c) => /\/partes/.test(c.url)),
    "desligado: nem chama o /partes (sem round-trip extra)");
}

/* ── PARTES FALHANDO (HTTP 500) ── */
{
  const { w, pdfs } = montar(true, null);   // /partes responde 500
  await tick();
  await w.__cratosCensec.fabricarCertidao(PARTE, "52998224725", ATOS, 1);
  await tick();
  const texto = ((pdfs[0] && pdfs[0].linhas) || []).join("\n");
  checar(pdfs.length === 1, "partes falhando: a certidão ainda é gerada");
  checar(!/Partes do ato:/.test(texto),
    "partes falhando: sai sem a seção de partes, sem derrubar a certidão");
}

console.log("\n=== teste-censec-partes.js ===");
oks.forEach((d) => console.log("  ok   " + d));
falhas.forEach((d) => console.log("  FALHA " + d));
console.log(`\n${oks.length} passaram, ${falhas.length} falharam ` +
  `(${oks.length + falhas.length} asserções)\n`);
process.exit(falhas.length ? 1 : 0);

})();
