/*
 * teste-painel-refazer.js — o botão "↻ Refazer — no fim da fila" (1.9.3).
 *
 * Pedido do Rodrigo (10/11): quando um convênio dá erro, além de "Concluí" e "Pular",
 * um "Refazer" que devolve o convênio ao FIM da fila. Regra combinada: ATO que já passou
 * do MARCO IRREVERSÍVEL (o CRATOS enviou, ou entregou o formulário pronto para a sua
 * confirmação) NÃO refaz — nada de ordem em dobro. Consulta refaz, avisando quando já
 * registrou um pedido. Um refazer por convênio; estado limpo; arquivos da 1ª tentativa
 * fora da juntada; o relatório guarda as duas tentativas.
 *
 * Exercita o painel.js REAL num jsdom (como o teste-painel-encadeamento), as fatias do
 * background (Diario.marcarSubstituidos, prepararRefazer) e a posição do marco em cada
 * convênio (antes do clique irreversível).
 *
 * Reprova a 1.9.2 (não há Refazer nem marco).
 * Rodar: node teste-painel-refazer.js   ·   versão antiga: CRATOS_SRC=<pasta> node …
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const NOME = "teste-painel-refazer.js";
const oks = [], falhas = [];
const checar = (c, d) => (c ? oks : falhas).push(d);
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 40));
const NUM = "0000001-23.2025.5.18.0008";

function montar() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://pje.trt18.jus.br/pjekz/processo/1", runScripts: "outside-only", pretendToBeVisual: true,
  });
  const w = dom.window;
  const mem = {};
  const listeners = [];
  const dispara = (ch) => listeners.slice().forEach((l) => { try { l(ch, "local"); } catch (e) { /* nada */ } });
  const respostas = {}, enviados = [], msgs = [];
  w.browser = {
    storage: {
      local: {
        get: async (k) => (k == null ? Object.assign({}, mem) : { [k]: mem[k] }),
        set: async (o) => { const ch = {}; for (const k of Object.keys(o)) { ch[k] = { oldValue: mem[k], newValue: o[k] }; mem[k] = o[k]; } dispara(ch); },
        remove: async (k) => { const ch = {}; [].concat(k).forEach((x) => { ch[x] = { oldValue: mem[x] }; delete mem[x]; }); dispara(ch); },
      },
      onChanged: { addListener: (fn) => listeners.push(fn), removeListener: (fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); } },
    },
    runtime: {
      getURL: (p) => p, getManifest: () => ({ version: "teste" }), onMessage: { addListener() {}, removeListener() {} },
      sendMessage: async (msg) => {
        if (!msg) return { ok: true };
        msgs.push(msg);
        if (msg.tipo === "orquestra_executar") { enviados.push(msg.convenioId); return respostas[msg.convenioId] || { ok: true, aguardando: true }; }
        if (msg.tipo === "diario_ler") return { ok: true, certidoes: [] };
        return { ok: true };
      },
    },
  };
  for (const k of ["log", "warn", "error", "debug"]) w.console[k] = () => {};
  mem["cratos:config"] = { infojud: { colheitaAutomatica: "nao" } };
  w.eval(fs.readFileSync(path.join(SRC, "comum", "storage.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(SRC, "comum", "relatorio.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(SRC, "comum", "faixa.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(SRC, "conteudo", "painel.js"), "utf8"));
  return { w, mem, respostas, enviados, msgs };
}
const CONV = {
  CENSEC: { id: "CENSEC", label: "CENSEC", tipo: "interativo", ops: ["consulta"] },
  SNIPER: { id: "SNIPER", label: "SNIPER", tipo: "interativo", ops: ["consulta"] },
  SERASAJUD: { id: "SERASAJUD", label: "SerasaJUD", tipo: "interativo", ops: ["inclusao", "baixa"] },
  RENAJUD: { id: "RENAJUD", label: "RENAJUD", tipo: "interativo", ops: ["inclusao", "baixa"] },
  CNIB: { id: "CNIB", label: "CNIB (Indisponibilidade)", tipo: "interativo", ops: ["inclusao", "baixa"] },
};
async function iniciar(fila, modo, antes) {
  const amb = montar();
  const P = amb.w.__cratosPainel;
  if (!P) return Object.assign(amb, { P: null });
  fila.forEach((c) => { amb.respostas[c.id] = { ok: true, aguardando: true, esperados: 1 }; });
  if (antes) await antes(amb);
  P.setProcesso({ numero: NUM, id: 123 });
  P.setModo(modo || "inclusao");
  amb.w.document.querySelector(".cx-corpo").innerHTML = '<div id="cx-progresso"></div>';
  P.fila = fila.slice(); P.idx = 0; P.ledger = [];
  if ("refeitos" in P) P.refeitos = new amb.w.Set();
  P.renderProgresso();
  await P.rodarProximoConvenio({ idProcesso: 123, numeroProcesso: NUM, base: "https://pje.trt18.jus.br", partes: [{ nome: "PARTE FICTICIA" }], xsrfToken: "" });
  await tick();
  return Object.assign(amb, { P });
}
const area = (w) => w.document.getElementById("cx-concluir-area");
const btnRefazer = (w) => { const a = area(w); return a ? Array.from(a.querySelectorAll("button")).find((b) => /Refazer/.test(b.textContent)) || null : null; };
const nota = (w) => { const a = area(w); const n = a && a.querySelector(".cx-refazer-nota"); return n ? n.textContent : ""; };
const chegou = (w, convenio, arquivo) => w.Store.set("orq_conv_feito", { convenio, numProcesso: NUM, ok: true, arquivo, em: Date.now() });
const marco = (w, convenio, oque, em) => w.Store.set("orq_marco", { convenio, numProcesso: NUM, oque, em: em || Date.now() });
const progresso = (w, id) => { const el = w.document.getElementById("cx-prog-" + id); return el ? el.textContent : ""; };

(async () => {
  {
    const amb = montar();
    if (!amb.w.__cratosPainel || !("refeitos" in amb.w.__cratosPainel)) {
      console.log(`\n=== ${NOME} ===\n  FALHA  a versão em ${SRC} não tem o "Refazer" da fila (1.9.3).\n\n0 passaram — a suíte inteira reprova nesta versão.\n`);
      process.exit(1);
    }
  }

  /* ── 1. consulta sem marco: refaz no fim da fila ───────────────────────── */
  {
    const { w, P, enviados, msgs } = await iniciar([CONV.CENSEC, CONV.SERASAJUD], "inclusao");
    const b = btnRefazer(w);
    checar(!!b && !b.disabled && /Refazer CENSEC — no fim da fila/.test(b.textContent),
      "o Refazer aparece ao lado de Concluí e Pular, habilitado (consulta sem marco)");
    b.click();
    await tick(80);
    const m = msgs.find((x) => x.tipo === "orq_refazer") || {};
    checar(m.convenioId === "CENSEC" && m.numProcesso === NUM && Number(m.desde) > 0,
      "refazer avisa o fundo (limpar estado, fechar a aba, tirar da juntada os arquivos da 1ª tentativa)");
    checar(enviados.join() === "CENSEC,SERASAJUD" && P.fila.map((c) => c.id).join() === "CENSEC,SERASAJUD,CENSEC",
      "⛔ o convênio vai para o FIM da fila: o próximo (SerasaJUD) roda antes");
    checar(/Vai ser refeito no fim da fila/.test(progresso(w, "CENSEC")), "a linha do convênio diz que vai ser refeito");
    await chegou(w, "SERASAJUD", "SERASAJUD.pdf");
    await tick(80);
    checar(enviados.join() === "CENSEC,SERASAJUD,CENSEC" && /Refazendo \(2ª tentativa\)|Aguardando/.test(progresso(w, "CENSEC")),
      "depois do SerasaJUD, o CENSEC roda de novo (2ª tentativa)");
    checar(!btnRefazer(w), "⛔ na 2ª tentativa não há outro Refazer (um por convênio: sem laço)");
    await chegou(w, "CENSEC", "CENSEC.pdf");
    await tick(80);
    const rel = (w.document.getElementById("cx-relatorio") || {}).textContent || "";
    checar(/2 convênio\(s\): 2 concluído\(s\)/.test(rel) && /↻ CENSEC — 1ª tentativa não concluída — refeita no fim da fila/.test(rel),
      "relatório: conta a 2ª tentativa e guarda o rastro da 1ª (sem contar em dobro)");
  }

  /* ── 2. último da fila: roda na hora ───────────────────────────────────── */
  {
    const { w, enviados } = await iniciar([CONV.CENSEC], "inclusao");
    btnRefazer(w).click();
    await tick(80);
    checar(enviados.join() === "CENSEC,CENSEC", "último da fila: refaz na hora");
  }

  /* ── 3. ⛔ ato com marco: bloqueado ──────────────────────────────────────── */
  {
    const { w, P, enviados, msgs } = await iniciar([CONV.RENAJUD, CONV.CENSEC], "inclusao");
    checar(btnRefazer(w) && !btnRefazer(w).disabled, "ato ainda sem marco (nada foi preparado): Refazer habilitado");
    await marco(w, "RENAJUD", "a restrição foi preparada no RENAJUD para a sua confirmação");
    await tick();
    const b = btnRefazer(w);
    checar(b.disabled && /Refazer bloqueado: a restrição foi preparada no RENAJUD/.test(nota(w)) && /use Pular/.test(nota(w)),
      "⛔ ATO com marco (chegou durante a espera): Refazer BLOQUEADO, com o motivo e o caminho (Pular e rodar depois)");
    b.disabled = false;             // nem forçando o botão: o clique confere o marco de novo
    b.click();
    await tick(80);
    checar(!msgs.some((x) => x.tipo === "orq_refazer") && P.fila.length === 2 && enviados.join() === "RENAJUD" && !!area(w),
      "⛔ nem com o botão forçado: o clique relê o marco e não refaz (fila intacta, nada enviado)");
  }
  {
    const { w } = await iniciar([CONV.RENAJUD], "inclusao", async (amb) => {
      await amb.w.Store.set("orq_marco", { convenio: "RENAJUD", numProcesso: NUM, oque: "marco velho", em: Date.now() - 60 * 60 * 1000 });
    });
    await marco(w, "CNIB", "marco de outro convênio");
    await tick();
    checar(btnRefazer(w) && !btnRefazer(w).disabled, "marco VELHO (outra execução) ou de OUTRO convênio não bloqueia");
  }

  /* ── 4. consulta com marco: refaz, avisando ────────────────────────────── */
  {
    const { w, enviados } = await iniciar([CONV.SNIPER], "inclusao");
    await marco(w, "SNIPER", "a investigação foi iniciada no SNIPER");
    await tick();
    checar(!btnRefazer(w).disabled && /Atenção: a investigação foi iniciada no SNIPER\. Refazer registra outro pedido/.test(nota(w)),
      "CONSULTA com marco: Refazer liberado, avisando que registra outro pedido");
    btnRefazer(w).click();
    await tick(80);
    checar(enviados.join() === "SNIPER,SNIPER", "consulta com marco: refaz");
  }

  /* ── 5. ato que TRAVOU (CNIB ok:false) ─────────────────────────────────── */
  {
    const { w } = await iniciar([CONV.CNIB], "inclusao");
    await w.Store.set("orq_conv_feito", { convenio: "CNIB", numProcesso: NUM, ok: false, feitos: 0, esperados: 1, motivo: "o CNIB não habilitou o Confirmar", em: Date.now() });
    await tick();
    checar(/Parou/.test(progresso(w, "CNIB")) && btnRefazer(w) && !btnRefazer(w).disabled,
      "CNIB parou ANTES de preparar a ordem (sem marco): pode refazer");
  }
  {
    const { w } = await iniciar([CONV.CNIB], "inclusao");
    await marco(w, "CNIB", "a ordem foi preparada na CNIB para o seu envio e assinatura");
    await w.Store.set("orq_conv_feito", { convenio: "CNIB", numProcesso: NUM, ok: false, feitos: 0, esperados: 1, motivo: "falha", em: Date.now() });
    await tick();
    checar(btnRefazer(w) && btnRefazer(w).disabled, "⛔ CNIB parou DEPOIS de preparar a ordem: Refazer bloqueado");
  }

  /* ── 6. fundo: diário e preparação ─────────────────────────────────────── */
  {
    const bg = fs.readFileSync(path.join(SRC, "background.js"), "utf8");
    const iD = bg.indexOf("const Diario = {");
    const fD = bg.indexOf("\n};\n", iD) + 3;
    const iP = bg.indexOf("const ESTADO_CONVENIO");
    const fP = bg.indexOf("async function fecharAbaConvenio", iP);
    const iH = bg.indexOf("const HOST_CONVENIO");
    const fH = bg.indexOf("};", iH) + 2;
    const mem = {}, removidas = [];
    const Store = { get: async (k) => mem[k], set: async (k, v) => { mem[k] = v; } };
    const browser = { tabs: { query: async (q) => (/sniper/.test(q.url) ? [{ id: 9 }] : []), remove: async (id) => { removidas.push(id); } } };
    const fab = new Function("Store", "browser", "console", bg.slice(iH, fH) + "\n" + bg.slice(iD, fD) + "\n" + bg.slice(iP, fP) +
      "\nreturn { Diario, prepararRefazer };");
    const { Diario, prepararRefazer } = fab(Store, browser, { log() {}, warn() {} });
    const dig = NUM.replace(/\D/g, "");
    const desde = Date.parse("2026-11-10T14:00:00Z");
    mem["diario:" + dig] = { numProcesso: dig, itens: [
      { convenio: "SNIPER", operacao: "consulta", arquivo: "velho.pdf", em: "2026-11-10T13:00:00Z" },
      { convenio: "SNIPER", operacao: "consulta", arquivo: "relatorio-1a.pdf", em: "2026-11-10T14:05:00Z" },
      { convenio: "SNIPER", operacao: "consulta", arquivo: "juntado.pdf", em: "2026-11-10T14:06:00Z", juntadoEm: "2026-11-10T14:07:00Z" },
      { convenio: "CENSEC", operacao: "consulta", arquivo: "censec.pdf", em: "2026-11-10T14:08:00Z" },
    ] };
    mem.sniper_estado = { ativo: true, fase: "investigando" };
    const r = await prepararRefazer({ convenioId: "SNIPER", numProcesso: NUM, desde });
    const it = mem["diario:" + dig].itens;
    checar(r.ok && r.substituidos === 1 && it[1].substituidoEm && !it[0].substituidoEm && !it[2].substituidoEm && !it[3].substituidoEm,
      "⛔ fundo: só os arquivos da 1ª tentativa DESTE convênio, ainda não juntados, ficam \"substituídos\" (nada apagado)");
    checar(mem.sniper_estado === null && removidas.join() === "9" && r.fechadas === 1,
      "fundo: estado do convênio zerado (o \"investigando\" velho não barra a 2ª tentativa) e a aba dele fechada");
    checar(/filter\(\(i\) => !i\.juntadoEm && !i\.substituidoEm\)/.test(bg),
      "⛔ a certidão de juntada (montarCertidoes) ignora os substituídos — nada juntado em duplicidade");
    const painel = fs.readFileSync(path.join(SRC, "conteudo", "painel.js"), "utf8");
    checar(/!it\.juntadoEm && !it\.substituidoEm/.test(painel), "o aviso de \"arquivos não juntados\" ao fechar a aba também ignora os substituídos");
  }

  /* ── 7. o marco vem ANTES do clique irreversível, em cada convênio ─────── */
  {
    const ler = (f) => fs.readFileSync(path.join(SRC, "conteudo", f), "utf8");
    const antes = (txt, marcoRx, cliqueRx) => {
      const m = txt.search(marcoRx), c = txt.search(cliqueRx);
      return m >= 0 && c >= 0 && m < c;
    };
    const casos = [
      ["sab.js", /Store\.marco\("SAB", est\.numProcesso, "o CRATOS confirmou a interrupção/, /btnConfirmar\.click\(\)/, "SAB (baixa): antes de confirmar a interrupção"],
      ["sab.js", /Store\.marco\("SAB", est\.numProcesso, `a minuta da determinação/, /monitorando conclusão da determinação/, "SAB (inclusão): assim que a minuta existe"],
      ["renajud.js", /Store\.marco\("RENAJUD"/, /await clicar\("button", "Inserir"\)/, "RENAJUD: antes do \"Inserir\" (a confirmação é sua)"],
      ["cnib.js", /Store\.marco\("CNIB", est\.numProcesso, "a ordem foi preparada/, /ordem PREPARADA/, "CNIB (inclusão): ao entregar a ordem preparada"],
      ["cnib.js", /async function etapaConfirmacaoBaixa\(est\) \{\n\s*if \(est\) await Store\.marco\("CNIB", est\.numProcesso, "o cancelamento/, /Store\.marco\("CNIB", est\.numProcesso, "o cancelamento[^\n]*\n\s*await guardaConexao\(\);/, "CNIB (baixa): primeira coisa na tela de confirmação"],
      ["serasajud.js", /Store\.marco\("SERASAJUD"/, /enviar\.click\(\)/, "SerasaJUD: antes de \"Incluir/Baixar Dívida\""],
      ["sniper.js", /Store\.marco\("SNIPER"/, /clicarSeguro\(botao\);/, "SNIPER: antes de \"Iniciar investigação\""],
      ["prevjud.js", /Store\.marco\("PREVJUD"/, /clicarSeguro\(btn\);\n\s*const r = await aguardar\(\(\) => conferirSolicitacoes/, "PREVJUD: antes de \"Solicitar\""],
      ["ccs.js", /Store\.marco\("CCS"/, /requisitando a consulta…/, "CCS: antes de requisitar a consulta"],
      ["ecac-infojud.js", /Store\.marco\("INFOJUD"/, /btns\[btns\.length - 1\]\.click\(\)/, "INFOJUD: antes de \"Incluir Pedido\""],
    ];
    for (const [f, m, c, d] of casos) checar(antes(ler(f), m, c), `⛔ marco ${d}`);
    const st = fs.readFileSync(path.join(SRC, "comum", "storage.js"), "utf8");
    checar(/async marco\(convenio, numProcesso, oque\)[\s\S]*?"orq_marco"[\s\S]*?catch \(e\) \{ \/\* nada \*\/ \}/.test(st),
      "Store.marco grava orq_marco e nunca derruba o fluxo do convênio");
  }

  console.log(`\n=== ${NOME} ===`);
  for (const x of oks) console.log("  ok     " + x);
  for (const x of falhas) console.log("  FALHA  " + x);
  console.log(`\n${oks.length} passaram, ${falhas.length} falharam\n`);
  process.exit(falhas.length ? 1 : 0);
})();
