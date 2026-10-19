/*
 * teste-baixa-nada-a-cancelar.js — BAIXA sem restrição ativa (1.6.2). Dados FICTÍCIOS.
 *
 * Relato do Rodrigo (16/10): na baixa, quando NÃO há restrição ativa no CNIB e no
 * RENAJUD, o CRATOS não gerava certidão nenhuma. Telas reais (prints de 19/10):
 *   RENAJUD: <div class="alert alert-secondary" role="alert">Nenhuma restrição encontrada</div>
 *            (campo vazio: "Necessário informar pelo menos um parâmetro de pesquisa")
 *   CNIB:    popup "A ordem de indisponibilidade pesquisada não pertence a esta
 *            instituição. Instituição de origem: Não identificada." + embaixo do campo
 *            "O número de processo informado não foi localizado em nossa base de dados".
 *
 * O que se trava aqui:
 *  1. ⛔ RENAJUD: "Nenhuma restrição encontrada" → certidão de nada a retirar (baixa,
 *     detalhe nada_a_cancelar) + pulso para o painel seguir. Aviso VELHO na tela não
 *     vale. "Necessário informar…"/timeout → faixa, NUNCA certidão. Número que não fixa
 *     no campo → para sem pesquisar. A busca (GET) não dispara "recusou a operação".
 *  2. ⛔ CNIB: "não localizado" (+ popup "Não identificada") → certidão; popup com
 *     instituição COM NOME → faixa, sem certidão (há ordem de outro órgão); sem a
 *     mensagem do campo → sem certidão. "Já canceladas" → certidão com os protocolos.
 *  3. ⛔ Consolidada de baixa: quem não tinha o que cancelar NÃO entra no "procedi ao
 *     cancelamento" — vai para "não foram localizadas restrições ativas a cancelar".
 *
 * Reprova a 1.6.1. Rodar: node teste-baixa-nada-a-cancelar.js
 * Versão antiga: CRATOS_SRC=<pasta do xpi> node teste-baixa-nada-a-cancelar.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const falhas = [];
const oks = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 30));
async function ate(cond, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 3000)) { try { if (cond()) return true; } catch (e) {} await tick(20); }
  return false;
}
const PROC_FMT = "0000005-64.2026.5.18.0008";
const PROC = "00000056420265180008";

function ambiente(url, html, extraMem) {
  const dom = new JSDOM(html || "<!doctype html><body></body>", { url, runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  const mem = Object.assign({}, extraMem || {});
  const msgs = [], faixas = [];
  w.browser = {
    storage: { local: {
      get: async (k) => ({ [k]: mem[k] }),
      set: async (o) => Object.assign(mem, JSON.parse(JSON.stringify(o))),
      remove: async () => {},
    }, onChanged: { addListener() {}, removeListener() {} } },
    runtime: { sendMessage: async (m) => { msgs.push(m); return { ok: true }; }, onMessage: { addListener() {} },
      getURL: (p) => "moz-extension://x/" + p },
    downloads: { download: async () => 1 },
  };
  const f = (nivel) => (m, t) => faixas.push({ nivel, m, t: String(t) });
  w.CratosFaixa = { mostrar: (m, t, c) => faixas.push({ nivel: c, m, t: String(t) }),
    parar: f("parar"), alertar: f("alertar"), dizer: f("dizer") };
  w.DataTransfer = class { constructor() { this.d = {}; } setData(k, v) { this.d[k] = v; } };
  w.ClipboardEvent = class extends w.Event {};
  for (const k of ["log", "warn", "error", "debug"]) w.console[k] = () => {};
  w.eval(fs.readFileSync(path.join(SRC, "comum", "storage.js"), "utf8"));
  return { w, d: w.document, mem, msgs, faixas };
}
const certidoes = (e) => e.msgs.filter((m) => m.tipo === "fabricar_pdf");
const texto = (m) => (m ? (m.linhas || []).join("\n") : "");

(async () => {
  /* ── 3. consolidada (background) ─────────────────────────────────────────── */
  {
    const bg = fs.readFileSync(path.join(SRC, "background.js"), "utf8");
    const ini = bg.indexOf("const _P_CORPO");
    const iFn = bg.indexOf("function montarCertidoes(");
    const fim = bg.indexOf("\n}\n", iFn) + 3;
    const montar = new Function(bg.slice(ini, fim) + "\nreturn montarCertidoes;")();
    const html = (itens) => montar({ itens }).map((c) => c.html.replace(/<[^>]+>/g, "\n")).join("\n---\n");
    const nadaCnib = { convenio: "CNIB", operacao: "baixa", detalhe: "nada_a_cancelar", arquivo: "a CNIB Baixa (nada a cancelar).pdf" };
    const nadaRen = { convenio: "RENAJUD", operacao: "baixa", detalhe: "nada_a_cancelar", arquivo: "b RENAJUD Baixa (nada a retirar).pdf" };
    const cancSab = { convenio: "SAB", operacao: "baixa", detalhe: null, arquivo: "c SAB Baixa.pdf" };
    const cancCnib = { convenio: "CNIB", operacao: "baixa", detalhe: "protocolo 1", arquivo: "d CNIB Baixa.pdf" };

    const so = html([nadaCnib, nadaRen]);
    checar(!/procedi ao cancelamento/.test(so) &&
      /não foram localizadas restrições ativas a cancelar nos seguintes convênios:\s*1 - CNIB;\s*2 - RENAJUD\./.test(so),
      "⛔ consolidada: só 'nada a cancelar' → NÃO afirma cancelamento; lista CNIB e RENAJUD na frase própria");
    checar(/certidões das pesquisas estão anexadas/.test(so), "consolidada (só nada a cancelar): fecho fala das certidões das pesquisas");

    const misto = html([cancSab, nadaRen]);
    checar(/procedi ao cancelamento das restrições nos seguintes convênios:\s*1 - SAB\.\s*CERTIFICO, ainda, que não foram localizadas restrições ativas a cancelar nos seguintes convênios:\s*1 - RENAJUD\./.test(misto),
      "⛔ consolidada mista: SAB no 'procedi ao cancelamento', RENAJUD no 'não foram localizadas'");
    const c = montar({ itens: [cancSab, nadaRen] })[0];
    checar(c.arquivos.length === 2 && c.convenios.length === 2, "consolidada mista: as duas certidões vão anexas");

    const cnibDois = html([cancCnib, nadaCnib]);
    checar(/procedi ao cancelamento das restrições nos seguintes convênios:\s*1 - CNIB\./.test(cnibDois) && !/CERTIFICO, ainda/.test(cnibDois),
      "consolidada: convênio com algum cancelamento de fato fica entre os cancelados");
    const soCanc = html([cancSab]);
    checar(/procedi ao cancelamento[\s\S]*1 - SAB\.[\s\S]*comprovantes dos cancelamentos estão/.test(soCanc) && !/não foram localizadas/.test(soCanc),
      "consolidada: só cancelamentos → texto de sempre");
    const real = html([{ convenio: "CENSEC", operacao: "consulta", arquivo: "e.pdf" }]);
    checar(/foram realizados os seguintes convênios:\s*1 - CENSEC\./.test(real), "família 'Convênios realizados' intacta");
  }

  /* ── 1. RENAJUD ─────────────────────────────────────────────────────────── */
  const montarRenajud = (html) => {
    const e = ambiente("https://renajud.pdpj.jus.br/veiculo/restricao/pesquisa",
      html || "<!doctype html><body><app-veiculo-restricao-pesquisa></app-veiculo-restricao-pesquisa></body>");
    e.w.eval(fs.readFileSync(path.join(SRC, "conteudo", "renajud.js"), "utf8"));
    e.api = e.w.__cratosRenajud || {};
    return e;
  };
  const EST_REN = { ativo: true, operacao: "baixa", numProcesso: PROC_FMT, executados: [{ nome: "FULANO FICTICIO", cpfcnpj: "12345678909" }] };
  {
    const e = montarRenajud();
    if (typeof e.api.concluirBuscaBaixa !== "function") {
      checar(false, "⛔ a versão em " + SRC + " não lê o resultado da busca da baixa do RENAJUD (sem concluirBuscaBaixa)");
    } else {
      await e.api.concluirBuscaBaixa(EST_REN, { tipo: "vazio" });
      const c = certidoes(e)[0];
      checar(c && c.convenio === "RENAJUD" && c.operacao === "baixa" && c.detalhe === "nada_a_cancelar" &&
        /RENAJUD Baixa \(nada a retirar\)\.pdf$/.test(c.filename), "⛔ RENAJUD vazio: certidão de nada a retirar (baixa / nada_a_cancelar)");
      checar(/processo nº 0000005-64\.2026\.5\.18\.0008/.test(texto(c)) && /“Nenhuma restrição encontrada”/.test(texto(c)),
        "certidão do RENAJUD: processo e a resposta do sistema");
      const p = e.mem["cratos:orq_conv_feito"] || {};
      checar(p.convenio === "RENAJUD" && p.ok === true && !p.arquivo, "RENAJUD vazio: pulso TERMINAL para o painel seguir");
      checar((e.mem["cratos:renajud_estado"] || {}).fase === "nada_a_retirar" && e.faixas.some((f) => f.nivel === "dizer" && f.m === "renajud"),
        "RENAJUD vazio: encerra o estado e avisa em verde");

      const e2 = montarRenajud();
      await e2.api.concluirBuscaBaixa(EST_REN, { tipo: "outro", msg: "Necessário informar pelo menos um parâmetro de pesquisa" });
      checar(!certidoes(e2).length && !e2.mem["cratos:orq_conv_feito"] && e2.faixas.some((f) => f.nivel === "alertar" && /NADA foi certificado/.test(f.t)),
        "⛔ RENAJUD 'Necessário informar…': faixa, NUNCA certidão");
      const e3 = montarRenajud();
      await e3.api.concluirBuscaBaixa(EST_REN, { tipo: "tabela" });
      checar(!certidoes(e3).length && !e3.mem["cratos:orq_conv_feito"], "RENAJUD com restrições: segue como sempre (a retirada é sua)");
    }
  }
  if (typeof (montarRenajud().api.aguardarResultadoBaixa) === "function") {
    const comp = (inner) => `<!doctype html><body><app-veiculo-restricao-pesquisa><div class="shadow-lg">${inner}</div></app-veiculo-restricao-pesquisa></body>`;
    const ALERTA = '<div class="alert alert-secondary m-5" role="alert">Nenhuma restrição encontrada</div>';
    let e = montarRenajud(comp(ALERTA));
    checar((await e.api.aguardarResultadoBaixa(false, 2000)).tipo === "vazio", "leitura: o alerta do print = vazio");
    e = montarRenajud(comp(ALERTA));
    checar((await e.api.aguardarResultadoBaixa(true, 1500)).tipo === "timeout", "⛔ leitura: aviso VELHO (já na tela antes do Pesquisar) não vale");
    e = montarRenajud(comp('<span class="text-danger">Necessário informar pelo menos um parâmetro de pesquisa</span>'));
    checar((await e.api.aguardarResultadoBaixa(false, 2000)).tipo === "outro", "leitura: 'Necessário informar…' = outro (não é vazio)");
    e = montarRenajud(comp("<table><tbody><tr><td>ABC1D23</td></tr></tbody></table>"));
    checar((await e.api.aguardarResultadoBaixa(false, 2000)).tipo === "tabela", "leitura: tabela de restrições = tabela");

    /* prepararBaixa de ponta a ponta: preenche, pesquisa, a tela responde vazio. */
    const telaBusca = comp('<input id="numeroProcesso"><button>Pesquisar</button><button>Limpar</button><div id="res"></div>');
    e = montarRenajud(telaBusca);
    const btnP = Array.from(e.d.querySelectorAll("button")).find((b) => b.textContent === "Pesquisar");
    let pesquisou = 0;
    btnP.addEventListener("click", () => { pesquisou++; setTimeout(() => { e.d.getElementById("res").innerHTML = ALERTA; }, 150); });
    await e.api.prepararBaixa(EST_REN);
    await ate(() => certidoes(e).length, 4000);
    checar(pesquisou === 1 && e.d.getElementById("numeroProcesso").value.replace(/\D/g, "") === PROC && certidoes(e).length === 1,
      "⛔ baixa RENAJUD de ponta a ponta: preenche, pesquisa e certifica o 'nada a retirar'");

    e = montarRenajud(telaBusca);
    const inp = e.d.getElementById("numeroProcesso");
    Object.defineProperty(inp, "value", { get: () => "", set: () => {}, configurable: true });
    let pesq2 = 0;
    Array.from(e.d.querySelectorAll("button")).find((b) => b.textContent === "Pesquisar").addEventListener("click", () => pesq2++);
    await e.api.prepararBaixa(EST_REN);
    checar(pesq2 === 0 && !certidoes(e).length && e.faixas.some((f) => f.nivel === "parar" && /não fixou/.test(f.t)),
      "⛔ número que não fixa no campo: para SEM pesquisar e sem certidão");
  } else {
    checar(false, "⛔ a versão em " + SRC + " não lê o resultado da busca da baixa (sem aguardarResultadoBaixa)");
  }
  {
    const e = montarRenajud();
    const disparar = (metodo, status, corpo) => e.d.dispatchEvent(new e.w.CustomEvent("cratos:renajud:restricao",
      { detail: JSON.stringify({ metodo, status, corpo }) }));
    await tick(150);
    disparar("GET", 404, '{"message":"nada"}');
    await tick(80);
    checar(!e.faixas.some((f) => /recusou a operação/.test(f.t)), "⛔ busca (GET) com erro NÃO vira 'recusou a operação'");
    disparar("POST", 500, '{"message":"erro"}');
    await tick(80);
    checar(e.faixas.some((f) => /recusou a operação/.test(f.t) && f.m === "renajud"),
      "ato (POST) recusado continua avisando — com o módulo certo na faixa");
  }

  /* ── 2. CNIB ────────────────────────────────────────────────────────────── */
  const POPUP = (origem) => `<div class="modal show"><h5>Atenção!</h5><button>×</button>
    <p>A ordem de indisponibilidade pesquisada não pertence a esta instituição.</p>
    <p><b>Instituição de origem:</b> ${origem}.</p>
    <p>O cancelamento deve ser realizado pela instituição de origem.</p>
    <button id="fechar">Fechar</button></div>`;
  const CAMPO = (msg) => `<input id="txtProcessNumber" value="${PROC}">` +
    (msg ? '<span class="text-danger">O número de processo informado não foi localizado em nossa base de dados</span>' : "");
  const montarCnib = (html) => {
    const e = ambiente("https://indisponibilidade.onr.org.br/ordem/cancelamento/total",
      `<!doctype html><body>${html}</body>`);
    e.w.eval(fs.readFileSync(path.join(SRC, "conteudo", "cnib.js"), "utf8"));
    e.api = e.w.__cratosCnib || {};
    const f = e.d.getElementById("fechar");
    e.fechou = 0;
    if (f) f.addEventListener("click", () => { e.fechou++; f.closest(".modal").remove(); });
    return e;
  };
  const EST_CNIB = { ativo: true, operacao: "baixa", numProcesso: PROC_FMT, numeroDigitos: PROC,
    executados: [{ nome: "FULANO FICTICIO DA SILVA", cpfcnpj: "12345678909" }], protocolosFeitos: [] };
  {
    const e = montarCnib(CAMPO(true) + POPUP("Não identificada"));
    if (typeof e.api.concluirPesquisaSemOrdens !== "function") {
      checar(false, "⛔ a versão em " + SRC + " não reconhece a pesquisa sem ordem do CNIB (sem concluirPesquisaSemOrdens)");
    } else {
      const pop = e.api.popupOutraInstituicao();
      checar(pop && pop.naoIdentificada === true, "CNIB: popup do print → 'Não identificada'");
      checar(e.api.desfechoPesquisaBaixa(false) === "popup", "CNIB: desfecho reconhece o popup");
      await e.api.concluirPesquisaSemOrdens(EST_CNIB, "popup", false);
      const c = certidoes(e)[0];
      checar(c && c.convenio === "CNIB" && c.operacao === "baixa" && c.detalhe === "nada_a_cancelar" &&
        /CNIB Baixa \(nada a cancelar\)\.pdf$/.test(c.filename), "⛔ CNIB não localizado: certidão de nada a cancelar (baixa / nada_a_cancelar)");
      checar(/não foi localizado em nossa base de dados/.test(texto(c)) && /processo nº 0000005-64\.2026\.5\.18\.0008/.test(texto(c)),
        "certidão do CNIB: processo e a resposta do sistema");
      checar(e.fechou === 1, "CNIB: fecha o popup no 'Fechar'");
      const p = e.mem["cratos:orq_conv_feito"] || {};
      checar(p.convenio === "CNIB" && p.ok === true && (e.mem["cratos:cnib_estado"] || {}).fase === "nada_a_cancelar",
        "CNIB não localizado: pulso para o painel seguir");

      const e2 = montarCnib(CAMPO(true) + POPUP("TRIBUNAL DE JUSTIÇA DO ESTADO DE GOIÁS"));
      const pop2 = e2.api.popupOutraInstituicao();
      checar(pop2 && pop2.naoIdentificada === false && /TRIBUNAL DE JUSTIÇA DO ESTADO DE GOIÁS/.test(pop2.origem),
        "CNIB: popup com instituição COM NOME é reconhecido como ordem de outro órgão");
      await e2.api.concluirPesquisaSemOrdens(EST_CNIB, "popup", false);
      checar(!certidoes(e2).length && !e2.mem["cratos:orq_conv_feito"] &&
        e2.faixas.some((f) => /pertence a outra instituição \(TRIBUNAL DE JUSTIÇA DO ESTADO DE GOIÁS\)/.test(f.t)),
        "⛔ CNIB ordem de OUTRA instituição: faixa, sem certidão (seria falsa)");

      const e3 = montarCnib(CAMPO(false) + POPUP("Não identificada"));
      await e3.api.concluirPesquisaSemOrdens(EST_CNIB, "popup", false);
      checar(!certidoes(e3).length && (e3.mem["cratos:cnib_estado"] || {}).fase === "sem_resposta",
        "⛔ CNIB sem a mensagem 'não localizado' no campo: nada é certificado");
      const e4 = montarCnib(CAMPO(false));
      await e4.api.concluirPesquisaSemOrdens(EST_CNIB, null, false);
      checar(!certidoes(e4).length && !e4.mem["cratos:orq_conv_feito"], "⛔ CNIB sem resposta reconhecível (timeout): faixa, sem certidão");
      const e5 = montarCnib(CAMPO(true));
      checar(e5.api.desfechoPesquisaBaixa(true) === null && e5.api.desfechoPesquisaBaixa(false) === "nao_localizado",
        "CNIB: mensagem do campo que já estava na tela antes do Pesquisar não vale");

      const e6 = montarCnib("");
      const r = await e6.api.fabricarCertidaoNadaACancelar(EST_CNIB, ["123456.2024.0001-AB-1", "123456.2024.0002-AB-2"]);
      const t6 = texto(certidoes(e6)[0]);
      checar(r.ok && /constam como já canceladas/.test(t6) && /1\) Protocolo 123456\.2024\.0001-AB-1/.test(t6) && /2\) Protocolo/.test(t6),
        "⛔ CNIB 'já canceladas': certidão com os protocolos como prova");
      const fonte = fs.readFileSync(path.join(SRC, "conteudo", "cnib.js"), "utf8");
      const ramo = fonte.slice(fonte.indexOf("if (!selecionaveis.length)"), fonte.indexOf("if (!selecionaveis.length)") + 900);
      checar(/fabricarCertidaoNadaACancelar\(est, daVara\.map/.test(ramo),
        "CNIB: o ramo das ordens com caixa travada chama a certidão");
      checar(!/avisar\("pesquisei e o CNIB não devolveu nenhuma ordem para este processo\."/.test(fonte),
        "CNIB: o antigo 'esperar 25 s e dizer que não veio ordem' deixou de ser conclusão");
    }
  }

  console.log("\n=== teste-baixa-nada-a-cancelar.js ===");
  oks.forEach((d) => console.log("  ok   " + d));
  falhas.forEach((d) => console.log("  FALHA " + d));
  console.log(`\n${oks.length} passaram, ${falhas.length} falharam (${oks.length + falhas.length} asserções)\n`);
  process.exit(falhas.length ? 1 : 0);
})();
