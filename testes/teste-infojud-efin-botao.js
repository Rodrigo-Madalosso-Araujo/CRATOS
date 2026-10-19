/*
 * teste-infojud-efin-botao.js — o botão exclusivo "Baixar só o e-Financeira".
 *
 * Pedido do Rodrigo / beta-tester (21/09/2026): como o eFinanceira é assíncrono, no
 * dia seguinte o usuário quer um botão que colhe SÓ o e-Financeira do processo (os
 * demais tipos já vieram no dia 1) e já junta o(s) PDF(s). A coleta focada é o
 * `colherTodosItens` filtrando os itens da tela de resultado para eFinanceira.
 *
 * Trava:
 *   1. Com soEfin, colherTodosItens ignora DIRPF/DOI/etc. e colhe só o eFinanceira.
 *   2. Sem item de eFinanceira na tela, devolve semEfin (não colhe os outros à toa).
 *   3. A fiação existe de ponta a ponta: painel (botão) → coletar_tudo(soEfin) →
 *      background (coleta_estado.soEfin) → content script (filtro).
 *
 * Reprova a 1.4.3: lá colherTodosItens não conhece soEfin (colheria tudo) e o
 * painel não tem o botão.
 *
 * Rodar: node teste-infojud-efin-botao.js
 * Versão antiga: CRATOS_SRC=<pasta do xpi> node teste-infojud-efin-botao.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const falhas = [];
const oks = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 30));

/* Zip STORE mínimo com um "PDF". */
function zipComPdf() {
  const enc = new TextEncoder();
  const data = enc.encode("%PDF-1.4\n%x\n");
  const nameB = enc.encode("extrato-efinanceira-1.pdf");
  const lh = new Uint8Array(30 + nameB.length); let dv = new DataView(lh.buffer);
  dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(8, 0, true);
  dv.setUint32(18, data.length, true); dv.setUint32(22, data.length, true); dv.setUint16(26, nameB.length, true);
  lh.set(nameB, 30);
  const ch = new Uint8Array(46 + nameB.length); dv = new DataView(ch.buffer);
  dv.setUint32(0, 0x02014b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 20, true); dv.setUint16(10, 0, true);
  dv.setUint32(20, data.length, true); dv.setUint32(24, data.length, true); dv.setUint16(28, nameB.length, true);
  dv.setUint32(42, 0, true); ch.set(nameB, 46);
  const eocd = new Uint8Array(22); dv = new DataView(eocd.buffer);
  dv.setUint32(0, 0x06054b50, true); dv.setUint16(8, 1, true); dv.setUint16(10, 1, true);
  dv.setUint32(12, ch.length, true); dv.setUint32(16, lh.length + data.length, true);
  const parts = [lh, data, ch, eocd];
  let total = 0; for (const p of parts) total += p.length;
  const out = new Uint8Array(total); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/* Linha da tabela de resultado: [ni, nome, tipo, anoData, <a ...>]. */
function linha(ni, nome, tipo, ano, aAttr) {
  return `<tr class="azulCentro"><td>${ni}</td><td>${nome}</td><td>${tipo}</td><td>${ano}</td><td><a ${aAttr}>ver</a></td></tr>`;
}

function montar(htmlLinhas) {
  const html = `<form id="formResultado" action="visualizardeclaracao.asp" method="post">
    <input id="acao"><input id="numSolicitacao"><input id="tipoInformacao"><input id="indicePedido"><input id="nirf">
    <table>${htmlLinhas.join("")}</table></form>`;
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    url: "https://cav.receita.fazenda.gov.br/servicos/ATSDR/decjuiz/resultadoSolicitacao.asp?numeroSolicitacao=1",
    runScripts: "outside-only",
  });
  const w = dom.window;
  const msgs = [];
  const zip = zipComPdf();
  w.CratosFaixa = { parar() {}, alertar() {}, dizer() {}, mostrar() {} };
  w.fetch = async () => ({ ok: true, status: 200, arrayBuffer: async () => zip.buffer.slice(0) });
  w.browser = {
    storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} }, onChanged: { addListener: () => {} } },
    runtime: {
      sendMessage: async (m) => {
        msgs.push(m);
        if (m && m.tipo === "efin_zip") return { ok: true, arquivos: ["CRATOS/x eFinanceira (" + (String(m.exercicio || "").slice(-4)) + ").pdf"] };
        if (m && m.tipo === "baixar_pdf_base64") return { ok: true, filename: `CRATOS/x ${m.tipoLabel}.${m.ext}` };
        return { ok: true };
      },
      onMessage: { addListener: () => {} }, getURL: (p) => p,
    },
  };
  w.console.log = () => {}; w.console.warn = () => {}; w.console.debug = () => {}; w.console.error = () => {};
  w.eval(fs.readFileSync(path.join(SRC, "comum", "storage.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(SRC, "conteudo", "ecac-infojud.js"), "utf8"));
  return { w, msgs };
}

/* Gate síncrono: a fiação do botão precisa existir. */
{
  const arqEcac = fs.readFileSync(path.join(SRC, "conteudo", "ecac-infojud.js"), "utf8");
  const arqPainel = fs.readFileSync(path.join(SRC, "conteudo", "painel.js"), "utf8");
  const arqBg = fs.readFileSync(path.join(SRC, "background.js"), "utf8");
  const okFiacao =
    /contexto\.soEfin/.test(arqEcac) &&
    /Baixar só o e-Financeira/.test(arqPainel) &&
    /coletarTudo\(msg\.numeroProcesso, msg\.pasta, msg\.soEfin\)/.test(arqBg);
  if (!okFiacao || !fs.existsSync(path.join(SRC, "comum", "unzip.js"))) {
    console.log("\n=== teste-infojud-efin-botao.js ===");
    console.log("  FALHA  a versão em " + SRC + " não tem o botão exclusivo do e-Financeira " +
      "(sem filtro soEfin em colherTodosItens / botão no painel / soEfin no coletar_tudo).");
    console.log("\n0 passaram — a suíte inteira reprova nesta versão.\n");
    process.exit(1);
  }
}

(async () => {

/* ── 1. soEfin colhe SÓ o e-Financeira, ignorando os demais ─────────────────── */
{
  const { w, msgs } = montar([
    linha("11122233344", "FULANO", "DIRPF", "2024", "onclick=\"obterInformacao('visualizar','555','1','0','','_self')\""),
    linha("11122233344", "FULANO", "DOI", "2024", "onclick=\"obterInformacao('visualizar','555','8','0','','_self')\""),
    linha("11122233344", "FULANO", "EFINANCEIRA", "2023", "href=\"https://x/efin.zip\""),
  ]);
  await tick();
  const r = await w.__cratosEcac.colherTodosItens({ numProcesso: "00000092220255180128", pasta: "CRATOS", soEfin: true });
  const efinMsgs = msgs.filter((m) => m.tipo === "efin_zip");
  checar(r.ok && r.total === 1, "⛔ soEfin: só 1 item colhido (o eFinanceira), os demais ignorados");
  checar(efinMsgs.length === 1 && efinMsgs[0].exercicio === "2023",
    "⛔ manda só o zip do eFinanceira ao background, com o exercício (2023)");
  checar(!msgs.some((m) => m.tipo === "baixar_pdf_base64"),
    "não dispara os downloads dos outros tipos (DIRPF/DOI ficaram de fora)");
}

/* ── 2. Sem eFinanceira na tela → semEfin, não colhe os outros ──────────────── */
{
  const { w, msgs } = montar([
    linha("11122233344", "FULANO", "DIRPF", "2024", "onclick=\"obterInformacao('visualizar','555','1','0','','_self')\""),
  ]);
  await tick();
  const r = await w.__cratosEcac.colherTodosItens({ numProcesso: "00000092220255180128", pasta: "CRATOS", soEfin: true });
  checar(r.ok && r.semEfin === true && r.total === 0, "⛔ sem eFinanceira → semEfin (não colhe DIRPF à toa)");
  checar(msgs.filter((m) => m.tipo === "baixar_pdf_base64").length === 0, "e não baixa nada");
}

/* ── 3. A fiação de ponta a ponta (painel → background → content) ───────────── */
{
  const arqPainel = fs.readFileSync(path.join(SRC, "conteudo", "painel.js"), "utf8");
  const arqBg = fs.readFileSync(path.join(SRC, "background.js"), "utf8");
  checar(/id="cx-colher-efin"/.test(arqPainel) && /colherTudo\(true\)/.test(arqPainel),
    "o painel tem o botão e chama colherTudo(true)");
  checar(/soEfin: !!soEfin/.test(arqPainel), "o painel envia soEfin no coletar_tudo");
  checar(/soEfin: !!soEfin/.test(arqBg), "o background grava soEfin no coleta_estado");
}

console.log("\n=== teste-infojud-efin-botao.js ===");
oks.forEach((d) => console.log("  ok   " + d));
falhas.forEach((d) => console.log("  FALHA " + d));
console.log(`\n${oks.length} passaram, ${falhas.length} falharam ` +
  `(${oks.length + falhas.length} asserções)\n`);
process.exit(falhas.length ? 1 : 0);

})();
