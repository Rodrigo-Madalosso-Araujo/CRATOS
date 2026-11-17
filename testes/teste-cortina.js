/*
 * teste-cortina.js — a cortina nas páginas dos convênios (2.0, passo 5).
 *
 * Trava: a cortina (CratosOverlay, comum/faixa.js) é um alertdialog rotulado com
 * "Liberar a página"; a página por baixo some para o leitor de tela (aria-hidden),
 * menos as faixas e o painel do CRATOS, e volta exatamente como estava; teclado e
 * clique DA PESSOA não chegam à página (Tab fica no botão, Esc libera), mas o
 * próprio CRATOS continua podendo dar focus() e disparar eventos (não é `inert`);
 * saída garantida: botão, Esc, pagehide, prazo de 3 min, `durante` (com erro
 * também), ressalva e parada da faixa; liberada, não volta até a etapa acabar.
 * Fiação: RENAJUD, CNIB, SerasaJUD e CENSEC cobrem o que fazem sozinhos e tiram a
 * cortina antes da vez da pessoa. Reprova o cc2cf19 (passo 4) e a 1.9.6.
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const NOME = "teste-cortina.js";
const oks = [], falhas = [];
const checar = (c, d) => (c ? oks : falhas).push(d);
const ler = (...p) => fs.readFileSync(path.join(SRC, ...p), "utf8");

function montar() {
  const dom = new JSDOM(`<!doctype html><html><body>
    <header id="topo">site do convênio</header>
    <main id="principal"><input id="campo"><button id="enviar">Enviar</button></main>
    <div id="ja-escondido" aria-hidden="true">já escondido</div>
    <cratos-raiz id="painel"></cratos-raiz>
  </body></html>`, { url: "https://renajud.pdpj.jus.br/", runScripts: "outside-only" });
  const w = dom.window;
  w.console.warn = () => {}; w.console.error = () => {}; w.console.log = () => {};
  w.eval(ler("comum", "faixa.js"));
  return w;
}
const tecla = (w, el, key) => { const e = new w.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }); el.dispatchEvent(e); return e; };

(async () => {
  {
    const w = montar();
    if (!w.CratosOverlay || typeof w.CratosOverlay.durante !== "function" || typeof w.CratosOverlay.liberar !== "function") {
      checar(false, "⛔ a cortina tem saída pela pessoa (liberar) e cobertura por etapa (durante)");
      throw new Error("cortina antiga nesta versão");
    }
  }

  /* ── 1. estrutura e leitor de tela ───────────────────────────────────── */
  {
    const w = montar(), d = w.document, O = w.CratosOverlay;
    O.mostrar("pesquisando veículos.");
    const ov = d.getElementById("cratos-overlay-aguarde");
    const card = ov && ov.querySelector('[role="alertdialog"]');
    checar(!!card && card.getAttribute("aria-modal") === "true" && d.getElementById(card.getAttribute("aria-labelledby")) &&
      d.getElementById(card.getAttribute("aria-describedby")), "⛔ a cortina é um alertdialog rotulado e descrito");
    checar(/pesquisando veículos/.test(d.querySelector(".cratos-ov-txt").textContent) && d.querySelector(".cratos-ov-txt").getAttribute("role") === "status",
      "o texto do passo é uma região de status (muda e é lido)");
    const bt = d.getElementById("cratos-ov-liberar");
    checar(bt && bt.tagName === "BUTTON" && /Liberar a página/.test(bt.textContent), "⛔ botão \"Liberar a página\"");
    checar(["topo", "principal"].every((id) => d.getElementById(id).getAttribute("aria-hidden") === "true"),
      "⛔ a página por baixo some para o leitor de tela (aria-hidden)");
    checar(!d.getElementById("painel").hasAttribute("aria-hidden") && !ov.hasAttribute("aria-hidden"), "o painel do CRATOS e a cortina continuam à vista");
    w.CratosFaixa.dizer("renajud", "progresso");
    checar(!d.getElementById("cratos-renajud-aviso").hasAttribute("aria-hidden"), "a faixa do CRATOS continua à vista");
    checar(d.getElementById("principal").hasAttribute("inert") === false, "⛔ NÃO usa o atributo inert (o CRATOS precisa dar focus() nos campos)");
    d.getElementById("campo").focus();
    checar(d.activeElement === d.getElementById("campo"), "⛔ o próprio CRATOS continua podendo pôr o foco num campo da página");
    let clicou = false; d.getElementById("enviar").addEventListener("click", () => { clicou = true; });
    d.getElementById("enviar").click();
    checar(clicou, "o clique sintético do CRATOS chega à página");
    O.esconder();
    checar(!d.getElementById("cratos-overlay-aguarde"), "esconder() tira a cortina");
    checar(["topo", "principal"].every((id) => !d.getElementById(id).hasAttribute("aria-hidden")) &&
      d.getElementById("ja-escondido").getAttribute("aria-hidden") === "true",
      "⛔ tudo volta exatamente como estava (o que já era aria-hidden continua)");
  }

  /* ── 2. teclado e mouse da pessoa ────────────────────────────────────── */
  {
    const w = montar(), d = w.document, O = w.CratosOverlay;
    O._daPessoa = () => true;                     // simula teclado/mouse de verdade
    O.mostrar("preenchendo.");
    const bt = d.getElementById("cratos-ov-liberar");
    const e1 = tecla(w, d.getElementById("campo"), "Tab");
    checar(e1.defaultPrevented && d.activeElement === bt, "⛔ Tab da pessoa fica no \"Liberar a página\"");
    let digitou = false; d.getElementById("campo").addEventListener("keydown", () => { digitou = true; });
    tecla(w, d.getElementById("campo"), "a");
    checar(!digitou, "⛔ tecla da pessoa não chega à página");
    let clicou = false; d.getElementById("enviar").addEventListener("click", () => { clicou = true; });
    const ov = d.getElementById("cratos-overlay-aguarde");
    const ev = new w.MouseEvent("click", { bubbles: true, cancelable: true });
    ov.dispatchEvent(ev);
    checar(ev.defaultPrevented && !clicou, "clique da pessoa na cortina não chega à página");
    tecla(w, bt, "Escape");
    checar(!d.getElementById("cratos-overlay-aguarde") && !d.getElementById("principal").hasAttribute("aria-hidden"), "⛔ Esc libera a página");
    O.mostrar("próximo passo da mesma etapa");
    checar(!d.getElementById("cratos-overlay-aguarde"), "⛔ liberada, a cortina não volta nesta etapa");
    O.esconder();
    O.mostrar("etapa seguinte");
    checar(!!d.getElementById("cratos-overlay-aguarde"), "terminada a etapa, a próxima pode cobrir de novo");
    d.getElementById("cratos-ov-liberar").click();
    checar(!d.getElementById("cratos-overlay-aguarde"), "o botão \"Liberar a página\" libera");
    const t = tecla(w, d.getElementById("campo"), "a");
    checar(!t.defaultPrevented, "sem cortina, o teclado volta ao normal (o vigia de teclas sai)");
  }

  /* ── 3. saída garantida ──────────────────────────────────────────────── */
  {
    const w = montar(), d = w.document, O = w.CratosOverlay;
    O.mostrar("x");
    w.dispatchEvent(new w.Event("pagehide"));
    checar(!d.getElementById("cratos-overlay-aguarde") && !d.getElementById("topo").hasAttribute("aria-hidden"), "⛔ sair da página (pagehide) tira a cortina e devolve tudo");
    O.mostrar("y");
    w.CratosFaixa.alertar("renajud", "ressalva");
    checar(!d.getElementById("cratos-overlay-aguarde"), "⛔ uma ressalva (é com a pessoa) tira a cortina");
    O.mostrar("z");
    w.CratosFaixa.parar("renajud", "parada");
    checar(!d.getElementById("cratos-overlay-aguarde"), "uma parada tira a cortina");
    let dentro = false;
    const r = await O.durante("etapa", async () => { dentro = !!d.getElementById("cratos-overlay-aguarde"); return 7; });
    checar(dentro && r === 7 && !d.getElementById("cratos-overlay-aguarde"), "⛔ durante(): cobre enquanto roda e tira no fim");
    let caiu = false;
    try { await O.durante("etapa", async () => { throw new Error("boom"); }); } catch (e) { caiu = true; }
    checar(caiu && !d.getElementById("cratos-overlay-aguarde") && !d.getElementById("topo").hasAttribute("aria-hidden"), "⛔ durante(): com erro também tira");
    checar(/setTimeout\(\(\) => this\.esconder\(\), 180000\)/.test(ler("comum", "faixa.js")), "prazo de segurança de 3 minutos");
  }

  /* ── 4. fiação nos convênios ─────────────────────────────────────────── */
  {
    const ren = ler("conteudo", "renajud.js");
    checar(/function prepararInclusao\(est\) \{\s*return comCortina\(/.test(ren) && /function prepararBaixa\(est\) \{\s*return comCortina\(/.test(ren) &&
      /function buscarExecutadoComVeiculo\(est, idx\) \{\s*return comCortina\(/.test(ren) && /CratosOverlay\.durante\(texto, fn\)/.test(ren),
      "⛔ RENAJUD: busca, preparo da inclusão e busca da baixa sob a cortina (durante)");
    const cnib = ler("conteudo", "cnib.js");
    const prep = cnib.slice(cnib.indexOf("async function _fluxoInclusao"), cnib.indexOf("vigiarProtocolo(est);\n  }"));
    checar(/function fluxoInclusao\(est\) \{\s*return comCortina\(/.test(cnib) && /function etapaPesquisaBaixa\(est\) \{\s*return comCortina\(/.test(cnib) &&
      prep.indexOf("descobrir();") >= 0 && prep.indexOf("descobrir();") < prep.indexOf('avisar("ordem PREPARADA'),
      "⛔ CNIB: cobre o preparo e a busca; tira antes de \"ordem PREPARADA\" (o envio é seu)");
    const sj = ler("conteudo", "serasajud.js");
    const f = sj.slice(sj.indexOf("async function _fluxo(est)"), sj.indexOf("const ESPERA_CONFIRMACAO_MS"));
    checar(/async function fluxo\(est\) \{\s*try \{ return await _fluxo\(est\); \} finally \{ descobrir\(\); \}/.test(sj) &&
      f.indexOf("descobrir();") < f.indexOf("garantirDadosManuais(est)") && f.lastIndexOf("descobrir();") < f.indexOf("avisar(`ordem montada"),
      "⛔ SerasaJUD: tira a cortina para o popup do valor/data e antes do CONFIRMAR; nunca fica no ar");
    const cen = ler("conteudo", "censec.js");
    checar(/ov\.durante\("consultando a CEP/.test(cen) && /desafio visível[\s\S]{0,200}ov\.esconder\(\)/.test(cen) && /desafio resolvido[\s\S]{0,200}ov\.mostrar\(/.test(cen),
      "⛔ CENSEC: cobre a consulta, sai para o desafio (captcha) e volta depois");
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
