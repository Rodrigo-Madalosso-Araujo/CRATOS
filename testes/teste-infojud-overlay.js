/*
 * teste-infojud-overlay.js — a cortina central "Aguarde, baixando as certidões".
 *
 * Pedido dos usuários (25/09): um popup no CENTRO da tela, que BLOQUEIA cliques,
 * enquanto o CRATOS baixa as certidões. Por ora só no INFOJUD (decisão do Rodrigo).
 * O helper CratosOverlay vive em comum/faixa.js (carregado em todo content script);
 * o INFOJUD o aciona na fase de coleta (iniciarColetaEcac) e o esconde ao terminar.
 *
 * Trava:
 *   1. mostrar() cria uma cortina fixa cobrindo a tela, com z-index ABAIXO da faixa
 *      (para uma parada aparecer por cima) e engolindo o clique; é idempotente.
 *   2. esconder() remove.
 *   3. CratosFaixa.parar() esconde o overlay (a parada exige ver a faixa).
 *   4. O INFOJUD mostra o overlay ao colher e o esconde no fim (fiação no ecac).
 *
 * Reprova a 1.5.1: lá não existe CratosOverlay nem a fiação na coleta.
 *
 * Rodar: node teste-infojud-overlay.js
 * Versão antiga: CRATOS_SRC=<pasta do xpi> node teste-infojud-overlay.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const falhas = [];
const oks = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }

/* Gate síncrono */
{
  const faixa = fs.readFileSync(path.join(SRC, "comum", "faixa.js"), "utf8");
  const ecac = fs.readFileSync(path.join(SRC, "conteudo", "ecac-infojud.js"), "utf8");
  if (!/CratosOverlay/.test(faixa) || !/CratosOverlay\.mostrar/.test(ecac)) {
    console.log("\n=== teste-infojud-overlay.js ===");
    console.log("  FALHA  a versão em " + SRC + " não tem o overlay central de coleta " +
      "(sem CratosOverlay no faixa.js / sem a fiação na coleta do INFOJUD).");
    console.log("\n0 passaram — a suíte inteira reprova nesta versão.\n");
    process.exit(1);
  }
}

function montar() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://cav.receita.fazenda.gov.br/servicos/ATSDR/decjuiz/resultadoSolicitacao.asp?numeroSolicitacao=1",
    runScripts: "outside-only",
  });
  const w = dom.window;
  w.console.warn = () => {}; w.console.error = () => {};
  w.eval(fs.readFileSync(path.join(SRC, "comum", "faixa.js"), "utf8"));
  return w;
}

/* ── 1. mostrar(): cortina que cobre a tela e bloqueia ──────────────────────── */
{
  const w = montar();
  w.CratosOverlay.mostrar("As certidões estão sendo baixadas.");
  const ov = w.document.getElementById("cratos-overlay-aguarde");
  checar(!!ov, "⛔ mostrar() cria o overlay");
  checar(ov && ov.style.position === "fixed" && ov.style.inset === "0px",
    "⛔ a cortina é fixa e cobre a tela inteira (inset:0)");
  checar(ov && Number(ov.style.zIndex) >= 2147483640, "fica bem no topo do empilhamento");
  checar(ov && Number(ov.style.zIndex) < 2147483646, "⛔ mas ABAIXO da faixa (para uma parada aparecer por cima)");
  checar(ov && /baixadas/.test(ov.querySelector(".cratos-ov-txt").textContent),
    "mostra o texto de aguarde");
  w.CratosOverlay.esconder();
}

/* ── 2. idempotente: chamar de novo não empilha ─────────────────────────────── */
{
  const w = montar();
  w.CratosOverlay.mostrar("a");
  w.CratosOverlay.mostrar("b");
  checar(w.document.querySelectorAll("#cratos-overlay-aguarde").length === 1,
    "chamar mostrar() duas vezes mantém UM só overlay (atualiza o texto)");
  checar(/b$/.test(w.document.querySelector(".cratos-ov-txt").textContent), "o texto é atualizado");
  w.CratosOverlay.esconder();
}

/* ── 3. esconder() remove ───────────────────────────────────────────────────── */
{
  const w = montar();
  w.CratosOverlay.mostrar("x");
  w.CratosOverlay.esconder();
  checar(!w.document.getElementById("cratos-overlay-aguarde"), "⛔ esconder() tira a cortina");
}

/* ── 4. CratosFaixa.parar() esconde o overlay (a parada precisa ser vista) ───── */
{
  const w = montar();
  w.CratosOverlay.mostrar("baixando");
  w.CratosFaixa.parar("infojud", "algo travou");
  checar(!w.document.getElementById("cratos-overlay-aguarde"),
    "⛔ uma parada (faixa vermelha) esconde o overlay que bloqueava o clique");
  checar(!!w.document.getElementById("cratos-infojud-aviso"), "e a faixa de parada aparece");
}

/* ── 5. Fiação no INFOJUD: mostra ao colher, esconde no fim ──────────────────── */
{
  const ecac = fs.readFileSync(path.join(SRC, "conteudo", "ecac-infojud.js"), "utf8");
  const inic = ecac.slice(ecac.indexOf("async function iniciarColetaEcac"), ecac.indexOf("async function iniciarColetaEcac") + 600);
  checar(/CratosOverlay\.mostrar/.test(inic), "⛔ a coleta MOSTRA o overlay ao entrar na tela de resultado");
  const avanca = ecac.slice(ecac.indexOf("async function coletaColherEAvancar"), ecac.indexOf("async function coletaColherEAvancar") + 2200);
  checar(/est\.ativo = false[\s\S]*CratosOverlay\.esconder/.test(avanca),
    "⛔ e ESCONDE o overlay quando a coleta termina");
}

console.log("\n=== teste-infojud-overlay.js ===");
oks.forEach((d) => console.log("  ok   " + d));
falhas.forEach((d) => console.log("  FALHA " + d));
console.log(`\n${oks.length} passaram, ${falhas.length} falharam ` +
  `(${oks.length + falhas.length} asserções)\n`);
process.exit(falhas.length ? 1 : 0);
