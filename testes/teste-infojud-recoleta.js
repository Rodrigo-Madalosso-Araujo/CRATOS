/*
 * teste-infojud-recoleta.js — colher o INFOJUD de novo, mesmo com a mensagem lida.
 *
 * Pedido do Rodrigo (16/09): "o CRATOS só puxa os resultados da caixa postal do
 * INFOJUD se a mensagem não foi lida… Aí não dá para baixar de novo. A ideia é
 * ele sempre baixar os resultados daquele processo, independente de a mensagem já
 * ter sido lida ou não."
 *
 * O bug estava em coletarTudo (background.js): a fila de download era montada só
 * com as solicitações NÃO lidas (`achar.solicitacoes.filter(s => !s.lida)`). Uma
 * vez que a mensagem daquele processo era lida — aberta, ou colhida uma vez — a
 * fila saía vazia (filaVazia) e não rebaixava nada. A TRAVA anti-vazamento é o
 * casamento do número do processo (em coletarAchar), não o status de leitura;
 * então tirar o filtro de leitura não afrouxa nenhuma trava. E o resultado no
 * eCAC fica de pé por meses (o Rodrigo já leu mensagens de +8 meses).
 *
 * A montagem da fila virou um helper puro, filaDeSolicitacoes, exposto para ser
 * exercitado sem simular o motor inteiro.
 *
 * Reprova a versão anterior: lá não existe o helper (fila montada inline, só com
 * as não lidas) — o gancho __cratosColeta não existe.
 *
 * Rodar: node teste-infojud-recoleta.js
 * Versão antiga: CRATOS_SRC=<pasta do xpi> node teste-infojud-recoleta.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const falhas = [];
const oks = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }

const dom = new JSDOM("<!doctype html><body></body>",
  { url: "https://pje.trt18.jus.br/", runScripts: "outside-only" });
const w = dom.window;
/* No load, background.js só registra listeners — precisa de browserAction e
   runtime.onMessage. O resto (Store, ApiPje, tabs…) é usado dentro das funções. */
w.browser = {
  browserAction: { onClicked: { addListener() {} } },
  runtime: {
    onMessage: { addListener() {} },
    onInstalled: { addListener() {} },
    openOptionsPage() {},
    getURL: (p) => p,
  },
  tabs: { query: async () => [], create: async () => ({ id: 1 }), update: async () => {}, remove: async () => {} },
  storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} }, onChanged: { addListener() {} } },
  downloads: { download: async () => 1 },
};
w.console.log = () => {}; w.console.warn = () => {}; w.console.error = () => {};

try {
  w.eval(fs.readFileSync(path.join(SRC, "background.js"), "utf8"));
} catch (e) {
  console.log("\n=== teste-infojud-recoleta.js ===");
  console.log("  FALHA  não consegui carregar background.js no harness: " + e.message);
  console.log("\n0 passaram — a suíte inteira reprova nesta versão.\n");
  process.exit(1);
}

const hook = w.__cratosColeta && w.__cratosColeta.filaDeSolicitacoes;
if (typeof hook !== "function") {
  console.log("\n=== teste-infojud-recoleta.js ===");
  console.log("  FALHA  a versão em " + SRC + " monta a fila de coleta só com as mensagens " +
    "NÃO lidas — não expõe filaDeSolicitacoes e não rebaixa um processo cuja mensagem já foi lida.");
  console.log("\n0 passaram — a suíte inteira reprova nesta versão.\n");
  process.exit(1);
}

/* ── comportamento do helper ── */
const solicitacoes = [
  { numSolicitacao: "20260809000001", lida: true },   // já lida
  { numSolicitacao: "20260809000052", lida: false },  // não lida
  { numSolicitacao: "20260809000001", lida: true },   // duplicada
  { numSolicitacao: "123", lida: false },             // curta demais
];
const fila = hook(solicitacoes);
checar(fila.includes("20260809000001"),
  "⛔ inclui a solicitação de mensagem JÁ LIDA — o coração do conserto (rebaixar o processo)");
checar(fila.includes("20260809000052"), "inclui a não lida também");
checar(fila.filter((n) => n === "20260809000001").length === 1, "dedupe por número de solicitação");
checar(!fila.includes("123"), "descarta número curto (< 10 dígitos)");
checar(hook([]).length === 0 && hook(null).length === 0, "lista vazia ou nula não quebra");

const soLidas = [{ numSolicitacao: "20260101000099", lida: true }];
checar(hook(soLidas).length === 1,
  "⛔ processo com TODAS as mensagens lidas: a fila NÃO fica vazia (era exatamente o bug)");

/* ── coletarTudo usa o helper, e o filtro antigo saiu ── */
const bg = fs.readFileSync(path.join(SRC, "background.js"), "utf8");
checar(/const fila = filaDeSolicitacoes\(achar\.solicitacoes\)/.test(bg),
  "coletarTudo monta a fila pelo helper (todas as casadas)");
checar(!/const naoLidas = \(achar\.solicitacoes/.test(bg),
  "⛔ o filtro antigo de NÃO lidas saiu de coletarTudo");

console.log("\n=== teste-infojud-recoleta.js ===");
oks.forEach((d) => console.log("  ok   " + d));
falhas.forEach((d) => console.log("  FALHA " + d));
console.log(`\n${oks.length} passaram, ${falhas.length} falharam ` +
  `(${oks.length + falhas.length} asserções)\n`);
process.exit(falhas.length ? 1 : 0);
