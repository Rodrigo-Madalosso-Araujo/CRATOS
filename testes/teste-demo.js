/*
 * teste-demo.js — o modo de demonstração (2.0, passo 6).
 *
 * Trava: a página demo/demo.html (da própria extensão) carrega o painel.js DE
 * VERDADE com um `browser` simulado; o fundo real, o storage da pessoa e a rede
 * NUNCA são tocados (só a leitura do tema e, a pedido, abrir as Preferências); a
 * Situação, a fila e as coletas funcionam com dados fictícios; juntar só avisa que
 * é demonstração; o atalho chega pela mensagem do fundo; se não der para isolar o
 * `browser`, o painel não é carregado; a lista de scripts é a mesma do content
 * script do PJe; o menu "⋯" abre a demonstração e o fundo cria a aba.
 * Reprova o 67dcfa4 (passo 5) e a 1.9.6.
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const NOME = "teste-demo.js";
const oks = [], falhas = [];
const checar = (c, d) => (c ? oks : falhas).push(d);
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 30));
const espera = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 4000)) { if (fn()) return true; await tick(20); } return false; };
const HTML = path.join(SRC, "demo", "demo.html");

async function abrir(op) {
  const o = op || {};
  const real = { set: 0, get: [], msgs: 0, fetch: 0, opcoes: 0, ouvinte: null };
  const dom = new JSDOM(fs.readFileSync(HTML, "utf8"), {
    url: "file://" + HTML + "?idProcesso=1",
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true,
    beforeParse(w) {
      for (const k of ["log", "warn", "error", "debug"]) w.console[k] = () => {};
      const browserReal = {
        storage: { local: {
          get: async (k) => { real.get.push(k); return { "cratos:aparencia": { tema: "claro" } }; },
          set: async () => { real.set++; }, remove: async () => { real.set++; },
        }, onChanged: { addListener: () => {} } },
        runtime: {
          getURL: (p) => "moz-extension://abc/" + p, getManifest: () => ({ version: "1.99.1" }),
          sendMessage: async () => { real.msgs++; return { ok: true }; },
          onMessage: { addListener: (f) => { real.ouvinte = f; } },
          openOptionsPage: async () => { real.opcoes++; },
        },
      };
      if (o.naoIsola) Object.defineProperty(w, "browser", { get: () => browserReal, configurable: false });
      else w.browser = browserReal;
      w.fetch = async () => { real.fetch++; throw new Error("rede"); };
    },
  });
  const w = dom.window;
  await espera(() => o.naoIsola || !!w.__cratosPainel, 6000);
  return { w, d: w.document, real, P: w.__cratosPainel, r: w.__cratosPainel && w.__cratosPainel.raiz };
}

(async () => {
  if (!fs.existsSync(HTML)) {
    checar(false, "⛔ a versão tem o modo de demonstração (demo/demo.html)");
    throw new Error("sem demonstração nesta versão");
  }

  /* ── 1. a página ──────────────────────────────────────────────────────── */
  {
    const html = fs.readFileSync(HTML, "utf8");
    checar(/<html lang="pt-BR">/.test(html) && /<title>CRATOS — modo de demonstração<\/title>/.test(html) && /<h1>/.test(html) && /<main/.test(html),
      "página com idioma, título, h1 e main");
    checar(/fictícios/.test(html) && /Nada sai desta página/.test(html), "a faixa do topo diz que tudo é fictício e nada sai");
    const scripts = html.match(/<script[^>]*>/g) || [];
    checar(scripts.length === 1 && /src="demo-simulado\.js"/.test(scripts[0]) && !/<script>\s*\S/.test(html), "⛔ sem script embutido (CSP da extensão): só demo-simulado.js");
  }

  /* ── 2. isolamento e carga ────────────────────────────────────────────── */
  const a = await abrir();
  checar(!!a.P && !!a.r, "⛔ o painel de verdade carrega na demonstração");
  checar(a.w.browser && a.w.browser.__cratosDemo === true, "o `browser` da página é o simulado");
  const man = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8"));
  const cs = man.content_scripts.find((c) => c.js.includes("conteudo/painel.js"));
  checar(a.w.__cratosDemo && JSON.stringify(a.w.__cratosDemo.SCRIPTS) === JSON.stringify(cs.js), "⛔ os mesmos scripts, na mesma ordem, do content script do PJe");

  /* ── 3. Situação, fila, coletas ───────────────────────────────────────── */
  a.P.abrirPorAtalho();
  await espera(() => a.r.querySelectorAll("#cx-p-situacao .cx-sit").length > 0, 6000);
  const selo = (id) => { const l = a.r.querySelector(`#cx-p-situacao .cx-sit[data-conv-id="${id}"] .cx-chip`); return l ? l.textContent.trim() : ""; };
  checar(selo("SAB") === "1 para juntar" && selo("INFOJUD") === "configuração pendente" && selo("CNIB") === "incluído" && selo("CCS") === "juntado" && selo("CENSEC") === "sem registro do CRATOS",
    "⛔ a Situação mostra estados variados (para juntar, pendente, incluído, juntado, sem registro)");
  checar(a.r.querySelector("cratos-painel").classList.contains("t-claro"), "abre no tema que a pessoa escolheu (só leitura)");
  a.P.irAba("incluir");
  const p = a.r.getElementById("cx-p-incluir");
  for (const id of ["INFOJUD", "RENAJUD"]) p.querySelector(`.cx-sel-conv[data-id="${id}"]`).checked = true;
  p.querySelector("#cx-executar-selecionados").click();
  checar(await espera(() => /2 convênio\(s\): 2 concluído\(s\)/.test(p.textContent), 10000), "⛔ a fila anda sozinha até o fim (automático e interativo)");
  checar(await espera(() => !!p.querySelector("[data-cert-auto]"), 3000), "no fim, oferece \"Criar no processo\"");
  p.querySelector("[data-cert-auto]").click();
  checar(await espera(() => /modo de demonstração: nada é juntado/.test(p.textContent), 3000), "⛔ \"Criar no processo\" só avisa que é demonstração");
  a.P.irAba("coletar");
  a.r.getElementById("cx-coletar-ccs").click();
  checar(await espera(() => /Requisição 2026000123/.test(a.r.getElementById("cx-ccs-status").textContent), 4000), "Coletar CCS devolve uma resposta fictícia");

  /* ── 4. nada do de verdade ────────────────────────────────────────────── */
  checar(a.real.set === 0, "⛔ o storage da pessoa nunca é escrito");
  checar(a.real.get.every((k) => k === "cratos:aparencia"), "do storage da pessoa, só o tema é lido");
  checar(a.real.msgs === 0, "⛔ nenhuma mensagem chega ao fundo de verdade");
  checar(a.real.fetch === 0, "⛔ a rede nunca é usada (o fetch de verdade não é chamado)");

  /* ── 5. menu, atalho e Preferências ───────────────────────────────────── */
  a.P.renderMenu();
  checar(!a.r.getElementById("cx-menu-demo"), "dentro da demonstração, o menu não oferece abrir outra");
  a.P.fecharPainel();
  checar(typeof a.real.ouvinte === "function", "a página ouve o fundo de verdade só para o atalho");
  const resp = await a.real.ouvinte({ tipo: "cratos_atalho" });
  checar(resp && resp.ok && a.r.querySelector("cratos-painel").hasAttribute("aberto"), "⛔ o atalho repassado pelo fundo abre o painel");
  checar(a.real.ouvinte({ tipo: "outra_coisa" }) === undefined, "outras mensagens do fundo são ignoradas");
  a.P.abrirMenu();
  a.r.getElementById("cx-menu-pref").click();
  await tick(30);
  checar(a.real.opcoes === 1 && a.real.msgs === 0, "Preferências: abre a página de verdade (sem mexer em dado)");

  /* ── 6. sem isolamento, não carrega ───────────────────────────────────── */
  {
    const b = await abrir({ naoIsola: true });
    await tick(200);
    checar(!b.w.__cratosPainel && !b.d.querySelector("cratos-raiz"), "⛔ sem conseguir isolar o `browser`, o painel NÃO carrega");
    const e = b.d.getElementById("demo-erro");
    checar(e && !e.hidden && /Não consegui isolar/.test(e.textContent) && e.getAttribute("role") === "alert", "e a página diz por quê (role=alert)");
  }

  /* ── 7. o caminho até a demonstração ──────────────────────────────────── */
  {
    const js = fs.readFileSync(path.join(SRC, "conteudo", "painel.js"), "utf8");
    checar(/id="cx-menu-demo"/.test(js) && /tipo: "abrir_demo"/.test(js), "o menu ⋯ do PJe oferece o modo de demonstração");
    const bg = fs.readFileSync(path.join(SRC, "background.js"), "utf8");
    checar(/case "abrir_demo":[\s\S]{0,160}tabs\.create\(\{ url: browser\.runtime\.getURL\("demo\/demo\.html\?idProcesso=1"\) \}\)/.test(bg), "o fundo abre demo/demo.html numa aba");
    checar(/getURL\("demo\/"\)[\s\S]{0,200}runtime\.sendMessage\(\{ tipo: "cratos_atalho" \}\)/.test(bg), "o fundo repassa o atalho para a página da demonstração");
    checar(!JSON.stringify(man.web_accessible_resources || []).includes("demo"), "a demonstração não fica exposta às páginas da web");
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
