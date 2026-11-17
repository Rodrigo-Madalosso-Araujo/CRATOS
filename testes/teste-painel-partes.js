/*
 * teste-painel-partes.js — partes antes dos convênios e a janela "Escolher partes"
 * (2.0, pedido do Rodrigo em 17/11: há processos com cem partes ou mais).
 *
 * Trava: no formulário de Incluir e de Baixar, as partes vêm ANTES dos convênios e o
 * rodapé diz "N partes · N convênios"; até seis partes, a lista fica no formulário; a
 * partir de sete, um resumo ("x de y marcadas", os primeiros nomes) e o botão
 * "Escolher partes…", que abre um diálogo de verdade: rotulado, foco na busca, Tab
 * preso, Esc e Cancelar desfazem, Confirmar grava, o foco volta ao botão; a lista é
 * inteira (sem paginar), a busca exige cada palavra em qualquer ordem e aceita
 * número de documento; o filtro de polo; "Marcar/Desmarcar todo o polo passivo"
 * alterna, diz o que o clique vai fazer e vale para o polo inteiro mesmo com busca;
 * "Desmarcar todas"; a fila recebe exatamente as partes escolhidas; axe-core sem
 * violações com a janela aberta. Dados fictícios. Reprova o b485ebb e a 1.9.6.
 */
const fs = require("fs");
const path = require("path");
const { montarPainel } = require("./harness-painel.js");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const NOME = "teste-painel-partes.js";
const oks = [], falhas = [];
const checar = (c, d) => (c ? oks : falhas).push(d);
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 30));
const espera = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 2000)) { if (fn()) return true; await tick(15); } return false; };
const tecla = (w, el, key, shift) => el.dispatchEvent(new w.KeyboardEvent("keydown", { key, shiftKey: !!shift, bubbles: true, cancelable: true }));
let AXE = null;
try { AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8"); } catch (e) { AXE = null; }

function proc(n) {
  const partes = [];
  for (let i = 1; i <= n; i++) {
    const ativo = i <= 2;
    const pj = !ativo && i % 5 === 0;
    const k = String(i).padStart(3, "0");
    partes.push({
      nome: ativo ? `EXEQUENTE FICTICIO ${k}` : pj ? `EMPRESA FICTICIA ${k} LTDA` : `EXECUTADO FICTICIO ${k}`,
      cpfcnpj: pj ? "900000" + String(i).padStart(8, "0") : "900" + String(i).padStart(8, "0"),
      polo: ativo ? "ATIVO" : "PASSIVO",
    });
  }
  return { id: 1, numero: "0000001-23.2025.5.18.0008", partes };
}
function abrir(n) {
  const P = proc(n);
  const a = montarPainel(SRC, {
    url: "https://pje.trt18.jus.br/pjekz/processo/1/detalhe",
    responder: async (m) => (m.tipo === "capturar" ? { ok: true, processo: P } : undefined),
  });
  a.r.querySelector("cratos-painel").setAttribute("aberto", "");
  a.P.renderProcesso(P);
  return a;
}
const antesDe = (a, b) => !!(a && b && (a.compareDocumentPosition(b) & 4));

(async () => {
  {
    const a = abrir(3);
    if (!a.P || typeof a.P.abrirEscolhaPartes !== "function") {
      checar(false, "⛔ o painel tem a janela \"Escolher partes\"");
      throw new Error("sem a janela nesta versão");
    }
  }

  /* ── 1. ordem e resumo (3 partes) ─────────────────────────────────────── */
  for (const aba of ["incluir", "baixar"]) {
    const a = abrir(3);
    a.P.irAba(aba);
    const p = a.r.getElementById("cx-p-" + aba);
    const hPartes = p.querySelector('[id^="cx-h-partes-"]'), hConv = p.querySelector('[id^="cx-h-conv-"]');
    checar(antesDe(hPartes, hConv) && antesDe(p.querySelector(".cx-sel-parte"), p.querySelector(".cx-sel-conv")),
      `⛔ ${aba}: as partes vêm antes dos convênios (títulos e caixas)`);
    const r = p.querySelector("#cx-resumo").textContent;
    checar(/^1 parte · 0 convênios$/.test(r), `${aba}: o rodapé começa pelas partes ("${r}")`);
  }

  /* ── 2. limite: 6 no formulário, 7 vira resumo ────────────────────────── */
  {
    const a = abrir(6);
    a.P.irAba("incluir");
    const p = a.r.getElementById("cx-p-incluir");
    checar(p.querySelectorAll(".cx-sel-parte").length === 6 && !p.querySelector("#cx-escolher-partes"), "seis partes: a lista fica no formulário");
    checar(a.P.LIMITE_PARTES_NA_TELA === 6, "o limite é seis");
  }
  {
    const a = abrir(7);
    a.P.irAba("incluir");
    const p = a.r.getElementById("cx-p-incluir");
    const b = p.querySelector("#cx-escolher-partes");
    checar(!p.querySelector(".cx-sel-parte") && !!b, "⛔ sete partes: resumo e botão \"Escolher partes…\" no lugar da lista");
    checar(b && b.getAttribute("aria-haspopup") === "dialog", "o botão avisa que abre um diálogo");
    checar(/^5 de 7 marcadas$/.test(p.querySelector("#cx-partes-cont").textContent), "o resumo conta as marcadas (polo ativo desmarcado de saída)");
    checar(/EXECUTADO FICTICIO 003, EXECUTADO FICTICIO 004, EMPRESA FICTICIA 005 LTDA e mais 2\./.test(p.querySelector("#cx-partes-nomes").textContent),
      "o resumo diz os primeiros nomes e quantos faltam");
    checar(antesDe(p.querySelector("#cx-escolher-partes"), p.querySelector(".cx-sel-conv")), "o resumo também vem antes dos convênios");
  }

  /* ── 3. a janela, com 150 partes ──────────────────────────────────────── */
  {
    const a = abrir(150);
    a.P.irAba("incluir");
    const p = a.r.getElementById("cx-p-incluir");
    const botao = p.querySelector("#cx-escolher-partes");
    botao.click();
    const dlg = a.r.querySelector('.cx-modal[role="dialog"]');
    checar(!!dlg && dlg.getAttribute("aria-modal") === "true" && a.r.getElementById(dlg.getAttribute("aria-labelledby")) &&
      a.r.getElementById(dlg.getAttribute("aria-describedby")), "⛔ a janela é um diálogo rotulado e descrito");
    checar(a.r.activeElement && a.r.activeElement.id === "cx-pp-busca", "o foco entra na busca");
    const caixas = () => Array.from(dlg.querySelectorAll(".cx-pp-sel"));
    const visiveis = () => Array.from(dlg.querySelectorAll(".cx-pp-item")).filter((li) => !li.hidden);
    checar(caixas().length === 150, "⛔ a lista é inteira (150 caixas, sem paginar)");
    const cont = () => a.r.getElementById("cx-pp-cont").textContent;
    checar(cont() === "148 de 150 marcadas" && a.r.getElementById("cx-pp-cont").getAttribute("role") === "status", "o contador começa pela regra de sempre (passivo marcado) e é falado");

    /* busca */
    const busca = a.r.getElementById("cx-pp-busca");
    busca.value = "empresa 010"; busca.dispatchEvent(new a.w.Event("input"));
    await tick(300);
    checar(visiveis().length === 1 && /EMPRESA FICTICIA 010/.test(visiveis()[0].textContent), "⛔ a busca exige cada palavra, em qualquer ordem (\"empresa 010\")");
    checar(/^1 parte na lista$/.test(a.r.getElementById("cx-pp-res").textContent), "o resultado da busca é anunciado");
    busca.value = "90000000000025"; busca.dispatchEvent(new a.w.Event("input"));
    await tick(300);
    checar(visiveis().length === 1 && /025/.test(visiveis()[0].textContent), "a busca acha pelo número do documento");
    busca.value = "ninguem assim"; busca.dispatchEvent(new a.w.Event("input"));
    await tick(300);
    checar(visiveis().length === 0 && !a.r.getElementById("cx-pp-vazio").hidden, "sem resultado: aviso visível");
    busca.value = ""; busca.dispatchEvent(new a.w.Event("input"));
    await tick(300);

    /* polo */
    const polo = (v) => { const r = dlg.querySelector(`input[name="cx-pp-polo"][value="${v}"]`); r.checked = true; r.dispatchEvent(new a.w.Event("change")); };
    polo("ativo");
    checar(visiveis().length === 2 && visiveis().every((li) => /ATIVO/.test(li.textContent)), "filtro: só o polo ativo");
    polo("passivo");
    checar(visiveis().length === 148, "filtro: só o polo passivo");
    polo("todos");

    /* alternar o polo passivo */
    const bp = a.r.getElementById("cx-pp-passivo");
    checar(bp.textContent === "Desmarcar todo o polo passivo", "⛔ com o passivo todo marcado, o botão diz \"Desmarcar todo o polo passivo\"");
    busca.value = "empresa"; busca.dispatchEvent(new a.w.Event("input"));
    await tick(300);
    bp.click();
    checar(cont() === "0 de 150 marcadas", "⛔ o botão vale para o polo passivo inteiro, mesmo com a busca filtrando");
    checar(bp.textContent === "Marcar todo o polo passivo", "e passa a dizer \"Marcar todo o polo passivo\"");
    bp.click();
    checar(cont() === "148 de 150 marcadas", "marcar de novo volta ao polo passivo inteiro");
    a.r.getElementById("cx-pp-nenhuma").click();
    checar(cont() === "0 de 150 marcadas", "\"Desmarcar todas\" desmarca tudo");
    busca.value = ""; busca.dispatchEvent(new a.w.Event("input"));
    await tick(300);

    /* Tab preso */
    const ultimo = a.r.getElementById("cx-pp-ok");
    ultimo.focus(); tecla(a.w, ultimo, "Tab");
    checar(a.r.activeElement === busca, "⛔ Tab no último volta ao primeiro (o foco fica na janela)");
    tecla(a.w, busca, "Tab", true);
    checar(a.r.activeElement === ultimo, "Shift+Tab no primeiro vai ao último");

    /* axe */
    if (AXE) {
      if (!a.w.axe) a.w.eval(AXE);
      const r = await a.w.axe.run(a.d.querySelector("cratos-raiz"), { rules: { "color-contrast": { enabled: false } } });
      checar(r.violations.length === 0, "⛔ axe-core sem violações com a janela aberta" + (r.violations.length ? ": " + r.violations.map((v) => v.id).join(", ") : ""));
    } else checar(false, "axe-core instalado no ambiente de teste");

    /* Cancelar desfaz */
    a.r.getElementById("cx-pp-cancelar").click();
    checar(!a.r.querySelector(".cx-modal") && a.P.selPartes.filter(Boolean).length === 148 && a.r.activeElement === botao,
      "⛔ Cancelar desfaz o que mudou, fecha e devolve o foco ao botão");

    /* Esc também desfaz */
    botao.click();
    a.r.getElementById("cx-pp-nenhuma").click();
    tecla(a.w, a.r.getElementById("cx-pp-busca"), "Escape");
    checar(!a.r.querySelector(".cx-modal") && a.P.selPartes.filter(Boolean).length === 148, "Esc desfaz e fecha");

    /* Confirmar grava: só três executados */
    botao.click();
    a.r.getElementById("cx-pp-nenhuma").click();
    for (const i of [2, 10, 149]) { const c = a.r.querySelector(`.cx-pp-sel[data-idx="${i}"]`); c.checked = true; c.dispatchEvent(new a.w.Event("change")); }
    checar(cont() === "3 de 150 marcadas", "o contador acompanha cada caixa");
    a.r.getElementById("cx-pp-ok").click();
    checar(!a.r.querySelector(".cx-modal") && a.r.activeElement === botao, "Confirmar fecha e devolve o foco");
    checar(/^3 de 150 marcadas$/.test(p.querySelector("#cx-partes-cont").textContent) && /^3 partes · 0 convênios$/.test(p.querySelector("#cx-resumo").textContent),
      "⛔ o formulário mostra a nova escolha");
    await tick(90);
    checar(/3 de 150 partes marcadas/.test(a.r.getElementById("cx-anuncio").textContent), "a escolha confirmada é anunciada");

    /* a seleção sobrevive à troca de aba */
    a.P.irAba("baixar"); a.P.irAba("incluir");
    checar(/^3 de 150 marcadas$/.test(a.r.getElementById("cx-p-incluir").querySelector("#cx-partes-cont").textContent), "a escolha continua ao trocar de aba");

    /* a fila recebe exatamente essas partes */
    const pi = a.r.getElementById("cx-p-incluir");
    pi.querySelector('.cx-sel-conv[data-id="RENAJUD"]').checked = true;
    pi.querySelector("#cx-executar-selecionados").click();
    await espera(() => a.msgs.some((m) => m.tipo === "orquestra_executar"), 2000);
    const ex = a.msgs.find((m) => m.tipo === "orquestra_executar");
    const nomes = ex && ex.ctx && ex.ctx.partes.map((x) => x.nome);
    checar(nomes && nomes.join("|") === "EXECUTADO FICTICIO 003|EXECUTADO FICTICIO 011|EMPRESA FICTICIA 150 LTDA",
      "⛔ a fila recebe exatamente as partes escolhidas na janela");
  }

  /* ── 4. a demonstração tem o processo grande ──────────────────────────── */
  {
    const demo = fs.readFileSync(path.join(SRC, "demo", "demo-simulado.js"), "utf8");
    const html = fs.readFileSync(path.join(SRC, "demo", "demo.html"), "utf8");
    checar(/i <= 150/.test(demo) && /idProcesso=2/.test(html), "a demonstração tem um processo fictício com 150 partes");
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
