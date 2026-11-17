/*
 * teste-painel-shadow.js — o painel mora num shadow DOM aberto (2.0, passo 1).
 *
 * Trava: botão e painel ficam dentro do shadowRoot de <cratos-raiz>, nada deles na
 * página; o CSS do PJe não alcança o painel (página hostil com `* {color:red
 * !important}` e `div {display:none !important}`); o nosso CSS não vaza para a
 * página; o CSS entra como texto (tema + painel-estilo) e não como arquivo do
 * content_scripts; nada novo em web_accessible_resources. Reprova a 1.9.6 e o
 * commit 01fbce5 do dev-2.0 (painel solto no <body>, painel.css na página).
 */
const fs = require("fs");
const path = require("path");
const { montarPainel } = require("./harness-painel.js");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const NOME = "teste-painel-shadow.js";
const oks = [], falhas = [];
const checar = (c, d) => (c ? oks : falhas).push(d);
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 30));

const HOSTIL = "<!doctype html><html><head><style>" +
  "* { color: rgb(255, 0, 0) !important; font-size: 40px !important }" +
  "div { display: none !important } button { visibility: hidden !important }" +
  "</style></head><body><div id=\"pje\">tela do PJe</div></body></html>";

(async () => {
  const a = montarPainel(SRC, { html: HOSTIL });
  await tick();
  const { w, d } = a;
  const host = d.querySelector("cratos-raiz");
  const raiz = host && host.shadowRoot;

  /* ── 1. estrutura ─────────────────────────────────────────────────────── */
  checar(!!host && host.parentNode === d.body, "⛔ <cratos-raiz> é pendurado no <body> da página");
  checar(!!raiz && raiz.mode === "open", "⛔ o shadowRoot é ABERTO (leitor de tela e testes enxergam a árvore)");
  checar(!d.querySelector("cratos-painel") && !d.querySelector("cratos-botao"),
    "⛔ nem o painel nem o botão ficam soltos na página");
  checar(!!(raiz && raiz.querySelector("cratos-painel") && raiz.querySelector("cratos-botao")),
    "painel e botão estão dentro do shadowRoot");
  checar(!!(a.P && a.P.raiz === raiz && a.P.corpo && raiz.contains(a.P.corpo)),
    "o gancho de teste expõe a raiz, e o corpo do painel mora nela");

  /* ── 2. o CSS do PJe não entra ────────────────────────────────────────── */
  if (raiz) {
    const painel = raiz.querySelector("cratos-painel");
    painel.setAttribute("aberto", "");
    const corpo = raiz.querySelector(".cx-corpo");
    const cs = w.getComputedStyle(corpo);
    checar(cs.display !== "none", "⛔ `div {display:none !important}` da página não esconde o corpo do painel");
    checar(w.getComputedStyle(painel).color !== "rgb(255, 0, 0)", "⛔ `* {color:red !important}` da página não pinta o painel");
    checar(w.getComputedStyle(painel).fontSize !== "40px", "⛔ o tamanho de fonte da página não entra no painel");
  } else {
    checar(false, "⛔ `div {display:none !important}` da página não esconde o corpo do painel");
  }
  checar(w.getComputedStyle(d.getElementById("pje")).color === "rgb(255, 0, 0)", "controle: a regra hostil vale na página");

  /* ── 3. o nosso CSS não sai ───────────────────────────────────────────── */
  const estilosDaPagina = Array.from(d.querySelectorAll("style")).map((s) => s.textContent).join("\n");
  checar(!/cratos-painel|\.cx-|--ac\b/.test(estilosDaPagina), "⛔ nenhuma regra do CRATOS na página");
  const estiloRaiz = raiz ? Array.from(raiz.querySelectorAll("style")).map((s) => s.textContent).join("\n") : "";
  checar(/:host\s*\{\s*all:\s*initial/.test(estiloRaiz), "o host corta a herança da página (:host { all: initial })");
  checar(/\.t-escuro\{/.test(estiloRaiz) && /cratos-painel\s*\{/.test(estiloRaiz),
    "o <style> da raiz traz o tema (comum/tema.js) e o estilo do painel");
  const semDataUri = estiloRaiz.replace(/url\(\s*["']?data:[^)]*\)/g, "");
  checar(!/https?:\/\/|@import|url\(/i.test(semDataUri), "o CSS não busca nada fora (só data: no SVG do botão desligado)");

  /* ── 4. manifesto ─────────────────────────────────────────────────────── */
  const man = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8"));
  const cs = (man.content_scripts || []).find((c) => (c.js || []).includes("conteudo/painel.js")) || { js: [] };
  checar(!cs.css || !cs.css.length, "⛔ o content_script do painel não injeta mais CSS na página do PJe");
  const i = (f) => cs.js.indexOf(f);
  checar(i("comum/tema.js") >= 0 && i("conteudo/painel-estilo.js") >= 0 &&
    i("comum/tema.js") < i("conteudo/painel.js") && i("conteudo/painel-estilo.js") < i("conteudo/painel.js"),
    "tema.js e painel-estilo.js carregam antes do painel.js");
  checar(!fs.existsSync(path.join(SRC, "conteudo", "painel.css")), "o painel.css saiu do pacote");
  const war = JSON.stringify(man.web_accessible_resources || []);
  checar(!/painel|tema|\.css/.test(war), "nada de CSS ou do painel em web_accessible_resources");

  console.log(`\n=== ${NOME} ===`);
  oks.forEach((x) => console.log("  ok   " + x));
  falhas.forEach((x) => console.log("  FALHA " + x));
  console.log(`\n${oks.length} passaram, ${falhas.length} falharam (${oks.length + falhas.length} asserções)\n`);
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.log("FALHA geral: " + e.stack); process.exit(1); });
