/*
 * teste-sab-marcar-partes.js — o botão "Marcar todas as partes" do SAB.
 *
 * Pedido do Rodrigo (11/09): na tela "Determinação de Bloqueio: Minuta" → passo 1
 * "Seleção de Participantes", um botão que marca de uma vez os checkboxes de
 * autor e réu, em vez de clicar um por um.
 *
 * O DOM (inspeção do Rodrigo): tabela `name="Tabela de Partes"`, uma linha por
 * parte, e o checkbox é um `mat-checkbox` do Angular Material (legacy). A lição do
 * SerasaJUD vale: marcar `input.checked` na mão NÃO entra no modelo — o certo é
 * CLICAR no `label.mat-checkbox-layout`, que o Material processa. E o próprio SAB
 * só aceita 1 credor (marca um, ignora o segundo), então marcamos todos e a
 * página cuida da regra.
 *
 * O que se trava aqui:
 *  1. ⛔ Marca (clicando) todo checkbox de parte que ainda não está marcado.
 *  2. NÃO desmarca os que já estavam marcados (só clica nos não-marcados).
 *  3. Pula os desabilitados (mat-checkbox-disabled).
 *  4. Idempotente: rodar de novo não altera nada.
 *
 * Rodar: node teste-sab-marcar-partes.js
 * Versão antiga: CRATOS_SRC=<pasta do xpi> node teste-sab-marcar-partes.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const falhas = [];
const oks = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }

function montar(partes) {
  const dom = new JSDOM(
    `<!doctype html><html><body>
       <div class="t-container-class">
         <table class="t-class" name="Tabela de Partes">
           <thead></thead>
           <tbody id="cdk-drop-list-0"></tbody>
         </table>
       </div>
     </body></html>`,
    { url: "https://pje.trt18.jus.br/sab/determinacoes/nova/processo/123", runScripts: "outside-only" });
  const w = dom.window;
  const d = w.document;
  const tbody = d.querySelector("tbody");

  // Cria uma linha com um mat-checkbox que ALTERNA a classe ao clicar no label
  // (como o Angular Material faz). Disabled não alterna.
  partes.forEach((p, i) => {
    const tr = d.createElement("tr");
    tr.className = "cdk-drag tr-class ng-star-inserted";
    tr.innerHTML =
      `<td class="td-class">${p.nome}</td>` +
      `<td class="td-class">${p.tipo}</td>` +
      `<td class="td-class">${p.posicao}</td>`;
    const tdCb = d.createElement("td");
    tdCb.className = "td-class";
    const mc = d.createElement("mat-checkbox");
    mc.id = "mat-checkbox-" + i;
    mc.className = "mat-checkbox mat-accent" +
      (p.checked ? " mat-checkbox-checked" : "") +
      (p.disabled ? " mat-checkbox-disabled" : "");
    const label = d.createElement("label");
    label.className = "mat-checkbox-layout";
    const inp = d.createElement("input");
    inp.type = "checkbox";
    inp.className = "mat-checkbox-input";
    label.appendChild(inp);
    mc.appendChild(label);
    label.addEventListener("click", (ev) => {
      ev.preventDefault();
      if (mc.classList.contains("mat-checkbox-disabled")) return;   // não alterna
      mc.classList.toggle("mat-checkbox-checked");
    });
    tdCb.appendChild(mc);
    tr.appendChild(tdCb);
    tbody.appendChild(tr);
  });

  const mem = {};
  w.browser = {
    storage: { local: { get: async (k) => ({ [k]: mem[k] }), set: async (o) => Object.assign(mem, o), remove: async () => {} } },
    runtime: { sendMessage: async () => ({ ok: true }), onMessage: { addListener() {} }, getURL: (p) => "moz-extension://x/" + p },
    downloads: { download: async () => 1 },
  };
  w.CratosFaixa = { parar() {}, alertar() {}, dizer() {}, mostrar() {} };
  w.CHAVES = { config: "config" };
  w.console.log = () => {}; w.console.warn = () => {}; w.console.debug = () => {};
  w.eval(fs.readFileSync(path.join(SRC, "comum", "storage.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(SRC, "conteudo", "sab.js"), "utf8"));
  return { w, d };
}

const checado = (w, i) =>
  w.document.getElementById("mat-checkbox-" + i).classList.contains("mat-checkbox-checked");

(async () => {

/* Gate: sem o hook, a versão não tem o recurso — reprova alto. */
{
  const { w } = montar([{ nome: "A", tipo: "AUTOR", posicao: "CREDOR" }]);
  if (!w.__cratosSab || typeof w.__cratosSab.marcarTodasAsPartes !== "function") {
    console.log("\n=== teste-sab-marcar-partes.js ===");
    console.log("  FALHA  a versão em " + SRC + " não expõe __cratosSab.marcarTodasAsPartes " +
      "(o botão 'Marcar todas as partes' ainda não existe). É o que esta suíte trava.");
    console.log("\n0 passaram — a suíte inteira reprova nesta versão.\n");
    process.exit(1);
  }
}

/* ── 1. Marca autor + réus; respeita já-marcado e desabilitado ────────────── */
{
  const { w } = montar([
    { nome: "MAYCON RENATO REIS", tipo: "AUTOR", posicao: "CREDOR" },              // 0: desmarcado
    { nome: "EXPRESS PRESTACAO LTDA", tipo: "RÉU", posicao: "DEVEDOR" },           // 1: desmarcado
    { nome: "SIQUEIRA E GAIPO LTDA", tipo: "RÉU", posicao: "DEVEDOR", checked: true }, // 2: já marcado
    { nome: "PARTE BLOQUEADA", tipo: "RÉU", posicao: "DEVEDOR", disabled: true },  // 3: desabilitado
  ]);
  const n = w.__cratosSab.marcarTodasAsPartes();

  checar(checado(w, 0), "⛔ marca o AUTOR (credor) que estava desmarcado");
  checar(checado(w, 1), "⛔ marca o RÉU (devedor) que estava desmarcado");
  checar(checado(w, 2), "mantém marcado o que já estava (não desmarca)");
  checar(!checado(w, 3), "pula o checkbox DESABILITADO");
  checar(n === 2, "devolve a contagem de checkboxes que precisaram ser marcados (2)");
}

/* ── 2. Idempotente: rodar de novo não altera nada ────────────────────────── */
{
  const { w } = montar([
    { nome: "A", tipo: "AUTOR", posicao: "CREDOR" },
    { nome: "B", tipo: "RÉU", posicao: "DEVEDOR" },
  ]);
  w.__cratosSab.marcarTodasAsPartes();
  const n2 = w.__cratosSab.marcarTodasAsPartes();
  checar(checado(w, 0) && checado(w, 1), "todas seguem marcadas após a 2ª chamada");
  checar(n2 === 0, "a 2ª chamada não clica em nada (0) — não inverte o que já está marcado");
}

/* ── 3. Injeta o botão na tela de Seleção de Participantes ─────────────────── */
{
  const { w } = montar([{ nome: "A", tipo: "AUTOR", posicao: "CREDOR" }]);
  // o observador do sab.js injeta ao detectar a tabela; forço uma checagem direta
  if (typeof w.__cratosSab.injetarBotaoMarcarPartes === "function") {
    w.__cratosSab.injetarBotaoMarcarPartes();
  }
  const btn = w.document.getElementById("cratos-sab-marcar-partes");
  checar(!!btn, "injeta o botão 'Marcar todas as partes' quando a tabela de partes está na tela");
  checar(btn && /marcar todas as partes/i.test(btn.textContent || ""), "o botão tem o rótulo combinado");
}

console.log("\n=== teste-sab-marcar-partes.js ===");
oks.forEach((d) => console.log("  ok   " + d));
falhas.forEach((d) => console.log("  FALHA " + d));
console.log(`\n${oks.length} passaram, ${falhas.length} falharam ` +
  `(${oks.length + falhas.length} asserções)\n`);
process.exit(falhas.length ? 1 : 0);

})();
