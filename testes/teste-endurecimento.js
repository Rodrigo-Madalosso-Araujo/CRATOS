/*
 * teste-endurecimento.js — revisão de segurança da 1.9.0 (22/10), antes de ir à STI.
 *
 * Trava:
 *  1. Dados de processo só enquanto a aba dele está aberta: fechar a aba apaga diário,
 *     registros de pedidos (CCS/PREVJUD), estados parados e a captura do processo — e
 *     só dele; mesmo processo noutra aba segura; estado ATIVO fica; Preferências etc.
 *     ficam sempre; abrir o Firefox apaga o resto. Fundo e painel ligados.
 *  2. Painel: avisa (linha fixa) e pede confirmação ao fechar a aba quando há arquivo
 *     do CRATOS ainda não juntado — e só nesse caso.
 *  3. Manifest só https://.
 *  4. Nome e documento de parte nunca crus no console.
 *  5. Preferências: "Ver novidades das versões" abre a janela; "Sobre" diz a verdade
 *     sobre a guarda dos dados.
 *  6. Testes sem dado real (id de investigação do SNIPER).
 * Reprova a 1.8.7.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");
const { montarPainel } = require("./harness-painel.js");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const NOME = "teste-endurecimento.js";
const oks = [], falhas = [];
const checar = (c, d) => (c ? oks : falhas).push(d);
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 30));
const NUM = "0000001-23.2025.5.18.0008", DIG = "00000012320255180008";
const OUTRO = "00000099920255180008";

if (!fs.existsSync(path.join(SRC, "modulos", "limpeza.js"))) {
  console.log(`\n=== ${NOME} ===\n  FALHA  a versão em ${SRC} não tem o endurecimento da 1.9.0 (modulos/limpeza.js).\n\n0 passaram — a suíte inteira reprova nesta versão.\n`);
  process.exit(1);
}

(async () => {
  /* ── 1. limpeza ────────────────────────────────────────────────────────── */
  const ctx = { console: { log() {}, warn() {}, error() {} } };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(SRC, "modulos", "limpeza.js"), "utf8") + "\nglobalThis.__L = Limpeza;", ctx);
  const L = ctx.__L;
  const armazemFalso = (inicial) => {
    const m = JSON.parse(JSON.stringify(inicial));
    return { m, get: async () => JSON.parse(JSON.stringify(m)), remove: async (ks) => { for (const k of ks) delete m[k]; } };
  };
  const base = () => ({
    "cratos:config": { prevjud: {} }, "cratos:extensao_ligada": true, "cratos:novidades_pendente": { de: "1.8.7", para: "1.9.0" },
    "cratos:orquestra_ordem": ["SAB"], "cratos:botao_pos": { x: 1 }, "cratos:cnib_organizacao": { nome: "VARA" }, "cratos:trt": "trt18",
    ["cratos:diario:" + DIG]: { numProcesso: DIG, itens: [{ arquivo: "x.pdf" }] },
    ["cratos:ccs_req:" + DIG]: [{ cpf: "12345678909", nome: "FULANO" }],
    ["cratos:prevjud_req:" + DIG]: [{ cpf: "12345678909", nome: "FULANO" }],
    "cratos:prevjud_estado": { ativo: false, numeroDigitos: DIG, docs: [{ cpf: "12345678909", nome: "FULANO" }] },
    "cratos:processo": { numero: NUM, partes: [{ nome: "FULANO", cpfcnpj: "123.456.789-09" }] },
    ["cratos:diario:" + OUTRO]: { numProcesso: OUTRO, itens: [] },
    "cratos:sniper_estado": { ativo: true, numProcesso: NUM },
    "outra-extensao:x": 1,
  });
  {
    const a = armazemFalso(base());
    L.armazem = () => a;
    const limpos = [];
    L.aoApagarProcesso = (n) => limpos.push(n);
    L.abas.clear();
    L.registrar(7, NUM);
    const ap = await L.aoFecharAba(7);
    const ks = Object.keys(a.m);
    checar(ap.length === 1 && !ks.includes("cratos:diario:" + DIG) && !ks.includes("cratos:ccs_req:" + DIG) && !ks.includes("cratos:prevjud_req:" + DIG) &&
      !ks.includes("cratos:prevjud_estado") && !ks.includes("cratos:processo"),
      "⛔ fechou a aba do processo: apaga diário, registros de pedidos (CCS/PREVJUD), estado parado e a captura DELE");
    checar(ks.includes("cratos:diario:" + OUTRO) && ks.includes("cratos:sniper_estado") && ks.includes("outra-extensao:x"),
      "…e só dele: outro processo, convênio rodando agora (estado ativo) e chaves de outra extensão ficam");
    checar(["config", "extensao_ligada", "novidades_pendente", "orquestra_ordem", "botao_pos", "cnib_organizacao", "trt"].every((k) => ks.includes("cratos:" + k)),
      "Preferências, liga/desliga, novidades, ordem/posição do painel e organização do CNIB ficam sempre");
    checar(limpos[0] === DIG, "os PDFs do processo saem da memória (Cofre)");
  }
  {
    const a = armazemFalso(base());
    L.armazem = () => a;
    L.abas.clear();
    L.registrar(7, NUM); L.registrar(8, NUM);
    const ap = await L.aoFecharAba(7);
    checar(ap.length === 0 && Object.keys(a.m).includes("cratos:diario:" + DIG), "o mesmo processo aberto em OUTRA aba: nada é apagado");
    const ap2 = await L.aoFecharAba(99);
    checar(ap2.length === 0, "fechar aba que não é de processo: nada acontece");
  }
  {
    const a = armazemFalso(base());
    L.armazem = () => a;
    await L.aoIniciar();
    const ks = Object.keys(a.m);
    checar(ks.length === 8 && ks.includes("outra-extensao:x") && ks.includes("cratos:config") && !ks.some((k) => /diario|_req:|_estado|processo/.test(k)),
      "⛔ abrir o Firefox apaga o que sobrou (navegador fechado ou travado), menos o que fica sempre");
  }
  {
    const bg = fs.readFileSync(path.join(SRC, "background.js"), "utf8");
    const man = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8"));
    checar(/tabs\.onRemoved\.addListener\(\(tabId\) => \{\s*Limpeza\.aoFecharAba\(tabId\)/.test(bg) && /runtime\.onStartup\.addListener\(\(\) => \{\s*Limpeza\.aoIniciar\(\)/.test(bg) &&
      /case "processo_aba":[\s\S]{0,200}Limpeza\.registrar\(sender && sender\.tab \? sender\.tab\.id : null, msg\.numProcesso\)/.test(bg) &&
      /Limpeza\.aoApagarProcesso = \(n\) => \{ try \{ Cofre\.limpar\(n\)/.test(bg) &&
      man.background.scripts.indexOf("modulos/limpeza.js") >= 0 && man.background.scripts.indexOf("modulos/limpeza.js") < man.background.scripts.indexOf("background.js"),
      "fundo: fechar aba, abrir o Firefox e o registro da aba do processo estão ligados");
  }

  /* ── 2. painel: aviso e confirmação ────────────────────────────────────── */
  const abrir = async (diario) => {
    const a = montarPainel(SRC, { mem: diario ? { ["cratos:diario:" + DIG]: diario } : {} });
    a.P.renderProcesso({ numero: NUM, id: 1, partes: [{ nome: "FULANO DE TAL", cpfcnpj: "123.456.789-09", polo: "PASSIVO" }] });
    await tick(60);
    return a;
  };
  const fechar = (a) => {
    const ev = new a.w.Event("beforeunload", { cancelable: true });
    a.w.dispatchEvent(ev);
    return ev.defaultPrevented;
  };
  {
    const a = await abrir({ numProcesso: DIG, itens: [{ arquivo: "a.pdf", convenio: "RENAJUD" }] });
    checar(a.msgs.some((m) => m.tipo === "processo_aba" && m.numProcesso === NUM), "painel avisa ao fundo em que aba está o processo");
    checar(/só enquanto esta aba do processo estiver aberta/.test((a.d.getElementById("cx-aviso-aba") || {}).textContent || ""), "painel: linha fixa avisando que os arquivos se perdem ao fechar a aba");
    checar(fechar(a) === true, "⛔ arquivo do CRATOS ainda NÃO juntado: fechar a aba pede confirmação");
    await a.w.Store.set("diario:" + DIG, { numProcesso: DIG, itens: [{ arquivo: "a.pdf", juntadoEm: "2026-10-22T15:00:00Z" }] });
    await tick(20);
    checar(fechar(a) === false, "depois de juntado: fecha sem perguntar");
  }
  {
    const a = await abrir(null);
    checar(fechar(a) === false, "nada gerado: fecha sem perguntar");
  }

  /* ── 3. https ──────────────────────────────────────────────────────────── */
  {
    const man = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8"));
    const hosts = man.permissions.filter((p) => /:\/\//.test(p)).concat(...man.content_scripts.map((c) => c.matches));
    checar(hosts.length > 10 && hosts.every((h) => h.startsWith("https://")), "⛔ permissões e páginas do manifest só https:// (nada de conexão sem criptografia)");
  }

  /* ── 4. console ────────────────────────────────────────────────────────── */
  {
    const c2 = { globalThis: {} };
    c2.globalThis = c2;
    vm.createContext(c2);
    vm.runInContext(fs.readFileSync(path.join(SRC, "comum", "storage.js"), "utf8"), c2);
    const M = c2.CratosMascara;
    checar(M && M.nome("FULANO DE TAL") === "F.D.T." && M.doc("123.456.789-09") === "…09" && M.nome("") === "(sem nome)", "máscara: nome vira iniciais, documento vira os 2 últimos dígitos");
    const arquivos = [];
    const varrer = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) varrer(p); else if (/\.js$/.test(f)) arquivos.push(p); } };
    varrer(SRC);
    const ruins = [];
    for (const f of arquivos) {
      fs.readFileSync(f, "utf8").split("\n").forEach((l, i) => {
        if (/console\.(log|warn|error|info|debug)\(/.test(l) && /(\.nome\b|nomeAbrev|cpfcnpj|\.ni\b|nomeEcac|semDocumento\.join)/.test(l) && !/CratosMascara/.test(l)) {
          ruins.push(path.relative(SRC, f) + ":" + (i + 1));
        }
      });
    }
    checar(ruins.length === 0, "⛔ nenhum nome/CPF de parte cru no console do navegador" + (ruins.length ? " (" + ruins.join(", ") + ")" : ""));
  }

  /* ── 5. Preferências ───────────────────────────────────────────────────── */
  {
    const html = fs.readFileSync(path.join(SRC, "opcoes", "opcoes.html"), "utf8");
    const dom = new JSDOM(html.replace(/<script[\s\S]*?<\/script>/g, ""), { url: "moz-extension://x/opcoes/opcoes.html", runScripts: "outside-only" });
    const w = dom.window;
    w.browser = { runtime: { sendMessage: async () => ({ modulos: [] }), getManifest: () => ({ version: "1.9.0" }) },
      storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {} } } };
    for (const k of ["log", "warn", "error"]) w.console[k] = () => {};
    for (const f of ["comum/storage.js", "comum/novidades.js", "opcoes/opcoes.js"]) {
      if (fs.existsSync(path.join(SRC, f))) w.eval(fs.readFileSync(path.join(SRC, f), "utf8"));
    }
    await tick(60);
    const b = w.document.getElementById("ver-novidades");
    if (b) b.click();
    const j = w.document.getElementById("janela-novidades");
    checar(!!j && /1\.9\.0/.test(j.textContent) && /SNIPER/.test(j.textContent) && /1\.6/.test(j.textContent), "Preferências: \"Ver novidades das versões\" abre a janela com o histórico");
    if (j) j.querySelector("#fechar-novidades").click();
    checar(!w.document.getElementById("janela-novidades"), "…e fecha");
    const sobre = (w.document.getElementById("sobre") || {}).textContent || "";
    checar(/SÓ enquanto a aba do processo estiver aberta/.test(sobre) && !/sobrescritos a cada nova operação/.test(sobre) && /PREVJUD/.test(sobre),
      "\"Sobre\": diz que os dados se apagam ao fechar a aba (e não mais \"sobrescritos\"), com a lista de convênios atual");
  }

  /* ── 6. testes sem dado real ───────────────────────────────────────────── */
  {
    const t = fs.readdirSync(__dirname).filter((f) => /\.js$/.test(f)).map((f) => fs.readFileSync(path.join(__dirname, f), "utf8")).join("\n");
    /* Os números reais NÃO aparecem nem aqui: só o SHA-256 deles (repositório público). Confere
       todo número de 7 dígitos dos testes contra os hashes. */
    const crypto = require("crypto");
    const proibidos = new Set(["d406922ae3506d443afcc4e1fbe5b944147da809428d5fa2ea38191bc731074f", "ff0d95e70ece4c168d85e49feb81d6a894e54577b0cd10a00a0dcbf10fef3b68", "333d3e3f355e643fd36b66a012aa0f21a96fca11ae21e2b43ac95bb3037ed698"]);
    const achados = (t.match(/\b\d{7}\b/g) || []).filter((x) => proibidos.has(crypto.createHash("sha256").update(x).digest("hex")));
    checar(!achados.length, "⛔ testes sem o número real de investigação do SNIPER (repositório público)");
  }

  /* 1.9.0 (26/10): hora dos "últimos passos" do relatório em horário LOCAL (era UTC) */
  {
    const { JSDOM } = require("jsdom");
    const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" }).window;
    for (const k of ["log", "warn", "error", "debug"]) w.console[k] = () => {};
    w.browser = { storage: { local: { get: async () => ({}), set: async () => {} } }, runtime: { getManifest: () => ({ version: "1.9.0" }) } };
    const RealDate = w.Date;
    /* relógio fixo: 15:13:24 no fuso local da máquina de teste */
    const fixo = new RealDate(2026, 9, 23, 15, 13, 24).getTime();
    w.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixo])); } static now() { return fixo; } };
    w.eval(fs.readFileSync(path.join(SRC, "comum", "relatorio.js"), "utf8"));
    const R = w.CratosRelatorio;
    if (R && R.registrar) R.registrar("infojud", "teste", "parou");
    const t = R && R._passos && R._passos[R._passos.length - 1] && R._passos[R._passos.length - 1].t;
    checar(t === "15:13:24", "relatório de problema: hora dos últimos passos no horário LOCAL, como o cabeçalho (era UTC)");
  }
  /* 1.9.0 (26/10): o aviso do SerasaJUD nas Preferências descreve o que o CRATOS faz desde a 1.5.4 */
  {
    const sj = fs.readFileSync(path.join(SRC, "modulos", "serasajud.js"), "utf8");
    checar(!/recusa a baixa e pede que você a faça à mão/.test(sj) && /abre uma janela e espera, sem prazo, você informar o que falta/.test(sj),
      "SerasaJUD (Preferências): o aviso não diz mais que recusa a baixa — diz que abre a janela e espera o valor/data");
  }

  console.log(`\n=== ${NOME} ===`);
  oks.forEach((d) => console.log("  ok   " + d));
  falhas.forEach((d) => console.log("  FALHA " + d));
  console.log(`\n${oks.length} passaram, ${falhas.length} falharam (${oks.length + falhas.length} asserções)\n`);
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.log("FALHA geral: " + e.stack); process.exit(1); });
