/*
 * teste-seguranca-html.js — 1.5.5: ESCAPE de todo dado externo que vai para HTML.
 *
 * Origem: análise da Divisão de Segurança Cibernética (chamado 35323), que pediu
 * garantia de escape em todo dado externo inserido via innerHTML. Dados FICTÍCIOS.
 *
 * O que se trava aqui:
 *  A. O helper único CratosHTML (comum/storage.js): escapa tudo, só fragmento html``
 *     entra cru, array junta, marcacaoLimitada só deixa <b>/<i>/<br> sem atributo.
 *  B. ⛔ PAINEL: nome, POLO e documento da parte (PJe), dados da caixa postal da
 *     Receita (nº da solicitação, processo, data), pendências/falhas da colheita,
 *     certidões do diário, erro do PJe na juntada, relatório e progresso da fila —
 *     tudo aparece como TEXTO, nenhum elemento é injetado.
 *  C. ⛔ PREFERÊNCIAS: valor salvo com HTML volta intacto no campo (e é salvo de novo
 *     igual); aviso de módulo mantém <b> mas não aceita <img onerror>.
 *  D. ⛔ POPUPS: SerasaJUD (valor do cálculo) e SAB (data do cálculo, motivo, valor).
 *  E. Sem escape duplo: o texto na tela não mostra "&lt;", "&amp;" etc.
 *  F. ⛔ VARREDURA ESTÁTICA de src/: nenhuma atribuição a innerHTML monta HTML com
 *     interpolação ou concatenação fora de html`` — protege também o código NOVO
 *     (CCS, SNIPER, PREVJUD): se alguém esquecer, esta suíte reprova.
 *
 * Rodar: node teste-seguranca-html.js
 * Versão antiga (tem de REPROVAR): CRATOS_SRC=<pasta do xpi 1.5.4> node teste-seguranca-html.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const falhas = [];
const oks = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 40));
const ler = (...p) => fs.readFileSync(path.join(SRC, ...p), "utf8");

/* Cargas (fictícias). Cada uma tenta criar elemento ativo se entrar como HTML. */
const P1 = '<img src=x onerror="window.__xss=1">FULANO & CIA';
const P2 = '"><svg onload="window.__xss=2"></svg><b>POLO</b>';
const P3 = "<script>window.__xss=3</script>'aspas'";

function injetado(raiz) {
  return raiz.querySelectorAll("script, svg[onload], [onerror], [onload], iframe, img[src='x']").length;
}
function escapeDuplo(texto) {
  return /&(lt|gt|amp|quot|#39|#96);/.test(texto || "");
}

/* ── A. helper ─────────────────────────────────────────────────────────────── */
function secaoHelper() {
  const dom = new JSDOM("<!doctype html><body><div id=a></div></body>", { runScripts: "outside-only" });
  const w = dom.window;
  w.browser = { storage: { local: {}, onChanged: { addListener() {} } } };
  w.eval(ler("comum", "storage.js"));
  const H = w.CratosHTML;
  if (!H || typeof H.html !== "function") {
    checar(false, "⛔ comum/storage.js não tem o helper CratosHTML (html``/esc/definir)");
    return;
  }
  const { html, esc, marcacaoLimitada, confiavel, definir } = H;
  checar(esc(`<>&"'\``) === "&lt;&gt;&amp;&quot;&#39;&#96;", "esc() escapa < > & \" ' e crase");
  checar(esc(0) === "0" && esc(null) === "" && esc(undefined) === "", "esc(): 0 vira \"0\" (o antigo virava vazio); null/undefined viram vazio");
  const a = w.document.getElementById("a");
  a.innerHTML = html`<b>${P1}</b>`;
  checar(injetado(a) === 0 && a.querySelector("b").textContent === P1, "⛔ html``: interpolação entra como TEXTO");
  const linhas = [P1, P2].map((t) => html`<li>${t}</li>`);
  a.innerHTML = html`<ul>${linhas}</ul>`;
  checar(a.querySelectorAll("li").length === 2 && injetado(a) === 0, "html``: fragmentos html`` entram crus; array é juntado");
  a.innerHTML = html`${null}${false}${undefined}x`;
  checar(a.innerHTML === "x", "html``: null/false/undefined não imprimem nada");
  a.innerHTML = marcacaoLimitada("<b>ok</b><br/><img src=x onerror=1><b onclick=1>z</b>");
  checar(a.querySelectorAll("b").length === 1 && a.querySelectorAll("br").length === 1 && injetado(a) === 0 &&
    !a.querySelector("[onclick]"), "⛔ marcacaoLimitada: só <b>/<br> sem atributo; <img onerror> e <b onclick> viram texto");
  definir(a, P2);
  checar(injetado(a) === 0 && a.textContent === P2, "⛔ definir(el, textoSolto) escreve como TEXTO (seguro por padrão)");
  definir(a, confiavel("<i>c</i>"));
  checar(a.querySelectorAll("i").length === 1, "definir(el, confiavel(...)) mantém HTML de constante do código");
}

/* ── B. painel ─────────────────────────────────────────────────────────────── */
function montarPainel(respostas, extra) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://pje.trt18.jus.br/pjekz/processo/1/detalhe", runScripts: "outside-only", pretendToBeVisual: true,
  });
  const w = dom.window;
  const mem = { "cratos:config": { infojud: { colheitaAutomatica: "nao" }, juntada: { automatica: "nao" } } };
  w.browser = {
    storage: {
      local: {
        get: async (k) => (k == null ? Object.assign({}, mem) : { [k]: mem[k] }),
        set: async (o) => Object.assign(mem, o),
        remove: async (k) => { delete mem[k]; },
      },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
    runtime: {
      getURL: (p) => p,
      getManifest: () => ({ version: "teste" }),
      onMessage: { addListener: () => {}, removeListener: () => {} },
      sendMessage: async (m) => (respostas[m && m.tipo] ? respostas[m.tipo](m) : { ok: true }),
    },
  };
  if (extra && extra.fetch) w.fetch = extra.fetch;
  w.console.log = () => {}; w.console.warn = () => {}; w.console.error = () => {}; w.console.debug = () => {};
  w.eval(ler("comum", "storage.js"));
  w.eval(ler("comum", "relatorio.js"));
  w.eval(ler("comum", "faixa.js"));
  w.eval(ler("conteudo", "painel.js"));
  return { w, P: w.__cratosPainel };
}

async function secaoPainel() {
  const respostas = {
    coletar_achar: async () => ({
      ok: true, totalCasadas: 2, naoLidas: 1,
      solicitacao: { numSolicitacao: P1, numProcesso: P2, dataEnvio: P3, lida: false },
    }),
    coletar_tudo: async () => ({ ok: true, colhidos: 1, total: 2, mensagens: 1, pendentes: [P1], falhas: [P2] }),
    diario_ler: async () => ({ certidoes: [{ titulo: P1, convenios: [P2], arquivos: ["a.pdf"], tipo: "realizados" }] }),
  };
  /* O PJe devolve erro com texto do servidor; a juntada mostra a mensagem. */
  const fetch = async () => { throw new Error(P3); };
  const { w, P } = montarPainel(respostas, { fetch });
  if (!P || typeof P.renderProcesso !== "function") { checar(false, "painel sem o gancho __cratosPainel.renderProcesso"); return; }
  const corpo = P.corpo;

  P.renderProcesso({ id: 1, numero: "0000001-11.2024.5.18.0001",
    partes: [{ nome: P1, polo: P2, cpfcnpj: "<b>123</b>" }] });
  checar(injetado(corpo) === 0, "⛔ painel/partes: nome, polo e documento maliciosos NÃO injetam elemento");
  checar(corpo.querySelector(".cx-nome").textContent === P1, "painel/partes: o nome aparece literal, como texto");
  checar(corpo.querySelector(".cx-polo").textContent === P2 && !corpo.querySelector(".cx-polo b"),
    "⛔ painel/partes: o POLO (vinha cru na 1.5.4) aparece como texto");
  checar(corpo.querySelector(".cx-doc").textContent === "<b>123</b>", "⛔ painel/partes: documento fora do padrão aparece como texto");
  checar(!escapeDuplo(corpo.textContent), "painel/partes: sem escape duplo no texto");

  P.renderProcesso({ id: 1, numero: P1, partes: [] });
  checar(injetado(corpo) === 0 && corpo.textContent.includes(P1), "painel: número do processo sem partes aparece como texto");

  /* caixa postal da Receita */
  P.renderProcesso({ id: 1, numero: "0000001-11.2024.5.18.0001", partes: [{ nome: "PARTE", polo: "PASSIVO", cpfcnpj: "12345678909" }] });
  corpo.querySelector("#cx-localizar").onclick();
  await tick();
  const st = corpo.querySelector("#cx-status");
  checar(injetado(st) === 0 && st.textContent.includes(P1) && st.textContent.includes(P2) && st.textContent.includes(P3),
    "⛔ caixa postal: nº da solicitação, processo e data (vinham crus na 1.5.4) aparecem como texto");
  checar(!escapeDuplo(st.textContent), "caixa postal: sem escape duplo");
  const bColher = corpo.querySelector("#cx-colher");
  if (bColher) { bColher.onclick(); await tick(); }
  const cs = corpo.querySelector("#cx-colher-status");
  checar(cs && injetado(cs) === 0 && cs.textContent.includes(P1) && cs.textContent.includes(P2),
    "⛔ colheita: pendências e falhas aparecem como texto");

  /* juntada: lista do diário + erro devolvido pelo PJe */
  corpo.querySelector("#cx-juntar").onclick();
  await tick();
  const js = corpo.querySelector("#cx-juntar-status");
  checar(injetado(js) === 0 && js.textContent.includes(P1) && js.textContent.includes(P2),
    "⛔ juntada: título e convênios da certidão aparecem como texto");
  const bCriar = js.querySelector("[data-cert]");
  if (bCriar) { bCriar.onclick(); await tick(120); }
  const js2 = corpo.querySelector("#cx-juntar-status");
  checar(js2 && injetado(js2) === 0 && js2.textContent.includes("window.__xss=3"),
    "⛔ juntada: mensagem de erro do PJe aparece como texto");

  /* relatório de fim de fila e progresso */
  corpo.innerHTML = '<div id="cx-progresso"></div>';
  P.ledger = [{ id: "X", label: P1, status: "erro", detalhe: P2 }];
  P.renderRelatorioFinal();
  P.fila = [{ id: "SAB", label: P3 }];
  const prog = corpo.querySelector("#cx-progresso");
  checar(injetado(prog) === 0 && prog.textContent.includes(P1) && prog.textContent.includes(P2),
    "relatório de fim de fila: rótulo e detalhe como texto");
  P.renderProgresso();
  checar(injetado(corpo) === 0 && corpo.textContent.includes(P3), "progresso da fila: rótulo como texto");
  checar(w.__xss === undefined, "⛔ nenhuma carga executou no painel");
}

/* ── C. preferências ───────────────────────────────────────────────────────── */
async function secaoOpcoes() {
  const htmlTela = ler("opcoes", "opcoes.html");
  const dom = new JSDOM(htmlTela, { url: "moz-extension://x/opcoes/opcoes.html", runScripts: "outside-only" });
  const w = dom.window;
  const mem = { "cratos:config": { teste: { campoTexto: P2, campoNum: 3 } } };
  const mod = {
    nome: "teste", rotulo: "Módulo <i>teste</i>", requer: [],
    config: {
      campoTexto: { tipo: "texto", padrao: "", rotulo: "Texto livre" },
      campoNum: { tipo: "numero", padrao: 1, rotulo: "Número" },
      escolhaX: { tipo: "lista", padrao: "", rotulo: "Lista", opcoes: [{ valor: "1", rotulo: P1 }] },
      aviso1: { tipo: "aviso", rotulo: "Atenção", itens: ["<b>negrito ok</b> <img src=x onerror=\"window.__xss=4\">"] },
    },
  };
  w.browser = {
    storage: {
      local: { get: async (k) => ({ [k]: mem[k] }), set: async (o) => Object.assign(mem, o), remove: async () => {} },
      onChanged: { addListener: () => {} },
    },
    runtime: {
      sendMessage: async (m) => (m && m.tipo === "catalogo" ? { modulos: [mod] } : { ok: true }),
      onMessage: { addListener: () => {} }, getManifest: () => ({ version: "teste" }), getURL: (p) => p,
    },
  };
  w.console.log = () => {}; w.console.warn = () => {}; w.console.error = () => {};
  w.eval(ler("comum", "storage.js"));
  w.eval(ler("opcoes", "opcoes.js"));
  await tick(120);
  const alvo = w.document.getElementById("modulos");
  const inp = w.document.querySelector('input[data-chave="campoTexto"]');
  checar(!!inp && inp.value === P2, "⛔ opções: valor salvo com aspas e HTML volta INTACTO no campo (antes quebrava o atributo)");
  checar(injetado(alvo) === 0, "⛔ opções: nenhum elemento injetado pelo valor salvo, pelo rótulo ou pela lista");
  const sel = w.document.querySelector('select[data-chave="escolhaX"]');
  checar(sel && sel.options[1] && sel.options[1].textContent === P1, "opções: rótulo da lista aparece como texto");
  const aviso = Array.from(alvo.querySelectorAll("li")).find((li) => /negrito ok/.test(li.textContent));
  checar(aviso && aviso.querySelector("b") && aviso.querySelector("b").textContent === "negrito ok" && !aviso.querySelector("img"),
    "⛔ opções/aviso: mantém o <b> do módulo, mas <img onerror> vira texto");
  const salvar = w.document.getElementById("cx-salvar");
  if (salvar) { await salvar.onclick(); await tick(); }
  checar(mem["cratos:config"].teste && mem["cratos:config"].teste.campoTexto === P2,
    "opções: salvar de novo grava o MESMO valor (escape não corrompe o dado)");
  checar(w.__xss === undefined, "⛔ nenhuma carga executou nas opções");
}

/* ── D. popups ─────────────────────────────────────────────────────────────── */
async function secaoPopups() {
  /* SerasaJUD */
  {
    const dom = new JSDOM("<!doctype html><html><body></body></html>",
      { url: "https://serasa-judicial.serasaexperian.com.br/cadastrar-ordem", runScripts: "outside-only" });
    const w = dom.window;
    w.browser = {
      storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
      runtime: { sendMessage: async () => ({ ok: true }), onMessage: { addListener() {} }, getURL: (p) => p },
      downloads: { download: async () => 1 },
    };
    w.CratosFaixa = { parar() {}, alertar() {}, dizer() {}, mostrar() {} };
    w.console.log = () => {}; w.console.warn = () => {}; w.console.error = () => {};
    w.eval(ler("comum", "storage.js"));
    w.eval(ler("conteudo", "serasajud.js"));
    const api = w.__cratosSerasajud || {};
    if (typeof api.mostrarPopupValorData !== "function") {
      checar(false, "SerasaJUD sem o gancho mostrarPopupValorData");
    } else {
      const pr = api.mostrarPopupValorData({ operacao: "inclusao", pedirValor: false, pedirData: true, valorAtual: P1 });
      const pop = w.document.getElementById("cratos-serasajud-popup");
      checar(pop && injetado(pop) === 0 && pop.textContent.includes(P1),
        "⛔ SerasaJUD/popup: valor do cálculo aparece como texto");
      checar(pop && !escapeDuplo(pop.textContent), "SerasaJUD/popup: sem escape duplo");
      const c = w.document.getElementById("cratos-sj-cancelar"); if (c) c.onclick();
      await pr;
    }
  }
  /* SAB */
  {
    const dom = new JSDOM("<!doctype html><html><body></body></html>",
      { url: "https://pje.trt18.jus.br/sab/determinacoes/999", runScripts: "outside-only" });
    const w = dom.window;
    w.browser = {
      storage: { local: { get: async (k) => ({ [k]: undefined }), set: async () => {}, remove: async () => {} }, onChanged: { addListener() {} } },
      runtime: { sendMessage: async () => ({ ok: true }), onMessage: { addListener() {} }, getURL: (p) => p },
    };
    w.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => "" });
    w.console.log = () => {}; w.console.warn = () => {}; w.console.debug = () => {}; w.console.error = () => {};
    w.eval(ler("comum", "storage.js"));
    w.eval(ler("comum", "relatorio.js"));
    w.eval(ler("comum", "faixa.js"));
    w.eval(ler("conteudo", "sab.js"));
    const api = w.__cratosSab || {};
    if (typeof api.mostrarPopupConfirmacao !== "function") {
      checar(false, "SAB sem o gancho mostrarPopupConfirmacao (exposto na 1.5.5 para este teste)");
    } else {
      const pr = api.mostrarPopupConfirmacao(
        { valorFormatado: "R$ " + P2, dataFormatada: P1 }, { ok: false, motivo: P3 });
      const pop = w.document.getElementById("cratos-sab-popup");
      checar(pop && injetado(pop) === 0 && pop.textContent.includes(P1) && pop.textContent.includes("window.__xss=3"),
        "⛔ SAB/popup: data do cálculo (vinha crua na 1.5.4) e motivo aparecem como texto");
      const inp = w.document.getElementById("cratos-sab-valor");
      checar(inp && inp.value === P2, "SAB/popup: valor com aspas volta intacto no campo");
      const pular = w.document.getElementById("cratos-sab-pular"); if (pular) pular.onclick();
      await Promise.race([pr, tick(50)]);
    }
  }
}

/* ── F. varredura estática ─────────────────────────────────────────────────── */
/* Regra (a mesma do addons-linter da Mozilla, que NÃO aceita função de escape):
   `x.innerHTML = …` só com LITERAL fixo ("", '...', `...` sem ${} e sem +).
   HTML com dado vai por CratosHTML.definir(el, html`…`) — o único ponto de
   escrita, que monta os nós por DOMParser.
   insertAdjacentHTML / document.write / outerHTML: proibidos. */
function lerLiteral(s, i) {
  const q = s[i];
  let j = i + 1;
  let temInterp = false;
  while (j < s.length) {
    const c = s[j];
    if (c === "\\") { j += 2; continue; }
    if (q === "`" && c === "$" && s[j + 1] === "{") temInterp = true;
    if (c === q) return { fim: j + 1, temInterp };
    j++;
  }
  return { fim: s.length, temInterp };
}
function varrer(raiz) {
  const problemas = [];
  const arquivos = [];
  (function andar(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) andar(p);
      else if (/\.js$/.test(n)) arquivos.push(p);
    }
  })(raiz);
  for (const arq of arquivos) {
    const s = fs.readFileSync(arq, "utf8");
    const rel = path.relative(raiz, arq);
    const linha = (i) => s.slice(0, i).split("\n").length;
    for (const m of s.matchAll(/\.(insertAdjacentHTML|outerHTML\s*=(?!=)|write)\b/g)) {
      if (m[1] === "write" && !/document\s*$/.test(s.slice(0, m.index))) continue;   // só document.write
      problemas.push(`${rel}:${linha(m.index)} usa ${m[1].replace(/\s*=$/, "")}`);
    }
    for (const m of s.matchAll(/\.innerHTML\s*=(?!=)\s*/g)) {
      const i = m.index + m[0].length;
      const resto = s.slice(i, i + 40);
      if (/^["'`]/.test(resto)) {
        const lit = lerLiteral(s, i);
        const depois = s.slice(lit.fim).match(/^\s*(\S)/);
        const seguinte = depois ? depois[1] : ";";
        if (!lit.temInterp && seguinte !== "+") continue;
        problemas.push(`${rel}:${linha(m.index)} innerHTML com ${lit.temInterp ? "interpolação" : "concatenação"} — use CratosHTML.definir(el, html\`…\`)`);
        continue;
      }
      problemas.push(`${rel}:${linha(m.index)} innerHTML recebe expressão (${resto.split("\n")[0].trim().slice(0, 30)}…) — use CratosHTML.definir(el, html\`…\`)`);
    }
  }
  return problemas;
}
function secaoVarredura() {
  /* O próprio scanner tem de pegar o erro clássico — senão ele não prova nada. */
  const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "cratos-varre-"));
  fs.writeFileSync(path.join(tmp, "ruim.js"),
    "a.innerHTML = `<b>${x}</b>`;\nb.innerHTML = '<i>' + y;\nc.innerHTML = z;\nd.insertAdjacentHTML('beforeend', w);\n" +
    "e.innerHTML = html`<b>${ok}</b>`;\nf.innerHTML = \"\";\ng.innerHTML = `<p>fixo</p>`;\nh.innerHTML == q;\n" +
    "CratosHTML.definir(i, html`<b>${ok}</b>`);\n");
  const probTmp = varrer(tmp);
  fs.rmSync(tmp, { recursive: true, force: true });
  checar(probTmp.length === 5, "a varredura pega interpolação, concatenação, variável, html`` direto no innerHTML e " +
    `insertAdjacentHTML (e aceita literal fixo e definir()) [achou ${probTmp.length} de 5]`);

  const prob = varrer(SRC);
  checar(prob.length === 0, "⛔ varredura de src/: innerHTML só com literal fixo; HTML com dado só por CratosHTML.definir(html``)" +
    (prob.length ? "\n         " + prob.join("\n         ") : ""));
}

(async () => {
  for (const [nome, f] of [["helper", secaoHelper], ["painel", secaoPainel], ["opções", secaoOpcoes],
                           ["popups", secaoPopups], ["varredura", secaoVarredura]]) {
    try { await f(); } catch (e) { checar(false, `seção ${nome} quebrou: ${e.message}`); }
  }
  console.log("\n=== teste-seguranca-html.js ===");
  oks.forEach((d) => console.log("  ok   " + d));
  falhas.forEach((d) => console.log("  FALHA " + d));
  console.log(`\n${oks.length} passaram, ${falhas.length} falharam (${oks.length + falhas.length} asserções)\n`);
  process.exit(falhas.length ? 1 : 0);
})();
