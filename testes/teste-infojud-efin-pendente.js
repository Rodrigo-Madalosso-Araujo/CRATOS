/*
 * teste-infojud-efin-pendente.js — eFinanceira assíncrono: zip vazio (dia 1) vira
 * a certidão "Consolidando resultados da consulta ao e-Financeira".
 *
 * Pedido do Rodrigo (21/09/2026): o eFinanceira é assíncrono. Na coleta automática
 * do dia 1, a Receita às vezes já dá o link mas o zip vem SEM PDF (resultado ainda
 * em consolidação). Em vez de erro calado ou zip quebrado salvo, o CRATOS junta uma
 * certidão do ESTADO da diligência — que a consulta foi registrada e o retorno virá
 * depois. NÃO afirma resultado nem "nada consta" (pendência não vira certidão de
 * resultado). No dia seguinte, o botão exclusivo traz o extrato de verdade.
 *
 * Reprova a 1.4.3: lá não existe fabricarCertidaoEfinPendente; zip sem PDF só daria
 * erro/zip cru.
 * Reprova a 1.5.1 (casos 4-5): lá o link que devolve HTML/corpo-não-zip virava erro
 * "HTML sem link" OU um .zip cru salvo no Cofre — que a juntada tentava anexar e o PJe
 * recusava (ARQ-041 "Arquivo deve ser PDF"). Agora é certidão de consolidação, e o caso
 * 6 trava a regra de ferro: zip real ilegível continua erro, nunca certidão falsa.
 *
 * Rodar: node teste-infojud-efin-pendente.js
 * Versão antiga: CRATOS_SRC=<pasta do xpi> node teste-infojud-efin-pendente.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const falhas = [];
const oks = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 30));

/* Zip STORE mínimo (sem compressão) — não precisa de DecompressionStream. */
function makeZip(files) {
  const enc = new TextEncoder();
  const chunks = [], central = []; let offset = 0;
  for (const f of files) {
    const nameB = enc.encode(f.name), data = f.bytes;
    const lh = new Uint8Array(30 + nameB.length); const dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(8, 0, true);
    dv.setUint32(18, data.length, true); dv.setUint32(22, data.length, true); dv.setUint16(26, nameB.length, true);
    lh.set(nameB, 30); chunks.push(lh, data);
    const ch = new Uint8Array(46 + nameB.length); const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(10, 0, true);
    cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, nameB.length, true);
    cv.setUint32(42, offset, true); ch.set(nameB, 46); central.push(ch);
    offset += lh.length + data.length;
  }
  const cdStart = offset; let cdLen = 0; for (const c of central) cdLen += c.length;
  for (const c of central) chunks.push(c);
  const eocd = new Uint8Array(22); const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdLen, true); ev.setUint32(16, cdStart, true); chunks.push(eocd);
  let total = 0; for (const c of chunks) total += c.length;
  const out = new Uint8Array(total); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
const pdfStub = () => new TextEncoder().encode("%PDF-1.4\n%teste\n");

/* A descompactação agora é no background: o content script manda "efin_zip" e o
   background responde. Aqui mockamos essa resposta (efinResp) para exercitar o
   roteamento do content script: vazioEfin → certidão; arquivos → sem certidão. */
function montar(zipBytes, efinResp) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://cav.receita.fazenda.gov.br/servicos/ATSDR/decjuiz/resultadoSolicitacao.asp?numeroSolicitacao=1",
    runScripts: "outside-only",
  });
  const w = dom.window;
  const msgs = [];
  /* Cofre falso acumulável: o que for fabricado/baixado entra aqui, e `cofre_listar`
     devolve os nomes — assim o guarda de duplicação da certidão pode ser exercitado. */
  const cofre = [];
  w.CratosFaixa = { parar() {}, alertar() {}, dizer() {}, mostrar() {} };
  w.fetch = async () => ({ ok: true, status: 200, arrayBuffer: async () => zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.byteLength) });
  w.browser = {
    storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} }, onChanged: { addListener: () => {} } },
    runtime: {
      sendMessage: async (m) => {
        msgs.push(m);
        if (m && m.tipo === "efin_zip") return efinResp || { ok: true, vazioEfin: true };
        if (m && m.tipo === "baixar_pdf_base64") { const f = `CRATOS/x ${m.tipoLabel}.${m.ext}`; cofre.push({ nome: f.split("/").pop(), bytes: 10 }); return { ok: true, filename: f }; }
        if (m && m.tipo === "fabricar_pdf") { cofre.push({ nome: String(m.filename || "").split("/").pop(), bytes: 10 }); return { ok: true }; }
        if (m && m.tipo === "cofre_listar") return { ok: true, arquivos: cofre.slice() };
        return { ok: true };
      },
      onMessage: { addListener: () => {} }, getURL: (p) => p,
    },
  };
  w.__cofreFalso = cofre;
  w.console.log = () => {}; w.console.warn = () => {}; w.console.debug = () => {}; w.console.error = () => {};
  w.eval(fs.readFileSync(path.join(SRC, "comum", "storage.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(SRC, "conteudo", "ecac-infojud.js"), "utf8"));
  return { w, msgs };
}

/* Gate síncrono */
{
  const arq = fs.readFileSync(path.join(SRC, "conteudo", "ecac-infojud.js"), "utf8");
  if (!/function fabricarCertidaoEfinPendente\(/.test(arq)) {
    console.log("\n=== teste-infojud-efin-pendente.js ===");
    console.log("  FALHA  a versão em " + SRC + " não trata o eFinanceira assíncrono vazio " +
      "(sem fabricarCertidaoEfinPendente) — zip sem PDF só daria erro ou zip cru.");
    console.log("\n0 passaram — a suíte inteira reprova nesta versão.\n");
    process.exit(1);
  }
}

const TITULO = "Consolidando resultados da consulta ao e-Financeira";

(async () => {

/* ── 1. Background diz vazioEfin (zip sem PDF) → certidão de consolidação ─────── */
{
  const zip = makeZip([{ name: "aviso.txt", bytes: new TextEncoder().encode("ainda processando") }]);
  const { w, msgs } = montar(zip, { ok: true, vazioEfin: true });
  await tick();
  const item = { tipo: "EFINANCEIRA", anoData: "2022", href: "https://x/efin.zip" };
  const r = await w.__cratosEcac.colherDownloadDireto(item, "11222333000181", item.href);
  const certs = msgs.filter((m) => m.tipo === "fabricar_pdf");
  checar(r.ok === true && r.efinPendente === true, "⛔ vazioEfin → certidão de consolidação (não erro)");
  checar(certs.length === 1 && certs[0].titulo === TITULO, "⛔ o título é \"" + TITULO + "\"");
  checar(msgs.some((m) => m.tipo === "efin_zip"), "a abertura do zip foi delegada ao background (efin_zip)");
}

/* ── 2. A certidão NÃO afirma resultado nem "nada consta" ────────────────────── */
{
  const { w, msgs } = montar(makeZip([{ name: "x.txt", bytes: new TextEncoder().encode("z") }]));
  await tick();
  await w.__cratosEcac.fabricarCertidaoEfinPendente("11222333000181", "2022");
  const cert = msgs.find((m) => m.tipo === "fabricar_pdf");
  const texto = (cert.linhas || []).join(" \n ").toLowerCase();
  checar(/registrada/.test(texto) && /assincron/.test(texto),
    "⛔ certifica que a consulta foi REGISTRADA e o retorno é assíncrono");
  checar(!/nada consta/.test(texto) && !/n[ãa]o consta/.test(texto) && !/consta declara/.test(texto),
    "⛔ não afirma resultado nem \"nada consta\" (pendência ≠ certidão de resultado)");
  checar(/2022/.test(texto), "menciona o ano/exercício consultado");
}

/* ── 3. Background devolve arquivos → colhe, NÃO emite certidão de consolidação ── */
{
  const zip = makeZip([{ name: "extrato-efinanceira-1.pdf", bytes: pdfStub() }]);
  const { w, msgs } = montar(zip, { ok: true, arquivos: ["CRATOS/x eFinanceira (2021).pdf"] });
  await tick();
  const item = { tipo: "EFINANCEIRA", anoData: "2021", href: "https://x/efin.zip" };
  const r = await w.__cratosEcac.colherDownloadDireto(item, "11222333000181", item.href);
  checar(r.ok === true && !r.efinPendente, "resultado pronto → colhe (sem certidão de consolidação)");
  const env = msgs.find((m) => m.tipo === "efin_zip");
  checar(env && env.exercicio === "2021", "manda o zip pro background com o exercício");
  checar(r.arquivo === "CRATOS/x eFinanceira (2021).pdf", "devolve o PDF renomeado pelo background");
  checar(!msgs.some((m) => m.tipo === "fabricar_pdf"), "não emite a certidão de consolidação quando há PDF");
}

/* ── 4. Link do eFinanceira devolve HTML "em processamento" (sem link de arquivo) ──
   Caso de campo (25/09): a Receita dá o link, mas o corpo é uma PÁGINA, não um zip.
   É NÃO-PRONTO (sem dado) → certidão de consolidação. Na 1.5.1 isso virava
   erro "HTML sem link"; e no ramo "outro" (abaixo) virava .zip cru anexado, que o PJe
   recusa com ARQ-041 "Arquivo deve ser PDF". */
{
  const html = new TextEncoder().encode(
    "<html><body>Resultado ainda em processamento. Tente novamente mais tarde.</body></html>");
  const { w, msgs } = montar(html);
  await tick();
  const item = { tipo: "EFINANCEIRA", anoData: "2025", href: "https://x/efin.zip" };
  const r = await w.__cratosEcac.colherDownloadDireto(item, "11222333000181", item.href);
  checar(r.ok === true && r.efinPendente === true, "⛔ HTML 'em processamento' → certidão de consolidação (não erro)");
  const salvouZip = msgs.some((m) => m.tipo === "baixar_pdf_base64" && m.ext === "zip");
  checar(!salvouZip, "⛔ NÃO salva .zip bruto no Cofre (evita o ARQ-041 na juntada)");
  checar(msgs.some((m) => m.tipo === "fabricar_pdf"), "emite a certidão de estado");
}

/* ── 5. Link devolve corpo que NEM É arquivo (não-PK, não-%PDF, não-HTML) ──────────
   O eCAC às vezes devolve um blob que não é zip nem pdf nem página. Também é
   NÃO-PRONTO → certidão. Na 1.5.1 caía no fallback genérico e salvava como .zip. */
{
  const lixo = new Uint8Array([0x72, 0x65, 0x73, 0x75, 0x6c, 0x74, 0x61, 0x64, 0x6f, 0x20, 0x69, 0x6e, 0x64, 0x69, 0x73, 0x70]);
  const { w, msgs } = montar(lixo);
  await tick();
  const item = { tipo: "EFINANCEIRA", anoData: "2025", href: "https://x/efin.zip" };
  const r = await w.__cratosEcac.colherDownloadDireto(item, "11222333000181", item.href);
  checar(r.ok === true && r.efinPendente === true, "⛔ corpo não-arquivo → certidão de consolidação");
  const salvouZip = msgs.some((m) => m.tipo === "baixar_pdf_base64" && m.ext === "zip");
  checar(!salvouZip, "⛔ NÃO salva .zip bruto (era o bug do print: ARQ-041)");
}

/* ── 6. REGRA DE FERRO: zip REAL que estoura no inflate = erro, NUNCA certidão ─────
   Se há dado (zip real) mas a leitura falha, é erro vermelho — não pode virar certidão
   falsa de "consolidando". O background devolve {ok:false, erro}. */
{
  const zip = makeZip([{ name: "extrato.pdf", bytes: pdfStub() }]);
  const { w, msgs } = montar(zip, { ok: false, erro: "falha ao abrir o zip do eFinanceira: corrompido" });
  await tick();
  const item = { tipo: "EFINANCEIRA", anoData: "2020", href: "https://x/efin.zip" };
  const r = await w.__cratosEcac.colherDownloadDireto(item, "11222333000181", item.href);
  checar(r.ok === false && !r.efinPendente, "⛔ inflate-fail (dado ilegível) → erro, não certidão");
  checar(!msgs.some((m) => m.tipo === "fabricar_pdf"), "⛔ não fabrica certidão falsa quando o zip real falha ao abrir");
}

/* ── 7. Linha do eFinanceira SEM link (não-pronto) → certidão de consolidação ──────
   Caso do 2º print (28/09): a coluna Opções traz só o texto "processamento ainda não
   concluído", SEM lupa. Na 1.5.2 o lerItensResultado descartava a linha (`if (!link)
   continue`) e o eFinanceira sumia — sem pendente, sem certidão. Agora entra e vira
   certidão. Testa a integração via colherTodosItens (lê a tabela real). Reprova a 1.5.2. */
{
  const { w, msgs } = montar(makeZip([{ name: "x.txt", bytes: new TextEncoder().encode("z") }]));
  w.document.body.innerHTML =
    '<table><tr class="azulCentro">' +
    '<td>11.222.333/0001-81</td><td>EMPRESA FICTICIA LTDA</td><td>eFinanceira</td>' +
    '<td>01/2025 a 12/2025</td>' +
    '<td>O processamento da solicitacao ainda nao foi concluido.</td>' +
    '</tr></table>';
  await tick();
  const r = await w.__cratosEcac.colherTodosItens({ numProcesso: "00000081120255180008", pasta: "CRATOS" });
  const certs = msgs.filter((m) => m.tipo === "fabricar_pdf");
  checar(r.ok === true && r.colhidos === 1, "⛔ a linha sem lupa do eFinanceira ENTRA e é colhida (não some)");
  checar(certs.length === 1 && certs[0] && certs[0].titulo === TITULO, "⛔ linha sem link → certidão de consolidação");
  checar(!!certs[0] && /2025/.test((certs[0].linhas || []).join(" ")), "extrai o ano 2025 do campo Ano/Data (01/2025 a 12/2025)");
}

/* ── 8. Guarda de duplicação: coleta 2x no mesmo dia não repete a certidão do ano ──── */
{
  const { w, msgs } = montar(makeZip([{ name: "x.txt", bytes: new TextEncoder().encode("z") }]));
  const tabela =
    '<table><tr class="azulCentro">' +
    '<td>11.222.333/0001-81</td><td>EMPRESA FICTICIA LTDA</td><td>eFinanceira</td>' +
    '<td>01/2025 a 12/2025</td>' +
    '<td>O processamento da solicitacao ainda nao foi concluido.</td>' +
    '</tr></table>';
  w.document.body.innerHTML = tabela;
  await tick();
  await w.__cratosEcac.colherTodosItens({ numProcesso: "00000081120255180008", pasta: "CRATOS" });   // 1ª rodada
  w.document.body.innerHTML = tabela;
  await tick();
  await w.__cratosEcac.colherTodosItens({ numProcesso: "00000081120255180008", pasta: "CRATOS" });   // 2ª rodada
  const certs = msgs.filter((m) => m.tipo === "fabricar_pdf");
  checar(certs.length === 1, "⛔ duas coletas no mesmo dia geram UMA só certidão de consolidação (guarda por Cofre)");
}

console.log("\n=== teste-infojud-efin-pendente.js ===");
oks.forEach((d) => console.log("  ok   " + d));
falhas.forEach((d) => console.log("  FALHA " + d));
console.log(`\n${oks.length} passaram, ${falhas.length} falharam ` +
  `(${oks.length + falhas.length} asserções)\n`);
process.exit(falhas.length ? 1 : 0);

})();
