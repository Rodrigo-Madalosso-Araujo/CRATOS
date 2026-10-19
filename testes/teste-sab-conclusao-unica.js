/*
 * teste-sab-conclusao-unica.js — o SAB conclui (e marca chip/GIGS) UMA vez.
 *
 * Bug de produção (Rodrigo, 17/09/2026): após o SAB, o CRATOS lançava VÁRIAS
 * atividades repetidas no GIGS ("SISBAJUD - SAB em processamento…"). Não fazia
 * antes.
 *
 * Causa (regressão da 1.4.0): em iniciarAutoConclusao, o guarda que impede rodar
 * duas vezes para a mesma determinação passou a ser marcado DEPOIS de um
 * `await Store.ligada()` — inserido junto com o interruptor liga/desliga. O SAB é
 * um SPA e o MutationObserver dispara verificarAutoConclusao() a cada mutação;
 * com um await ENTRE o "checar" e o "marcar", vários disparos passam pela
 * checagem antes de qualquer um marcar o guarda (check-then-act quebrado), e cada
 * um inicia um timer de polling → N conclusões → N `sab_concluido_auto` → N GIGS.
 * (O chip aparece 1× porque o PJe deduplica etiqueta; a atividade do GIGS não.)
 *
 * O conserto tem duas travas:
 *  1. iniciarAutoConclusao marca o guarda SÍNCRONO, antes de qualquer await →
 *     N chamadas simultâneas iniciam UM único timer de polling.
 *  2. concluirSab conclui uma única vez por determinação (defesa em profundidade):
 *     a 2ª chamada para a mesma determinação é no-op → `sab_concluido_auto`
 *     (chip + GIGS) sai uma vez só.
 *
 * Reprova a 1.4.2: lá o hook __cratosSab não expõe iniciarAutoConclusao/concluirSab
 * (o comportamento não era testável) e o guarda pós-await deixava a corrida passar.
 *
 * Rodar: node teste-sab-conclusao-unica.js
 * Versão antiga: CRATOS_SRC=<pasta do xpi> node teste-sab-conclusao-unica.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const falhas = [];
const oks = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 40));

function montar() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://pje.trt18.jus.br/sab/determinacoes/",   // casa o IIFE; NÃO é minuta nova nem tem id (evita auto-conclusão no load)
    runScripts: "outside-only",
  });
  const w = dom.window;
  const mem = {
    "cratos:sab_estado": { ativo: true, operacao: "inclusao", numProcesso: "00000012320255180008" },
  };
  const msgs = [];
  let intervalCount = 0;
  w.browser = {
    storage: { local: {
      get: async (k) => ({ [k]: mem[k] }),
      set: async (o) => Object.assign(mem, o),
      remove: async () => {},
    }, onChanged: { addListener() {} } },
    runtime: {
      sendMessage: async (m) => { msgs.push(m); return { ok: true }; },
      onMessage: { addListener() {} },
      getURL: (p) => "moz-extension://x/" + p,
    },
    downloads: { download: async () => 1 },
  };
  w.CratosFaixa = { parar() {}, alertar() {}, dizer() {}, mostrar() {} };
  w.CHAVES = { config: "config" };
  /* Conta timers de polling sem agendar de verdade (evita o fetch de 3 em 3s). */
  w.setInterval = () => { intervalCount++; return 0; };
  w.clearInterval = () => {};
  w.fetch = async () => ({ ok: true, status: 200, json: async () => ({ situacao: "AUTORIZADA" }) });
  w.console.log = () => {}; w.console.warn = () => {}; w.console.debug = () => {}; w.console.error = () => {};
  w.eval(fs.readFileSync(path.join(SRC, "comum", "storage.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(SRC, "conteudo", "sab.js"), "utf8"));
  return { w, mem, msgs, contarIntervals: () => intervalCount };
}

(async () => {

/* Gate: o comportamento precisa estar exposto para o teste. */
{
  const { w } = montar();
  await tick();
  const S = w.__cratosSab;
  if (!S || typeof S.iniciarAutoConclusao !== "function" || typeof S.concluirSab !== "function") {
    console.log("\n=== teste-sab-conclusao-unica.js ===");
    console.log("  FALHA  a versão em " + SRC + " não expõe iniciarAutoConclusao/concluirSab " +
      "(__cratosSab) — a conclusão única do SAB não é testável, e o GIGS repetia.");
    console.log("\n0 passaram — a suíte inteira reprova nesta versão.\n");
    process.exit(1);
  }
}

/* ── 1. A CORRIDA: N chamadas simultâneas → UM único timer de polling ───────── */
{
  const { w, contarIntervals } = montar();
  await tick();
  const N = 6;
  await Promise.all(Array.from({ length: N }, () => w.__cratosSab.iniciarAutoConclusao("555")));
  await tick();
  checar(contarIntervals() === 1,
    "⛔ " + N + " chamadas simultâneas de iniciarAutoConclusao iniciam UM só timer (guarda síncrona)");
}

/* ── 2. A DEFESA EM PROFUNDIDADE: concluirSab dispara uma vez por determinação ─ */
{
  const { w, msgs } = montar();
  await tick();
  const est = { ativo: true, operacao: "inclusao", numProcesso: "00000012320255180008" };
  const det = { situacao: "AUTORIZADA", processo: { numero: "00000012320255180008" }, exequente: { nome: "X" } };
  await w.__cratosSab.concluirSab(est, det, "777");
  await w.__cratosSab.concluirSab(est, det, "777");   // 2ª vez: deve ser no-op
  await tick();
  const nConcluido = msgs.filter((m) => m && m.tipo === "sab_concluido_auto").length;
  const nCertidao = msgs.filter((m) => m && m.tipo === "sab_certidao").length;
  checar(nConcluido === 1,
    "⛔ concluirSab dispara `sab_concluido_auto` (chip + GIGS) UMA vez por determinação");
  checar(nCertidao === 1, "e a certidão é solicitada uma vez só");
}

/* ── 3. Determinação DIFERENTE conclui normalmente (o guarda não trava tudo) ── */
{
  const { w, msgs } = montar();
  await tick();
  const est = { ativo: true, operacao: "inclusao", numProcesso: "00000012320255180008" };
  const det = { situacao: "AUTORIZADA", processo: { numero: "00000012320255180008" }, exequente: { nome: "X" } };
  await w.__cratosSab.concluirSab(est, det, "801");
  await w.__cratosSab.concluirSab(est, det, "802");   // outra determinação: conclui também
  await tick();
  const n = msgs.filter((m) => m && m.tipo === "sab_concluido_auto").length;
  checar(n === 2, "determinações distintas concluem cada uma a sua vez (o guarda é por determinação)");
}

console.log("\n=== teste-sab-conclusao-unica.js ===");
oks.forEach((d) => console.log("  ok   " + d));
falhas.forEach((d) => console.log("  FALHA " + d));
console.log(`\n${oks.length} passaram, ${falhas.length} falharam ` +
  `(${oks.length + falhas.length} asserções)\n`);
process.exit(falhas.length ? 1 : 0);

})();
