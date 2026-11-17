/*
 * harness-painel.js — monta o painel.js REAL num jsdom (o mesmo desenho de
 * teste-painel-encadeamento.js), com storage em memória que dispara onChanged e
 * um background falso configurável. Usado por teste-novidades.js e
 * teste-disponibilidade.js (1.9.0). Não é suíte.
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

function montarPainel(SRC, opcoes) {
  const op = opcoes || {};
  const dom = new JSDOM(op.html || "<!doctype html><html><body></body></html>", {
    url: op.url || "https://pje.trt18.jus.br/pjekz/processo/1", runScripts: "outside-only", pretendToBeVisual: true,
  });
  const w = dom.window;
  const mem = Object.assign({}, op.mem || {});
  const listeners = [];
  const dispara = (changes) => { listeners.slice().forEach((l) => { try { l(changes, "local"); } catch (e) { /* nada */ } }); };
  const msgs = [];
  const ouvintesAba = [];   // 2.0: mensagens do fundo para a aba (ex.: o atalho)
  const respostas = {};
  w.browser = {
    storage: {
      local: {
        get: async (k) => {
          if (k == null) return Object.assign({}, mem);
          if (Array.isArray(k)) { const o = {}; k.forEach((x) => (o[x] = mem[x])); return o; }
          return { [k]: mem[k] };
        },
        set: async (o) => {
          const changes = {};
          for (const k of Object.keys(o)) { changes[k] = { oldValue: mem[k], newValue: o[k] }; mem[k] = o[k]; }
          dispara(changes);
        },
        remove: async (k) => {
          const ks = Array.isArray(k) ? k : [k];
          const changes = {};
          ks.forEach((x) => { changes[x] = { oldValue: mem[x], newValue: undefined }; delete mem[x]; });
          dispara(changes);
        },
      },
      onChanged: {
        addListener: (fn) => listeners.push(fn),
        removeListener: (fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
      },
    },
    runtime: {
      getURL: (p) => p,
      getManifest: () => ({ version: op.versao || "1.9.0" }),
      onMessage: { addListener: (fn) => ouvintesAba.push(fn), removeListener: () => {} },
      sendMessage: async (msg) => {
        if (!msg) return { ok: true };
        msgs.push(JSON.parse(JSON.stringify(msg)));
        if (op.responder) { const r = await op.responder(msg); if (r !== undefined) return r; }
        if (msg.tipo === "orquestra_executar") return respostas[msg.convenioId] || { ok: true, aguardando: true };
        if (msg.tipo === "diario_ler") return { ok: true, certidoes: [] };
        return { ok: true };
      },
    },
  };
  for (const k of ["log", "warn", "error", "debug"]) w.console[k] = () => {};
  if (!mem["cratos:config"]) mem["cratos:config"] = { infojud: { colheitaAutomatica: "nao" } };
  w.eval(fs.readFileSync(path.join(SRC, "comum", "storage.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(SRC, "comum", "relatorio.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(SRC, "comum", "faixa.js"), "utf8"));
  const nov = path.join(SRC, "comum", "novidades.js");
  if (fs.existsSync(nov)) w.eval(fs.readFileSync(nov, "utf8"));
  const sabL = path.join(SRC, "comum", "sab-leitura.js");      // 1.9.4
  if (fs.existsSync(sabL)) w.eval(fs.readFileSync(sabL, "utf8"));
  const usoL = path.join(SRC, "comum", "convenios-uso.js");    // 1.9.4
  if (fs.existsSync(usoL)) w.eval(fs.readFileSync(usoL, "utf8"));
  for (const extra of [["comum", "situacao.js"], ["comum", "tema.js"], ["conteudo", "painel-estilo.js"]]) {   // 2.0
    const f = path.join(SRC, ...extra);
    if (fs.existsSync(f)) w.eval(fs.readFileSync(f, "utf8"));
  }
  if (op.fetch) w.fetch = op.fetch;
  w.eval(fs.readFileSync(path.join(SRC, "conteudo", "painel.js"), "utf8"));
  /* 2.0: o painel mora num shadow DOM aberto. `r` é a raiz onde procurar os
     elementos do PAINEL; `d` continua sendo a página (PJe). */
  const P = w.__cratosPainel;
  const r = (P && P.raiz) || w.document;
  /* entrega uma mensagem "do fundo" aos ouvintes da aba; devolve a 1ª resposta */
  const enviarAba = async (msg) => {
    for (const fn of ouvintesAba) { const x = fn(msg, {}); if (x !== undefined) return x; }
    return undefined;
  };
  return { w, d: w.document, r, mem, msgs, respostas, P, enviarAba };
}

module.exports = { montarPainel };
