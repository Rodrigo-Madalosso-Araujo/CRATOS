/*
 * teste-opcoes-vara.js — a tela de Preferências GRAVA a vara escolhida?
 *
 * Escrito porque o Rodrigo abriu as Preferências na 1.1.2 e a vara apareceu em
 * "— selecione —". Duas explicações possíveis, e elas pedem consertos opostos:
 *   (a) o valor ANTIGO (nome colado à mão) não casa com nenhum código da lista,
 *       então o menu nasce vazio — é cosmético, e some assim que ele escolher;
 *   (b) o `salvar()` não recolhe campos do tipo `lista` — e aí a escolha se
 *       perde de verdade, toda vez.
 *
 * Adivinhar qual das duas seria repetir o erro de ontem, quando uma asserção
 * lida (em vez de executada) confirmou a minha própria grafia errada. Então
 * esta suíte RODA a tela de verdade: monta o DOM, escolhe a vara, clica em
 * Salvar e confere o que foi para o storage.
 *
 * Rodar: node teste-opcoes-vara.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const falhas = [];
const oks = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 60));

/* Catálogo como o background devolve: só o que a tela precisa. */
function catalogoInfojud() {
  const mod = fs.readFileSync(path.join(SRC, "modulos", "infojud.js"), "utf8");
  const bloco = mod.slice(mod.indexOf("vara: {"));
  const pares = [];
  const re = /\{ valor: "(\d{3})", rotulo: "([^"]+)" \}/g;
  let m;
  while ((m = re.exec(bloco))) pares.push({ valor: m[1], rotulo: m[2] });
  return {
    nome: "infojud",
    rotulo: "INFOJUD",
    requer: [],
    config: {
      vara: { tipo: "lista", opcoes: pares, padrao: "", rotulo: "Vara (a que assina a solicitação no eCAC)" },
      tipoProcesso: { tipo: "texto", padrao: "Ação Trabalhista", rotulo: "Tipo de processo (eCAC)" },
      pastaDownload: { tipo: "texto", padrao: "CRATOS", rotulo: "Subpasta de downloads" },
    },
  };
}

async function montarTela(configSalva) {
  const html = fs.readFileSync(path.join(SRC, "opcoes", "opcoes.html"), "utf8");
  const dom = new JSDOM(html, { url: "moz-extension://x/opcoes/opcoes.html", runScripts: "outside-only" });
  const w = dom.window;
  const mem = { "cratos:config": configSalva || {} };
  const cat = catalogoInfojud();
  w.browser = {
    storage: {
      local: {
        get: async (k) => ({ [k]: mem[k] }),
        set: async (o) => Object.assign(mem, o),
        remove: async () => {},
      },
      onChanged: { addListener: () => {} },
    },
    runtime: {
      sendMessage: async (msg) => (msg && msg.tipo === "catalogo" ? { modulos: [cat] } : { ok: true }),
      onMessage: { addListener: () => {} },
      getManifest: () => ({ version: "teste" }),
      getURL: (p) => p,
    },
  };
  w.console.log = () => {}; w.console.warn = () => {}; w.console.error = () => {};
  w.eval(fs.readFileSync(path.join(SRC, "comum", "storage.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(SRC, "opcoes", "opcoes.js"), "utf8"));
  await tick(120);
  return { w, mem, cat };
}

(async () => {

const cat = catalogoInfojud();
checar(cat.config.vara.opcoes.length === 51,
  "o catálogo trouxe as 51 varas (se falhar aqui, o resto não mede nada)");

/* ── 1. A TELA GRAVA A ESCOLHA? (a pergunta que motivou a suíte) ──────────── */
{
  const { w, mem } = await montarTela({});
  const sel = w.document.querySelector('select[data-chave="vara"]');
  checar(!!sel, "a vara é renderizada como <select>");
  checar(sel && sel.options.length === 52,
    "51 varas + a linha '— selecione —'");

  sel.value = "129";
  checar(sel.value === "129", "dá para escolher a vara pelo código");

  await w.document.getElementById("cx-salvar").onclick();
  await tick(60);
  const salvo = mem["cratos:config"];
  checar(!!(salvo && salvo.infojud), "salvou alguma coisa para o INFOJUD");
  checar(salvo && salvo.infojud && salvo.infojud.vara === "129",
    "⛔ A ESCOLHA DA VARA VAI PARA O STORAGE — era esta a dúvida");
  checar(salvo && salvo.infojud && salvo.infojud.tipoProcesso === "Ação Trabalhista",
    "os campos de texto vizinhos continuam sendo salvos");
}

/* ── 2. E VOLTA SELECIONADA AO REABRIR? ──────────────────────────────────── */
{
  const { w } = await montarTela({ infojud: { vara: "129" } });
  const sel = w.document.querySelector('select[data-chave="vara"]');
  checar(sel && sel.value === "129",
    "reabrindo as Preferências, a vara salva volta SELECIONADA");
  const marcada = sel && sel.options[sel.selectedIndex];
  checar(marcada && /Quirin/i.test(marcada.text),
    "e mostra o nome, não o código cru");
}

/* ── 3. A CONFIG ANTIGA (nome colado à mão) ──────────────────────────────── */
{
  const { w, mem } = await montarTela({ infojud: { vara: "8ª Vara do Trabalho de Goiânia" } });
  const sel = w.document.querySelector('select[data-chave="vara"]');
  checar(sel && sel.value !== "",
    "config antiga não deixa mais o menu vazio");

  checar(sel && sel.value === "008",
    "⛔ MIGRAÇÃO: o nome colado à mão é reconhecido e o menu abre na vara certa");
  checar(sel && /8ª Vara do Trabalho de Goiânia/.test(sel.options[sel.selectedIndex].text) &&
         !/18ª/.test(sel.options[sel.selectedIndex].text),
    "⛔ '8ª Vara' NÃO é confundida com '18ª Vara' — o nome casa por igualdade, não por conter");

  /* Com a migração, salvar sem tocar no menu já grava o CÓDIGO: a vara antiga
     não some mais. Era o risco que sobrava para quem atualizasse. */
  await w.document.getElementById("cx-salvar").onclick();
  await tick(60);
  checar(mem["cratos:config"].infojud.vara === "008",
    "⛔ salvar sem tocar no menu agora GRAVA o código — antes zerava a vara");
}

/* ── 5. A MIGRAÇÃO NÃO PODE ADIVINHAR DEMAIS ─────────────────────────────── */
{
  /* Termo ambíguo (sem ordinal) casa com 18 varas de Goiânia: deixar o menu
     vazio é a resposta certa. Escolher a primeira seria repetir, na tela de
     Preferências, o bug que a lista veio consertar no formulário do eCAC. */
  const { w } = await montarTela({ infojud: { vara: "Vara do Trabalho de Goiânia" } });
  const sel = w.document.querySelector('select[data-chave="vara"]');
  checar(sel && sel.value === "",
    "⛔ termo AMBÍGUO não é migrado a palpite — o menu fica em '— selecione —'");
}
{
  const { w } = await montarTela({ infojud: { vara: "001 — 1ª Vara do Trabalho de Goiânia" } });
  const sel = w.document.querySelector('select[data-chave="vara"]');
  checar(sel && sel.value === "001", "rótulo inteiro colado também é reconhecido");
}
{
  const { w } = await montarTela({ infojud: { vara: "Vara do Trabalho de Marte" } });
  const sel = w.document.querySelector('select[data-chave="vara"]');
  checar(sel && sel.value === "", "valor que não existe na lista fica vazio, sem inventar");
}

/* ── 4. O CAMPO É MESMO RECOLHIDO PELO SALVAR ────────────────────────────── */
{
  const op = fs.readFileSync(path.join(SRC, "opcoes", "opcoes.js"), "utf8");
  const sal = op.slice(op.indexOf("async function salvar"));
  checar(/data-tipo="lista"/.test(sal),
    "o salvar() recolhe explicitamente os campos do tipo lista");
}

console.log("\n=== teste-opcoes-vara.js ===");
oks.forEach((d) => console.log("  ok   " + d));
falhas.forEach((d) => console.log("  FALHA " + d));
console.log(`\n${oks.length} passaram, ${falhas.length} falharam ` +
  `(${oks.length + falhas.length} asserções)\n`);
process.exit(falhas.length ? 1 : 0);

})();
