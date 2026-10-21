/*
 * teste-infojud-efinanceira.js — as opções finas do eFinanceira nas Preferências.
 *
 * Pedido do Rodrigo (21/09/2026): expor nas configurações o que o InfoJOB já
 * oferecia — Tipo de conta, Tipo de relação, Exibir câmbio e Tipo de extrato —,
 * com o padrão recomendado pela orientação do Tribunal (relatório detalhado):
 * Todas / Todas / Sim / Contas e movimentações. E o ANO sempre a partir do ano
 * anterior FECHADO (anoAtual-1 para trás), nunca o corrente.
 *
 * O que se trava aqui: o gerarListaPedidos passa essas opções para cada pedido de
 * eFinanceira (o incluirPedido, herdado do InfoJOB, já sabe preenchê-las na tela
 * pelos selects novoTipoConta/novoTipoRelacao/novoInfoCambio/novoTipoExtrato).
 * Config antiga, sem esses campos, cai no padrão recomendado — então o eFinanceira
 * já sai detalhado sem o usuário reconfigurar.
 *
 * Reprova a 1.4.3: lá o pedido de eFinanceira saía só com {dataIni,dataFim} (sem
 * conta/relação/câmbio/extrato) e o hook __cratosEcac nem expunha gerarListaPedidos.
 *
 * Rodar: node teste-infojud-efinanceira.js
 * Versão antiga: CRATOS_SRC=<pasta do xpi> node teste-infojud-efinanceira.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const falhas = [];
const oks = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 30));

function montar() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://cav.receita.fazenda.gov.br/Servicos/ATSDR/Decjuiz/solicitacao.asp",
    runScripts: "outside-only",
  });
  const w = dom.window;
  w.CratosFaixa = { parar() {}, alertar() {}, dizer() {}, mostrar() {} };
  w.browser = {
    storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
               onChanged: { addListener: () => {} } },
    runtime: { sendMessage: async () => ({ ok: true }), onMessage: { addListener: () => {} }, getURL: (p) => p },
  };
  w.console.log = () => {}; w.console.warn = () => {}; w.console.debug = () => {}; w.console.error = () => {};
  w.eval(fs.readFileSync(path.join(SRC, "comum", "storage.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(SRC, "conteudo", "ecac-infojud.js"), "utf8"));
  return { w };
}

const soEfin = (lista) => lista.filter((p) => p.tipo === "eFinanceira");

(async () => {

/* Gate: o comportamento precisa estar exposto para o teste. */
{
  const { w } = montar();
  await tick();
  const E = w.__cratosEcac;
  if (!E || typeof E.gerarListaPedidos !== "function") {
    console.log("\n=== teste-infojud-efinanceira.js ===");
    console.log("  FALHA  a versão em " + SRC + " não expõe gerarListaPedidos (__cratosEcac) — " +
      "as opções finas do eFinanceira não são testáveis e o pedido saía só com datas.");
    console.log("\n0 passaram — a suíte inteira reprova nesta versão.\n");
    process.exit(1);
  }
}

const anoAtual = new Date().getFullYear();

/* ── 1. Opções configuradas propagam para cada pedido ───────────────────────── */
{
  const { w } = montar();
  await tick();
  const cfg = { cpf: {
    efin: { ativo: true, anos: 2 },
    efin_conta: "Conta de Investimento",
    efin_relacao: "Titular",
    efin_cambio: "Não",
    efin_extrato: "Somente da lista de contas",
  } };
  const lista = soEfin(await w.__cratosEcac.gerarListaPedidos({ ni: "12345678901", tipo: "CPF" }, cfg));
  checar(lista.length === 2, "⛔ anos=2 gera 2 pedidos de eFinanceira");
  const ok = lista.every((p) =>
    p.opcoes.conta === "Conta de Investimento" &&
    p.opcoes.relacao === "Titular" &&
    p.opcoes.cambio === "Não" &&
    p.opcoes.extrato === "Somente da lista de contas");
  checar(ok, "⛔ cada pedido leva conta/relação/câmbio/extrato conforme a config");
}

/* ── 2. Config ANTIGA (sem os campos) cai no padrão recomendado ─────────────── */
{
  const { w } = montar();
  await tick();
  const cfg = { cpf: { efin: { ativo: true, anos: 1 } } };   // como era antes: só o toggle
  const lista = soEfin(await w.__cratosEcac.gerarListaPedidos({ ni: "12345678901", tipo: "CPF" }, cfg));
  checar(lista.length === 1, "anos=1 gera 1 pedido");
  const p = lista[0];
  checar(p.opcoes.conta === "Todas" && p.opcoes.relacao === "Todas" &&
         p.opcoes.cambio === "Sim" && p.opcoes.extrato === "Contas e movimentações",
    "⛔ sem os campos, o padrão é Todas / Todas / Sim / Contas e movimentações");
}

/* ── 3. O período é sempre o ano anterior FECHADO, nunca o corrente — e o pedido
       NÃO carrega `ano` (isso mandava o eFinanceira pro dropdown de ano e travava) ── */
{
  const { w } = montar();
  await tick();
  const cfg = { cpf: { efin: { ativo: true, anos: 3 } } };
  const lista = soEfin(await w.__cratosEcac.gerarListaPedidos({ ni: "12345678901", tipo: "CPF" }, cfg));
  // O ano é derivado do PERÍODO (dataIni "01/AAAA"), não de um campo `ano`.
  const anos = lista.map((p) => Number((p.opcoes.dataIni || "").slice(3))).sort((a, b) => b - a);
  checar(JSON.stringify(anos) === JSON.stringify([anoAtual - 1, anoAtual - 2, anoAtual - 3]),
    "⛔ anos=3 → os 3 anos anteriores fechados (" + (anoAtual - 1) + ", " + (anoAtual - 2) + ", " + (anoAtual - 3) + ")");
  checar(!anos.includes(anoAtual), "⛔ o ano corrente (" + anoAtual + ") NUNCA entra");
  checar(lista.every((p) => p.opcoes.ano === undefined),
    "⛔ o pedido de eFinanceira NÃO carrega `ano` (senão cai no dropdown de ano do eCAC e trava)");
  const p = lista.find((x) => (x.opcoes.dataIni || "").slice(3) === String(anoAtual - 1));
  checar(p.opcoes.dataIni === "01/" + (anoAtual - 1) && p.opcoes.dataFim === "12/" + (anoAtual - 1),
    "o período é de janeiro a dezembro do ano");
}

/* ── 4. eFinanceira desligado não gera pedido ───────────────────────────────── */
{
  const { w } = montar();
  await tick();
  const cfg = { cpf: { efin: { ativo: false, anos: 2 } } };
  const lista = soEfin(await w.__cratosEcac.gerarListaPedidos({ ni: "12345678901", tipo: "CPF" }, cfg));
  checar(lista.length === 0, "efin desligado → nenhum pedido de eFinanceira");
}

/* ── 5. Também vale para CNPJ (config independente por NI) ──────────────────── */
{
  const { w } = montar();
  await tick();
  const cfg = { cnpj: { efin: { ativo: true, anos: 1 }, efin_conta: "Todas", efin_cambio: "Sim" } };
  const lista = soEfin(await w.__cratosEcac.gerarListaPedidos({ ni: "11222333000181", tipo: "CNPJ" }, cfg));
  checar(lista.length === 1 && lista[0].opcoes.conta === "Todas" && lista[0].opcoes.cambio === "Sim",
    "CNPJ também recebe as opções do eFinanceira");
}

/* ── 6. A fiação da tela (incluirPedido consome as opções) continua de pé ───── */
{
  const fonte = fs.readFileSync(path.join(SRC, "conteudo", "ecac-infojud.js"), "utf8");
  const bloco = fonte.slice(fonte.indexOf('tipo === "eFinanceira"'),
                            fonte.indexOf('tipo === "eFinanceira"') + 1200);
  checar(/novoTipoConta/.test(bloco) && /opcoes\.conta/.test(bloco),
    "incluirPedido preenche o Tipo de conta a partir de opcoes.conta");
  checar(/novoTipoRelacao/.test(bloco) && /opcoes\.relacao/.test(bloco),
    "…o Tipo de relação a partir de opcoes.relacao");
  checar(/novoInfoCambio/.test(bloco) && /opcoes\.cambio/.test(bloco),
    "…o câmbio a partir de opcoes.cambio");
  checar(/novoTipoExtrato/.test(bloco) && /opcoes\.extrato/.test(bloco),
    "…o Tipo de extrato a partir de opcoes.extrato");
}

console.log("\n=== teste-infojud-efinanceira.js ===");
oks.forEach((d) => console.log("  ok   " + d));
falhas.forEach((d) => console.log("  FALHA " + d));
console.log(`\n${oks.length} passaram, ${falhas.length} falharam ` +
  `(${oks.length + falhas.length} asserções)\n`);
process.exit(falhas.length ? 1 : 0);

})();
