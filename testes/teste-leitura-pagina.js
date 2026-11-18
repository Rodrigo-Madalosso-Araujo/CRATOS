/*
 * teste-leitura-pagina.js — toda conversa com o PJe sai DA PÁGINA (1.9.7). Dados FICTÍCIOS.
 *
 * Achado ao vivo no TRT19 (18/11/2026): a chamada feita pelo fundo da extensão sai SEM o
 * cookie de sessão (a aba Rede mostrou X-XSRF-TOKEN presente e Cookie ausente) e o PJe
 * responde 400 "SJT-004 — Token de autenticação não informado". No TRT18 o fundo passa.
 * A correção, validada ao vivo pelo Rodrigo no TRT19 e no TRT18: o painel lê o processo e as
 * partes na página, e as leituras que o fundo faz no meio dos convênios (cálculo, SAB) são
 * pedidas à aba do PJe.
 *
 * O PJe simulado aqui só responde 200 à chamada feita PELA PÁGINA (window.wrappedJSObject.fetch)
 * e com o X-XSRF-TOKEN; o fetch da extensão recebe o 400 SJT-004, como no TRT19.
 *
 * O que se trava aqui:
 *  1. CratosPje.fetchPagina: na página https usa o fetch da página (com cloneInto) e avisa no
 *     console o caminho, uma vez; sem ele, content.fetch; fora de página, o fetch de sempre.
 *  2. Captura: o painel lê processo e partes na página e manda o JSON bruto ao fundo; erro
 *     de leitura aparece como "Falha na captura" com o status (nunca "sem partes").
 *  3. "pje_ler": a aba lê pela página e devolve pelo storage; caminho absoluto ou fora do
 *     PJe é recusado; erro volta com o status.
 *  4. Fundo: lerNaAbaPje recolhe e apaga a resposta; aba que não responde → erro claro;
 *     ApiPje com leitor lê pela aba (cálculo); montarProcesso normaliza o bruto (TERCEIROS).
 *  5. Ligações: orquestraExecutar liga o leitor da aba; o SAB do fundo lê pela aba.
 *
 * Reprova a 1.9.6. Rodar: node teste-leitura-pagina.js
 * Versão antiga: CRATOS_SRC=<pasta do src> node teste-leitura-pagina.js
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const NOME = "teste-leitura-pagina";
const oks = [], falhas = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 20));
async function ate(cond, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 3000)) { try { if (cond()) return true; } catch (e) { /* nada */ } await tick(20); }
  return false;
}
const ler = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");

/* respostas do PJe simulado */
const PARTES = {
  ATIVO: [{ nome: "AUTOR FICTICIO", polo: "ativo", documento: "12312312387", tipoPessoa: "F" }],
  PASSIVO: [{ nome: "EMPRESA FICTICIA LTDA", polo: "passivo", documento: "11222333000181", tipoPessoa: "J" }],
  TERCEIROS: [{ nome: "TERCEIRO FICTICIO", polo: "outros", documento: "45645645609", tipoPessoa: "F" }],
};
const SJT004 = '{"codigoErro":"SJT-004","mensagem":"Autenticação: Token de autenticação não informado."}';
const resposta = (status, corpo) => ({
  ok: status >= 200 && status < 300, status, statusText: "",
  text: async () => (typeof corpo === "string" ? corpo : JSON.stringify(corpo)),
  json: async () => (typeof corpo === "string" ? JSON.parse(corpo) : corpo),
  arrayBuffer: async () => new ArrayBuffer(0),
});
function pjeDaPagina(log) {
  return async (url, o) => {
    const h = (o && o.headers) || {};
    log.push({ url: String(url), xsrf: h["X-XSRF-TOKEN"] || null, via: "pagina" });
    if (!h["X-XSRF-TOKEN"]) return resposta(400, SJT004);
    if (/\/semacesso\//.test(url)) return resposta(403, '{"mensagem":"sem acesso"}');
    if (/\/partes$/.test(url)) return resposta(200, PARTES);
    if (/\/processos\/id\/\d+$/.test(url)) return resposta(200, { id: 240469, numero: "0000001-23.2026.5.19.0001" });
    if (/calculos/.test(url)) return resposta(200, { resultado: [{ total: 1234.5, dataHoraImportacao: "2026-11-01T10:00:00" }] });
    return resposta(200, { resultado: [] });
  };
}
const fetchDaExtensao = (log) => async (url) => { log.push({ url: String(url), via: "extensao" }); return resposta(400, SJT004); };

(async () => {
  /* ── 1. CratosPje.fetchPagina ────────────────────────────────────────────── */
  {
    const temFP = /fetchPagina/.test(ler("comum/storage.js"));
    const montar = (o) => {
      const logs = { pagina: [], ext: [], content: [], info: [], clonou: 0 };
      const ctx = {
        URL, JSON, Uint8Array, Promise,
        console: { log() {}, warn() {}, error() {}, info: (...m) => logs.info.push(m.join(" ")) },
        location: { protocol: o.protocolo || "https:", origin: "https://pje.trt19.jus.br" },
        document: { cookie: "Xsrf-Token=abc%3D" },
        fetch: fetchDaExtensao(logs.ext),
        browser: { storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {} } } },
      };
      if (o.pagina) ctx.window = { wrappedJSObject: { fetch: pjeDaPagina(logs.pagina) } };
      else ctx.window = {};
      if (o.content) ctx.content = { fetch: pjeDaPagina(logs.content) };
      ctx.cloneInto = (x) => { logs.clonou++; return JSON.parse(JSON.stringify(x)); };
      vm.createContext(ctx);
      vm.runInContext(ler("comum/storage.js"), ctx);
      return { ctx, logs, P: ctx.CratosPje };
    };
    const a = montar({ pagina: true, content: true });
    let r = null;
    if (temFP && a.P && a.P.fetchPagina) {
      r = await a.P.fetchPagina("https://pje.trt19.jus.br/pje-comum-api/api/processos/id/1/partes",
        { headers: a.P.cabecalhosLeitura(a.P.xsrfDaPagina()) });
      await a.P.fetchPagina("https://pje.trt19.jus.br/pje-comum-api/api/processos/id/1", { headers: a.P.cabecalhosLeitura("x") });
    }
    const corpo = r ? await r.json() : null;
    checar(r && r.ok && r.status === 200 && corpo && corpo.TERCEIROS && a.logs.pagina.length === 2 && !a.logs.ext.length && !a.logs.content.length,
      "⛔ fetchPagina: na página https, usa o fetch DA PÁGINA (o do console) — a extensão não faz a chamada");
    checar(a.logs.clonou >= 1 && a.logs.pagina[0].xsrf === "abc=", "fetchPagina: opções clonadas para a página (cloneInto), com o X-XSRF-TOKEN");
    checar(a.logs.info.length === 1 && /leituras do PJe por fetch da página/.test(a.logs.info[0]),
      "fetchPagina: diz no console, uma vez, por onde leu (diagnóstico ao vivo)");
    const b = montar({ pagina: false, content: true });
    if (temFP && b.P && b.P.fetchPagina) await b.P.fetchPagina("https://pje.trt19.jus.br/x", { headers: { "X-XSRF-TOKEN": "t" } });
    checar(b.logs.content.length === 1 && !b.logs.ext.length, "fetchPagina: sem o fetch da página, usa o content.fetch");
    const c = montar({ pagina: true, content: true, protocolo: "moz-extension:" });
    let rc = null;
    if (temFP && c.P && c.P.fetchPagina) rc = await c.P.fetchPagina("https://pje.trt19.jus.br/x", {});
    checar(rc && rc.status === 400 && c.logs.ext.length === 1 && !c.logs.pagina.length && !c.logs.info.length,
      "fetchPagina fora de página (fundo, moz-extension:): o fetch de sempre, sem aviso");
  }

  /* ── 2. captura pelo painel ──────────────────────────────────────────────── */
  {
    const { montarPainel } = require("./harness-painel.js");
    const logP = [], logE = [];
    const a = montarPainel(SRC, {
      url: "https://pje.trt19.jus.br/pjekz/processo/240469/detalhe",
      fetchPagina: pjeDaPagina(logP), fetch: fetchDaExtensao(logE), cookie: "Xsrf-Token=tok%2B1",
      responder: async (m) => (m.tipo === "capturar" ? { ok: false, erro: "fim do teste" } : undefined),
    });
    a.d.querySelector("cratos-botao").dispatchEvent(new a.w.Event("pointerdown", { bubbles: true }));
    a.d.querySelector("cratos-botao").dispatchEvent(new a.w.Event("pointerup", { bubbles: true }));
    await ate(() => a.msgs.some((m) => m.tipo === "capturar"), 3000);
    const cap = a.msgs.find((m) => m.tipo === "capturar") || {};
    checar(logP.length >= 2 && logP.every((x) => x.xsrf === "tok+1") && !logE.length,
      "⛔ captura: o painel lê processo e partes PELA PÁGINA, com o X-XSRF-TOKEN (no TRT19, a extensão recebe 400)");
    checar(cap.brutos && cap.brutos.partes && cap.brutos.partes.TERCEIROS && cap.brutos.gerais && cap.brutos.gerais.id === 240469 && cap.xsrfToken === "tok%2B1",
      "captura: o JSON bruto (processo e partes) vai ao fundo, que só normaliza");
    const logP2 = [];
    const b = montarPainel(SRC, {
      url: "https://pje.trt19.jus.br/pjekz/processo/240469/detalhe",
      fetchPagina: pjeDaPagina(logP2), fetch: fetchDaExtensao([]),       // sem cookie Xsrf-Token
    });
    b.d.querySelector("cratos-botao").dispatchEvent(new b.w.Event("pointerdown", { bubbles: true }));
    b.d.querySelector("cratos-botao").dispatchEvent(new b.w.Event("pointerup", { bubbles: true }));
    await ate(() => /Falha na captura/.test(b.d.body.textContent), 3000);
    checar(/Falha na captura: CRATOS: 400 em \/pje-comum-api\/api\/processos\/id\/240469\/partes/.test(b.d.body.textContent) &&
      !b.msgs.some((m) => m.tipo === "capturar"),
      "⛔ captura recusada pelo PJe: \"Falha na captura\" com o status — nada vai ao fundo, nunca \"sem partes\"");

    /* ── 3. "pje_ler": a aba lê para o fundo ─────────────────────────────── */
    const ouvir = (msg) => { for (const fn of a.ouvintesMsg || []) { const r = fn(msg); if (r !== undefined) return r; } return undefined; };
    logP.length = 0;
    await ouvir({ tipo: "pje_ler", id: "abc123xyz", caminho: "/pje-comum-api/api/calculos/processo?idProcesso=240469" });
    const g1 = a.mem["cratos:pje_leitura:abc123xyz"];
    checar(g1 && g1.ok === true && g1.corpo && g1.corpo.resultado && logP.length === 1 && /^https:\/\/pje\.trt19\.jus\.br\/pje-comum-api\//.test(logP[0].url),
      "⛔ pje_ler: a aba lê pela página e devolve pelo storage (o retorno direto da mensagem é frágil no MV2)");
    logP.length = 0;
    await ouvir({ tipo: "pje_ler", id: "abc123xy2", caminho: "https://exemplo.com/roubo" });
    await ouvir({ tipo: "pje_ler", id: "abc123xy3", caminho: "/outra-api/x" });
    const g2 = a.mem["cratos:pje_leitura:abc123xy2"], g3 = a.mem["cratos:pje_leitura:abc123xy3"];
    checar(g2 && g2.ok === false && /recusado/.test(g2.erro) && g3 && g3.ok === false && !logP.length,
      "⛔ pje_ler: endereço absoluto ou fora do PJe (/pje-comum-api/, /sab-api/) é recusado — a aba não lê outro site");
    await ouvir({ tipo: "pje_ler", id: "abc123xy4", caminho: "/pje-comum-api/semacesso/x" });
    const g4 = a.mem["cratos:pje_leitura:abc123xy4"];
    checar(g4 && g4.ok === false && g4.status === 403, "pje_ler: erro do PJe volta com o status (nunca como vazio)");
    checar(ouvir({ tipo: "pje_ler", id: "../x", caminho: "/pje-comum-api/x" }) === undefined, "pje_ler: id fora do formato é ignorado");
  }

  /* ── 4. o fundo ──────────────────────────────────────────────────────────── */
  {
    const bg = ler("background.js");
    const ini = bg.indexOf("async function lerNaAbaPje(");
    const fim = bg.indexOf("\n}\n", ini) + 3;
    const fazer = (comportamento) => {
      const mem = {};
      const enviados = [];
      const Store = { get: async (k) => (mem[k] === undefined ? null : mem[k]), set: async (k, v) => { mem[k] = v; } };
      const browser = { tabs: { sendMessage: async (tab, m) => {
        enviados.push({ tab, m });
        if (comportamento === "responde") setTimeout(() => { mem["pje_leitura:" + m.id] = { ok: true, status: 200, corpo: { lido: m.caminho } }; }, 30);
        if (comportamento === "erro") setTimeout(() => { mem["pje_leitura:" + m.id] = { ok: false, status: 403, erro: "CRATOS: 403 em /x" }; }, 30);
        return undefined;
      } } };
      if (ini < 0) return { fn: null, mem, enviados };
      const corpo = bg.slice(ini, fim).replace(/20000/g, "400");      // a espera de 20 s, encurtada no teste
      return { fn: new Function("Store", "browser", corpo + "\nreturn lerNaAbaPje;")(Store, browser), mem, enviados };
    };
    const a = fazer("responde");
    const r = a.fn ? await a.fn(7, "https://pje.trt19.jus.br/sab-api/api/processos?numeroProcesso=1").catch((e) => e) : null;
    const chave = a.enviados[0] ? "pje_leitura:" + a.enviados[0].m.id : "";
    checar(r && r.lido === "/sab-api/api/processos?numeroProcesso=1" && a.enviados[0].tab === 7 && a.mem[chave] === null,
      "⛔ lerNaAbaPje: pede à aba do PJe só o CAMINHO (endereço absoluto vira caminho), recolhe a resposta e APAGA do storage");
    const b = fazer("erro");
    const e1 = b.fn ? await b.fn(7, "/pje-comum-api/x").catch((e) => e) : null;
    checar(e1 instanceof Error && e1.status === 403, "lerNaAbaPje: erro do PJe volta como erro, com o status");
    const c = fazer("mudo");
    const e2 = c.fn ? await c.fn(7, "/pje-comum-api/x").catch((e) => e) : null;
    checar(e2 instanceof Error && /a aba do PJe não respondeu/.test(e2.message), "⛔ aba que não responde (fechada, navegou): erro claro, nunca \"vazio\"");
    const e3 = c.fn ? await c.fn(null, "/pje-comum-api/x").catch((e) => e) : null;
    checar(e3 instanceof Error && /não está mais aberta/.test(e3.message), "sem aba do PJe: erro claro, sem pedir nada");

    const ctx = { console: { log() {}, warn() {} }, URL, Intl, fetch: async () => resposta(400, SJT004) };
    vm.createContext(ctx);
    vm.runInContext(ler("comum/api-pje.js") + "\nglobalThis.__Api = ApiPje;", ctx);
    const Api = ctx.__Api;
    Api.setBase("https://pje.trt19.jus.br");
    const pedidos = [];
    if (typeof Api.setLeitor === "function") Api.setLeitor(async (cam) => { pedidos.push(cam); return { resultado: [{ total: 10, dataHoraImportacao: "2026-11-01T10:00:00" }] }; });
    const calc = await Api.obterValorCalculo(240469);
    checar(calc && calc.total === 10 && pedidos.length === 1 && /^\/pje-comum-api\/api\/calculos\/processo\?idProcesso=240469/.test(pedidos[0]),
      "⛔ cálculo (SAB, CNIB, SerasaJUD): com o leitor da aba, a leitura passa pela aba do PJe");
    const proc = typeof Api.montarProcesso === "function" ? Api.montarProcesso(240469, "", { gerais: { numero: "0000001-23.2026.5.19.0001" }, partes: PARTES }) : null;
    checar(proc && proc.numero === "0000001-23.2026.5.19.0001" && proc.partes.length === 3 && proc.partes[2].polo === "terceiro",
      "montarProcesso: o bruto lido pela página vira o processo de sempre (TERCEIROS incluído)");
    checar(/brutos && typeof brutos === "object" && brutos\.partes\s*\?\s*ApiPje\.montarProcesso/.test(bg) &&
      /return capturar\(msg\.base, msg\.idProcesso, msg\.numeroProcesso, msg\.xsrfToken, msg\.brutos\)/.test(bg),
      "fundo: a captura usa o bruto do painel (o caminho antigo fica só de reserva)");

    /* ── 5. ligações ─────────────────────────────────────────────────────── */
    const orq = bg.slice(bg.indexOf("async function orquestraExecutar("), bg.indexOf("switch (convenioId)", bg.indexOf("async function orquestraExecutar(")));
    checar(/ApiPje\.setLeitor\(\(caminho\) => lerNaAbaPje\(aba, caminho\)\)/.test(orq), "⛔ orquestraExecutar: liga o leitor da aba do PJe antes do módulo");
    const sabM = ler("modulos/sab.js");
    checar(/if \(ApiPje\._leitor\)/.test(sabM) && /fetch: pelaAba/.test(sabM), "módulo SAB (fundo): idSab e determinação ativa lidos pela aba");
    const painel = ler("conteudo/painel.js"), sabC = ler("conteudo/sab.js"), sabL = ler("comum/sab-leitura.js");
    checar(!/await fetch\(/.test(painel) && !/await fetch\(/.test(sabC) && /CratosPje\.fetchPagina\(\.\.\.a\)/.test(sabL),
      "⛔ painel, SAB e leitura do SAB na página: nenhuma chamada ao PJe pelo fetch da extensão");
  }

  console.log(`\n=== ${NOME} ===`);
  oks.forEach((d) => console.log("  ok   " + d));
  falhas.forEach((d) => console.log("  FALHA " + d));
  console.log(`\n${oks.length} passaram, ${falhas.length} falharam (${oks.length + falhas.length} asserções)\n`);
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.log("FALHA geral: " + e.stack); process.exit(1); });
