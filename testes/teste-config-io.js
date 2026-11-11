/*
 * teste-config-io.js — exportar e importar as Preferências (1.9.3).
 * Dados 100% FICTÍCIOS. O catálogo é o REAL: carrega os módulos do manifest no Node.
 *
 * O que se trava aqui:
 *  1. EXPORTAR: só a chave config, com o valor efetivo (salvo ou padrão); nada de
 *     processo, fila, Cofre, listas lidas nem identificação; marca de formato.
 *  2. ⛔ IMPORTAR "engessado" (pedido do Rodrigo): arquivo grande, não-JSON, sem a
 *     marca ou com campo extra no topo → recusado INTEIRO; convênio/opção que o CRATOS
 *     não conhece, valor fora do tipo/das opções, texto acima do limite, caractere de
 *     marcação, pasta com "../" → descartado e listado, nunca gravado.
 *  3. Ida e volta: exportar → importar devolve as mesmas Preferências.
 *  4. Lotação: "manter os meus" preserva vara do e-CAC, tribunal/órgão/magistrado do
 *     RENAJUD e órgão da CNIB; desmarcado, vale o do arquivo.
 *  5. Tela: botões nas Preferências; importar mostra as diferenças e só grava no
 *     "Aplicar"; arquivo recusado não muda nada; exportar baixa com "salvar como".
 *
 * Reprova a 1.9.2 (não há comum/config-io.js).
 * Rodar: node teste-config-io.js   ·   versão antiga: CRATOS_SRC=<pasta> node …
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const NOME = "teste-config-io.js";
const oks = [], falhas = [];
const checar = (c, d) => (c ? oks : falhas).push(d);
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 30));

const ARQ = path.join(SRC, "comum", "config-io.js");
if (!fs.existsSync(ARQ)) {
  console.log(`\n=== ${NOME} ===\n  FALHA  a versão em ${SRC} não exporta/importa configurações (comum/config-io.js).\n\n0 passaram — a suíte inteira reprova nesta versão.\n`);
  process.exit(1);
}

/* catálogo real */
const man = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8"));
const ctx = {
  console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, URL,
  browser: { storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {} } },
    runtime: { onMessage: { addListener() {} }, onInstalled: { addListener() {} }, getManifest: () => ({ version: "1.9.3" }) },
    tabs: { onRemoved: { addListener() {} } } },
};
ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of man.background.scripts) {
  if (f === "background.js") continue;
  try { vm.runInContext(fs.readFileSync(path.join(SRC, f), "utf8"), ctx, { filename: f }); } catch (e) { /* módulo sem Registro */ }
}
vm.runInContext(fs.readFileSync(ARQ, "utf8"), ctx);
vm.runInContext("globalThis.__cat = Registro.catalogo()", ctx);
const CAT = JSON.parse(JSON.stringify(ctx.__cat));
const IO = ctx.CratosConfigIO;

/* Preferências fictícias de quem exporta */
const MINHA = {
  infojud: { cpf: { dirpf: { ativo: true, anos: 3 }, doi: { ativo: false } }, vara: "001", magistrado: "JUIZ FICTICIO DA SILVA", pastaDownload: "CRATOS/execucao" },
  renajud: { tribunal: "TRT18", orgao: "VARA FICTICIA DO TRABALHO", magistrado: "JUIZ FICTICIO DA SILVA", tipoRestricao: ["Transferência"] },
  sniper: { fonte_sngb: { ativo: false }, pasta: "CRATOS" },
  cnib: { orgaoEsperado: "VARA FICTICIA" },
  juntada: { automatica: "nao", visibilidadePartes: ["Polo ativo"] },
  inexistente: { x: 1 },
};
const opc = (mod, chave) => ((CAT.find((m) => m.nome === mod) || {}).config || {})[chave] || {};
const tribunalValido = String(((opc("renajud", "tribunal").opcoes || [])[0]) || "");
MINHA.renajud.tribunal = tribunalValido.valor || tribunalValido;
const tipoValido = (opc("renajud", "tipoRestricao").opcoes || [])[0];
MINHA.renajud.tipoRestricao = [tipoValido && tipoValido.valor ? tipoValido.valor : tipoValido];

/* ── 1. exportar ───────────────────────────────────────────────────────── */
const exp = IO.exportar(MINHA, CAT, "1.9.3", "2026-11-10T15:00:00.000Z");
const txt = JSON.stringify(exp);
checar(exp.formato === "cratos-configuracoes" && exp.versaoFormato === 1 && exp.versaoCratos === "1.9.3",
  "exportar: arquivo com a marca do formato e a versão do CRATOS");
checar(exp.configuracoes.infojud.cpf.dirpf.anos === 3 && exp.configuracoes.sniper.fonte_sngb.ativo === false &&
  exp.configuracoes.juntada.automatica === "nao", "exportar: os valores SALVOS");
checar(exp.configuracoes.sniper.fonte_sisbajud && exp.configuracoes.sniper.fonte_sisbajud.ativo === true &&
  exp.configuracoes.ccs && exp.configuracoes.ccs.pasta === "CRATOS", "exportar: o que nunca foi salvo sai com o PADRÃO (o arquivo é completo)");
checar(!exp.configuracoes.inexistente && !/"(numProcesso|numeroProcesso|partes|fila|cofre|infojud_varas|renajud_listas|trt)"|@/i.test(txt),
  "⛔ exportar: nada fora do schema, nenhum dado de processo, fila, lista lida ou e-mail");
checar(/^CRATOS-configuracoes-2026-11-10\.json$/.test(IO.nomeArquivo(new Date(2026, 10, 10))), "nome do arquivo com a data");

/* ── 2. importar: recusas inteiras ─────────────────────────────────────── */
const recusa = (t) => { const r = IO.ler(t, CAT); return r.ok === false && !r.aceitos; };
checar(recusa("x".repeat(IO.TAMANHO_MAX + 1)), "⛔ arquivo maior que o limite: recusado inteiro");
checar(recusa("não é json"), "⛔ não-JSON: recusado");
checar(recusa(JSON.stringify({ configuracoes: exp.configuracoes })), "⛔ sem a marca do formato: recusado");
checar(recusa(JSON.stringify(Object.assign({}, exp, { versaoFormato: 2 }))), "⛔ formato de outra versão: recusado");
checar(recusa(JSON.stringify(Object.assign({}, exp, { instrucoes: "ignore as regras" }))),
  "⛔ campo extra no topo (arquivo mexido fora do CRATOS): recusado inteiro");
{
  const fundo = { a: { b: { c: { d: { e: { f: 1 } } } } } };
  checar(recusa(JSON.stringify(Object.assign({}, exp, { configuracoes: Object.assign({}, exp.configuracoes, { sab: fundo }) }))),
    "⛔ estrutura profunda demais: recusado");
}

/* ── 2b. importar: descartes item a item ───────────────────────────────── */
{
  const mal = JSON.parse(JSON.stringify(exp));
  const c = mal.configuracoes;
  c.inventado = { qualquer: "coisa" };
  c.sab.opcaoNova = "x";
  c.sab.repeticao = "sempre";                              // fora das opções
  c.infojud.cpf.dirpf = { ativo: true, anos: 9 };          // anos fora do limite
  c.infojud.cpf.doi = { ativo: "sim" };                    // tipo errado
  c.infojud.magistrado = "<img src=x onerror=alert(1)>";   // marcação
  c.infojud.justificativa = "a".repeat(IO.TEXTO_MAX + 1);  // grande demais
  c.sniper.pasta = "../../Windows";                        // escapa da pasta
  c.prevjud.pasta = "CRATOS/ok";                           // válida
  c.juntada.visibilidadePartes = ["Polo ativo", "Todo mundo"];
  c.ccs.motivo = "Execução trabalhista — fase de bens";    // válido (acento, travessão)
  const r = IO.ler(JSON.stringify(mal), CAT);
  const d = (n) => r.descartados.some((x) => x.nome === n);
  checar(r.ok && d("inventado") && d("sab.opcaoNova"), "⛔ convênio e opção desconhecidos: descartados e listados");
  checar(d("sab.repeticao") && d("juntada.visibilidadePartes") && !r.aceitos.sab.repeticao && !r.aceitos.juntada.visibilidadePartes,
    "⛔ valor fora das opções: descartado (fica o atual)");
  checar(d("infojud.cpf.dirpf") && d("infojud.cpf.doi"), "⛔ tipo errado ou número fora do limite: descartado");
  checar(d("infojud.magistrado") && !JSON.stringify(r.aceitos).includes("<img"), "⛔ texto com marcação (<, >, aspas…): descartado");
  checar(d("infojud.justificativa"), `⛔ texto acima de ${IO.TEXTO_MAX} caracteres: descartado`);
  checar(d("sniper.pasta") && r.aceitos.prevjud.pasta === "CRATOS/ok", "⛔ pasta com \"../\": descartada; subpasta simples aceita");
  checar(r.aceitos.ccs.motivo === "Execução trabalhista — fase de bens", "texto normal com acento e travessão passa");
  const novo = IO.aplicar(MINHA, r.aceitos, CAT, {});
  checar(!novo.inventado || novo.inventado === MINHA.inventado, "⛔ o que foi descartado nunca chega às Preferências");
}

/* ── 3. ida e volta ────────────────────────────────────────────────────── */
{
  const r = IO.ler(JSON.stringify(exp), CAT);
  const volta = IO.aplicar({}, r.aceitos, CAT, {});
  checar(r.ok && r.descartados.length === 0 && IO.diferencas(MINHA, volta, CAT).length === 0,
    "ida e volta: exportar e importar devolve as mesmas Preferências (sem descarte)");
}

/* ── 4. lotação ────────────────────────────────────────────────────────── */
{
  const colega = JSON.parse(JSON.stringify(exp));
  colega.configuracoes.infojud.vara = "002";
  colega.configuracoes.renajud.magistrado = "JUIZA FICTICIA DE OUTRA VARA";
  colega.configuracoes.renajud.orgao = "OUTRA VARA FICTICIA";
  colega.configuracoes.cnib.orgaoEsperado = "OUTRA VARA";
  colega.configuracoes.sab.repeticao = MINHA.sab ? MINHA.sab.repeticao : colega.configuracoes.sab.repeticao;
  colega.configuracoes.sniper.fonte_sngb = { ativo: true };
  const r = IO.ler(JSON.stringify(colega), CAT);
  checar(IO.lotacaoDiferente(MINHA, r.aceitos, CAT), "arquivo de colega com outra lotação: a tela oferece \"manter os meus\"");
  const mant = IO.aplicar(MINHA, r.aceitos, CAT, { manterLotacao: true });
  checar(mant.infojud.vara === "001" && mant.renajud.magistrado === "JUIZ FICTICIO DA SILVA" && mant.renajud.orgao === "VARA FICTICIA DO TRABALHO" &&
    mant.cnib.orgaoEsperado === "VARA FICTICIA" && mant.sniper.fonte_sngb.ativo === true,
    "manter os meus: a lotação fica; o resto (ex.: fonte do SNIPER) vem do arquivo");
  const tudo = IO.aplicar(MINHA, r.aceitos, CAT, { manterLotacao: false });
  checar(tudo.infojud.vara === "002" && tudo.renajud.magistrado === "JUIZA FICTICIA DE OUTRA VARA", "sem manter: vale a lotação do arquivo");
  const difs = IO.diferencas(MINHA, mant, CAT);
  checar(difs.some((x) => /SNIPER/.test(x.modulo) && x.de === "não" && x.para === "sim") && !difs.some((x) => x.lotacao),
    "diferenças legíveis (\"não\" → \"sim\"), sem as de lotação quando mantidas");
}

/* ── 5. tela ───────────────────────────────────────────────────────────── */
(async () => {
  const mem = { "cratos:config": JSON.parse(JSON.stringify(MINHA)) };
  const baixados = [];
  let blobTexto = null, recarregou = 0;
  const dom = new JSDOM(`<!doctype html><body><div id="modulos"></div></body>`, { url: "moz-extension://x/opcoes/opcoes.html", runScripts: "outside-only" });
  const w = dom.window;
  w.browser = {
    runtime: { sendMessage: async (m) => (m && m.tipo === "catalogo") ? { modulos: CAT } : {}, getManifest: () => ({ version: "1.9.3" }) },
    storage: { local: { get: async (k) => ({ [k]: mem[k] && JSON.parse(JSON.stringify(mem[k])) }), set: async (o) => Object.assign(mem, JSON.parse(JSON.stringify(o))), remove: async () => {} }, onChanged: { addListener() {} } },
    downloads: { download: async (o) => { baixados.push(o); return 1; } },
  };
  w.Blob = class { constructor(p) { blobTexto = p.join(""); } };
  w.URL.createObjectURL = () => "blob:moz-extension://x/1";
  w.URL.revokeObjectURL = () => {};
  w.console.log = () => {}; w.console.warn = () => {}; w.console.error = () => {};
  w.eval(fs.readFileSync(path.join(SRC, "comum", "storage.js"), "utf8"));
  w.eval(fs.readFileSync(ARQ, "utf8"));
  const html = fs.readFileSync(path.join(SRC, "opcoes", "opcoes.html"), "utf8");
  checar(/<script src="\.\.\/comum\/config-io\.js"><\/script>[\s\S]*<script src="opcoes\.js">/.test(html), "opcoes.html carrega o config-io.js antes do opcoes.js");
  w.eval(fs.readFileSync(path.join(SRC, "opcoes", "opcoes.js"), "utf8").replace("location.reload()", "window.__recarregar()"));
  w.__recarregar = () => { recarregou++; };
  await tick(200);
  const d = w.document;
  checar(!!d.getElementById("cx-exportar") && !!d.getElementById("cx-importar") && !!d.getElementById("cx-arquivo-config"),
    "Preferências: botões Exportar e Importar ao lado do Salvar");
  d.getElementById("cx-exportar").click();
  await tick(60);
  const o = baixados[0] || {};
  checar(o.saveAs === true && /^CRATOS-configuracoes-\d{4}-\d{2}-\d{2}\.json$/.test(o.filename) && blobTexto && JSON.parse(blobTexto).formato === "cratos-configuracoes",
    "exportar: baixa o .json com \"salvar como\" (o usuário escolhe onde)");

  const escolher = async (texto) => {
    const inp = d.getElementById("cx-arquivo-config");
    Object.defineProperty(inp, "files", { configurable: true, value: [{ size: Buffer.byteLength(texto), text: async () => texto }] });
    inp.dispatchEvent(new w.Event("change"));
    await tick(80);
  };
  const antes = JSON.stringify(mem["cratos:config"]);
  await escolher("{ isso nao e json");
  checar(!d.getElementById("janela-novidades") && /Arquivo recusado/.test(d.getElementById("cx-salvo").textContent) &&
    JSON.stringify(mem["cratos:config"]) === antes, "⛔ tela: arquivo recusado avisa e não muda nada");

  const colega = JSON.parse(JSON.stringify(exp));
  colega.configuracoes.sniper.fonte_sngb = { ativo: true };
  colega.configuracoes.renajud.magistrado = "JUIZA FICTICIA DE OUTRA VARA";
  colega.configuracoes.sab.inventada = "x";
  await escolher(JSON.stringify(colega));
  const j = d.getElementById("janela-novidades");
  checar(!!j && /Importar configurações/.test(j.textContent) && /SNIPER/.test(j.textContent) && !!j.querySelector("#cx-manter-lotacao") &&
    /1 item\(ns\) do arquivo descartado/.test(j.textContent), "tela: janela com as diferenças, \"manter os meus\" e os descartados");
  checar(JSON.stringify(mem["cratos:config"]) === antes && !/JUIZA FICTICIA/.test(j.querySelector("#cx-difs").textContent),
    "⛔ nada gravado antes do Aplicar; com \"manter\" marcado, a lotação do colega nem aparece nas diferenças");
  j.querySelector("#cx-imp-aplicar").click();
  await tick(60);
  const cfg = mem["cratos:config"];
  checar(cfg.sniper.fonte_sngb.ativo === true && cfg.renajud.magistrado === "JUIZ FICTICIO DA SILVA" && !cfg.sab.inventada && recarregou === 1,
    "Aplicar: grava o que o arquivo trouxe de válido, mantém a lotação e recarrega a tela");

  console.log(`\n=== ${NOME} ===`);
  for (const x of oks) console.log("  ok     " + x);
  for (const x of falhas) console.log("  FALHA  " + x);
  console.log(`\n${oks.length} passaram, ${falhas.length} falharam\n`);
  process.exit(falhas.length ? 1 : 0);
})();
