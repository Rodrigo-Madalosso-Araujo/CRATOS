/*
 * teste-opcoes-rotulo.js — o rótulo do checkbox nas Preferências.
 *
 * Bug relatado pelo Rodrigo (16/09), nas configs do SAB: o checkbox mostrava
 * "Consultar" fixo ao lado, e o texto descritivo do campo ("Aplicar o chip…")
 * aparecia por cima — "Ao invés de constar Consultar ao lado do Checkbox, usa o
 * texto que está acima dele".
 *
 * A causa: renderControle cravava " Consultar" para TODO toggle. Isso faz sentido
 * no INFOJUD, onde o rótulo do campo é curto ("DOI") e aparece acima enquanto
 * "Consultar" descreve a ação — e lá os toggles vivem dentro de _grupos. Nos
 * campos SOLTOS (SAB, CENSEC) o rótulo é a própria frase da opção: agora ele vira
 * o texto AO LADO do checkbox, sem duplicar num <label> acima.
 *
 * Exercitamos o render de verdade (roda a IIFE de opcoes.js com um catálogo
 * representativo) e conferimos o DOM:
 *  · SAB (solto): o texto descritivo é o rótulo do checkbox; nada de "Consultar".
 *  · CENSEC (solto, o toggle novo): idem.
 *  · INFOJUD (grupo): mantém "Consultar" + rótulo curto acima — não quebrei.
 *
 * Reprova a versão anterior: lá o SAB mostra "Consultar" ao lado do checkbox.
 *
 * Rodar: node teste-opcoes-rotulo.js
 * Versão antiga: CRATOS_SRC=<pasta do xpi> node teste-opcoes-rotulo.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const falhas = [];
const oks = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 120));

const CATALOGO = { modulos: [
  { nome: "sab", rotulo: "SAB — padrões", config: {
      chipSisbajud: { tipo: "toggle", padrao: { ativo: false },
        rotulo: 'Aplicar o chip "SISBAJUD - aguardar resposta" ao concluir a inclusão' },
      gigsSisbajud: { tipo: "toggle", padrao: { ativo: false },
        rotulo: 'Lançar no GIGS a atividade "SISBAJUD - SAB em processamento: A partir de *"' },
  } },
  { nome: "censec", rotulo: "CENSEC", config: {
      puxarPartes: { tipo: "toggle", padrao: { ativo: false },
        rotulo: "Listar as partes de cada ato na certidão (nome, CPF/CNPJ e qualidade)" },
  } },
  { nome: "infojud", rotulo: "INFOJUD", config: {
      _grupos: { cpf: { rotulo: "CPF", campos: {
        doi: { tipo: "toggle", padrao: { ativo: false }, rotulo: "DOI — operações imobiliárias" },
      } } },
  } },
] };

(async () => {

const dom = new JSDOM(`<!doctype html><body><div id="modulos"></div></body>`,
  { url: "moz-extension://x/opcoes/opcoes.html", runScripts: "outside-only" });
const w = dom.window;
w.browser = {
  runtime: {
    sendMessage: async (m) => (m && m.tipo === "catalogo") ? CATALOGO : {},
    getManifest: () => ({ version: "1.4.1" }),
  },
  storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} }, onChanged: { addListener() {} } },
};
w.console.log = () => {}; w.console.warn = () => {}; w.console.error = () => {};
w.eval(fs.readFileSync(path.join(SRC, "comum", "storage.js"), "utf8"));
w.eval(fs.readFileSync(path.join(SRC, "opcoes", "opcoes.js"), "utf8"));
await tick(200);

const modulos = [...w.document.querySelectorAll(".modulo")];
const sabDiv = modulos.find((d) => d.dataset.modulo === "sab");
const censecDiv = modulos.find((d) => d.dataset.modulo === "censec");
const infojudDiv = modulos.find((d) => d.dataset.modulo === "infojud");

if (!sabDiv || !infojudDiv) {
  console.log("\n=== teste-opcoes-rotulo.js ===");
  console.log("  FALHA  o render das Preferências não montou os módulos (harness não exercitou a tela).");
  console.log("\n0 passaram — a suíte inteira reprova nesta versão.\n");
  process.exit(1);
}

/* ── SAB: solto, rótulo descritivo ── */
const sabHtml = sabDiv.innerHTML;
checar(/Aplicar o chip/.test(sabHtml), "SAB: o texto descritivo aparece");
checar(!/Consultar/.test(sabHtml),
  "⛔ SAB: NÃO mostra 'Consultar' ao lado do checkbox (era o bug)");
checar((sabHtml.match(/Aplicar o chip/g) || []).length === 1,
  "SAB: o texto não é duplicado (acima + ao lado) — aparece só uma vez");
const cbSab = sabDiv.querySelector('input[type=checkbox][data-tipo=toggle]');
const lblSab = cbSab && cbSab.closest("label");
checar(lblSab && /Aplicar o chip/.test(lblSab.textContent),
  "SAB: o texto é o rótulo clicável do próprio checkbox");
checar(/Lançar no GIGS/.test(sabHtml), "SAB: o segundo toggle (GIGS) também traz seu texto");

/* ── CENSEC: o toggle novo ── */
if (censecDiv) {
  const censecHtml = censecDiv.innerHTML;
  checar(/Listar as partes de cada ato/.test(censecHtml),
    "CENSEC: o checkbox novo aparece com o texto certo");
  checar(!/Consultar/.test(censecHtml), "CENSEC: o checkbox novo não mostra 'Consultar'");
}

/* ── INFOJUD: grupo, comportamento preservado ── */
const infoHtml = infojudDiv.innerHTML;
checar(/Consultar/.test(infoHtml),
  "INFOJUD (grupo): mantém 'Consultar' ao lado do checkbox — não quebrei o que funcionava");
checar(/DOI — operações imobiliárias/.test(infoHtml),
  "INFOJUD: o rótulo curto continua acima do checkbox");

console.log("\n=== teste-opcoes-rotulo.js ===");
oks.forEach((d) => console.log("  ok   " + d));
falhas.forEach((d) => console.log("  FALHA " + d));
console.log(`\n${oks.length} passaram, ${falhas.length} falharam ` +
  `(${oks.length + falhas.length} asserções)\n`);
process.exit(falhas.length ? 1 : 0);

})();
