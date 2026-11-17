/*
 * teste-tema.js — 2.0: temas grafite e ouro, claro e alto contraste.
 *
 * Mede o contraste WCAG de cada par de texto em cada tema (AA = 4,5:1; no alto
 * contraste, 10:1), o contraste do foco contra o fundo (3:1, componente de interface),
 * a resolução da preferência (inclusive "sistema", que segue o Firefox) e que o CSS não
 * busca nada fora.
 *
 * Rodar: node teste-tema.js   (CRATOS_SRC=<src antigo> para ver reprovar)
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const falhas = [];
const oks = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }
function fim() {
  console.log("\n=== teste-tema.js ===");
  oks.forEach((d) => console.log("  ok   " + d));
  falhas.forEach((d) => console.log("  FALHA " + d));
  console.log(`\n${oks.length} passaram, ${falhas.length} falharam (${oks.length + falhas.length} asserções)\n`);
  process.exit(falhas.length ? 1 : 0);
}
const ARQ = path.join(SRC, "comum", "tema.js");
if (!fs.existsSync(ARQ)) { checar(false, "comum/tema.js não existe nesta versão (temas)"); fim(); }
const ctx = { console };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(ARQ, "utf8"), ctx);
const T = ctx.CratosTema;

function lum(h) {
  const n = h.replace("#", "");
  const c = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contraste(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }

const PARES = [["fg", "bg"], ["fg", "sf"], ["fg2", "sf"], ["fg2", "bg"], ["fg3", "sf"], ["onac", "ac"], ["actx", "acbg"],
  ["oktx", "okbg"], ["wttx", "wtbg"], ["pdtx", "pdbg"], ["ertx", "erbg"], ["ertx2", "erbg"], ["eron", "erfill"], ["tabseltx", "tabsel"]];
const chaves = Object.keys(T.PALETAS["t-escuro"]).sort().join();
for (const [cls, p] of Object.entries(T.PALETAS)) {
  checar(Object.keys(p).sort().join() === chaves, `${cls}: tem as mesmas variáveis dos outros temas`);
  const min = cls === "t-hc" ? 10 : 4.5;
  const ruins = PARES.filter(([a, b]) => contraste(p[a], p[b]) < min).map(([a, b]) => `${a}/${b} ${contraste(p[a], p[b]).toFixed(2)}`);
  checar(!ruins.length, `${cls}: todo par de texto com contraste ≥ ${min}:1${ruins.length ? " — falham: " + ruins.join(", ") : ""}`);
  checar(contraste(p.foco, p.bg) >= 3 && contraste(p.foco, p.sf) >= 3, `${cls}: o foco se destaca do fundo (≥ 3:1)`);
}
checar(T.PALETAS["t-hc"].fw === "3px" && T.PALETAS["t-hc"].bw === "2px", "alto contraste: foco de 3 px e bordas de 2 px");
checar(["fg", "fg2", "fg3"].every((k) => T.PALETAS["t-hc"][k] === "#FFFFFF"), "alto contraste: nenhum texto em cinza");

/* Preferência → classe. */
const nada = () => false;
checar(T.resolver("escuro", nada) === "t-escuro" && T.resolver(undefined, nada) === "t-escuro" && T.resolver("lixo", nada) === "t-escuro", "padrão e valor desconhecido = escuro");
checar(T.resolver("claro", nada) === "t-claro" && T.resolver("alto-contraste", nada) === "t-hc", "claro e alto contraste");
checar(T.resolver("sistema", (q) => q === "(prefers-contrast: more)") === "t-hc", "sistema + contraste aumentado = alto contraste");
checar(T.resolver("sistema", (q) => q === "(prefers-color-scheme: light)") === "t-claro", "sistema + tema claro do Firefox = claro");
checar(T.resolver("sistema", nada) === "t-escuro", "sistema sem preferência = escuro");

/* Aplicar troca a classe sem acumular. */
const cl = new Set(["outra", "t-claro"]);
const raiz = { classList: { add: (c) => cl.add(c), remove: (c) => cl.delete(c) } };
T.aplicar(raiz, "t-hc");
checar(cl.has("t-hc") && !cl.has("t-claro") && cl.has("outra"), "aplicar troca o tema e preserva as outras classes");
T.aplicar(raiz, "t-inexistente");
checar(cl.has("t-escuro") && !cl.has("t-hc"), "classe desconhecida cai no escuro");

/* CSS. */
const css = T.css();
checar(!/url\(|@import|https?:/i.test(css), "o CSS não busca nada fora (sem url, @import ou http)");
checar(/forced-colors: active/.test(css) && /CanvasText/.test(css), "respeita o tema de contraste do Windows");
checar(/prefers-reduced-motion/.test(css), "respeita 'reduzir movimento'");
checar(/:focus-visible\{outline:var\(--fw\) solid var\(--foco\)/.test(css), "foco visível com a espessura e a cor do tema");
checar(/\.cx-sr\{/.test(css), "classe para texto só do leitor de tela");

fim();
