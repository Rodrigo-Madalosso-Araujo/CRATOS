/*
 * teste-ccs-entrada.js — CCS 1.6.5: ENTRAR PELA PORTA DA FRENTE e não travar em página
 * em branco. Dados 100% FICTÍCIOS (fixture-ccs.js).
 *
 * Campo, 19/10: depois do login, a página do CCS ficou EM BRANCO (só a faixa do CRATOS
 * por cima). O CRATOS abria uma página INTERNA (requisitarConsultaCpfCnpj.do); sem
 * sessão, o BCB mandava ao ADFS e, na volta, a página interna vinha vazia. Limpar o
 * cache resolvia num computador; no Chrome, entrando pela tela inicial, funcionava.
 *
 * O que se trava aqui:
 *  1. Fundo: consulta E coleta abrem a ENTRADA (iniciar.do?method=iniciar).
 *  2. Da tela inicial (1201): consulta → formulário; coleta → requisição guardada;
 *     coleta sem nº → consulta de requisições (plano B).
 *  3. ⛔ Página em branco: volta UMA vez para a entrada; na segunda, PARA com a
 *     instrução de limpar os cookies do BCB — sem loop, sem certidão.
 *  4. Tela reconhecida zera a contagem; login e tela com conteúdo NÃO contam como branco.
 *  5. Coleta: teto de idas também quando o CCS devolve sempre a inicial.
 *
 * Reprova a 1.6.4 (abria a página interna; página em branco só dava "não reconheci").
 * Rodar: node teste-ccs-entrada.js   ·   versão antiga: CRATOS_SRC=<pasta> node …
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const H = require("./harness-ccs.js");
const { F, montar, estadoBase, ate, tick } = H;

const falhas = [];
const oks = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }
const NOME = "teste-ccs-entrada.js";
const ENTRADA = /\/ccs\/iniciar\.do\?method=iniciar$/;
const EM_BRANCO = "<!doctype html><html><head><title></title></head><body>\n  \n</body></html>";

function moduloDeFundo(mem, abas) {
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    browser: {
      storage: { local: {
        get: async (k) => ({ [k]: mem[k] }),
        set: async (o) => Object.assign(mem, JSON.parse(JSON.stringify(o))),
        remove: async () => {},
      }, onChanged: { addListener() {} } },
      tabs: {
        query: async () => [],
        create: async (o) => { abas.push(o.url); return { id: 1 }; },
        update: async (id, o) => { abas.push(o.url); return { id }; },
      },
    },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of [["comum", "storage.js"], ["modulos", "registro.js"], ["modulos", "ccs.js"]]) {
    vm.runInContext(fs.readFileSync(path.join(H.SRC, ...f), "utf8"), ctx);
  }
  vm.runInContext("globalThis.__M = ModuloCCS;", ctx);
  return ctx.__M;
}

const estado = (t) => t.mem["cratos:ccs_estado"] || {};

(async () => {
  if (!H.existeCcs()) H.reprovaSemModulo(NOME);

  /* ── 1. fundo: consulta e coleta entram pela tela inicial ───────────────── */
  try {
    const mem = {}, abas = [];
    const M = moduloDeFundo(mem, abas);
    const partes = [{ nome: "FULANO FICTICIO DA SILVA", cpfcnpj: "123.456.789-09", polo: "passivo" }];
    await M.executar({ numeroProcesso: F.PROC_FMT, partes }, "consulta");
    checar(ENTRADA.test(abas[0] || ""), "⛔ consulta: abre o CCS pela ENTRADA (iniciar.do), não pela página interna");
    mem["cratos:ccs_req:" + F.PROC] = [{ numeroRequisicao: F.REQ, encerrada: false }];
    abas.length = 0;
    await M.coletar({ numeroProcesso: F.PROC_FMT, partes });
    checar(ENTRADA.test(abas[0] || "") && !/numeroRequisicao/.test(abas[0] || ""),
      "⛔ coleta com nº guardado: também entra pela tela inicial (o content script segue até a requisição)");
    mem["cratos:ccs_req:" + F.PROC] = [];
    abas.length = 0;
    await M.coletar({ numeroProcesso: F.PROC_FMT, partes });
    checar(ENTRADA.test(abas[0] || ""), "coleta sem nº guardado: entra pela tela inicial");
  } catch (e) { checar(false, "fundo: não rodou (" + e.message + ")"); }

  /* ── 2. da tela inicial (1201) cada modo segue sozinho ─────────────────── */
  {
    const t = montar({ tela: F.TELA_1201, estado: estadoBase() });
    await ate(() => t.nav.length);
    checar(/requisitarConsultaCpfCnpj\.do\?method=iniciar/.test(t.nav[0] || ""),
      "1201 na consulta: vai ao formulário de requisição");
  }
  {
    const t = montar({ tela: F.TELA_1201,
      estado: estadoBase({ modo: "coleta", fase: "coleta_ir", fila: [F.REQ], resultados: [] }) });
    await ate(() => t.nav.length);
    checar((t.nav[0] || "").indexOf("numeroRequisicao=" + F.REQ) > 0,
      "1201 na coleta: vai DIRETO à requisição guardada");
  }
  {
    const t = montar({ tela: F.TELA_1201,
      estado: estadoBase({ modo: "coleta", fase: "coleta_buscar", fila: [], janela: 0, resultados: [] }) });
    await ate(() => t.nav.length);
    checar(/iniciarConsultaRequisicoesRealizadas/.test(t.nav[0] || ""),
      "1201 na coleta sem nº: vai à consulta de requisições (plano B)");
  }

  /* ── 3. página em branco: uma volta, depois para ───────────────────────── */
  {
    const t = montar({ tela: EM_BRANCO, url: "https://www3.bcb.gov.br/ccs/requisitarConsultaCpfCnpj.do?method=iniciar",
      estado: estadoBase() });
    await ate(() => t.nav.length);
    checar(ENTRADA.test(t.nav[0] || ""), "⛔ página EM BRANCO: volta pela tela inicial do CCS");
    checar(estado(t).emBranco === 1 && estado(t).ativo === true,
      "a volta é contada (emBranco = 1) e o fluxo segue ativo");
    checar(t.faixas.some((f) => /em branco/i.test(f.t)) && !t.paradas.length,
      "faixa avisa que o CCS abriu em branco (sem parar)");
  }
  {
    const t = montar({ tela: EM_BRANCO, url: "https://www3.bcb.gov.br/ccs/iniciar.do?method=iniciar",
      estado: estadoBase({ emBranco: 1 }) });
    await ate(() => t.paradas.length);
    await tick();
    const p = (t.paradas[0] || {}).t || "";
    checar(!t.nav.length, "⛔ em branco DE NOVO: não navega mais (sem loop)");
    checar(/em branco/i.test(p) && /cookies/i.test(p) && /www3\.bcb\.gov\.br/.test(p),
      "⛔ para com a instrução de limpar os cookies do site do BCB");
    checar(!t.msgs.some((m) => /certid|pulso|orq_conv/i.test(JSON.stringify(m))),
      "falha técnica: nenhuma certidão e nenhum pulso ao painel (regra de ferro)");
  }

  /* ── 4. o que NÃO é página em branco ────────────────────────────────────── */
  {
    const t = montar({ tela: "<html><body><form><input type=password name=senha></form></body></html>",
      url: "https://www3.bcb.gov.br/ccs/indexEstatico.jsp", estado: estadoBase() });
    await tick();
    checar(!t.nav.length && t.faixas.some((f) => /login/i.test(f.t)) && !estado(t).emBranco,
      "tela de login: espera o login (não conta como página em branco)");
  }
  {
    const t = montar({ tela: "<html><body><h2>Sistema temporariamente indisponível</h2>" +
      "<p>Tente novamente mais tarde. Em caso de dúvida, procure o suporte.</p></body></html>", estado: estadoBase() });
    await tick();
    checar(!t.nav.length && !estado(t).emBranco && t.faixas.some((f) => /não reconheci/i.test(f.t)),
      "página com conteúdo e sem código [CCSFW…]: avisa “não reconheci”, não conta como branco");
  }
  {
    const t = montar({ tela: F.TELA_1201, estado: estadoBase({ emBranco: 1 }) });
    await ate(() => t.nav.length);
    checar(estado(t).emBranco === 0, "tela reconhecida depois de uma página em branco: a contagem zera");
  }
  {
    let api = null;
    try { api = montar({ tela: F.TELA_1201, estado: null }).api; } catch (e) {}
    const pb = api && api.paginaEmBranco;
    const { JSDOM } = require("jsdom");
    const doc = (h) => new JSDOM(h).window.document;
    checar(!!pb && pb(doc(EM_BRANCO)) === true, "paginaEmBranco: corpo vazio é branco");
    checar(!!pb && pb(doc('<body><div id="cratos-ccs-aviso">CRATOS — aguardando seu login no CCS, um texto longo</div></body>')) === true,
      "paginaEmBranco: a própria faixa do CRATOS não conta como conteúdo");
    checar(!!pb && pb(doc("<frameset><frame src='a.jsp'></frameset>")) === false,
      "paginaEmBranco: página de frames não é branca");
  }

  /* ── 5. coleta: teto quando o CCS devolve sempre a inicial ─────────────── */
  {
    const t = montar({ tela: F.TELA_1201,
      estado: estadoBase({ modo: "coleta", fase: "coleta_ir", fila: [F.REQ], resultados: [], idas: 3 }) });
    await ate(() => t.paradas.length);
    checar(!t.nav.length && t.paradas.some((p) => /3 tentativas/.test(p.t)),
      "coleta: depois de 3 voltas à inicial, para (não gira)");
  }

  H.relatorio(NOME, oks, falhas);
})().catch((e) => { console.log("FALHA geral: " + e.stack); process.exit(1); });
