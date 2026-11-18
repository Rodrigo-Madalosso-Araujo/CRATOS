/*
 * teste-sniper.js — módulo SNIPER (1.7.0): investigação patrimonial pelo CNJ.
 * Dados 100% FICTÍCIOS (fixture-sniper.js). A tela e a API são simuladas: o "app" do
 * teste responde à digitação do processo e ao clique em "Iniciar investigação"
 * disparando o mesmo CustomEvent que o grampo (conteudo/sniper-api.js) dispara.
 *
 * O que se trava aqui:
 *  1. Fundo: só consulta; dois PDFs esperados; fontes pelas Preferências; aba aberta
 *     no fim (fora do HOST_CONVENIO); fiação no manifest/background/painel.
 *  2. Grampo: repassa resposta e corpo do POST da API do SNIPER; ignora OPTIONS e
 *     outros hosts; NUNCA repassa cabeçalho (o token).
 *  3. Caso feliz: processo informado, UM clique em Iniciar, relatório + certidão; a
 *     certidão separa resultado / nenhum / ERRO DA FONTE / EM ANDAMENTO; o relatório
 *     não leva o ID para bloqueio.
 *  4. ⛔ Trava de constrição: clicarSeguro recusa "Bloquear"/ícone de cadeado.
 *  5. ⛔ Trava de processo; sem partes; botão que não habilita; POST recusado; aba
 *     recarregada depois do clique — tudo SEM certidão.
 *  6. Fontes desligadas nas Preferências são desmarcadas e certificadas como "não
 *     consultadas"; fonte que não respondeu não vira "nenhum registro".
 *
 * Reprova a 1.6.5 (não há módulo SNIPER).
 * Rodar: node teste-sniper.js   ·   versão antiga: CRATOS_SRC=<pasta> node …
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");
const F = require("./fixture-sniper.js");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const NOME = "teste-sniper.js";
const oks = [], falhas = [];
const checar = (c, d) => (c ? oks : falhas).push(d);
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 20));
async function ate(cond, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 3000)) { try { if (cond()) return true; } catch (e) {} await tick(10); }
  return false;
}
const AGORA = Date.parse("2026-10-21T15:00:00-03:00");

if (!fs.existsSync(path.join(SRC, "conteudo", "sniper.js"))) {
  console.log(`\n=== ${NOME} ===\n  FALHA  a versão em ${SRC} não tem o módulo SNIPER (conteudo/sniper.js).\n\n0 passaram — a suíte inteira reprova nesta versão.\n`);
  process.exit(1);
}

/* ── harness da tela ─────────────────────────────────────────────────────── */
function montar(o) {
  const op = o || {};
  const dom = new JSDOM(op.tela || F.telaInicial(op), { url: "https://sniper.pdpj.jus.br/", runScripts: "outside-only" });
  const w = dom.window;
  const mem = {};
  const estado = Object.assign({
    ativo: true, numProcesso: F.PROC_FMT, numeroDigitos: F.PROC,
    /* 1.9.7: as partes marcadas no painel são as que o SNIPER investiga — por padrão, as duas */
    docsPainel: [{ nome: F.NOME_PJ, doc: F.CNPJ }, { nome: F.NOME_PF, doc: F.CPF }],
    config: { fontes: F.FONTES_TELA.map(([s]) => s), pasta: "CRATOS" },
    fase: "iniciado", abertoEm: new Date(AGORA).toISOString(),
  }, op.estado || {});
  mem["cratos:sniper_estado"] = estado;
  const r = { w, d: w.document, mem, msgs: [], faixas: [], paradas: [], cliques: [], posts: 0 };
  const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
  w.browser = {
    storage: { local: {
      get: async (k) => ({ [k]: clone(mem[k]) }),
      set: async (ob) => { for (const [k, v] of Object.entries(ob)) mem[k] = clone(v); },
      remove: async (k) => { delete mem[k]; },
    }, onChanged: { addListener() {}, removeListener() {} } },
    runtime: { sendMessage: async (m) => { r.msgs.push(clone(m)); return { ok: true }; }, getURL: (p) => "moz-extension://x/" + p, onMessage: { addListener() {} } },
  };
  w.CratosFaixa = {
    mostrar: (m, t, c) => r.faixas.push({ m, t: String(t), c }),
    parar: (m, t) => r.paradas.push({ m, t: String(t) }),
    alertar() {}, dizer() {},
  };
  for (const k of ["log", "warn", "error", "debug"]) w.console[k] = () => {};
  /* o Firefox tem DataTransfer/ClipboardEvent; o jsdom não — stubs mínimos */
  w.DataTransfer = class { constructor() { this._d = {}; } setData(t, v) { this._d[t] = String(v); } getData(t) { return this._d[t] || ""; } };
  w.ClipboardEvent = class extends w.Event { constructor(t, o) { super(t, o); this.clipboardData = (o && o.clipboardData) || null; } };
  r.voltas = 0;
  r.cortina = [];
  w.CratosOverlay = { mostrar: (t) => r.cortina.push("mostrar"), esconder: () => r.cortina.push("esconder") };
  r.tiposInput = [];
  w.document.addEventListener("input", (ev) => { if (ev.target && ev.target.getAttribute("formcontrolname") === "proc") r.tiposInput.push(ev.inputType); }, true);
  w.eval(fs.readFileSync(path.join(SRC, "comum", "storage.js"), "utf8"));

  /* o "app": responde como o SNIPER, pelo mesmo evento do grampo */
  const emitir = (metodo, url, status, corpo, enviado) => setTimeout(() => {
    w.dispatchEvent(new w.CustomEvent("cratos:sniper:api", { detail: JSON.stringify({
      metodo, url, status, corpo: corpo == null ? "" : JSON.stringify(corpo), enviado: enviado == null ? null : JSON.stringify(enviado) }) }));
  }, 5);
  const API = "https://sniper-api.pdpj.jus.br/v2";
  const modos = Object.assign({}, F.MODOS, op.modos || {});
  /* Como o campo do processo reage. "input" (padrão): qualquer evento de input com o número
     inteiro. "colar": SÓ o paste (como o Ctrl+V do Rodrigo). "digitar": SÓ digitação real,
     caractere a caractere (o valor posto de uma vez é ignorado — o que travou a 1.7.0 ao vivo).
     "nunca": não carrega as partes de jeito nenhum. */
  let jaCarregou = false;
  const carregarPartes = (dig) => {
    if (jaCarregou || dig.length !== 20) return;
    jaCarregou = true;
    const num = op.processoDaTela || dig;
    emitir("GET", `${API}/processo/${num}/passiva/`, 200, op.partes || F.PARTES);
    if (!op.botaoNuncaHabilita) setTimeout(() => { const b = w.document.querySelector('button[type="submit"]'); if (b) b.disabled = false; }, 15);
  };
  const campoModo = op.campo || "input";
  w.document.addEventListener("paste", (ev) => {
    const el = ev.target;
    if (campoModo !== "colar" || !el || el.getAttribute("formcontrolname") !== "proc") return;
    ev.preventDefault();
    const t = ev.clipboardData ? ev.clipboardData.getData("text/plain") : "";
    el.value = t;
    carregarPartes(String(t).replace(/\D/g, ""));
  }, true);
  w.document.addEventListener("input", (ev) => {
    const el = ev.target;
    if (!el || el.getAttribute("formcontrolname") !== "proc") return;
    if (campoModo === "input") return carregarPartes(String(el.value).replace(/\D/g, ""));
    if (campoModo === "digitar" && ev.inputType === "insertText" && String(ev.data || "").length === 1) {
      return carregarPartes(String(el.value).replace(/\D/g, ""));
    }
  }, true);

  const grafoJs = path.join(SRC, "comum", "grafo-sniper.js");   // 1.9.3 (o manifest carrega antes)
  if (fs.existsSync(grafoJs)) w.eval(fs.readFileSync(grafoJs, "utf8"));
  w.eval(fs.readFileSync(path.join(SRC, "conteudo", "sniper.js"), "utf8"));
  const api = w.__cratosSniper;
  r.api = api;
  api.io.agora = () => AGORA;
  api.io.esperar = () => new Promise((res) => setTimeout(res, 1));
  api.io.voltar = () => { r.voltas++; for (const x of Array.from(w.document.querySelectorAll(".pagina-parte"))) x.remove(); };
  let parteAberta = null, paginaPf = 0;
  /* op.grafo: "ok" (aba + respostas), "previo" (respostas chegam sozinhas, sem aba),
     "semNo" (falta o /grafo/node de uma parte), "erro" (/partes/ com HTTP 500) */
  const emitirGrafo = () => {
    const G = F.GRAFO;
    if (op.grafo === "erro") { emitir("GET", `${API}/investigacao/${F.ID}/partes/`, 500, { detail: "erro" }); return; }
    emitir("GET", `${API}/investigacao/${F.ID}/partes/`, 200, G.PARTES);
    for (const u of Object.keys(G.NO)) {
      if (op.grafo === "semNo" && u === "g-p4") continue;
      emitir("GET", `${API}/grafo/node/${u}`, 200, G.NO[u]);
    }
    for (const u of Object.keys(G.REL)) emitir("GET", `${API}/grafo/node/${u}/relationships?depth=1&inbound=true&outbound=true`, 200, G.REL[u]);
  };
  /* 1.9.7 — o campo "Pessoa Pesquisada" (mat-select múltiplo, estrutura lida em 18/11).
     Abre um painel role=listbox no overlay com a ação "Desmarcar todas" e uma opção por
     pessoa (todas marcadas, como o SNIPER traz). Cada clique alterna a pessoa; Esc fecha.
     op.opcaoTeimosa: documento cuja opção não desmarca (para a conferência). */
  const docFmt = (d) => d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")
    : d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  r.selecaoPessoas = null;   // null = ninguém mexeu (seleção padrão do SNIPER: todos)
  const pessoasDaTela = () => (op.partes || F.PARTES).filter((p) => String(p.documento || "").length);
  const abrirPainelPessoas = () => {
    if (w.document.getElementById("mat-select-1-panel")) return;
    if (!r.selecaoPessoas) r.selecaoPessoas = new Set(pessoasDaTela().filter((p) => p.selecionada !== false).map((p) => p.documento));
    const ov = w.document.createElement("div");
    ov.className = "cdk-overlay-container";
    const painel = w.document.createElement("div");
    painel.id = "mat-select-1-panel";
    painel.setAttribute("role", "listbox");
    painel.setAttribute("aria-multiselectable", "true");
    const todas = w.document.createElement("mat-option");
    todas.className = "mat-mdc-option option-select__action-all mat-mdc-option-multiple";
    todas.setAttribute("role", "option"); todas.setAttribute("aria-selected", "false");
    todas.innerHTML = '<mat-pseudo-checkbox class="mat-pseudo-checkbox"></mat-pseudo-checkbox><span class="mdc-list-item__primary-text">Desmarcar todas</span>';
    painel.appendChild(todas);
    pessoasDaTela().forEach((p, i) => {
      const o = w.document.createElement("mat-option");
      o.id = "mat-option-" + (i + 1);
      o.className = "mat-mdc-option mat-mdc-option-multiple";
      o.setAttribute("role", "option");
      o.setAttribute("aria-selected", String(r.selecaoPessoas.has(p.documento)));
      o.dataset.doc = p.documento;
      o.innerHTML = `<mat-pseudo-checkbox class="mat-pseudo-checkbox"></mat-pseudo-checkbox><span class="mdc-list-item__primary-text">${p.nome} ${docFmt(p.documento)}</span>`;
      painel.appendChild(o);
    });
    ov.appendChild(painel);
    w.document.body.appendChild(ov);
    painel.addEventListener("keydown", (ev) => { if (ev.key === "Escape") ov.remove(); });
  };
  w.document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") { const pn = w.document.getElementById("mat-select-1-panel"); if (pn) pn.parentNode.remove(); }
  }, true);
  api.io.clicar = (el) => {
    r.cliques.push(String(el.textContent || el.id || "").replace(/\s+/g, " ").trim() || el.id);
    if (el.id === "mat-select-1") { r.abriuPessoas = (r.abriuPessoas || 0) + 1; abrirPainelPessoas(); return; }
    if (el.tagName === "MAT-OPTION" && el.dataset && el.dataset.doc) {
      const d = el.dataset.doc;
      if (op.opcaoTeimosa === d) return;
      if (r.selecaoPessoas.has(d)) r.selecaoPessoas.delete(d); else r.selecaoPessoas.add(d);
      el.setAttribute("aria-selected", String(r.selecaoPessoas.has(d)));
      return;
    }
    if (el.type === "checkbox") { el.checked = !el.checked; return; }
    if (el.tagName === "A") {
      const idParte = (String(el.getAttribute("href")).match(/\/parte\/(\d+)/) || [])[1];
      if (idParte && !(op.infoFalha || []).includes(idParte)) emitir("GET", `${API}/investigacao/${idParte}/info/`, 200, F.INFO[idParte]);
      /* a página da parte: abas Dados | Processos (+ paginador no caso paginado) */
      parteAberta = idParte; paginaPf = 0;
      if (!op.semAbaProcessos) {
        const div = w.document.createElement("div");
        div.className = "pagina-parte";
        div.innerHTML = '<div role="tab" class="mdc-tab">Dados</div><div role="tab" class="mdc-tab">Processos</div>' +
          '<button type="button" aria-label="Próxima página" class="prox">›</button>';
        w.document.body.appendChild(div);
      }
      return;
    }
    if (el.getAttribute && el.getAttribute("role") === "tab" && /Processos/.test(el.textContent)) {
      r.abasProcessos = (r.abasProcessos || 0) + 1;
      if ((op.processosFalha || []).includes(parteAberta)) return;
      if (parteAberta === F.ID_PARTE_PJ) emitir("GET", `${API}/investigacao/${parteAberta}/processos/`, 200, F.PROCESSOS_PJ);
      else { paginaPf = 0; emitir("GET", `${API}/investigacao/${parteAberta}/processos/`, 200, F.PROCESSOS_PF_PAG[0]); }
      return;
    }
    /* 1.9.3 — a aba "Grafo": /partes/, /grafo/node/{uuid} de cada parte, /relationships */
    if (el.getAttribute && el.getAttribute("role") === "tab" && /Grafo/.test(el.textContent)) {
      r.abasGrafo = (r.abasGrafo || 0) + 1;
      emitirGrafo();
      return;
    }
    if (el.classList && el.classList.contains("prox")) {
      r.proximas = (r.proximas || 0) + 1;
      paginaPf++;
      const pg = F.PROCESSOS_PF_PAG[paginaPf];
      if (pg) emitir("GET", `${API}/investigacao/${parteAberta}/processos/?page=${paginaPf + 1}`, 200, pg);
      return;
    }
    if (el.type === "submit") {
      r.posts++;
      const sistemas = Array.from(w.document.querySelectorAll('input[type="checkbox"]'))
        .filter((c) => c.checked && c.id !== "mat-mdc-checkbox-0-input")
        .map((c) => F.FONTES_TELA[Number(c.id.match(/checkbox-(\d+)/)[1]) - 1][0]);
      const corpoPost = { numero_processo: op.processoDoPost || F.PROC, sistemas, doc_partes: op.docPartesPost || (r.selecaoPessoas ? (op.partes || F.PARTES).map((p) => p.documento).filter((d) => r.selecaoPessoas.has(d))
        : (op.partes || F.PARTES).map((p) => p.documento)) };
      if (op.postRecusado) { emitir("POST", `${API}/investigacao/`, 403, { detail: "Usuário sem permissão" }, corpoPost); return; }
      emitir("POST", `${API}/investigacao/`, 201, { url_investigacao: `/i#/investigacao/${F.ID}` }, corpoPost);
      emitir("GET", `${API}/investigacao/${F.ID}/`, 200, { id: Number(F.ID), numero_processo: F.PROC_FMT.slice(0, 20), sistemas: [], partes: [], created_at: "2026-10-21T14:59:30.000" });
      for (const s of sistemas) {
        if ((op.semResposta || []).includes(s)) continue;
        emitir("GET", `${API}/investigacao/${F.ID}/sistemas/${s}/`, 200, F.respostaFonte(s, modos[s]));
      }
      if (!op.semLinks) {
        /* a tela de resultados: um cartão por parte, com "Mais detalhes" */
        setTimeout(() => {
          for (const idp of [F.ID_PARTE_PJ, F.ID_PARTE_PF]) {
            const a = w.document.createElement("a");
            a.setAttribute("href", `https://sniper.pdpj.jus.br/investigacao-de-bens/${F.ID}/parte/${idp}`);
            a.textContent = "Mais detalhes";
            w.document.body.appendChild(a);
          }
          if (op.grafo && op.grafo !== "previo") {
            const aba = w.document.createElement("div");
            aba.setAttribute("role", "tab"); aba.className = "mdc-tab"; aba.textContent = " Grafo ";
            w.document.body.appendChild(aba);
          }
          if (op.grafo === "previo") emitirGrafo();
        }, 8);
      }
    }
  };
  return r;
}
const pdfs = (t) => t.msgs.filter((m) => m.tipo === "fabricar_pdf");
const texto = (m) => (m && m.linhas ? m.linhas.join("\n") : "");

(async () => {
  /* ── 1. fundo + fiação ─────────────────────────────────────────────────── */
  try {
    const mem = {}, abas = [];
    const ctx = {
      console: { log() {}, warn() {}, error() {} },
      browser: {
        storage: { local: { get: async (k) => ({ [k]: mem[k] }), set: async (o) => Object.assign(mem, JSON.parse(JSON.stringify(o))), remove: async () => {} }, onChanged: { addListener() {} } },
        tabs: { query: async () => [], create: async (o) => { abas.push(o.url); return { id: 1 }; }, update: async (id, o) => { abas.push(o.url); return { id }; } },
      },
    };
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    for (const f of [["comum", "storage.js"], ["modulos", "registro.js"], ["modulos", "sniper.js"]]) vm.runInContext(fs.readFileSync(path.join(SRC, ...f), "utf8"), ctx);
    vm.runInContext("globalThis.__M = ModuloSNIPER; globalThis.__R = Registro;", ctx);
    const M = ctx.__M, R = ctx.__R;
    const partes = [{ nome: F.NOME_PJ, cpfcnpj: "11.222.333/0001-81", polo: "passivo" }, { nome: "SEM DOC", cpfcnpj: "", polo: "passivo" }];
    const r1 = await M.executar({ numeroProcesso: F.PROC_FMT, partes }, "consulta");
    const est = mem["cratos:sniper_estado"] || {};
    checar(r1.ok && r1.aguardando && r1.esperados === 2, "fundo: consulta inicia e espera DOIS PDFs (relatório + certidão)");
    checar(abas[0] === "https://sniper.pdpj.jus.br/", "fundo: abre o SNIPER na tela inicial");
    checar(est.config && est.config.fontes.length === 8 && est.docsPainel.length === 1 && est.numeroDigitos === F.PROC,
      "fundo: as 8 fontes ligadas de fábrica; partes do painel guardadas só para conferir");
    checar((await M.executar({ numeroProcesso: F.PROC_FMT, partes }, "inclusao")).ok === false, "⛔ fundo: não há inclusão/baixa — só investigação");
    mem["cratos:config"] = { sniper: { fonte_sngb: { ativo: false }, fonte_sancao: { ativo: false } } };
    await M.executar({ numeroProcesso: F.PROC_FMT, partes }, "consulta");
    const fs2 = mem["cratos:sniper_estado"].config.fontes;
    checar(fs2.length === 6 && fs2.indexOf("sngb") < 0 && fs2.indexOf("sancao") < 0, "Preferências: fonte desligada sai da investigação");
    const todasOff = {}; ["sisbajud", "renajud", "serp", "anacjud", "embarcacao", "bem-declarado", "sngb", "sancao"].forEach((s) => { todasOff["fonte_" + s] = { ativo: false }; });
    mem["cratos:config"] = { sniper: todasOff };
    checar((await M.executar({ numeroProcesso: F.PROC_FMT, partes }, "consulta")).ok === false, "todas as fontes desligadas: recusa com motivo");
    const reg = R.obter("sniper");
    const toggles = reg ? Object.keys(reg.config).filter((k) => /^fonte_/.test(k)) : [];
    checar(toggles.length === 8 && toggles.every((k) => reg.config[k].tipo === "toggle" && reg.config[k].padrao.ativo === true),
      "Preferências: 8 interruptores de fonte, todos LIGADOS de fábrica");
    checar(est.config.processos === true && est.config.grafo === true && reg && reg.config.juntarProcessos && reg.config.juntarGrafo &&
      reg.config.juntarProcessos.tipo === "toggle" && reg.config.juntarProcessos.padrao.ativo === true && reg.config.juntarGrafo.padrao.ativo === true,
      "(1.9.3, 11/11) Preferências: \"Juntar os processos\" e \"Juntar o grafo\", LIGADOS de fábrica (quem atualiza recebe o relatório de sempre)");
    mem["cratos:config"] = { sniper: { juntarProcessos: { ativo: false }, juntarGrafo: { ativo: false } } };
    await M.executar({ numeroProcesso: F.PROC_FMT, partes }, "consulta");
    const c3 = mem["cratos:sniper_estado"].config;
    checar(c3.processos === false && c3.grafo === false && c3.fontes.length === 8, "(1.9.3) chaves desligadas chegam ao estado da investigação; as fontes não mudam");
    const aviso = reg ? reg.config._avisoEscopo.itens.join(" ") : "";
    checar(/Nunca/i.test(aviso) && /constrição/i.test(aviso) && /sigilosos/i.test(aviso), "Preferências: o aviso diz que não há constrição e que os anexos são sigilosos");
  } catch (e) { checar(false, "fundo: não rodou (" + e.message + ")"); }
  {
    const man = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8"));
    const bg = fs.readFileSync(path.join(SRC, "background.js"), "utf8");
    const painel = fs.readFileSync(path.join(SRC, "conteudo", "painel.js"), "utf8");
    const cs = (man.content_scripts || []).find((c) => (c.matches || []).includes("https://sniper.pdpj.jus.br/*"));
    checar(!!cs && cs.js.includes("conteudo/sniper.js") && cs.js.includes("comum/faixa.js"), "manifest: content script no sniper.pdpj.jus.br");
    checar((man.web_accessible_resources || []).includes("conteudo/sniper-api.js"), "manifest: o grampo é recurso acessível à página");
    checar(man.permissions.includes("https://sniper.pdpj.jus.br/*") && !man.permissions.some((p) => /sniper-api/.test(p)),
      "manifest: permissão só no sniper.pdpj.jus.br (a API é chamada pela página, não pela extensão)");
    checar(man.background.scripts.includes("modulos/sniper.js") && /case "SNIPER":\s*return ModuloSNIPER\.executar/.test(bg), "background: o orquestrador despacha SNIPER");
    const host = (bg.match(/const HOST_CONVENIO = \{[\s\S]*?\};/) || [""])[0];
    checar(!/SNIPER/.test(host) && /case "sniper_fechar_aba":\s*\/\*[\s\S]*?\*\/\s*return fecharAbaSab\(sender\)/.test(bg),
      "aba do SNIPER: fora do HOST_CONVENIO (o painel não a fecha em falha); quem fecha é o content script, pela própria aba");
    checar(/id: "SNIPER",[^\n]*ops: \["consulta"\]/.test(painel), "painel: SNIPER na lista, como consulta");
  }

  /* ── 2. o grampo ───────────────────────────────────────────────────────── */
  {
    const dom = new JSDOM("<!doctype html><body></body>", { url: "https://sniper.pdpj.jus.br/", runScripts: "outside-only" });
    const w = dom.window;
    const ouvidos = [];
    w.addEventListener("cratos:sniper:api", (e) => ouvidos.push(JSON.parse(e.detail)));
    w.fetch = async (u, init) => ({ status: 200, clone() { return { text: async () => '{"ok":1}' }; } });
    class XhrFalso {
      constructor() { this._l = {}; this.status = 0; this.responseText = ""; this.responseURL = ""; }
      open(m, u) { this._m = m; this._u = u; }
      setRequestHeader(k, v) { this._h = (this._h || {}); this._h[k] = v; }
      addEventListener(n, f) { this._l[n] = f; }
      send() { this.status = 201; this.responseText = '{"url_investigacao":"/i#/investigacao/9"}'; this.responseURL = this._u; setTimeout(() => this._l.loadend && this._l.loadend(), 1); }
    }
    w.XMLHttpRequest = XhrFalso;
    w.eval(fs.readFileSync(path.join(SRC, "conteudo", "sniper-api.js"), "utf8"));
    await w.fetch("https://sniper-api.pdpj.jus.br/v2/sistemas", { headers: { Authorization: "Bearer eyJhbGciOiJSUzI1NiJ9.segredo" } });
    await w.fetch("https://sniper-api.pdpj.jus.br/v2/sistemas", { method: "OPTIONS" });
    await w.fetch("https://outro.exemplo.gov.br/v2/coisa");
    const x = new w.XMLHttpRequest();
    x.open("POST", "https://sniper-api.pdpj.jus.br/v2/investigacao/");
    x.setRequestHeader("Authorization", "Bearer eyJhbGciOiJSUzI1NiJ9.segredo");
    x.send(JSON.stringify({ numero_processo: F.PROC, sistemas: ["sisbajud"], doc_partes: [F.CNPJ] }));
    await tick(30);
    checar(ouvidos.length === 2, "grampo: repassa as chamadas à API do SNIPER — e ignora OPTIONS e outros hosts");
    const post = ouvidos.find((o) => o.metodo === "POST") || {};
    checar(post.status === 201 && /url_investigacao/.test(post.corpo) && /sisbajud/.test(post.enviado || ""),
      "grampo: o POST da investigação vem com a resposta e com o corpo enviado (fontes)");
    checar(!JSON.stringify(ouvidos).includes("Bearer") && !JSON.stringify(ouvidos).includes("segredo"),
      "⛔ grampo: o token (cabeçalho Authorization) NUNCA é repassado");
  }

  /* ── 3. caso feliz ─────────────────────────────────────────────────────── */
  {
    const t = montar();
    await ate(() => pdfs(t).length >= 2, 6000);
    const campo = t.d.querySelector('input[formcontrolname="proc"]');
    checar(campo.value === F.PROC_FMT, "o nº do processo vai para o campo com a máscara CNJ");
    checar(t.posts === 1, "⛔ UM clique em \"Iniciar investigação\" (nada repetido)");
    const [rel, cert] = [pdfs(t).find((m) => m.detalhe === "relatorio"), pdfs(t).find((m) => m.detalhe === "certidao")];
    checar(!!rel && !!cert && rel.convenio === "SNIPER" && cert.convenio === "SNIPER" && rel.operacao === "consulta",
      "saem dois PDFs do SNIPER: relatório e certidão");
    checar(!!cert && /CRATOS\/00000031420245180008_EMPRESA FICTICIA SNIPER certidao\.pdf$/.test(cert.filename) &&
      /SNIPER relatorio\.pdf$/.test(rel.filename), "nomes no padrão CRATOS (processo + executado)");
    const c = texto(cert), r = texto(rel);
    checar(/registrada no SNIPER sob o nº 4242/.test(c) && /processo nº 0000003-14\.2024\.5\.18\.0008/.test(c), "certidão: nº da investigação e do processo");
    checar(/EMPRESA FICTICIA LTDA - CPF\/CNPJ 11\.222\.333\/0001-81/.test(c) && /FULANO FICTICIO DA SILVA - CPF\/CNPJ 123\.456\.789-09/.test(c),
      "certidão: as pessoas investigadas, com documento formatado");
    checar(/Sisbajud \(contas\): 1 registro encontrado\./.test(c), "certidão: fonte com resultado → \"1 registro encontrado\"");
    checar(/Renajud \(veículos\): nenhum registro encontrado\./.test(c), "certidão: fonte vazia → \"nenhum registro encontrado\"");
    checar(/SNGB \(bens apreendidos\): a fonte retornou erro \("Erro ao buscar dados"\); a consulta a esta fonte não pôde ser concluída\./.test(c),
      "⛔ certidão: ERRO DA FONTE não vira \"nenhum registro\" — vem com a mensagem do SNIPER");
    checar(/SERP\/ONR \(imóveis\): pesquisa em andamento no momento da consulta \("Pesquisa em andamento nos cartórios"\), sem resultado disponível\./.test(c),
      "⛔ certidão: fonte EM ANDAMENTO é certificada assim (sem coleta posterior)");
    checar(/não tiveram resultado disponível até o momento desta certidão/.test(c), "certidão: observa que erro/andamento não tiveram resultado");
    checar(/O grafo de vínculos não pôde ser obtido do SNIPER no momento da consulta; pode ser consultado no próprio SNIPER, investigação nº 4242\./.test(c) &&
      /GRAFO DE VÍNCULOS \(SNIPER\)\n  O grafo de vínculos não pôde ser obtido do SNIPER[^\n]*aba "Grafo" não foi encontrada/.test(r) && !rel.grafoSniper,
      "⛔ (1.9.3) tela sem a aba Grafo: \"não pôde ser obtido\" (nunca \"sem vínculos\"), e o relatório e a certidão saem assim mesmo");
    checar(/Nenhuma medida de constrição foi solicitada\./.test(c) && /iniciada pelo CRATOS, a pedido do\(a\) responsável/.test(c),
      "certidão: rastro — iniciada pelo CRATOS a pedido do responsável; nenhuma constrição");
    checar(/SNIPER relatorio\.pdf/.test(c), "certidão: aponta o relatório anexo pelo nome");
    checar(/Contas ativas: BANCO FICTICIO UM; BANCO FICTICIO DOIS/.test(r) && /Nome proprietário: EMPRESA FICTICIA LTDA/.test(r),
      "relatório: colunas pelas \"fields\" da própria API, listas juntadas com \"; \"");
    checar(r.indexOf(F.ID_BLOQUEIO) < 0 && !/ID para bloquear/i.test(r) && !/ID parte/.test(r),
      "⛔ relatório: o ID para bloqueio (e os IDs internos) NÃO saem");
    checar(/SNGB \(BENS APREENDIDOS\) — erro da fonte/.test(r) && /A fonte retornou erro: Erro ao buscar dados\./.test(r), "relatório: seção por fonte, com a situação");
    const est = t.mem["cratos:sniper_estado"] || {};
    checar(est.ativo === false && est.fase === "concluido" && est.idInvestigacao === F.ID, "estado: concluído, com o nº da investigação");
    checar(!t.paradas.length && !(t.mem["cratos:orq_conv_feito"] && t.mem["cratos:orq_conv_feito"].ok === false), "sem parada e sem pulso de falha");
    const fx = t.faixas[t.faixas.length - 1] || {};
    checar(/investigação nº 4242 concluída/.test(fx.t) && /fechar sozinha/.test(fx.t), "faixa final: resumo e aviso de que a aba vai fechar");
    await ate(() => t.msgs.some((m) => m.tipo === "sniper_fechar_aba"), 4000);
    const iFecha = t.msgs.findIndex((m) => m.tipo === "sniper_fechar_aba");
    const iUltPdf = t.msgs.map((m) => m.tipo).lastIndexOf("fabricar_pdf");
    checar(iFecha > iUltPdf && iUltPdf >= 0, "⛔ (1.7.2) a aba do SNIPER fecha DEPOIS do download dos dois PDFs");
    checar(t.cortina[0] === "mostrar" && t.cortina[t.cortina.length - 1] === "esconder",
      "⛔ (1.7.2) cortina de \"aguarde\" enquanto o CRATOS trabalha, e retirada no fim");
    checar(t.tiposInput[0] === "deleteContentBackward" || t.tiposInput[0] === "insertText",
      "(1.7.2) a primeira tentativa no campo é DIGITAR (a que funcionou ao vivo)");
    checar(t.tiposInput.indexOf("insertFromPaste") < 0, "(1.7.2) com a digitação aceita, o CRATOS nem chega a colar");
  }

  /* ── 4. trava de constrição ────────────────────────────────────────────── */
  {
    const t = montar({ botaoPerigoso: true });
    await ate(() => pdfs(t).length >= 2, 6000);
    checar(!t.cliques.some((c) => /bloque/i.test(c)), "⛔ com um botão \"Bloquear\" na tela, o fluxo nunca clica nele");
    let lancou = false;
    const antes = t.cliques.length;
    try { t.api.clicarSeguro(t.d.getElementById("perigo")); } catch (e) { lancou = /TRAVA/.test(e.message); }
    checar(lancou && t.cliques.length === antes, "⛔ clicarSeguro RECUSA botão de bloqueio (lança e não clica)");
    const b2 = t.d.createElement("button"); b2.innerHTML = "<mat-icon>gavel</mat-icon>"; t.d.body.appendChild(b2);
    const b3 = t.d.createElement("button"); b3.setAttribute("aria-label", "Restringir veículo"); t.d.body.appendChild(b3);
    let l2 = 0;
    for (const b of [b2, b3]) { try { t.api.clicarSeguro(b); } catch (e) { l2++; } }
    checar(l2 === 2, "⛔ clicarSeguro recusa também ícone de martelo e \"Restringir\" no rótulo");
  }

  /* ── 5. paradas sem certidão ───────────────────────────────────────────── */
  {
    const t = montar({ processoDaTela: F.OUTRO_PROC });
    await ate(() => t.paradas.length, 4000);
    checar(t.paradas.length && /outro processo/.test(t.paradas[0].t) && t.posts === 0 && !pdfs(t).length,
      "⛔ trava de processo: tela com outro processo → para, NÃO clica em Iniciar, sem certidão");
  }
  {
    const t = montar({ partes: [{ nome: "SEM DOCUMENTO", documento: "", tipo: "pessoa_fisica", selecionada: true }] });
    await ate(() => t.mem["cratos:orq_conv_feito"], 4000);
    const p = t.mem["cratos:orq_conv_feito"] || {};
    checar(p.ok === false && p.convenio === "SNIPER" && t.posts === 0 && !pdfs(t).length && /nenhuma parte com CPF\/CNPJ/.test(p.motivo || ""),
      "sem parte com documento no polo passivo: avisa, painel recebe \"conferir\", nada iniciado");
  }
  {
    const t = montar({ botaoNuncaHabilita: true });
    await ate(() => t.paradas.length, 6000);
    checar(t.paradas.length && /não habilitou/.test(t.paradas[0].t) && t.posts === 0 && !pdfs(t).length,
      "botão que não habilita: para (faixa), sem clique e sem certidão");
    await tick(60);
    checar(!t.msgs.some((m) => m.tipo === "sniper_fechar_aba") && t.cortina[t.cortina.length - 1] === "esconder",
      "⛔ (1.7.2) em FALHA a aba NÃO fecha (fica para conferir) e a cortina sai");
  }
  {
    const t = montar({ postRecusado: true });
    await ate(() => t.paradas.length, 6000);
    checar(t.paradas.length && /recusou iniciar a investigação \(HTTP 403/.test(t.paradas[0].t) && /sem permissão/.test(t.paradas[0].t) && !pdfs(t).length,
      "POST recusado: para com o código e a mensagem do SNIPER, sem certidão (falha técnica ≠ certidão)");
  }
  {
    const t = montar({ estado: { fase: "investigando", idInvestigacao: "4241" } });
    await ate(() => t.mem["cratos:orq_conv_feito"], 4000);
    checar(t.posts === 0 && !pdfs(t).length && /não iniciou outra/.test((t.mem["cratos:orq_conv_feito"] || {}).motivo || ""),
      "⛔ aba recarregada depois do clique: NÃO inicia outra investigação; avisa e manda conferir no Histórico");
  }

  /* ── 6. fontes pelas Preferências; fonte que não respondeu ─────────────── */
  {
    const t = montar({ estado: { config: { fontes: ["sisbajud", "renajud", "serp", "anacjud", "embarcacao", "bem-declarado"], pasta: "CRATOS" } } });
    await ate(() => pdfs(t).length >= 2, 6000);
    const desmarcadas = ["mat-mdc-checkbox-7-input", "mat-mdc-checkbox-8-input"].every((id) => !t.d.getElementById(id).checked);
    checar(desmarcadas && t.d.getElementById("mat-mdc-checkbox-1-input").checked, "fontes desligadas nas Preferências são DESMARCADAS na tela antes de iniciar");
    const c = texto(pdfs(t).find((m) => m.detalhe === "certidao"));
    checar(/Fontes não consultadas, por configuração do\(a\) usuário\(a\): SNGB \(bens apreendidos\); CGU \(sanções diversas\)\./.test(c) && !/SNGB \(bens apreendidos\): a fonte/.test(c),
      "certidão: fontes desligadas aparecem como \"não consultadas, por configuração\"");
  }
  {
    const t = montar({ semResposta: ["anacjud"] });
    await ate(() => pdfs(t).length >= 2, 9000);
    const c = texto(pdfs(t).find((m) => m.detalhe === "certidao"));
    checar(/AnacJud \(aeronaves\): o SNIPER não apresentou o resultado desta fonte até o momento da consulta\./.test(c) && !/AnacJud \(aeronaves\): nenhum/.test(c),
      "⛔ fonte que não respondeu NÃO vira \"nenhum registro\"");
  }
  {
    /* 1.9.7: com a seleção pelo CRATOS, a parte fora do polo passivo vai JUNTO de uma que está nele
       (só ela, nenhuma das marcadas na lista do SNIPER = nada a investigar: ver o bloco 9) */
    const t = montar({ estado: { docsPainel: [{ nome: F.NOME_PJ, doc: F.CNPJ }, { nome: "TERCEIRO FICTICIO", doc: "98765432100" }] } });
    await ate(() => pdfs(t).length >= 2, 6000);
    const c = texto(pdfs(t).find((m) => m.detalhe === "certidao"));
    checar(/não constavam do polo passivo apresentado pelo SNIPER[\s\S]*TERCEIRO FICTICIO - CPF\/CNPJ 987\.654\.321-00/.test(c),
      "parte marcada no painel fora do polo passivo do SNIPER: registrada na certidão (e na faixa)");
  }

  /* ── 7. (1.7.1) campo do processo: colar / digitar; cadastro das partes ─── */
  {
    const t = montar({ campo: "colar" });
    await ate(() => pdfs(t).length >= 2, 8000);
    checar(pdfs(t).length === 2 && t.posts === 1, "⛔ SNIPER que só aceita COLAR (como o Ctrl+V): as partes carregam e a investigação sai");
  }
  {
    const t = montar({ campo: "digitar" });
    await ate(() => pdfs(t).length >= 2, 12000);
    checar(pdfs(t).length === 2 && t.posts === 1 && t.d.querySelector('input[formcontrolname="proc"]').value === F.PROC_FMT,
      "⛔ SNIPER que só aceita DIGITAÇÃO real (o caso de 21/10): o CRATOS apaga e redigita, e segue");
  }
  {
    const t = montar({ campo: "nunca" });
    await ate(() => t.paradas.length, 15000);
    checar(t.paradas.length && /depois de colar e de digitar/.test(t.paradas[0].t) && t.posts === 0 && !pdfs(t).length,
      "campo que não carrega as partes de jeito nenhum: para depois das tentativas, sem clique e sem certidão");
  }
  {
    const t = montar();
    await ate(() => pdfs(t).length >= 2, 8000);
    const r = texto(pdfs(t).find((m) => m.detalhe === "relatorio"));
    const c = texto(pdfs(t).find((m) => m.detalhe === "certidao"));
    const iCad = r.indexOf("DADOS CADASTRAIS (Receita Federal) E PROCESSOS DAS PARTES"), iFonte = r.indexOf("SISBAJUD (CONTAS)");
    checar(iCad > 0 && iCad < iFonte, "relatório: os dados cadastrais vêm NO COMEÇO, antes das fontes");
    checar(/1\) EMPRESA FICTICIA LTDA - CPF\/CNPJ 11\.222\.333\/0001-81\n {3}CNPJ: 11\.222\.333\/0001-81\n {3}Razão social: EMPRESA FICTICIA LTDA/.test(r) &&
      /Capital social: R\$ 50\.000,00/.test(r) && /CPF do\(a\) responsável: 987\.654\.321-00/.test(r) &&
      /Atividades econômicas: 4711-3\/02 Comércio varejista; 4729-6\/99 Outros/.test(r),
      "relatório: o cadastro da Receita de cada parte, campo a campo (tudo o que o SNIPER mostra)");
    checar(/2\) FULANO FICTICIO DA SILVA[\s\S]*Nome da mãe: MAE FICTICIA DA SILVA/.test(r) && !/\bextra:/.test(r),
      "relatório: cadastro casado com a parte certa pelo CPF/CNPJ; \"extra\" vazio não aparece");
    checar(t.cliques.filter((x) => /Mais detalhes/.test(x)).length === 2, "o CRATOS abre o \"Mais detalhes\" de cada parte (uma vez cada)");
    checar(/Os dados cadastrais das partes investigadas, conforme a Receita Federal, e os processos em nome delas, tal como exibidos pelo SNIPER, também constam do relatório anexo\./.test(c),
      "certidão: menciona que o cadastro e os processos das partes constam do relatório");
    /* 1.7.3 — aba Processos */
    checar(t.abasProcessos === 2, "(1.7.3) o CRATOS abre a aba \"Processos\" de cada parte");
    checar(/PROCESSOS EM NOME DA PARTE \(12\):/.test(r) &&
      /1\) 0000010-11\.2025\.5\.18\.0001 — TRT18 — Execução Fiscal — Assunto: Verbas Rescisórias — Último movimento: Expedição de #\{tipo_de_documento\}\./.test(r),
      "(1.7.3) relatório: número, tribunal, ÚLTIMO NÍVEL da classe, assunto e último movimento (fiel, com os marcadores do SNIPER)");
    checar(/Ação Trabalhista - Rito Ordinário/.test(r) && !/PROCESSO CÍVEL E DO TRABALHO/.test(r), "(1.7.3) da árvore da classe, só o último nível");
    checar(/12\) 0000021-11\.2025\.5\.18\.0001/.test(r) && (t.proximas || 0) === 1,
      "(1.7.3) lista inteira na resposta (paginação só da tela): os 12 entram sem clicar em \"próxima\" na parte que já veio completa");
    checar(/FULANO FICTICIO DA SILVA[\s\S]*PROCESSOS EM NOME DA PARTE \(12\):[\s\S]*TJGO — Agravo de Instrumento — Assunto: Dissolução — Último movimento: 15\/09\/2026 10:00 — Confirmada a intimação eletrônica/.test(r),
      "(1.7.3) paginação NO SERVIDOR (10 + 2): o CRATOS avança a página e junta os 12; campos com outros nomes também são lidos");
    checar(r.indexOf("PROCESSOS EM NOME DA PARTE") > r.indexOf("Razão social:") && r.indexOf("PROCESSOS EM NOME DA PARTE") < r.indexOf("SISBAJUD (CONTAS)"),
      "(1.7.3) os processos vêm logo depois do cadastro de cada parte, antes das fontes");
  }
  {
    const t = montar({ infoFalha: [F.ID_PARTE_PF] });
    await ate(() => pdfs(t).length >= 2, 30000);
    const r = texto(pdfs(t).find((m) => m.detalhe === "relatorio"));
    checar(/2\) FULANO FICTICIO DA SILVA - CPF\/CNPJ 123\.456\.789-09\n {3}\(dados cadastrais não obtidos do SNIPER\)/.test(r) && /Razão social: EMPRESA FICTICIA LTDA/.test(r),
      "cadastro que não chega: o relatório diz \"não obtidos\" para aquela parte e segue com as demais (não trava)");
  }

  {
    const t = montar({ processosFalha: [F.ID_PARTE_PJ] });
    await ate(() => pdfs(t).length >= 2, 30000);
    const r = texto(pdfs(t).find((m) => m.detalhe === "relatorio"));
    checar(/Razão social: EMPRESA FICTICIA LTDA[\s\S]*Processos em nome da parte: não obtidos do SNIPER\./.test(r) && /FULANO FICTICIO DA SILVA[\s\S]*PROCESSOS EM NOME DA PARTE \(12\)/.test(r),
      "(1.7.3) processos que não chegam: \"não obtidos\" naquela parte, o resto segue (não trava)");
  }

  /* ── 8. (1.9.3) o grafo de vínculos no relatório ──────────────────────── */
  {
    const t = montar({ grafo: "ok" });
    await ate(() => pdfs(t).length >= 2, 30000);
    const rel = pdfs(t).find((m) => m.detalhe === "relatorio") || {}, cert = pdfs(t).find((m) => m.detalhe === "certidao") || {};
    const r = texto(rel), c = texto(cert);
    checar(t.abasGrafo === 1 && t.cliques.filter((x) => x === "Grafo").length === 1, "o CRATOS abre a aba \"Grafo\" uma vez (por clicarSeguro)");
    const g = rel.grafoSniper || {};
    checar(g.ok === true && g.grafos.length === 2 && g.totalTerceiros === 6 && g.meta.investigacao === F.ID && g.meta.processo === F.PROC_FMT,
      "o relatório leva o MODELO do grafo (2 grafos, 6 terceiros, nº da investigação) para o fundo desenhar");
    checar(!cert.grafoSniper, "a certidão não leva páginas de grafo (só o relatório)");
    /* (1.9.3) relatório DESENHADO: blocos para o fundo; certidão segue em texto */
    const B = rel.relatorioSniper || [];
    const secoes = B.filter((b) => b.t === "secao");
    checar(Array.isArray(rel.relatorioSniper) && !cert.relatorioSniper && rel.linhas && rel.linhas.length > 10 &&
      rel.relatorioSniperMeta && rel.relatorioSniperMeta.investigacao === F.ID,
      "(1.9.3) relatório vai também em BLOCOS (desenho do fundo); as linhas seguem junto (reserva); a certidão NÃO muda");
    const sng = secoes.find((b) => /SNGB/.test(b.texto)) || {}, sis = secoes.find((b) => /Sisbajud/.test(b.texto)) || {}, serp = secoes.find((b) => /SERP/.test(b.texto)) || {};
    checar(sng.selo && sng.selo.tom === "erro" && sis.selo && sis.selo.tom === "ok" && serp.selo && serp.selo.tom === "andamento",
      "(1.9.3) cada fonte com o seu selo: com resultado / erro da fonte / em andamento");
    const resumo = (B.find((b) => b.t === "tabela" && b.colunas[1] && b.colunas[1].titulo === "Situação") || { linhas: [] }).linhas;
    checar(resumo.length === 8 && resumo.some((l) => l[1].tom === "erro" && /erro da fonte/.test(l[1].texto)), "(1.9.3) resumo das fontes em tabela, com os selos");
    checar(!JSON.stringify(B).includes(F.ID_BLOQUEIO) && !/ID para bloquear/i.test(JSON.stringify(B)),
      "⛔ (1.9.3) blocos: o ID para bloqueio também NÃO sai");
    checar(B.some((b) => b.t === "tabela" && b.colunas[0].titulo === "Terceiro vinculado" && b.linhas.some((l) => /COMERCIO FICTICIO S\.A\. é Sócio desde 20\/11\/2020/.test(l[2]))),
      "(1.9.3) blocos: tabela de terceiros por grafo, com o vínculo na direção certa");
    const mc = t.mem["cratos:orq_marco"] || {};
    checar(mc.convenio === "SNIPER" && /investigação foi iniciada/.test(mc.oque) && t.posts === 1,
      "(1.9.3) marco do Refazer gravado antes de \"Iniciar investigação\" (refazer avisa que cria outra)");
    checar(/GRAFO DE VÍNCULOS \(SNIPER\)\n  O SNIPER exibiu 2 grafos de vínculos, com 6 terceiros vinculados às partes investigadas\./.test(r) &&
      /Grafo 1 — partes: EMPRESA FICTICIA LTDA; FULANO FICTICIO DA SILVA; BELTRANA FICTICIA SOUZA\./.test(r),
      "relatório: seção do grafo com a contagem e as partes de cada grafo");
    checar(/ESSENCIA FICTICIA DO COURO LTDA - CNPJ 45\.645\.645\/0001-45: COMERCIO FICTICIO S\.A\. é Sócio desde 20\/11\/2020\n/.test(r) &&
      /SICRANA TERCEIRA FICTICIA - CPF 444\.555\.666-77: Sócio de EMPRESA FICTICIA LTDA desde 01\/02\/2015\n/.test(r) &&
      /Grafo 2 — parte: COMERCIO FICTICIO S\.A\.\n/.test(r) &&
      !/FORA DO DESENHO/.test(r), "relatório: cada terceiro com a relação NA DIREÇÃO certa e a data de entrada; sem a relação \"*\"");
    checar(/Sem vínculos no grafo do SNIPER: CICRANO ISOLADO FICTICIO\./.test(r), "relatório: parte sem ligação dita como tal (o SNIPER respondeu)");
    checar(!/O grafo de vínculos não é reproduzido/.test(r) && /foi redesenhado no relatório anexo, com a ficha de cada terceiro/.test(c) &&
      /\(2 grafos, 6 terceiros vinculados\)/.test(c), "certidão: o grafo foi redesenhado no relatório anexo (com as contagens)");
    checar(r.indexOf(r.match(/GRAFO DE VÍNCULOS/) ? "GRAFO DE VÍNCULOS" : "@@") > r.indexOf("CGU (SANÇÕES DIVERSAS)"), "relatório: o grafo vem DEPOIS das fontes");
  }
  {
    const t = montar({ grafo: "previo" });
    await ate(() => pdfs(t).length >= 2, 30000);
    const rel = pdfs(t).find((m) => m.detalhe === "relatorio") || {};
    checar(!t.abasGrafo && rel.grafoSniper && rel.grafoSniper.ok && rel.grafoSniper.grafos.length === 2,
      "grafo que a página já carregou sozinha: lido das capturas, sem clicar em nada");
  }
  for (const [modo, desc] of [["semNo", "falta o /grafo/node de uma parte"], ["erro", "o /partes/ do grafo volta com erro"]]) {
    const t = montar({ grafo: modo });
    await ate(() => pdfs(t).length >= 2, 30000);
    const rel = pdfs(t).find((m) => m.detalhe === "relatorio") || {}, cert = pdfs(t).find((m) => m.detalhe === "certidao") || {};
    const r = texto(rel), c = texto(cert);
    checar(pdfs(t).length === 2 && !rel.grafoSniper && /O grafo de vínculos não pôde ser obtido do SNIPER no momento da consulta \(/.test(r) &&
      /não pôde ser obtido do SNIPER no momento da consulta; pode ser consultado no próprio SNIPER, investigação nº 4242\./.test(c) &&
      !/não apresentou vínculos/.test(r + c),
      `⛔ ${desc}: "não pôde ser obtido" (nunca "sem vínculos"), sem páginas de grafo, e o relatório e a certidão saem`);
  }

  /* ── 9. (1.9.3, 11/11) Preferências: juntar ou não os processos e o grafo ── */
  {
    const t = montar({ grafo: "ok", estado: { config: { fontes: F.FONTES_TELA.map(([s]) => s), pasta: "CRATOS", processos: false, grafo: false } } });
    await ate(() => pdfs(t).length >= 2, 30000);
    const rel = pdfs(t).find((m) => m.detalhe === "relatorio") || {}, cert = pdfs(t).find((m) => m.detalhe === "certidao") || {};
    const r = texto(rel), c = texto(cert), B = JSON.stringify(rel.relatorioSniper || []);
    checar(!t.abasProcessos && !t.abasGrafo && !t.cliques.includes("Grafo"),
      "processos e grafo DESLIGADOS: o CRATOS nem abre as abas \"Processos\" e \"Grafo\" (não busca o que não vai juntar)");
    checar(pdfs(t).length === 2 && /Razão social|Nome/.test(r) && /DADOS CADASTRAIS \(Receita Federal\) DAS PARTES/.test(r),
      "o cadastro da Receita continua entrando sempre (sem chave)");
    checar(/PROCESSOS EM NOME DAS PARTES \(DataJud\): não incluídos, por configuração do\(a\) usuário\(a\)\./.test(r) &&
      !/Processos em nome da parte: (não obtidos|\d)/.test(r) &&
      /Os processos em nome das partes investigadas \(DataJud\) não foram incluídos, por configuração do\(a\) usuário\(a\)\./.test(c),
      "⛔ processos desligados: relatório e certidão dizem \"não incluídos, por configuração\" (nunca \"não obtidos\" nem \"0\")");
    checar(/GRAFO DE VÍNCULOS \(SNIPER\)\n  Não incluído, por configuração do\(a\) usuário\(a\)\./.test(r) && !rel.grafoSniper &&
      /O grafo de vínculos do SNIPER não foi incluído, por configuração do\(a\) usuário\(a\)\./.test(c) &&
      !/não pôde ser obtido|não apresentou vínculos/.test(r + c),
      "⛔ grafo desligado: sem páginas de grafo; \"não incluído, por configuração\" (nem \"sem vínculos\" nem \"não pôde ser obtido\")");
    checar(/Processos em nome das partes \(DataJud\): não incluídos, por configuração/.test(B) && /Não incluído, por configuração/.test(B) &&
      !/"Número"/.test(B), "relatório desenhado: as mesmas observações, sem a tabela de processos");
  }
  {
    const t = montar({ grafo: "ok", estado: { config: { fontes: F.FONTES_TELA.map(([s]) => s), pasta: "CRATOS", processos: false } } });
    await ate(() => pdfs(t).length >= 2, 30000);
    const rel = pdfs(t).find((m) => m.detalhe === "relatorio") || {};
    checar(!t.abasProcessos && t.abasGrafo === 1 && rel.grafoSniper && rel.grafoSniper.grafos.length === 2,
      "só os processos desligados: o grafo segue normal (as chaves são independentes)");
  }

  /* ── 9. (1.9.7, Rodrigo, 18/11) "Pessoa Pesquisada": só as partes marcadas no CRATOS ── */
  {
    const t = montar({ estado: { docsPainel: [{ nome: F.NOME_PJ, doc: F.CNPJ }] } });
    await ate(() => pdfs(t).length >= 2, 9000);
    const post = t.msgs.length >= 0 && t.posts;
    checar(t.abriuPessoas >= 1 && t.selecaoPessoas && t.selecaoPessoas.size === 1 && t.selecaoPessoas.has(F.CNPJ),
      "⛔ SNIPER traz as 2 partes marcadas; o CRATOS deixa marcada SÓ a parte marcada no painel");
    checar(!t.cliques.some((c) => /Desmarcar todas/.test(c)), "a opção-ação \"Desmarcar todas\" não é pessoa: o CRATOS nunca clica nela");
    checar(post === 1 && !t.d.getElementById("mat-select-1-panel"), "a lista é fechada antes de iniciar; uma investigação só");
    const c = texto(pdfs(t).find((m) => m.detalhe === "certidao"));
    checar(c.indexOf(F.NOME_PJ) >= 0 && c.indexOf(F.NOME_PF) < 0, "certidão do SNIPER: só a parte investigada (a desmarcada não aparece)");
    checar(pdfs(t).every((m) => Array.isArray(m.partes) && m.partes.length === 1 && m.partes[0].doc === F.CNPJ && m.partes[0].nome === F.NOME_PJ),
      "relatório e certidão levam ao diário quem foi investigado (para a certidão principal dizer \"em face de\")");
    checar(!t.faixas.some((f) => /partes diferentes das marcadas/.test(f.t)), "sem divergência, sem aviso de divergência");
  }
  {
    const t = montar({ estado: { docsPainel: [{ nome: "TERCEIRO FICTICIO", doc: "98765432100" }] } });
    await ate(() => t.mem["cratos:orq_conv_feito"], 6000);
    const p = t.mem["cratos:orq_conv_feito"] || {};
    checar(p.ok === false && t.posts === 0 && !pdfs(t).length && /nenhuma das partes marcadas no CRATOS aparece/.test(p.motivo || ""),
      "⛔ nenhuma parte marcada no CRATOS está na lista do SNIPER: para SEM iniciar a investigação e sem certidão");
  }
  {
    const t = montar({ opcaoTeimosa: F.CPF, estado: { docsPainel: [{ nome: F.NOME_PJ, doc: F.CNPJ }] } });
    await ate(() => t.paradas.length, 9000);
    checar(t.paradas.length && /não consegui deixar marcadas no SNIPER só as partes marcadas no CRATOS/.test(t.paradas[0].t) &&
      /Nada foi iniciado/.test(t.paradas[0].t) && t.posts === 0 && !pdfs(t).length,
      "⛔ opção que não desmarca: a conferência pega, NÃO clica em Iniciar, sem certidão (falha técnica ≠ certidão)");
  }
  {
    const t = montar({ docPartesPost: [F.CNPJ, F.CPF], estado: { docsPainel: [{ nome: F.NOME_PJ, doc: F.CNPJ }] } });
    await ate(() => pdfs(t).length >= 2, 9000);
    const c = texto(pdfs(t).find((m) => m.detalhe === "certidao"));
    checar(c.indexOf(F.NOME_PJ) >= 0 && c.indexOf(F.NOME_PF) >= 0 && t.faixas.some((f) => /partes diferentes das marcadas no CRATOS/.test(f.t)),
      "⛔ SNIPER registrou partes diferentes: a certidão diz quem o SNIPER DE FATO investigou, e a faixa avisa");
  }
  {
    const vm = require("vm");
    const ctx = { console: { log() {}, error() {}, warn() {} }, Store: { get: async () => ({}), set: async (k, v) => { ctx.gravado = v; } },
      CHAVES: { config: "config" }, browser: { tabs: { query: async () => [], create: async () => ({}), update: async () => ({}) } } };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(SRC, "modulos", "sniper.js"), "utf8") + "\nglobalThis.__S = ModuloSNIPER;", ctx);
    const r = await ctx.__S.executar({ numeroProcesso: F.PROC_FMT, partes: [{ nome: "SEM DOC", cpfcnpj: "", polo: "passivo" }] }, "consulta");
    checar(r.ok === false && /Nenhuma das partes marcadas tem CPF\/CNPJ/.test(r.motivo || "") && !ctx.gravado,
      "módulo: nenhuma parte marcada com CPF/CNPJ → recusa antes de abrir o SNIPER");
  }

  console.log(`\n=== ${NOME} ===`);
  oks.forEach((d) => console.log("  ok   " + d));
  falhas.forEach((d) => console.log("  FALHA " + d));
  console.log(`\n${oks.length} passaram, ${falhas.length} falharam (${oks.length + falhas.length} asserções)\n`);
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.log("FALHA geral: " + e.stack); process.exit(1); });
