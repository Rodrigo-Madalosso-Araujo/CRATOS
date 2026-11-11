/*
 * teste-primeiros-passos.js — 1.9.2: menus lidos das telas + página "Primeiros passos".
 * Pedido do Rodrigo (23/10 e 26/10). Dados 100% FICTÍCIOS (varas, órgãos e magistrados
 * inventados; o formato das listas é o do recon do RENAJUD de 26/10, só estrutura).
 *
 * Trava:
 *  1. INFOJUD: o menu de varas da tela de registro é lido (código sem os espaços do e-CAC,
 *     sem o "Selecione") e guardado; o pedido "Ler as varas do meu e-CAC" lê, avisa e
 *     pede para fechar a aba; sem pedido nem fila, a tela não é tocada.
 *  2. Limpeza: as listas (institucionais) sobrevivem à abertura do Firefox.
 *  3. RENAJUD: tribunal tirado do endereço do PJe; o grampo escuta só GET das listas;
 *     o content script guarda só NOMES (nunca o documento do magistrado) e só com tarefa;
 *     órgão/magistrado em branco são APRENDIDOS na primeira inclusão.
 *  4. Preferências: lista lida no lugar da do TRT18, com a data; escolha salva fora da
 *     lista é avisada (nunca troca sozinha); "Automático" no tribunal; nota do magistrado
 *     do INFOJUD; botões "Ler as varas" e "Primeiros passos"; a lista nova entra sem
 *     recarregar.
 *  5. Primeiros passos: abre só na instalação (não na atualização); passos com situação;
 *     salva MESCLANDO no config (a pasta vale para todos os convênios); nada abre sozinho.
 *  6. Painel: INFOJUD sem vara mostra o aviso com o link para os Primeiros passos.
 * Reprova a 1.9.1.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");
const { montarPainel } = require("./harness-painel.js");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const NOME = "teste-primeiros-passos.js";
const oks = [], falhas = [];
const checar = (c, d) => (c ? oks : falhas).push(d);
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 30));
const ler = (...p) => fs.readFileSync(path.join(SRC, ...p), "utf8");

if (!fs.existsSync(path.join(SRC, "primeiros", "primeiros.js"))) {
  console.log(`\n=== ${NOME} ===\n  FALHA  a versão em ${SRC} não tem os Primeiros passos (primeiros/primeiros.js).\n\n0 passaram — a suíte inteira reprova nesta versão.\n`);
  process.exit(1);
}

/* catálogo REAL dos módulos (o que o fundo devolve em "catalogo") */
function catalogoReal() {
  const mods = [];
  const ctx = { Registro: { adicionar: (m) => mods.push(m) }, console: { log() {}, warn() {}, error() {} },
    browser: { storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {} } },
      runtime: { onMessage: { addListener() {} }, sendMessage: async () => ({}) }, tabs: { onRemoved: { addListener() {} }, query: async () => [] } },
    setTimeout, clearTimeout, fetch: async () => ({}), URL, TextDecoder };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of ["comum/storage.js"].concat(fs.readdirSync(path.join(SRC, "modulos")).filter((f) => f !== "registro.js").map((f) => "modulos/" + f))) {
    try { vm.runInContext(ler(f), ctx, { filename: f }); } catch (e) { /* módulo que precisa do fundo inteiro */ }
  }
  return { mods: JSON.parse(JSON.stringify(mods)), ctx };
}

/* página de extensão (Preferências / Primeiros passos) com storage que avisa mudanças */
function paginaExtensao(corpoHtml, mem, catalogo) {
  const dom = new JSDOM(`<!doctype html><html><body>${corpoHtml}</body></html>`, { url: "moz-extension://x/p.html", runScripts: "outside-only" });
  const w = dom.window;
  const listeners = [], msgs = [];
  const dispara = (ch) => listeners.slice().forEach((l) => { try { l(ch, "local"); } catch (e) { /* nada */ } });
  w.browser = {
    storage: { local: {
      get: async (k) => ({ [k]: mem[k] === undefined ? undefined : JSON.parse(JSON.stringify(mem[k])) }),
      set: async (o) => { const ch = {}; for (const k of Object.keys(o)) { ch[k] = { oldValue: mem[k], newValue: o[k] }; mem[k] = JSON.parse(JSON.stringify(o[k])); } dispara(ch); },
      remove: async () => {},
    }, onChanged: { addListener: (f) => listeners.push(f), removeListener() {} } },
    runtime: {
      sendMessage: async (m) => { msgs.push(m); return m && m.tipo === "catalogo" ? { modulos: catalogo } : { ok: true }; },
      getManifest: () => ({ version: "1.9.2" }), getURL: (p) => p, openOptionsPage: () => msgs.push({ tipo: "__opcoes" }),
    },
    tabs: { create: async (o) => { msgs.push({ tipo: "__aba", url: o.url }); return { id: 9 }; } },
  };
  for (const k of ["log", "warn", "error", "debug"]) w.console[k] = () => {};
  return { w, d: w.document, mem, msgs, dispara };
}

(async () => {
  const { mods: CATALOGO } = catalogoReal();

  /* ── 1. INFOJUD: varas lidas da tela ───────────────────────────────────── */
  const TELA_REG = `<form><input name="processo"><select name="siglavara">
      <option value="">--- Selecione ---</option>
      <option value="001                 ">1ª VARA DO TRABALHO DE CIDADE FICTÍCIA</option>
      <option value="002                 ">2ª Vara do Trabalho de Cidade Fictícia</option>
      <option value="051                 ">Vara do Trabalho de Outra Cidade</option></select></form>`;
  function ecac(mem) {
    const dom = new JSDOM(`<!doctype html><html><body>${TELA_REG}</body></html>`,
      { url: "https://cav.receita.fazenda.gov.br/Servicos/ATSDR/Decjuiz/solicitacao.asp?cnpj=1", runScripts: "outside-only" });
    const w = dom.window, msgs = [], faixas = [];
    w.browser = { storage: { local: { get: async (k) => ({ [k]: mem[k] }), set: async (o) => Object.assign(mem, JSON.parse(JSON.stringify(o))), remove: async () => {} }, onChanged: { addListener() {} } },
      runtime: { sendMessage: async (m) => { msgs.push(m); return m.tipo === "ecac_pronto" ? { ok: !!mem["cratos:ecac_fila"], fila: mem["cratos:ecac_fila"] || null } : { ok: true }; },
        onMessage: { addListener() {} }, getURL: (p) => p } };
    w.CratosFaixa = { parar: (m, t) => faixas.push(["parar", t]), alertar: (m, t) => faixas.push(["alertar", t]), dizer: (m, t) => faixas.push(["dizer", t]), mostrar: (m, t) => faixas.push(["mostrar", t]) };
    for (const k of ["log", "warn", "error", "debug"]) w.console[k] = () => {};
    w.eval(ler("comum", "storage.js"));
    w.eval(ler("conteudo", "ecac-infojud.js"));
    return { w, msgs, faixas, mem };
  }
  {
    const t = ecac({ "cratos:infojud_ler_varas": { em: Date.now() } });
    await tick(4800);
    const l = t.mem["cratos:infojud_varas"];
    checar(l && l.opcoes.length === 3 && l.opcoes[0].valor === "001" && l.opcoes[0].rotulo === "001 — 1ª VARA DO TRABALHO DE CIDADE FICTÍCIA" &&
      !l.opcoes.some((o) => /selecione/i.test(o.rotulo)) && Number(l.em) > 0,
      "INFOJUD: o menu de varas da tela é guardado (código sem os espaços do e-CAC, sem o \"Selecione\", com a data)");
    checar(t.mem["cratos:infojud_ler_varas"] === null && t.msgs.some((m) => m.tipo === "fechar_esta_aba") &&
      t.faixas.some((f) => /lista de varas do e-CAC atualizada: 3 vara\(s\)/.test(f[1])),
      "\"Ler as varas do meu e-CAC\": lê, avisa na faixa e pede para fechar a aba");
    checar(!t.msgs.some((m) => m.tipo === "ecac_pronto"), "aba aberta só para ler as varas: não entra no registro");
  }
  {
    const t = ecac({});
    await tick(2500);
    checar(!t.msgs.some((m) => m.tipo === "fechar_esta_aba") && t.mem["cratos:infojud_varas"] && t.mem["cratos:infojud_varas"].opcoes.length === 3,
      "sem pedido: a lista é guardada mesmo assim (dado institucional), e a aba NÃO é fechada");
  }
  {
    const t = ecac({ "cratos:infojud_ler_varas": { em: Date.now() - 11 * 60 * 1000 } });
    await tick(4500);
    checar(!t.msgs.some((m) => m.tipo === "fechar_esta_aba"), "pedido de mais de 10 minutos atrás não vale (a aba não é fechada)");
  }
  {
    const ec = ler("conteudo", "ecac-infojud.js");
    const menu = ec.slice(ec.indexOf("if (/Decjuiz\\/principal\\.asp/i.test(url))"), ec.indexOf("if (!url.includes(\"solicitacao.asp\"))"));
    checar(/const pedidoVaras = !filaAtiva && \(await pedidoVarasAtivo\(\)\);\s*if \(!filaAtiva && !pedidoVaras\) return;/.test(menu) &&
      menu.indexOf("await souAbaDoRegistro()") > 0 && /if \(filaAtiva && !\(fila\.partes/.test(menu),
      "menu do serviço: sem fila, só entra em \"Registrar Solicitação\" com o pedido das varas, e só na aba aberta pelo CRATOS");
    const bg = ler("background.js");
    checar(/case "infojud_ler_varas":\s*return abrirEcacParaVaras\(\);/.test(bg) && /await Store\.set\("infojud_ler_varas", \{ em: Date\.now\(\) \}\);[\s\S]{0,200}await Store\.set\("ecac_aba", aba\.id\);/.test(bg) &&
      /if \(tabId == null \|\| !\/\^https:\\\/\\\/cav\\\.receita\\\.fazenda\\\.gov\\\.br\\\/\/\.test\(url\)\) return \{ ok: false \};/.test(bg),
      "fundo: abre o e-CAC marcando o pedido e a aba; \"fechar esta aba\" só vale para aba do e-CAC");
  }

  /* ── 2. limpeza ─────────────────────────────────────────────────────────── */
  {
    const { Limpeza, LIMPEZA_MANTER } = require(path.join(SRC, "modulos", "limpeza.js"));
    const mem = { "cratos:infojud_varas": { opcoes: [] }, "cratos:renajud_listas": {}, "cratos:diario:00000012320255180008": {}, "cratos:config": {} };
    Limpeza.armazem = () => ({ get: async () => Object.assign({}, mem), remove: async (ks) => ks.forEach((k) => delete mem[k]) });
    await Limpeza.aoIniciar();
    checar(LIMPEZA_MANTER.includes("cratos:infojud_varas") && mem["cratos:infojud_varas"] && mem["cratos:renajud_listas"] && !mem["cratos:diario:00000012320255180008"],
      "limpeza ao abrir o Firefox: as listas lidas das telas ficam; dado de processo sai");
  }

  /* ── 3. RENAJUD ─────────────────────────────────────────────────────────── */
  {
    const ctx = { Registro: { adicionar() {} }, console: { log() {}, warn() {}, error() {} }, globalThis: null };
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(ler("comum", "storage.js"), ctx);
    vm.runInContext(ler("modulos", "renajud.js") + "\n;globalThis.__R = ModuloRENAJUD;", ctx);
    const R = ctx.__R;
    checar(R.tribunalDoHost && R.tribunalDoHost("https://pje.trt18.jus.br") === "TRIBUNAL REGIONAL DO TRABALHO DA 18A REGIAO" &&
      R.tribunalDoHost("https://pje.trt2.jus.br/pjekz") === "TRIBUNAL REGIONAL DO TRABALHO DA 2A REGIAO" &&
      R.tribunalDoHost("https://pje.tjgo.jus.br") === "" && R.tribunalDoHost("") === "",
      "RENAJUD: tribunal tirado do endereço do PJe, no nome exato da lista do RENAJUD");
    const cfgEsp = CATALOGO.find((m) => m.nome === "renajud").config;
    checar(cfgEsp.tribunal.padrao === "" && /Automático/.test(cfgEsp.tribunal.rotuloVazio || "") &&
      /ModuloRENAJUD\.tribunalDoHost\(ctx\.base\)/.test(ler("modulos", "renajud.js")),
      "Preferências do RENAJUD: tribunal \"Automático — pelo endereço do PJe\" de fábrica (era fixo no TRT18)");
  }
  function renajud(mem, telaHtml) {
    const dom = new JSDOM(`<!doctype html><html><body>${telaHtml || ""}</body></html>`, { url: "https://renajud.pdpj.jus.br/veiculo/restricao/inclusao", runScripts: "outside-only" });
    const w = dom.window, faixas = [];
    w.browser = { storage: { local: { get: async (k) => ({ [k]: mem[k] }), set: async (o) => Object.assign(mem, JSON.parse(JSON.stringify(o))), remove: async () => {} } },
      runtime: { sendMessage: async () => ({ ok: true }), onMessage: { addListener() {} }, getURL: (p) => "moz-extension://x/" + p }, downloads: { download: async () => 1 } };
    w.CratosFaixa = { parar: (m, t) => faixas.push(["parar", t]), alertar: (m, t) => faixas.push(["alertar", t]), dizer: (m, t) => faixas.push(["dizer", t]) };
    for (const k of ["log", "warn", "error", "debug"]) w.console[k] = () => {};
    w.eval(ler("comum", "storage.js"));
    w.eval(ler("conteudo", "renajud.js"));
    return { w, faixas, mem };
  }
  const ORGAOS = [
    { id: 2, nome: "SEGUNDA VARA DO TRABALHO DE CIDADE FICTICIA", municipio: { id: 1, nome: "CIDADE FICTICIA", uf: "GO" }, tribunal: { id: "TRT18", nome: "TRIBUNAL REGIONAL DO TRABALHO DA 18A REGIAO" } },
    { id: 1, nome: "PRIMEIRA VARA DO TRABALHO DE CIDADE FICTICIA", municipio: { id: 1, nome: "CIDADE FICTICIA", uf: "GO" }, tribunal: { id: "TRT18", nome: "TRIBUNAL REGIONAL DO TRABALHO DA 18A REGIAO" } },
  ];
  const MAGS = [{ documento: "11144477735", nome: "MAGISTRADA FICTICIA DE TAL" }, { documento: "52998224725", nome: "MAGISTRADO EXEMPLO" }];
  const lista = (w, url, corpo) => w.document.dispatchEvent(new w.CustomEvent("cratos:renajud:lista", { detail: JSON.stringify({ url, corpo: JSON.stringify(corpo) }) }));
  {
    const t = renajud({ "cratos:renajud_estado": { ativo: true, operacao: "inclusao" } });
    await tick(50);
    lista(t.w, "https://api-renajud.pdpj.jus.br/api/v1/orgaos/TRT18", ORGAOS);
    await tick(50);
    lista(t.w, "https://api-renajud.pdpj.jus.br/api/v1/magistrados-delegantes", MAGS);
    await tick(50);
    const l = t.mem["cratos:renajud_listas"] || {};
    checar(Array.isArray(l.orgaos) && l.orgaos.join("|") === "PRIMEIRA VARA DO TRABALHO DE CIDADE FICTICIA|SEGUNDA VARA DO TRABALHO DE CIDADE FICTICIA" &&
      l.tribunal && l.tribunal.id === "TRT18", "RENAJUD: guarda os órgãos que a página carregou (nomes, em ordem) e o tribunal");
    checar(l.magistrados && l.magistrados.length === 2 && !JSON.stringify(l).includes("11144477735") && !JSON.stringify(l).includes("documento"),
      "⛔ magistrados: só os NOMES — o documento (CPF) não é guardado");
  }
  {
    const t = renajud({});
    await tick(50);
    lista(t.w, "https://api-renajud.pdpj.jus.br/api/v1/orgaos/TRT18", ORGAOS);
    await tick(50);
    checar(!t.mem["cratos:renajud_listas"], "⛔ sem tarefa do CRATOS no RENAJUD: nada é guardado (endurecimento)");
  }
  {
    const t = renajud({ "cratos:renajud_estado": { ativo: true, operacao: "inclusao" } },
      `<div id="orgao" class="ng-select"><div class="ng-value"><span class="ng-value-label">SEGUNDA VARA DO TRABALHO DE CIDADE FICTICIA</span></div></div>`);
    await tick(50);
    const R = t.w.__cratosRenajud;
    const v = R && R.aprenderCampo ? await R.aprenderCampo("#orgao", "orgao", "órgão") : null;
    checar(v === "SEGUNDA VARA DO TRABALHO DE CIDADE FICTICIA" && t.mem["cratos:config"] && t.mem["cratos:config"].renajud.orgao === v &&
      t.faixas.some((f) => /guardei o órgão "SEGUNDA VARA/.test(f[1])),
      "RENAJUD: órgão em branco é APRENDIDO — a escolha feita no formulário vai para as Preferências");
    const src = ler("conteudo", "renajud.js");
    checar((src.match(/else await aprenderCampo\("#orgao", "orgao", "órgão"\);/g) || []).length === 2 &&
      (src.match(/else await aprenderCampo\("#documentoMagistrado", "magistrado", "magistrado"\);/g) || []).length === 2,
      "inclusão e retirada: órgão e magistrado em branco são perguntados e guardados");
  }
  {
    const dom = new JSDOM("<!doctype html><body></body>", { url: "https://renajud.pdpj.jus.br/", runScripts: "outside-only" });
    const w = dom.window, ev = [];
    w.document.addEventListener("cratos:renajud:lista", (e) => ev.push(JSON.parse(e.detail)));
    w.fetch = async () => ({ status: 200, clone() { return { text: async () => JSON.stringify(ORGAOS) }; } });
    w.eval(ler("conteudo", "renajud-api.js"));
    await w.fetch("https://api-renajud.pdpj.jus.br/api/v1/orgaos/TRT18");
    await w.fetch("https://api-renajud.pdpj.jus.br/api/v1/veiculos?x=1");
    await w.fetch("https://api-renajud.pdpj.jus.br/api/v1/orgaos/TRT18", { method: "POST" });
    await tick(30);
    checar(ev.length === 1 && /orgaos\/TRT18/.test(ev[0].url), "grampo: escuta só o GET das listas de referência (não outras chamadas, não POST)");
  }

  /* ── 4. Preferências ───────────────────────────────────────────────────── */
  {
    const mem = {
      "cratos:config": { infojud: { vara: "099" } },
      "cratos:infojud_varas": { em: Date.parse("2026-10-26T12:00:00-03:00"), opcoes: [{ valor: "001", rotulo: "001 — 1ª VARA FICTÍCIA" }, { valor: "002", rotulo: "002 — 2ª VARA FICTÍCIA" }] },
      "cratos:renajud_listas": { emOrgaos: Date.parse("2026-10-26T12:00:00-03:00"), tribunal: { id: "TRT02" }, orgaos: ["ORGAO FICTICIO A", "ORGAO FICTICIO B"] },
    };
    const p = paginaExtensao('<div id="modulos"></div>', mem, CATALOGO);
    p.w.eval(ler("comum", "storage.js"));
    p.w.eval(ler("opcoes", "opcoes.js"));
    await tick(250);
    const inf = p.d.querySelector('.modulo[data-modulo="infojud"]');
    const sel = inf && inf.querySelector('select[data-chave="vara"]');
    const nota = inf && inf.querySelector('.cx-origem-lista[data-lista="infojud_varas"]');
    checar(sel && sel.options.length === 3 && sel.options[1].value === "001" && /Lista lida do seu e-CAC em 26\/10\/2026 \(2 varas\)/.test(nota.textContent),
      "Preferências: o menu de vara usa a lista lida do e-CAC, com a data");
    checar(sel.value === "" && /A escolha salva \("099"\) não está nesta lista: escolha de novo/.test(nota.textContent),
      "⛔ vara salva fora da lista: aviso para escolher de novo — nunca troca sozinha");
    const ren = p.d.querySelector('.modulo[data-modulo="renajud"]');
    const org = ren.querySelector('select[data-chave="orgao"]'), trib = ren.querySelector('select[data-chave="tribunal"]');
    checar(org.options.length === 3 && org.options[1].value === "ORGAO FICTICIO A" && /Lista lida do RENAJUD em 26\/10\/2026 \(TRT02, 2 órgãos\)/.test(ren.textContent) &&
      trib.options[0].value === "" && /Automático — pelo endereço do PJe/.test(trib.options[0].textContent) && trib.value === "",
      "Preferências do RENAJUD: órgãos da lista lida e tribunal \"Automático\"");
    checar(/Só preencha se você tiver delegação de MAIS DE UM magistrado no INFOJUD/.test(inf.textContent) &&
      /Em branco, o CRATOS pede que você escolha o órgão na primeira inclusão/.test(ren.textContent),
      "notas: quando preencher o magistrado do INFOJUD (Rodrigo, 26/10) e o aprendizado do RENAJUD");
    p.d.getElementById("cx-ler-varas").click();
    p.d.getElementById("cx-primeiros").click();
    await tick(20);
    checar(p.msgs.some((m) => m.tipo === "infojud_ler_varas") && p.msgs.some((m) => m.tipo === "abrir_primeiros") && !p.msgs.some((m) => m.tipo === "__aba"),
      "botões \"Ler as varas do meu e-CAC\" e \"Abrir os Primeiros passos\" (nada abre sem clique)");
    sel.value = "002";
    await p.w.browser.storage.local.set({ "cratos:infojud_varas": { em: Date.now(), opcoes: [{ valor: "002", rotulo: "002 — 2ª VARA FICTÍCIA" }, { valor: "003", rotulo: "003 — 3ª VARA FICTÍCIA" }] } });
    await tick(30);
    const sel2 = inf.querySelector('select[data-chave="vara"]');
    checar(sel2.options.length === 3 && sel2.value === "002" && sel2.options[2].value === "003",
      "lista nova chegando com as Preferências abertas: troca as opções sem perder a escolha");
  }

  /* ── 4a. botão "Procurar atualização" (Rodrigo, 26/10) ──────────────────── */
  {
    const p = paginaExtensao('<div id="modulos"></div>', {}, CATALOGO);
    p.w.eval(ler("comum", "storage.js"));
    p.w.eval(ler("opcoes", "opcoes.js"));
    await tick(250);
    const bu = p.d.getElementById("procurar-atualizacao"), st = () => p.d.getElementById("atualizacao-status").textContent;
    const resposta = { v: null };
    const orig = p.w.browser.runtime.sendMessage;
    p.w.browser.runtime.sendMessage = async (m) => (m && m.tipo === "verificar_atualizacao") ? resposta.v : orig(m);
    const clicar = async (v) => { resposta.v = v; bu.click(); await tick(30); return st(); };
    checar(bu && /use quando não houver convênio rodando/.test(st()), "Preferências → Sobre: botão \"Procurar atualização\", com o aviso de que instalar reinicia o CRATOS");
    const LINK = "https://github.com/Rodrigo-Madalosso-Araujo/CRATOS/releases/download/v1.9.3/cratos-1.9.3.xpi";
    const t1 = await clicar({ ok: true, status: "no_update", atual: "1.9.2" });
    const t2 = await clicar({ ok: true, status: "update_available", versao: "1.9.3", atual: "1.9.2", link: LINK });
    const bi = p.d.getElementById("instalar-atualizacao");
    if (bi) { bi.click(); await tick(20); }
    const instalou = p.msgs.find((m) => m.tipo === "instalar_atualizacao");
    const t4 = await clicar({ ok: false, status: "erro" });
    checar(/versão mais recente \(1\.9\.2\)/.test(t1) && /Versão 1\.9\.3 disponível \(você está na 1\.9\.2\)/.test(t2) && /sem perder as Preferências/.test(t2) &&
      instalou && instalou.link === LINK && /Não consegui consultar agora/.test(t4),
      "respostas: versão mais recente / versão nova com \"Instalar agora\" / não consegui");
    const bg = ler("background.js");
    const pega = (nome) => (bg.match(new RegExp("(?:async )?function " + nome + "\\([^)]*\\) \\{[\\s\\S]*?\\n\\}")) || [""])[0];
    const codigo = [(bg.match(/const LINK_RELEASE = [^\n]+/) || [""])[0], pega("_cmpVersao"), pega("verificarAtualizacao"), pega("instalarAtualizacao")].join("\n");
    const abas = [];
    const ctx = { browser: { runtime: { getManifest: () => ({ version: "1.9.2", browser_specific_settings: { gecko: { id: "cratos@trt18.local",
      update_url: "https://raw.githubusercontent.com/Rodrigo-Madalosso-Araujo/CRATOS/main/updates.json" } } }) },
      tabs: { create: async (o) => abas.push(o.url) } } };
    vm.createContext(ctx);
    let a1 = {}, a2 = {}, a3 = {}, a4 = {}, i1 = {}, i2 = {};
    try {
      vm.runInContext(codigo + ";globalThis.__v = verificarAtualizacao; globalThis.__i = instalarAtualizacao;", ctx);
      const upd = (lista) => ({ fetch: async (u, o) => ({ ok: true, url: u, opts: o, json: async () => ({ addons: { "cratos@trt18.local": { updates: lista } } }) }) });
      a1 = await ctx.__v(upd([{ version: "1.9.1", update_link: "x" }, { version: "1.9.3", update_link: LINK }]));
      a2 = await ctx.__v(upd([{ version: "1.9.1" }, { version: "1.9.2" }]));
      a3 = await ctx.__v({ fetch: async () => { throw new Error("rede"); } });
      a4 = await ctx.__v(upd([{ version: "2.0.0", update_link: "https://outro.site/cratos-2.0.0.xpi" }]));
      i1 = await ctx.__i({ link: LINK });
      i2 = await ctx.__i({ link: "https://outro.site/x.xpi" });
    } catch (e) { /* versão sem o código */ }
    checar(a1.ok && a1.status === "update_available" && a1.versao === "1.9.3" && a1.link === LINK && a2.status === "no_update" && a3.ok === false &&
      a4.status === "update_available" && a4.link === "",
      "fundo: lê o updates.json do update_url, pega a maior versão e compara; link fora do repositório do CRATOS é descartado");
    checar(i1.ok && abas.length === 1 && abas[0] === LINK && i2.ok === false && !/requestUpdateCheck\(/.test(bg),
      "\"Instalar agora\" abre só o .xpi da release do CRATOS (o Firefox pergunta e instala); sem a API que o Firefox não tem");
  }

  /* ── 4b. órgãos do RENAJUD embutidos (coleta do Rodrigo, 26/10) ─────────── */
  {
    const O = require(path.join(SRC, "modulos", "renajud-orgaos.js"));
    checar(O && Object.keys(O.TRIBUNAIS).length === 24 && O.orgaosDe("TRT18").length === 57 && O.idDoHost("https://pje.trt3.jus.br") === "TRT03" &&
      O.idDoNome("TRIBUNAL REGIONAL DO TRABALHO DA 18A REGIAO") === "TRT18" && !O.TRIBUNAIS.TST && !/documento|magistrad/i.test(JSON.stringify(O.TRIBUNAIS)),
      "órgãos dos 24 TRTs embutidos (só nomes; sem TST/CSJT, sem magistrados)");
    const mem = { "cratos:config": { renajud: { orgao: "VARA X", magistrado: "FULANO" } }, "cratos:trt": "https://pje.trt3.jus.br" };
    const p = paginaExtensao('<div id="modulos"></div>', mem, CATALOGO);
    p.w.eval(ler("comum", "storage.js"));
    p.w.eval(ler("modulos", "renajud-orgaos.js"));
    p.w.eval(ler("opcoes", "opcoes.js"));
    await tick(250);
    const ren = p.d.querySelector('.modulo[data-modulo="renajud"]');
    const org = ren.querySelector('select[data-chave="orgao"]'), trib = ren.querySelector('select[data-chave="tribunal"]');
    checar(org.options.length === O.orgaosDe("TRT03").length + 1 && /Lista do RENAJUD para TRT03/.test(ren.textContent),
      "Preferências, tribunal automático: a lista de órgãos é a do TRT do endereço do PJe (embutida), desde o primeiro dia");
    trib.value = "TRIBUNAL REGIONAL DO TRABALHO DA 18A REGIAO";
    trib.dispatchEvent(new p.w.Event("change"));
    checar(ren.querySelector('select[data-chave="orgao"]').options.length === 58 && /Lista do RENAJUD para TRT18/.test(ren.textContent),
      "trocar o tribunal troca a lista de órgãos na hora");
    ren.querySelector("#cx-renajud-reaprender").click();
    await tick(40);
    checar(p.mem["cratos:config"].renajud.orgao === "" && p.mem["cratos:config"].renajud.magistrado === "" &&
      /Na próxima inclusão, o CRATOS pergunta o órgão e o magistrado/.test(ren.textContent),
      "\"Perguntar de novo na próxima inclusão\": limpa órgão e magistrado (quem mudou de lotação)");
    const opc = ler("opcoes", "opcoes.html"), pri = ler("primeiros", "primeiros.html");
    checar(/modulos\/renajud-orgaos\.js/.test(opc) && /modulos\/renajud-orgaos\.js/.test(pri), "a lista embutida carrega nas Preferências e nos Primeiros passos");
  }

  /* ── 5. Primeiros passos ────────────────────────────────────────────────── */
  {
    const bg = ler("background.js");
    checar(/onInstalled\.addListener\(async \(detalhes\) => \{[\s\S]{0,300}if \(detalhes && detalhes\.reason === "install"\) \{\s*try \{ await abrirPrimeirosPassos\(\);/.test(bg) &&
      /browser\.runtime\.getURL\("primeiros\/primeiros\.html"\)/.test(bg) && fs.existsSync(path.join(SRC, "primeiros", "primeiros.html")),
      "Primeiros passos: abre sozinha só na INSTALAÇÃO (não na atualização); depois, pelo botão");
    const corpoHtml = ler("primeiros", "primeiros.html").replace(/[\s\S]*<body>/, "").replace(/<script[\s\S]*$/, "");
    const mem = { "cratos:config": { infojud: { cpf: { dirpf: { ativo: true, anos: 3 } }, justificativa: "execução" }, sab: { atualizarValor: "sim" } },
      "cratos:infojud_varas": { em: Date.now(), opcoes: [{ valor: "001", rotulo: "001 — 1ª VARA FICTÍCIA" }] }, "cratos:trt": "https://pje.trt18.jus.br" };
    const p = paginaExtensao(corpoHtml, mem, CATALOGO);
    p.w.eval(ler("comum", "storage.js"));
    if (fs.existsSync(path.join(SRC, "modulos", "renajud-orgaos.js"))) p.w.eval(ler("modulos", "renajud-orgaos.js"));
    p.w.eval(ler("primeiros", "primeiros.js"));
    await tick(200);
    const txt = () => p.d.getElementById("passos").textContent;
    checar(/2\. INFOJUD \(e-CAC\)\s*pendente/.test(txt()) && /3\. RENAJUD\s*pendente/.test(txt()) && /4\. CNIB\s*opcional/.test(txt()) &&
      /Lista lida do seu e-CAC em/.test(txt()) && /Será perguntado na primeira inclusão/.test(txt()),
      "passos com situação: INFOJUD e RENAJUD pendentes, CNIB opcional; órgão \"será perguntado na primeira inclusão\"");
    checar(/Só preencha se você tiver delegação de mais de um magistrado no INFOJUD/.test(txt()),
      "explica o campo Magistrado do INFOJUD (só com delegação de mais de um magistrado — Rodrigo, 26/10)");
    checar(p.msgs.filter((m) => m.tipo !== "catalogo").length === 0, "⛔ ao abrir, a página não abre nenhum sistema nem manda nada");
    p.d.getElementById("pp-vara").value = "001";
    p.d.querySelector('.pp-tipo[value="Transferência"]').checked = true;
    p.d.getElementById("pp-pasta-in").value = "EXECUCAO";
    p.d.getElementById("pp-mag-infojud").value = "  ";
    const ppOrg = p.d.getElementById("pp-orgao");
    checar(ppOrg && ppOrg.options.length === 58, "Primeiros passos: o órgão já pode ser escolhido na lista do tribunal (TRT18 pelo endereço do PJe)");
    if (ppOrg) ppOrg.value = "COORDENADORIA DE MANDADOS JUDICIAIS";
    p.d.getElementById("pp-salvar").click();
    await tick(80);
    const c = p.mem["cratos:config"];
    checar(c.infojud.vara === "001" && c.infojud.cpf && c.infojud.cpf.dirpf.ativo === true && c.sab.atualizarValor === "sim" && c.infojud.magistrado === "" &&
      c.renajud.tipoRestricao.join() === "Transferência" && c.renajud.tribunal === "" && c.renajud.orgao === "COORDENADORIA DE MANDADOS JUDICIAIS",
      "salvar MESCLA no config das Preferências (o que já existia fica; magistrado em branco fica vazio)");
    checar(c.infojud.pastaDownload === "EXECUCAO" && ["censec", "serasajud", "ccs", "sniper", "prevjud"].every((m) => c[m].pasta === "EXECUCAO"),
      "a subpasta vale para todos os convênios");
    checar(/2\. INFOJUD \(e-CAC\)\s*pronto/.test(txt()) && /3\. RENAJUD\s*pronto/.test(txt()) && /✓ Salvo/.test(p.d.getElementById("pp-salvo").textContent),
      "depois de salvar, os passos ficam \"pronto\"");
    p.d.getElementById("pp-ler-varas").click();
    await tick(20);
    checar(p.msgs.some((m) => m.tipo === "infojud_ler_varas"), "\"Ler as varas do meu e-CAC\" também nos Primeiros passos");
  }

  /* ── 6. painel ─────────────────────────────────────────────────────────── */
  {
    const abrir = async (cfg) => {
      const a = montarPainel(SRC, { mem: { "cratos:config": cfg } });
      a.P.setProcesso({ numero: "0000001-23.2025.5.18.0008", id: 1 });
      a.P.setModo("inclusao");
      if (a.P.renderListaConvenios) a.P.renderListaConvenios();
      await new Promise((r) => setTimeout(r, 80));
      return a;
    };
    const sem = await abrir({ infojud: {} });
    const av = sem.d.querySelector('.cx-parte[data-conv-id="INFOJUD"] .cx-aviso-config');
    checar(av && /Vara do e-CAC não configurada/.test(av.textContent), "painel: INFOJUD sem vara mostra o aviso");
    if (av) { av.querySelector(".cx-abrir-primeiros").click(); await tick(20); }
    checar(sem.msgs.some((m) => m && m.tipo === "abrir_primeiros"), "o link do aviso abre os Primeiros passos");
    const com = await abrir({ infojud: { vara: "001" } });
    checar(!com.d.querySelector(".cx-aviso-config"), "com a vara configurada, nada de aviso");
  }

  /* ── 6b. INFOJUD: padrão pós-instalação (Rodrigo, 26/10) e config efetiva ─ */
  {
    const inf = CATALOGO.find((m) => m.nome === "infojud").config._grupos;
    const on = (g, k, anos) => inf[g].campos[k].padrao.ativo === true && (anos == null || inf[g].campos[k].padrao.anos === anos);
    const off = (g, k) => inf[g].campos[k].padrao.ativo === false;
    checar(on("cpf", "dirpf", 2) && on("cpf", "ditr", 1) && on("cpf", "doi") && on("cpf", "decred", 1) && on("cpf", "dimob", 1) &&
      off("cpf", "infocad") && off("cpf", "efin") && on("cpf", "recuperarEmpresas") &&
      off("cnpj", "dipj") && off("cnpj", "ecf") && on("cnpj", "ditr", 1) && on("cnpj", "doi") && on("cnpj", "decred", 1) && on("cnpj", "dimob", 1) &&
      off("cnpj", "cpmf") && off("cnpj", "infocad") && off("cnpj", "efin"),
      "INFOJUD: padrão pós-instalação = o do Rodrigo (CPF: DIRPF 2a, DITR/DECRED/DIMOB 1a, DOI, Recuperar NI; CNPJ: DITR/DECRED/DIMOB 1a, DOI)");
    const { ctx } = catalogoReal();
    vm.runInContext("globalThis.__I = ModuloInfojud;", ctx);
    const I = ctx.__I;
    const ef = I && I.configEfetiva ? I.configEfetiva(undefined) : null;
    checar(ef && ef.cpf.dirpf.ativo === true && ef.cpf.dirpf.anos === 2 && ef.cnpj.doi.ativo === true && ef.colheitaAutomatica === "colher" && ef.justificativa === "execução",
      "⛔ quem nunca salvou as Preferências roda o INFOJUD COM o padrão (antes ia sem nenhum tipo)");
    const ef2 = I.configEfetiva({ cpf: { dirpf: { ativo: false, anos: 5 } }, vara: "008", extra: 1 });
    checar(ef2.cpf.dirpf.ativo === false && ef2.cpf.dirpf.anos === 5 && ef2.cpf.doi.ativo === true && ef2.vara === "008" && ef2.extra === 1,
      "o que foi salvo vale; o que falta vem do padrão");
    const bg = ler("background.js");
    checar(/const cfg = ModuloInfojud\.configEfetiva\(cfgTudo\.infojud\);/.test(bg) && /config: ModuloInfojud\.configEfetiva\(plano\.config\),/.test(bg),
      "fundo: as duas portas do INFOJUD usam a config efetiva");
  }

  /* ── 7. novidades ──────────────────────────────────────────────────────── */
  {
    const nov = ler("comum", "novidades.js");
    checar(/versao: "1\.9\.2"/.test(nov) && /Primeiros passos/.test(nov) && /^1\.9\.([2-9]|\d\d)$|^(1\.(\d\d|[1-9]\d)|[2-9])\./.test(JSON.parse(ler("manifest.json")).version),
      "novidades da 1.9.2 e manifesto na 1.9.2 ou mais nova");
  }

  console.log(`\n=== ${NOME} ===`);
  oks.forEach((d) => console.log("  ok   " + d));
  falhas.forEach((d) => console.log("  FALHA " + d));
  console.log(`\n${oks.length} passaram, ${falhas.length} falharam (${oks.length + falhas.length} asserções)\n`);
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.log("FALHA geral: " + e.stack); process.exit(1); });
