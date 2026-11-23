/*
 * teste-censec-periodo.js — CENSEC 1.9.8: período, teto de 300, partes ato a ato,
 * cortina e a certidão nova. Dados FICTÍCIOS.
 *
 * Pedidos e achados do Rodrigo (23/11/2026):
 *  · delimitar a consulta por datas: 10, 5, 3, 2 ou 1 ano, ou personalizado;
 *  · a CEP mostra no máximo 300 atos ("Mostrando os primeiros 300 registros. Favor
 *    refine sua busca") — a certidão dizia "foram encontrados 300 atos";
 *  · numa consulta grande, as partes dos atos não vieram (prazo único de 45 s);
 *  · "Livro 00000247Livro de Notas" (número e complemento colados);
 *  · cortina com andamento ("demora sem falar nada").
 *
 * A CEP simulada aqui se comporta como a real (HAR de 23/11): POST /api/atos/cep/busca com
 * { cpfCnpj, dataInicio, dataFim, … } → { buscaTicket, atos[] }, cortando em 300.
 *
 * Reprova a 1.9.7. Rodar: node teste-censec-periodo.js
 * Versão antiga: CRATOS_SRC=<pasta do src> node teste-censec-periodo.js
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const NOME = "teste-censec-periodo";
const oks = [], falhas = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 30));
const existe = (rel) => fs.existsSync(path.join(SRC, rel));
const ler = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");

/* N atos fictícios espalhados de 2016-11-24 a 2026-11-23 */
function gerarAtos(n) {
  const ini = Date.UTC(2016, 10, 24), fim = Date.UTC(2026, 10, 23);
  return Array.from({ length: n }, (_, i) => {
    const t = ini + Math.floor((fim - ini) * (i + 0.5) / n);
    const d = new Date(t).toISOString().slice(0, 10);
    return { id: "ato-" + i, data: d + "T00:00:00", tipo: i % 2 ? "Procuração" : "Escritura", qualidade: "Outorgado",
      livro: String(100 + i), livroComplemento: i % 3 ? "Livro de Notas" : "E", folha: String(i % 400), folhaComplemento: null,
      cartorioNome: "TABELIONATO FICTICIO " + (i % 7), cartorioMunicipio: "CIDADE FICTICIA", cartorioUf: "GO", cns: 10000 + (i % 7) };
  });
}

/* A tela do CEP: os três campos, o Buscar e o "app" que monta a busca a partir deles. */
function montarCep(op) {
  const dom = new JSDOM(`<!doctype html><body>
    <app-public-query>
      <mat-form-field><mat-label>Documento (CPF/CNPJ)</mat-label><input id="doc"></mat-form-field>
      <mat-form-field><mat-label>Data inicial</mat-label><input id="di"></mat-form-field>
      <mat-form-field><mat-label>Data final</mat-label><input id="df"></mat-form-field>
      <button id="buscar">Buscar</button>
    </app-public-query></body>`,
    { url: "https://www.censec.org.br/private/s/00000000-0000-0000-0000-000000000000/cep", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.Element.prototype.getBoundingClientRect = function () { return { width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10 }; };
  const mem = { "cratos:censec_estado": { ativo: false, numProcesso: "0000001-23.2026.5.18.0008",
    periodo: { inicio: "2016-11-24", fim: "2026-11-23" }, config: { pasta: "CRATOS", gerarNegativa: true, puxarPartes: !!op.puxarPartes } } };
  const buscas = [], pdfs = [], cortinas = [], msgs = [];
  w.browser = {
    storage: { local: { get: async (k) => ({ [k]: mem[k] }), set: async (o) => Object.assign(mem, o), remove: async () => {} }, onChanged: { addListener() {} } },
    runtime: { sendMessage: async (m) => { msgs.push(m); if (m && m.tipo === "fabricar_pdf") pdfs.push(m); return { ok: true }; },
      onMessage: { addListener() {} }, getURL: (p) => "moz-extension://x/" + p },
  };
  const TODOS = op.atos || [];
  const isoDe = (dmy) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dmy || ""); return m ? `${m[3]}-${m[2]}-${m[1]}T15:00:00.000Z` : null; };
  w.fetch = async (url, init) => {
    const u = String(url);
    if (/\/api\/atos\/cep\/busca/.test(u)) {
      const b = JSON.parse(init.body);
      buscas.push(b);
      const di = op.ignorarDatas ? null : (b.dataInicio || "").slice(0, 10), df = op.ignorarDatas ? null : (b.dataFim || "").slice(0, 10);
      const achados = TODOS.filter((a) => (!di || a.data.slice(0, 10) >= di) && (!df || a.data.slice(0, 10) <= df));
      return { ok: true, status: 200, json: async () => ({}), text: async () => JSON.stringify({ buscaTicket: null, atos: achados.slice(0, 300) }), clone() { return this; } };
    }
    if (/\/partes/.test(u)) {
      const id = decodeURIComponent(u.split("/cep/")[1].split("/")[0]);
      if (op.partesTravam && op.partesTravam.includes(id)) return new Promise(() => {});      // nunca responde
      return { ok: true, status: 200, json: async () => ({ totalCount: 1, items: [{ nome: "PARTE FICTICIA " + id, numeroDocumento: "11144477735", qualidade: "Outorgante" }] }) };
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
  };
  /* o "app": Buscar monta o corpo com o que está nos campos (como o Angular) */
  w.document.getElementById("buscar").addEventListener("click", () => {
    w.fetch("/api/atos/cep/busca", { method: "POST", body: JSON.stringify({
      cpfCnpj: w.document.getElementById("doc").value.replace(/\D/g, ""),
      dataInicio: op.semDatasNoCorpo ? null : isoDe(w.document.getElementById("di").value),
      dataFim: op.semDatasNoCorpo ? null : isoDe(w.document.getElementById("df").value),
      exactMatch: true, captcha: "token-captcha-ficticio" }) });
  });
  w.CratosFaixa = { parar() {}, mostrar() {} };
  w.CratosOverlay = { mostrar: (t) => cortinas.push(String(t)), esconder: () => cortinas.push("—") };
  w.console.log = () => {}; w.console.warn = () => {}; w.console.error = () => {};
  w.eval(ler("comum/storage.js"));
  if (existe("comum/periodo.js")) w.eval(ler("comum/periodo.js"));
  w.eval(ler("conteudo/censec.js"));
  w.eval(ler("conteudo/censec-api.js"));
  return { w, mem, buscas, pdfs, cortinas, msgs };
}
const PARTE = { nome: "FULANO FICTICIO", cpfcnpj: "52998224725" };
const PER = { inicio: "2016-11-24", fim: "2026-11-23" };

(async () => {
  /* ── 1. o módulo de período ── */
  {
    let P = null;
    if (existe("comum/periodo.js")) { const c = {}; vm.createContext(c); vm.runInContext(ler("comum/periodo.js"), c); P = c.CratosPeriodo; }
    const hoje = new Date(2026, 10, 23, 10);
    const r = (e) => (P ? P.resolver(e, hoje) : { erro: "sem módulo" });
    checar(JSON.stringify([r({ valor: "10a" }), r({ valor: "5a" }), r({ valor: "1a" })].map((x) => [x.inicio, x.fim])) ===
      JSON.stringify([["2016-11-24", "2026-11-23"], ["2021-11-24", "2026-11-23"], ["2025-11-24", "2026-11-23"]]),
      "⛔ períodos prontos: 10, 5 e 1 ano contados até hoje");
    checar(r({ valor: "personalizado", inicio: "2020-01-01", fim: "2020-12-31" }).inicio === "2020-01-01" &&
      /depois da final/.test(r({ valor: "personalizado", inicio: "2021-01-01", fim: "2020-12-31" }).erro || "") &&
      /duas datas/.test(r({ valor: "personalizado", inicio: "2020-02-30", fim: "2020-12-31" }).erro || "") &&
      /depois de hoje/.test(r({ valor: "personalizado", inicio: "2020-01-01", fim: "2027-01-01" }).erro || ""),
      "personalizado: datas válidas; início depois do fim, data inexistente e fim no futuro são recusados");
    const m = P ? P.dividir({ inicio: "2016-11-24", fim: "2026-11-23" }) : null;
    checar(m && m[0].inicio === "2016-11-24" && m[1].fim === "2026-11-23" && m[0].fim < m[1].inicio &&
      P.dividir({ inicio: "2026-11-23", fim: "2026-11-23" }) === null, "dividir: duas metades sem sobreposição; um dia só não se divide");
  }

  /* ── 2. o módulo do CENSEC: período no estado, preferências ── */
  {
    const c = { console: { log() {}, error() {}, warn() {} }, URL };
    const mem = {};
    c.Store = { get: async (k) => mem[k], set: async (k, v) => { mem[k] = v; } };
    c.CHAVES = { config: "config" };
    c.abrirCensec = async () => ({ ok: true });
    const regs = [];
    c.Registro = { adicionar: (x) => regs.push(x) };
    vm.createContext(c);
    if (existe("comum/periodo.js")) vm.runInContext(ler("comum/periodo.js"), c);
    vm.runInContext(ler("modulos/censec.js") + "\nglobalThis.__M = ModuloCENSEC;", c);
    const ctx = { numeroProcesso: "0000001-23.2026.5.18.0008", partes: [{ nome: "A", cpfcnpj: "52998224725", polo: "passivo" }] };
    mem.config = { censec: { periodoPadrao: "3a" } };
    await c.__M.executar(ctx, "consulta");
    const e1 = mem.censec_estado || {};
    const anos = (p) => p && p.inicio && Number(p.fim.slice(0, 4)) - Number(p.inicio.slice(0, 4));
    checar(e1.periodo && anos(e1.periodo) === 3 && e1.config.consultarCanp === true,
      "⛔ sem escolha no painel: o padrão das Preferências (3 anos); CANP ligada de fábrica");
    await c.__M.executar(Object.assign({}, ctx, { censecPeriodo: { valor: "personalizado", inicio: "2019-05-01", fim: "2019-06-30" } }), "consulta");
    checar(((mem.censec_estado || {}).periodo || {}).inicio === "2019-05-01" && mem.censec_estado.periodo.fim === "2019-06-30", "escolha do painel manda (personalizado)");
    const ruim = await c.__M.executar(Object.assign({}, ctx, { censecPeriodo: { valor: "personalizado", inicio: "2019-07-01", fim: "2019-06-30" } }), "consulta");
    checar(ruim && ruim.ok === false && /período|data/i.test(ruim.motivo || ""), "período inválido: o CENSEC nem abre");
    const cfg = (regs[0] && regs[0].config) || {};
    checar(cfg.periodoPadrao && cfg.periodoPadrao.padrao === "10a" && (cfg.periodoPadrao.opcoes || []).map((o) => o.valor).join() === "10a,5a,3a,2a,1a" &&
      cfg.consultarCanp && cfg.consultarCanp.padrao.ativo === true, "Preferências: período padrão (10 anos de fábrica) e \"Consultar também a CANP\" (ligada)");
    const painel = ler("conteudo/painel.js");
    checar(/fila\.some\(\(c\) => c\.id === "CENSEC"\)\)[\s\S]{0,200}escolherPeriodoCensec\(\)/.test(painel) && /ctx\.censecPeriodo = per\.escolha/.test(painel),
      "painel: antes de a fila andar, pergunta o período do CENSEC e o manda no ctx");
  }

  /* ── 3. CEP: busca com período, conferida ── */
  {
    const t = montarCep({ atos: gerarAtos(79) });
    await tick();
    const C = t.w.__cratosCensec || {};
    const r = C.consultarParte ? await C.consultarParte(PARTE, "52998224725", PER, {}, "teste") : { ok: false };
    checar(r.ok && r.completo && r.atos.length === 79 && t.buscas.length === 1 &&
      t.buscas[0].dataInicio.slice(0, 10) === "2016-11-24" && t.buscas[0].dataFim.slice(0, 10) === "2026-11-23",
      "⛔ CEP: o período vai nos campos de data e a busca sai com ele (79 atos, uma busca, completa)");
    checar(t.cortinas.some((c) => /^CENSEC: teste — CEP, busca 1/.test(c)), "cortina com andamento (\"CEP, busca 1…\")");
  }
  {
    const t = montarCep({ atos: gerarAtos(79), semDatasNoCorpo: true });
    await tick();
    const C = t.w.__cratosCensec || {};
    const r = C.consultarParte ? await C.consultarParte(PARTE, "52998224725", PER, {}, "teste") : { ok: true };
    checar(r.ok === false && /período pedido/.test(r.motivo || ""),
      "⛔ se a busca NÃO sai com o período (data não pegou no formulário), a parte falha — nada certificado");
  }

  /* ── 4. o teto de 300 e o refinamento ── */
  {
    const t = montarCep({ atos: gerarAtos(700) });
    await tick();
    const C = t.w.__cratosCensec || {};
    const r = C.consultarParte ? await C.consultarParte(PARTE, "52998224725", PER, {}, "teste") : { ok: false };
    checar(r.ok && r.completo && r.atos.length === 700 && r.buscas > 1 && r.buscas <= 10,
      "⛔ 700 atos: bate no teto, divide o período e cobre tudo (todos os 700, sem repetir, em até 10 buscas)");
  }
  let parcial = null;
  {
    const t = montarCep({ atos: gerarAtos(6000) });
    await tick();
    const C = t.w.__cratosCensec || {};
    parcial = C.consultarParte ? await C.consultarParte(PARTE, "52998224725", PER, {}, "teste") : { ok: false };
    checar(parcial.ok && !parcial.completo && parcial.buscas === 10 && t.buscas.length === 10 && parcial.naoCobertos.length > 0,
      "6.000 atos: para nas 10 buscas e marca o período NÃO coberto");
  }

  /* ── 5. partes ato a ato ── */
  {
    const t = montarCep({ atos: [], partesTravam: ["b"] });
    await tick();
    const C = t.w.__cratosCensec || {};
    const andamento = [];
    const r = C.consultarParte && C.pedirPartes.length >= 2
      ? await C.pedirPartes(["a", "b", "c", "d"], (f, tot) => andamento.push(`${f}/${tot}`), 1500) : null;
    checar(r && r.a && r.a.ok && r.c && r.d && !r.b && andamento.includes("3/4"),
      "⛔ partes: chegam ato a ato, com andamento; um ato que trava não derruba os outros (a 1.9.7 perdia TODOS)");
  }

  /* ── 6. a certidão ── */
  {
    const t = montarCep({ atos: [] });
    await tick();
    const C = t.w.__cratosCensec || {};
    const M = C.montarCertidao;
    const cert = (cep, canp, puxar) => (M ? M({ parte: PARTE, doc: "52998224725", periodo: PER, cep, canp, puxarPartes: !!puxar, hoje: "23/11/2026" }) : { linhas: [], titulo: "" });
    const txt = (c) => c.linhas.join("\n");
    const atos79 = gerarAtos(79);
    const c1 = cert({ atos: atos79, completo: true, buscas: 1, cobertos: [PER], naoCobertos: [], partesPorAto: {} }, { estado: "desligada" });
    checar(/abrangendo os atos praticados entre 24\/11\/2016 e 23\/11\/2026, e que foram encontrados 79 ato/.test(txt(c1)),
      "⛔ a certidão diz o período consultado");
    checar(/Livro 101 \(Livro de Notas\)/.test(txt(c1)) && /Livro 100E/.test(txt(c1)) && !/\dLivro de Notas/.test(txt(c1)),
      "livro: \"101 (Livro de Notas)\" e \"100E\" — nunca colado (\"00000247Livro de Notas\")");
    const c0 = cert({ atos: [], completo: true, buscas: 1, cobertos: [PER], naoCobertos: [] }, { estado: "desligada" });
    checar(c0.negativa && /NEGATIVA/.test(c0.titulo) && /NÃO foram encontrados atos notariais registrados em seu nome nesse período/.test(txt(c0)) &&
      /A CANP não foi consultada, por configuração/.test(txt(c0)), "negativa com período; CANP desligada dita \"por configuração\"");
    const cp = cert(parcial && parcial.ok ? parcial : { atos: gerarAtos(300), completo: false, buscas: 10, cobertos: [], naoCobertos: [PER] }, { estado: "desligada" });
    checar(!/foram encontrados 300/.test(txt(cp)) && /exibe no máximo 300 atos por consulta/.test(txt(cp)) &&
      /podem existir outros atos, NÃO relacionados nesta certidão/.test(txt(cp)) && !cp.negativa,
      "⛔ parcial: NUNCA \"foram encontrados 300\" — diz o teto e o período não coberto");
    const lista = (c) => c.linhas.filter((l) => /^\d+\) /.test(l)).length;
    checar(lista(cp) <= 300, "relaciona no máximo 300 atos (decisão de 23/11)");
    const cpartes = cert({ atos: atos79.slice(0, 2), completo: true, buscas: 1, cobertos: [PER], naoCobertos: [],
      partesPorAto: { "ato-0": { ok: true, partes: [{ nome: "PARTE X", documento: "11144477735", qualidade: "Outorgante" }] } } }, { estado: "desligada" }, true);
    checar(/PARTE X - 111\.444\.777-35 - Outorgante/.test(txt(cpartes)) && /Partes do ato: não obtidas nesta consulta\./.test(txt(cpartes)),
      "partes: as que vieram entram; as que não vieram dizem \"não obtidas\"");
    const canpOk = cert({ atos: [], completo: true, buscas: 1, cobertos: [PER], naoCobertos: [] },
      { estado: "ok", parte: { ok: true, total: 2, atos: [{ dataAto: "2025-03-04", nomeTipoAto: "Procuração", livroComplemento: "1234", folhaComplemento: "56",
        nomeCartorio: "TABELIAO FICTICIO SP", municipio: "SÃO PAULO", uf: "SP", numeroCns: "12.345-6" }, { dataAto: "2024-01-02", nomeTipoAto: "Escritura" }] } });
    checar(/ATOS PRATICADOS NO ESTADO DE SÃO PAULO — CANP/.test(txt(canpOk)) && /foram encontrados 2 ato/.test(txt(canpOk)) &&
      /04\/03\/2025 - Procuração - Livro 1234, Fl\. 56/.test(txt(canpOk)) && !canpOk.negativa,
      "⛔ CANP: bloco de São Paulo na mesma certidão; com atos lá, não é negativa");
    const canpFalhou = cert({ atos: [], completo: true, buscas: 1, cobertos: [PER], naoCobertos: [] }, { estado: "falhou", motivo: "o Signo não respondeu" });
    checar(/A CANP não pôde ser consultada nesta oportunidade \(o Signo não respondeu\)\. Esta certidão não abrange os atos praticados no estado de São Paulo/.test(txt(canpFalhou)) &&
      !canpFalhou.negativa, "⛔ CANP que falhou: a certidão diz que São Paulo NÃO foi consultado, e não é negativa");
    const canp0 = cert({ atos: [], completo: true, buscas: 1, cobertos: [PER], naoCobertos: [] }, { estado: "ok", parte: { ok: true, total: 0, atos: [] } });
    checar(canp0.negativa && /NÃO foram encontrados atos em nome da parte/.test(txt(canp0)), "CEP e CANP sem nada: negativa, dizendo as duas");
    const muitos = Array.from({ length: 300 }, (_, i) => ({ dataAto: "2020-01-01", nomeTipoAto: "Procuração" }));
    const canp350 = cert({ atos: [], completo: true, buscas: 1, cobertos: [PER], naoCobertos: [] }, { estado: "ok", parte: { ok: true, total: 350, atos: muitos } });
    checar(/foram encontrados 350 ato\(s\), dos quais se relacionam abaixo os 300 primeiros/.test(txt(canp350)), "CANP com 350: total exato, relaciona 300");
  }

  /* ── 7. a CANP pedida ao Signo ── */
  {
    const t = montarCep({ atos: [] });
    await tick();
    const C = t.w.__cratosCensec || {};
    let r = null;
    if (C.consultarCanp) {
      const p = C.consultarCanp({ numProcesso: "0000001-23.2026.5.18.0008" }, [{ nome: "A", doc: "52998224725" }], PER);
      await tick(200);
      const est = t.mem["cratos:canp_estado"] || {};
      t.mem["cratos:canp_estado"] = Object.assign({}, est, { fase: "concluido", resultados: { "52998224725": { ok: true, total: 1, atos: [{}] } } });
      r = await p;
      checar(est.fase === "aguardando" && est.periodo && est.periodo.inicio === PER.inicio && t.msgs.some((m) => m && m.tipo === "canp_abrir"),
        "CENSEC → Signo: grava o pedido (partes e período) e pede ao fundo a aba do Signo");
    } else checar(false, "CENSEC → Signo: grava o pedido (partes e período) e pede ao fundo a aba do Signo");
    checar(r && r.estado === "ok" && r.porDoc["52998224725"].total === 1 && t.mem["cratos:canp_estado"].fase === "recolhido" &&
      !t.mem["cratos:canp_estado"].resultados, "recolhe o resultado e não deixa atos guardados no storage");
  }

  /* ── 8. ligações ── */
  {
    const api = ler("conteudo/censec-api.js");
    checar(/filtroDoCorpo/.test(api) && /cpfCnpj: b\.cpfCnpj/.test(api) && !/captcha:/.test(api.split("filtroDoCorpo")[1].split("}")[0]),
      "grampo: repassa o filtro (documento e datas) que foi ao servidor — e não o token do captcha");
    const man = JSON.parse(ler("manifest.json"));
    const cs = (man.content_scripts || []).find((c) => (c.js || []).includes("conteudo/censec.js")) || {};
    checar((cs.js || []).includes("comum/periodo.js") && (man.background.scripts || []).includes("comum/periodo.js"),
      "manifest: o módulo de período no CENSEC, no painel e no fundo");
  }

  console.log(`\n=== ${NOME} ===`);
  oks.forEach((d) => console.log("  ok   " + d));
  falhas.forEach((d) => console.log("  FALHA " + d));
  console.log(`\n${oks.length} passaram, ${falhas.length} falharam (${oks.length + falhas.length} asserções)\n`);
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.log("FALHA geral: " + e.stack); process.exit(1); });
