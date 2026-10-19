/*
 * teste-renajud-erro-interno.js — faixas de recusa do RENAJUD (1.6.3). Dados FICTÍCIOS.
 *
 * Campo (19/10): a RETIRADA voltou com "Não foi possível realizar a operação. A execução do
 * método RenajudWsClient#pesquisaRestricaoJudicial retornou o código HTTP 500. RENAJUD-WS
 * (Erro Interno): … ID: <uuid>" — e a faixa dizia só "recusou a operação (HTTP 400)".
 * Decisão do Rodrigo: a faixa orienta a retirar pelo RENAJUD ANTIGO (no futuro, o CRATOS
 * abrirá o antigo sozinho).
 *
 * O que se trava aqui:
 *  1. ⛔ Erro interno na RETIRADA → faixa âmbar que diz "erro interno", orienta o RENAJUD
 *     antigo e repete o ID de rastreabilidade; sem certidão; sem afirmar o estado da restrição.
 *  2. Erro interno na INCLUSÃO → "tente de novo mais tarde" (o antigo não se aplica).
 *  3. RENAJUD-WEB → orienta o antigo e diz que nada foi certificado.
 *  4. Outras recusas → a faixa traz a MENSAGEM do servidor.
 *
 * Reprova a 1.6.2. Rodar: node teste-renajud-erro-interno.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const falhas = [], oks = [];
const checar = (c, d) => (c ? oks : falhas).push(d);
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 80));

function montar() {
  const dom = new JSDOM("<!doctype html><body></body>",
    { url: "https://renajud.pdpj.jus.br/veiculo/restricao/exclusao", runScripts: "outside-only" });
  const w = dom.window;
  const mem = { "cratos:renajud_estado": { ativo: true, operacao: "baixa", numProcesso: "00000056420265180008" } };
  const enviadas = [], faixas = [];
  w.browser = {
    storage: { local: { get: async (k) => ({ [k]: mem[k] }), set: async (o) => Object.assign(mem, o), remove: async () => {} },
      onChanged: { addListener() {}, removeListener() {} } },
    runtime: { sendMessage: async (m) => { enviadas.push(m); return { ok: true }; }, onMessage: { addListener() {} },
      getURL: (p) => "moz-extension://x/" + p },
    downloads: { download: async () => 1 },
  };
  w.CratosFaixa = {
    parar: (m, t) => faixas.push(["parar", String(t), m]),
    alertar: (m, t) => faixas.push(["alertar", String(t), m]),
    dizer: (m, t) => faixas.push(["dizer", String(t), m]),
    mostrar: (m, t) => faixas.push(["mostrar", String(t), m]),
  };
  for (const k of ["log", "warn", "error", "debug"]) w.console[k] = () => {};
  w.eval(fs.readFileSync(path.join(SRC, "comum", "storage.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(SRC, "conteudo", "renajud.js"), "utf8"));
  return { w, enviadas, faixas };
}
const disparar = (w, metodo, status, corpo) => w.document.dispatchEvent(new w.CustomEvent("cratos:renajud:restricao",
  { detail: JSON.stringify({ metodo, status, corpo: typeof corpo === "string" ? corpo : JSON.stringify(corpo) }) }));

const ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";   // fictício
const ERRO_INTERNO = { message: "Não foi possível realizar a operação. A execução do método " +
  "RenajudWsClient#pesquisaRestricaoJudicial retornou o código HTTP 500. RENAJUD-WS (Erro Interno): " +
  "Ocorreu um erro inesperado em 2026-10-19T13:59:12.159606. Tente mais tarde. Se o erro persistir, " +
  "contate o administrador do sistema informando o id de rastreabilidade de log. ID: " + ID };

(async () => {
  {
    const { w, enviadas, faixas } = montar();
    await tick(150);
    disparar(w, "DELETE", 400, ERRO_INTERNO);
    await tick();
    const f = faixas.find((x) => x[0] === "alertar") || ["", ""];
    checar(/ERRO INTERNO à retirada/.test(f[1]) && f[2] === "renajud", "⛔ erro interno na RETIRADA: a faixa diz que foi ERRO INTERNO (não 'recusa')");
    checar(/RENAJUD ANTIGO/.test(f[1]) && /tente retirá-la por lá/.test(f[1]), "⛔ orienta a retirar pelo RENAJUD antigo");
    checar(f[1].indexOf(ID) >= 0, "repete o ID de rastreabilidade (para o chamado)");
    checar(/Nada foi certificado/.test(f[1]) && !enviadas.some((m) => m.tipo === "fabricar_pdf"), "sem certidão");
    checar(!/(n[ãa]o )?foi (cancelad|retirad|exclu)/i.test(f[1]) && !/recusou a operação/.test(f[1]),
      "não afirma o estado da restrição nem chama de recusa");
  }
  {
    const { w, faixas } = montar();
    await tick(150);
    disparar(w, "POST", 500, ERRO_INTERNO);
    await tick();
    const f = faixas.find((x) => x[0] === "alertar") || ["", ""];
    checar(/ERRO INTERNO à inclusão/.test(f[1]) && /Tente de novo mais tarde/.test(f[1]) && !/ANTIGO/.test(f[1]),
      "erro interno na INCLUSÃO: 'tente de novo mais tarde' (o antigo não se aplica)");
  }
  {
    const { w, faixas } = montar();
    await tick(150);
    disparar(w, "DELETE", 400, { message: "Restrição incluída via RENAJUD-WEB não pode ser retirada por esta via." });
    await tick();
    const f = faixas.find((x) => /ANTIGO/.test(x[1])) || ["", ""];
    checar(/Tente retirá-la pelo RENAJUD antigo/.test(f[1]) && /Nada foi certificado/.test(f[1]),
      "RENAJUD-WEB: orienta o antigo e diz que nada foi certificado");
  }
  {
    const { w, faixas } = montar();
    await tick(150);
    disparar(w, "DELETE", 400, { message: "Veículo não localizado para o processo informado" });
    await tick();
    const f = faixas.find((x) => x[0] === "alertar") || ["", ""];
    checar(/recusou a operação \(HTTP 400\): “Veículo não localizado para o processo informado”/.test(f[1]),
      "⛔ outras recusas: a faixa traz a mensagem do servidor");
    const { w: w2, faixas: f2 } = montar();
    await tick(150);
    disparar(w2, "DELETE", 422, "<html><body><h1>Erro</h1><p>falha de validação</p></body></html>");
    await tick();
    checar(f2.some((x) => /“Erro falha de validação”/.test(x[1])), "corpo HTML: a mensagem vai sem marcação");
  }

  console.log("\n=== teste-renajud-erro-interno.js ===");
  oks.forEach((d) => console.log("  ok   " + d));
  falhas.forEach((d) => console.log("  FALHA " + d));
  console.log(`\n${oks.length} passaram, ${falhas.length} falharam (${oks.length + falhas.length} asserções)\n`);
  process.exit(falhas.length ? 1 : 0);
})();
