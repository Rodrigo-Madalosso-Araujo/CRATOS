/*
 * teste-canp.js — a CANP (atos notariais de São Paulo, no Signo) — 1.9.8. Dados FICTÍCIOS.
 *
 * Mapeamento de 23/11/2026 (telas e HARs do Rodrigo, só a estrutura):
 *  · a tela é www.signo.org.br/#/interno/consultas-internas ("Relatórios → Consultar Atos");
 *  · os dados vêm de backend.signo.org.br/api/ato/consultas-internas/listar-atos, com o
 *    token do app em Authorization (JWT de 1 h) e "Front: SignoFront"; resposta paginada;
 *  · o período vai como periodoAto (ISO, duas vezes) e dataInicial/dataFinal;
 *  · login: "Ou acesse via certificado digital" → janela com a lista de certificados →
 *    "Entrar" (e o PIN). O CRATOS só deixa o ÚNICO certificado escolhido — nunca entra.
 *
 * O que se trava aqui:
 *  1. grampo: captura o token do app (ou o lê da sessão); consulta a central 8 com o
 *     período; pagina até 300 ou o total; o token nunca sai do contexto da página;
 *  2. sem login: avisa, abre a janela do certificado, escolhe o único — e NÃO clica em Entrar;
 *     com dois certificados, não escolhe;
 *  3. fluxo: pedido do CENSEC → consulta cada parte → grava "concluido" → volta ao CENSEC;
 *     uma parte que falha não derruba as outras;
 *  4. fundo: só o CENSEC abre o Signo; só o Signo devolve o foco; manifest.
 *
 * Reprova a 1.9.7. Rodar: node teste-canp.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const NOME = "teste-canp";
const oks = [], falhas = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 30));
async function ate(cond, ms) { const t0 = Date.now(); while (Date.now() - t0 < (ms || 4000)) { try { if (cond()) return true; } catch (e) { /* */ } await tick(40); } return false; }
const existe = (rel) => fs.existsSync(path.join(SRC, rel));
const ler = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const JWT = (expSeg) => `${b64u({ alg: "HS512" })}.${b64u({ sub: "ficticio", exp: Math.floor(Date.now() / 1000) + expSeg })}.assinatura`;
const TOKEN = JWT(3600);
const PER = { inicio: "2016-11-24", fim: "2026-11-23" };

function atoSP(i) {
  return { idAto: i, tipoAto: 1, nomeTipoAto: "Procuração", dataAto: "2024-01-0" + ((i % 9) + 1), status: 3, central: 8,
    livroInicial: 10 + i, livroComplemento: String(10 + i), folhaInicial: i, folhaComplemento: String(i),
    nome: "EMPRESA FICTICIA", cpf: "11222333000181", nomeCartorio: "TABELIAO FICTICIO", numeroCns: "11.111-1", uf: "SP", municipio: "SÃO PAULO" };
}

function montar(op) {
  const dom = new JSDOM(`<!doctype html><body>${op.html || ""}</body>`,
    { url: "https://www.signo.org.br/" + (op.hash || "#/interno/consultas-internas"), runScripts: "outside-only" });
  const w = dom.window;
  const mem = Object.assign({}, op.mem || {});
  const msgs = [], faixas = [], pedidos = [];
  const ouvintes = [];
  w.browser = {
    storage: { local: { get: async (k) => ({ [k]: mem[k] }), set: async (o) => { Object.assign(mem, o); ouvintes.forEach((f) => f(Object.fromEntries(Object.keys(o).map((k) => [k, {}])))); }, remove: async () => {} },
      onChanged: { addListener: (f) => ouvintes.push(f) } },
    runtime: { sendMessage: async (m) => { msgs.push(m); return { ok: true }; }, onMessage: { addListener() {} }, getURL: (p) => "moz-extension://x/" + p },
  };
  if (op.sessao) w.sessionStorage.setItem("signo-auth", JSON.stringify({ accessToken: op.sessao }));
  w.fetch = async (url, init) => {
    const u = String(url);
    pedidos.push({ url: u, headers: (init && init.headers) || {} });
    if (/listar-atos/.test(u)) {
      const q = new URL(u).searchParams;
      const doc = q.get("cpf");
      if (op.falhaDoc === doc) return { ok: false, status: 500, json: async () => ({}) };
      const total = (op.totais || {})[doc] || 0;
      const tam = op.paginaMax ? Math.min(Number(q.get("size")), op.paginaMax) : Number(q.get("size"));
      const pg = Number(q.get("page"));
      const todos = Array.from({ length: total }, (_, i) => atoSP(i));
      const content = todos.slice(pg * tam, pg * tam + tam);
      return { ok: true, status: 200, json: async () => ({ content, totalElements: total, totalPages: Math.ceil(total / tam), size: tam, number: pg, last: (pg + 1) * tam >= total }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  w.CratosFaixa = { mostrar: (m, t) => faixas.push(String(t)), parar() {} };
  w.CratosOverlay = { mostrar() {}, esconder() {} };
  w.console.log = () => {}; w.console.warn = () => {}; w.console.error = () => {};
  w.eval(ler("comum/storage.js"));
  if (existe("comum/periodo.js")) w.eval(ler("comum/periodo.js"));
  if (existe("conteudo/signo-api.js")) w.eval(ler("conteudo/signo-api.js"));
  if (op.capturar) {                               // o app chamando o backend com o token
    const x = new w.XMLHttpRequest();
    x.open("GET", "https://backend.signo.org.br/api/ato/consultas-internas/cache");
    x.setRequestHeader("Authorization", op.capturar);
  }
  if (op.antes) op.antes(w);
  if (existe("conteudo/signo.js")) w.eval(ler("conteudo/signo.js"));
  return { w, mem, msgs, faixas, pedidos };
}
const pedido = (partes) => ({ "cratos:canp_estado": { ativo: true, fase: "aguardando", pedidoEm: new Date().toISOString(), partes, periodo: PER } });

(async () => {
  /* ── 1. o grampo ── */
  {
    const t = montar({ capturar: TOKEN, totais: { "11222333000181": 350 }, paginaMax: 100 });
    let resp = null;
    t.w.addEventListener("cratos:signo:resultado", (ev) => { resp = JSON.parse(ev.detail); });
    t.w.dispatchEvent(new t.w.CustomEvent("cratos:signo:consultar", { detail: JSON.stringify({ reqId: "r1", doc: "11222333000181", inicio: PER.inicio, fim: PER.fim, limite: 300 }) }));
    await ate(() => resp, 3000);
    const p0 = t.pedidos.find((p) => /listar-atos/.test(p.url));
    const q = p0 ? new URL(p0.url).searchParams : new URLSearchParams();
    checar(p0 && /^https:\/\/backend\.signo\.org\.br\/api\/ato\/consultas-internas\/listar-atos\?/.test(p0.url) &&
      q.getAll("centrais").join() === "8" && q.get("cpf") === "11222333000181" && q.get("uf") === "35" && q.get("buscaExata") === "1" &&
      q.get("dataInicial") === PER.inicio && q.get("dataFinal") === PER.fim && q.getAll("periodoAto").join() === "2016-11-24T03:00:00.000Z,2026-11-23T03:00:00.000Z" &&
      q.get("size") === "300" && q.get("page") === "0",
      "⛔ consulta: central 8 (escrituras e procurações), o CPF/CNPJ e o período, como a tela do Signo envia");
    checar(p0 && p0.headers.Authorization === TOKEN && p0.headers.Front === "SignoFront", "com o token do próprio app e o \"Front: SignoFront\"");
    checar(resp && resp.ok && resp.total === 350 && resp.atos.length === 300 && t.pedidos.filter((p) => /listar-atos/.test(p.url)).length === 3,
      "⛔ o servidor devolve páginas menores: segue página a página até 300 (total exato: 350)");
    checar(resp && !JSON.stringify(resp).includes(TOKEN.split(".")[1]) && !("status" in resp.atos[0]),
      "o token NÃO sai do contexto da página; os atos vão enxutos");
  }
  {
    const t = montar({});
    let resp = null;
    t.w.addEventListener("cratos:signo:resultado", (ev) => { resp = JSON.parse(ev.detail); });
    t.w.dispatchEvent(new t.w.CustomEvent("cratos:signo:consultar", { detail: JSON.stringify({ reqId: "r2", doc: "11222333000181", inicio: PER.inicio, fim: PER.fim }) }));
    await ate(() => resp, 2000);
    checar(resp && resp.ok === false && /sem login/.test(resp.motivo) && !t.pedidos.some((p) => /listar-atos/.test(p.url)),
      "sem token: \"sem login no Signo\", e nenhuma chamada sai");
    const t2 = montar({ sessao: TOKEN, totais: { "52998224725": 0 } });
    let r2 = null;
    t2.w.addEventListener("cratos:signo:resultado", (ev) => { r2 = JSON.parse(ev.detail); });
    t2.w.dispatchEvent(new t2.w.CustomEvent("cratos:signo:consultar", { detail: JSON.stringify({ reqId: "r3", doc: "52998224725", inicio: PER.inicio, fim: PER.fim }) }));
    await ate(() => r2, 2000);
    const vencido = montar({ sessao: JWT(-60) });
    let r3 = null;
    vencido.w.addEventListener("cratos:signo:resultado", (ev) => { r3 = JSON.parse(ev.detail); });
    vencido.w.dispatchEvent(new vencido.w.CustomEvent("cratos:signo:consultar", { detail: JSON.stringify({ reqId: "r4", doc: "52998224725", inicio: PER.inicio, fim: PER.fim }) }));
    await ate(() => r3, 2000);
    checar(r2 && r2.ok && r2.total === 0 && r3 && !r3.ok, "o app ainda não chamou nada: usa o token guardado na sessão — se ainda valer");
  }

  /* ── 2. login com certificado ── */
  const telaLogin = `<button id="cert">Ou acesse via certificado digital</button><button id="entrar">Entrar</button>`;
  const abrirModal = (n) => (w) => {
    w.document.getElementById("cert").addEventListener("click", () => {
      const dd = w.document.createElement("app-dropdown");
      const nomes = Array.from({ length: n }, (_, i) => `<span>FICTICIO ${i}:S00000${i} (CPF: 0000000000${i}) (Expira em: 10/11/2028)</span>`).join("");
      dd.innerHTML = `<div class="dropdown"><span class="placeholder">Selecione o certificado desejado</span></div><div class="options"></div>`;
      dd.querySelector(".dropdown").addEventListener("click", () => {
        dd.querySelector(".options").innerHTML = nomes;
        dd.querySelectorAll(".options span").forEach((s) => s.addEventListener("click", () => { dd.querySelector(".dropdown").classList.add("filled"); w.__escolhido = s.textContent; }));
      });
      w.document.body.appendChild(dd);
    });
    w.document.getElementById("entrar").addEventListener("click", () => { w.__entrou = true; });
  };
  {
    const t = montar({ hash: "#/login", html: telaLogin, mem: pedido([{ nome: "A", doc: "52998224725" }]), antes: abrirModal(1) });
    await ate(() => t.w.__escolhido, 6000);
    checar(t.faixas.some((f) => /entre no Signo com o seu certificado digital/.test(f)) && /FICTICIO 0/.test(t.w.__escolhido || ""),
      "⛔ sem login: avisa, abre a janela do certificado e deixa o ÚNICO certificado escolhido");
    await tick(1500);
    checar(!t.w.__entrou && !t.pedidos.some((p) => /listar-atos/.test(p.url)), "⛔ e NÃO clica em \"Entrar\" — o login (e o PIN) é da pessoa");
  }
  {
    const t = montar({ hash: "#/login", html: telaLogin, mem: pedido([{ nome: "A", doc: "52998224725" }]), antes: abrirModal(2) });
    await tick(3500);
    checar(t.w.document.querySelector("app-dropdown") && !t.w.__escolhido && !t.w.__entrou, "dois certificados: abre a lista, mas a escolha é da pessoa");
  }

  /* ── 3. o fluxo ── */
  {
    const partes = [{ nome: "A", doc: "52998224725" }, { nome: "B", doc: "11222333000181" }, { nome: "C", doc: "11144477735" }];
    const t = montar({ capturar: TOKEN, mem: pedido(partes), totais: { "52998224725": 0, "11222333000181": 5 }, falhaDoc: "11144477735" });
    await ate(() => (t.mem["cratos:canp_estado"] || {}).fase === "concluido", 6000);
    const est = t.mem["cratos:canp_estado"] || {};
    const res = est.resultados || {};
    checar(est.fase === "concluido" && res["52998224725"].ok && res["52998224725"].total === 0 && res["11222333000181"].total === 5 &&
      res["11222333000181"].atos.length === 5, "⛔ pedido do CENSEC: consulta cada parte e grava \"concluido\" com os resultados");
    checar(res["11144477735"] && res["11144477735"].ok === false && /500/.test(res["11144477735"].motivo || ""),
      "uma parte que falha volta com o motivo — as outras seguem");
    checar(t.msgs.some((m) => m && m.tipo === "canp_voltar") && !JSON.stringify(t.mem).includes(TOKEN.split(".")[1]),
      "volta ao CENSEC; o token não foi para o storage");
  }
  {
    const t = montar({ capturar: TOKEN, mem: { "cratos:canp_estado": { ativo: true, fase: "aguardando", pedidoEm: new Date(Date.now() - 31 * 60000).toISOString(), partes: [{ nome: "A", doc: "52998224725" }], periodo: PER } } });
    await tick(1500);
    checar(!t.pedidos.some((p) => /listar-atos/.test(p.url)), "pedido velho (mais de 30 min) é ignorado");
  }

  /* ── 4. fundo e manifest ── */
  {
    const bg = ler("background.js");
    checar(/case "canp_abrir":\s*\n\s*if \(!sender \|\| !sender\.tab \|\| !\/\^https:\\\/\\\/\(\[a-z0-9-\]\+\\\.\)\*censec\\\.org\\\.br/.test(bg) &&
      /case "canp_voltar":\s*\n\s*if \(!sender \|\| !sender\.tab \|\| !\/\^https:\\\/\\\/www\\\.signo\\\.org\\\.br/.test(bg),
      "fundo: só o CENSEC pede o Signo; só o Signo devolve o foco");
    checar(/async function abrirSigno\(\)[\s\S]{0,200}"https:\/\/www\.signo\.org\.br\/#\/interno\/consultas-internas"/.test(bg), "abre direto em Consultar Atos");
    /* 1.9.8 (Rodrigo, 23/11): terminada a CANP, fecha a aba do Signo — sempre */
    const ini = bg.indexOf("async function voltarAoCensec(");
    const ops = [];
    if (ini >= 0) {
      const fim = bg.indexOf("\n}\n", ini) + 3;
      const browser = { tabs: {
        query: async () => [{ id: 7 }],
        update: async (id, o) => { ops.push(["foco", id, o.active]); },
        remove: async (id) => { ops.push(["fecha", id]); },
      } };
      await new Function("browser", bg.slice(ini, fim) + "\nreturn voltarAoCensec;")(browser)(42);
    }
    checar(JSON.stringify(ops) === JSON.stringify([["foco", 7, true], ["fecha", 42]]) &&
      /case "canp_voltar":[\s\S]{0,200}return voltarAoCensec\(sender\.tab\.id\)/.test(bg),
      "⛔ terminada a CANP: foco no CENSEC e a aba do Signo é FECHADA (a que pediu a volta)");
    const sig = ler("conteudo/signo.js");
    checar(sig.indexOf('tipo: "canp_voltar"') > sig.indexOf('fase: "concluido"') && !/fase: "erro"[\s\S]{0,300}canp_voltar/.test(sig),
      "só no sucesso: se a CANP falha, a aba do Signo fica aberta");
    const man = JSON.parse(ler("manifest.json"));
    const cs = (man.content_scripts || []).find((c) => (c.js || []).includes("conteudo/signo.js")) || {};
    checar((man.permissions || []).includes("https://www.signo.org.br/*") && !(man.permissions || []).some((p) => /backend\.signo/.test(p)) &&
      (cs.matches || []).join() === "https://www.signo.org.br/*" && (man.web_accessible_resources || []).includes("conteudo/signo-api.js"),
      "manifest: só www.signo.org.br (as chamadas ao backend saem da página)");
  }

  console.log(`\n=== ${NOME} ===`);
  oks.forEach((d) => console.log("  ok   " + d));
  falhas.forEach((d) => console.log("  FALHA " + d));
  console.log(`\n${oks.length} passaram, ${falhas.length} falharam (${oks.length + falhas.length} asserções)\n`);
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.log("FALHA geral: " + e.stack); process.exit(1); });
