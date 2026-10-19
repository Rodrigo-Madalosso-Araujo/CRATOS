/*
 * teste-serasajud-manual.js — lançamento MANUAL de valor/data quando não há cálculo.
 *
 * Bug de campo (29/09): um usuário rodou a BAIXA do SerasaJUD num processo SEM cálculo
 * nos autos. O módulo de fundo abortava ("Não achei o valor da dívida" / "A baixa exige
 * a Data da Dívida") e a diligência morria com erro. Pedido: em vez de erro, abrir um
 * popup para o usuário LANÇAR o valor (e, na baixa, a data), como o popup de valor do
 * SAB — esperando SEM PRAZO, pois ele pode ter de buscar o número em outra fonte.
 *
 * O que se trava aqui:
 *   1. Background NÃO aborta mais por falta de valor/data — marca pendência e abre a aba
 *      (reprova a versão que retornava {ok:false} com "Não achei o valor da dívida").
 *   2. garantirDadosManuais mostra o popup e, ao Confirmar, preenche o estado + origem
 *      manual e persiste.
 *   3. Cancelar (faço à mão) → encerra limpo (CratosFaixa.parar) e devolve false.
 *   4. Entrada inválida mantém o popup aberto (não resolve) — só some com dado válido.
 *   5. Normalizadores de valor (pt-BR) e data (dd/mm/aaaa, real, não futura).
 *   6. Espera SEM timeout: o popup só resolve por ação do usuário.
 *
 * Reprova a 1.5.3 (sem garantirDadosManuais; background abortava).
 *
 * Rodar: node teste-serasajud-manual.js
 * Versão antiga: CRATOS_SRC=<pasta do xpi> node teste-serasajud-manual.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const falhas = [];
const oks = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 20));

function montar() {
  const dom = new JSDOM(
    "<!doctype html><html><body></body></html>",
    { url: "https://serasa-judicial.serasaexperian.com.br/cadastrar-ordem", runScripts: "outside-only" });
  const w = dom.window;
  const mem = {};
  const paradas = [];
  w.browser = {
    storage: { local: {
      get: async (k) => ({ [k]: mem[k] }),
      set: async (o) => Object.assign(mem, o),
      remove: async () => {},
    } },
    runtime: { sendMessage: async () => ({ ok: true }), onMessage: { addListener() {} }, getURL: (p) => "moz-extension://x/" + p },
    downloads: { download: async () => 1 },
  };
  w.CratosFaixa = { parar(mod, msg) { paradas.push(msg); }, alertar() {}, dizer() {}, mostrar() {} };
  w.console.log = () => {}; w.console.warn = () => {}; w.console.error = () => {};
  w.eval(fs.readFileSync(path.join(SRC, "comum", "storage.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(SRC, "conteudo", "serasajud.js"), "utf8"));
  return { w, d: w.document, paradas, mem };
}

(async () => {

/* ── Gate 1: o content script expõe garantirDadosManuais? ─────────────────────── */
{
  const { w } = montar();
  const api = w.__cratosSerasajud || {};
  if (typeof api.garantirDadosManuais !== "function" || typeof api._normalizarValorBRL !== "function") {
    console.log("\n=== teste-serasajud-manual.js ===");
    console.log("  FALHA  a versão em " + SRC + " não tem o lançamento manual do SerasaJUD " +
      "(sem __cratosSerasajud.garantirDadosManuais).");
    console.log("\n0 passaram — a suíte inteira reprova nesta versão.\n");
    process.exit(1);
  }
}

/* ── Gate 2 (background): parou de abortar por falta de valor/data ─────────────── */
{
  const mod = fs.readFileSync(path.join(SRC, "modulos", "serasajud.js"), "utf8");
  checar(!/Não achei o valor da dívida/.test(mod) && !/A baixa exige a Data da Dívida/.test(mod),
    "⛔ o background NÃO aborta mais por falta de valor/data (mensagens antigas removidas)");
  checar(/valorPendente/.test(mod) && /dataPendente/.test(mod),
    "⛔ o background marca valorPendente/dataPendente e abre a aba");
}

/* ── 3. Normalizador de valor (pt-BR) ─────────────────────────────────────────── */
{
  const { w } = montar();
  const n = w.__cratosSerasajud._normalizarValorBRL;
  checar(n("12.550,51") === "R$ 12.550,51", "valor '12.550,51' → 'R$ 12.550,51'");
  checar(n("1234,5") === "R$ 1.234,50", "valor '1234,5' → 'R$ 1.234,50'");
  checar(n("1000") === "R$ 1.000,00", "valor inteiro '1000' → 'R$ 1.000,00'");
  checar(n("R$ 2.000,00") === "R$ 2.000,00", "aceita com o R$ na frente");
  checar(n("") === null && n("abc") === null && n("0") === null,
    "vazio / não-número / zero → inválido (null)");
}

/* ── 4. Normalizador de data (dd/mm/aaaa, real, não futura) ────────────────────── */
{
  const { w } = montar();
  const dt = w.__cratosSerasajud._normalizarDataBR;
  checar(dt("5/3/2024") === "05/03/2024", "completa zeros à esquerda: '5/3/2024' → '05/03/2024'");
  checar(dt("31/02/2024") === null, "31/02 não existe → inválida");
  checar(dt("31/12/2999") === null, "data futura → inválida (dívida não é do futuro)");
  checar(dt("2024-03-05") === null && dt("") === null, "formato errado/vazio → inválida");
}

/* ── 5. BAIXA sem valor e sem data → popup pede os dois; Confirmar preenche o estado ─ */
{
  const { w, d, mem } = montar();
  const est = { ativo: true, operacao: "baixa", numProcesso: "x", valor: null,
    dataLiquidacao: null, valorPendente: true, dataPendente: true, config: {} };
  const p = w.__cratosSerasajud.garantirDadosManuais(est);   // não await: popup fica no ar
  await tick();
  const overlay = d.getElementById("cratos-serasajud-popup");
  checar(!!overlay, "⛔ sem valor/data, o popup aparece (não dá erro)");
  const inpValor = d.getElementById("cratos-sj-valor");
  const inpData = d.getElementById("cratos-sj-data");
  checar(!!inpValor && !!inpData, "pede VALOR e DATA na baixa");
  inpValor.value = "12.550,51";
  inpData.value = "31/12/2024";
  d.getElementById("cratos-sj-confirmar").click();
  const ok = await p;
  checar(ok === true, "Confirmar resolve true");
  checar(est.valor === "R$ 12.550,51" && est.dataLiquidacao === "31/12/2024",
    "⛔ o estado recebe valor e data lançados");
  checar(est.origemManual === true && est.valorManual === true && est.dataManual === true,
    "⛔ marca origem manual (valor e data) para a certidão");
  checar(!est.valorPendente && !est.dataPendente, "limpa as pendências");
  checar(!d.getElementById("cratos-serasajud-popup"), "o popup some ao confirmar");
}

/* ── 6. Só a DATA pendente (PJe-Calc trouxe o valor) → popup pede só a data ────── */
{
  const { w, d } = montar();
  const est = { ativo: true, operacao: "baixa", valor: "R$ 3.000,00",
    dataLiquidacao: null, valorPendente: false, dataPendente: true, config: {} };
  const p = w.__cratosSerasajud.garantirDadosManuais(est);
  await tick();
  checar(!d.getElementById("cratos-sj-valor"), "não pede o valor (já veio do cálculo)");
  checar(!!d.getElementById("cratos-sj-data"), "⛔ pede só a data da dívida");
  d.getElementById("cratos-sj-data").value = "01/06/2024";
  d.getElementById("cratos-sj-confirmar").click();
  const ok = await p;
  checar(ok === true && est.dataLiquidacao === "01/06/2024" && est.dataManual === true && !est.valorManual,
    "⛔ preenche só a data; valor do cálculo intacto; origem manual só da data");
}

/* ── 7. Cancelar (faço à mão) → false + parada limpa (não trava) ───────────────── */
{
  const { w, d, paradas } = montar();
  const est = { ativo: true, operacao: "baixa", valor: null, dataLiquidacao: null,
    valorPendente: true, dataPendente: true, config: {} };
  const p = w.__cratosSerasajud.garantirDadosManuais(est);
  await tick();
  d.getElementById("cratos-sj-cancelar").click();
  const ok = await p;
  checar(ok === false, "⛔ Cancelar devolve false (fluxo aborta)");
  checar(paradas.length === 1 && /à mão/.test(paradas[0]), "⛔ encerra com faixa vermelha ('faço à mão')");
  checar(!d.getElementById("cratos-serasajud-popup"), "o popup some ao cancelar");
}

/* ── 8. Entrada inválida NÃO fecha o popup; corrige e confirma ─────────────────── */
{
  const { w, d } = montar();
  const est = { ativo: true, operacao: "inclusao", valor: null,
    valorPendente: true, dataPendente: false, config: {} };
  const p = w.__cratosSerasajud.garantirDadosManuais(est);
  await tick();
  checar(!d.getElementById("cratos-sj-data"), "inclusão não pede data (só a baixa exige)");
  d.getElementById("cratos-sj-valor").value = "xxx";
  d.getElementById("cratos-sj-confirmar").click();
  await tick();
  checar(!!d.getElementById("cratos-serasajud-popup"), "⛔ valor inválido MANTÉM o popup aberto");
  const erro = d.getElementById("cratos-sj-erro");
  checar(erro && erro.style.display !== "none", "mostra a mensagem de erro");
  d.getElementById("cratos-sj-valor").value = "5.000,00";
  d.getElementById("cratos-sj-confirmar").click();
  const ok = await p;
  checar(ok === true && est.valor === "R$ 5.000,00", "⛔ corrigido e confirmado, resolve com o valor");
}

/* ── 9. Sem pendência → não mostra popup (caminho normal com cálculo) ──────────── */
{
  const { w, d } = montar();
  const est = { ativo: true, operacao: "inclusao", valor: "R$ 9,00",
    valorPendente: false, dataPendente: false, config: {} };
  const ok = await w.__cratosSerasajud.garantirDadosManuais(est);
  checar(ok === true && !d.getElementById("cratos-serasajud-popup"),
    "com valor já resolvido, segue direto sem popup");
}

/* ── 10. Espera SEM timeout: o popup não se fecha sozinho ──────────────────────── */
{
  const { w, d } = montar();
  const est = { ativo: true, operacao: "inclusao", valor: null,
    valorPendente: true, dataPendente: false, config: {} };
  let resolveu = false;
  const p = w.__cratosSerasajud.garantirDadosManuais(est).then((r) => { resolveu = true; return r; });
  await tick(120);
  checar(resolveu === false && !!d.getElementById("cratos-serasajud-popup"),
    "⛔ após esperar, o popup segue aberto (sem timeout) até o usuário agir");
  d.getElementById("cratos-sj-valor").value = "7,00";
  d.getElementById("cratos-sj-confirmar").click();
  await p;
  checar(resolveu === true, "só resolve quando o usuário confirma");
}

console.log("\n=== teste-serasajud-manual.js ===");
oks.forEach((x) => console.log("  ok   " + x));
falhas.forEach((x) => console.log("  FALHA " + x));
console.log(`\n${oks.length} passaram, ${falhas.length} falharam ` +
  `(${oks.length + falhas.length} asserções)\n`);
process.exit(falhas.length ? 1 : 0);

})();
