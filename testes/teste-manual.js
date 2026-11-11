/*
 * teste-manual.js — 1.9.3 (05/11/2026): o Manual do Usuário DENTRO da extensão.
 *
 * Pedido do Rodrigo: o manual em HTML vai no pacote (mais leve que o PDF), com botão nas
 * Preferências e nos Primeiros passos e um "?" por convênio que abre a seção dele.
 *
 * Trava:
 *  1. src/manual/manual.html existe, é estático (sem <script>, sem on*=, sem recurso
 *     externo carregado) e traz a versão do manifesto;
 *  2. cada convênio das Preferências (Registro) tem a sua âncora #cfg-<nome>; as âncoras
 *     não se repetem; as imagens citadas existem no pacote;
 *  3. o fundo abre o manual pela mensagem "abrir_manual": âncora válida vai na URL;
 *     qualquer outra coisa (aspas, #, script) abre o manual do começo;
 *  4. Preferências: botão "Manual do usuário" e um "?" por convênio que manda a seção;
 *  5. Primeiros passos: botão "Manual do usuário";
 *  6. o texto do manual mora num só lugar (manual/conteudo.js) e o HTML é gerado dele.
 * Reprova a 1.9.2 (não há manual no pacote). Dados 100% fictícios (não há dados).
 * Rodar: node teste-manual.js   ·   versão antiga: CRATOS_SRC=<pasta> node …
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const NOME = "teste-manual.js";
const oks = [], falhas = [];
const checar = (c, d) => (c ? oks : falhas).push(d);
const ler = (...p) => { try { return fs.readFileSync(path.join(SRC, ...p), "utf8"); } catch (e) { return ""; } };

const HTML = ler("manual", "manual.html");
if (!HTML) {
  console.log(`\n=== ${NOME} ===\n  FALHA  a versão em ${SRC} não tem o manual no pacote (manual/manual.html).\n\n0 passaram — a suíte inteira reprova nesta versão.\n`);
  process.exit(1);
}

(async () => {
  const doc = new JSDOM(HTML).window.document;
  const versao = JSON.parse(ler("manifest.json")).version;

  /* ── 1. página estática ─────────────────────────────────────────────── */
  checar(!doc.querySelector("script") && !/<script/i.test(HTML), "⛔ manual sem <script> (página estática, nada executa)");
  const comOn = [...doc.querySelectorAll("*")].filter((el) => [...el.attributes].some((a) => /^on/i.test(a.name)));
  checar(comOn.length === 0, "⛔ manual sem atributos on*= (nenhum manipulador embutido)");
  const externos = [...doc.querySelectorAll("[src], link[href]")].filter((el) => /^(https?:)?\/\//i.test(el.getAttribute("src") || el.getAttribute("href") || ""));
  checar(externos.length === 0 && !/@import|url\(\s*["']?https?:/i.test(HTML), "⛔ nada carregado de fora (imagens e estilos só do pacote: funciona sem internet, sem consulta externa)");
  checar(doc.title.includes("Manual") && HTML.includes("Versão " + versao), `o manual traz a versão do manifesto (${versao})`);
  checar(!/\[INSERIR CAPTURA\]|\[preencher/i.test(HTML), "sem marcadores de trabalho (\"inserir captura\", \"preencher\") na versão do usuário");

  /* ── 2. âncoras e imagens ───────────────────────────────────────────── */
  const ctx = { console };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(ler("modulos", "registro.js") + "\nglobalThis.Registro = Registro;", ctx);
  for (const f of fs.readdirSync(path.join(SRC, "modulos"))) {
    if (!/\.js$/.test(f) || f === "registro.js") continue;
    try { vm.runInContext(ler("modulos", f), ctx); } catch (e) { /* módulo que precisa do fundo: o catálogo vem do registro */ }
  }
  try { vm.runInContext(ler("comum", "novidades.js"), ctx); } catch (e) { /* idem */ }
  const nomes = (ctx.Registro.listar ? ctx.Registro.listar() : ctx.Registro.todos ? ctx.Registro.todos() : []).map((m) => m.nome);
  const semAncora = nomes.filter((n) => !doc.getElementById("cfg-" + n));
  checar(nomes.length >= 10 && semAncora.length === 0, `cada convênio das Preferências tem a sua seção no manual (#cfg-<nome>)${semAncora.length ? " — faltam: " + semAncora.join(", ") : ""}`);
  const ids = [...doc.querySelectorAll("[id]")].map((e) => e.id);
  checar(new Set(ids).size === ids.length, "âncoras do manual não se repetem");
  checar(!!doc.getElementById("primeiros-passos") && !!doc.getElementById("quando-para") && !!doc.getElementById("contato"),
    "seções de destino existem (#primeiros-passos, #quando-para, #contato)");
  const imgs = [...doc.querySelectorAll("img")].map((i) => i.getAttribute("src"));
  checar(imgs.every((s) => /^img\/[\w.-]+\.png$/.test(s) && fs.existsSync(path.join(SRC, "manual", s))) && [...doc.querySelectorAll("img")].every((i) => (i.getAttribute("alt") || "").length > 5),
    "imagens do manual: só PNG do próprio pacote (manual/img/), todas presentes e com texto alternativo");
  checar(!!doc.querySelector(".sumario a[href='#cfg-ccs']"), "sumário leva às seções de cada convênio");

  /* ── 3. fundo: "abrir_manual" ───────────────────────────────────────── */
  const bg = ler("background.js");
  const m = bg.match(/async function abrirManual\([\s\S]*?\n}\n/);
  checar(!!m && /case "abrir_manual":\s*\n\s*return abrirManual\(msg\);/.test(bg), "o fundo atende a mensagem \"abrir_manual\"");
  if (m) {
    const abertas = [];
    const c2 = { browser: { runtime: { getURL: (p) => "moz-extension://uuid/" + p }, tabs: { create: async (o) => { abertas.push(o.url); return {}; } } } };
    vm.createContext(c2);
    vm.runInContext(m[0] + "\nglobalThis.abrirManual = abrirManual;", c2);
    await c2.abrirManual({ secao: "cfg-infojud" });
    await c2.abrirManual({});
    await c2.abrirManual({ secao: "x\"><script>alert(1)</script>" });
    await c2.abrirManual({ secao: "../../evil" });
    checar(abertas[0] === "moz-extension://uuid/manual/manual.html#cfg-infojud", "seção válida: abre o manual já na âncora");
    checar(abertas[1] === "moz-extension://uuid/manual/manual.html", "sem seção: abre o manual do começo");
    checar(abertas[2] === abertas[1] && abertas[3] === abertas[1], "⛔ seção estranha (aspas, script, caminho) é descartada: abre o manual do começo");
  }

  /* ── 4 e 5. botões ──────────────────────────────────────────────────── */
  const op = ler("opcoes", "opcoes.js");
  checar(/id="cx-manual"/.test(op) && /cx-manual"\)\.onclick = \(\) => browser\.runtime\.sendMessage\(\{ tipo: "abrir_manual" \}\)/.test(op),
    "Preferências: botão \"Manual do usuário\" no topo");
  checar(/class="cx-ajuda" data-secao="cfg-\$\{mod\.nome\}"/.test(op) && /tipo: "abrir_manual", secao: ev\.currentTarget\.dataset\.secao/.test(op),
    "Preferências: \"?\" em cada convênio manda a seção dele (#cfg-<nome>)");
  const ppH = ler("primeiros", "primeiros.html"), ppJ = ler("primeiros", "primeiros.js");
  checar(/id="pp-manual"/.test(ppH) && /pp-manual"\)\.onclick = \(\) => browser\.runtime\.sendMessage\(\{ tipo: "abrir_manual", secao: "primeiros-passos" \}\)/.test(ppJ),
    "Primeiros passos: botão \"Manual do usuário\" (abre na seção dos Primeiros passos)");

  /* ── 6. um texto só ─────────────────────────────────────────────────── */
  const conteudo = path.join(__dirname, "..", "manual", "conteudo.js");
  if (fs.existsSync(conteudo) && !process.env.CRATOS_SRC) {
    const { blocos } = require(conteudo);
    const ancoras = blocos.filter((b) => b.id).map((b) => b.id);
    checar(ancoras.every((a) => doc.getElementById(a)) && /Gerado por manual\/gerar-manual\.js/.test(HTML),
      "o HTML do pacote foi gerado do texto único (manual/conteudo.js): todas as seções dele estão na página");
  }

  console.log(`\n=== ${NOME} ===`);
  oks.forEach((d) => console.log("  ok   " + d));
  falhas.forEach((d) => console.log("  FALHA " + d));
  console.log(`\n${oks.length} passaram, ${falhas.length} falharam (${oks.length + falhas.length} asserções)\n`);
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.log("FALHA geral: " + e.stack); process.exit(1); });
