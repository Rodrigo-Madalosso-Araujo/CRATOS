/*
 * teste-infojud-pulso.js — o INFOJUD avisa o painel quando o REGISTRO acaba.
 *
 * O Rodrigo testou em campo (1.2.0) e o INFOJUD não concluiu sozinho: ele
 * registrou os pedidos e ficou esperando o clique. Diagnóstico: o INFOJUD é o
 * único convênio que NÃO produz certidão na hora (a resposta vem na caixa postal,
 * depois), então o pulso central do background — que nasce da CHEGADA do artefato
 * — nunca dispara para ele. O sinal certo, como o próprio Rodrigo apontou, é a
 * ÚLTIMA tela de "solicitação registrada", depois de escoar a fila de pedidos:
 * `finalizarRegistro()`. É lá que o pulso passou a nascer.
 *
 *   · registro limpo  → pulso ok:true  → o painel avança sozinho;
 *   · com anomalias   → pulso ok:false → o painel SEGUE e sinaliza (INFOJUD é
 *                        consulta), e a aba fica aberta para conferência.
 *
 * Rodar: node teste-infojud-pulso.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const falhas = [];
const oks = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 60));

const NUM = "0000001-23.2025.5.18.0008";

function montar() {
  /* DOM SEM o formulário de registro (sem input[name=processo]/novocpfcnpj): assim
     o iniciarRegistroEcac agendado no load bail cedo (linha "contexto sem
     formulário") e não mexe na ecac_fila enquanto testamos o finalizarRegistro. */
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://cav.receita.fazenda.gov.br/ecac/",
    runScripts: "outside-only",
  });
  const w = dom.window;
  const mem = {};
  w.browser = {
    storage: {
      local: {
        get: async (k) => ({ [k]: mem[k] }),
        set: async (o) => { Object.assign(mem, o); },
        remove: async (k) => { delete mem[k]; },
      },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
    runtime: {
      sendMessage: async () => ({ ok: true }),
      onMessage: { addListener: () => {} },
      getURL: (p) => p,
    },
  };
  const faixas = [];
  w.CratosFaixa = {
    parar: (m, t) => faixas.push(["parar", t]),
    alertar: (m, t) => faixas.push(["alertar", t]),
    dizer: (m, t) => faixas.push(["dizer", t]),
    mostrar: () => {},
  };
  w.console.log = () => {}; w.console.warn = () => {}; w.console.debug = () => {};
  w.eval(fs.readFileSync(path.join(SRC, "comum", "storage.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(SRC, "conteudo", "ecac-infojud.js"), "utf8"));
  return { w, mem, faixas };
}

(async () => {

/* ── 0. A VERSÃO SEM O PULSO DO INFOJUD REPROVA ──────────────────────────── */
{
  const { w } = montar();
  if (!w.__cratosEcac || typeof w.__cratosEcac.finalizarRegistro !== "function") {
    console.log("\n=== teste-infojud-pulso.js ===");
    console.log("  FALHA  a versão em " + SRC + " não expõe/emite o pulso do INFOJUD: " +
      "finalizarRegistro não avisa o painel, então o INFOJUD registra e NÃO avança " +
      "sozinho — foi o que o Rodrigo viu em campo.");
    console.log("\n0 passaram — a suíte inteira reprova nesta versão.\n");
    process.exit(1);
  }
}

/* ── 1. REGISTRO LIMPO → PULSO ok:true ───────────────────────────────────── */
{
  const { w } = montar();
  await w.Store.set("ecac_fila", { partes: [{ processo: NUM, ni: "111", nome: "FULANO" }], idx: 1 });
  await w.Store.set("ecac_anomalias", []);
  await w.__cratosEcac.finalizarRegistro();
  const p = await w.Store.get("orq_conv_feito");
  checar(!!p, "emitiu o pulso de conclusão");
  checar(p && String(p.convenio).toUpperCase() === "INFOJUD", "o pulso é do INFOJUD");
  checar(p && String(p.numProcesso).replace(/\D/g, "") === NUM.replace(/\D/g, ""),
    "⛔ carrega o número do processo (o painel casa por ele)");
  checar(p && p.ok === true && p.feitos === 1 && p.esperados === 1,
    "⛔ registro limpo → ok:true, 1 de 1 → o painel AVANÇA sozinho");
  checar(p && typeof p.em === "number", "traz o carimbo de tempo (o painel descarta pulso velho)");
}

/* ── 2. REGISTRO COM ANOMALIAS → PULSO ok:false (segue e sinaliza) ────────── */
{
  const { w, faixas } = montar();
  await w.Store.set("ecac_fila", { partes: [{ processo: NUM, ni: "111", nome: "FULANO" }], idx: 1 });
  await w.Store.set("ecac_anomalias", [{ texto: "o eCAC errou o combobox de anos" }]);
  await w.__cratosEcac.finalizarRegistro();
  const p = await w.Store.get("orq_conv_feito");
  checar(p && p.ok === false && p.feitos === 0,
    "⛔ com anomalia → ok:false: o painel SEGUE e sinaliza (INFOJUD é consulta), não trava");
  checar(p && /ocorrência|confira|eCAC/i.test(String(p.motivo || "")),
    "o motivo explica que houve ocorrência a conferir");
  checar(faixas.some((f) => f[0] === "alertar"), "e a faixa amarela avisa na aba do eCAC");
  const fila = await w.Store.get("ecac_fila");
  checar(!fila, "a ecac_fila foi limpa no caminho de anomalia (como antes)");
}

/* ── 3. SEM PROCESSO NA FILA → NÃO INVENTA PULSO ─────────────────────────── */
{
  const { w } = montar();
  await w.Store.set("ecac_fila", { partes: [{ ni: "111", nome: "FULANO" }], idx: 1 });  // sem .processo
  await w.Store.set("ecac_anomalias", []);
  await w.__cratosEcac.finalizarRegistro();
  const p = await w.Store.get("orq_conv_feito");
  checar(!p, "sem número de processo, não emite pulso (melhor calar que emitir sem destino)");
}

console.log("\n=== teste-infojud-pulso.js ===");
oks.forEach((d) => console.log("  ok   " + d));
falhas.forEach((d) => console.log("  FALHA " + d));
console.log(`\n${oks.length} passaram, ${falhas.length} falharam ` +
  `(${oks.length + falhas.length} asserções)\n`);
process.exit(falhas.length ? 1 : 0);

})();
