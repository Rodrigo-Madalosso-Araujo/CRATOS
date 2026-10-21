/*
 * teste-renajud-folha.js — o grampo de API do RENAJUD e a folha fabricada.
 *
 * O que esta suíte existe para travar, na ordem em que as coisas dão errado:
 *  1. ⛔ A folha tem de sair com numProcesso, convenio e operacao. Sem os três o
 *     `fabricar_pdf` baixa o arquivo e NÃO registra no diário — a folha nasce
 *     invisível para a certidão consolidada e para a juntada, que é justamente
 *     o ganho desta mudança. Foi assim que o delta de 02/09 veio escrito (ele
 *     nasceu na base 0.2.81, quando o diário nem existia).
 *  2. Erro NUNCA vira certidão: status >= 300 não produz documento.
 *  3. O 400 do RENAJUD-WEB serve de ROTEAMENTO, não de conclusão sobre o ato.
 *  4. Veículo com `mensagemErro` dentro de uma resposta 200 vai em bloco
 *     SEPARADO — misturado com os que deram certo, sob um título que afirma
 *     inclusão, o documento se contradiz.
 *  5. A baixa não traz numeroProcesso no corpo: tem de cair no estado.
 *  6. O grampo escuta e NÃO re-emite a requisição (re-emitir duplicaria a
 *     restrição — é dinheiro e bem de terceiro).
 *
 * Rodar: node teste-renajud-folha.js
 * Versão antiga: CRATOS_SRC=<pasta do xpi descompactado> node teste-renajud-folha.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const falhas = [];
const oks = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }
const esperar = (ms) => new Promise((r) => setTimeout(r, ms || 30));

/* ────────────────────────────────────────────────────────────────────────────
   RESPOSTAS DO RENAJUD (forma confirmada no recon de 02/09)
   ──────────────────────────────────────────────────────────────────────────── */
const RESP_INCLUSAO = {
  dadosProcesso: {
    numeroProcesso: "00000012320255180008",
    magistrado: { nome: "FULANO DE TAL" },
    orgao: { nome: "8ª VARA DO TRABALHO DE GOIANIA", tribunal: { nome: "TRT DA 18ª REGIÃO" } },
  },
  veiculos: [
    { placa: "ABC1D23", marcaModelo: "FIAT/UNO", proprietario: { nome: "EMPRESA EXEMPLOECIALIDADES LTDA", documento: "12345678000199" }, tipoRestricao: "Transferência" },
  ],
};
const RESP_BAIXA = {
  dadosProcesso: {   // ⚠ SEM numeroProcesso — é assim que a baixa responde
    magistrado: { nome: "FULANO DE TAL" },
    orgao: { nome: "8ª VARA DO TRABALHO DE GOIANIA", tribunal: { nome: "TRT DA 18ª REGIÃO" } },
  },
  veiculos: [
    { placa: "ABC1D23", marcaModelo: "FIAT/UNO", proprietario: { nome: "EMPRESA EXEMPLOECIALIDADES LTDA" }, tipoRestricao: "Transferência" },
  ],
};
const RESP_MISTA = {
  dadosProcesso: RESP_INCLUSAO.dadosProcesso,
  veiculos: [
    { placa: "ABC1D23", marcaModelo: "FIAT/UNO", proprietario: { nome: "EXEMPLO LTDA" }, tipoRestricao: "Transferência" },
    { placa: "XYZ9K88", marcaModelo: "VW/GOL", proprietario: { nome: "EXEMPLO LTDA" }, tipoRestricao: "Transferência",
      mensagemErro: "Veículo com restrição de roubo/furto" },
  ],
};
const ERRO_WEB = "RENAJUD-WS (Requisição inválida): Nao e possível excluir pelo " +
  "Renajud-WS uma restricao inserida pelo RENAJUD-WEB";

/* ────────────────────────────────────────────────────────────────────────────
   AMBIENTE
   ──────────────────────────────────────────────────────────────────────────── */
function montar(estado) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>",
    { url: "https://renajud.pdpj.jus.br/veiculo/restricao/inclusao", runScripts: "outside-only" });
  const w = dom.window;
  const mem = { "cratos:renajud_estado": estado || { ativo: true, operacao: "inclusao", numProcesso: "00000012320255180008" } };
  const enviadas = [];
  const faixas = [];
  w.browser = {
    storage: { local: {
      get: async (k) => ({ [k]: mem[k] }),
      set: async (o) => Object.assign(mem, o),
      remove: async () => {},
    } },
    runtime: {
      sendMessage: async (m) => { enviadas.push(m); return { ok: true }; },
      onMessage: { addListener: () => {} },
      getURL: (p) => "moz-extension://x/" + p,
    },
    downloads: { download: async () => 1 },
  };
  /* Assinatura REAL da faixa: (módulo, texto). Até a 1.6.1 este mock aceitava só
     (texto) — imitava o defeito do _faixa do RENAJUD, que mandava o texto no lugar
     do módulo, e por isso o teste passava com a faixa saindo "CRATOS — undefined". */
  w.CratosFaixa = {
    parar: (m, t) => faixas.push(["parar", t, m]),
    alertar: (m, t) => faixas.push(["alertar", t, m]),
    dizer: (m, t) => faixas.push(["dizer", t, m]),
  };
  w.console.log = () => {}; w.console.warn = () => {}; w.console.debug = () => {};
  w.eval(fs.readFileSync(path.join(SRC, "comum", "storage.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(SRC, "conteudo", "renajud.js"), "utf8"));
  return { w, enviadas, faixas };
}
function disparar(w, metodo, status, corpo) {
  w.document.dispatchEvent(new w.CustomEvent("cratos:renajud:restricao", {
    detail: JSON.stringify({ metodo, status, corpo: typeof corpo === "string" ? corpo : JSON.stringify(corpo) }),
  }));
}

(async () => {

/* Versão sem o grampo (qualquer coisa até a 1.0.7) reprova alto e explicando. */
{
  const arq = fs.readFileSync(path.join(SRC, "conteudo", "renajud.js"), "utf8");
  if (!/cratos:renajud:restricao/.test(arq)) {
    console.log("\n=== teste-renajud-folha.js ===");
    console.log("  FALHA  a versão em " + SRC + " não tem o grampo de API do RENAJUD. " +
      "Nela o comprovante sai da IMPRESSÃO NATIVA: o nome depende do document.title " +
      "(segurado por 6s) e a extensão não fica com os bytes — o RENAJUD não entra no " +
      "diário nem na juntada. É o que esta suíte existe para travar.");
    console.log("\n0 passaram — a suíte inteira reprova nesta versão.\n");
    process.exit(1);
  }
}

/* ── 1. INCLUSÃO ─────────────────────────────────────────────────────────── */
{
  // estado com a executada na lista → o ordinal "1E" resolve pela posição
  const { w, enviadas, faixas } = montar({
    ativo: true, operacao: "inclusao", numProcesso: "00000012320255180008",
    executados: [{ nome: "EMPRESA EXEMPLOECIALIDADES LTDA", cpfcnpj: "12345678000199" }],
  });
  disparar(w, "POST", 200, RESP_INCLUSAO);
  await esperar();
  const m = enviadas.find((x) => x.tipo === "fabricar_pdf");
  checar(!!m, "POST 200 fabrica a folha");
  checar(m && m.convenio === "RENAJUD", "⛔ a mensagem leva convenio (sem ele o diário grava '?')");
  checar(m && m.numProcesso === "00000012320255180008",
    "⛔ a mensagem leva numProcesso — SEM ELE o PDF baixa mas NÃO entra no diário");
  checar(m && m.operacao === "inclusao",
    "⛔ a mensagem leva operacao — é o que separa 'Convênios realizados' de 'Cancelamento'");
  checar(m && /CERTID(Ã|A)O DE INCLUS/.test(m.titulo),
    "o título diz CERTIDÃO, não COMPROVANTE (não se passa pelo documento oficial)");
  checar(m && /RENAJUD Inclusao\.pdf$/.test(m.filename), "nome do arquivo no padrão do CRATOS");
  checar(m && /_1E_/.test(m.filename),
    "⛔ o ORDINAL da executada (1E) entra no nome — dois homônimos não colidem no Cofre");
  checar(m && m.linhas.some((l) => /ABC1D23/.test(l) && /FIAT\/UNO/.test(l)),
    "a folha lista placa e modelo");
  checar(m && m.linhas.some((l) => /8ª VARA DO TRABALHO/.test(l)), "a folha traz o órgão julgador");
  checar(faixas.some((f) => f[0] === "dizer"), "avisa o usuário na faixa (verde) que a folha saiu");
  checar(faixas.length > 0 && faixas.every((f) => f[2] === "renajud" && typeof f[1] === "string" && f[1].length > 0),
    "⛔ a faixa vai com o MÓDULO \"renajud\" e o texto (antes saía \"CRATOS — undefined\")");
}

/* ── 1b. FECHA O POPUP DE COMPROVANTE (o que travava a 2ª parte) ──────────── */
{
  const { w, faixas } = montar();
  /* O modal que o RENAJUD abre depois da restrição — HTML real (03/09): X no
     header (`.btn-close`) e "Imprimir" no rodapé. */
  w.document.body.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h5 class="modal-title">RENAJUD - Restrições Judiciais Sobre Veículos Automotores</h5>
        <button type="button" aria-label="Close" class="btn-close"></button>
      </div>
      <div class="modal-body"><h5>Comprovante de Inclusão de Restrição Veicular</h5></div>
      <div class="modal-footer"><button type="button" class="btn btn-secondary">Imprimir</button></div>
    </div>`;
  let fechouX = false, clicouImprimir = false;
  w.document.querySelector(".btn-close").addEventListener("click", () => { fechouX = true; });
  Array.from(w.document.querySelectorAll("button"))
    .find((b) => /imprimir/i.test(b.textContent))
    .addEventListener("click", () => { clicouImprimir = true; });

  disparar(w, "POST", 200, RESP_INCLUSAO);
  await esperar(250);
  checar(fechouX, "⛔ fecha o popup do comprovante pelo X (btn-close) — destrava a 2ª parte");
  checar(!clicouImprimir, "⛔ NUNCA clica em 'Imprimir' (a folha vem do grampo, não da impressão nativa)");
  checar(faixas.some((f) => f[0] === "dizer" && /comprovante fechado|tela.*livre/i.test(f[1])),
    "avisa na faixa que fechou o comprovante");
}

/* ── 2. BAIXA, sem numeroProcesso no corpo ───────────────────────────────── */
{
  const { w, enviadas } = montar({ ativo: true, operacao: "baixa", numProcesso: "00000012320255180008" });
  disparar(w, "DELETE", 200, RESP_BAIXA);
  await esperar();
  const m = enviadas.find((x) => x.tipo === "fabricar_pdf");
  checar(!!m, "DELETE 200 fabrica a folha de baixa");
  checar(m && m.operacao === "baixa", "a operação vem do MÉTODO, não de palpite");
  checar(m && /RENAJUD Baixa\.pdf$/.test(m.filename), "nome do arquivo diz Baixa");
  checar(m && m.filename.indexOf("00000012320255180008") >= 0,
    "a baixa não traz numeroProcesso no corpo: o número veio do ESTADO");
  checar(m && m.linhas.some((l) => /RETIRADA/.test(l)), "o texto fala em retirada, não em inclusão");
}

/* ── 3. ERRO NUNCA VIRA CERTIDÃO ─────────────────────────────────────────── */
{
  const { w, enviadas } = montar();
  disparar(w, "POST", 500, "<html>erro interno</html>");
  disparar(w, "POST", 403, RESP_INCLUSAO);
  await esperar();
  checar(!enviadas.some((x) => x.tipo === "fabricar_pdf"),
    "resposta de erro (500/403) NÃO produz certidão");
}
{
  const { w, enviadas } = montar();
  disparar(w, "GET", 200, { veiculos: [] });      // busca, sem dadosProcesso
  await esperar();
  checar(!enviadas.some((x) => x.tipo === "fabricar_pdf"),
    "a busca (GET, sem dadosProcesso) é ignorada");
}

/* ── 4. O 400 DO RENAJUD ANTIGO É ROTEAMENTO ─────────────────────────────── */
{
  const { w, enviadas, faixas } = montar({ ativo: true, operacao: "baixa", numProcesso: "00000012320255180008" });
  disparar(w, "DELETE", 400, ERRO_WEB);
  await esperar();
  checar(!enviadas.some((x) => x.tipo === "fabricar_pdf"),
    "o 400 do RENAJUD-WEB não produz documento nenhum");
  const f = faixas.find((x) => /ANTIGO/.test(x[1] || ""));
  checar(!!f, "avisa que a restrição é do RENAJUD antigo");
  checar(f && f[0] === "alertar",
    "é ÂMBAR (segui com ressalva), não vermelho: não houve falha do CRATOS");
  /* A regra não é "não use a palavra retirada" — é NÃO AFIRMAR RESULTADO. O
     servidor recusou a VIA; ele não relatou o estado da restrição. Dizer "não
     foi cancelada" seria a mesma família do assinador do ONR, que errou dizendo
     que errou enquanto o histórico registrava o cancelamento. */
  checar(f && !/(n[ãa]o )?foi (cancelad|retirad|exclu)/i.test(f[1]) &&
              !/cancelamento (n[ãa]o )?(efetivad|realizad)/i.test(f[1]),
    "a mensagem NÃO afirma o que aconteceu com a restrição — só de onde ela vem e por onde se opera");
}

/* ── 5. VEÍCULO COM ERRO DENTRO DE UM 200 ────────────────────────────────── */
{
  const { w, enviadas } = montar();
  disparar(w, "POST", 200, RESP_MISTA);
  await esperar();
  const m = enviadas.find((x) => x.tipo === "fabricar_pdf");
  const txt = (m.linhas || []).join("\n");
  const iOk = txt.indexOf("ABC1D23");
  const iErro = txt.indexOf("XYZ9K88");
  const iTituloErro = txt.search(/NÃO se efetivou/);
  checar(iOk >= 0 && iErro >= 0, "os dois veículos aparecem");
  checar(iTituloErro > 0 && iErro > iTituloErro,
    "o veículo que falhou fica ABAIXO do título 'NÃO se efetivou' — bloco separado");
  checar(iOk < iTituloErro,
    "o veículo que deu certo fica ANTES do bloco de falhas (o documento não se contradiz)");
  checar(/roubo\/furto/.test(txt), "o motivo informado pelo sistema é transcrito");
}

/* ── 6. NÃO DUPLICA ──────────────────────────────────────────────────────── */
{
  const { w, enviadas } = montar();
  disparar(w, "POST", 200, RESP_INCLUSAO);
  await esperar();
  disparar(w, "POST", 200, RESP_INCLUSAO);
  await esperar();
  checar(enviadas.filter((x) => x.tipo === "fabricar_pdf").length === 1,
    "o mesmo ato não gera duas folhas (o grampo pode ver fetch E XHR)");
}

/* ── 7. O GRAMPO EM SI ───────────────────────────────────────────────────── */
{
  const dom = new JSDOM("<!doctype html><body></body>",
    { url: "https://renajud.pdpj.jus.br/veiculo/restricao/inclusao", runScripts: "outside-only" });
  const w = dom.window;
  let chamadasReais = 0;
  w.fetch = function (url, init) {
    chamadasReais++;
    return Promise.resolve({
      status: 200,
      clone() { return this; },
      text() { return Promise.resolve(JSON.stringify(RESP_INCLUSAO)); },
    });
  };
  const vistos = [];
  w.document.addEventListener("cratos:renajud:restricao", (ev) => vistos.push(JSON.parse(ev.detail)));
  w.eval(fs.readFileSync(path.join(SRC, "conteudo", "renajud-api.js"), "utf8"));

  await w.fetch("https://renajud.pdpj.jus.br/api/v1/veiculos/restricoes", { method: "POST" });
  await esperar(50);
  checar(vistos.length === 1, "o grampo emite o evento quando passa /veiculos/restricoes");
  checar(vistos[0] && vistos[0].metodo === "POST", "o grampo informa o MÉTODO");
  checar(vistos[0] && vistos[0].status === 200, "o grampo informa o STATUS");
  checar(typeof (vistos[0] || {}).corpo === "string",
    "o corpo atravessa como STRING (objeto cru não cruza a fronteira de mundos com segurança no Firefox)");
  checar(chamadasReais === 1,
    "⛔ o grampo NÃO re-emite a requisição — re-emitir duplicaria a restrição no veículo");

  vistos.length = 0;
  await w.fetch("https://renajud.pdpj.jus.br/api/v1/veiculos/consulta", { method: "GET" });
  await esperar(50);
  checar(vistos.length === 0, "chamada de outra rota não emite evento");
}

console.log("\n=== teste-renajud-folha.js ===");
oks.forEach((d) => console.log("  ok   " + d));
falhas.forEach((d) => console.log("  FALHA " + d));
console.log(`\n${oks.length} passaram, ${falhas.length} falharam ` +
  `(${oks.length + falhas.length} asserções)\n`);
process.exit(falhas.length ? 1 : 0);

})();
