/*
 * teste-convenios-uso.js — 1.9.4: "Convênios em uso" (pedido do Rodrigo, 13/11/2026).
 *
 * Uma chave liga/desliga por convênio nas Preferências. Desligado, o convênio some da
 * fila (inclusão e baixa), do botão de coleta dele, do lote do SAB, do "Verificar
 * disponibilidade" e dos pendentes dos Primeiros passos; a seção dele nas Preferências
 * fica acinzentada. SAB: regra DURA — só nos TRTs 3, 10 e 18; nos demais nem aparece
 * (nem a chave), mesmo que o config diga "ligado". Tribunal desconhecido não esconde nada.
 *
 * Rodar: node teste-convenios-uso.js   (CRATOS_SRC=<src antigo> para ver reprovar)
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const falhas = [];
const oks = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 120));
const ler = (...p) => fs.readFileSync(path.join(SRC, ...p), "utf8");
function fim() {
  console.log("\n=== teste-convenios-uso.js ===");
  oks.forEach((d) => console.log("  ok   " + d));
  falhas.forEach((d) => console.log("  FALHA " + d));
  console.log(`\n${oks.length} passaram, ${falhas.length} falharam (${oks.length + falhas.length} asserções)\n`);
  process.exit(falhas.length ? 1 : 0);
}
const ARQ = path.join(SRC, "comum", "convenios-uso.js");
if (!fs.existsSync(ARQ)) { checar(false, "comum/convenios-uso.js não existe nesta versão (Convênios em uso)"); fim(); }

/* módulo carregado com um Registro falso: o bloco das Preferências */
const mods = [];
const ctx = { Registro: { adicionar: (m) => mods.push(m) }, console };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(ARQ, "utf8"), ctx);
const U = ctx.CratosConveniosUso;
const T18 = "https://pje.trt18.jus.br", T5 = "https://pje.trt5.jus.br";

(async () => {
  /* ═══ 1. REGRA ═══ */
  checar(U.trtDoHost(T18) === 18 && U.trtDoHost("https://pje.trt3.jus.br/pjekz") === 3 && U.trtDoHost("moz-extension://x") === null, "tribunal pelo endereço do PJe");
  checar(U.sabExiste(T18) && U.sabExiste("https://pje.trt10.jus.br") && U.sabExiste("https://pje.trt3.jus.br") && U.sabExiste(T5) === false && U.sabExiste(null) === null,
    "SAB existe só nos TRTs 3, 10 e 18 (tribunal desconhecido = não sei)");
  checar(U.ligados({}, T18).length === 9, "nada salvo: os nove convênios ligados (quem atualiza não percebe diferença)");
  checar(!U.ligado({ convenios: { sab: { ativo: true } } }, "SAB", T5), "⛔ SAB fora dos TRTs 3, 10 e 18: desligado mesmo com o config dizendo ligado");
  checar(U.ligado({}, "SAB", null), "tribunal desconhecido: o SAB não some");
  checar(!U.ligado({ convenios: { ccs: { ativo: false } } }, "CCS", T18) && U.ligado({ convenios: { ccs: { ativo: false } } }, "ccs", T5) === false &&
    U.ligado({ convenios: { ccs: { ativo: false } } }, "CNIB", T5), "chave desligada some (id do painel ou nome do módulo); as outras seguem");

  /* ═══ 2. PREFERÊNCIAS: o bloco e o lugar dele ═══ */
  const bloco = mods.find((m) => m.nome === "convenios");
  checar(bloco && bloco.rotulo === "Convênios em uso" && U.CONVENIOS.every((c) => bloco.config[c.nome] && bloco.config[c.nome].tipo === "toggle" && bloco.config[c.nome].padrao.ativo === true),
    "bloco \"Convênios em uso\": uma chave por convênio, ligadas de fábrica");
  const man = JSON.parse(ler("manifest.json"));
  const bgs = man.background.scripts;
  checar(bgs.indexOf("comum/convenios-uso.js") === bgs.indexOf("modulos/registro.js") + 1, "carregado logo depois do registro: é o PRIMEIRO bloco das Preferências");
  checar(man.content_scripts.some((c) => c.js.includes("conteudo/painel.js") && c.js.indexOf("comum/convenios-uso.js") >= 0 && c.js.indexOf("comum/convenios-uso.js") < c.js.indexOf("conteudo/painel.js")),
    "carregado no PJe antes do painel");
  checar(/convenios-uso\.js/.test(ler("opcoes", "opcoes.html")) && /convenios-uso\.js/.test(ler("primeiros", "primeiros.html")), "carregado nas Preferências e nos Primeiros passos");

  /* exportar/importar leva as chaves (lista branca derivada do catálogo) */
  const IO = require(path.join(SRC, "comum", "config-io.js"));
  const cat = JSON.parse(JSON.stringify([bloco]));
  const exp = IO.exportar({ convenios: { sniper: { ativo: false } } }, cat, "1.9.4", "2026-11-13T12:00:00Z");
  const txtExp = typeof exp === "string" ? exp : JSON.stringify(exp);
  checar(/sniper/.test(txtExp) && /convenios/.test(txtExp), "exportar leva \"Convênios em uso\"");
  const lido = IO.ler(txtExp, cat);
  checar(lido && lido.ok !== false && JSON.stringify(lido).includes("sniper"), "importar aceita as chaves de volta");

  /* ═══ 3. PAINEL ═══ */
  const { montarPainel } = require("./harness-painel.js");
  const partes = [{ nome: "EMPRESA FICTICIA LTDA", cpfcnpj: "00000000000191", polo: "PASSIVO" }];
  const abrir = async (cfg, url) => {
    const mem = { "cratos:config": Object.assign({ infojud: { colheitaAutomatica: "nao", vara: "1" } }, cfg) };
    const e = montarPainel(SRC, { mem, url });
    await e.P.usoPronto; await tick(20);
    e.P.setProcesso({ id: 555, numero: "00009999920265180008" });
    e.P.setPartes(partes);
    e.P.setPartesSelecionadas(partes);
    return e;
  };
  const linhas = (e) => Array.from(e.r.querySelectorAll(".cx-sel-conv")).map((x) => x.dataset.id);
  {
    const e = await abrir({ convenios: { ccs: { ativo: false }, prevjud: { ativo: false } } });
    e.P.renderModoSelecao();
    checar(!e.r.querySelector("#cx-coletar-ccs") && !e.r.querySelector("#cx-coletar-prevjud"), "painel: CCS e PREVJUD desligados → sem os botões de coleta deles");
    checar(e.r.querySelector("#cx-coletar-sab") && e.r.querySelector("#cx-localizar") && e.r.querySelector("#cx-juntar"), "painel: os demais botões e a juntada continuam");
    const opts = Array.from(e.r.querySelectorAll("#cx-disp-conv option")).map((o) => o.value);
    checar(opts.length && !opts.includes("CCS") && !opts.includes("PREVJUD") && opts.includes("RENAJUD"), "painel: \"Verificar disponibilidade\" sem os desligados");
    e.P.setModo("inclusao"); e.P.renderListaConvenios();
    const l = linhas(e);
    checar(l.length === 7 && !l.includes("CCS") && !l.includes("PREVJUD") && l.includes("SAB"), "⛔ fila (inclusão): desligado não aparece");
    e.r.querySelector("#cx-modo-inclusao");
  }
  {
    const e = await abrir({}, "https://pje.trt5.jus.br/pjekz/processo/1");
    e.P.renderModoSelecao();
    checar(!e.r.querySelector("#cx-coletar-sab"), "⛔ TRT5: sem \"Coletar SAB\"");
    e.P.setModo("baixa"); e.P.renderListaConvenios();
    checar(!linhas(e).includes("SAB") && linhas(e).includes("RENAJUD"), "⛔ TRT5: SAB fora da fila de baixa");
    e.P.setModo("inclusao"); e.P.renderListaConvenios();
    checar(!linhas(e).includes("SAB") && linhas(e).length === 8, "⛔ TRT5: SAB fora da fila de inclusão");
    e.P.renderSemProcesso();
    checar(!e.r.querySelector("#cx-lote-sab"), "⛔ TRT5: sem o lote \"Coletar respostas SAB\" no Meu painel");
  }
  {
    const e = await abrir({ convenios: { sab: { ativo: false } } });
    e.P.renderSemProcesso();
    checar(!e.r.querySelector("#cx-lote-sab") && /Nenhum processo aberto/.test(e.r.textContent), "SAB desligado no TRT18: sem o lote, só o aviso de sempre");
    const e2 = await abrir({});
    e2.P.renderSemProcesso();
    checar(!!e2.r.querySelector("#cx-lote-sab"), "SAB ligado no TRT18: o lote aparece");
  }
  {
    const e = await abrir({ convenios: { cnib: { ativo: false } } });
    e.P.setModo("baixa"); e.P.renderListaConvenios();
    const antes = linhas(e);
    checar(antes.join() === "SAB,RENAJUD,SERASAJUD", "baixa com CNIB desligado: SAB, RENAJUD, SerasaJUD");
    e.r.querySelectorAll(".cx-ord-down")[1].click();
    checar(linhas(e).join() === "SAB,SERASAJUD,RENAJUD", "▼ troca com o vizinho VISÍVEL (antes trocava com um escondido e nada mudava)");
    checar(e.P.ordem.indexOf("CNIB") >= 0 && e.P.ordem.length === 9, "a ordem salva continua com todos, inclusive o desligado");
  }
  {
    const tudoOff = {}; U.CONVENIOS.forEach((c) => { tudoOff[c.nome] = { ativo: false }; });
    const e = await abrir({ convenios: tudoOff });
    e.P.setModo("inclusao"); e.P.renderListaConvenios();
    checar(linhas(e).length === 0 && /Convênios em uso/.test(e.r.textContent), "tudo desligado: o painel aponta para as Preferências");
  }

  /* ═══ 4. PREFERÊNCIAS (tela) ═══ */
  async function telaOpcoes(mem) {
    const catalogo = JSON.parse(JSON.stringify(mods.concat([
      { nome: "sab", rotulo: "SAB", config: { justificativaBaixa: { tipo: "texto", padrao: "x", rotulo: "Justificativa" } } },
      { nome: "ccs", rotulo: "CCS", config: { pasta: { tipo: "texto", padrao: "CRATOS", rotulo: "Pasta" } } },
    ])));
    const dom = new JSDOM(`<!doctype html><body><div id="modulos"></div></body>`, { url: "moz-extension://x/opcoes/opcoes.html", runScripts: "outside-only" });
    const w = dom.window;
    w.browser = {
      runtime: { sendMessage: async (m) => (m && m.tipo === "catalogo") ? { modulos: catalogo } : {}, getManifest: () => ({ version: "1.9.4" }) },
      storage: { local: { get: async (k) => ({ [k]: mem[k] }), set: async () => {}, remove: async () => {} }, onChanged: { addListener() {} } },
    };
    for (const k of ["log", "warn", "error"]) w.console[k] = () => {};
    w.eval(ler("comum", "storage.js"));
    w.eval(fs.readFileSync(ARQ, "utf8"));
    w.eval(ler("opcoes", "opcoes.js"));
    await tick(250);
    return w.document;
  }
  {
    const d = await telaOpcoes({ "cratos:config": { convenios: { ccs: { ativo: false } } }, "cratos:trt": T18 });
    const secs = Array.from(d.querySelectorAll(".modulo"));
    checar(secs[0] && secs[0].dataset.modulo === "convenios", "Preferências: \"Convênios em uso\" é o primeiro bloco");
    const ccs = d.querySelector('.modulo[data-modulo="ccs"]');
    checar(ccs && ccs.style.opacity === "0.5" && /desligado em "Convênios em uso"/.test(ccs.textContent) && ccs.querySelector("input"), "Preferências: seção do desligado acinzentada, avisada e ainda editável");
    const sab = d.querySelector('.modulo[data-modulo="sab"]');
    checar(sab && sab.style.display !== "none", "Preferências (TRT18): seção do SAB visível");
    const chCcs = d.querySelector('.modulo[data-modulo="convenios"] [data-chave="ccs"]');
    chCcs.checked = true; chCcs.dispatchEvent(new d.defaultView.Event("change"));
    checar(ccs.style.opacity === "" && !ccs.querySelector(".cx-tag-desligado"), "Preferências: religar volta a seção ao normal na hora");
  }
  {
    const d = await telaOpcoes({ "cratos:config": {}, "cratos:trt": T5 });
    const sab = d.querySelector('.modulo[data-modulo="sab"]');
    const ch = d.querySelector('.modulo[data-modulo="convenios"] [data-chave="sab"]');
    checar(sab && sab.style.display === "none" && ch && ch.closest(".campo").style.display === "none", "⛔ Preferências (TRT5): o SAB nem aparece (nem a seção, nem a chave)");
  }

  /* ═══ 5. PRIMEIROS PASSOS ═══ */
  {
    const corpoHtml = ler("primeiros", "primeiros.html").replace(/[\s\S]*<body>/, "").replace(/<script[\s\S]*$/, "");
    const mem = { "cratos:config": { convenios: { infojud: { ativo: false } } }, "cratos:trt": T18 };
    const dom = new JSDOM(`<!doctype html><html><body>${corpoHtml}</body></html>`, { url: "moz-extension://x/p.html", runScripts: "outside-only" });
    const w = dom.window;
    w.browser = {
      storage: { local: { get: async (k) => ({ [k]: mem[k] }), set: async () => {}, remove: async () => {} }, onChanged: { addListener() {} } },
      runtime: { sendMessage: async (m) => (m && m.tipo === "catalogo" ? { modulos: [] } : { ok: true }), getManifest: () => ({ version: "1.9.4" }), getURL: (p) => p },
    };
    for (const k of ["log", "warn", "error"]) w.console[k] = () => {};
    w.eval(ler("comum", "storage.js"));
    w.eval(fs.readFileSync(ARQ, "utf8"));
    if (fs.existsSync(path.join(SRC, "modulos", "renajud-orgaos.js"))) w.eval(ler("modulos", "renajud-orgaos.js"));
    w.eval(ler("primeiros", "primeiros.js"));
    await tick(200);
    const txt = w.document.getElementById("passos").textContent;
    checar(/2\. INFOJUD \(e-CAC\)\s*desligado/.test(txt) && /3\. RENAJUD\s*pendente/.test(txt), "Primeiros passos: INFOJUD desligado não fica \"pendente\"; RENAJUD segue");
    checar(w.document.getElementById("pp-vara"), "Primeiros passos: os campos do desligado continuam lá (para religar)");
  }
  fim();
})().catch((e) => { checar(false, "exceção: " + (e && e.stack || e)); fim(); });
