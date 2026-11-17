/*
 * teste-painel-leitor.js — leitor de tela e atalho (2.0, passo 4).
 *
 * Trava: um anunciador (role=status, polite, atômico) fala o passo da fila, o início
 * e o fim dela e a Situação lida; o que ele fala nunca leva CPF, CNPJ, número longo
 * ou valor em reais, nem símbolos de enfeite; abrir pelo teclado (Enter no botão) ou
 * pelo atalho Alt+Shift+C leva o foco para a aba selecionada; Esc fecha o painel e
 * devolve o foco ao botão; o fim da fila leva o foco ao relatório quando a pessoa
 * está no painel (e não o rouba do PJe); o manifesto declara o atalho e o fundo o
 * repassa para a aba ativa; axe-core sem violações no painel (abas, menu aberto,
 * diálogo da baixa e desligado; o contraste é medido no teste-tema.js).
 * Reprova o 3c1533b (passo 3) e a 1.9.6.
 */
const fs = require("fs");
const path = require("path");
const { montarPainel } = require("./harness-painel.js");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const NOME = "teste-painel-leitor.js";
const oks = [], falhas = [];
const checar = (c, d) => (c ? oks : falhas).push(d);
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 30));
const espera = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 3000)) { if (fn()) return true; await tick(15); } return false; };
const NUM = "0000001-23.2025.5.18.0008";
const PROC = { id: 1, numero: NUM, partes: [{ nome: "EMPRESA EXEMPLO LTDA", cpfcnpj: "11222333000181", polo: "passivo" }] };
const tecla = (w, el, key) => el.dispatchEvent(new w.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
const DADO = /\d{3}\.\d{3}\.\d{3}-\d{2}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{11,}|R\$/;

let AXE = null;
try { AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8"); } catch (e) { AXE = null; }

function abrir(op) {
  return montarPainel(SRC, Object.assign({
    url: "https://pje.trt18.jus.br/pjekz/processo/1/detalhe",
    responder: async (m) => (m.tipo === "capturar" ? { ok: true, processo: PROC } : undefined),
  }, op || {}));
}
const fala = (a) => { const el = a.r.querySelector("#cx-anuncio"); return el ? el.textContent : ""; };

async function axe(a, rotulo) {
  if (!AXE) { checar(false, "axe-core instalado no ambiente de teste (npm i axe-core)"); return; }
  if (!a.w.axe) a.w.eval(AXE);
  const host = a.d.querySelector("cratos-raiz");
  const r = await a.w.axe.run(host, { rules: { "color-contrast": { enabled: false } } });
  const v = r.violations.map((x) => x.id + " (" + x.nodes.map((n) => [].concat(n.target).join(" > ")).slice(0, 2).join(", ") + ")");
  checar(v.length === 0, `⛔ axe-core sem violações: ${rotulo}${v.length ? " → " + v.join("; ") : ""}`);
}

(async () => {
  {
    const a = abrir();
    if (!a.r.querySelector || !a.r.querySelector("#cx-anuncio")) {
      checar(false, "⛔ o painel tem um anunciador para o leitor de tela (#cx-anuncio)");
      throw new Error("sem anunciador nesta versão");
    }
  }

  /* ── 1. o anunciador ──────────────────────────────────────────────────── */
  {
    const a = abrir();
    const el = a.r.querySelector("#cx-anuncio");
    checar(el.getAttribute("role") === "status" && el.getAttribute("aria-live") === "polite" && el.getAttribute("aria-atomic") === "true",
      "anunciador: role=status, aria-live=polite, aria-atomic");
    checar(el.classList.contains("cx-sr") && a.r.querySelector("cratos-painel").contains(el), "anunciador escondido na tela e dentro do painel");
    a.P.anunciar("⛔ RENAJUD: 111.222.333-96 e 11.222.333/0001-81, 12345678901, R$ 1.234,56 — passo 2 de 3 ✓");
    await tick(90);
    checar(!DADO.test(fala(a)) && /RENAJUD/.test(fala(a)) && /passo 2 de 3/.test(fala(a)) && !/[⛔✓]/.test(fala(a)),
      "⛔ a fala nunca leva CPF, CNPJ, número longo nem R$; símbolos de enfeite saem; contagens ficam");
  }

  /* ── 2. a fila fala ───────────────────────────────────────────────────── */
  {
    const a = abrir();
    a.r.querySelector("cratos-painel").setAttribute("aberto", "");
    a.P.renderProcesso(PROC);
    a.P.irAba("incluir");
    const p = a.r.getElementById("cx-p-incluir");
    p.querySelector('.cx-sel-conv[data-id="RENAJUD"]').checked = true;
    p.querySelector("#cx-executar-selecionados").click();
    await espera(() => !!fala(a), 1500);
    checar(/^Fila de inclusão iniciada, 1 convênio\./.test(fala(a)) && /RENAJUD: Executando/.test(fala(a)),
      "⛔ início da fila e primeiro passo são anunciados juntos (um não apaga o outro)");
    await espera(() => /RENAJUD: Aguardando conclusão/.test(fala(a)), 1500);
    checar(/RENAJUD: Aguardando conclusão/.test(fala(a)) && !/Executando.*Executando/.test(fala(a)), "⛔ o passo da fila é anunciado (\"RENAJUD: Aguardando conclusão…\")");
    /* fim da fila, com o foco no painel: o foco vai para o relatório */
    a.r.getElementById("cx-aba-incluir").focus();
    a.P.ledger = [{ id: "RENAJUD", label: "RENAJUD", status: "ok" }];
    a.P.renderRelatorioFinal();
    await tick(90);
    checar(/^Fila concluída: 1 de 1 convênio concluído\.$/.test(fala(a)), "⛔ o fim da fila é anunciado");
    checar(a.r.activeElement && a.r.activeElement.id === "cx-relatorio", "⛔ com o foco no painel, o fim da fila leva o foco ao relatório");
    checar(!a.r.getElementById("cx-nova-selecao").hidden, "\"Nova seleção\" aparece no fim");
  }
  {
    const a = abrir();
    a.r.querySelector("cratos-painel").setAttribute("aberto", "");
    a.P.renderProcesso(PROC);
    a.P.irAba("incluir");
    const p = a.r.getElementById("cx-p-incluir");
    p.querySelector('.cx-sel-conv[data-id="RENAJUD"]').checked = true;
    p.querySelector("#cx-executar-selecionados").click();
    await tick(30);
    const fora = a.d.createElement("button"); a.d.body.appendChild(fora); fora.focus();
    a.P.ledger = [{ id: "RENAJUD", label: "RENAJUD", status: "ok" }];
    a.P.renderRelatorioFinal();
    checar(a.d.activeElement === fora, "⛔ com o foco no PJe, o fim da fila NÃO puxa o foco");
  }

  /* ── 3. Situação lida ─────────────────────────────────────────────────── */
  {
    const a = abrir({ mem: { "cratos:config": { infojud: { colheitaAutomatica: "nao" } } } });
    a.r.querySelector("cratos-painel").setAttribute("aberto", "");
    a.P.renderProcesso(PROC);
    await espera(() => /Situação lida/.test(fala(a)), 4000);
    checar(/^Situação lida\./.test(fala(a)) && /INFOJUD: configuração pendente/.test(fala(a)), "⛔ a Situação lida é anunciada com o que pede você");
    checar(!DADO.test(fala(a)), "a fala da Situação não leva dado de parte");
  }

  /* ── 4. teclado: abrir, atalho e Esc ──────────────────────────────────── */
  {
    const a = abrir();
    const botao = a.r.querySelector("cratos-botao");
    botao.focus();
    tecla(a.w, botao, "Enter");
    await espera(() => a.r.activeElement && a.r.activeElement.getAttribute("role") === "tab", 1500);
    checar(a.r.activeElement && a.r.activeElement.getAttribute("role") === "tab" && a.r.activeElement.getAttribute("aria-selected") === "true",
      "⛔ Enter no botão abre o painel e põe o foco na aba selecionada");
    tecla(a.w, a.r.activeElement, "Escape");
    checar(!a.r.querySelector("cratos-painel").hasAttribute("aberto") && a.r.activeElement === botao, "⛔ Esc fecha o painel e devolve o foco ao botão");

    const r1 = await a.enviarAba({ tipo: "cratos_atalho" });
    await espera(() => a.r.activeElement && a.r.activeElement.getAttribute("role") === "tab", 1500);
    checar(r1 && r1.ok && a.r.querySelector("cratos-painel").hasAttribute("aberto") && a.r.activeElement.getAttribute("role") === "tab",
      "⛔ o atalho abre o painel e põe o foco na aba selecionada");
    a.P.irAba("coletar");
    a.r.querySelector("#cx-juntar").focus();
    await a.enviarAba({ tipo: "cratos_atalho" });
    checar(a.r.activeElement && a.r.activeElement.id === "cx-aba-coletar", "atalho com o painel aberto: foco volta para a aba");
    checar(a.msgs.filter((m) => m.tipo === "capturar").length === 1, "o atalho não recaptura o mesmo processo");
    checar(/Alt\+Shift\+C/.test(a.r.getElementById("cx-menu-atalhos-area").textContent), "o atalho está listado em \"Atalhos de teclado\"");
  }
  {
    const man = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8"));
    const c = (man.commands || {})["abrir-cratos"];
    checar(c && c.suggested_key && c.suggested_key.default === "Alt+Shift+C" && c.description, "⛔ manifesto: commands \"abrir-cratos\" com Alt+Shift+C");
    checar(!/commands/.test(JSON.stringify(man.permissions || [])), "o atalho não pede permissão nova");
    const bg = fs.readFileSync(path.join(SRC, "background.js"), "utf8");
    checar(/commands\.onCommand\.addListener[\s\S]{0,300}"abrir-cratos"[\s\S]{0,300}tabs\.sendMessage\([^)]*tipo: "cratos_atalho"/.test(bg),
      "o fundo repassa o atalho para a aba ativa");
  }

  /* ── 5. axe-core ──────────────────────────────────────────────────────── */
  {
    const a = abrir();
    a.r.querySelector("cratos-painel").setAttribute("aberto", "");
    a.P.renderProcesso(PROC);
    await espera(() => !!a.r.querySelector("#cx-p-situacao .cx-sit"), 4000);
    await axe(a, "aba Situação");
    a.P.irAba("incluir"); await axe(a, "aba Incluir");
    a.P.irAba("baixar");
    a.r.querySelector('#cx-p-baixar .cx-sel-conv[data-id="RENAJUD"]').checked = true;
    a.r.querySelector("#cx-p-baixar #cx-executar-selecionados").click();
    await axe(a, "diálogo da baixa");
    a.P.irAba("coletar"); await axe(a, "aba Coletar");
    a.P.abrirMenu();
    a.r.getElementById("cx-menu-disp").click();
    a.r.getElementById("cx-menu-atalhos").click();
    await axe(a, "menu ⋯ aberto");
    a.P.fecharMenu();
    a.P.renderDesligado(); await axe(a, "desligado");
    a.P.renderSemProcesso(); await axe(a, "sem processo");
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
