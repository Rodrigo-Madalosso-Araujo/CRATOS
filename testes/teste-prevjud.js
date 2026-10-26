/*
 * teste-prevjud.js — módulo PREVJUD (1.8.0): Dossiê Previdenciário (CNJ/INSS).
 * Dados 100% FICTÍCIOS (fixture-prevjud.js). O "PREVJUD" do teste responde ao SOLICITAR,
 * ao atualizar e ao Visualizar pelo mesmo CustomEvent que o grampo dispara.
 *
 * Trava:
 *  1. Fundo: só PF com CPF; sem `esperados` (pulso terminal); Preferências com um
 *     interruptor por documento; coleta pelos pedidos guardados; fiação; PDF por bytes.
 *  2. Grampo: rota relativa /previdenciario-api/; sem cabeçalho.
 *  3. Caso feliz (2 CPFs): processo uma vez, CPF por CPF, um protocolo cada; abre o
 *     dossiê CERTO (pelo protocolo, não o pedido antigo do mesmo CPF); junta os PDFs
 *     oficiais; certidão por documento: obtido / SEM RESPOSTA POSITIVA (mensagem do INSS,
 *     sem o CPF) / não disponibilizado / não solicitado; PJ registrada; pulso; fecha a aba.
 *  4. ⛔ Falha técnica não vira negativa; pedido não pronto → "em processamento" + coleta.
 *  5. Coleta: pronto → PDFs + certidão; ainda não → sem certidão.
 *  6. ⛔ Travas: dossiê médico / penhora; tela proibida; CPF trocado no envio; recusa.
 * Reprova a 1.7.3 (não há módulo PREVJUD).
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");
const F = require("./fixture-prevjud.js");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const NOME = "teste-prevjud.js";
const oks = [], falhas = [];
const checar = (c, d) => (c ? oks : falhas).push(d);
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 20));
async function ate(cond, ms) { const t0 = Date.now(); while (Date.now() - t0 < (ms || 4000)) { try { if (cond()) return true; } catch (e) {} await tick(10); } return false; }
const AGORA = Date.parse("2026-10-21T16:00:00-03:00");

if (!fs.existsSync(path.join(SRC, "conteudo", "prevjud.js"))) {
  console.log(`\n=== ${NOME} ===\n  FALHA  a versão em ${SRC} não tem o módulo PREVJUD (conteudo/prevjud.js).\n\n0 passaram — a suíte inteira reprova nesta versão.\n`);
  process.exit(1);
}

function montar(o, gancho) {
  const op = o || {};
  const url = op.url || "https://previdenciario.pdpj.jus.br/dossie-previdenciario";
  const dom = new JSDOM(F.tela(op), { url, runScripts: "outside-only" });
  const w = dom.window;
  const mem = {};
  mem["cratos:prevjud_estado"] = Object.assign({
    ativo: true, modo: "solicitar", numProcesso: F.PROC_FMT, numeroDigitos: F.PROC,
    docs: [{ nome: F.NOME_A, cpf: F.CPF_A }, { nome: F.NOME_B, cpf: F.CPF_B }],
    semCpf: [{ nome: F.NOME_PJ, doc: F.CNPJ }],
    config: { documentos: { beneficios: true, carta: true, cadastrais: true, quadro: true, extrato: true, historico: true }, outros: true, pasta: "CRATOS" },
    pedidos: [], fase: "iniciado", abertoEm: new Date(AGORA).toISOString(),
  }, op.estado || {});
  if (op.registro) mem["cratos:prevjud_req:" + F.PROC] = op.registro;
  const r = { w, d: w.document, mem, msgs: [], faixas: [], paradas: [], cliques: [], nav: [], cortina: [], fechou: 0, solicitacoes: 0 };
  const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
  w.browser = {
    storage: { local: { get: async (k) => ({ [k]: clone(mem[k]) }), set: async (ob) => { for (const [k, v] of Object.entries(ob)) mem[k] = clone(v); }, remove: async (k) => { delete mem[k]; } },
      onChanged: { addListener() {}, removeListener() {} } },
    runtime: { sendMessage: async (m) => { r.msgs.push(clone(m)); return { ok: true }; }, getURL: (p) => "moz-extension://x/" + p, onMessage: { addListener() {} } },
  };
  w.CratosFaixa = { mostrar: (m, t, c) => r.faixas.push({ t: String(t), c }), parar: (m, t) => r.paradas.push({ t: String(t) }), alertar() {}, dizer() {} };
  w.CratosOverlay = { mostrar: () => r.cortina.push("mostrar"), esconder: () => r.cortina.push("esconder") };
  for (const k of ["log", "warn", "error", "debug"]) w.console[k] = () => {};
  w.DataTransfer = class { constructor() { this._d = {}; } setData(t, v) { this._d[t] = String(v); } getData(t) { return this._d[t] || ""; } };
  w.ClipboardEvent = class extends w.Event { constructor(t, o) { super(t, o); this.clipboardData = (o && o.clipboardData) || null; } };
  w.eval(fs.readFileSync(path.join(SRC, "comum", "storage.js"), "utf8"));

  const API = "/previdenciario-api/api/v1";
  /* como a escuta real: avisa o INÍCIO do pedido na hora e o FIM depois (com o mesmo nº `k`) */
  let kSeq = 0;
  const emitir = (metodo, u, status, corpo, enviado, atraso) => {
    const k = ++kSeq;
    const url = "https://previdenciario.pdpj.jus.br" + u;
    w.dispatchEvent(new w.CustomEvent("cratos:prevjud:inicio", { detail: JSON.stringify({ k, metodo, url }) }));
    return setTimeout(() => {
      w.dispatchEvent(new w.CustomEvent("cratos:prevjud:api", { detail: JSON.stringify({
        k, metodo, url, status, corpo: corpo == null ? "" : JSON.stringify(corpo),
        enviado: enviado == null ? null : JSON.stringify(enviado) }) }));
    }, atraso || 4);
  };
  /* estado do "INSS": quantos "atualizar" até ficar pronto, por CPF (Infinity = nunca) */
  const atrasos = Object.assign({ [F.CPF_A]: 1, [F.CPF_B]: 1 }, op.atrasos || {});
  const pedidos = {};   // protocolo -> {cpf, cliques, data, atraso?}
  for (const p of (op.estado && op.estado.pedidos) || []) if (p.protocolo) pedidos[p.protocolo] = { cpf: p.cpf, cliques: 0, data: "2026-10-21T15:00:00-03:00" };
  for (const x of op.lista || []) pedidos[x.protocolo] = { cpf: x.cpf, cliques: 0, data: x.data, atraso: x.atraso };
  const statusDe = (proto) => { const p = pedidos[proto]; const at = p && p.atraso != null ? p.atraso : atrasos[p && p.cpf];
    return p && p.cliques >= at ? "FINALIZADO" : "EM_PROCESSAMENTO"; };
  /* formato REAL da lista (recon de 21/10, 16h38): protocolo em uso em `protocoloDossieAtivo` (situação que
     NÃO muda para pronto), pronto = `dataEntregaResposta` preenchida; `protocolos[]` traz OUTROS protocolos do
     pedido, com outra situação (aqui, uma que casaria com "falha" — não pode decidir nada) */
  const outroProto = (proto) => "f" + proto.slice(1, -1) + "f";
  /* 1.9.0 (ao vivo, 26/10): o protocolo EM USO aparece com "ERROR_AO_RECEBER_PEDIDO_PDPJ" e só
     depois de alguns APLICAR o PREVJUD mostra o pedido refeito (op.erroNoAtivo = {cpf: nº de APLICAR}) */
  const itemRefazendo = (proto) => {
    const p = pedidos[proto];
    if (p.cliques < p.erroAte) return { cpf: p.cpf, numeroProcesso: F.PROC_FMT.slice(0, 20), dataCriacao: p.data, tipo: "PREVIDENCIARIO",
      dataEntregaResposta: null, protocolos: [], tempoResposta: null,
      protocoloDossieAtivo: { protocolo: proto, statusDossie: "ERROR_AO_RECEBER_PEDIDO_PDPJ", parametro: p.cpf } };
    const pronto = p.cliques >= p.erroAte + 1;
    return { cpf: p.cpf, numeroProcesso: F.PROC_FMT.slice(0, 20), dataCriacao: p.data, tipo: "PREVIDENCIARIO",
      dataEntregaResposta: pronto ? "2026-10-21T19:10:00.000Z" : null, tempoResposta: pronto ? "1 minuto" : null,
      protocolos: [{ protocolo: proto, statusDossie: "ERROR_AO_RECEBER_PEDIDO_PDPJ", parametro: p.cpf }],
      protocoloDossieAtivo: { protocolo: p.refeito, statusDossie: "SOLICITADO_DATAPREV", parametro: p.cpf } };
  };
  const listaContent = () => Object.keys(pedidos).filter((proto) => !pedidos[proto].oculto).map((proto) => pedidos[proto].erroAte != null ? itemRefazendo(proto) : ({
    cpf: pedidos[proto].cpf, numeroProcesso: F.PROC_FMT.slice(0, 20), dataCriacao: pedidos[proto].data, tipo: "PREVIDENCIARIO",
    dataEntregaResposta: statusDe(proto) === "FINALIZADO" ? "2026-10-21T19:10:00.000Z" : null,
    protocolos: [pedidos[proto].inicial
      ? { protocolo: pedidos[proto].inicial, statusDossie: "ERROR_AO_RECEBER_PEDIDO_PDPJ", parametro: pedidos[proto].cpf }
      : { protocolo: outroProto(proto), statusDossie: "FALHA_NA_TENTATIVA_UM", parametro: pedidos[proto].cpf }],
    protocoloDossieAtivo: { protocolo: proto, statusDossie: "SOLICITADO_DATAPREV", parametro: pedidos[proto].cpf },
    tempoResposta: statusDe(proto) === "FINALIZADO" ? "3 minutos" : null }));
  const URL_SOL = `${API}/dossiePrevidenciario/1.0.0/solicitarDossie/cpf`;
  const respSol = (cpf, proto, st) => [{ protocolo: proto, statusDossie: st || "SOLICITADO_DATAPREV", dataSolicitacao: "2026-10-21T16:00:00", tipoDossie: "PREVIDENCIARIO", parametro: cpf, tipoParametro: "CPF" }];
  let retida = null;

  r.emitir = emitir; r.listaContent = listaContent;
  const espera = gancho ? gancho(w, r) : null;
  if (espera && espera.then) { espera.then(() => carregar()); return r; }
  carregar();
  return r;
  function carregar() {
  w.eval(fs.readFileSync(path.join(SRC, "conteudo", "prevjud.js"), "utf8"));
  const api = w.__cratosPrevjud;
  r.api = api;
  api.io.agora = () => AGORA;
  api.io.esperar = () => new Promise((res) => setTimeout(res, 1));
  api.io.navegar = (u) => r.nav.push(String(u));
  api.io.fecharAba = () => { r.fechou++; };
  if (op.listaNaCarga) emitir("POST", `${API}/previdenciario/1.0.0/pesquisarPedidosDossie?page=0&size=10`, 200, { content: listaContent() });
  api.io.clicar = (el) => {
    const rot = (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim();
    r.cliques.push(rot);
    if (/^SOLICITAR$/.test(rot)) {
      r.solicitacoes++;
      const cpf = (w.document.getElementById("solicitacaoCpf").value || "").replace(/\D/g, "");
      const proc = (w.document.getElementById("solicitacaoProcesso").value || "").replace(/\D/g, "");
      const enviado = [{ cpf: op.cpfTrocado ? "11144477735" : cpf, nomeCliente: "TRT18 - 8A VARA", numeroProcesso: F.PROC_FMT.slice(0, 20) }];
      if (op.semConfirmacao) return;
      if (op.recusa) return emitir("POST", URL_SOL, 500, { result: "Erro interno" }, enviado);
      if (op.erroNoAtivo && op.erroNoAtivo[cpf] != null) {
        const x = F.PROTO[cpf], y = "c" + x.slice(1);
        pedidos[x] = { cpf, cliques: 0, data: "2026-10-21T16:00:30-03:00", erroAte: op.erroNoAtivo[cpf], refeito: y };
        pedidos[y] = { cpf, cliques: 0, data: "2026-10-21T16:00:30-03:00", oculto: true };
        emitir("POST", URL_SOL, 200, respSol(cpf, x, "ERROR_AO_RECEBER_PEDIDO_PDPJ"), enviado);
        setTimeout(() => { w.document.getElementById("pedidos").insertAdjacentHTML("afterbegin",
          F.linhaPedido(cpf, x, "ERRO") + F.linhaPedido(cpf, y, "EM PROCESSAMENTO")); }, 6);
        return;
      }
      if ((op.erroNoPedido || []).includes(cpf)) {
        /* 22/10 ao vivo: o protocolo devolvido falha e o PREVJUD refaz com OUTRO, que vira o ativo e conclui */
        const x = F.PROTO[cpf], y = "b" + x.slice(1);
        pedidos[y] = { cpf, cliques: 0, data: "2026-10-21T16:00:30-03:00", inicial: x };
        emitir("POST", URL_SOL, 200, respSol(cpf, x, "ERROR_AO_RECEBER_PEDIDO_PDPJ"), enviado);
        setTimeout(() => { w.document.getElementById("pedidos").insertAdjacentHTML("afterbegin", F.linhaPedido(cpf, y, "EM PROCESSAMENTO")); }, 6);
        return;
      }
      const proto = F.PROTO[cpf] || "00000000-0000-4000-8000-000000000000";
      pedidos[proto] = { cpf, cliques: 0, data: "2026-10-21T16:00:30-03:00" };
      r.procNoEnvio = proc;
      if (retida) { const x = retida; retida = null; emitir("POST", URL_SOL, 200, respSol(x.cpf, x.proto), x.enviado); }
      if (op.respostaAtrasadaA && cpf === F.CPF_A) retida = { cpf, proto, enviado };
      else if (!(op.semResposta || []).includes(cpf)) emitir("POST", URL_SOL, 200, respSol(cpf, proto), enviado);
      setTimeout(() => { w.document.getElementById("pedidos").insertAdjacentHTML("afterbegin", F.linhaPedido(cpf, proto, "EM PROCESSAMENTO")); }, 6);
      return;
    }
    if (/^Baixar$/.test(rot)) { r.downloads = (r.downloads || 0) + 1; return; }
    if (/^APLICAR$/.test(rot)) {
      for (const p of Object.values(pedidos)) p.cliques++;
      emitir("POST", `${API}/previdenciario/1.0.0/pesquisarPedidosDossie?page=0&size=100`, 200, { content: listaContent() });
      return;
    }
    if (/^Visualizar$/.test(rot)) {
      const proto = el.closest("tr").getAttribute("data-proto");
      r.abertos = (r.abertos || []).concat(proto);
      r.vezes = r.vezes || {}; r.vezes[proto] = (r.vezes[proto] || 0) + 1;
      /* o PREVJUD responde 503 a um documento nas N primeiras aberturas (recon de 22/10) */
      const falha = (trecho) => (op.falha503 || {})[trecho] >= r.vezes[proto];
      const atraso = (trecho) => (op.lentos || {})[trecho];
      const doc = (trecho, st, corpo) => falha(trecho)
        ? emitir("GET", `${API}/dossiePrevidenciario/1.0.0/${trecho}/${proto}`, 503, { status: 503, error: "Service Unavailable" }, null, atraso(trecho))
        : emitir("GET", `${API}/dossiePrevidenciario/1.0.0/${trecho}/${proto}`, st, corpo, null, atraso(trecho));
      const cpf = proto === F.PROTO_VELHO ? F.CPF_A : (pedidos[proto] || {}).cpf;
      emitir("GET", `${API}/dossiePrevidenciario/1.0.0/obterDossie/${proto}`, 200, F.dossie(proto, cpf, op));
      const base = `${API}/dossiePrevidenciario/1.0.0`;
      void base;
      doc("beneficios", 200, { dataRequisicao: "x", protocoloRequisicao: proto, pdfBase64: F.PDF_B64 });
      doc("carta-concessao", 404, { httpCode: 404, result: "Não existe carta de concessão para o CPF 123.456.789-09", errorMessage: "" });
      doc("dados-cadastrais-cnis", 200, { pdfBase64: F.PDF_B64 });
      if (!op.semExtrato) doc("extrato-cnis", 200, { pdfBase64: F.PDF_B64 });
      doc("quadro-dossie-previdenciario", 200, { pdfBase64: F.PDF_B64 });
      if (op.docNovo) doc("vinculos-empregaticios", 200, { pdfBase64: F.PDF_B64 });
      return;
    }
  };
  }
}
const pdfs = (t) => t.msgs.filter((m) => m.tipo === "prevjud_pdf");
const certidao = (t) => t.msgs.find((m) => m.tipo === "fabricar_pdf" && m.convenio === "PREVJUD");
const txt = (m) => (m && m.linhas ? m.linhas.join("\n") : "");
const seguro = (fn) => { try { return fn(); } catch (e) { return false; } };

(async () => {
  /* ── 1. fundo ─────────────────────────────────────────────────────────── */
  try {
    const mem = {}, abas = [];
    const ctx = { console: { log() {}, warn() {}, error() {} },
      browser: { storage: { local: { get: async (k) => ({ [k]: mem[k] }), set: async (o) => Object.assign(mem, JSON.parse(JSON.stringify(o))), remove: async () => {} }, onChanged: { addListener() {} } },
        tabs: { query: async () => [], create: async (o) => { abas.push(o.url); return { id: 1 }; }, update: async (id, o) => { abas.push(o.url); return { id }; } } } };
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    for (const f of [["comum", "storage.js"], ["modulos", "registro.js"], ["modulos", "prevjud.js"]]) vm.runInContext(fs.readFileSync(path.join(SRC, ...f), "utf8"), ctx);
    vm.runInContext("globalThis.__M = ModuloPREVJUD; globalThis.__R = Registro;", ctx);
    const M = ctx.__M, R = ctx.__R;
    const partes = [{ nome: F.NOME_A, cpfcnpj: "123.456.789-09" }, { nome: F.NOME_PJ, cpfcnpj: "11.222.333/0001-81" }, { nome: "SEM DOC", cpfcnpj: "" }];
    const r1 = await M.executar({ numeroProcesso: F.PROC_FMT, partes }, "consulta");
    const est = mem["cratos:prevjud_estado"] || {};
    checar(r1.ok && r1.aguardando && r1.esperados === undefined, "fundo: inicia SEM `esperados` (o nº de PDFs só se sabe no fim — pulso terminal)");
    checar(abas[0] === "https://previdenciario.pdpj.jus.br/dossie-previdenciario", "fundo: abre direto o Dossiê Previdenciário");
    checar(est.docs.length === 1 && est.docs[0].cpf === F.CPF_A && est.semCpf.length === 2 && est.semCpf[0].nome === F.NOME_PJ,
      "fundo: só pessoa física com CPF; PJ e sem documento ficam registradas para a certidão");
    checar((await M.executar({ numeroProcesso: F.PROC_FMT, partes: [partes[1]] }, "consulta")).ok === false, "só PJ: recusa (o dossiê é por CPF)");
    checar((await M.executar({ numeroProcesso: F.PROC_FMT, partes }, "inclusao")).ok === false, "⛔ não há inclusão/baixa — só o dossiê");
    mem["cratos:config"] = { prevjud: { doc_quadro: { ativo: false } } };
    await M.executar({ numeroProcesso: F.PROC_FMT, partes }, "consulta");
    checar(mem["cratos:prevjud_estado"].config.documentos.quadro === false && mem["cratos:prevjud_estado"].config.documentos.extrato === true,
      "Preferências: documento desligado sai; os demais ficam ligados");
    const off = {}; ["beneficios", "carta", "cadastrais", "quadro", "extrato", "historico", "outros"].forEach((k) => { off["doc_" + k] = { ativo: false }; });
    mem["cratos:config"] = { prevjud: off };
    checar((await M.executar({ numeroProcesso: F.PROC_FMT, partes }, "consulta")).ok === false, "todos os documentos desligados: recusa");
    delete mem["cratos:config"];
    const reg = R.obter("prevjud");
    const tg = reg ? Object.keys(reg.config).filter((k) => /^doc_/.test(k)) : [];
    checar(tg.length === 7 && tg.every((k) => reg.config[k].tipo === "toggle" && reg.config[k].padrao.ativo === true),
      "Preferências: 7 interruptores (6 documentos + outros), todos LIGADOS de fábrica");
    const av = reg ? reg.config._avisoEscopo.itens.join(" ") : "";
    checar(/Dossiê Médico/.test(av) && /penhora/.test(av) && /sigilosos/.test(av), "Preferências: aviso de escopo (sem dossiê médico nem penhora) e sigilo");
    abas.length = 0;
    const r0 = await M.coletar({ numeroProcesso: F.PROC_FMT, partes: [{ nome: F.NOME_A, cpfcnpj: "123.456.789-09" }, { nome: F.NOME_PJ, cpfcnpj: "11.222.333/0001-81" }] });
    const e0 = mem["cratos:prevjud_estado"] || {};
    checar(r0.ok && r0.descobrir && e0.modo === "coleta" && e0.descobrir === true && e0.pedidos.length === 0 && e0.nomes[F.CPF_A] === F.NOME_A && abas[0],
      "coleta SEM pedido anotado: abre o PREVJUD para procurar pelo nº do processo (com os nomes das partes)");
    mem["cratos:prevjud_req:" + F.PROC] = [{ cpf: F.CPF_A, nome: F.NOME_A, protocolo: F.PROTO[F.CPF_A], encerrado: false }, { cpf: F.CPF_B, nome: F.NOME_B, protocolo: "x", encerrado: true }];
    const rc = await M.coletar({ numeroProcesso: F.PROC_FMT });
    checar(rc.ok && rc.pedidos === 1 && mem["cratos:prevjud_estado"].modo === "coleta" && mem["cratos:prevjud_estado"].pedidos[0].protocolo === F.PROTO[F.CPF_A] && abas[0],
      "coleta: só os pedidos em aberto deste processo, abrindo o Dossiê Previdenciário");
  } catch (e) { checar(false, "fundo: não rodou (" + e.message + ")"); }

  /* PDF por bytes (rota prevjud_pdf) */
  try {
    const salvos = [];
    const ctx = { console: { log() {}, warn() {}, error() {} }, TextDecoder, Blob, URL: { createObjectURL: () => "blob:x" },
      atob: (s) => Buffer.from(s, "base64").toString("latin1"),
      _b64ToBytes: (b64) => Uint8Array.from(Buffer.from(b64, "base64")),
      _bytesParaBase64: (b) => Buffer.from(b).toString("base64"),
      montarNomePdf: (pasta, num, nome, tipo, ext, ni) => `${pasta}/${String(num).replace(/\D/g, "")}_${nome}_${ni} ${tipo}.${ext}`,
      baixarERegistrar: (url, filename, reg) => salvos.push({ filename, reg }) };
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(SRC, "modulos", "prevjud.js"), "utf8"), ctx);
    const a = await vm.runInContext("salvarPdfPrevjud", ctx)({ base64: F.PDF_B64, numProcesso: F.PROC_FMT, nomeAbrev: "FULANO FICTICIO", cpf: F.CPF_A, rotulo: "PREVJUD Extrato CNIS", detalhe: "extrato" });
    const b = await vm.runInContext("salvarPdfPrevjud", ctx)({ base64: Buffer.from(F.PDF_B64).toString("base64"), numProcesso: F.PROC_FMT, nomeAbrev: "X", cpf: F.CPF_A, rotulo: "PREVJUD Y" });
    const c = await vm.runInContext("salvarPdfPrevjud", ctx)({ base64: Buffer.from("<html>erro</html>").toString("base64"), numProcesso: F.PROC_FMT, nomeAbrev: "X", cpf: F.CPF_A, rotulo: "PREVJUD Z" });
    checar(a.ok && /CRATOS\/00000031420245180008_FULANO FICTICIO_12345678909 PREVJUD Extrato CNIS\.pdf/.test(a.filename) && salvos[0].reg.convenio === "PREVJUD",
      "prevjud_pdf: PDF oficial salvo no padrão CRATOS (com o CPF), convênio PREVJUD");
    checar(b.ok && c.ok === false && salvos.length === 2, "prevjud_pdf: confere %PDF pelos bytes (aceita base64 duplo; recusa o que não é PDF)");
  } catch (e) { checar(false, "prevjud_pdf: não rodou (" + e.message + ")"); }

  {
    const man = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8"));
    const bg = fs.readFileSync(path.join(SRC, "background.js"), "utf8");
    const painel = fs.readFileSync(path.join(SRC, "conteudo", "painel.js"), "utf8");
    const cs = (man.content_scripts || []).find((c) => (c.matches || []).includes("https://previdenciario.pdpj.jus.br/*") && c.js.includes("conteudo/prevjud.js"));
    checar(!!cs && cs.js.includes("conteudo/prevjud.js") && (man.web_accessible_resources || []).includes("conteudo/prevjud-api.js") &&
      man.background.scripts.includes("modulos/prevjud.js") && man.permissions.includes("https://previdenciario.pdpj.jus.br/*"), "manifest: PREVJUD ligado (host, content script, grampo, módulo)");
    checar(/case "PREVJUD":\s*return ModuloPREVJUD\.executar/.test(bg) && /case "prevjud_pdf":\s*return salvarPdfPrevjud/.test(bg) &&
      /case "prevjud_coletar":\s*return ModuloPREVJUD\.coletar/.test(bg) && /case "prevjud_fechar_aba":[\s\S]{0,120}fecharAbaSab\(sender\)/.test(bg), "background: orquestrador, PDF, coleta e fechar aba");
    checar(/id: "PREVJUD",[^\n]*ops: \["consulta"\]/.test(painel) && /id="cx-coletar-prevjud"/.test(painel) && /tipo: "prevjud_coletar"/.test(painel),
      "painel: PREVJUD na lista e botão \"Coletar PREVJUD\"");
  }

  /* ── 2. grampo ─────────────────────────────────────────────────────────── */
  {
    const dom = new JSDOM("<!doctype html><body></body>", { url: "https://previdenciario.pdpj.jus.br/dossie-previdenciario", runScripts: "outside-only" });
    const w = dom.window;
    const ouvidos = [];
    w.addEventListener("cratos:prevjud:api", (e) => ouvidos.push(JSON.parse(e.detail)));
    w.fetch = async () => ({ status: 200, clone() { return { text: async () => '{"pdfBase64":"JVBERi0x"}' }; } });
    w.eval(fs.readFileSync(path.join(SRC, "conteudo", "prevjud-api.js"), "utf8"));
    await w.fetch("/previdenciario-api/api/v1/dossiePrevidenciario/1.0.0/extrato-cnis/abc", { headers: { Authorization: "Bearer eyJsegredo" } });
    await w.fetch("/delega-perfil/api/v1/delegacoes");
    await tick(20);
    checar(ouvidos.length === 1 && /extrato-cnis/.test(ouvidos[0].url) && /pdfBase64/.test(ouvidos[0].corpo), "grampo: escuta a rota relativa /previdenciario-api/ e ignora as demais");
    checar(!JSON.stringify(ouvidos).includes("Bearer"), "⛔ grampo: nunca repassa o token");
  }
  {
    /* 1.8.2: o grampo entra em document_start e guarda as primeiras respostas */
    const man = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8"));
    const cedo = (man.content_scripts || []).find((c) => (c.matches || []).includes("https://previdenciario.pdpj.jus.br/*") && c.run_at === "document_start");
    checar(!!cedo && cedo.js.length === 1 && cedo.js[0] === "conteudo/prevjud-cedo.js" && fs.existsSync(path.join(SRC, "conteudo", "prevjud-cedo.js")),
      "manifest: o grampo entra em document_START (antes de a tela buscar a lista)");
    const dom = new JSDOM("<!doctype html><body></body>", { url: "https://previdenciario.pdpj.jus.br/dossie-previdenciario", runScripts: "outside-only" });
    const w = dom.window;
    w.fetch = async () => ({ status: 200, clone() { return { text: async () => '{"content":[]}' }; } });
    w.eval(fs.readFileSync(path.join(SRC, "conteudo", "prevjud-api.js"), "utf8"));
    await w.fetch("/previdenciario-api/api/v1/previdenciario/1.0.0/pesquisarPedidosDossie?page=0&size=100", { method: "POST" });
    await tick(20);
    const ouvidos = [];
    w.addEventListener("cratos:prevjud:api", (e) => ouvidos.push(JSON.parse(e.detail)));
    w.dispatchEvent(new w.CustomEvent("cratos:prevjud:reenviar"));
    w.dispatchEvent(new w.CustomEvent("cratos:prevjud:reenviar"));
    checar(ouvidos.length === 1 && /pesquisarPedidosDossie/.test(ouvidos[0].url) && ouvidos[0].n === 1,
      "grampo: guarda a resposta que chegou ANTES do content script e a reenvia uma única vez, numerada");
  }

  /* escuta do lado da extensão (1.8.4) — com o endurecimento da 1.9.0: só rotas do Dossiê
     Previdenciário, CANAL INTERNO (nada em evento da página), só com tarefa ativa */
  const paginaFalsa = (o) => {
    const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: "https://previdenciario.pdpj.jus.br/dossie-previdenciario", runScripts: "outside-only" });
    const w = dom.window;
    const injetados = [];
    const appendOrig = w.HTMLElement.prototype.appendChild;
    w.HTMLElement.prototype.appendChild = function (el) { if (el && el.tagName === "SCRIPT") injetados.push(el.src); return appendOrig.call(this, el); };
    class XhrFalso {
      constructor() { this._ls = {}; this.status = 0; this.responseText = ""; this.responseURL = ""; }
      addEventListener(t, f) { (this._ls[t] = this._ls[t] || []).push(f); }
      open(m, u) { this._m = m; this._u = u; }
      abort() {}
      send() { setTimeout(() => { this.status = 200; this.responseText = '{"content":[]}'; this.responseURL = new URL(this._u, w.location.href).href;
        (this._ls.loadend || []).forEach((f) => f()); }, 2); }
    }
    w.XMLHttpRequest = XhrFalso;
    w.fetch = async () => ({ status: 200, clone() { return { text: async () => '{"pdfBase64":"JVBERi0x"}' }; } });
    /* a barreira do Firefox (22/10, 1.8.4): o `apply` da PÁGINA não pode ler o `arguments` da extensão */
    const barrar = () => { throw new Error("Permission denied to access property \"length\""); };
    XhrFalso.prototype.open.apply = barrar; XhrFalso.prototype.send.apply = barrar; w.fetch.apply = barrar;
    const exportados = [];
    if (!(o && o.semFirefox)) {
      w.wrappedJSObject = w;
      w.exportFunction = (o && o.exportQuebrado)
        ? (fn, alvo, op) => { const q = function () { throw new Error("recusado"); }; if (op && op.defineAs) alvo[op.defineAs] = q; return q; }
        : (fn, alvo, op) => { exportados.push((op && op.defineAs) || "cb"); if (op && op.defineAs) alvo[op.defineAs] = fn; return fn; };
    }
    w.browser = { runtime: { getURL: (x) => "moz-extension://x/" + x } };
    for (const k of ["log", "warn", "error", "debug"]) w.console[k] = () => {};
    w.CratosFaixa = { mostrar() {}, parar() {} };
    const estado = (o && o.tarefa) ? { ativo: true, modo: "solicitar", numProcesso: F.PROC_FMT, numeroDigitos: F.PROC, docs: [{ nome: F.NOME_A, cpf: F.CPF_A }],
      semCpf: [], config: { documentos: {}, outros: true }, pedidos: [], fase: "iniciado", abertoEm: new Date().toISOString() } : null;
    w.Store = { get: async (k) => (k === "prevjud_estado" ? estado : null), set: async () => {}, ligada: async () => true };
    const pedir = (metodo, url, corpo) => { const x = new w.XMLHttpRequest(); x.open(metodo, url); x.send(corpo); };
    return { w, injetados, exportados, pedir };
  };
  {
    const { w, injetados, exportados, pedir } = paginaFalsa({ tarefa: true });
    w.eval(fs.readFileSync(path.join(SRC, "conteudo", "prevjud-cedo.js"), "utf8"));
    const naPagina = [];
    for (const ev of ["cratos:prevjud:api", "cratos:prevjud:inicio"]) w.addEventListener(ev, (e) => naPagina.push(e.detail));
    /* a página pede ANTES do content script (a lista da abertura) */
    pedir("POST", "previdenciario-api/api/v1/previdenciario/1.0.0/pesquisarPedidosDossie?page=0&size=100", '{"tipo":"PREVIDENCIARIO"}');
    pedir("POST", "previdenciario-api/api/v1/previdenciario/1.0.0/pesquisarPedidosDossie?page=0&size=100", '{"tipo":"MEDICO"}');
    pedir("GET", "/previdenciario-api/api/v1/dossieMedico/1.0.0/obterDossie/abc");
    pedir("GET", "/delega-perfil/api/v1/delegacoes");
    await w.fetch("previdenciario-api/api/v1/dossiePrevidenciario/1.0.0/extrato-cnis/abc", { headers: { Authorization: "Bearer eyJsegredo" } });
    await tick(30);
    checar(["open", "send", "fetch"].every((k) => exportados.includes(k)) && !injetados.length && w.__cratosPrevjudCedo === "firefox" &&
      w.document.documentElement.getAttribute("data-cratos-prevjud") === "escutando" && typeof w.__cratosPrevjudEscuta === "object",
      "⛔ escuta pelo recurso do Firefox (sem inserir script na página) e deixa a marca \"escutando\"");
    checar(naPagina.length === 0, "⛔ CANAL INTERNO: nada do que se capta vai para evento da página (script do site não lê)");
    w.eval(fs.readFileSync(path.join(SRC, "conteudo", "prevjud.js"), "utf8"));
    await tick(40);
    const caps = w.__cratosPrevjud.capturas;
    checar(caps.length === 2 && caps.some((c) => /pesquisarPedidosDossie/.test(c.url) && c.enviado && c.enviado.tipo === "PREVIDENCIARIO") &&
      caps.some((c) => /extrato-cnis/.test(c.url) && c.json && c.json.pdfBase64),
      "⛔ com tarefa: recebe a lista da abertura e o PDF, com endereço RELATIVO (XHR e fetch)");
    checar(!caps.some((c) => /dossieMedico|delega-perfil/.test(c.url)) && !caps.some((c) => c.enviado && c.enviado.tipo === "MEDICO"),
      "⛔ só o Dossiê PREVIDENCIÁRIO: Dossiê Médico (rota e lista do tipo MÉDICO) e o resto do PREVJUD passam batidos");
    checar(!JSON.stringify(caps).includes("Bearer"), "⛔ escuta: nunca repassa o token");
    w.dispatchEvent(new w.CustomEvent("cratos:prevjud:api", { detail: JSON.stringify({ n: 999, metodo: "GET",
      url: "https://previdenciario.pdpj.jus.br/previdenciario-api/api/v1/dossiePrevidenciario/1.0.0/beneficios/abc", status: 200, corpo: '{"pdfBase64":"FORJADO"}' }) }));
    await tick(10);
    checar(caps.length === 2 && !JSON.stringify(caps).includes("FORJADO"), "⛔ evento FORJADO por script da página é ignorado (não vira \"PDF do INSS\")");
    let quebrou = null;
    try { pedir("GET", "/qualquer"); await w.fetch("/outra"); } catch (e) { quebrou = e.message; }
    checar(quebrou === null, "⛔ a escuta NÃO quebra as chamadas da página (repasse permitido pelo Firefox — a 1.8.4 travava o login)");
    checar(!injetados.length, "⛔ com a escuta ativa, o content script NÃO injeta o grampo de página (nunca os dois: PDF duplicado)");
  }
  {
    /* SEM tarefa do CRATOS: a escuta é desligada e a memória dela, apagada */
    const { w, pedir } = paginaFalsa({ tarefa: false });
    w.eval(fs.readFileSync(path.join(SRC, "conteudo", "prevjud-cedo.js"), "utf8"));
    pedir("POST", "/previdenciario-api/api/v1/previdenciario/1.0.0/pesquisarPedidosDossie?page=0", '{"tipo":"PREVIDENCIARIO"}');
    await tick(20);
    w.eval(fs.readFileSync(path.join(SRC, "conteudo", "prevjud.js"), "utf8"));
    await tick(40);
    pedir("GET", "/previdenciario-api/api/v1/dossiePrevidenciario/1.0.0/obterDossie/abc");
    await tick(20);
    const vistos = [];
    const assinou = w.__cratosPrevjudEscuta.assinar((d) => vistos.push(d));
    checar(assinou === false && vistos.length === 0 && w.__cratosPrevjud.capturas.length === 0,
      "⛔ sem tarefa do CRATOS: a escuta desliga, apaga a memória e não guarda mais nada");
  }
  {
    /* recurso do Firefox existe mas a chamada falha: o teste da instalação desfaz tudo */
    const { w, injetados } = paginaFalsa({ exportQuebrado: true });
    const openOrig = w.XMLHttpRequest.prototype.open;
    w.eval(fs.readFileSync(path.join(SRC, "conteudo", "prevjud-cedo.js"), "utf8"));
    let ok = true;
    try { new w.XMLHttpRequest().open("GET", "/x"); } catch (e) { ok = false; }
    checar(ok && w.XMLHttpRequest.prototype.open === openOrig && !injetados.length && !w.__cratosPrevjudCedo && !w.__cratosPrevjudEscuta,
      "⛔ se a escuta falhar no teste da instalação, desfaz tudo (página intacta) e não deixa canal");
  }
  {
    /* sem o recurso do Firefox: reserva (grampo de página) SÓ com tarefa ativa */
    const a = paginaFalsa({ semFirefox: true, tarefa: false });
    a.w.eval(fs.readFileSync(path.join(SRC, "conteudo", "prevjud-cedo.js"), "utf8"));
    a.w.eval(fs.readFileSync(path.join(SRC, "conteudo", "prevjud.js"), "utf8"));
    await tick(40);
    const b = paginaFalsa({ semFirefox: true, tarefa: true });
    b.w.eval(fs.readFileSync(path.join(SRC, "conteudo", "prevjud-cedo.js"), "utf8"));
    b.w.eval(fs.readFileSync(path.join(SRC, "conteudo", "prevjud.js"), "utf8"));
    await tick(40);
    checar(a.injetados.length === 0 && b.injetados.length === 1 && /conteudo\/prevjud-api\.js$/.test(b.injetados[0]),
      "sem o recurso do Firefox: grampo de página (reserva) só quando há tarefa do CRATOS");
    const w2 = new JSDOM("<!doctype html><body></body>", { url: "https://previdenciario.pdpj.jus.br/x", runScripts: "outside-only" }).window;
    const ouv = [];
    w2.addEventListener("cratos:prevjud:api", (e) => ouv.push(JSON.parse(e.detail)));
    w2.fetch = async () => ({ status: 200, clone() { return { text: async () => "{}" }; } });
    w2.eval(fs.readFileSync(path.join(SRC, "conteudo", "prevjud-api.js"), "utf8"));
    await w2.fetch("previdenciario-api/api/v1/previdenciario/1.0.0/pesquisarPedidosDossie?page=0", { method: "POST", body: '{"tipo":"PREVIDENCIARIO"}' });
    await w2.fetch("/previdenciario-api/api/v1/dossieMedico/1.0.0/obterDossie/x");
    await tick(20);
    checar(ouv.length === 1, "grampo de reserva: reconhece endereço relativo e também deixa o Dossiê Médico de fora");
  }

  /* ── 3. caso feliz ─────────────────────────────────────────────────────── */
  {
    const t = montar();
    await ate(() => t.fechou, 10000);
    checar(t.d.getElementById("solicitacaoProcesso").value === F.PROC_FMT && t.procNoEnvio === F.PROC, "o nº do processo é digitado (com máscara) e vai no pedido");
    checar(t.solicitacoes === 2, "UM SOLICITAR por CPF (dois executados PF)");
    const est = t.mem["cratos:prevjud_estado"] || {};
    checar(est.pedidos && est.pedidos.length === 2 && est.pedidos.every((p) => p.protocolo === F.PROTO[p.cpf]), "um protocolo por CPF, guardado no estado");
    checar(!(t.abertos || []).includes(F.PROTO_VELHO) && (t.abertos || []).length === 2, "⛔ abre o dossiê CERTO (pelo protocolo) — não o pedido antigo do mesmo CPF");
    const ps = pdfs(t);
    const rot = (cpf) => ps.filter((m) => m.cpf === cpf).map((m) => m.rotulo).sort().join("|");
    checar(rot(F.CPF_A) === "PREVJUD Dados Cadastrais|PREVJUD Declaração de Benefícios|PREVJUD Extrato CNIS|PREVJUD Quadro Resumo" && rot(F.CPF_B) === rot(F.CPF_A),
      "juntados os PDFs OFICIAIS de cada CPF (os 4 que vieram)");
    checar(ps.every((m) => m.base64 === F.PDF_B64 && m.numProcesso === F.PROC_FMT && m.pasta === "CRATOS"), "PDF vai como veio (base64 da API), com processo e pasta");
    const c = txt(certidao(t));
    checar(/1\) FULANO FICTICIO DA SILVA - CPF 123\.456\.789-09\n {3}Protocolo: 1a2b3c4d-0000-4000-8000-00000000000a/.test(c), "certidão: pessoa, CPF e protocolo");
    checar(/- Extrato CNIS: obtido e anexado\./.test(c) && /- Declaração de Benefícios: obtido e anexado\./.test(c), "certidão: documentos obtidos");
    checar(/- Carta de Concessão: não houve resposta positiva \(o INSS informou: "Não existe carta de concessão para o CPF \[CPF\]"\)\./.test(c),
      "⛔ certidão: SEM RESPOSTA POSITIVA quando o PREVJUD diz que não há (404), com a mensagem — sem o CPF");
    checar(/- Histórico de Créditos: não houve resposta positiva \(o INSS informou: "Não há créditos para o período"\)\./.test(c),
      "certidão: negativa também pela mensagem do INSS dentro do dossiê (a página nem buscou o PDF)");
    checar(/Partes não consultadas, por não serem pessoa física com CPF[^\n]*EMPRESA FICTICIA LTDA/.test(c), "certidão: PJ registrada como não consultada");
    checar(!/MAE FICTICIA|NAO INFORMADA|NOME FICTICIO/.test(c), "⛔ LGPD: nada do JSON do dossiê (mãe, etnia…) vai para a certidão");
    checar(/solicitação foi feita pelo CRATOS, a pedido do\(a\) responsável/.test(c) && /PDFs emitidos pelo próprio PREVJUD\/INSS/.test(c), "certidão: rastro e origem dos PDFs");
    const pul = t.mem["cratos:orq_conv_feito"] || {};
    checar(pul.ok === true && pul.convenio === "PREVJUD" && !pul.arquivo, "pulso TERMINAL ao painel no fim");
    const reg = t.mem["cratos:prevjud_req:" + F.PROC] || [];
    checar(reg.length === 2 && reg.every((x) => x.encerrado), "registro: pedidos juntados ficam encerrados");
    checar(t.fechou === 1 && t.cortina[0] === "mostrar" && t.cortina[t.cortina.length - 1] === "esconder", "cortina durante o trabalho; aba fecha no sucesso");
  }

  /* ── 3b. 1.8.6: documentos que demoram e 503 do PREVJUD ──────────────── */
  {
    const t = montar({ estado: { docs: [{ nome: F.NOME_A, cpf: F.CPF_A }] }, lentos: { "extrato-cnis": 150 } });
    await ate(() => t.fechou, 10000);
    checar(pdfs(t).some((m) => m.rotulo === "PREVJUD Extrato CNIS") && pdfs(t).length === 4,
      "⛔ documento que DEMORA a chegar: o CRATOS espera todo pedido que começou terminar antes de fechar o Visualizar");
  }
  {
    const t = montar({ estado: { docs: [{ nome: F.NOME_A, cpf: F.CPF_A }] }, falha503: { "dados-cadastrais-cnis": 1, "extrato-cnis": 1 } });
    await ate(() => t.fechou, 15000);
    const c = txt(certidao(t));
    checar(pdfs(t).length === 4 && seguro(() => t.vezes[F.PROTO[F.CPF_A]] === 2) && /Extrato CNIS: obtido/.test(c) && /Dados Cadastrais: obtido/.test(c),
      "⛔ PREVJUD responde 503 a documentos: reabre o MESMO dossiê e junta o que veio na 2ª tentativa (sem duplicar PDF)");
    checar(/reabrindo o dossiê \(tentativa 2 de 3\)/.test(t.faixas.map((f) => f.t).join("\n")), "faixa avisa a reabertura");
  }
  {
    const t = montar({ estado: { docs: [{ nome: F.NOME_A, cpf: F.CPF_A }] }, falha503: { "extrato-cnis": 9 } });
    await ate(() => t.fechou, 15000);
    const c = txt(certidao(t));
    checar(seguro(() => t.vezes[F.PROTO[F.CPF_A]] === 3) && pdfs(t).length === 3 && /Extrato CNIS: o PREVJUD não disponibilizou/.test(c) && !/Extrato CNIS: não houve resposta positiva/.test(c),
      "⛔ 503 em todas as 3 tentativas: \"não disponibilizou\" (nunca negativa) e para de reabrir");
  }

  /* ── 3d. 1.9.0 (ao vivo, 26/10): o protocolo EM USO ainda com erro — o PREVJUD refaz em segundos ─ */
  {
    const t = montar({ erroNoAtivo: { [F.CPF_A]: 2 }, estado: { docs: [{ nome: F.NOME_A, cpf: F.CPF_A }] } });
    await ate(() => t.fechou || t.paradas.length, 15000);
    const c = txt(certidao(t));
    const y = "c" + F.PROTO[F.CPF_A].slice(1);
    checar(pdfs(t).length === 4 && !/ERROR_AO_RECEBER|não foi disponibilizado/.test(c) && c.indexOf("Protocolo: " + y) >= 0 && /Extrato CNIS: obtido/.test(c),
      "⛔ AO VIVO 26/10: protocolo em uso com \"ERROR_AO_RECEBER_PEDIDO_PDPJ\" NÃO é certificado na hora — espera o PREVJUD refazer e junta");
    checar(/o PREVJUD está refazendo o pedido — conferindo de novo em 5 segundos \(1 de 3\)/.test(t.faixas.map((f) => f.t).join("\n")),
      "espera curta (5 s) e confere de novo, avisando na faixa");
  }
  {
    const t = montar({ erroNoAtivo: { [F.CPF_A]: Infinity }, estado: { docs: [{ nome: F.NOME_A, cpf: F.CPF_A }] } });
    await ate(() => t.fechou || t.paradas.length, 20000);
    const c = txt(certidao(t));
    checar(/Situação: em processamento — o PREVJUD informou erro ao receber o pedido \("ERROR_AO_RECEBER_PEDIDO_PDPJ"\) e ainda não o havia refeito/.test(c) &&
      !/não foi disponibilizado/.test(c) && !pdfs(t).length,
      "⛔ PREVJUD não refez no prazo: certidão \"em processamento\" (nunca \"não foi disponibilizado\")");
    const reg = t.mem["cratos:prevjud_req:" + F.PROC] || [];
    checar(reg.length === 1 && !reg[0].encerrado && (t.mem["cratos:orq_conv_feito"] || {}).ok === true,
      "registro em aberto para o \"Coletar PREVJUD\"; painel segue");
  }

  /* ── 3c. 1.8.7: protocolo do SOLICITAR falha e o PREVJUD refaz com outro ─ */
  {
    const t = montar({ erroNoPedido: [F.CPF_A], estado: { docs: [{ nome: F.NOME_A, cpf: F.CPF_A }] } });
    await ate(() => t.fechou || t.paradas.length, 15000);
    const c = txt(certidao(t));
    const y = "b" + F.PROTO[F.CPF_A].slice(1);
    checar(pdfs(t).length === 4 && !/ERROR_AO_RECEBER/.test(c) && c.indexOf("Protocolo: " + y) >= 0 && /Extrato CNIS: obtido/.test(c),
      "⛔ protocolo do SOLICITAR com \"ERROR_AO_RECEBER_PEDIDO_PDPJ\" NÃO encerra: segue o protocolo em uso da lista, espera concluir e junta");
    const reg = t.mem["cratos:prevjud_req:" + F.PROC] || [];
    checar(reg.length === 1 && reg[0].protocolo === y && reg[0].encerrado === true && !!reg[0].juntadoEm,
      "registro: um item por pedido (protocolo trocado para o em uso), encerrado só depois de juntar");
  }
  {
    const t = montar({ estado: { docs: [{ nome: F.NOME_A, cpf: F.CPF_A }] }, recusa: true });
    await ate(() => t.paradas.length, 8000);
    checar(!certidao(t), "(sem certidão quando nada foi pedido)");
  }

  /* ── 4. preferências, indisponível, pendente ──────────────────────────── */
  {
    const t = montar({ semExtrato: true, docNovo: true, estado: { config: { documentos: { beneficios: true, carta: true, cadastrais: true, quadro: false, extrato: true, historico: true }, outros: true, pasta: "CRATOS" } } });
    await ate(() => t.fechou, 10000);
    const c = txt(certidao(t));
    checar(/- Quadro Resumo: não solicitado, por configuração do\(a\) usuário\(a\)\./.test(c) && !pdfs(t).some((m) => /Quadro/.test(m.rotulo)),
      "documento desligado: não é juntado e a certidão diz \"não solicitado, por configuração\"");
    checar(/- Extrato CNIS: o PREVJUD não disponibilizou este documento nesta consulta\./.test(c) && !/Extrato CNIS: não houve resposta positiva/.test(c),
      "⛔ documento que não chegou SEM explicação: \"não disponibilizou\" — nunca negativa");
    checar(pdfs(t).some((m) => m.rotulo === "PREVJUD Vinculos empregaticios"), "documento NOVO do PREVJUD entra pelo interruptor \"outros\"");
    checar(/confira a certidão/.test((t.faixas[t.faixas.length - 1] || {}).t), "faixa manda conferir quando há documento não disponibilizado");
  }
  {
    const t = montar({ historicoErroTecnico: true, estado: { docs: [{ nome: F.NOME_A, cpf: F.CPF_A }] } });
    await ate(() => t.fechou, 10000);
    const c = txt(certidao(t));
    checar(/- Histórico de Créditos: o PREVJUD não disponibilizou este documento nesta consulta\./.test(c),
      "⛔ mensagem de ERRO técnico no dossiê (HTTP 500) não vira negativa");
  }
  {
    const t = montar({ atrasos: { [F.CPF_B]: Infinity } });
    await ate(() => t.fechou, 20000);
    const c = txt(certidao(t));
    checar(/2\) BELTRANA EXEMPLO PEREIRA[\s\S]*Situação: em processamento no momento desta certidão/.test(c) && !pdfs(t).some((m) => m.cpf === F.CPF_B),
      "pedido que não ficou pronto: certidão \"em processamento\", sem PDF dele");
    const reg = t.mem["cratos:prevjud_req:" + F.PROC] || [];
    checar(reg.find((x) => x.cpf === F.CPF_B && !x.encerrado) && reg.find((x) => x.cpf === F.CPF_A && x.encerrado), "registro: o pendente fica EM ABERTO para a coleta");
    checar(/Coletar PREVJUD/.test((t.faixas[t.faixas.length - 1] || {}).t) && (t.mem["cratos:orq_conv_feito"] || {}).ok === true, "faixa aponta o \"Coletar PREVJUD\"; painel segue (pulso ok)");
  }

  /* retomada: a aba recarregou NO MEIO da solicitação */
  {
    const pedidos = [{ cpf: F.CPF_A, nome: F.NOME_A, protocolo: F.PROTO[F.CPF_A], status: "SOLICITADO_DATAPREV", solicitadoEm: "2026-10-21T16:00:00" }];
    const t = montar({ estado: { fase: "solicitando", pedidos, emVoo: F.CPF_B } });
    t.d.getElementById("pedidos").insertAdjacentHTML("afterbegin", F.linhaPedido(F.CPF_A, F.PROTO[F.CPF_A], "EM PROCESSAMENTO"));
    await ate(() => t.fechou, 10000);
    const c = txt(certidao(t));
    checar(t.solicitacoes === 0 && pdfs(t).filter((m) => m.cpf === F.CPF_A).length === 4,
      "⛔ retomada: NÃO repete o pedido de quem já tem protocolo, nem o do CPF que estava em voo; segue com o protocolo guardado");
    checar(/2\) BELTRANA EXEMPLO PEREIRA[^\n]*\n {3}Situação: não confirmada \(a página recarregou[\s\S]*Deve-se conferir na lista de pedidos do PREVJUD/.test(c),
      "retomada: o CPF em voo sai \"não confirmada — conferir\", nunca \"não foi possível registrar\"");
  }
  {
    const pedidos = [{ cpf: F.CPF_A, nome: F.NOME_A, protocolo: F.PROTO[F.CPF_A], status: "SOLICITADO_DATAPREV" }];
    const t = montar({ estado: { fase: "solicitando", pedidos } });
    t.d.getElementById("pedidos").insertAdjacentHTML("afterbegin", F.linhaPedido(F.CPF_A, F.PROTO[F.CPF_A], "EM PROCESSAMENTO"));
    await ate(() => t.fechou, 10000);
    const est = t.mem["cratos:prevjud_estado"] || {};
    checar(t.solicitacoes === 1 && est.pedidos.length === 2 && est.pedidos.every((p) => p.protocolo === F.PROTO[p.cpf]),
      "retomada: pede só o CPF que faltava (um SOLICITAR) e junta os dois");
  }
  {
    const t = montar({ semConfirmacao: true, estado: { docs: [{ nome: F.NOME_A, cpf: F.CPF_A }] } });
    await ate(() => t.fechou, 20000);
    const c = txt(certidao(t));
    checar(t.solicitacoes === 1 && /Situação: não confirmada \(o PREVJUD não devolveu o protocolo a tempo\)/.test(c) && !pdfs(t).length &&
      /sem protocolo confirmado[\s\S]*Coletar PREVJUD/.test((t.faixas[t.faixas.length - 1] || {}).t),
      "clique sem resposta e sem pedido na lista: não repete; certidão \"não confirmada\"; faixa aponta o Coletar");
  }
  /* 21/10, ao vivo: o PREVJUD demora mais que a espera para devolver o protocolo */
  {
    const t = montar({ semResposta: [F.CPF_A, F.CPF_B] });
    await ate(() => t.fechou, 20000);
    const est = t.mem["cratos:prevjud_estado"] || {};
    checar(t.solicitacoes === 2 && est.pedidos.every((p) => p.protocolo === F.PROTO[p.cpf] && !p.incerto) && pdfs(t).length === 8,
      "PREVJUD sem resposta ao SOLICITAR: acha o protocolo de cada CPF pela LISTA de pedidos e junta tudo");
    const reg = t.mem["cratos:prevjud_req:" + F.PROC] || [];
    checar(reg.length === 2 && !/não confirmada/.test(txt(certidao(t))), "…e anota os protocolos achados (certidão sem \"não confirmada\")");
  }
  {
    const t = montar({ respostaAtrasadaA: true });
    await ate(() => t.fechou || t.paradas.length, 20000);
    const est = t.mem["cratos:prevjud_estado"] || {};
    checar(!t.paradas.length && est.pedidos.length === 2 && est.pedidos.every((p) => p.protocolo === F.PROTO[p.cpf]),
      "⛔ resposta ATRASADA do 1º CPF chegando durante o 2º: vai para o CPF certo (pelo pedido, não pela ordem) e não trava");
  }
  {
    /* pedido antigo do mesmo CPF e processo na lista não é adotado como o de hoje */
    const t = montar({ semResposta: [F.CPF_A], estado: { docs: [{ nome: F.NOME_A, cpf: F.CPF_A }] },
      lista: [{ cpf: F.CPF_A, protocolo: "77777777-0000-4000-8000-000000000077", data: "2026-10-20T10:00:00-03:00", atraso: 0 }] });
    await ate(() => t.fechou, 20000);
    const est = t.mem["cratos:prevjud_estado"] || {};
    checar(seguro(() => est.pedidos[0].protocolo === F.PROTO[F.CPF_A]) && !(t.abertos || []).includes("77777777-0000-4000-8000-000000000077"),
      "⛔ na solicitação, só adota da lista pedido feito A PARTIR do clique — não o de ontem (já pronto)");
  }

  /* ── 5. coleta ─────────────────────────────────────────────────────────── */
  {
    const pedidos = [{ cpf: F.CPF_B, nome: F.NOME_B, protocolo: F.PROTO[F.CPF_B], solicitadoEm: "2026-10-21T15:00:00" }];
    const t = montar({ semPedidoVelho: true, estado: { modo: "coleta", docs: [{ nome: F.NOME_B, cpf: F.CPF_B }], semCpf: [], pedidos }, registro: [Object.assign({ encerrado: false }, pedidos[0])] });
    t.d.getElementById("pedidos").insertAdjacentHTML("afterbegin", F.linhaPedido(F.CPF_B, F.PROTO[F.CPF_B], "EM PROCESSAMENTO"));
    await ate(() => t.fechou, 10000);
    const cert = certidao(t);
    checar(t.solicitacoes === 0 && pdfs(t).length === 4 && cert && /coleta certidao\.pdf$/.test(cert.filename), "coleta: NÃO solicita de novo; junta os PDFs e a certidão de coleta");
    const res = t.mem["cratos:prevjud_coleta_resultado"] || {};
    checar(res.resultados && res.resultados[0].tipo === "pdf" && !(t.mem["cratos:orq_conv_feito"]), "coleta: resultado para o painel (sem pulso da fila)");
  }
  {
    const pedidos = [{ cpf: F.CPF_B, nome: F.NOME_B, protocolo: F.PROTO[F.CPF_B] }];
    const t = montar({ semPedidoVelho: true, atrasos: { [F.CPF_B]: Infinity }, estado: { modo: "coleta", docs: [{ nome: F.NOME_B, cpf: F.CPF_B }], semCpf: [], pedidos } });
    t.d.getElementById("pedidos").insertAdjacentHTML("afterbegin", F.linhaPedido(F.CPF_B, F.PROTO[F.CPF_B], "EM PROCESSAMENTO"));
    await ate(() => (t.mem["cratos:prevjud_coleta_resultado"] || {}).resultados, 10000);
    checar(!certidao(t) && t.mem["cratos:prevjud_coleta_resultado"].resultados[0].tipo === "pendente", "coleta ainda em processamento: sem certidão; avisa");
  }

  /* ── 5b. coleta procurando pelo processo (sem pedido anotado) ─────────── */
  {
    const P = { a1: "a1000000-0000-4000-8000-0000000000a1", a2: "a2000000-0000-4000-8000-0000000000a2", a3: "a3000000-0000-4000-8000-0000000000a3",
      b1: "b1000000-0000-4000-8000-0000000000b1", b2: "b2000000-0000-4000-8000-0000000000b2" };
    const lista = [
      { cpf: F.CPF_A, protocolo: P.a1, data: "2026-10-18T10:00:00-03:00", atraso: 0 },              // pronto, mais antigo
      { cpf: F.CPF_A, protocolo: P.a2, data: "2026-10-21T09:00:00-03:00", atraso: 0 },              // pronto, MAIS RECENTE pronto
      { cpf: F.CPF_A, protocolo: P.a3, data: "2026-10-21T15:30:00-03:00", atraso: Infinity },       // mais recente, NÃO pronto
      { cpf: F.CPF_B, protocolo: P.b1, data: "2026-10-01T10:00:00-03:00", atraso: 0 },              // fora dos 7 dias
      { cpf: "11144477735", protocolo: P.b2, data: "2026-10-21T10:00:00-03:00", atraso: 0 },       // outro CPF, mesmo processo
    ];
    const t = montar({ semPedidoVelho: true, listaNaCarga: true, lista,
      estado: { modo: "coleta", descobrir: true, docs: [], semCpf: [], pedidos: [], nomes: { [F.CPF_A]: F.NOME_A, [F.CPF_B]: F.NOME_B } } });
    for (const x of lista) t.d.getElementById("pedidos").insertAdjacentHTML("beforeend", F.linhaPedido(x.cpf, x.protocolo, "X"));
    await ate(() => t.fechou, 20000);
    const est = t.mem["cratos:prevjud_estado"] || {};
    const pa = (est.pedidos || []).find((p) => p.cpf === F.CPF_A) || {};
    const abA = (t.abertos || []).filter((x) => /^a/.test(x));
    checar(t.solicitacoes === 0 && pa.protocolo === P.a2 && pa.lido && abA[abA.length - 1] === P.a2 && !abA.includes(P.a3) && pdfs(t).filter((m) => m.cpf === F.CPF_A).length === 4,
      "coleta pelo processo: por CPF, o pedido MAIS RECENTE JÁ PRONTO dos últimos 7 dias (não o mais novo em processamento, nem um mais velho)");
    checar(!(est.pedidos || []).some((p) => p.cpf === F.CPF_B) && !pdfs(t).some((m) => m.cpf === F.CPF_B),
      "⛔ coleta pelo processo: pedido com mais de 7 dias NÃO é juntado");
    checar((est.pedidos || []).some((p) => p.cpf === "11144477735" && p.protocolo === P.b2), "coleta pelo processo: todo CPF com pedido deste processo entra");
    const c = txt(certidao(t));
    checar(/coleta certidao\.pdf$/.test((certidao(t) || {}).filename) && /o pedido mais recente dos últimos 7 dias/.test(c) &&
      /Protocolo: a2000000[^\n]*solicitado em 21\/10\/2026/.test(c) && /CPF 987\.654\.321-00 \(BELTRANA EXEMPLO PEREIRA\): o pedido mais recente[^\n]*anterior aos últimos 7 dias; não foi juntado/.test(c),
      "certidão da coleta: regra dos 7 dias, data de cada pedido e o CPF fora do prazo");
    const res = t.mem["cratos:prevjud_coleta_resultado"] || {};
    checar((res.resultados || []).some((x) => x.cpf === F.CPF_B && x.tipo === "antigo"), "painel: avisa o CPF com pedido fora do prazo");
  }
  {
    const P = "c1000000-0000-4000-8000-0000000000c1";
    const t = montar({ semPedidoVelho: true, listaNaCarga: true, atrasos: { [F.CPF_A]: Infinity },
      lista: [{ cpf: F.CPF_A, protocolo: P, data: "2026-10-21T15:00:00-03:00" }],
      estado: { modo: "coleta", descobrir: true, docs: [], semCpf: [], pedidos: [] } });
    t.d.getElementById("pedidos").insertAdjacentHTML("beforeend", F.linhaPedido(F.CPF_A, P, "X"));
    await ate(() => (t.mem["cratos:prevjud_coleta_resultado"] || {}).resultados, 10000);
    checar(!certidao(t) && seguro(() => t.mem["cratos:prevjud_coleta_resultado"].resultados[0].tipo === "pendente" &&
      t.mem["cratos:prevjud_estado"].pedidos[0].protocolo === P), "coleta pelo processo, nada pronto: fica com o mais recente, espera, e avisa sem certidão");
  }
  {
    const t = montar({ semPedidoVelho: true, listaNaCarga: true,
      lista: [{ cpf: F.CPF_A, protocolo: F.PROTO[F.CPF_A], data: "2026-10-21T15:00:00-03:00", atraso: 0 }],
      registro: [{ cpf: F.CPF_A, protocolo: F.PROTO[F.CPF_A], encerrado: true }],
      estado: { modo: "coleta", descobrir: true, docs: [], semCpf: [], pedidos: [] } });
    t.d.getElementById("pedidos").insertAdjacentHTML("beforeend", F.linhaPedido(F.CPF_A, F.PROTO[F.CPF_A], "CONCLUÍDO"));
    await ate(() => t.fechou || (t.mem["cratos:prevjud_coleta_resultado"] || {}).aviso, 10000);
    const res = t.mem["cratos:prevjud_coleta_resultado"] || {};
    void res;
    checar(pdfs(t).length === 4 && /Nova juntada: este dossiê já havia sido obtido pelo CRATOS anteriormente\./.test(txt(certidao(t))),
      "coleta pelo processo: pedido JÁ juntado é juntado de novo (sem freio — Rodrigo, 22/10), e a certidão diz que é nova juntada");
  }
  {
    const t = montar({ semPedidoVelho: true, listaNaCarga: true, lista: [],
      estado: { modo: "coleta", descobrir: true, docs: [], semCpf: [], pedidos: [] } });
    await ate(() => (t.mem["cratos:prevjud_coleta_resultado"] || {}).aviso, 10000);
    checar(/não há pedidos/.test((t.mem["cratos:prevjud_coleta_resultado"] || {}).aviso) && !certidao(t), "coleta pelo processo sem nenhum pedido: avisa, sem certidão");
  }
  /* ── 5c. 1.8.2: lista perdida na abertura / APLICAR ─────────────────── */
  {
    /* a lista que a tela buscou ao abrir chega pela memória do grampo (antes do content script) */
    const P = "d1000000-0000-4000-8000-0000000000d1";
    const t = montar({ semPedidoVelho: true, lista: [{ cpf: F.CPF_A, protocolo: P, data: "2026-10-21T18:41:42.185Z", atraso: 0 }],
      estado: { modo: "coleta", descobrir: true, docs: [], semCpf: [], pedidos: [] } }, async (w, r) => {
      w.fetch = async () => ({ status: 200, clone() { return { text: async () => JSON.stringify({ content: r.listaContent() }) }; } });
      w.eval(fs.readFileSync(path.join(SRC, "conteudo", "prevjud-api.js"), "utf8"));
      await w.fetch("/previdenciario-api/api/v1/previdenciario/1.0.0/pesquisarPedidosDossie?page=0&size=100", { method: "POST" });
      await tick(20);
    });
    t.d.getElementById("pedidos").insertAdjacentHTML("beforeend", F.linhaPedido(F.CPF_A, P, "CONCLUÍDO"));
    await ate(() => t.fechou || (t.mem["cratos:prevjud_coleta_resultado"] || {}).aviso, 10000);
    checar(pdfs(t).length === 4 && !t.cliques.includes("APLICAR") && /solicitado em 21\/10\/2026/.test(txt(certidao(t))) &&
      seguro(() => t.mem["cratos:prevjud_estado"].pedidos[0].protocolo === P) && !/informou "FALHA/.test(txt(certidao(t))),
      "⛔ coleta: lê a lista que a tela buscou AO ABRIR (memória do grampo), sem clicar; usa o protocolo ATIVO; pronto = resposta entregue; situação dos outros protocolos não decide");
  }
  {
    /* sem a lista da abertura: o CRATOS refaz a busca pelo APLICAR do filtro */
    const P = "d2000000-0000-4000-8000-0000000000d2";
    const t = montar({ semPedidoVelho: true, lista: [{ cpf: F.CPF_A, protocolo: P, data: "2026-10-21T18:41:42.185Z", atraso: 0 }],
      estado: { modo: "coleta", descobrir: true, docs: [], semCpf: [], pedidos: [] } });
    t.d.getElementById("pedidos").insertAdjacentHTML("beforeend", F.linhaPedido(F.CPF_A, P, "CONCLUÍDO"));
    await ate(() => t.fechou || (t.mem["cratos:prevjud_coleta_resultado"] || {}).aviso, 10000);
    checar(t.cliques.includes("APLICAR") && pdfs(t).length === 4, "coleta sem a lista da abertura: clica em APLICAR e acha o pedido");
  }
  {
    const t = montar();
    await ate(() => t.fechou, 10000);
    checar(t.cliques.filter((c) => c === "APLICAR").length >= 1 && !t.downloads, "⛔ na espera, atualiza pelo APLICAR — nunca clica no download da linha");
  }
  {
    /* dois pedidos do mesmo CPF no MESMO instante: vale o primeiro da lista (a tela ordena por data decrescente) */
    const P1 = "e1000000-0000-4000-8000-0000000000e1", P2 = "e2000000-0000-4000-8000-0000000000e2";
    const t = montar({ semPedidoVelho: true, listaNaCarga: true,
      lista: [{ cpf: F.CPF_A, protocolo: P1, data: "2026-10-21T18:41:42.185Z", atraso: 0 }, { cpf: F.CPF_A, protocolo: P2, data: "2026-10-21T18:41:42.185Z", atraso: 0 }],
      estado: { modo: "coleta", descobrir: true, docs: [], semCpf: [], pedidos: [] } });
    for (const x of [P1, P2]) t.d.getElementById("pedidos").insertAdjacentHTML("beforeend", F.linhaPedido(F.CPF_A, x, "CONCLUÍDO"));
    await ate(() => t.fechou, 10000);
    checar(seguro(() => t.mem["cratos:prevjud_estado"].pedidos[0].protocolo === P1), "empate de data: fica o primeiro da lista do PREVJUD");
  }

  /* ── 6. travas ─────────────────────────────────────────────────────────── */
  {
    const t = montar();
    await ate(() => t.fechou, 10000);
    let l = 0;
    for (const id of ["lk-medico", "lk-penhora"]) { try { t.api.clicarSeguro(t.d.getElementById(id)); } catch (e) { if (/TRAVA/.test(e.message)) l++; } }
    checar(l === 2 && !t.cliques.some((c) => /Médico|Penhora/i.test(c)), "⛔ clicarSeguro RECUSA Dossiê Médico e Penhora Judicial");
  }
  {
    const t = montar({ url: "https://previdenciario.pdpj.jus.br/penhora-judicial" });
    await ate(() => t.nav.length, 3000);
    checar(t.nav[0] === "https://previdenciario.pdpj.jus.br/dossie-previdenciario" && !t.cliques.length, "⛔ em tela fora do escopo (penhora): não age e volta ao Dossiê Previdenciário");
  }
  {
    const t = montar({ url: "https://previdenciario.pdpj.jus.br/dashboard" });
    await ate(() => t.nav.length, 3000);
    checar(/\/dossie-previdenciario$/.test(t.nav[0] || ""), "depois do login (dashboard): vai ao Dossiê Previdenciário");
  }
  {
    const t = montar({ cpfTrocado: true });
    await ate(() => t.paradas.length, 6000);
    checar(t.paradas.length && /CPF ou processo diferente/.test(t.paradas[0].t) && !certidao(t) && !pdfs(t).length, "⛔ CPF diferente no pedido registrado: para, sem certidão");
  }
  {
    const t = montar({ recusa: true });
    await ate(() => t.paradas.length, 8000);
    const p = t.mem["cratos:orq_conv_feito"] || {};
    checar(t.paradas.length && /nenhum pedido de dossiê foi registrado/.test(t.paradas[0].t) && /HTTP 500/.test(t.paradas[0].t) && !certidao(t) && p.ok === false && !t.fechou,
      "PREVJUD recusa todos os pedidos: faixa, pulso de falha, sem certidão, aba aberta");
  }

  console.log(`\n=== ${NOME} ===`);
  oks.forEach((d) => console.log("  ok   " + d));
  falhas.forEach((d) => console.log("  FALHA " + d));
  console.log(`\n${oks.length} passaram, ${falhas.length} falharam (${oks.length + falhas.length} asserções)\n`);
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.log("FALHA geral: " + e.stack); process.exit(1); });
