/*
 * teste-painel-abas.js — o painel da 2.0: abas, formulários, menu "⋯" e tema (passo 2).
 *
 * Trava: quatro abas no padrão WAI-ARIA (tablist/tab/tabpanel, só a selecionada no
 * Tab, ← → Home End); Incluir e Baixar são formulários e só o da aba aberta existe
 * na tela, guardando o que foi marcado ao trocar de aba; a baixa pede confirmação
 * num diálogo com o foco em "Voltar" e Esc fecha; a aba da fila vira a linha do
 * tempo e a outra avisa que há fila em andamento; ▲▼ mantêm o foco no convênio que
 * andou; Coletar guarda o que as coletas escreveram; o menu "⋯" abre e fecha com
 * aria-expanded, Esc devolve o foco, traz a disponibilidade, as novidades (com o
 * ponto de aviso), o alto contraste e as Preferências; o tema vem da chave
 * `aparencia`; o botão flutuante e o liga/desliga são botões de verdade; reabrir no
 * mesmo processo não recaptura; nenhuma cor fixa no painel.js. Reprova o ae1886c
 * (passo 1) e a 1.9.6.
 */
const fs = require("fs");
const path = require("path");
const { montarPainel } = require("./harness-painel.js");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const NOME = "teste-painel-abas.js";
const oks = [], falhas = [];
const checar = (c, d) => (c ? oks : falhas).push(d);
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 30));
const NUM = "0000001-23.2025.5.18.0008";
const PROC = {
  id: 1, numero: NUM,
  partes: [
    { nome: "EXEQUENTE EXEMPLO", cpfcnpj: "11122233396", polo: "ativo" },
    { nome: "EMPRESA EXEMPLO LTDA", cpfcnpj: "11222333000181", polo: "passivo" },
  ],
};
const tecla = (w, el, key) => el.dispatchEvent(new w.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

function abrir(op) {
  const a = montarPainel(SRC, Object.assign({
    responder: async (m) => (m.tipo === "capturar" ? { ok: true, processo: PROC } : undefined),
  }, op || {}));
  /* aberto: o navegador (e o jsdom) não dá foco a nada dentro de um painel fechado */
  if (a.r && a.r.querySelector && !(op && op.fechado)) { const p = a.r.querySelector("cratos-painel"); if (p) p.setAttribute("aberto", ""); }
  return a;
}

(async () => {
  {
    const a = abrir();
    if (!a.P || typeof a.P.irAba !== "function") {
      checar(false, "⛔ o painel tem abas (gancho irAba)");
      throw new Error("sem abas nesta versão");
    }
  }

  /* ── 1. estrutura das abas ───────────────────────────────────────────── */
  {
    const a = abrir();
    a.P.renderProcesso(PROC);
    await tick();
    const lista = a.r.querySelector('[role="tablist"]');
    const abas = Array.from(a.r.querySelectorAll('[role="tab"]'));
    checar(!!lista && lista.getAttribute("aria-label"), "uma tablist com nome acessível");
    checar(abas.map((b) => b.textContent.trim()).join("|") === "Situação|Incluir|Baixar|Coletar", "⛔ quatro abas: Situação, Incluir, Baixar, Coletar");
    checar(abas[0].getAttribute("aria-selected") === "true" && abas.slice(1).every((b) => b.getAttribute("aria-selected") === "false"),
      "abre na Situação");
    checar(abas.filter((b) => b.tabIndex === 0).length === 1 && abas[0].tabIndex === 0, "só a aba selecionada entra no Tab");
    const paineis = abas.map((b) => a.r.getElementById(b.getAttribute("aria-controls")));
    checar(paineis.every((p) => p && p.getAttribute("role") === "tabpanel" && p.getAttribute("aria-labelledby")),
      "cada aba controla um tabpanel rotulado por ela");
    checar(!paineis[0].hidden && paineis.slice(1).every((p) => p.hidden), "só o painel da aba selecionada aparece");
    checar(/0000001-23\.2025\.5\.18\.0008/.test(a.r.getElementById("cx-proc-num").textContent), "o número do processo vai para o cabeçalho");

    /* teclado */
    tecla(a.w, abas[0], "ArrowRight");
    checar(abas[1].getAttribute("aria-selected") === "true" && a.r.activeElement === abas[1], "⛔ → vai para Incluir e leva o foco");
    tecla(a.w, abas[1], "End");
    checar(abas[3].getAttribute("aria-selected") === "true" && a.r.activeElement === abas[3], "End vai para a última aba");
    tecla(a.w, abas[3], "ArrowRight");
    checar(abas[0].getAttribute("aria-selected") === "true", "→ na última volta para a primeira");
    tecla(a.w, abas[0], "ArrowLeft");
    checar(abas[3].getAttribute("aria-selected") === "true", "← na primeira vai para a última");
    tecla(a.w, abas[3], "Home");
    checar(abas[0].getAttribute("aria-selected") === "true" && abas[0].tabIndex === 0 && abas[3].tabIndex === -1, "Home volta para a primeira; tabindex acompanha");
  }

  /* ── 2. Incluir / Baixar: um formulário por vez, seleção guardada ─────── */
  {
    const a = abrir();
    a.P.renderProcesso(PROC);
    a.P.irAba("incluir");
    const pInc = a.r.getElementById("cx-p-incluir"), pBx = a.r.getElementById("cx-p-baixar");
    const convs = () => Array.from(a.r.querySelectorAll(".cx-sel-conv"));
    checar(convs().length > 0 && convs().every((c) => pInc.contains(c)), "Incluir: convênios no formulário da aba");
    const partes = Array.from(pInc.querySelectorAll(".cx-sel-parte"));
    checar(partes.length === 2 && !partes[0].checked && partes[1].checked, "Incluir: partes no mesmo formulário (polo ativo desmarcado)");
    const ren = pInc.querySelector('.cx-sel-conv[data-id="RENAJUD"]');
    ren.checked = true; ren.dispatchEvent(new a.w.Event("change", { bubbles: true }));
    checar(/1 convênio · 1 parte/.test(pInc.querySelector("#cx-resumo").textContent), "o rodapé resume a seleção (1 convênio · 1 parte)");
    a.P.irAba("baixar");
    checar(!pInc.querySelector(".cx-sel-conv") && convs().every((c) => pBx.contains(c)), "⛔ ao trocar de aba, só o formulário de Baixar fica na tela");
    checar(!convs().some((c) => ["INFOJUD", "CENSEC", "CCS", "SNIPER", "PREVJUD"].includes(c.dataset.id)), "Baixar: só convênios com baixa");
    a.P.irAba("incluir");
    checar(pInc.querySelector('.cx-sel-conv[data-id="RENAJUD"]').checked, "⛔ voltando a Incluir, o RENAJUD continua marcado");

    /* executar sem convênio → aviso em role=alert */
    pInc.querySelectorAll(".cx-sel-conv").forEach((c) => { c.checked = false; });
    pInc.querySelector("#cx-executar-selecionados").click();
    await tick();
    const msg = pInc.querySelector("#cx-form-msg");
    checar(msg && msg.getAttribute("role") === "alert" && /Selecione ao menos um convênio/.test(msg.textContent),
      "executar sem convênio: aviso em role=alert");

    /* ordem: o foco acompanha o convênio que andou */
    const ids = () => Array.from(pInc.querySelectorAll(".cx-sel-conv")).map((c) => c.dataset.id);
    const antes = ids();
    const desce = pInc.querySelectorAll(".cx-ord-down")[0];
    checar(/Mover .+ para baixo/.test(desce.getAttribute("aria-label") || ""), "▼ tem nome acessível (Mover … para baixo)");
    desce.click();
    const depois = ids();
    checar(depois[1] === antes[0] && depois[0] === antes[1], "▼ troca com o vizinho");
    const foco = a.r.activeElement;
    checar(foco && foco.closest && foco.closest(`.cx-conv[data-conv-id="${antes[0]}"]`), "⛔ o foco fica no convênio que andou");
  }

  /* ── 3. Baixa: diálogo de confirmação, fila, aviso na outra aba ───────── */
  {
    const a = abrir();
    a.P.renderProcesso(PROC);
    a.P.irAba("baixar");
    const pBx = a.r.getElementById("cx-p-baixar");
    const ren = pBx.querySelector('.cx-sel-conv[data-id="RENAJUD"]');
    ren.checked = true;
    const exec = pBx.querySelector("#cx-executar-selecionados");
    checar(/baixa/i.test(exec.textContent), "o botão diz \"Executar baixa\"");
    exec.click();
    const dlg = pBx.querySelector('[role="alertdialog"]');
    checar(!!dlg && dlg.getAttribute("aria-labelledby") && dlg.getAttribute("aria-describedby"), "⛔ a baixa abre um diálogo de confirmação rotulado");
    checar(dlg && /RENAJUD/.test(dlg.textContent), "o diálogo lista os convênios");
    checar(a.r.activeElement && a.r.activeElement.id === "cx-conf-voltar", "⛔ o foco vai para \"Voltar\" (a opção segura)");
    checar(!a.msgs.some((m) => m.tipo === "orquestra_executar"), "nada roda antes de confirmar");
    tecla(a.w, a.r.activeElement, "Escape");
    checar(!pBx.querySelector('[role="alertdialog"]') && a.r.activeElement === exec, "Esc fecha o diálogo e devolve o foco ao \"Executar baixa\"");
    exec.click();
    pBx.querySelector("#cx-conf-ok").click();
    await tick(60);
    checar(a.msgs.some((m) => m.tipo === "orquestra_executar" && m.convenioId === "RENAJUD"), "confirmar põe a fila para andar");
    checar(!!pBx.querySelector("#cx-progresso") && !pBx.querySelector(".cx-sel-conv"), "⛔ a aba Baixar vira a linha do tempo da fila");
    checar(a.P.filaNaAba === "baixa" && a.P.filaRodando, "a fila está marcada como em andamento na aba Baixar");
    a.P.irAba("incluir");
    const pInc = a.r.getElementById("cx-p-incluir");
    checar(/fila de baixa em andamento/.test(pInc.textContent) && !pInc.querySelector(".cx-sel-conv"), "⛔ Incluir avisa que há fila de baixa em andamento (sem formulário)");
    a.P.irAba("baixar");
    checar(!!pBx.querySelector("#cx-progresso"), "voltar a Baixar mostra a fila de novo");
    checar(a.r.querySelectorAll("#cx-progresso").length === 1, "um só #cx-progresso no painel");
  }

  /* ── 4. Coletar guarda o que foi escrito ──────────────────────────────── */
  {
    const a = abrir();
    a.P.renderProcesso(PROC);
    a.P.irAba("coletar");
    const p = a.r.getElementById("cx-p-coletar");
    checar(["#cx-localizar", "#cx-coletar-ccs", "#cx-coletar-prevjud", "#cx-coletar-sab", "#cx-juntar"].every((s) => p.querySelector(s)),
      "Coletar: INFOJUD, CCS, PREVJUD, SAB e a juntada");
    checar(p.querySelectorAll("h2, h3").length >= 5, "Coletar: cada convênio com título (navegação por títulos no NVDA)");
    p.querySelector("#cx-ccs-status").textContent = "3 de 5 responderam";
    a.P.irAba("situacao");
    a.P.irAba("coletar");
    checar(p.querySelector("#cx-ccs-status").textContent === "3 de 5 responderam", "⛔ trocar de aba não apaga o resultado da coleta");
  }

  /* ── 5. Menu "⋯" ───────────────────────────────────────────────────────── */
  {
    const a = abrir({ mem: { "cratos:novidades_pendente": { de: "1.9.5", para: "1.9.6" }, "cratos:config": { infojud: { colheitaAutomatica: "nao" } } }, versao: "1.9.6" });
    a.P.renderProcesso(PROC);
    await tick(80);
    const mais = a.r.getElementById("cx-mais"), menu = a.r.getElementById("cx-menu");
    checar(mais.tagName === "BUTTON" && mais.getAttribute("aria-label") && mais.getAttribute("aria-controls") === "cx-menu", "⋯ é um botão com nome e aria-controls");
    checar(mais.getAttribute("aria-expanded") === "false" && menu.hidden, "o menu começa fechado");
    mais.click();
    checar(mais.getAttribute("aria-expanded") === "true" && !menu.hidden, "⛔ clicar abre o menu (aria-expanded=true)");
    checar(menu.contains(a.r.activeElement), "o foco entra no menu");
    tecla(a.w, a.r.activeElement, "Escape");
    checar(menu.hidden && a.r.activeElement === mais, "⛔ Esc fecha o menu e devolve o foco ao ⋯");
    checar(!!menu.querySelector("#cx-disp-conv") && !!menu.querySelector("#cx-disp-verificar"), "a disponibilidade mora no menu");
    if (typeof a.w.CratosNovidades !== "undefined") {
      checar(!!menu.querySelector("#cx-novidades") && !a.r.getElementById("cx-p-situacao").querySelector("#cx-novidades"),
        "as novidades moram no menu, não no corpo");
      checar(!a.r.getElementById("cx-mais-ponto").hidden && /novidades/.test(a.r.getElementById("cx-mais-sr").textContent),
        "⛔ o ⋯ ganha um ponto (e o texto \"há novidades\" para o leitor de tela)");
      menu.querySelector("#cx-novidades-ok").click();
      await tick(30);
      checar(a.r.getElementById("cx-mais-ponto").hidden, "\"Entendi\" apaga o ponto");
    }
    mais.click();
    menu.querySelector("#cx-menu-pref").click();
    await tick();
    checar(a.msgs.some((m) => m.tipo === "abrir_preferencias") && menu.hidden, "Preferências: pede ao fundo para abrir e fecha o menu");
    const bg = fs.readFileSync(path.join(SRC, "background.js"), "utf8");
    checar(/case "abrir_preferencias":[\s\S]{0,160}openOptionsPage/.test(bg), "o fundo abre as Preferências");
    /* clique fora fecha */
    mais.click();
    a.r.getElementById("cx-aba-incluir").click();
    checar(menu.hidden, "clicar fora do menu fecha o menu");
  }

  /* ── 6. Tema ──────────────────────────────────────────────────────────── */
  {
    const a = abrir();
    a.P.renderProcesso(PROC);
    await tick();
    const painel = a.r.querySelector("cratos-painel");
    checar(painel.classList.contains("t-escuro"), "tema padrão: escuro");
    await a.w.Store.set("aparencia", { tema: "claro" });
    await tick();
    checar(painel.classList.contains("t-claro") && !painel.classList.contains("t-escuro"), "⛔ a chave `aparencia` troca o tema ao vivo");
    const b = a.r.getElementById("cx-menu-contraste");
    checar(b && b.getAttribute("aria-pressed") === "false", "Alto contraste é um botão de alternância (aria-pressed)");
    b.click();
    await tick();
    checar(painel.classList.contains("t-hc") && b.getAttribute("aria-pressed") === "true" && (a.mem["cratos:aparencia"] || {}).tema === "alto-contraste",
      "⛔ Alto contraste liga, grava e pressiona");
    a.r.getElementById("cx-menu-contraste").click();
    await tick();
    checar(painel.classList.contains("t-claro") && (a.mem["cratos:aparencia"] || {}).tema === "claro", "desligar volta ao tema de antes (claro)");
    const js = fs.readFileSync(path.join(SRC, "conteudo", "painel.js"), "utf8");
    const fixas = js.match(/#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b(?![-\w])/g) || [];
    checar(fixas.length === 0, "⛔ nenhuma cor fixa no painel.js (tudo pelas variáveis do tema): " + fixas.slice(0, 4).join(" "));
  }

  /* ── 7. Botão flutuante, liga/desliga e reabertura ────────────────────── */
  {
    const a = abrir({ fechado: true });
    await tick();
    const botao = a.r.querySelector("cratos-botao");
    checar(botao.getAttribute("role") === "button" && botao.tabIndex === 0 && botao.getAttribute("aria-label"),
      "⛔ o botão flutuante entra no Tab e tem nome (role=button)");
    tecla(a.w, botao, "Enter");
    await tick(60);
    const painel = a.r.querySelector("cratos-painel");
    checar(painel.hasAttribute("aberto") && botao.getAttribute("aria-expanded") === "true", "⛔ Enter no botão abre o painel (aria-expanded=true)");
    const capturas = () => a.msgs.filter((m) => m.tipo === "capturar").length;
    checar(capturas() === 1 && !!a.r.getElementById("cx-p-situacao"), "a primeira abertura captura o processo");
    a.P.irAba("coletar");
    a.r.querySelector(".cx-fechar").click();
    checar(!painel.hasAttribute("aberto") && botao.getAttribute("aria-expanded") === "false", "fechar fecha (aria-expanded=false)");
    tecla(a.w, botao, " ");
    await tick(60);
    checar(capturas() === 1 && a.P.abaAtual === "coletar", "⛔ reabrir no mesmo processo não recaptura e volta na mesma aba");
    const power = a.r.querySelector(".cx-power");
    checar(power.tagName === "BUTTON" && power.getAttribute("aria-pressed") === "true", "liga/desliga é botão de alternância (aria-pressed)");
    power.click();
    await tick();
    checar(power.getAttribute("aria-pressed") === "false" && /desligado/i.test(a.P.corpo.textContent) && !!a.r.getElementById("cx-religar"),
      "desligado: aria-pressed=false e um botão \"Ligar o CRATOS\" no corpo");
  }

  console.log(`\n=== ${NOME} ===`);
  oks.forEach((x) => console.log("  ok   " + x));
  falhas.forEach((x) => console.log("  FALHA " + x));
  console.log(`\n${oks.length} passaram, ${falhas.length} falharam (${oks.length + falhas.length} asserções)\n`);
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => {
  console.log(`\n=== ${NOME} ===`);
  oks.forEach((x) => console.log("  ok   " + x));
  falhas.forEach((x) => console.log("  FALHA " + x));
  console.log("FALHA geral: " + e.message);
  console.log(`\n${oks.length} passaram, ${falhas.length + 1} falharam\n`);
  process.exit(1);
});
