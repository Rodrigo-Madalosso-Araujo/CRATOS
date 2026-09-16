/*
 * teste-desligado.js — a chave global liga/desliga faz os convênios saírem de cena.
 *
 * Pedido do Rodrigo (16/09): botão liga/desliga; desligado, a extensão fica
 * dormente. Cada content script confere `extensao_ligada` e não age se estiver
 * desligado. Aqui exercitamos dois representantes:
 *  · RENAJUD (grampo): desligado, o evento de API NÃO fabrica folha.
 *  · SAB (ajudante passivo): desligado, o botão "marcar partes" NÃO é injetado.
 * E o controle LIGADO (padrão) continua agindo — para o gate não quebrar o normal.
 *
 * Reprova a versão anterior (sem a chave): lá, desligado, os dois agiam.
 *
 * Rodar: node teste-desligado.js
 * Versão antiga: CRATOS_SRC=<pasta do xpi> node teste-desligado.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const falhas = [];
const oks = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 60));

/* ── RENAJUD ───────────────────────────────────────────────────────────────*/
function montarRenajud(desligado) {
  const dom = new JSDOM("<!doctype html><body></body>",
    { url: "https://renajud.pdpj.jus.br/veiculo/restricao/inclusao", runScripts: "outside-only" });
  const w = dom.window;
  const mem = {
    "cratos:renajud_estado": { ativo: false, operacao: "inclusao",
      numProcesso: "00000012320255180008", executados: [{ nome: "A", cpfcnpj: "111" }] },
  };
  if (desligado) mem["cratos:extensao_ligada"] = false;
  const enviadas = [];
  w.browser = {
    storage: { local: { get: async (k) => ({ [k]: mem[k] }), set: async (o) => Object.assign(mem, o), remove: async () => {} } },
    runtime: { sendMessage: async (m) => { enviadas.push(m); return { ok: true }; }, onMessage: { addListener() {} }, getURL: (p) => "moz-extension://x/" + p },
    downloads: { download: async () => 1 },
  };
  w.CratosFaixa = { parar() {}, alertar() {}, dizer() {}, mostrar() {} };
  w.console.log = () => {}; w.console.warn = () => {}; w.console.debug = () => {};
  w.eval(fs.readFileSync(path.join(SRC, "comum", "storage.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(SRC, "conteudo", "renajud.js"), "utf8"));
  return { w, enviadas };
}
function dispararRenajud(w) {
  const corpo = JSON.stringify({
    dadosProcesso: { numeroProcesso: "00000012320255180008", magistrado: { nome: "X" }, orgao: { nome: "8A VARA", tribunal: { nome: "TRT18" } } },
    veiculos: [{ placa: "ABC1D23", marcaModelo: "FIAT/UNO", proprietario: { nome: "A", documento: "111" }, tipoRestricao: "Transferência" }],
  });
  w.document.dispatchEvent(new w.CustomEvent("cratos:renajud:restricao", {
    detail: JSON.stringify({ metodo: "POST", status: 200, corpo }),
  }));
}

/* ── SAB ───────────────────────────────────────────────────────────────────*/
function montarSab(desligado) {
  const dom = new JSDOM(
    `<!doctype html><html><body><div class="t-container-class">
       <table class="t-class" name="Tabela de Partes"><tbody>
         <tr class="cx-parte"><td>A</td><td>AUTOR</td><td>CREDOR</td>
           <td><mat-checkbox class="mat-checkbox"><label class="mat-checkbox-layout"></label></mat-checkbox></td></tr>
       </tbody></table></div></body></html>`,
    { url: "https://pje.trt18.jus.br/sab/determinacoes/nova/processo/123", runScripts: "outside-only" });
  const w = dom.window;
  const mem = { "cratos:config": {} };
  if (desligado) mem["cratos:extensao_ligada"] = false;
  w.browser = {
    storage: { local: { get: async (k) => ({ [k]: mem[k] }), set: async (o) => Object.assign(mem, o), remove: async () => {} } },
    runtime: { sendMessage: async () => ({ ok: true }), onMessage: { addListener() {} }, getURL: (p) => "moz-extension://x/" + p },
    downloads: { download: async () => 1 },
  };
  w.CratosFaixa = { parar() {}, alertar() {}, dizer() {}, mostrar() {} };
  w.CHAVES = { config: "config" };
  w.console.log = () => {}; w.console.warn = () => {}; w.console.debug = () => {};
  w.eval(fs.readFileSync(path.join(SRC, "comum", "storage.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(SRC, "conteudo", "sab.js"), "utf8"));
  return { w };
}

(async () => {

/* Gate: a chave precisa existir (Store.ligada). */
{
  const { w } = montarRenajud(false);
  if (typeof w.Store.ligada !== "function") {
    console.log("\n=== teste-desligado.js ===");
    console.log("  FALHA  a versão em " + SRC + " não tem a chave global (Store.ligada) — o desligar não existe.");
    console.log("\n0 passaram — a suíte inteira reprova nesta versão.\n");
    process.exit(1);
  }
}

/* ── RENAJUD ── */
{
  const { w, enviadas } = montarRenajud(true);   // DESLIGADO
  await tick();                                  // deixa a chave ser lida (fica false)
  dispararRenajud(w);
  await tick();
  checar(!enviadas.some((m) => m.tipo === "fabricar_pdf"),
    "⛔ RENAJUD desligado: o evento do grampo NÃO fabrica folha");
}
{
  const { w, enviadas } = montarRenajud(false);  // LIGADO (padrão)
  await tick();
  dispararRenajud(w);
  await tick();
  checar(enviadas.some((m) => m.tipo === "fabricar_pdf"),
    "controle: RENAJUD ligado continua fabricando a folha");
}

/* ── SAB ── */
{
  const { w } = montarSab(true);                 // DESLIGADO
  await tick();
  if (w.__cratosSab && w.__cratosSab.injetarBotaoMarcarPartes) w.__cratosSab.injetarBotaoMarcarPartes();
  checar(!w.document.getElementById("cratos-sab-marcar-partes"),
    "⛔ SAB desligado: o botão 'marcar partes' NÃO é injetado");
}
{
  const { w } = montarSab(false);                // LIGADO
  await tick();
  if (w.__cratosSab && w.__cratosSab.injetarBotaoMarcarPartes) w.__cratosSab.injetarBotaoMarcarPartes();
  checar(!!w.document.getElementById("cratos-sab-marcar-partes"),
    "controle: SAB ligado injeta o botão 'marcar partes'");
}

console.log("\n=== teste-desligado.js ===");
oks.forEach((d) => console.log("  ok   " + d));
falhas.forEach((d) => console.log("  FALHA " + d));
console.log(`\n${oks.length} passaram, ${falhas.length} falharam ` +
  `(${oks.length + falhas.length} asserções)\n`);
process.exit(falhas.length ? 1 : 0);

})();
