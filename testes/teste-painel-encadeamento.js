/*
 * teste-painel-encadeamento.js — a fila anda sozinha (1.2.0)?
 *
 * A ideia do Rodrigo: a extensão detecta que o convênio terminou pela CHEGADA da
 * certidão e passa para o próximo, sem o clique em "Concluí". O botão fica de
 * reserva. E o fork que ele confirmou: consulta incompleta SEGUE e sinaliza (não
 * trava a fila); ATO incompleto TRAVA (não se atropela penhora pela metade).
 *
 * Esta suíte NÃO testa cópia: ela eval o painel.js REAL num jsdom, monta uma
 * fila pelo gancho `__cratosPainel`, e dispara os pulsos de conclusão via
 * `Store.set("orq_conv_feito", …)` — exatamente como o background/content script
 * fariam. O storage falso propaga o `onChanged`, que é o fio de que o
 * auto-avanço depende.
 *
 * Reprova a versão anterior: lá só o SAB andava sozinho, não havia pulso, ledger
 * nem relatório — e o gancho `__cratosPainel` não existe.
 *
 * Rodar: node teste-painel-encadeamento.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const falhas = [];
const oks = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 40));

const NUM = "0000001-23.2025.5.18.0008";

function montar() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://pje.trt18.jus.br/pjekz/processo/1",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window;

  /* storage.local de verdade: guarda em memória E dispara onChanged. É isso que
     faz o Store.onChange do painel funcionar — sem propagação, o auto-avanço
     nunca acontece e a suíte não mediria nada. */
  const mem = {};
  const listeners = [];
  const dispara = (changes) => { listeners.slice().forEach((l) => { try { l(changes, "local"); } catch (e) {} }); };
  w.browser = {
    storage: {
      local: {
        get: async (k) => {
          if (k == null) return Object.assign({}, mem);
          if (Array.isArray(k)) { const o = {}; k.forEach((x) => (o[x] = mem[x])); return o; }
          return { [k]: mem[k] };
        },
        set: async (o) => {
          const changes = {};
          for (const k of Object.keys(o)) { changes[k] = { oldValue: mem[k], newValue: o[k] }; mem[k] = o[k]; }
          dispara(changes);
        },
        remove: async (k) => {
          const ks = Array.isArray(k) ? k : [k];
          const changes = {};
          ks.forEach((x) => { changes[x] = { oldValue: mem[x], newValue: undefined }; delete mem[x]; });
          dispara(changes);
        },
      },
      onChanged: {
        addListener: (fn) => listeners.push(fn),
        removeListener: (fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
      },
    },
    runtime: {
      getURL: (p) => p,
      getManifest: () => ({ version: "teste" }),
      onMessage: { addListener: () => {}, removeListener: () => {} },
      sendMessage: async (msg) => {
        if (!msg) return { ok: true };
        msgs.push(msg);
        if (msg.tipo === "orquestra_executar") {
          const r = respostas[msg.convenioId];
          enviados.push(msg.convenioId);
          return r || { ok: true, aguardando: true };
        }
        if (msg.tipo === "diario_ler") return { ok: true, certidoes: [] };  // juntada sai cedo
        return { ok: true };
      },
    },
  };
  w.console.log = () => {}; w.console.warn = () => {}; w.console.error = () => {}; w.console.debug = () => {};

  const respostas = {};   // convenioId -> resposta do orquestra_executar
  const enviados = [];    // ordem em que os convênios foram disparados
  const msgs = [];        // toda mensagem enviada ao background (p/ ver orq_fechar_aba)

  /* colheita do INFOJUD desligada no harness: aqui medimos o ENCADEAMENTO, não a
     caixa postal — e a colheita de verdade bate no background, fora deste teste. */
  mem["cratos:config"] = { infojud: { colheitaAutomatica: "nao" } };

  w.eval(fs.readFileSync(path.join(SRC, "comum", "storage.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(SRC, "comum", "relatorio.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(SRC, "comum", "faixa.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(SRC, "conteudo", "painel.js"), "utf8"));

  return { w, respostas, enviados, mem, msgs };
}

/* Convênios como o painel os conhece (mesmos ids/tipos do catálogo real). */
const CONV = {
  INFOJUD:   { id: "INFOJUD",   label: "INFOJUD (eCAC)",          tipo: "automatico", ops: ["consulta"] },
  RENAJUD:   { id: "RENAJUD",   label: "RENAJUD",                 tipo: "interativo", ops: ["inclusao", "baixa"] },
  CENSEC:    { id: "CENSEC",    label: "CENSEC",                  tipo: "interativo", ops: ["consulta"] },
  SERASAJUD: { id: "SERASAJUD", label: "SerasaJUD",              tipo: "interativo", ops: ["inclusao", "baixa"] },
  CNIB:      { id: "CNIB",      label: "CNIB (Indisponibilidade)", tipo: "interativo", ops: ["inclusao", "baixa"] },
};

function ctxPadrao() {
  return { idProcesso: 123, numeroProcesso: NUM, base: "https://pje.trt18.jus.br", partes: [{ nome: "FULANO DE TAL" }], xsrfToken: "" };
}

/* Prepara o painel numa fila dada e roda até o primeiro convênio interativo
   ficar aguardando. `esperados` (por id ou número, p/ fila de 1) vai no dispatch,
   como o módulo real faria. */
async function iniciar(fila, modo, esperados) {
  const amb = montar();
  const P = amb.w.__cratosPainel;
  if (!P) return { ...amb, P: null };
  fila.forEach((c) => {
    const esp = (esperados && typeof esperados === "object") ? esperados[c.id] : esperados;
    amb.respostas[c.id] = { ok: true, aguardando: true, esperados: esp };
  });
  P.setProcesso({ numero: NUM, id: 123 });
  P.setModo(modo || "inclusao");
  amb.w.document.querySelector(".cx-corpo").innerHTML = '<div id="cx-progresso"></div>';
  P.fila = fila;
  P.idx = 0;
  P.ledger = [];
  P.renderProgresso();
  await P.rodarProximoConvenio(ctxPadrao());
  await tick();
  return { ...amb, P };
}

// CHEGADA de artefato (o que o background emite por PDF): leva `arquivo`.
const arrival = (w, convenio, arquivo) =>
  w.Store.set("orq_conv_feito", { convenio, numProcesso: NUM, ok: true, arquivo, em: Date.now() });
// TERMINAL do convênio (INFOJUD/CNIB): sem `arquivo`.
const terminal = (w, o) => w.Store.set("orq_conv_feito", Object.assign({ numProcesso: NUM, em: Date.now() }, o));
const relatorioTxt = (w) => {
  const el = w.document.getElementById("cx-relatorio");
  return el ? el.textContent : "";
};
const botao = (w) => {
  const a = w.document.getElementById("cx-concluir-area");
  return a ? a.querySelector("button") : null;
};
const botaoPular = (w) => {
  const a = w.document.getElementById("cx-concluir-area");
  if (!a) return null;
  return Array.from(a.querySelectorAll("button")).find((b) => /Pular/.test(b.textContent)) || null;
};

(async () => {

/* ── 0. A VERSÃO SEM O ENCADEAMENTO REPROVA ALTO ─────────────────────────── */
{
  const amb = montar();
  if (!amb.w.__cratosPainel) {
    console.log("\n=== teste-painel-encadeamento.js ===");
    console.log("  FALHA  a versão em " + SRC + " não tem o encadeamento (1.2.0): sem " +
      "__cratosPainel, sem pulso orq_conv_feito, sem ledger/relatório. Só o SAB " +
      "andava sozinho; os demais interativos travavam esperando o clique.");
    console.log("\n0 passaram — a suíte inteira reprova nesta versão.\n");
    process.exit(1);
  }
}

/* ── 1. UMA CERTIDÃO ESPERADA → 1 CHEGA → AVANÇA (SerasaJUD) ──────────────── */
{
  const { w, P } = await iniciar([CONV.SERASAJUD], "inclusao", 1);
  checar(P.idx === 0, "antes da certidão, a fila espera (não avançou no dispatch)");
  checar(!!botao(w), "e o botão de reserva está na tela");
  await arrival(w, "SERASAJUD", "SERASAJUD.pdf");
  await tick();
  checar(P.idx === 1, "⛔ chegou a certidão esperada → a fila AVANÇA sozinha, sem clique");
  const l = P.ledger.find((e) => e.id === "SERASAJUD");
  checar(l && l.status === "ok" && /auto/.test(l.detalhe), "⛔ o ledger registra conclusão automática");
  checar(/1 convênio/.test(relatorioTxt(w)) && /1 concluído/.test(relatorioTxt(w)),
    "o relatório de fim de fila aparece e conta 1 concluído");
}

/* ── 2. DOIS EXECUTADOS → ESPERA DUAS CERTIDÕES → AVANÇA (o pedido do Rodrigo) ─ */
{
  const { w, P } = await iniciar([CONV.RENAJUD], "inclusao", 2);
  await arrival(w, "RENAJUD", "0001769 GERLANIO RENAJUD Inclusao.pdf");
  await tick();
  checar(P.idx === 0, "⛔ com 2 esperadas e SÓ 1 folha, a fila AINDA espera (o bug de campo)");
  checar(!!botao(w), "o botão segue lá enquanto espera a 2ª");
  // reenvio da MESMA folha não conta como a segunda
  await arrival(w, "RENAJUD", "0001769 GERLANIO RENAJUD Inclusao.pdf");
  await tick();
  checar(P.idx === 0, "⛔ reenvio do MESMO arquivo não completa (conta distintos)");
  await arrival(w, "RENAJUD", "0001769 TECX RENAJUD Inclusao.pdf");
  await tick();
  checar(P.idx === 1, "⛔ chegou a 2ª folha → AVANÇA sozinho");
  const l = P.ledger.find((e) => e.id === "RENAJUD");
  checar(l && l.status === "ok" && /2 certid/.test(l.detalhe), "o ledger diz que foram 2 certidões");
}

/* ── 3. CASA POR PROCESSO E POR TEMPO (não aceita chegada alheia/velha) ───── */
{
  const { w, P } = await iniciar([CONV.SERASAJUD], "inclusao", 1);
  await w.Store.set("orq_conv_feito", { convenio: "SERASAJUD", numProcesso: "9999999-99.2099.5.18.0000", ok: true, arquivo: "x.pdf", em: Date.now() });
  await tick();
  checar(P.idx === 0, "⛔ chegada de OUTRO processo não faz a fila andar");
  await arrival(w, "CENSEC", "y.pdf");
  await tick();
  checar(P.idx === 0, "chegada de OUTRO convênio (não o que aguarda) é ignorada");
  await w.Store.set("orq_conv_feito", { convenio: "SERASAJUD", numProcesso: NUM, ok: true, arquivo: "z.pdf", em: 1 });
  await tick();
  checar(P.idx === 0, "⛔ chegada VELHA (anterior ao início do convênio) não conta");
  await arrival(w, "SERASAJUD", "certa.pdf");
  await tick();
  checar(P.idx === 1, "a chegada certa (mesmo processo, atual) avança");
}

/* ── 4. CONSULTA INCOMPLETA → SEGUE E SINALIZA (não trava a fila) ───────────
   O exemplo real é o INFOJUD: registro com anomalia emite um TERMINAL ok:false
   (consulta), e a fila não pode ficar pendurada esperando a caixa postal. */
{
  const amb = montar();
  const P = amb.w.__cratosPainel;
  amb.respostas.INFOJUD = { ok: true, aguardando: true };
  amb.respostas.SERASAJUD = { ok: true, aguardando: true, esperados: 1 };
  P.setProcesso({ numero: NUM, id: 123 });
  P.setModo("inclusao");
  amb.w.document.querySelector(".cx-corpo").innerHTML = '<div id="cx-progresso"></div>';
  P.fila = [CONV.INFOJUD, CONV.SERASAJUD];
  P.idx = 0; P.ledger = [];
  P.renderProgresso();
  await P.rodarProximoConvenio(ctxPadrao());
  await tick();
  checar(P.idx === 0 && amb.enviados[0] === "INFOJUD", "começa pelo INFOJUD (consulta)");
  await terminal(amb.w, { convenio: "INFOJUD", ok: false, feitos: 0, esperados: 1, motivo: "ocorrência no eCAC" });
  await tick(80);
  checar(P.idx === 1, "⛔ consulta incompleta NÃO trava a fila — ela segue para o próximo");
  checar(amb.enviados.includes("SERASAJUD"), "e o SerasaJUD chegou a ser disparado");
  const lc = P.ledger.find((e) => e.id === "INFOJUD");
  checar(lc && lc.status === "conferir" && /0 de 1/.test(lc.detalhe),
    "⛔ o INFOJUD fica marcado 'confira (0 de 1)' no ledger — sinalizado, não escondido");
  await arrival(amb.w, "SERASAJUD", "SERASAJUD.pdf");
  await tick();
  const txt = relatorioTxt(amb.w);
  checar(/2 convênio/.test(txt) && /1 concluído/.test(txt) && /1 precisa/.test(txt),
    "o relatório final conta certo: 2 convênios, 1 concluído, 1 precisa de você");
  checar(/INFOJUD/.test(txt) && /confira|0 de 1/i.test(txt),
    "⛔ e NOMEIA o INFOJUD como o que precisa de conferência");
}

/* ── 5. ATO INCOMPLETO → TRAVA A FILA (não atropela penhora pela metade) ──── */
{
  const amb = montar();
  const P = amb.w.__cratosPainel;
  amb.respostas.CNIB = { ok: true, aguardando: true, esperados: 1 };
  amb.respostas.CENSEC = { ok: true, aguardando: true, esperados: 1 };
  P.setProcesso({ numero: NUM, id: 123 });
  P.setModo("inclusao");              // CNIB roda como ATO (inclusao)
  amb.w.document.querySelector(".cx-corpo").innerHTML = '<div id="cx-progresso"></div>';
  P.fila = [CONV.CNIB, CONV.CENSEC];
  P.idx = 0; P.ledger = [];
  P.renderProgresso();
  await P.rodarProximoConvenio(ctxPadrao());
  await tick();
  await terminal(amb.w, { convenio: "CNIB", ok: false, feitos: 2, esperados: 3, motivo: "1 executado não entrou" });
  await tick(80);
  checar(P.idx === 0, "⛔ ATO incompleto TRAVA — a fila NÃO avança sozinha");
  checar(!amb.enviados.includes("CENSEC"), "⛔ o convênio seguinte (CENSEC) NÃO é disparado");
  const lc = P.ledger.find((e) => e.id === "CNIB");
  checar(lc && lc.status === "trava" && /2 de 3/.test(lc.detalhe), "o CNIB fica marcado como travado (2 de 3)");
  checar(!relatorioTxt(amb.w), "não há relatório de fim de fila — a fila parou, esperando o humano");
  checar(!!botao(amb.w), "⛔ o botão continua na tela: o humano confere e decide seguir na mão");
  await botao(amb.w).onclick();
  await tick();
  checar(P.idx === 1 && amb.enviados.includes("CENSEC"),
    "clicando no botão depois de conferir, a fila retoma");
}

/* ── 6. O BOTÃO É SEMPRE A RESERVA (mesmo quando está contando certidões) ──── */
{
  const { w, P } = await iniciar([CONV.RENAJUD], "inclusao", 2);
  checar(!!botao(w), "o botão está presente mesmo esperando 2 certidões");
  await botao(w).onclick();   // o usuário conclui na mão antes de as 2 chegarem
  await tick();
  checar(P.idx === 1, "⛔ o clique manual avança a fila (a reserva funciona mesmo contando)");
  const l = P.ledger.find((e) => e.id === "RENAJUD");
  checar(l && l.status === "ok" && /manual/.test(l.detalhe), "e o ledger diz que foi manual");
}

/* ── 6b. BOTÃO "PULAR" → avança E sinaliza (RENAJUD: 2ª parte é manual) ───── */
{
  const amb = montar();
  const P = amb.w.__cratosPainel;
  amb.respostas.RENAJUD = { ok: true, aguardando: true, esperados: 2 };
  amb.respostas.CENSEC = { ok: true, aguardando: true, esperados: 1 };
  P.setProcesso({ numero: NUM, id: 123 });
  P.setModo("inclusao");
  amb.w.document.querySelector(".cx-corpo").innerHTML = '<div id="cx-progresso"></div>';
  P.fila = [CONV.RENAJUD, CONV.CENSEC];
  P.idx = 0; P.ledger = [];
  P.renderProgresso();
  await P.rodarProximoConvenio(ctxPadrao());
  await tick();
  // chega só a 1ª de 2 folhas → segue esperando
  await arrival(amb.w, "RENAJUD", "parte1 RENAJUD Inclusao.pdf");
  await tick();
  checar(P.idx === 0, "com 1 de 2, a fila ainda espera");
  const bp = botaoPular(amb.w);
  checar(!!bp, "⛔ existe o botão 'Pular para o próximo da fila'");
  await bp.onclick();
  await tick();
  checar(P.idx === 1 && amb.enviados.includes("CENSEC"),
    "⛔ Pular AVANÇA a fila (dispara o próximo convênio)");
  const l = P.ledger.find((e) => e.id === "RENAJUD");
  checar(l && l.status === "conferir" && /pulado/.test(l.detalhe) && /1 de 2/.test(l.detalhe),
    "⛔ e SINALIZA no ledger: pulado (1 de 2) — não marca como concluído");
  // fecha a fila e confere o relatório
  await arrival(amb.w, "CENSEC", "CENSEC.pdf");
  await tick();
  const txt = relatorioTxt(amb.w);
  checar(/RENAJUD/.test(txt) && /pulado/.test(txt), "o relatório final nomeia o RENAJUD como pulado");
}

/* ── 6c. CNIB BAIXA conclui por pulso TERMINAL (fecha a aba sozinho) ──────── */
{
  // baixa: esperados desconhecido (nº de protocolos só na tela). O cnib.js emite
  // um pulso terminal ok:true (sem arquivo) no encerrar("concluido").
  const amb = montar();
  const P = amb.w.__cratosPainel;
  amb.respostas.CNIB = { ok: true, aguardando: true };   // sem esperados (baixa)
  P.setProcesso({ numero: NUM, id: 123 });
  P.setModo("baixa");
  amb.w.document.querySelector(".cx-corpo").innerHTML = '<div id="cx-progresso"></div>';
  P.fila = [CONV.CNIB]; P.idx = 0; P.ledger = [];
  P.renderProgresso();
  await P.rodarProximoConvenio(ctxPadrao());
  await tick();
  checar(P.idx === 0, "CNIB baixa espera (esperados desconhecido → não conta)");
  await terminal(amb.w, { convenio: "CNIB", operacao: "baixa", ok: true });
  await tick();
  checar(P.idx === 1, "⛔ pulso terminal ok:true conclui a baixa e AVANÇA (sem depender do botão)");
  checar(amb.msgs.some((m) => m && m.tipo === "orq_fechar_aba" && m.convenioId === "CNIB"),
    "⛔ e manda fechar a aba do CNIB — o que faltava na baixa");
  // fonte: o cnib.js emite o pulso só quando a baixa fecha LIMPA. 1.6.2: "nada a
  // cancelar" e "já canceladas" também (há certidão); "sem_resposta" e
  // "outra_instituicao" NÃO (faixa e aba aberta para conferir).
  const cn = fs.readFileSync(path.join(SRC, "conteudo", "cnib.js"), "utf8");
  const enc = cn.slice(cn.indexOf("async function encerrar"), cn.indexOf("async function encerrar") + 1800);
  const cond = (enc.match(/if \(\((fase === [^)]*)\)/) || [])[1] || "";
  checar(/orq_conv_feito/.test(enc) && /"concluido"/.test(cond) && /"nada_a_cancelar"/.test(cond) &&
    /"ja_canceladas"/.test(cond) && !/sem_resposta|outra_instituicao|sem_certidao/.test(cond),
    "o encerrar do CNIB emite o pulso terminal só quando fecha limpo (concluído / nada a cancelar / já canceladas)");
}

/* ── 7. ERRO NO DISPATCH → PULA E SINALIZA (agora no relatório) ───────────── */
{
  const amb = montar();
  const P = amb.w.__cratosPainel;
  amb.respostas.RENAJUD = { ok: false, motivo: "nenhum executado no processo" };
  P.setProcesso({ numero: NUM, id: 123 });
  P.setModo("inclusao");
  amb.w.document.querySelector(".cx-corpo").innerHTML = '<div id="cx-progresso"></div>';
  P.fila = [CONV.RENAJUD];
  P.idx = 0; P.ledger = [];
  P.renderProgresso();
  await P.rodarProximoConvenio(ctxPadrao());
  await tick();
  checar(P.idx === 1, "erro ao iniciar não trava a fila (pula)");
  const txt = relatorioTxt(amb.w);
  checar(/1 precisa/.test(txt) && /RENAJUD/.test(txt) && /nenhum executado/.test(txt),
    "⛔ o erro aparece NOMEADO no relatório final, com o motivo — não some no log");
}

/* ── 8. O SAB CONTINUA COM O CAMINHO PRÓPRIO (não regrediu) ───────────────── */
{
  const arq = fs.readFileSync(path.join(SRC, "conteudo", "painel.js"), "utf8");
  checar(/Store\.onChange\("sab_estado"/.test(arq),
    "o SAB mantém a auto-conclusão por sab_estado (não trocada pelo pulso de chegada)");
  checar(/CHAVE_CONV_FEITO/.test(arq) && /orq_conv_feito/.test(arq),
    "e o pulso de chegada existe para os demais convênios");
}

/* ── 9. A CARDINALIDADE VEM DO MÓDULO (o bug de campo, 03/09) ───────────────
   O número de certidões a esperar é do MÓDULO (nº de executados), não um chute.
   Testado direto no `esperadosDoConvenio` REAL do painel: usa o que o dispatch
   informou; SEM informação → null (conclui pelo botão, nunca "1" chutado). */
{
  const P = montar().w.__cratosPainel;
  const conv = CONV.RENAJUD;
  checar(P.esperadosDoConvenio(conv, { esperados: 2 }) === 2,
    "⛔ 2 executados → espera 2 certidões (o que faltava no bug do RENAJUD)");
  checar(P.esperadosDoConvenio(conv, { esperados: 1 }) === 1, "1 executado → espera 1");
  checar(P.esperadosDoConvenio(conv, {}) === null,
    "⛔ módulo sem esperados (ex.: CNIB baixa) → null: conclui pelo BOTÃO, não chuta 1");
  checar(P.esperadosDoConvenio(conv, { esperados: 0 }) === null, "esperados 0 também vira null");
  // e o background emite CHEGADA com o nome do arquivo (para contar distintos)
  const bg = fs.readFileSync(path.join(SRC, "background.js"), "utf8");
  checar(/function emitirPulsoConclusao/.test(bg) && /arquivo:/.test(bg),
    "o background emite a chegada com o NOME do arquivo (o painel conta distintos)");
  checar(!/deveEmitirPulsoCentral/.test(bg),
    "⛔ a allow-list de artefato-único saiu — agora a regra é CONTAR até o nº de executados");
}

/* ── 10. O AVANÇO FECHA A ABA DO CONVÊNIO (mesmo gatilho) ─────────────────── */
{
  const amb = await iniciar([CONV.SERASAJUD], "inclusao", 1);
  await arrival(amb.w, "SERASAJUD", "SERASAJUD.pdf");
  await tick();
  const fechou = amb.msgs.find((m) => m && m.tipo === "orq_fechar_aba");
  checar(!!fechou, "⛔ ao concluir e avançar, o painel manda fechar a aba do convênio");
  checar(fechou && fechou.convenioId === "SERASAJUD", "e diz QUAL convênio (a aba respectiva)");
}
{
  // trava (ato incompleto) NÃO fecha a aba — o humano precisa vê-la
  const amb = montar();
  const P = amb.w.__cratosPainel;
  amb.respostas.CNIB = { ok: true, aguardando: true, esperados: 1 };
  P.setProcesso({ numero: NUM, id: 123 });
  P.setModo("inclusao");
  amb.w.document.querySelector(".cx-corpo").innerHTML = '<div id="cx-progresso"></div>';
  P.fila = [CONV.CNIB]; P.idx = 0; P.ledger = [];
  P.renderProgresso();
  await P.rodarProximoConvenio(ctxPadrao());
  await tick();
  await terminal(amb.w, { convenio: "CNIB", ok: false, feitos: 0, esperados: 1, motivo: "abortou" });
  await tick(60);
  checar(!amb.msgs.some((m) => m && m.tipo === "orq_fechar_aba"),
    "⛔ ATO travado NÃO fecha a aba — fica aberta para conferência");
}

/* ── 11. POLO ATIVO DESMARCADO POR PADRÃO no checkbox das partes ──────────── */
{
  const { w } = montar();
  const P = w.__cratosPainel;
  P.renderProcesso({
    numero: NUM, id: 123,
    partes: [
      { nome: "CARLOS EXEMPLO SANTOS", cpfcnpj: "12312312387", polo: "ativo" },
      { nome: "MERCADO EXEMPLO LTDA", cpfcnpj: "12312312000187", polo: "passivo" },
      { nome: "ANTONIO EXEMPLO", cpfcnpj: "45645645609", polo: "passivo" },
    ],
  });
  const cbs = Array.from(w.document.querySelectorAll(".cx-sel-parte"));
  checar(cbs.length === 3, "renderiza um checkbox por parte");
  checar(cbs[0] && cbs[0].checked === false, "⛔ o polo ATIVO nasce DESMARCADO");
  checar(cbs[1] && cbs[1].checked === true && cbs[2] && cbs[2].checked === true,
    "⛔ os polos PASSIVOS nascem marcados");
}

/* ── 12. FECHAMENTO DE ABAS NO BACKGROUND (fonte) ─────────────────────────── */
{
  const bg = fs.readFileSync(path.join(SRC, "background.js"), "utf8");
  checar(/function fecharAbaConvenio/.test(bg) && /renajud\.pdpj\.jus\.br/.test(bg) &&
         /indisponibilidade\.onr\.org\.br/.test(bg) && /censec\.org\.br/.test(bg),
    "o background fecha a aba por HOST (RENAJUD/CNIB/CENSEC/SerasaJUD)");
  checar(/case "orq_fechar_aba"/.test(bg), "e trata a mensagem orq_fechar_aba do painel");
  // coletarTudo fecha a aba de resultado quando a coleta termina limpa
  const ct = bg.slice(bg.indexOf("async function coletarTudo"), bg.indexOf("async function coletarColher"));
  checar(/abaResultado/.test(ct) && /tabs\.remove\(abaResultado\)/.test(ct),
    "⛔ coletarTudo fecha a aba do eCAC/caixa postal ao terminar de baixar os documentos");
  checar(/!est\.ativo/.test(ct) && ct.indexOf("tabs.remove(abaResultado)") > ct.indexOf("!est.ativo"),
    "o fechamento fica no ramo de fim LIMPO (!est.ativo), não no timeout");
}

console.log("\n=== teste-painel-encadeamento.js ===");
oks.forEach((d) => console.log("  ok   " + d));
falhas.forEach((d) => console.log("  FALHA " + d));
console.log(`\n${oks.length} passaram, ${falhas.length} falharam ` +
  `(${oks.length + falhas.length} asserções)\n`);
process.exit(falhas.length ? 1 : 0);

})();
