/*
 * teste-ecac-aviso-encerramento.js — o diálogo de encerramento do e-CAC (03/09).
 *
 * A Receita passou a abrir, logo após o login, um modal jQuery UI com DOIS
 * botões. O CRATOS precisa dispensá-lo para conseguir trabalhar — mas só um dos
 * botões serve:
 *   [Continuar no e-CAC por enquanto]        <- este
 *   [Acessar o portal Serviços da RF]        <- ⛔ este leva o usuário embora
 *
 * Por isso o casamento é por TEXTO, nunca por posição: se a Receita inverter a
 * ordem dos botões, a versão "clica no primeiro" clicaria justamente no que não
 * pode. Esta suíte testa exatamente essa inversão.
 *
 * Rodar: node teste-ecac-aviso-encerramento.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const falhas = [];
const oks = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }

/* HTML fiel ao inspetor de 03/09. */
function dialogo(invertido) {
  const a = `<button type="button">Continuar no e-CAC por enquanto</button>`;
  const b = `<button type="button">Acessar o portal Serviços da Receita Federal</button>`;
  return `
  <div class="ui-dialog ui-widget ui-widget-content ui-corner-all close ui-resizable"
       role="dialog" aria-labelledby="ui-dialog-title-dialog-mensagem-encerramento-ecac">
    <div class="ui-dialog-titlebar ui-widget-header">
      <span id="ui-dialog-title-dialog-mensagem-encerramento-ecac" class="ui-dialog-title">Atenção</span>
      <a class="ui-dialog-titlebar-close ui-corner-all" href="#" role="button"></a>
    </div>
    <div id="dialog-mensagem-encerramento-ecac" class="ui-dialog-content ui-widget-content" role="alert">
      <p>Em breve, o acesso ao e-CAC será desativado. Os serviços digitais da Receita Federal
      passarão a ser acessados <strong>exclusivamente</strong> pelo portal
      <strong>Serviços da Receita Federal</strong>.<br>Comece a utilizar este acesso desde já.</p>
    </div>
    <div class="ui-dialog-buttonpane ui-widget-content ui-helper-clearfix">
      <div class="ui-dialog-buttonset">${invertido ? b + a : a + b}</div>
    </div>
  </div>`;
}

function montar(html) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`,
    { url: "https://cav.receita.fazenda.gov.br/ecac/", runScripts: "outside-only" });
  const w = dom.window;
  const cliques = [];
  w.browser = {
    storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
               onChanged: { addListener: () => {} } },
    runtime: { sendMessage: async () => ({ ok: true }), onMessage: { addListener: () => {} }, getURL: (p) => p },
  };
  w.CratosFaixa = { parar: () => {}, alertar: () => {}, dizer: () => {}, mostrar: () => {} };
  w.console.log = () => {}; w.console.warn = () => {}; w.console.debug = () => {};
  w.eval(fs.readFileSync(path.join(SRC, "comum", "storage.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(SRC, "conteudo", "ecac-infojud.js"), "utf8"));
  for (const b of w.document.querySelectorAll("button, a")) {
    b.addEventListener("click", () => cliques.push((b.textContent || "").trim()));
  }
  return { w, cliques };
}

(async () => {

{
  const arq = fs.readFileSync(path.join(SRC, "conteudo", "ecac-infojud.js"), "utf8");
  if (!/fecharAvisoEncerramentoEcac/.test(arq)) {
    console.log("\n=== teste-ecac-aviso-encerramento.js ===");
    console.log("  FALHA  a versão em " + SRC + " não dispensa o aviso de encerramento do " +
      "e-CAC. Ele é MODAL: com ele aberto, o INFOJUD não anda.");
    console.log("\n0 passaram — a suíte inteira reprova nesta versão.\n");
    process.exit(1);
  }
}

{
  const { w, cliques } = montar(dialogo(false));
  const ok = await w.__cratosEcac.fecharAvisoEncerramentoEcac();
  checar(ok === true, "acha e clica no botão do aviso");
  checar(cliques.length === 1, "clica UMA vez, num botão só");
  checar(/Continuar no e-CAC/i.test(cliques[0] || ""),
    "⛔ clica em 'Continuar no e-CAC por enquanto'");
  checar(!cliques.some((c) => /portal Servi/i.test(c)),
    "⛔ NÃO clica em 'Acessar o portal Serviços da Receita Federal'");
}

{
  /* A Receita inverte a ordem dos botões: quem clicasse "no primeiro" levaria o
     usuário para o portal novo, onde o CRATOS não sabe trabalhar. */
  const { w, cliques } = montar(dialogo(true));
  await w.__cratosEcac.fecharAvisoEncerramentoEcac();
  checar(/Continuar no e-CAC/i.test(cliques[0] || ""),
    "⛔ com os botões INVERTIDOS, ainda clica no certo (casa por texto, não por posição)");
  checar(!cliques.some((c) => /portal Servi/i.test(c)),
    "⛔ e continua sem tocar no botão que leva embora");
}

{
  const { w, cliques } = montar("<p>página normal do eCAC, sem aviso</p>");
  const t0 = Date.now();
  const ok = await w.__cratosEcac.fecharAvisoEncerramentoEcac();
  checar(ok === false, "sem o aviso, devolve falso");
  checar(cliques.length === 0, "sem o aviso, não clica em nada");
  checar(Date.now() - t0 >= 19000,
    "espera o aviso aparecer (ele é assíncrono, vem depois do login) antes de desistir");
}

console.log("\n=== teste-ecac-aviso-encerramento.js ===");
oks.forEach((d) => console.log("  ok   " + d));
falhas.forEach((d) => console.log("  FALHA " + d));
console.log(`\n${oks.length} passaram, ${falhas.length} falharam ` +
  `(${oks.length + falhas.length} asserções)\n`);
process.exit(falhas.length ? 1 : 0);

})();
