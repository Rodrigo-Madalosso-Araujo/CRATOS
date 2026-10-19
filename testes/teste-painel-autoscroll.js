/*
 * teste-painel-autoscroll.js — o painel gruda no fim de forma inteligente.
 *
 * Pedido do Rodrigo (17/09): quando chega conteúdo novo (passo da fila, certidão,
 * aviso), o painel deve rolar sozinho pro fim — MAS só se você já estava no fim.
 * Se rolou pra cima pra reler algo, o CRATOS respeita e não te puxa; ao voltar
 * pro pé, volta a grudar. Comportamento de bons chats/terminais ("grudar no fim
 * inteligente"), não "sempre rolar".
 *
 * O que se trava aqui (o elemento que ROLA é o próprio <cratos-painel>, não o
 * .cx-corpo — ver painel.css: cratos-painel { max-height; overflow-y:auto }):
 *  1. No fim + conteúdo novo → rola pro fim (scrollTop = scrollHeight).
 *  2. Rolou pra cima → conteúdo novo NÃO te puxa pro fim (respeita a leitura).
 *  3. Voltou pro pé → volta a grudar (conteúdo novo rola de novo).
 *
 * Reprova a 1.4.2: lá o painel não tinha auto-scroll nenhum — o conteúdo novo
 * nunca movia o scrollTop, então as travas 1 e 3 falham.
 *
 * Rodar: node teste-painel-autoscroll.js
 * Versão antiga: CRATOS_SRC=<pasta do xpi> node teste-painel-autoscroll.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const falhas = [];
const oks = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 40));

const ALTURA = 1000;   // scrollHeight simulado
const VISIVEL = 300;   // clientHeight simulado

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

  const painel = w.document.querySelector("cratos-painel");
  /* jsdom não faz layout: scrollHeight/clientHeight são 0. Simulamos um painel
     com conteúdo maior que a janela visível (o cenário em que rolar importa). */
  Object.defineProperty(painel, "scrollHeight", { get: () => ALTURA, configurable: true });
  Object.defineProperty(painel, "clientHeight", { get: () => VISIVEL, configurable: true });

  const rolar = (topo) => {                 // simula o usuário rolando: posiciona e avisa
    painel.scrollTop = topo;
    painel.dispatchEvent(new w.Event("scroll"));
  };
  const chegarConteudo = () => painel.querySelector(".cx-corpo")
    .appendChild(w.document.createElement("div"));  // conteúdo novo (passo/certidão/aviso)

  return { w, painel, rolar, chegarConteudo };
}

(async () => {

/* ── 1. No fim → conteúdo novo rola pro fim ─────────────────────────────────── */
{
  const { painel, chegarConteudo } = montar();
  await tick();
  painel.scrollTop = 0;              // finge que estamos no topo, mas grudarNoFim segue true (padrão, sem rolagem manual)
  chegarConteudo();
  await tick();
  checar(painel.scrollTop === ALTURA,
    "⛔ no fim + conteúdo novo → painel rola pro fim (scrollTop = scrollHeight)");
}

/* ── 2. Rolou pra cima → conteúdo novo NÃO puxa pro fim ──────────────────────── */
{
  const { painel, rolar, chegarConteudo } = montar();
  await tick();
  rolar(100);                        // 1000-100-300 = 600 > 24 → longe do fim
  painel.scrollTop = 100;            // marcador: se puxar, vira 1000
  chegarConteudo();
  await tick();
  checar(painel.scrollTop === 100,
    "⛔ rolou pra cima + conteúdo novo → NÃO puxa pro fim (respeita a leitura)");
}

/* ── 3. Voltou pro pé → volta a grudar ──────────────────────────────────────── */
{
  const { painel, rolar, chegarConteudo } = montar();
  await tick();
  rolar(100);                        // sobe (grudarNoFim = false)
  rolar(690);                        // volta pro pé: 1000-690-300 = 10 <= 24 → gruda de novo
  painel.scrollTop = 690;
  chegarConteudo();
  await tick();
  checar(painel.scrollTop === ALTURA,
    "voltou pro pé → conteúdo novo volta a rolar pro fim (re-gruda)");
}

console.log("\n=== teste-painel-autoscroll.js ===");
oks.forEach((d) => console.log("  ok   " + d));
falhas.forEach((d) => console.log("  FALHA " + d));
console.log(`\n${oks.length} passaram, ${falhas.length} falharam ` +
  `(${oks.length + falhas.length} asserções)\n`);
process.exit(falhas.length ? 1 : 0);

})();
