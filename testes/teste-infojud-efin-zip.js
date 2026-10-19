/*
 * teste-infojud-efin-zip.js — descompactar o zip do eFinanceira e renomear os PDFs.
 *
 * A abertura do zip + inflate roda no BACKGROUND (página de extensão), não no content
 * script: no sandbox/Xray do Firefox o DecompressionStream recusa o buffer
 * ("Value could not be converted to ArrayBufferView") — bug de campo da 1.5.0. O
 * background é o mesmo ambiente do Node, então testamos aqui a lógica pura: CratosUnzip
 * lê o container e descomprime DEFLATE, e rotularEfinPdfs dá o nome com (ANO) no fim.
 *
 * Trava:
 *   1. CratosUnzip.entries lê o zip e descomprime DEFLATE (round-trip com zlib).
 *   2. rotularEfinPdfs: "eFinanceira (<ano>)" no 1º PDF; "eFinanceira N (<ano>)" do 2º
 *      em diante; anos diferentes viram rótulos diferentes (nome interno é idêntico —
 *      não pode colidir); zip sem PDF => [] (o background devolve vazioEfin).
 *   3. O handler efin_zip existe no background.
 *
 * Reprova a 1.5.0: lá o unzip.js não tem rotularEfinPdfs e o background não tem o
 * handler efin_zip (a descompactação estava no content script e falhava no Firefox).
 *
 * Rodar: node teste-infojud-efin-zip.js
 * Versão antiga: CRATOS_SRC=<pasta do xpi> node teste-infojud-efin-zip.js
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const falhas = [];
const oks = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }

/* Gate síncrono: precisa do rotularEfinPdfs e do handler efin_zip no background. */
{
  const temUnzip = fs.existsSync(path.join(SRC, "comum", "unzip.js"));
  const unzip = temUnzip ? require(path.join(SRC, "comum", "unzip.js")) : {};
  const bg = fs.readFileSync(path.join(SRC, "background.js"), "utf8");
  if (!temUnzip || typeof unzip.rotularEfinPdfs !== "function" || !/["']efin_zip["']/.test(bg)) {
    console.log("\n=== teste-infojud-efin-zip.js ===");
    console.log("  FALHA  a versão em " + SRC + " não descompacta o eFinanceira no background " +
      "(sem unzip.rotularEfinPdfs / handler efin_zip) — na 1.5.0 o unzip rodava no content " +
      "script e falhava no Firefox (DecompressionStream/Xray).");
    console.log("\n0 passaram — a suíte inteira reprova nesta versão.\n");
    process.exit(1);
  }
}

const CratosUnzip = require(path.join(SRC, "comum", "unzip.js"));

/* Monta um zip method-8 (DEFLATE) com N arquivos {name, conteudo(Buffer)}. Dados
   100% sintéticos (regra LGPD do projeto). */
function makeZipDeflate(files) {
  const enc = new TextEncoder();
  const chunks = [], central = []; let offset = 0;
  for (const f of files) {
    const nameB = Buffer.from(enc.encode(f.name));
    const comp = zlib.deflateRawSync(f.conteudo);
    const lh = Buffer.alloc(30 + nameB.length);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(f.conteudo.length, 22);
    lh.writeUInt16LE(nameB.length, 26); nameB.copy(lh, 30);
    chunks.push(lh, comp);
    const ch = Buffer.alloc(46 + nameB.length);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(f.conteudo.length, 24);
    ch.writeUInt16LE(nameB.length, 28); ch.writeUInt32LE(offset, 42); nameB.copy(ch, 46);
    central.push(ch);
    offset += lh.length + comp.length;
  }
  let cdLen = 0; for (const c of central) cdLen += c.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10); eocd.writeUInt32LE(cdLen, 12); eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...chunks, ...central, eocd]));
}
const PDF = (marca) => Buffer.from("%PDF-1.4\n% " + marca + "\n");

(async () => {

/* ── 1. entries: lê o zip e descomprime DEFLATE ─────────────────────────────── */
{
  const conteudo = PDF("sintetico eFinanceira");
  const zip = makeZipDeflate([{ name: "extrato-efinanceira-00000000000191-1.pdf", conteudo }]);
  const ents = await CratosUnzip.entries(zip);
  checar(ents.length === 1 && /\.pdf$/i.test(ents[0].name), "lê o zip DEFLATE e acha o PDF");
  checar(Buffer.from(ents[0].bytes).equals(conteudo), "⛔ descomprime o DEFLATE byte a byte (round-trip com zlib)");
}

/* ── 2. rotularEfinPdfs: um PDF → "eFinanceira (<ano>)" ──────────────────────── */
{
  const itens = CratosUnzip.rotularEfinPdfs([{ bytes: PDF("a") }], "2022");
  checar(itens.length === 1 && itens[0].label === "eFinanceira (2022)",
    "⛔ 1 PDF → rótulo \"eFinanceira (2022)\" — (ANO) no fim");
}

/* ── 3. Dois PDFs do mesmo ano: índice ANTES do ano ─────────────────────────── */
{
  const itens = CratosUnzip.rotularEfinPdfs([{ bytes: PDF("a") }, { bytes: PDF("b") }], "2022");
  checar(JSON.stringify(itens.map((i) => i.label)) === JSON.stringify(["eFinanceira (2022)", "eFinanceira 2 (2022)"]),
    "⛔ 2 PDFs do mesmo ano → \"eFinanceira (2022)\" e \"eFinanceira 2 (2022)\"");
}

/* ── 4. Anos diferentes NÃO colidem (mesmo nome interno) ────────────────────── */
{
  const a = CratosUnzip.rotularEfinPdfs([{ bytes: PDF("2022") }], "2022")[0].label;
  const b = CratosUnzip.rotularEfinPdfs([{ bytes: PDF("2023") }], "2023")[0].label;
  checar(a === "eFinanceira (2022)" && b === "eFinanceira (2023)",
    "⛔ nome interno idêntico em anos diferentes vira rótulos distintos por ano (não sobrescreve)");
}

/* ── 5. Zip sem PDF → lista vazia (background devolve vazioEfin) ─────────────── */
{
  const itens = CratosUnzip.rotularEfinPdfs([{ bytes: Buffer.from("só um txt, sem pdf") }], "2022");
  checar(itens.length === 0, "⛔ sem PDF → [] (o background trata como vazioEfin)");
}

/* ── 6. Sem exercício → rótulo sem parênteses ───────────────────────────────── */
{
  const itens = CratosUnzip.rotularEfinPdfs([{ bytes: PDF("a") }], "");
  checar(itens[0].label === "eFinanceira", "sem ano → rótulo \"eFinanceira\" (sem parênteses)");
}

console.log("\n=== teste-infojud-efin-zip.js ===");
oks.forEach((d) => console.log("  ok   " + d));
falhas.forEach((d) => console.log("  FALHA " + d));
console.log(`\n${oks.length} passaram, ${falhas.length} falharam ` +
  `(${oks.length + falhas.length} asserções)\n`);
process.exit(falhas.length ? 1 : 0);

})();
