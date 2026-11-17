/*
 * teste-marca.js — 2.0: marca vetorial (fonte única) e ícones gerados dela.
 *
 * - Os SVGs de marca/ existem e são "limpos": sem script, sem imagem embutida, sem
 *   referência externa (a extensão nunca busca nada fora).
 * - Todo ícone declarado no manifesto (icons, default_icon, theme_icons) existe e tem o
 *   tamanho declarado (lido no cabeçalho do PNG).
 * - theme_icons: 16 e 32, cada um com versão para barra escura ("light") e clara ("dark").
 *
 * Rodar: node teste-marca.js   (CRATOS_SRC=<src antigo> para ver reprovar)
 */
const fs = require("fs");
const path = require("path");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const MARCA = path.join(SRC, "..", "marca");
const falhas = [];
const oks = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }
function fim() {
  console.log("\n=== teste-marca.js ===");
  oks.forEach((d) => console.log("  ok   " + d));
  falhas.forEach((d) => console.log("  FALHA " + d));
  console.log(`\n${oks.length} passaram, ${falhas.length} falharam (${oks.length + falhas.length} asserções)\n`);
  process.exit(falhas.length ? 1 : 0);
}
function tamanhoPng(arq) {
  const b = fs.readFileSync(arq);
  if (b.slice(1, 4).toString() !== "PNG") return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

const fontes = ["emblema.svg", "icone-chapa.svg", "raio-chapa.svg", "raio-barra-escura.svg", "raio-barra-clara.svg", "gerar-icones.sh"];
checar(fs.existsSync(MARCA) && fontes.every((f) => fs.existsSync(path.join(MARCA, f))), "marca/ tem os SVGs-fonte e o gerador");
if (!fs.existsSync(MARCA)) fim();

for (const f of fontes.filter((x) => x.endsWith(".svg"))) {
  const t = fs.readFileSync(path.join(MARCA, f), "utf8");
  checar(!/<script|<image|<foreignObject|on[a-z]+=|https?:\/\/(?!www\.w3\.org\/2000\/svg)/i.test(t), `${f}: sem script, imagem, evento ou referência externa`);
}
const emb = fs.readFileSync(path.join(MARCA, "emblema.svg"), "utf8");
checar(/#C9CBD1/i.test(emb) && /#D9A441/i.test(emb), "emblema nas cores da paleta (prata #C9CBD1, ouro #D9A441)");
checar(/aria-label="CRATOS"/.test(emb), "emblema com nome acessível");

const man = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8"));
const declarados = [];
for (const [s, p] of Object.entries(man.icons || {})) declarados.push([Number(s), p]);
for (const [s, p] of Object.entries((man.browser_action || {}).default_icon || {})) declarados.push([Number(s), p]);
const ti = (man.browser_action || {}).theme_icons || [];
for (const t of ti) { declarados.push([t.size, t.light]); declarados.push([t.size, t.dark]); }
for (const [s, p] of declarados) {
  const arq = path.join(SRC, p);
  const tam = fs.existsSync(arq) ? tamanhoPng(arq) : null;
  checar(!!tam && tam.w === s && tam.h === s, `${p}: existe e tem ${s}x${s}`);
}
checar([16, 32].every((s) => ti.some((t) => t.size === s && t.light && t.dark && t.light !== t.dark)), "theme_icons: 16 e 32, com versão para barra escura e clara");
checar(ti.every((t) => /escura/.test(t.light) && /clara/.test(t.dark)), "'light' (ícone claro) vai na barra escura; 'dark' na clara");
checar(fs.existsSync(path.join(SRC, "icones", "cratos-emblema.svg")), "o emblema SVG vai no pacote, para as telas do CRATOS");

fim();
