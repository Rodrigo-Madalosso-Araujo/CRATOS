/*
 * teste-painel-liga-desliga.js — o interruptor liga/desliga da extensão.
 *
 * Pedido do Rodrigo (16/09): um botão liga/desliga no cabeçalho do painel. Modo
 * COMPLETO — desligado, a extensão fica dormente. O botão flutuante NUNCA some
 * (fica esmaecido, com ⏻) para ser a porta de volta. Persiste em
 * `extensao_ligada` (só `false` desliga; padrão ligado).
 *
 * O que se trava aqui:
 *  1. Store.ligada(): padrão true; só `false` explícito desliga.
 *  2. Init: sem flag → ligado (botão normal); flag=false → desligado (botão com [desligado]).
 *  3. ⛔ O interruptor alterna o estado E grava a chave.
 *  4. Desligado → o painel mostra o estado dormente (renderDesligado).
 *  5. Reage a mudança da chave em outra aba (Store.onChange).
 *
 * Rodar: node teste-painel-liga-desliga.js
 * Versão antiga: CRATOS_SRC=<pasta do xpi> node teste-painel-liga-desliga.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const falhas = [];
const oks = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 40));

function montar(ligadaInicial) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://pje.trt18.jus.br/pjekz/processo/1",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window;
  const mem = { "cratos:config": { infojud: { colheitaAutomatica: "nao" } } };
  if (ligadaInicial === false) mem["cratos:extensao_ligada"] = false;
  const listeners = [];
  const dispara = (changes) => listeners.slice().forEach((l) => { try { l(changes, "local"); } catch (e) {} });
  w.browser = {
    storage: {
      local: {
        get: async (k) => (k == null ? Object.assign({}, mem) : { [k]: mem[k] }),
        set: async (o) => {
          const changes = {};
          for (const k of Object.keys(o)) { changes[k] = { oldValue: mem[k], newValue: o[k] }; mem[k] = o[k]; }
          dispara(changes);
        },
        remove: async (k) => { delete mem[k]; },
      },
      onChanged: { addListener: (fn) => listeners.push(fn), removeListener: () => {} },
    },
    runtime: {
      getURL: (p) => p, getManifest: () => ({ version: "teste" }),
      onMessage: { addListener: () => {}, removeListener: () => {} },
      sendMessage: async () => ({ ok: true }),
    },
  };
  w.console.log = () => {}; w.console.warn = () => {}; w.console.error = () => {}; w.console.debug = () => {};
  w.eval(fs.readFileSync(path.join(SRC, "comum", "storage.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(SRC, "comum", "relatorio.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(SRC, "comum", "faixa.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(SRC, "conteudo", "painel.js"), "utf8"));
  return { w, mem };
}

(async () => {

/* Gate */
{
  const { w } = montar();
  const P = w.__cratosPainel;
  if (!P || typeof P.alternarLigado !== "function" || typeof w.Store.ligada !== "function") {
    console.log("\n=== teste-painel-liga-desliga.js ===");
    console.log("  FALHA  a versão em " + SRC + " não tem o liga/desliga (__cratosPainel.alternarLigado / Store.ligada).");
    console.log("\n0 passaram — a suíte inteira reprova nesta versão.\n");
    process.exit(1);
  }
}

/* ── 1. Store.ligada(): padrão true; só false desliga ─────────────────────── */
{
  const { w } = montar();
  checar((await w.Store.ligada()) === true, "Store.ligada() padrão true (chave ausente)");
  await w.Store.set("extensao_ligada", false);
  checar((await w.Store.ligada()) === false, "Store.ligada() false quando a chave é false");
  await w.Store.set("extensao_ligada", true);
  checar((await w.Store.ligada()) === true, "Store.ligada() true de novo");
}

/* ── 2. Init reflete a chave no botão flutuante ────────────────────────────── */
{
  const { w } = montar();          // sem flag → ligado
  await tick();
  const P = w.__cratosPainel;
  checar(P.ligado === true, "sem flag salva → nasce ligado");
  checar(P.botao && !P.botao.hasAttribute("desligado"), "botão flutuante normal quando ligado");
}
{
  const { w } = montar(false);     // flag=false → desligado
  await tick();
  const P = w.__cratosPainel;
  checar(P.ligado === false, "⛔ flag=false → nasce desligado");
  checar(P.botao && P.botao.hasAttribute("desligado"), "⛔ botão flutuante fica [desligado] (esmaecido/⏻)");
}

/* ── 3. O interruptor alterna E grava a chave ─────────────────────────────── */
{
  const { w, mem } = montar();
  await tick();
  const P = w.__cratosPainel;
  await P.alternarLigado();
  checar(P.ligado === false, "⛔ interruptor desliga");
  checar(mem["cratos:extensao_ligada"] === false, "⛔ e grava a chave (persiste)");
  checar(P.botao.hasAttribute("desligado"), "botão passa a [desligado]");
  await P.alternarLigado();
  checar(P.ligado === true, "interruptor liga de novo");
  checar(mem["cratos:extensao_ligada"] === true, "grava ligado");
  checar(!P.botao.hasAttribute("desligado"), "botão volta ao normal");
}

/* ── 4. Painel aberto e desligado → estado dormente ───────────────────────── */
{
  const { w } = montar(false);
  await tick();
  const P = w.__cratosPainel;
  P.renderDesligado();
  checar(/desligado/i.test(P.corpo.textContent || ""), "o corpo do painel mostra 'CRATOS desligado'");
}

/* ── 5. Reage à mudança da chave em outra aba ─────────────────────────────── */
{
  const { w } = montar();
  await tick();
  const P = w.__cratosPainel;
  checar(P.ligado === true, "começa ligado");
  await w.Store.set("extensao_ligada", false);   // "outra aba" desligou
  await tick();
  checar(P.ligado === false, "⛔ reage ao Store.onChange e fica desligado");
  checar(P.botao.hasAttribute("desligado"), "botão reflete o desligado vindo de fora");
}

/* ── 6. O ícone de energia é SVG (não glifo de fonte) + rótulo legível ──────── */
{
  const { w } = montar();          // ligado
  await tick();
  const power = w.document.querySelector("cratos-painel .cx-power");
  checar(!!power, "o interruptor de energia existe no cabeçalho");
  checar(!!(power && power.querySelector("svg")),
    "⛔ o ícone é um SVG inline (não depende de fonte — não vira 'tofu')");
  checar(!!(power && !/⏻/.test(power.textContent || "")),
    "⛔ não usa mais o caractere ⏻ (U+23FB), que a fonte do sistema podia não ter");
  const txt = power && power.querySelector(".cx-power-txt");
  checar(!!(txt && /Ligado/.test(txt.textContent || "")),
    "ligado: o rótulo diz 'Ligado' (descrição para o usuário leigo)");
}
{
  const { w } = montar(false);     // desligado
  await tick();
  const txt = w.document.querySelector("cratos-painel .cx-power .cx-power-txt");
  checar(!!(txt && /Desligado/.test(txt.textContent || "")),
    "desligado: o rótulo diz 'Desligado'");
  const P = w.__cratosPainel;
  P.renderDesligado();
  checar(!!(P.corpo.querySelector("svg")),
    "⛔ o painel desligado mostra o ícone de energia em SVG (não o glifo quebrado)");
  checar(!/⏻/.test(P.corpo.innerHTML || ""),
    "o painel desligado não contém o caractere ⏻");
}

/* ── 7. Nem o código-fonte nem o CSS trazem o glifo ⏻ (regressão) ──────────── */
{
  const js = fs.readFileSync(path.join(SRC, "conteudo", "painel.js"), "utf8");
  const css = fs.readFileSync(path.join(SRC, "conteudo", "painel.css"), "utf8");
  checar(!/⏻/.test(js), "⛔ painel.js não tem mais o caractere ⏻");
  checar(!/⏻/.test(css), "⛔ painel.css não tem mais o caractere ⏻ (o badge virou SVG)");
}

console.log("\n=== teste-painel-liga-desliga.js ===");
oks.forEach((d) => console.log("  ok   " + d));
falhas.forEach((d) => console.log("  FALHA " + d));
console.log(`\n${oks.length} passaram, ${falhas.length} falharam ` +
  `(${oks.length + falhas.length} asserções)\n`);
process.exit(falhas.length ? 1 : 0);

})();
