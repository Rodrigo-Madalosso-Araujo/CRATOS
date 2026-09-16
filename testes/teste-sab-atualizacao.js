/*
 * teste-sab-atualizacao.js — atualização do valor do PJe-Calc para a data de hoje.
 *
 * O QUE ESTÁ SENDO AUTOMATIZADO, e por que isso não é "calcular por conta":
 * a tela de cálculo do PJe pede ao servidor o FATOR do período e multiplica no
 * navegador. Confirmado no HAR de 02/09:
 *     POST /pje-comum-api/api/calculos/taxasatualizacao
 *          ?dataInicial=2026-08-13&dataFinal=2026-09-02   ->  "1.0109"
 * O índice é do PJe. Nós aplicamos, e dizemos que aplicamos.
 *
 * O que esta suíte trava:
 *  1. dataInicial é a **dataLiquidacao** do cálculo, nunca a dataHoraImportacao.
 *     As duas divergem (13/08 vs 13/08 aqui, mas 31/01 vs 19/02 no outro
 *     cálculo do mesmo processo) e o maisPJe já erra isso.
 *  2. Arredondamento de 2 casas, MEIO PARA CIMA: 20.895,00 × 1,0109 =
 *     21.122,7555 -> 21.122,76 (confirmado contra a tela do PJe).
 *  3. ⚠ SALVAGUARDA: fator que não veio NÃO vira valor atualizado. Devolve o
 *     original com a data dele e um motivo — nunca silêncio.
 *  4. O POST leva X-XSRF-TOKEN (o HAR mostra que é obrigatório) e sai do
 *     CONTENT SCRIPT: do background sairia com Origin moz-extension:// e cairia
 *     na armadilha ARQ-516 que o SAB já pagou.
 *  5. ⛔ A certidão só afirma "valor atualizado" se o valor que FOI para a ordem
 *     é o atualizado. O popup deixa editar; documento assinado não pode mentir.
 *
 * Rodar: node teste-sab-atualizacao.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const falhas = [];
const oks = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 20));

/* Cálculo real do processo 0000001-23.2025.5.18.0008 (HAR de 02/09). */
const CALC = {
  total: 20895.00,
  valorFormatado: "R$ 20.895,00",
  dataFormatada: "13/08/2026",
  dataISO: "2026-08-13T13:55:49.996Z",
  dataLiquidacao: "13/08/2026",
  dataLiquidacaoISO: "2026-08-13T00:00:00.000Z",
};

function montar(opts) {
  const o = opts || {};
  const dom = new JSDOM(
    `<!doctype html><html><body><input id="valor" aria-label="Valor da obrigação"></body></html>`,
    { url: "https://pje.trt18.jus.br/sab/determinacoes/nova/processo/999", runScripts: "outside-only" });
  const w = dom.window;
  const mem = {
    "cratos:sab_estado": Object.assign({ ativo: true, idSab: 999, numProcesso: "0000001-23.2025.5.18.0008", calc: CALC }, o.estado || {}),
    "cratos:config": { sab: o.cfg || {} },
  };
  const rede = [];
  const enviadas = [];
  w.browser = {
    storage: {
      local: {
        get: async (k) => ({ [k]: mem[k] }),
        set: async (obj) => Object.assign(mem, obj),
        remove: async () => {},
      },
      onChanged: { addListener: () => {} },
    },
    runtime: {
      sendMessage: async (m) => { enviadas.push(m); return { ok: true }; },
      onMessage: { addListener: () => {} },
      getURL: (p) => p,
    },
  };
  w.document.cookie = "Xsrf-Token=ABC123DEF";
  w.fetch = async (url, init) => {
    const cabec = (init && init.headers) || {};
    rede.push({ url: String(url), metodo: (init && init.method) || "GET", headers: cabec, body: init && init.body });
    if (/taxasatualizacao/.test(String(url))) {
      if (o.fatorErro) return { ok: false, status: o.fatorErro, text: async () => "erro" };
      return { ok: true, status: 200, text: async () => (o.fator === undefined ? "1.0109" : String(o.fator)) };
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
  };
  w.console.log = () => {}; w.console.warn = () => {}; w.console.debug = () => {};
  w.eval(fs.readFileSync(path.join(SRC, "comum", "storage.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(SRC, "comum", "relatorio.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(SRC, "comum", "faixa.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(SRC, "conteudo", "sab.js"), "utf8"));
  return { w, rede, enviadas, mem };
}

(async () => {

/* Versão sem a atualização reprova alto. */
{
  const arq = fs.readFileSync(path.join(SRC, "conteudo", "sab.js"), "utf8");
  if (!/taxasatualizacao/.test(arq)) {
    console.log("\n=== teste-sab-atualizacao.js ===");
    console.log("  FALHA  a versão em " + SRC + " não atualiza o valor: manda para a ordem de " +
      "bloqueio o total do PJe-Calc congelado na data de liquidação (no caso real, " +
      "20 dias de defasagem). É o que esta suíte existe para travar.");
    console.log("\n0 passaram — a suíte inteira reprova nesta versão.\n");
    process.exit(1);
  }
}

const api = () => {
  const { w } = montar();
  return w.__cratosSab;
};
checar(!!api(), "o gancho __cratosSab existe");

/* ── 1. CAMINHO FELIZ: o número e a data ─────────────────────────────────── */
{
  const { w, rede } = montar();
  const r = await w.__cratosSab.atualizarValorParaHoje({ calc: CALC });
  checar(r && r.ok, "com fator do PJe, a atualização acontece");
  checar(r && r.fator === 1.0109, "o fator é o que o PJe devolveu, sem arredondar");
  checar(r && r.atualizado === 21122.76,
    "20.895,00 × 1,0109 = 21.122,7555 -> 21.122,76 (2 casas, MEIO PARA CIMA, como o PJe)");
  checar(r && r.original === 20895.00, "guarda o valor original para a certidão e para a tela");

  const post = rede.find((x) => /taxasatualizacao/.test(x.url));
  checar(!!post && post.metodo === "POST", "a chamada é POST, como no HAR");
  checar(post && /dataInicial=2026-08-13/.test(post.url),
    "⛔ dataInicial é a dataLIQUIDAÇÃO do cálculo, não a data de importação");
  const hoje = new Date();
  const hojeISO = hoje.getFullYear() + "-" + String(hoje.getMonth() + 1).padStart(2, "0") +
    "-" + String(hoje.getDate()).padStart(2, "0");
  checar(post && post.url.indexOf("dataFinal=" + hojeISO) > 0, "dataFinal é hoje");
  checar(post && post.headers["X-XSRF-TOKEN"] === "ABC123DEF",
    "leva o X-XSRF-TOKEN do cookie (o HAR mostra que é obrigatório)");
  checar(post && /^https:\/\/pje\.trt18\.jus\.br\//.test(post.url),
    "same-origin: sai do content script, não do background (armadilha ARQ-516)");
}

/* ── 2. ARREDONDAMENTO, casos de borda ───────────────────────────────────── */
{
  const { w } = montar({ fator: 1.0 });
  const r = await w.__cratosSab.atualizarValorParaHoje({ calc: CALC });
  checar(r.atualizado === 20895.00, "fator 1,0 não mexe no valor");
}
{
  const { w } = montar({ fator: 1.00005 });
  const r = await w.__cratosSab.atualizarValorParaHoje({ calc: CALC });
  /* 20895 × 1.00005 = 20896.04475 -> 20896.04 */
  checar(r.atualizado === 20896.04, "arredonda para baixo quando o terceiro decimal manda");
}

/* ── 3. SALVAGUARDA: sem fator, sem atualização ──────────────────────────── */
{
  const { w } = montar({ fatorErro: 500 });
  const r = await w.__cratosSab.atualizarValorParaHoje({ calc: CALC });
  checar(r && r.ok === false, "erro do PJe NÃO vira valor atualizado");
  checar(r && /500/.test(r.motivo), "o motivo é dito, não engolido");
  checar(!("atualizado" in r), "não devolve valor algum quando falhou");
}
{
  const { w } = montar({ fator: "sei lá" });
  const r = await w.__cratosSab.atualizarValorParaHoje({ calc: CALC });
  checar(r && r.ok === false, "resposta que não é número NÃO vira valor atualizado");
}
{
  const semData = Object.assign({}, CALC, { dataLiquidacaoISO: null });
  const { w, rede } = montar();
  const r = await w.__cratosSab.atualizarValorParaHoje({ calc: semData });
  checar(r && r.ok === false && /liquida/i.test(r.motivo),
    "sem data de liquidação, não inventa período");
  checar(!rede.some((x) => /taxasatualizacao/.test(x.url)),
    "sem data de liquidação, nem chama o PJe");
}

/* ── 4. PREFERÊNCIA ──────────────────────────────────────────────────────── */
{
  const { w, rede } = montar({ cfg: { atualizarValor: "nao" } });
  const r = await w.__cratosSab.atualizarValorParaHoje({ calc: CALC });
  checar(r === null, "desligado nas Preferências: não atualiza");
  checar(!rede.some((x) => /taxasatualizacao/.test(x.url)), "desligado: nem chama o PJe");
}
{
  const { w } = montar({ cfg: {} });
  const r = await w.__cratosSab.atualizarValorParaHoje({ calc: CALC });
  checar(r && r.ok, "sem configuração salva, o padrão é LIGADO");
}

/* ── 5. CÁLCULO JÁ DE HOJE ───────────────────────────────────────────────── */
{
  const hoje = new Date();
  const isoHoje = hoje.toISOString();
  const calcHoje = Object.assign({}, CALC, { dataLiquidacaoISO: isoHoje });
  const { w, rede } = montar();
  const r = await w.__cratosSab.atualizarValorParaHoje({ calc: calcHoje });
  checar(r && r.ok === false && r.semDefasagem === true,
    "cálculo já atualizado até hoje: não há o que corrigir, e isso não é erro");
  checar(!rede.some((x) => /taxasatualizacao/.test(x.url)),
    "cálculo de hoje: não gasta chamada");
}

console.log("\n=== teste-sab-atualizacao.js ===");
oks.forEach((d) => console.log("  ok   " + d));
falhas.forEach((d) => console.log("  FALHA " + d));
console.log(`\n${oks.length} passaram, ${falhas.length} falharam ` +
  `(${oks.length + falhas.length} asserções)\n`);
process.exit(falhas.length ? 1 : 0);

})();
