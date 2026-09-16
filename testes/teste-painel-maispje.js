/*
 * teste-painel-maispje.js — aviso do MaisPJE ao marcar o RENAJUD (só inline).
 *
 * Histórico: a 1.3.5/1.3.6 tinham uma FAIXA FLUTUANTE (ao abrir o processo e ao
 * marcar o RENAJUD). Feedback dos usuários (16/09): a faixa reaparecia a cada tela
 * e cansava. Decisão: MATAR a faixa flutuante e ficar só com a LINHA INLINE ao
 * lado do checkbox do RENAJUD — contextual, aparece só quando você marca, some ao
 * desmarcar.
 *
 * O que se trava aqui:
 *  1. Detecção do MaisPJE por rastro no DOM (menumaispje / maispjetooltip / id maisPje_*).
 *  2. ⛔ Marcar RENAJUD com MaisPJE → linha inline ao lado; desmarcar → some.
 *  3. ⛔ NÃO existe mais faixa flutuante (#cratos-maispje-aviso não é criada).
 *  4. Sem MaisPJE → nada.
 *
 * Rodar: node teste-painel-maispje.js
 * Versão antiga: CRATOS_SRC=<pasta do xpi> node teste-painel-maispje.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const falhas = [];
const oks = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }

function montar() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://pje.trt18.jus.br/pjekz/processo/1",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window;
  const mem = { "cratos:config": { infojud: { colheitaAutomatica: "nao" } } };
  w.browser = {
    storage: {
      local: {
        get: async (k) => (k == null ? Object.assign({}, mem) : { [k]: mem[k] }),
        set: async (o) => Object.assign(mem, o),
        remove: async (k) => { delete mem[k]; },
      },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
    runtime: {
      getURL: (p) => p,
      getManifest: () => ({ version: "teste" }),
      onMessage: { addListener: () => {}, removeListener: () => {} },
      sendMessage: async () => ({ ok: true }),
    },
  };
  w.console.log = () => {}; w.console.warn = () => {}; w.console.error = () => {}; w.console.debug = () => {};
  w.eval(fs.readFileSync(path.join(SRC, "comum", "storage.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(SRC, "comum", "relatorio.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(SRC, "comum", "faixa.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(SRC, "conteudo", "painel.js"), "utf8"));
  return { w };
}

const ROW_RENAJUD =
  '<div class="cx-parte" data-conv-id="RENAJUD">' +
  '<label><input type="checkbox" class="cx-sel-conv" data-id="RENAJUD"><span>RENAJUD</span></label></div>';

(async () => {

/* Gate: sem o hook, a versão não tem o recurso. */
{
  const { w } = montar();
  const P = w.__cratosPainel;
  if (!P || typeof P.maisPjePresente !== "function" || typeof P.wireAvisoMaisPjeRenajud !== "function") {
    console.log("\n=== teste-painel-maispje.js ===");
    console.log("  FALHA  a versão em " + SRC + " não expõe __cratosPainel.maisPjePresente/wireAvisoMaisPjeRenajud.");
    console.log("\n0 passaram — a suíte inteira reprova nesta versão.\n");
    process.exit(1);
  }
}

/* ── 1. Detecção pelos três marcadores ────────────────────────────────────── */
{
  const { w } = montar();
  checar(w.__cratosPainel.maisPjePresente() === false, "sem marcador → false");
}
{
  const { w } = montar();
  const el = w.document.createElement("menumaispje"); el.id = "maisPje_menuKaizen";
  w.document.body.appendChild(el);
  checar(w.__cratosPainel.maisPjePresente() === true, "detecta <menumaispje id='maisPje_...'>");
}
{
  const { w } = montar();
  w.document.body.appendChild(w.document.createElement("maispjetooltip"));
  checar(w.__cratosPainel.maisPjePresente() === true, "detecta a tag <maispjetooltip>");
}
{
  const { w } = montar();
  const d = w.document.createElement("div"); d.id = "maisPje_GIGS_bt";
  w.document.body.appendChild(d);
  checar(w.__cratosPainel.maisPjePresente() === true, "detecta por id que começa com 'maisPje'");
}

/* ── 2. Marcar RENAJUD com MaisPJE → linha inline; SEM faixa flutuante ─────── */
{
  const { w } = montar();
  const P = w.__cratosPainel;
  const mp = w.document.createElement("menumaispje"); mp.id = "maisPje_menuKaizen";
  w.document.body.appendChild(mp);
  P.corpo.innerHTML = ROW_RENAJUD;
  P.wireAvisoMaisPjeRenajud();
  const row = P.corpo.querySelector('.cx-parte[data-conv-id="RENAJUD"]');
  const cb = row.querySelector("input.cx-sel-conv");

  cb.checked = true;
  cb.dispatchEvent(new w.Event("change", { bubbles: true }));
  const inline = row.nextElementSibling;
  checar(inline && inline.classList.contains("cx-maispje-inline"),
    "⛔ marcar RENAJUD com MaisPJE → linha inline ao lado");
  checar(inline && /maispje/i.test(inline.textContent || ""), "a inline cita o MaisPJE");
  checar(!w.document.getElementById("cratos-maispje-aviso"),
    "⛔ NÃO cria mais a faixa flutuante (matada por feedback)");

  cb.checked = false;
  cb.dispatchEvent(new w.Event("change", { bubbles: true }));
  const depois = row.nextElementSibling;
  checar(!(depois && depois.classList && depois.classList.contains("cx-maispje-inline")),
    "desmarcar RENAJUD → a inline some");
}

/* ── 3. Sem MaisPJE → nada ao marcar ──────────────────────────────────────── */
{
  const { w } = montar();
  const P = w.__cratosPainel;
  P.corpo.innerHTML = ROW_RENAJUD;
  P.wireAvisoMaisPjeRenajud();
  const row = P.corpo.querySelector('.cx-parte[data-conv-id="RENAJUD"]');
  const cb = row.querySelector("input.cx-sel-conv");
  cb.checked = true;
  cb.dispatchEvent(new w.Event("change", { bubbles: true }));
  const inline = row.nextElementSibling;
  checar(!(inline && inline.classList && inline.classList.contains("cx-maispje-inline")),
    "sem MaisPJE, marcar RENAJUD não mostra a inline");
  checar(!w.document.getElementById("cratos-maispje-aviso"), "sem MaisPJE, nenhuma faixa");
}

console.log("\n=== teste-painel-maispje.js ===");
oks.forEach((d) => console.log("  ok   " + d));
falhas.forEach((d) => console.log("  FALHA " + d));
console.log(`\n${oks.length} passaram, ${falhas.length} falharam ` +
  `(${oks.length + falhas.length} asserções)\n`);
process.exit(falhas.length ? 1 : 0);

})();
