/*
 * teste-serasajud-data.js — a "Data da Dívida" da baixa do SerasaJUD.
 *
 * Bug de campo (11/09, com HAR + DOM + console):
 *  · 1º sintoma: o `preencherData` conferia sucesso lendo `campo.value` — o que o
 *    setter nativo acabou de escrever. Auto-engano: o credor entrava SEM data no
 *    modelo (a página, que exige a data, era enganada pelo value visível).
 *  · 2º sintoma (o que este arquivo passou a travar): a correção usou a régua
 *    `digitos(value) === 8`, pensando em "31/05/2026". Mas o campo, quando o
 *    modelo ACEITA a data, reformata para o padrão en-US SEM zero à esquerda:
 *    "5/31/2026" → 7 dígitos. A régua de 8 reprovava uma data PERFEITA, o
 *    preencherData devolvia false e o fluxo parava na hora do CPF/CNPJ do credor.
 *
 * A verificação honesta: a data está no campo (tem um ano) E o campo está VÁLIDO
 * no modelo (`aria-invalid="false"` / não `ng-invalid`). Nunca contar dígitos —
 * o formato de exibição não é o de entrada.
 *
 * O que se trava aqui:
 *  1. ⛔ Data aceita e reformatada para "5/31/2026" (7 díg.) conta como SUCESSO.
 *  2. ⛔ Se nem o calendário colar, devolve FALSE (fluxo não clica "Adicionar").
 *  3. Setter nativo que efetiva no modelo → sucesso sem abrir o calendário.
 *  4. Data malformada → recusa cedo.
 *
 * Rodar: node teste-serasajud-data.js
 * Versão antiga: CRATOS_SRC=<pasta do xpi> node teste-serasajud-data.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const falhas = [];
const oks = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }

/* Monta o datepicker readOnly + um calendário-mock. O ponto-chave: quando o
   modelo ACEITA a data, o campo passa a exibir "5/31/2026" (en-US, SEM zero à
   esquerda = 7 dígitos) e fica válido (aria-invalid="false"). É o formato real
   visto em campo — e o que reprova a régua de 8 dígitos. */
function montar(opts) {
  opts = opts || {};
  const nativeCommits = !!opts.nativeCommits;
  const calendarCommits = opts.calendarCommits !== false;

  const dom = new JSDOM(
    `<!doctype html><html><body>
       <input id="dd" formcontrolname="dataDivida" readonly
              class="ng-invalid ng-untouched" aria-invalid="true" />
     </body></html>`,
    { url: "https://serasa-judicial.serasaexperian.com.br/cadastrar-ordem", runScripts: "outside-only" });
  const w = dom.window;
  const d = w.document;
  const input = d.querySelector("#dd");   // casa com SEL.credorData

  const state = { toggleClicked: false, dayClicked: false };

  // Efetivar no modelo = reformatar para "5/31/2026" (7 dígitos) e ficar válido.
  const commitNoModelo = () => {
    input.value = "5/31/2026";
    input.setAttribute("aria-invalid", "false");
    input.classList.remove("ng-invalid");
    input.classList.add("ng-valid");
  };

  if (nativeCommits) {
    input.addEventListener("input", () => {
      if (/\d/.test(input.value)) commitNoModelo();
    });
  }

  const toggleWrap = d.createElement("mat-datepicker-toggle");
  const toggleBtn = d.createElement("button");
  toggleBtn.setAttribute("aria-label", "Open calendar");
  toggleBtn.textContent = "cal";
  toggleWrap.appendChild(toggleBtn);
  d.body.appendChild(toggleWrap);

  toggleBtn.addEventListener("click", () => {
    state.toggleClicked = true;
    if (d.querySelector(".mat-calendar-period-button")) return;
    const ov = d.createElement("div");
    ov.className = "cdk-overlay-container";
    ov.innerHTML =
      '<button class="mat-calendar-period-button">2003 – 2026</button>' +
      '<button class="mat-calendar-body-cell"><span class="mat-calendar-body-cell-content">2026</span></button>' +
      '<button class="mat-calendar-body-cell"><span class="mat-calendar-body-cell-content">MAY</span></button>' +
      '<button class="mat-calendar-body-cell"><span class="mat-calendar-body-cell-content">31</span></button>';
    d.body.appendChild(ov);
    const dia = Array.from(ov.querySelectorAll(".mat-calendar-body-cell"))
      .find((c) => (c.textContent || "").trim() === "31");
    dia.addEventListener("click", () => {
      state.dayClicked = true;
      if (calendarCommits) commitNoModelo();
    });
  });

  const mem = {};
  w.browser = {
    storage: { local: { get: async (k) => ({ [k]: mem[k] }), set: async (o) => Object.assign(mem, o), remove: async () => {} } },
    runtime: { sendMessage: async () => ({ ok: true }), onMessage: { addListener() {} }, getURL: (p) => "moz-extension://x/" + p },
    downloads: { download: async () => 1 },
  };
  w.CratosFaixa = { parar() {}, alertar() {}, dizer() {}, mostrar() {} };
  w.console.log = () => {}; w.console.warn = () => {}; w.console.error = () => {};
  w.eval(fs.readFileSync(path.join(SRC, "comum", "storage.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(SRC, "conteudo", "serasajud.js"), "utf8"));
  return { w, input, state };
}

(async () => {

/* Gate: sem o hook, a versão não expõe preencherData — reprova alto e explicando. */
{
  const { w } = montar();
  if (!w.__cratosSerasajud || typeof w.__cratosSerasajud.preencherData !== "function") {
    console.log("\n=== teste-serasajud-data.js ===");
    console.log("  FALHA  a versão em " + SRC + " não expõe __cratosSerasajud.preencherData.");
    console.log("\n0 passaram — a suíte inteira reprova nesta versão.\n");
    process.exit(1);
  }
}

/* ── 1. SETTER NATIVO EFETIVA (reformata p/ 7 dígitos) → sucesso, sem calendário ─ */
{
  const { w, input, state } = montar({ nativeCommits: true, calendarCommits: false });
  const ret = await w.__cratosSerasajud.preencherData("31/05/2026");

  checar(ret === true,
    "⛔ data reformatada '5/31/2026' (7 dígitos) conta como SUCESSO — a régua de 8 reprovava (1.3.2)");
  checar(input.getAttribute("aria-invalid") === "false", "o modelo ficou válido");
  checar(state.toggleClicked === false, "efetivou pelo campo — não abriu o calendário à toa");
}

/* ── 2. NATIVO NÃO EFETIVA, CALENDÁRIO SIM (em 7 dígitos) → sucesso ────────── */
{
  const { w, input, state } = montar({ nativeCommits: false, calendarCommits: true });
  const ret = await w.__cratosSerasajud.preencherData("31/05/2026");

  checar(ret === true,
    "⛔ calendário crava '5/31/2026' (7 dígitos) → SUCESSO (a 1.3.2 reprovava por contar 8)");
  checar(input.getAttribute("aria-invalid") === "false", "campo válido no modelo");
  checar(state.toggleClicked === true, "abriu o calendário quando o setter nativo não efetivou");
  checar(state.dayClicked === true, "clicou o dia no calendário");
}

/* ── 3. NEM UM NEM OUTRO → FALSE (não clica 'Adicionar' sem data) ─────────── */
{
  const { w, state } = montar({ nativeCommits: false, calendarCommits: false });
  const ret = await w.__cratosSerasajud.preencherData("31/05/2026");
  checar(ret === false, "data não efetivada em lugar nenhum → FALSE");
  checar(state.toggleClicked === true, "tentou o calendário antes de desistir");
}

/* ── 4. Data malformada → recusa cedo ─────────────────────────────────────── */
{
  const { w, state } = montar();
  const ret = await w.__cratosSerasajud.preencherData("");
  checar(ret === false, "data vazia/malformada → FALSE");
  checar(state.toggleClicked === false, "não abre o calendário para uma data inválida");
}

console.log("\n=== teste-serasajud-data.js ===");
oks.forEach((d) => console.log("  ok   " + d));
falhas.forEach((d) => console.log("  FALHA " + d));
console.log(`\n${oks.length} passaram, ${falhas.length} falharam ` +
  `(${oks.length + falhas.length} asserções)\n`);
process.exit(falhas.length ? 1 : 0);

})();
