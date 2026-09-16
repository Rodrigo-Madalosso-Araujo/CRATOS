/*
 * teste-infojud-vara.js — a lista de varas do eCAC e a seleção no formulário.
 *
 * O fixture é o HTML REAL do `select[name=siglavara]` (02/09/2026), com as três
 * armadilhas que ele tem de verdade:
 *   1. o `option value` vem preenchido com ESPAÇOS à direita ("001            ");
 *   2. o texto visível tem espaços de sobra no meio;
 *   3. ⛔ quem preenche o campo `nomevara` é o `onchange` da PÁGINA
 *      (`text.split(' - ')[1]`) — setar `.value` sem disparar `change` deixa a
 *      solicitação sair SEM vara.
 *
 * E a regressão que motivou tudo: com texto livre, o casamento era por
 * `includes` e "Vara do Trabalho de Goiânia" (sem ordinal) virava a 1ª, calado.
 *
 * Rodar: node teste-infojud-vara.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const falhas = [];
const oks = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }

/* Trecho fiel do eCAC: espaços no value, espaços no texto, e o onchange real. */
function opt(cod, nome) {
  return `<option value="${cod}                 ">\n  ${cod}                  - ${nome}                    \n</option>`;
}
const HTML = `
<form>
  <select id="nomevara" name="nomevara"><option value=""></option></select>
  <select id="siglavara" name="siglavara">
    <option value=""> -------------------- Selecione -------------------- </option>
    ${opt("001", "1ª Vara do Trabalho de Goiânia")}
    ${opt("002", "2ª Vara do Trabalho de Goiânia")}
    ${opt("011", "11ª Vara do Trabalho de Goiânia")}
    ${opt("083", "3ª VARA DO TRABALHO DE APARECIDA DE GOIÂNIA")}
    ${opt("129", "Vara do Trabalho de Quirinópolis")}
    ${opt("221", "Vara do Trabalho de Goiás")}
  </select>
</form>`;

function montar() {
  const dom = new JSDOM(`<!doctype html><html><body>${HTML}</body></html>`, {
    url: "https://cav.receita.fazenda.gov.br/Servicos/ATSDR/Decjuiz/solicitacao.asp",
    runScripts: "outside-only",
  });
  const w = dom.window;
  const faixas = [];
  w.CratosFaixa = {
    parar: (m, t) => faixas.push(["parar", t]),
    alertar: (m, t) => faixas.push(["alertar", t]),
    dizer: (m, t) => faixas.push(["dizer", t]),
    mostrar: () => {},
  };
  w.browser = {
    storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
               onChanged: { addListener: () => {} } },
    runtime: { sendMessage: async () => ({ ok: true }), onMessage: { addListener: () => {} }, getURL: (p) => p },
  };
  w.console.log = () => {}; w.console.warn = () => {}; w.console.debug = () => {};

  /* Reproduz o onchange do eCAC, que é o ponto 3 das armadilhas. */
  const sig = w.document.getElementById("siglavara");
  sig.addEventListener("change", () => {
    const t = sig.options[sig.selectedIndex].text;
    w.document.getElementById("nomevara").innerHTML =
      `<option value="${(t.split(" - ")[1] || "").trim()}" selected></option>`;
  });

  w.eval(fs.readFileSync(path.join(SRC, "comum", "storage.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(SRC, "conteudo", "ecac-infojud.js"), "utf8"));
  return { w, faixas, sig };
}
const nomevaraDe = (w) => {
  const s = w.document.getElementById("nomevara");
  return s.selectedIndex >= 0 ? String(s.options[s.selectedIndex].value || "") : "";
};

/* Versão sem a função reprova alto. */
{
  const arq = fs.readFileSync(path.join(SRC, "conteudo", "ecac-infojud.js"), "utf8");
  if (!/function selecionarVara\(/.test(arq)) {
    console.log("\n=== teste-infojud-vara.js ===");
    console.log("  FALHA  a versão em " + SRC + " não tem selecionarVara: a vara é casada por " +
      "`includes` sobre texto livre — \"Vara do Trabalho de Goiânia\" sem ordinal " +
      "pega a 1ª, calado, e vara não encontrada só vira console.warn.");
    console.log("\n0 passaram — a suíte inteira reprova nesta versão.\n");
    process.exit(1);
  }
}

/* ── 1. O FORMATO NOVO: código ───────────────────────────────────────────── */
{
  const { w, sig } = montar();
  const ok = w.__cratosEcac.selecionarVara(sig, "011");
  checar(ok === true, "seleciona pelo código");
  checar(sig.value.trim() === "011",
    "⛔ casa apesar dos ESPAÇOS à direita no value do eCAC");
  checar(/11ª Vara do Trabalho de Goiânia/.test(nomevaraDe(w)),
    "⛔ o campo nomevara foi preenchido — prova de que o evento change disparou");
}
{
  const { w, sig } = montar();
  w.__cratosEcac.selecionarVara(sig, "001");
  checar(sig.value.trim() === "001",
    "código 001 não é confundido com 011 nem com 010 (sem includes no código)");
}

/* ── 2. CONFIG ANTIGA: nome colado à mão ─────────────────────────────────── */
{
  const { w, sig } = montar();
  const ok = w.__cratosEcac.selecionarVara(sig, "129 - Vara do Trabalho de Quirinópolis");
  checar(ok === true && sig.value.trim() === "129",
    "config antiga (texto colado) continua funcionando — quem já configurou não fica sem vara");
}
{
  const { w, sig } = montar();
  w.__cratosEcac.selecionarVara(sig, "3ª VARA DO TRABALHO DE APARECIDA DE GOIÂNIA");
  checar(sig.value.trim() === "083",
    "casa a vara que o eCAC grafa em CAIXA ALTA");
}

/* ── 3. A REGRESSÃO QUE MOTIVOU A LISTA ──────────────────────────────────── */
{
  const { w, sig, faixas } = montar();
  const ok = w.__cratosEcac.selecionarVara(sig, "Vara do Trabalho de Goiânia");
  checar(ok === false && !sig.value.trim(),
    "⛔ termo AMBÍGUO não escolhe nada — antes virava a 1ª Vara, em silêncio");
  checar(faixas.some((f) => f[0] === "alertar" && /casa com \d+ varas/.test(f[1])),
    "e diz quantas varas casaram, mandando escolher na lista");
}
{
  const { w, sig, faixas } = montar();
  const ok = w.__cratosEcac.selecionarVara(sig, "Vara do Trabalho de Uberlândia");
  checar(ok === false, "vara inexistente não seleciona nada");
  checar(faixas.some((f) => f[0] === "alertar" && /SEM vara/.test(f[1])),
    "⛔ avisa que a solicitação sairia SEM vara — antes era só um console.warn");
  checar(nomevaraDe(w) === "", "e o nomevara continua vazio, como tem de ser");
}
{
  const { w, sig } = montar();
  checar(w.__cratosEcac.selecionarVara(sig, "") === false, "config vazia não faz nada e não quebra");
}

/* ── 4. A LISTA NAS PREFERÊNCIAS ─────────────────────────────────────────── */
{
  const mod = fs.readFileSync(path.join(SRC, "modulos", "infojud.js"), "utf8");
  const bloco = mod.slice(mod.indexOf("vara: {"), mod.indexOf("vara: {") + 6000);
  const codigos = (bloco.match(/valor: "(\d{3})"/g) || []).map((m) => m.slice(8, 11));
  checar(codigos.length === 51, "as 51 varas do TRT18 estão na lista (vieram do select real)");
  checar(new Set(codigos).size === codigos.length, "sem código repetido");
  ["001", "018", "051", "083", "129", "291"].forEach((c) =>
    checar(codigos.includes(c), "a lista tem a vara " + c));
  checar(/tipo: "lista"/.test(bloco), "o campo virou LISTA suspensa — não é mais texto livre");
  checar(/rotulo: "001 — 1ª Vara do Trabalho de Goiânia"/.test(bloco),
    "o rótulo mostra código E nome, como o eCAC exibe");
  checar(/VARA DO TRABALHO DE PALMEIRAS/.test(bloco),
    "os nomes vão EXATAMENTE como o eCAC grafa, maiúsculas inclusive");

  const op = fs.readFileSync(path.join(SRC, "opcoes", "opcoes.js"), "utf8");
  checar(/o\.valor : o/.test(op) && /o\.rotulo : o/.test(op),
    "a tela de Preferências aceita {valor, rotulo} na lista (guarda o código, mostra o nome)");
}

console.log("\n=== teste-infojud-vara.js ===");
oks.forEach((d) => console.log("  ok   " + d));
falhas.forEach((d) => console.log("  FALHA " + d));
console.log(`\n${oks.length} passaram, ${falhas.length} falharam ` +
  `(${oks.length + falhas.length} asserções)\n`);
process.exit(falhas.length ? 1 : 0);
