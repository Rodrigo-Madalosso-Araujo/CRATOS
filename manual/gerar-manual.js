/* Gera o Manual do Usuário do CRATOS em três formatos, a partir de UM texto (conteudo.js):
 *
 *   ../src/manual/manual.html (+ img/)   — vai DENTRO da extensão (1.9.3): página estática,
 *                                          sem script, aberta pelos botões "Manual do usuário"
 *                                          e pelos "?" das Preferências (âncoras #cfg-<convênio>)
 *   CRATOS - Manual do Usuario.docx      — para editar/imprimir
 *   CRATOS - Manual do Usuario.pdf       — para a release do GitHub (sai do HTML, tema claro)
 *
 * COMO ATUALIZAR: mude o texto em conteudo.js e rode, dentro da pasta manual\,
 *   node gerar-manual.js            (precisa do pacote "docx"; o PDF precisa do "playwright")
 * A versão sai do ../src/manifest.json; a data da capa, do dia em que se gera.
 * Capturas de tela: PNG em manual/capturas/ com o nome indicado em conteudo.js. Sem o
 * arquivo, o .docx mostra o quadro vermelho de "inserir captura"; o HTML e o PDF omitem.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { CONTATO, blocos: TODOS } = require("./conteudo.js");

const RAIZ = path.join(__dirname, "..");
let VERSAO = "1.9.0";
try { VERSAO = JSON.parse(fs.readFileSync(path.join(RAIZ, "src", "manifest.json"), "utf8")).version || VERSAO; } catch (e) { /* fica a conhecida */ }
/* VERSAO=1.9.2 node gerar-manual.js — gera o manual como era numa versão anterior (para a release dela). */
if (/^\d+\.\d+\.\d+$/.test(process.env.VERSAO || "")) VERSAO = process.env.VERSAO;
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const HOJE = new Date();
const DATA_CAPA = MESES[HOJE.getMonth()] + " de " + HOJE.getFullYear();
const CAPTURAS = path.join(__dirname, "capturas");

function cmpVersao(a, b) {
  const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; }
  return 0;
}
/* Blocos (e linhas de caixa) com `desde` maior que a versão do manifesto ficam de fora. */
const BLOCOS = TODOS.filter((b) => !b.desde && !(b.caixa && b.caixa.desde) ||
  cmpVersao(VERSAO, b.desde || b.caixa.desde) >= 0);
const temCaptura = (arq) => !!arq && fs.existsSync(path.join(CAPTURAS, arq));

/* **negrito** → partes [{t, b}] */
function partes(txt) {
  return String(txt).split(/(\*\*[^*]+\*\*)/).filter(Boolean)
    .map((s) => (s.startsWith("**") ? { t: s.slice(2, -2), b: true } : { t: s, b: false }));
}

/* ═══════════════════════════ HTML ═══════════════════════════ */
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const inl = (txt) => partes(txt).map((p) => (p.b ? "<b>" + esc(p.t) + "</b>" : esc(p.t))).join("");

function corpoHtml() {
  const out = [];
  let novaPagina = false;
  for (const b of BLOCOS) {
    if (b.h1) { out.push(`<h2 id="${b.id}"${novaPagina ? ' class="nova-pagina"' : ""}>${esc(b.h1)}</h2>`); novaPagina = false; }
    else if (b.h2) out.push(`<h3 id="${b.id}">${esc(b.h2)}</h3>`);
    else if (b.p) out.push(`<p>${inl(b.p)}</p>`);
    else if (b.passos) out.push("<ol>" + b.passos.map((l) => `<li>${inl(l)}</li>`).join("") + "</ol>");
    else if (b.bullets) out.push("<ul>" + b.bullets.map((l) => `<li>${inl(l)}</li>`).join("") + "</ul>");
    else if (b.caixa) out.push(`<div class="caixa ${b.caixa.tipo || "info"}">` +
      (b.caixa.titulo ? `<div class="caixa-tit">${esc(b.caixa.titulo)}</div>` : "") +
      b.caixa.linhas.map((l) => `<p>${inl(l)}</p>`).join("") + "</div>");
    else if (b.tabela) out.push('<table><colgroup><col style="width:26%"><col style="width:56%"><col style="width:18%"></colgroup><thead><tr><th>Opção</th><th>O que faz</th><th>Padrão</th></tr></thead><tbody>' +
      b.tabela.map((r) => `<tr><td><b>${esc(r[0])}</b></td><td>${inl(r[1])}</td><td class="padrao">${esc(r[2] || "—")}</td></tr>`).join("") +
      "</tbody></table>");
    else if (b.captura) { if (temCaptura(b.captura.arquivo)) out.push(`<figure><img src="img/${esc(b.captura.arquivo)}" alt="${esc(b.captura.desc)}"><figcaption>${esc(b.captura.desc)}</figcaption></figure>`); }
    else if (b.faq) out.push(b.faq.map(([q, a]) => `<div class="faq"><h4>${esc(q)}</h4><p>${inl(a)}</p></div>`).join(""));
    else if (b.quebra) novaPagina = true;
  }
  return out.join("\n");
}

function sumarioHtml() {
  const itens = [];
  for (const b of BLOCOS) {
    if (b.h1) itens.push(`<li class="n1"><a href="#${b.id}">${esc(b.h1)}</a></li>`);
    else if (b.h2 && /^6\./.test(b.h2)) itens.push(`<li class="n2"><a href="#${b.id}">${esc(b.h2.replace(/^6\.\d+\.\s*/, ""))}</a></li>`);
  }
  return `<nav class="sumario" aria-label="Sumário"><div class="sum-tit">Sumário</div><ul>${itens.join("")}</ul></nav>`;
}

function paginaHtml() {
  return `<!DOCTYPE html>
<html lang="pt-br">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CRATOS — Manual do Usuário</title>
<!-- Gerado por manual/gerar-manual.js a partir de manual/conteudo.js. Não edite à mão. -->
<style>
:root { --verm:#e11d1d; --borda:#2a2a2a; --txt:#e8e8e8; --sub:#b8b8b8; --fundo:#000; --cartao:#0f0f0f; }
* { box-sizing:border-box; }
html { scroll-behavior:smooth; }
body { margin:0; background:var(--fundo); color:var(--txt); font:16px/1.6 system-ui, "Segoe UI", sans-serif; }
.topo { border-bottom:1px solid var(--borda); padding:28px 24px 22px; }
.topo-in { max-width:1180px; margin:0 auto; }
.marca { font-size:30px; font-weight:800; letter-spacing:.06em; margin:0; }
.marca span { color:var(--verm); }
.sub { color:var(--sub); margin:4px 0 0; }
.versao { color:#8a8a8a; font-size:13px; margin-top:6px; }
.grade { max-width:1180px; margin:0 auto; display:grid; grid-template-columns:250px 1fr; gap:40px; padding:0 24px 64px; }
.sumario { position:sticky; top:0; align-self:start; max-height:100vh; overflow:auto; padding:24px 0; font-size:14px; }
.sum-tit { color:#8a8a8a; text-transform:uppercase; letter-spacing:.12em; font-size:12px; margin-bottom:8px; }
.sumario ul { list-style:none; margin:0; padding:0; }
.sumario li.n1 { margin-top:8px; }
.sumario li.n2 { padding-left:14px; font-size:13px; }
.sumario a { color:#cfcfcf; text-decoration:none; }
.sumario a:hover { color:#fff; text-decoration:underline; }
main { max-width:820px; padding-top:8px; }
h2 { font-size:24px; margin:40px 0 12px; padding-top:8px; border-top:1px solid var(--borda); scroll-margin-top:12px; }
h3 { font-size:18px; margin:28px 0 8px; color:#f2f2f2; scroll-margin-top:12px; }
h3:target, h2:target { color:#fff; background:linear-gradient(90deg, rgba(225,29,29,.22), transparent 70%); border-radius:6px; padding-left:8px; }
p { margin:0 0 12px; }
b { color:#fff; }
ol, ul { margin:0 0 14px; padding-left:24px; }
li { margin-bottom:6px; }
.caixa { border:1px solid var(--borda); border-left:4px solid #3a78c2; background:var(--cartao); border-radius:8px; padding:14px 16px; margin:14px 0; }
.caixa.aviso { border-left-color:#e6b800; }
.caixa.ok { border-left-color:#22a05b; }
.caixa p:last-child { margin-bottom:0; }
.caixa-tit { font-weight:700; margin-bottom:6px; color:#fff; }
table { width:100%; table-layout:fixed; border-collapse:collapse; margin:10px 0 16px; font-size:14px; }
th { text-align:left; background:#1a1a1a; color:#fff; padding:8px 10px; border-bottom:2px solid var(--verm); }
td { padding:8px 10px; border-bottom:1px solid var(--borda); vertical-align:top; }
td.padrao { color:var(--sub); font-style:italic; }
figure { margin:16px 0; }
figure img { max-width:100%; border:1px solid var(--borda); border-radius:8px; display:block; }
figcaption { color:#8a8a8a; font-size:13px; margin-top:6px; }
.faq h4 { margin:18px 0 4px; font-size:16px; color:#fff; }
.rodape { color:#8a8a8a; font-size:13px; border-top:1px solid var(--borda); margin-top:48px; padding-top:14px; }
@media (max-width: 900px) { .grade { grid-template-columns:1fr; } .sumario { position:static; max-height:none; } }
/* Impressão e PDF: tema claro, sem sumário lateral */
@media print {
  :root { --borda:#d6d6d6; --txt:#1d1d1f; --sub:#555; --fundo:#fff; --cartao:#f6f7f9; }
  body { font-size:11pt; }
  b, h2, h3, .faq h4, .caixa-tit, h3:target, h2:target { color:#111; background:none; }
  .marca span { color:#c0392b; }
  .topo { border:0; padding:60mm 0 18mm; text-align:center; }
  .marca { font-size:46pt; }
  .sub { font-size:13pt; }
  .versao { font-size:11pt; margin-top:10mm; }
  .grade { display:block; padding:0; }
  .sumario { position:static; max-height:none; padding:0; columns:2; font-size:10.5pt; break-before:page; break-after:page; }
  .sum-tit { font-size:14pt; color:#1f3a5f; column-span:all; margin-bottom:4mm; }
  main > h2:first-child { border-top:0; }
  .sumario a { color:#1d1d1f; }
  th { background:#1f3a5f; border-bottom:0; }
  h2 { break-after:avoid; } h3 { break-after:avoid; }
  tr, .caixa, figure, .faq { break-inside:avoid; }
  figure img { max-height:115mm; width:auto; margin:0 auto; }
  figcaption { text-align:center; }
  thead { display:table-header-group; }
  h2.nova-pagina { break-before:page; }
}
</style>
</head>
<body>
<header class="topo"><div class="topo-in">
<p class="marca">CRA<span>TOS</span></p>
<p class="sub">Manual do Usuário — execução unificada de convênios a partir do processo no PJe</p>
<div class="versao">Versão ${esc(VERSAO)} · ${esc(DATA_CAPA)} · Tribunal Regional do Trabalho da 18ª Região</div>
</div></header>
<div class="grade">
${sumarioHtml()}
<main>
${corpoHtml()}
<p class="rodape">CRATOS ${esc(VERSAO)} · ${esc(CONTATO)}</p>
</main>
</div>
</body>
</html>
`;
}

function gerarHtml() {
  const dest = path.join(RAIZ, "src", "manual");
  fs.mkdirSync(path.join(dest, "img"), { recursive: true });
  for (const f of fs.readdirSync(path.join(dest, "img"))) fs.unlinkSync(path.join(dest, "img", f));
  for (const b of BLOCOS) if (b.captura && temCaptura(b.captura.arquivo)) {
    fs.copyFileSync(path.join(CAPTURAS, b.captura.arquivo), path.join(dest, "img", b.captura.arquivo));
  }
  const html = paginaHtml();
  fs.writeFileSync(path.join(dest, "manual.html"), html);
  return path.join(dest, "manual.html");
}

/* ═══════════════════════════ DOCX ═══════════════════════════ */
async function gerarDocx() {
  const {
    Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, ImageRun,
    Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, PageBreak, LevelFormat,
  } = require("docx");
  const AZUL = "1F3A5F", VERM = "C0392B", CINZA = "6B7280", CINZACLARO = "F2F4F7";
  const FUNDO = { aviso: "FFF4CE", ok: "E8F5E9", info: CINZACLARO };
  const BORDA = { aviso: "E6B800", ok: "1E7E34", info: AZUL };
  const T = (text, o = {}) => new TextRun({ text, ...o });
  const runs = (txt, o = {}) => partes(txt).map((p) => T(p.t, { ...o, bold: p.b || o.bold }));
  const par = (txt, o = {}) => new Paragraph({ children: runs(txt), spacing: { after: 120, line: 276 }, ...o });
  let lista = 0;

  function caixa(c) {
    const filhos = [];
    if (c.titulo) filhos.push(new Paragraph({ children: [T(c.titulo, { bold: true, color: BORDA[c.tipo] || AZUL })], spacing: { after: 60 } }));
    c.linhas.forEach((l) => filhos.push(new Paragraph({ children: runs(l), spacing: { after: 40, line: 264 } })));
    const fina = { style: BorderStyle.SINGLE, size: 2, color: c.tipo === "aviso" ? "E6B800" : "CBD5E1" };
    return new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [9360],
      borders: { top: fina, bottom: fina, right: fina, left: { style: BorderStyle.SINGLE, size: 12, color: BORDA[c.tipo] || AZUL },
        insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE } },
      rows: [new TableRow({ children: [new TableCell({ width: { size: 9360, type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: FUNDO[c.tipo] || CINZACLARO },
        margins: { top: 120, bottom: 120, left: 160, right: 160 }, children: filhos })] })] });
  }
  function captura(c) {
    if (temCaptura(c.arquivo)) {
      const buf = fs.readFileSync(path.join(CAPTURAS, c.arquivo));
      const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);          // cabeçalho PNG
      const L = Math.min(600, w), A = Math.round(h * L / w);
      return [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120 }, children: [new ImageRun({ type: "png", data: buf, transformation: { width: L, height: A }, altText: { title: c.desc, description: c.desc, name: c.arquivo } })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [T(c.desc, { italics: true, color: CINZA, size: 18 })] })];
    }
    const tr = { style: BorderStyle.DASHED, size: 6, color: VERM };
    return [new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [9360], borders: { top: tr, bottom: tr, left: tr, right: tr },
      rows: [new TableRow({ children: [new TableCell({ width: { size: 9360, type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, fill: "FDECEA" },
        margins: { top: 100, bottom: 100, left: 160, right: 160 },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [T("[INSERIR CAPTURA] ", { bold: true, color: VERM }), T(c.desc, { italics: true, color: VERM })] })] })] })] })];
  }
  function tabela(linhas) {
    const W = [2600, 5560, 1200];
    const cel = (conteudo, i, fill, o = {}) => new TableCell({ width: { size: W[i], type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, fill },
      margins: { top: 60, bottom: 60, left: 100, right: 100 }, children: [new Paragraph({ children: conteudo })], ...o });
    const head = new TableRow({ tableHeader: true, children: ["Opção", "O que faz", "Padrão"].map((t, i) => cel([T(t, { bold: true, color: "FFFFFF", size: 19 })], i, AZUL)) });
    const rows = linhas.map((l, k) => { const f = k % 2 ? CINZACLARO : "FFFFFF"; return new TableRow({ children: [
      cel([T(l[0], { size: 19, bold: true })], 0, f), cel(runs(l[1], { size: 19 }), 1, f), cel([T(l[2] || "—", { size: 19, italics: true, color: CINZA })], 2, f)] }); });
    return new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: W, rows: [head, ...rows] });
  }

  const ch = [];
  /* capa */
  ch.push(new Paragraph({ spacing: { before: 2600 }, alignment: AlignmentType.CENTER, children: [T("CRATOS", { bold: true, size: 76, color: AZUL })] }));
  ch.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [T("Manual do Usuário", { size: 36, color: CINZA })] }));
  ch.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [T("Execução unificada de convênios a partir do processo no PJe", { size: 22, italics: true, color: CINZA })] }));
  ch.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 1800 }, children: [T("Tribunal Regional do Trabalho da 18ª Região", { size: 22 })] }));
  ch.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [T("Versão " + VERSAO + "     •     " + DATA_CAPA, { size: 20, color: CINZA })] }));
  ch.push(new Paragraph({ children: [new PageBreak()] }));
  /* sumário */
  ch.push(new Paragraph({ children: [T("Sumário", { bold: true, size: 30, color: AZUL })], spacing: { after: 200 } }));
  BLOCOS.filter((b) => b.h1).forEach((b) => ch.push(new Paragraph({ children: [T(b.h1, { size: 24, color: "2E5A88" })], spacing: { after: 120 } })));
  ch.push(new Paragraph({ children: [new PageBreak()] }));

  for (const b of BLOCOS) {
    if (b.h1) ch.push(new Paragraph({ text: b.h1, heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 140 } }));
    else if (b.h2) ch.push(new Paragraph({ text: b.h2, heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 100 } }));
    else if (b.p) ch.push(par(b.p));
    else if (b.passos) { lista++; b.passos.forEach((l) => ch.push(new Paragraph({ children: runs(l), numbering: { reference: "passos", level: 0, instance: lista }, spacing: { after: 80, line: 264 } }))); }
    else if (b.bullets) b.bullets.forEach((l) => ch.push(new Paragraph({ children: runs(l), numbering: { reference: "lista", level: 0 }, spacing: { after: 60, line: 264 } })));
    else if (b.caixa) { ch.push(caixa(b.caixa)); ch.push(new Paragraph({ children: [], spacing: { after: 80 } })); }
    else if (b.tabela) { ch.push(tabela(b.tabela)); ch.push(new Paragraph({ children: [], spacing: { after: 80 } })); }
    else if (b.captura) ch.push(...captura(b.captura));
    else if (b.faq) b.faq.forEach(([q, a]) => { ch.push(new Paragraph({ children: [T(q, { bold: true, color: AZUL })], spacing: { before: 120, after: 40 } })); ch.push(par(a)); });
    else if (b.quebra) ch.push(new Paragraph({ children: [new PageBreak()] }));
  }
  ch.push(new Paragraph({ spacing: { before: 400 }, alignment: AlignmentType.CENTER, children: [T("— CRATOS • TRT18 —", { color: CINZA, size: 18 })] }));

  const doc = new Document({
    creator: "TRT18", title: "CRATOS — Manual do Usuário",
    styles: {
      default: { document: { run: { font: "Calibri", size: 22, color: "222222" } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 30, bold: true, color: AZUL }, paragraph: { spacing: { before: 320, after: 140 } } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 25, bold: true, color: "2E5A88" }, paragraph: { spacing: { before: 240, after: 100 } } },
      ],
    },
    numbering: { config: [
      { reference: "lista", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 460, hanging: 260 } } } }] },
      { reference: "passos", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 460, hanging: 260 } } } }] },
    ] },
    sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1200, bottom: 1200, left: 1440, right: 1440 } } }, children: ch }],
  });
  const buf = await Packer.toBuffer(doc);
  const saida = path.join(__dirname, "CRATOS - Manual do Usuario.docx");
  fs.writeFileSync(saida, buf);
  return saida;
}

/* ═══════════════════════════ PDF (do HTML) ═══════════════════════════ */
async function gerarPdf(htmlPath) {
  let chromium;
  try { ({ chromium } = require("playwright")); } catch (e) { return null; }
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto("file://" + htmlPath);
  const saida = path.join(__dirname, "CRATOS - Manual do Usuario.pdf");
  await p.pdf({ path: saida, format: "A4", printBackground: true, margin: { top: "18mm", bottom: "18mm", left: "16mm", right: "16mm" },
    displayHeaderFooter: true, headerTemplate: "<span></span>",
    footerTemplate: `<div style="width:100%;font:8pt system-ui,sans-serif;color:#888;text-align:center">CRATOS ${esc(VERSAO)} — Manual do Usuário — <span class="pageNumber"></span>/<span class="totalPages"></span></div>` });
  await b.close();
  return saida;
}

(async () => {
  const html = gerarHtml();
  console.log("HTML:", path.relative(RAIZ, html));
  try { console.log("DOCX:", path.basename(await gerarDocx())); } catch (e) { console.log("DOCX não gerado:", e.message); }
  const pdf = await gerarPdf(html);
  console.log(pdf ? "PDF: " + path.basename(pdf) : "PDF não gerado (sem playwright)");
  const faltam = BLOCOS.filter((b) => b.captura && !temCaptura(b.captura.arquivo)).map((b) => b.captura.arquivo);
  if (faltam.length) console.log("Capturas que faltam em manual/capturas/:", faltam.join(", "));
})();
