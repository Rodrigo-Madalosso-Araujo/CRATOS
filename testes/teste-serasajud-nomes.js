/*
 * teste-serasajud-nomes.js — escolha de Autor/Réu no SerasaJUD ignorando pontuação (1.6.3).
 * Dados FICTÍCIOS.
 *
 * Campo (19/10): na BAIXA com vários réus, o executado entrou como "… LTDA - ME" e a lista de
 * Réu do SerasaJUD o mostra como "… LTDA ME". A comparação exata não casou e o CRATOS parou
 * ("não consegui escolher … na lista de Réu").
 *
 * O que se trava aqui:
 *  1. ⛔ Nome com hífen casa com a opção sem hífen — e NÃO com a primeira da lista.
 *  2. Grafia diferente do site (abreviada): casa pela linha da tabela de titulares, achada
 *     pelo DOCUMENTO.
 *  3. ⛔ Nada casa → devolve false e NÃO escolhe "o primeiro" às cegas.
 *  4. O fluxo da baixa passa a grafia da tabela para Autor e Réu.
 *
 * Reprova a 1.6.2. Rodar: node teste-serasajud-nomes.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const falhas = [], oks = [];
const checar = (c, d) => (c ? oks : falhas).push(d);

function montar(opcoes, tabelaTitulares) {
  const dom = new JSDOM(`<!doctype html><body>
    <mat-select id="autor"></mat-select><mat-select id="reu"></mat-select>
    ${tabelaTitulares || ""}</body>`,
    { url: "https://serasa-judicial.serasaexperian.com.br/cadastrar-ordem", runScripts: "outside-only" });
  const w = dom.window;
  const escolhidas = [];
  w.browser = { storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
    runtime: { sendMessage: async () => ({ ok: true }), onMessage: { addListener() {} }, getURL: (p) => p } };
  w.CratosFaixa = { parar() {}, alertar() {}, dizer() {}, mostrar() {} };
  for (const k of ["log", "warn", "error", "debug"]) w.console[k] = () => {};
  w.document.getElementById("reu").addEventListener("click", () => {
    for (const t of opcoes) {
      const o = w.document.createElement("mat-option");
      o.textContent = " " + t + " ";
      o.addEventListener("click", () => escolhidas.push(t));
      w.document.body.appendChild(o);
    }
  });
  w.eval(fs.readFileSync(path.join(SRC, "comum", "storage.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(SRC, "conteudo", "serasajud.js"), "utf8"));
  return { w, api: w.__cratosSerasajud || {}, escolhidas };
}

const OPCOES = ["OUTRO REU FICTICIO", "EMPRESA FICTICIA NEGOCIOS LTDA ME", "FULANO FICTICIO DE SOUZA"];

(async () => {
  {
    const { api, escolhidas } = montar(OPCOES);
    if (typeof api.escolherNoSelect !== "function") {
      checar(false, "⛔ a versão em " + SRC + " não expõe escolherNoSelect com alternativas (sem o conserto de nomes)");
    } else {
      const ok = await api.escolherNoSelect(1, "EMPRESA FICTICIA NEGOCIOS LTDA - ME");
      checar(ok && escolhidas.length === 1 && escolhidas[0] === "EMPRESA FICTICIA NEGOCIOS LTDA ME",
        "⛔ '… LTDA - ME' casa com '… LTDA ME' — e não com a primeira da lista");
    }
  }
  {
    const tabela = `<table><thead><tr><th>Nome</th><th>Documento</th><th>Ações</th></tr></thead><tbody>
      <tr><td>EMP FICT NEG LTDA</td><td>11.222.333/0001-81</td><td></td></tr>
      <tr><td>FULANO FICTICIO DE SOUZA</td><td>123.456.789-09</td><td></td></tr></tbody></table>`;
    const { w, api, escolhidas } = montar(["OUTRO REU FICTICIO", "EMP FICT NEG LTDA"], tabela);
    const grafia = api.grafiaNaTabela
      ? api.grafiaNaTabela(Array.from(w.document.querySelectorAll("tbody tr")), "11222333000181") : null;
    checar(grafia === "EMP FICT NEG LTDA", "grafiaNaTabela: acha o nome que o SITE gravou, pela linha do documento");
    const ok = api.escolherNoSelect ? await api.escolherNoSelect(1, "EMPRESA FICTICIA NEGOCIOS LTDA - ME", [grafia]) : false;
    checar(ok && escolhidas[0] === "EMP FICT NEG LTDA", "grafia abreviada do site: casa pela tabela de titulares");
  }
  {
    const { api, escolhidas } = montar(OPCOES);
    const ok = api.escolherNoSelect ? await api.escolherNoSelect(1, "NINGUEM COM ESTE NOME LTDA") : true;
    checar(ok === false && escolhidas.length === 0, "⛔ nada casa → não escolhe 'o primeiro' às cegas (para)");
  }
  {
    const fonte = fs.readFileSync(path.join(SRC, "conteudo", "serasajud.js"), "utf8");
    checar(/escolherNoSelect\(1, est\.titulares\[0\]\.nome, \[grafiaNaTabela\(linhasTitulares\(\), est\.titulares\[0\]\.cpfcnpj\)\]\)/.test(fonte) &&
      /escolherNoSelect\(0, est\.credor\.nome, \[grafiaCredor\]\)/.test(fonte),
      "o fluxo da baixa passa a grafia da tabela para Réu e Autor");
  }

  console.log("\n=== teste-serasajud-nomes.js ===");
  oks.forEach((d) => console.log("  ok   " + d));
  falhas.forEach((d) => console.log("  FALHA " + d));
  console.log(`\n${oks.length} passaram, ${falhas.length} falharam (${oks.length + falhas.length} asserções)\n`);
  process.exit(falhas.length ? 1 : 0);
})();
