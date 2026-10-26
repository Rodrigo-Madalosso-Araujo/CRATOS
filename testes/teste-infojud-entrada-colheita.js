/*
 * teste-infojud-entrada-colheita.js — as duas correções pedidas em 02/09.
 *
 * A) ENTRAR SOZINHO DEPOIS DO LOGIN. O caso real: o CRATOS abre o serviço, a
 *    Receita joga para o gov.br, o usuário se autentica e cai no PORTAL do eCAC.
 *    Até a 1.0.11 a extensão só avisava "entre à mão". Agora ela navega para a
 *    casca do serviço (`Aplicacao.aspx?id=5032`), e o ramo do MENU clica em
 *    "Registrar Solicitação".
 *    Três travas, porque navegar sozinho é o que vira laço:
 *      1. UMA VEZ por execução (carimbo em sessionStorage);
 *      2. só no host da Receita — no gov.br o usuário está logando;
 *      3. nunca estando já na casca, e nunca se um frame já deu sinal de vida.
 *
 * B) COLHEITA AO FIM DA FILA. ⚠ A Receita não responde na hora: o normal é
 *    "ainda não respondeu", e isso NÃO é erro — não pode sair em vermelho nem
 *    ser tratado como falha. Preferência de três posições.
 *
 * Rodar: node teste-infojud-entrada-colheita.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const falhas = [];
const oks = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function fonteComGancho() {
  const src = fs.readFileSync(path.join(SRC, "conteudo", "ecac-infojud.js"), "utf8");
  const alvo = "location.assign(ECAC_ENTRADA_URL);";
  if (src.indexOf(alvo) < 0) {
    throw new Error("o gancho não casou: `" + alvo + "` não existe mais em ecac-infojud.js. " +
      "Conferir a chamada de navegação antes de confiar nesta suíte.");
  }
  return src.replace(alvo, "window.__cratosNav(ECAC_ENTRADA_URL);");
}

/* ────────────────────────────────────────────────────────────────────────────
   A) ENTRADA
   ──────────────────────────────────────────────────────────────────────────── */
function montarEcac(url, opts) {
  const o = opts || {};
  const dom = new JSDOM("<!doctype html><html><body></body></html>",
    { url, runScripts: "outside-only" });
  const w = dom.window;
  const fila = o.semFila ? null : {
    partes: [{ ni: "1", nome: "X" }], idx: 0,
    criadoEm: new Date(Date.now() - 5000).toISOString(),
  };
  const mem = {
    "cratos:ecac_fila": fila,
    "cratos:ecac_progresso": o.progresso || null,
  };
  const navegou = [];
  w.browser = {
    storage: {
      local: {
        get: async (k) => ({ [k]: mem[k] }),
        set: async (obj) => Object.assign(mem, obj),
        remove: async () => {},
      },
      onChanged: { addListener: () => {} },
    },
    runtime: {
      /* 1.9.0: o vigia pergunta ao fundo se esta é a aba aberta pelo CRATOS. Padrão: é. */
      sendMessage: async (m) => (m && m.tipo === "ecac_sou_registro") ? { sim: o.outraAba ? false : true } : ({ ok: true }),
      onMessage: { addListener: () => {} },
      getURL: (p) => p,
    },
  };
  /* `window.location` do jsdom não se deixa substituir — e navegação de verdade
     ele não faz. Então penduramos o gancho no TEXTO do arquivo em memória, sem
     tocar no que é empacotado: se alguém mudar a chamada, o replace não casa e o
     teste QUEBRA ALTO em vez de medir outra coisa em silêncio. (Mesma técnica do
     `window.__cratosTeste` das suítes do eCAC.) */
  w.__cratosNav = (u) => navegou.push(String(u));
  w.console.log = () => {}; w.console.warn = () => {}; w.console.debug = () => {};
  const faixas = [];
  w.CratosFaixa = {
    parar: (m, t) => faixas.push(["parar", t]),
    alertar: (m, t) => faixas.push(["alertar", t]),
    dizer: (m, t) => faixas.push(["dizer", t]),
    mostrar: () => {},
  };
  w.eval(fs.readFileSync(path.join(SRC, "comum", "storage.js"), "utf8"));
  w.eval(fonteComGancho());
  return { w, navegou, faixas, mem };
}

(async () => {

{
  const arq = fs.readFileSync(path.join(SRC, "conteudo", "ecac-infojud.js"), "utf8");
  if (!/ECAC_ENTRADA_URL/.test(arq)) {
    console.log("\n=== teste-infojud-entrada-colheita.js ===");
    console.log("  FALHA  a versão em " + SRC + " não entra sozinha no serviço do INFOJUD " +
      "depois do login: cai no portal do eCAC e só avisa para entrar à mão.");
    console.log("\n0 passaram — a suíte inteira reprova nesta versão.\n");
    process.exit(1);
  }
}

/* Caiu no portal do eCAC (o caso real depois do login) */
{
  const { navegou, faixas } = montarEcac("https://cav.receita.fazenda.gov.br/ecac/Aplicacao.aspx?id=00006");
  await esperar(5200);
  checar(navegou.length === 1, "caindo no portal do eCAC, navega sozinho (uma vez)");
  checar(/id=5032/.test(navegou[0] || ""),
    "navega para a CASCA do serviço — o link profundo para solicitacao.asp não vale mais desde 21/08");
  checar(faixas.some((f) => f[0] === "dizer"),
    "avisa em verde que está entrando (não deixa a tela muda)");
}

/* 1.9.0: aba que NÃO é a do registro (caixa postal, e-CAC aberto à mão) — o vigia não age */
{
  const { navegou, faixas } = montarEcac("https://cav.receita.fazenda.gov.br/ecac/", { outraAba: true });
  await esperar(5200);
  checar(navegou.length === 0 && !faixas.length,
    "⛔ 1.9.0: em aba que não foi aberta pelo CRATOS para o registro (ex.: a da caixa postal), o vigia não navega nem fala");
}

/* Ainda no gov.br: o usuário está logando — não atropelar */
{
  const { navegou } = montarEcac("https://sso.acesso.gov.br/login?client_id=cav");
  await esperar(5200);
  checar(navegou.length === 0,
    "⛔ no gov.br NÃO navega: o usuário está no meio do login e seria atropelado");
}

/* Já na casca: não recarrega em círculo */
{
  const { navegou } = montarEcac("https://cav.receita.fazenda.gov.br/ecac/Aplicacao.aspx?id=5032&origem=menu");
  await esperar(5200);
  checar(navegou.length === 0, "já estando na casca do serviço, não navega de novo (evita laço)");
}

/* Um frame nosso já chegou: nada a fazer */
{
  const { navegou } = montarEcac("https://cav.receita.fazenda.gov.br/ecac/Aplicacao.aspx?id=00006",
    { progresso: { em: Date.now(), onde: "registro" } });
  await esperar(5200);
  checar(navegou.length === 0,
    "se um frame já deu sinal de vida, não navega — era o alarme falso da 1.0.4, agora do outro lado");
}

/* Sem fila: a extensão não tem nada a fazer ali */
{
  const { navegou } = montarEcac("https://cav.receita.fazenda.gov.br/ecac/Aplicacao.aspx?id=00006",
    { semFila: true });
  await esperar(5200);
  checar(navegou.length === 0,
    "sem fila do CRATOS, não navega: quem entrou à mão no eCAC não pode ser levado embora");
}

/* Uma vez por execução */
{
  const { w, navegou } = montarEcac("https://cav.receita.fazenda.gov.br/ecac/Aplicacao.aspx?id=00006");
  await esperar(5200);
  const antes = navegou.length;
  w.eval(fonteComGancho());
  await esperar(5200);
  checar(antes === 1 && navegou.length === 1,
    "o carimbo em sessionStorage garante UMA navegação por execução, mesmo se o script rodar de novo");
}

/* ────────────────────────────────────────────────────────────────────────────
   B) COLHEITA — as frases, que são o produto aqui
   ──────────────────────────────────────────────────────────────────────────── */
{
  const src = fs.readFileSync(path.join(SRC, "conteudo", "painel.js"), "utf8");
  const ini = src.indexOf("async function colheitaAoFimDaFila()");
  const trecho = src.slice(ini, src.indexOf("function renderProgresso()"));

  checar(ini > 0, "a colheita ao fim da fila existe no painel");
  /* ⛔ A ASSERÇÃO QUE FALHOU EM ME PROTEGER (1.1.0). Ela procurava a string
     `c.id === "infojud"` NO ARQUIVO — e passou, confirmando a minha grafia
     errada: os ids do catálogo são MAIÚSCULOS. A colheita saía calada na
     primeira linha, sempre, e o teste dizia que estava tudo bem.
     Agora a asserção compara com a REALIDADE: o id que a colheita procura tem
     de existir no catálogo CONVENIOS do próprio painel. */
  const idsCatalogo = (src.match(/\{ id: "([A-Z]+)"/g) || [])
    .map((m) => m.replace(/.*"([A-Z]+)".*/, "$1"));
  checar(idsCatalogo.includes("INFOJUD"),
    "o catálogo CONVENIOS do painel tem o id INFOJUD (é dele que a fila é feita)");
  const mId = /const ID_INFOJUD = "([^"]+)"/.exec(src);
  checar(mId && idsCatalogo.includes(mId[1]),
    "⛔ o id que a colheita procura EXISTE no catálogo — a asserção que faltava na 1.1.0");
  checar(/toUpperCase\(\) === ID_INFOJUD/.test(src),
    "a comparação é insensível a caixa, para não depender de eu lembrar da grafia");
  checar(/filaTemInfojud\(orquestraFila\)/.test(trecho),
    "só roda se o INFOJUD estava na fila — não incomoda quem rodou só CNIB");
  checar(/colheitaAutomatica/.test(trecho), "lê a Preferência de três posições");
  checar(/if \(modo === "nao"\) return;/.test(trecho), "desligado: não faz nada");
  checar(/ainda não respondeu/.test(trecho),
    "⚠ o caso NORMAL tem frase própria: a Receita ainda não respondeu");
  checar(/#9a9a9a[^]*ainda não respondeu/.test(trecho) || !/#ff6b6b[^]*ainda não respondeu/.test(trecho),
    '"ainda não respondeu" NÃO sai em vermelho — o pedido foi registrado, não houve falha');
  checar(/sem_sessao_receita/.test(trecho),
    "sessão do gov.br caída tem tratamento próprio, distinto de 'não respondeu'");
  checar(/Verificar de novo/.test(trecho),
    "sempre sobra um botão para tentar de novo mais tarde — o retorno leva horas");
  checar(/coletar_tudo/.test(trecho), "no modo 'colher', chama a coleta");
  checar(/modo !== "colher"/.test(trecho),
    "no modo 'verificar', oferece o botão em vez de colher sozinho");

  const mod = fs.readFileSync(path.join(SRC, "modulos", "infojud.js"), "utf8");
  checar(/colheitaAutomatica[\s\S]{0,400}padrao: "colher"/.test(mod),
    "a Preferência nasce em 'verificar e colher'");
  checar(/valor: "verificar"/.test(mod) && /valor: "nao"/.test(mod),
    "as três posições estão declaradas nas Preferências");
}

/* ────────────────────────────────────────────────────────────────────────────
   C) A ABA FRIA DA CAIXA POSTAL — a falha real de 02/09
   A colheita automática é o PRIMEIRO caso em que a aba nasce fria: quando o
   usuário clicava o botão à mão, a aba já estava aberta e quente. A versão
   anterior esperava 15s por um ping e, não obtendo, devolvia "nenhuma aba
   respondeu" — que o painel traduzia como SESSÃO INATIVA. Sintoma de uma coisa
   com o nome de outra.
   ──────────────────────────────────────────────────────────────────────────── */
{
  const bg = fs.readFileSync(path.join(SRC, "background.js"), "utf8");
  const ini = bg.indexOf("async function lerCaixaPostalViaAba(");
  const fim = bg.indexOf("/* Espera o content script de uma aba responder");
  const fn = bg.slice(ini, fim > ini ? fim : ini + 6000);

  checar(ini > 0, "lerCaixaPostalViaAba existe");
  checar(/cp_fetch_mensagens/.test(fn) && !/esperarConteudoPronto\(/.test(fn),
    "⛔ espera pelo TOKEN (cp_fetch_mensagens), não por um ping — é o token que a leitura precisa");
  checar(/esperaMs \|\| 60000/.test(fn),
    "o prazo passou de 15s para 60s: aba fria da Receita não carrega em 15s");
  checar(/Date\.now\(\) - t0 > 20000/.test(fn) && /active: true/.test(fn),
    "aos 20s sem token, TORNA A ABA VISÍVEL — se o gov.br pede login, só o usuário resolve, e precisa ver");
  checar(/if \(abaAberta\) \{ try \{ await browser\.tabs\.remove/.test(fn),
    "fecha apenas a aba que ELA abriu, e só no sucesso");
  const trechoFalha = fn.slice(fn.indexOf("return {\n    ok: false"));
  checar(/caixa_sem_token/.test(fn) && /caixa_nao_carregou/.test(fn),
    "distingue 'não carregou' de 'sem credencial' — antes os dois viravam 'sem sessão'");
  checar(/abaAberta: !!abaAberta/.test(fn),
    "informa se deixou uma aba aberta, para a frase do painel poder mandar o usuário nela");

  const bgAchar = bg.slice(bg.indexOf("const viaAba = await lerCaixaPostalViaAba"), bg.indexOf("const viaAba = await lerCaixaPostalViaAba") + 700);
  checar(/motivo: viaAba\.motivo \|\| "sem_sessao_receita"/.test(bgAchar),
    "coletar_achar PROPAGA o motivo real em vez de achatar tudo em sem_sessao_receita");

  const painel = fs.readFileSync(path.join(SRC, "conteudo", "painel.js"), "utf8");
  const tre = painel.slice(painel.indexOf("async function colheitaAoFimDaFila()"),
                           painel.indexOf("function renderProgresso()"));
  checar(/caixa_nao_carregou/.test(tre) && /caixa_sem_token/.test(tre),
    "o painel conhece os motivos novos");
  checar(/Deixei a aba aberta para você/.test(tre),
    "a frase manda o usuário para a aba que ficou aberta — dizer o que fazer vale mais que nomear o erro");
  checar(/pode levar até um minuto/.test(tre),
    "a espera é anunciada: um minuto calado parece travamento");
}

/* ────────────────────────────────────────────────────────────────────────────
   D) O FILTRO DA FILA, EXERCITADO — não lido
   ──────────────────────────────────────────────────────────────────────────── */
{
  const { JSDOM: J } = require("jsdom");
  const dom = new J("<!doctype html><body></body>",
    { url: "https://pje.trt18.jus.br/pjekz/processo/1", runScripts: "outside-only" });
  const w = dom.window;
  const mem = {};
  w.browser = {
    storage: { local: { get: async (k) => ({ [k]: mem[k] }), set: async (o) => Object.assign(mem, o), remove: async () => {} }, onChanged: { addListener: () => {} } },
    runtime: { sendMessage: async () => ({ ok: true }), onMessage: { addListener: () => {} }, getURL: (p) => p },
  };
  w.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => "" });
  w.console.log = () => {}; w.console.warn = () => {}; w.console.error = () => {};
  w.eval(fs.readFileSync(path.join(SRC, "comum", "storage.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(SRC, "comum", "relatorio.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(SRC, "comum", "faixa.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(SRC, "conteudo", "painel.js"), "utf8"));
  const f = w.__cratosJuntada && w.__cratosJuntada.filaTemInfojud;
  const temF = typeof f === "function";
  checar(temF, "filaTemInfojud está exposta para o teste exercitar");
  /* Versão antiga não tem a função: reprova as asserções de comportamento com o
     motivo, em vez de estourar TypeError e parecer bug do teste. */
  checar(temF && f([{ id: "INFOJUD" }]) === true,
    "⛔ reconhece o id REAL do catálogo (MAIÚSCULO) — era exatamente isto que falhava");
  checar(temF && f([{ id: "SAB" }, { id: "CNIB" }]) === false,
    "fila sem INFOJUD não dispara colheita");
  checar(temF && f([{ id: "infojud" }]) === true,
    "aceita minúsculo também (não depende de grafia)");
  checar(temF && f([]) === false && f(null) === false, "fila vazia ou nula não quebra");
}

/* ────────────────────────────────────────────────────────────────────────────
   E) JUNTADA AO FIM DA FILA (decisão de 20/08, ligada só agora)
   ──────────────────────────────────────────────────────────────────────────── */
{
  const src = fs.readFileSync(path.join(SRC, "conteudo", "painel.js"), "utf8");
  const tre = src.slice(src.indexOf("async function juntadaAoFimDaFila()"),
                       src.indexOf("function renderProgresso()"));
  checar(tre.length > 100, "a juntada ao fim da fila existe");
  checar(/await juntadaAoFimDaFila\(\);/.test(src), "e é chamada quando a fila termina");
  checar(/if \(!certidoes\.length\) return;/.test(tre),
    "sem nada a certificar, fica calada — silêncio é a resposta certa aqui");
  checar(/cfg\.automatica/.test(tre), "lê a Preferência");
  checar(/if \(modo !== "sim"\)/.test(tre), "desligada, só oferece os botões");
  checar(/certidoes\.length > 1/.test(tre) && /um rascunho por vez/.test(tre),
    "⛔ duas famílias: cria a primeira e EXPLICA que o PJe segura um rascunho por vez");
  /* Versão antiga não tem o arquivo: reprova dizendo isso, em vez de estourar
     ENOENT e parecer defeito da suíte. */
  let mod = "";
  try { mod = fs.readFileSync(path.join(SRC, "modulos", "juntada.js"), "utf8"); } catch (e) {}
  checar(!!mod, "existe modulos/juntada.js (o lugar próprio da Preferência da juntada)");
  checar(/padrao: "sim"/.test(mod), "a Preferência nasce ligada (decisão de 20/08)");
  checar(/tipo: "aviso"/.test(mod) && /assina direto/.test(mod),
    "as Preferências avisam que aqui não há diálogo de confirmação ao assinar");
  const man = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8"));
  checar(man.background.scripts.includes("modulos/juntada.js"),
    "o módulo de configuração está declarado no manifesto (senão a Preferência não aparece)");
}

console.log("\n=== teste-infojud-entrada-colheita.js ===");
oks.forEach((d) => console.log("  ok   " + d));
falhas.forEach((d) => console.log("  FALHA " + d));
console.log(`\n${oks.length} passaram, ${falhas.length} falharam ` +
  `(${oks.length + falhas.length} asserções)\n`);
process.exit(falhas.length ? 1 : 0);

})();
