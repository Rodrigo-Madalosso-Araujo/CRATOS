/*
 * teste-painel-situacao.js — a aba Situação na tela (2.0, passo 3).
 *
 * Trava: ao abrir o processo, a Situação lê sozinha as quatro fontes (configuração,
 * diário desta aba e falhas da fila, SAB ao vivo, histórico + linha do tempo do PJe) e
 * mostra uma linha por convênio em uso, com selo e ação que leva ao lugar certo; o
 * SAB que não respondeu é "não obtido" (nunca "sem registro"); a linha do tempo que
 * não respondeu gera aviso; sem registro, o selo diz "sem registro do CRATOS" e nunca
 * "nada pedido"; a aba ganha um ponto quando algo pede você; nenhum CPF, CNPJ ou
 * valor na Situação; leitura atrasada não sobrescreve a nova. Dados fictícios.
 * Reprova o 59aa898 (passo 2) e a 1.9.6.
 */
const fs = require("fs");
const path = require("path");
const { montarPainel } = require("./harness-painel.js");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const NOME = "teste-painel-situacao.js";
const oks = [], falhas = [];
const checar = (c, d) => (c ? oks : falhas).push(d);
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 30));
const espera = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 3000)) { if (fn()) return true; await tick(15); } return false; };

const NUM = "0000999-99.2026.5.18.0008";
const DIG = "00009999920265180008";
const PROC = { id: 555, numero: NUM, partes: [{ nome: "EMPRESA FICTICIA LTDA", cpfcnpj: "11222333000181", polo: "passivo" }] };
const SABP = { id: 900, numero: DIG, idPJe: 555 };
const bl = (t) => [{ pessoa: { nome: "EMPRESA FICTICIA LTDA" }, valorAplicado: 1000, valorBloqueado: t, valorTransferido: t, contas: [] }];
const ORDENS = {
  43999: [
    { id: 1, numeroProtocolo: "20260087519703", situacao: "RESPONDIDA", dataProtocolo: "2026-11-12T13:24:00", dataUltimoProtocolo: "2026-11-12T13:24:00", tipoOrdem: "BLOQUEIO_DE_VALOR", bloqueios: bl(50) },
    { id: 2, numeroProtocolo: "20260088111110", situacao: "ENVIADA", dataProtocolo: "2026-11-12T08:00:00", dataUltimoProtocolo: "2026-11-12T08:00:00", tipoOrdem: "BLOQUEIO_DE_VALOR", bloqueios: [] },
  ],
};
const DETS = [{ id: 43999, situacao: "EM_PROCESSAMENTO", processo: { id: 900, numero: DIG, idPJe: 555 }, ultimaSituacao: { ocorridoEm: "2026-10-16T09:12:00" } }];
const TIMELINE = [
  { id: 300, titulo: "Convênios realizados", tipo: "Certidão", data: "2026-11-10T10:00:00", ativo: true, anexos: [
    { id: 301, titulo: DIG + "_EMPRESA FICTICIA CNIB inclusao", data: "2026-11-10T10:00:00" },
  ] },
];

function fetchFalso(op) {
  const o = op || {};
  const resp = (corpo) => ({ ok: true, status: 200, json: async () => corpo });
  return async (url) => {
    const u = new URL(url, "https://pje.trt18.jus.br");
    const c = u.pathname, q = u.searchParams;
    let m;
    if (c.startsWith("/sab-api/") && o.sabCai) throw new Error("rede");
    if (c === "/sab-api/api/processos") return resp({ resultado: q.get("numeroProcesso").replace(/\D/g, "") === DIG ? [SABP] : [] });
    if (c === "/sab-api/api/determinacoes") return resp({ resultado: DETS, pagina: 1, qtdPaginas: 1 });
    if ((m = c.match(/^\/sab-api\/api\/determinacoes\/(\d+)\/ordens$/))) return resp({ resultado: ORDENS[m[1]] || [], pagina: 1, qtdPaginas: 1 });
    if (/\/timeline$/.test(c)) { if (o.autosCai) return { ok: false, status: 503, json: async () => ({}) }; return resp(TIMELINE); }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

function abrir(op) {
  const o = op || {};
  const mem = Object.assign({
    "cratos:config": { infojud: { colheitaAutomatica: "nao", vara: o.semVara ? "" : "001" } },
    ["cratos:diario:" + DIG]: { numProcesso: DIG, itens: [{ arquivo: "renajud.pdf", convenio: "RENAJUD" }] },
  }, o.mem || {});
  const a = montarPainel(SRC, {
    mem, fetch: fetchFalso(o), url: "https://pje.trt18.jus.br/pjekz/processo/555/detalhe",
    responder: async (m) => {
      if (m.tipo === "capturar") return { ok: true, processo: PROC };
      if (m.tipo === "historico_ler") {
        if (o.histCai) throw new Error("fundo mudo");
        return { ok: true, eventos: [
          { convenio: "INFOJUD", fase: "pedido", em: "2026-11-11T09:00:00Z" },
          { convenio: "CCS", fase: "pedido", em: "2026-11-01T09:00:00Z" },
          { convenio: "CCS", fase: "resposta", em: "2026-11-05T09:00:00Z" },
        ] };
      }
      return undefined;
    },
  });
  const p = a.r.querySelector("cratos-painel");
  if (p) p.setAttribute("aberto", "");
  return a;
}
const linha = (a, id) => a.r.querySelector(`#cx-p-situacao .cx-sit[data-conv-id="${id}"]`);
const selo = (a, id) => { const l = linha(a, id); return l ? l.querySelector(".cx-chip").textContent.trim() : ""; };
const pronto = (a) => espera(() => !!a.r.querySelector("#cx-p-situacao .cx-sit"), 4000);

(async () => {
  if (!fs.existsSync(path.join(SRC, "comum", "situacao.js"))) {
    checar(false, "⛔ a versão tem a Situação do processo (comum/situacao.js)");
    throw new Error("sem situação");
  }

  /* ── 1. leitura completa ─────────────────────────────────────────────── */
  {
    const a = abrir();
    a.P.renderProcesso(PROC);
    const lendo = a.r.querySelector("#cx-sit-lendo");
    checar(!!lendo && lendo.getAttribute("role") === "status", "enquanto lê, um aviso em role=status");
    checar(await pronto(a), "⛔ a Situação aparece sozinha ao abrir o processo");
    const ids = Array.from(a.r.querySelectorAll("#cx-p-situacao .cx-sit")).map((l) => l.dataset.convId);
    checar(ids.length === 9 && ids[0] === "SAB", "uma linha por convênio em uso, na ordem das Preferências");
    checar(Array.from(a.r.querySelectorAll("#cx-p-situacao .cx-sit h3")).length === 9, "cada linha tem um título (navegação por títulos)");
    checar(selo(a, "RENAJUD") === "1 para juntar", "⛔ diário da aba: RENAJUD \"1 para juntar\"");
    checar(selo(a, "SAB") === "1 para juntar" && /transferência respondida/.test(linha(a, "SAB").textContent), "⛔ SAB ao vivo: transferência respondida e não juntada");
    checar(selo(a, "INFOJUD") === "aguardando", "histórico: INFOJUD pedido sem resposta = aguardando");
    checar(selo(a, "CCS") === "juntado", "histórico: CCS com resposta = juntado");
    checar(selo(a, "CNIB") === "incluído", "⛔ linha do tempo do PJe: CNIB incluído (anexo do CRATOS nos autos)");
    checar(selo(a, "CENSEC") === "sem registro do CRATOS", "⛔ sem registro: \"sem registro do CRATOS\"");
    checar(!/nada pedido/i.test(a.r.getElementById("cx-p-situacao").textContent), "⛔ nunca \"nada pedido\"");
    checar(/Não obtido" é falha técnica/.test(a.r.getElementById("cx-p-situacao").textContent), "a nota da regra de ferro está na tela");
    const txt = a.r.getElementById("cx-p-situacao").textContent;
    checar(!/\d{3}\.\d{3}\.\d{3}-\d{2}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\b\d{11}\b|\b\d{14}\b|R\$/.test(txt), "⛔ nenhum CPF, CNPJ ou valor na Situação");
    const aba = a.r.getElementById("cx-aba-situacao");
    checar(!!aba.querySelector(".cx-ponto-aba") && /há pendência/.test(aba.textContent), "a aba Situação ganha um ponto (e \"há pendência\" para o leitor de tela)");

    /* ações */
    const bRen = linha(a, "RENAJUD").querySelector(".cx-sit-acao");
    checar(bRen && /Juntar/.test(bRen.textContent) && /RENAJUD/.test(bRen.textContent), "ação com nome completo (\"Juntar — RENAJUD\")");
    bRen.click();
    checar(a.P.abaAtual === "coletar" && a.r.activeElement && a.r.activeElement.id === "cx-juntar", "⛔ \"Juntar\" leva à aba Coletar com o foco na juntada");
    a.P.irAba("situacao");
    linha(a, "SAB").querySelector(".cx-sit-acao").click();
    checar(a.P.abaAtual === "coletar" && a.r.activeElement && a.r.activeElement.id === "cx-coletar-sab", "SAB pronto: leva ao \"Coletar SAB\"");
  }

  /* ── 2. fontes que não respondem ─────────────────────────────────────── */
  {
    const a = abrir({ sabCai: true });
    a.P.renderProcesso(PROC);
    await pronto(a);
    checar(selo(a, "SAB") === "não obtido" && /falha técnica/.test(linha(a, "SAB").textContent), "⛔ SAB fora do ar: \"não obtido\", nunca \"sem registro\"");
    checar(/Tentar de novo/.test(linha(a, "SAB").textContent), "não obtido oferece \"Tentar de novo\"");
  }
  {
    const a = abrir({ autosCai: true });
    a.P.renderProcesso(PROC);
    await pronto(a);
    const av = a.r.querySelector("#cx-p-situacao .cx-aviso");
    checar(av && /linha do tempo do PJe/.test(av.textContent), "⛔ linha do tempo fora do ar: aviso no topo");
    checar(selo(a, "SAB") === "não obtido", "sem a linha do tempo, o SAB não é contado (não obtido)");
  }
  {
    const a = abrir({ histCai: true });
    a.P.renderProcesso(PROC);
    await pronto(a);
    checar(/histórico do CRATOS/.test(a.r.getElementById("cx-p-situacao").textContent), "histórico fora do ar: aviso no topo");
  }

  /* ── 3. pendência, falha da fila e tentar de novo ─────────────────────── */
  {
    const a = abrir({ semVara: true });
    a.P.renderProcesso(PROC);
    await pronto(a);
    checar(selo(a, "INFOJUD") === "configuração pendente", "⛔ INFOJUD sem vara: \"configuração pendente\"");
    const b = linha(a, "INFOJUD").querySelector(".cx-sit-acao");
    checar(b && /Configurar/.test(b.textContent), "pendência oferece \"Configurar\"");
    b.click();
    await tick();
    checar(a.msgs.some((m) => m.tipo === "abrir_primeiros"), "\"Configurar\" abre os Primeiros passos");

    a.P.ledger = [{ id: "CENSEC", label: "CENSEC", status: "erro", detalhe: "A página do CENSEC não carregou" }];
    await a.P.renderSituacao();
    checar(selo(a, "CENSEC") === "não obtido" && /não carregou/.test(linha(a, "CENSEC").textContent), "⛔ falha da fila desta aba: \"não obtido\" com o motivo");
    linha(a, "CENSEC").querySelector(".cx-sit-acao").click();
    const cb = a.r.querySelector('#cx-p-incluir .cx-sel-conv[data-id="CENSEC"]');
    checar(a.P.abaAtual === "incluir" && cb && cb.checked && a.r.activeElement === cb, "\"Tentar de novo\" abre Incluir com o convênio marcado e o foco nele");
  }

  /* ── 4. leitura atrasada não sobrescreve a nova ───────────────────────── */
  {
    const a = abrir();
    a.P.renderProcesso(PROC);
    const p1 = a.P.renderSituacao();
    const p2 = a.P.renderSituacao();
    await Promise.all([p1, p2]);
    checar(a.r.querySelectorAll("#cx-p-situacao .cx-lista").length === 1, "duas leituras seguidas: uma lista só");
  }

  /* ── 5. manifesto ─────────────────────────────────────────────────────── */
  {
    const man = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8"));
    const cs = (man.content_scripts || []).find((c) => (c.js || []).includes("conteudo/painel.js")) || { js: [] };
    checar(cs.js.indexOf("comum/situacao.js") >= 0 && cs.js.indexOf("comum/situacao.js") < cs.js.indexOf("conteudo/painel.js"),
      "situacao.js carrega antes do painel.js");
  }

  console.log(`\n=== ${NOME} ===`);
  oks.forEach((x) => console.log("  ok   " + x));
  falhas.forEach((x) => console.log("  FALHA " + x));
  console.log(`\n${oks.length} passaram, ${falhas.length} falharam (${oks.length + falhas.length} asserções)\n`);
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => {
  console.log(`\n=== ${NOME} ===`);
  falhas.forEach((x) => console.log("  FALHA " + x));
  console.log("FALHA geral: " + e.message);
  console.log(`\n${oks.length} passaram, ${falhas.length + 1} falharam\n`);
  process.exit(1);
});
