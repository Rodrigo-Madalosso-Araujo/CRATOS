/*
 * teste-censec-ontem.js — CENSEC 1.9.9: a data final é no máximo ONTEM.
 *
 * Achado do Rodrigo (24/11/2026, depois de assinar a 1.9.8): o CENSEC recusa a
 * "Data final" igual a hoje ("Digite uma data válida") e o "Buscar" não libera. A
 * 1.9.8 contava os períodos até HOJE e ficava esperando o botão, sem perceber que o
 * próprio formulário tinha recusado o campo.
 *
 * Confere:
 *  · os períodos prontos terminam ontem (e começam N anos antes, + 1 dia);
 *  · o Personalizado recusa data final = hoje e aceita ontem;
 *  · 29/02 como "ontem" não quebra a conta;
 *  · com erro embaixo de um campo (mat-error), a busca para NA HORA e diz qual campo;
 *  · a fila de partes para na primeira recusa;
 *  · Preferências: data final com max = ontem, datas lado a lado, salvar recusa hoje.
 *
 * Reprova a 1.9.8. Rodar: node teste-censec-ontem.js
 * Versão antiga: CRATOS_SRC=<pasta do src> node teste-censec-ontem.js
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const NOME = "teste-censec-ontem";
const oks = [], falhas = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 30));
const ler = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const comPrazo = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r({ __estourou: true }), ms))]);

/* A tela do CEP, como a real: Data final = HOJE ganha "Digite uma data válida" e o
   Buscar fica cinza. */
function montarCep(hojeDmy) {
  const dom = new JSDOM(`<!doctype html><body>
    <app-public-query>
      <mat-form-field><mat-label>Documento (CPF/CNPJ)</mat-label><input id="doc"></mat-form-field>
      <mat-form-field><mat-label>Data inicial</mat-label><input id="di"></mat-form-field>
      <mat-form-field id="ff-df"><mat-label>Data final</mat-label><input id="df"></mat-form-field>
      <button id="buscar">Buscar</button>
    </app-public-query></body>`,
    { url: "https://www.censec.org.br/private/s/00000000-0000-0000-0000-000000000000/cep", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.Element.prototype.getBoundingClientRect = function () { return { width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10 }; };
  const mem = {};
  const buscas = [];
  w.browser = {
    storage: { local: { get: async (k) => ({ [k]: mem[k] }), set: async (o) => Object.assign(mem, o), remove: async () => {} }, onChanged: { addListener() {} } },
    runtime: { sendMessage: async () => ({ ok: true }), onMessage: { addListener() {} }, getURL: (p) => "moz-extension://x/" + p },
  };
  w.fetch = async (url, init) => {
    if (/\/api\/atos\/cep\/busca/.test(String(url))) buscas.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({}), text: async () => JSON.stringify({ buscaTicket: null, atos: [] }), clone() { return this; } };
  };
  const isoDe = (dmy) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dmy || ""); return m ? `${m[3]}-${m[2]}-${m[1]}T15:00:00.000Z` : null; };
  const df = w.document.getElementById("df"), botao = w.document.getElementById("buscar");
  const validar = () => {
    const ff = w.document.getElementById("ff-df");
    const velho = ff.querySelector("mat-error"); if (velho) velho.remove();
    if (df.value === hojeDmy) {
      const e = w.document.createElement("mat-error"); e.textContent = " Digite uma data válida "; ff.appendChild(e);
      botao.disabled = true;
    } else botao.disabled = false;
  };
  df.addEventListener("input", validar); df.addEventListener("blur", validar);
  botao.addEventListener("click", () => {
    if (botao.disabled) return;
    w.fetch("/api/atos/cep/busca", { method: "POST", body: JSON.stringify({ cpfCnpj: w.document.getElementById("doc").value.replace(/\D/g, ""),
      dataInicio: isoDe(w.document.getElementById("di").value), dataFim: isoDe(df.value), exactMatch: true }) });
  });
  w.CratosFaixa = { parar() {}, mostrar() {} };
  w.CratosOverlay = { mostrar() {}, esconder() {} };
  w.console.log = () => {}; w.console.warn = () => {}; w.console.error = () => {};
  w.eval(ler("comum/storage.js"));
  w.eval(ler("comum/periodo.js"));
  w.eval(ler("conteudo/censec.js"));
  w.eval(ler("conteudo/censec-api.js"));
  return { w, buscas };
}

(async () => {
  /* ── 1. o módulo de período ── */
  const c = {}; vm.createContext(c); vm.runInContext(ler("comum/periodo.js"), c);
  const P = c.CratosPeriodo;
  const hoje = new Date(2026, 10, 24, 10);
  const r = (e, ag) => P.resolver(e, ag || hoje);
  checar(JSON.stringify(["10a", "3a", "1a"].map((v) => [r({ valor: v }).inicio, r({ valor: v }).fim])) ===
    JSON.stringify([["2016-11-24", "2026-11-23"], ["2023-11-24", "2026-11-23"], ["2025-11-24", "2026-11-23"]]),
    "⛔ períodos prontos terminam ONTEM (23/11, num 24/11) e cobrem N anos exatos (3 anos: 24/11/2023 a 23/11/2026)");
  checar(/ontem/.test(r({ valor: "personalizado", inicio: "2026-01-01", fim: "2026-11-24" }).erro || "") &&
    r({ valor: "personalizado", inicio: "2026-01-01", fim: "2026-11-23" }).fim === "2026-11-23",
    "⛔ Personalizado: data final = hoje é recusada (e o erro fala em ontem); ontem passa");
  const bis = r({ valor: "1a" }, new Date(2028, 2, 1, 9));
  checar(bis.fim === "2028-02-29" && bis.inicio === "2027-03-01", "ontem = 29/02/2028: 1 ano vai de 01/03/2027 a 29/02/2028");
  const virada = r({ valor: "1a" }, new Date(2027, 0, 1, 0, 5));
  checar(virada.fim === "2026-12-31", "logo depois da meia-noite de 01/01, ontem é 31/12 do ano anterior");

  /* ── 2. o formulário recusou o campo: para na hora ── */
  {
    const t = montarCep("24/11/2026");
    await tick();
    const C = t.w.__cratosCensec || {};
    const ini = Date.now();
    const res = C.buscarCep
      ? await comPrazo(C.buscarCep({ nome: "FULANO FICTICIO" }, "52998224725", { inicio: "2026-01-01", fim: "2026-11-24" }), 6000)
      : { __estourou: true };
    checar(!res.__estourou && res.ok === false && res.campoRecusado === true && Date.now() - ini < 6000,
      "⛔ \"Digite uma data válida\" embaixo da Data final: a busca para na hora, sem esperar o Buscar");
    checar(/Data final/.test(res.motivo || "") && /24\/11\/2026/.test(res.motivo || "") && /Digite uma data válida/.test(res.motivo || ""),
      "a mensagem diz o campo, o valor e o que o CENSEC respondeu");
    checar(t.buscas.length === 0, "nada foi buscado");
  }
  {
    const t = montarCep("24/11/2026");
    await tick();
    const C = t.w.__cratosCensec || {};
    const res = C.buscarCep
      ? await comPrazo(C.buscarCep({ nome: "FULANO FICTICIO" }, "52998224725", { inicio: "2026-01-01", fim: "2026-11-23" }), 15000)
      : { __estourou: true };
    checar(!res.__estourou && res.ok !== false && t.buscas.length === 1, "com a data final = ontem, a busca sai normalmente");
  }
  {
    const src = ler("conteudo/censec.js");
    const laco = src.slice(src.indexOf("falhados.push({ nome: parte.nome, motivo: r.motivo })"), src.indexOf("resultados.push({ parte, doc, ordem: i + 1, cep: r })"));
    checar(/r\.campoRecusado/.test(laco) && /break;/.test(laco),
      "⛔ fila de partes: na primeira recusa do formulário, para — as demais saem como não consultadas, com o motivo");
  }

  /* ── 3. Preferências ── */
  {
    const reg = {}; vm.createContext(reg);
    vm.runInContext(ler("modulos/registro.js") + "\n" + ler("modulos/censec.js") + "\nthis.R = Registro;", reg);
    const cfg = (reg.R.catalogo().find((m) => m.nome === "censec") || {}).config || {};
    checar(cfg.periodoFim && cfg.periodoFim.maxOntem === true && cfg.periodoInicio.linha === "personalizado" && cfg.periodoFim.linha === "personalizado",
      "⛔ Preferências do CENSEC: data final com máximo de ontem; as duas datas na mesma linha");
    const aviso = JSON.stringify(cfg);
    checar(/até ontem/.test(aviso) && !/1 ano até hoje/.test(aviso), "o quadro de explicação fala em \"até ontem\"");

    const dom = new JSDOM(`<!doctype html><body><div id="modulos"></div></body>`,
      { url: "moz-extension://x/opcoes/opcoes.html", runScripts: "outside-only" });
    const w = dom.window;
    const salvo = {};
    w.browser = {
      runtime: { sendMessage: async (m) => (m && m.tipo === "catalogo" ? { modulos: reg.R.catalogo().filter((x) => x.nome === "censec") } : {}),
        getManifest: () => ({ version: "1.9.9" }), getURL: (p) => p },
      storage: { local: { get: async (k) => ({ [k]: salvo[k] }), set: async (o) => Object.assign(salvo, o) }, onChanged: { addListener() {} } },
      downloads: { download: async () => {} },
    };
    w.console.log = () => {}; w.console.warn = () => {}; w.console.error = () => {};
    for (const f of ["comum/storage.js", "comum/novidades.js", "comum/config-io.js", "comum/convenios-uso.js", "modulos/renajud-orgaos.js", "opcoes/opcoes.js"]) {
      try { w.eval(ler(f)); } catch (e) { /* o teste olha o DOM */ }
    }
    await tick(300);
    const d = w.document;
    const ini = d.querySelector('[data-chave="periodoInicio"]'), fim = d.querySelector('[data-chave="periodoFim"]');
    const linha = fim && fim.closest(".linha-campos");
    checar(!!linha && linha.contains(ini) && !!linha.querySelector(".linha-nota"),
      "⛔ tela: data inicial e final na mesma linha, com a nota embaixo");
    const o = new Date(); o.setHours(12); o.setDate(o.getDate() - 1);
    const ontem = `${o.getFullYear()}-${String(o.getMonth() + 1).padStart(2, "0")}-${String(o.getDate()).padStart(2, "0")}`;
    checar(fim && fim.getAttribute("max") === ontem && !ini.hasAttribute("max"), "tela: a data final tem max = ontem (a inicial não)");
    const bot = d.getElementById("cx-salvar");
    if (fim && bot) {
      const h = new Date();
      fim.value = `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}-${String(h.getDate()).padStart(2, "0")}`;
      bot.click(); await tick(100);
    }
    const msg = (d.getElementById("cx-salvo") || {}).textContent || "";
    checar(!salvo["cratos:config"] && /no máximo ontem/.test(msg), "⛔ salvar com a data final = hoje: não salva e diz por quê");
    if (fim && bot) { fim.value = ontem; bot.click(); await tick(100); }
    const cfgSalva = (salvo["cratos:config"] || {}).censec || {};
    checar(cfgSalva.periodoFim === ontem, "com ontem, salva normalmente");
  }

  console.log(`\n=== ${NOME} ===`);
  oks.forEach((d) => console.log("  ok   " + d));
  falhas.forEach((d) => console.log("  FALHA " + d));
  console.log(`\n${oks.length} passaram, ${falhas.length} falharam (${oks.length + falhas.length} asserções)\n`);
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.log("FALHA geral: " + e.stack); process.exit(1); });
