/*
 * teste-novidades.js — "Novidades da versão" (1.9.0, pedido do Rodrigo de 21/10).
 *
 * Trava: atualização mostra UMA vez; instalação nova não mostra; recarga da mesma
 * versão não mostra; "Entendi" não volta a mostrar; Preferência desliga; quem pula
 * versões vê as que pulou; histórico abre; texto escapado (CratosHTML); o fundo
 * marca no onInstalled; nada vem da rede. Reprova a 1.8.7 (não há novidades).
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { montarPainel } = require("./harness-painel.js");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const NOME = "teste-novidades.js";
const oks = [], falhas = [];
const checar = (c, d) => (c ? oks : falhas).push(d);
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 30));
const NUM = "0000001-23.2025.5.18.0008";

if (!fs.existsSync(path.join(SRC, "comum", "novidades.js"))) {
  console.log(`\n=== ${NOME} ===\n  FALHA  a versão em ${SRC} não tem as novidades da versão (comum/novidades.js).\n\n0 passaram — a suíte inteira reprova nesta versão.\n`);
  process.exit(1);
}

(async () => {
  /* ── 1. regra (comum/novidades.js) ─────────────────────────────────────── */
  const ctx = { console, Date };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(SRC, "modulos", "registro.js"), "utf8") + "\nglobalThis.Registro = Registro;", ctx);
  vm.runInContext(fs.readFileSync(path.join(SRC, "comum", "novidades.js"), "utf8"), ctx);
  const N = ctx.CratosNovidades;
  const loja = () => { const m = {}; return { m, set: async (k, v) => { m[k] = v; } }; };
  {
    const a = loja(), b = loja(), c = loja();
    const r1 = await N.aoInstalar({ reason: "install" }, "1.9.0", a);
    const r2 = await N.aoInstalar({ reason: "update", previousVersion: "1.8.7" }, "1.9.0", b);
    const r3 = await N.aoInstalar({ reason: "update", previousVersion: "1.9.0" }, "1.9.0", c);
    checar(r1 === null && !("novidades_pendente" in a.m), "instalação NOVA não marca novidades");
    checar(r2 && b.m.novidades_pendente.de === "1.8.7" && b.m.novidades_pendente.para === "1.9.0", "ATUALIZAÇÃO marca as novidades (de → para)");
    checar(r3 === null && !("novidades_pendente" in c.m), "recarga da MESMA versão não marca");
  }
  {
    const v = (de, para) => N.paraMostrar(de, para).map((e) => e.versao).join(",");
    checar(v("1.8.7", "1.9.0") === "1.9.0", "de 1.8.7 para 1.9.0: só as novidades da 1.9.0");
    checar(v("1.6.5", "1.9.0") === "1.9.0,1.8,1.7", "quem pulou versões (1.6.5 → 1.9.0) vê as que pulou");
    checar(N.comparar("1.10.0", "1.9.9") > 0 && N.comparar("1.8", "1.8.0") === 0, "comparação de versão número a número");
  }
  {
    const reg = ctx.Registro.obter("novidades");
    checar(reg && reg.config.mostrar.tipo === "toggle" && reg.config.mostrar.padrao.ativo === true, "Preferência \"Novidades da versão\", ligada de fábrica");
    const txt = fs.readFileSync(path.join(SRC, "comum", "novidades.js"), "utf8");
    checar(!/fetch\(|XMLHttpRequest|https?:\/\//.test(txt.replace(/\/\*[\s\S]*?\*\//g, "")), "⛔ o texto mora no pacote: nenhuma chamada de rede");
  }
  {
    const man = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8"));
    const pje = man.content_scripts.find((c) => c.matches.includes("https://pje.trt18.jus.br/*"));
    const bg = fs.readFileSync(path.join(SRC, "background.js"), "utf8");
    checar(man.background.scripts.includes("comum/novidades.js") && pje.js.indexOf("comum/novidades.js") >= 0 &&
      pje.js.indexOf("comum/novidades.js") < pje.js.indexOf("conteudo/painel.js"), "manifest: novidades no fundo e no painel");
    checar(/onInstalled\.addListener\(async \(detalhes\)[\s\S]{0,400}CratosNovidades\.aoInstalar\(detalhes, browser\.runtime\.getManifest\(\)\.version, Store\)/.test(bg),
      "fundo: o onInstalled marca as novidades");
  }

  /* ── 2. cartão no painel ───────────────────────────────────────────────── */
  const abrir = async (mem) => {
    const a = montarPainel(SRC, { mem });
    a.P.setProcesso({ numero: NUM, id: 1 });
    a.P.setPartes([{ nome: "FULANO DE TAL", cpfcnpj: "123.456.789-09", polo: "PASSIVO" }]);
    a.P.renderModoSelecao();
    await tick(60);
    return a;
  };
  {
    const a = await abrir({});
    checar(!a.d.getElementById("cx-novidades"), "sem atualização marcada: nada de cartão");
  }
  {
    const a = await abrir({ "cratos:novidades_pendente": { de: "1.8.7", para: "1.9.0" } });
    const card = a.d.getElementById("cx-novidades");
    checar(card && /Novidades da 1\.9\.0/.test(card.textContent) && /Verificar disponibilidade/.test(card.textContent) &&
      card.parentNode.firstChild === card, "depois de atualizar: cartão \"Novidades da 1.9.0\" no topo do painel");
    const hist = card.querySelector("#cx-novidades-hist");
    card.querySelector("#cx-novidades-ver").click();
    checar(hist.style.display === "block" && /SNIPER/.test(hist.textContent), "\"ver versões anteriores\" abre o histórico");
    card.querySelector("#cx-novidades-ok").click();
    await tick(30);
    checar(!a.d.getElementById("cx-novidades") && a.mem["cratos:novidades_pendente"] === null, "\"Entendi\" apaga o cartão e a marca");
    a.P.renderModoSelecao();
    await tick(60);
    checar(!a.d.getElementById("cx-novidades"), "…e ele NÃO volta na próxima abertura");
  }
  {
    const a = await abrir({ "cratos:novidades_pendente": { de: "1.6.5", para: "1.9.0" } });
    const card = a.d.getElementById("cx-novidades");
    checar(card && /Novidades desde a 1\.6\.5/.test(card.textContent) && /PREVJUD/.test(card.textContent) && /SNIPER/.test(card.textContent),
      "quem pulou versões: \"Novidades desde a 1.6.5\", com 1.7, 1.8 e 1.9.0");
  }
  {
    const a = await abrir({ "cratos:novidades_pendente": { de: "1.8.7", para: "1.9.0" },
      "cratos:config": { infojud: { colheitaAutomatica: "nao" }, novidades: { mostrar: { ativo: false } } } });
    checar(!a.d.getElementById("cx-novidades"), "Preferência desligada: não mostra");
  }

  {
    const a = montarPainel(SRC, { mem: { "cratos:novidades_pendente": { de: "1.8.7", para: "1.9.0" } } });
    a.w.CratosNovidades.VERSOES[0].itens.push('<img src=x onerror="window.__xss=1">');
    a.P.setProcesso({ numero: NUM, id: 1 });
    a.P.setPartes([{ nome: "FULANO DE TAL", cpfcnpj: "123.456.789-09", polo: "PASSIVO" }]);
    a.P.renderModoSelecao();
    await tick(60);
    const card = a.d.getElementById("cx-novidades");
    checar(card && !card.querySelector("img") && /<img src=x/.test(card.textContent), "⛔ texto das novidades é escapado (CratosHTML)");
  }

  console.log(`\n=== ${NOME} ===`);
  oks.forEach((d) => console.log("  ok   " + d));
  falhas.forEach((d) => console.log("  FALHA " + d));
  console.log(`\n${oks.length} passaram, ${falhas.length} falharam (${oks.length + falhas.length} asserções)\n`);
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.log("FALHA geral: " + e.stack); process.exit(1); });
