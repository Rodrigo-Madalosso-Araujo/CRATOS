/*
 * teste-renajud-multiparte.js — o encadeamento das PARTES dentro do RENAJUD.
 *
 * O bug que esta suíte trava (campo, 11/09): com mais de um executado COM veículo,
 * o CRATOS incluía a restrição da 1ª parte, emitia a folha, fechava o popup... e
 * PARAVA. Não pesquisava o 2º executado. E como o painel espera uma folha por
 * executado (esperados = nº de executados), a fila também não avançava — certo em
 * esperar, só que a 2ª folha nunca vinha. Resultado: travava.
 *
 * A regra do Rodrigo: o gatilho para o próximo executado é o DOWNLOAD da certidão
 * do anterior. Uma certidão por executado (todos os veículos num ato só), então a
 * folha = parte concluída → pesquisa a próxima sozinho.
 *
 * O que se trava aqui:
 *  1. ⛔ Depois da folha da 1ª parte, o CRATOS pesquisa sozinho o 2º executado
 *     (preenche o documentoIdentificacao com o CPF/CNPJ da 2ª parte e Pesquisa).
 *     É ISTO que reprova a 1.2.9.
 *  2. A folha da 1ª parte continua saindo normalmente (o avanço não atropela).
 *  3. Descobre "qual parte acabou" pelo DOCUMENTO do proprietário na resposta —
 *     não avança para a parte errada.
 *  4. Um executado só → NÃO avança (não há para onde ir).
 *  5. Folha do ÚLTIMO executado → NÃO reinicia a busca (proxIdx fora da lista).
 *  6. O mesmo ato disparado duas vezes (grampo vê fetch E XHR) avança UMA vez só.
 *  7. ⛔ Erro "já possui restrição" (POST 400/422) EMITE certidão de restrição
 *     PREEXISTENTE e avança — a 1.3.0 engolia o erro e travava. O título não
 *     afirma inclusão nova (o CRATOS não incluiu; o sistema disse que já existia).
 *  8. Outro erro qualquer NÃO vira certidão, mas vira faixa âmbar (não some calado)
 *     e NÃO avança.
 *
 * Rodar: node teste-renajud-multiparte.js
 * Versão antiga: CRATOS_SRC=<pasta do xpi descompactado> node teste-renajud-multiparte.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const falhas = [];
const oks = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }
const dormir = (ms) => new Promise((r) => setTimeout(r, ms || 30));

const DOC_A = "11111111111";
const DOC_B = "22222222222";

function respParaDoc(doc, nome) {
  return {
    dadosProcesso: {
      numeroProcesso: "00000012320255180008",
      magistrado: { nome: "FULANO DE TAL" },
      orgao: { nome: "8ª VARA DO TRABALHO DE GOIANIA", tribunal: { nome: "TRT DA 18ª REGIÃO" } },
    },
    veiculos: [
      { placa: "ABC1D23", marcaModelo: "FIAT/UNO",
        proprietario: { nome: nome || "PARTE", documento: doc }, tipoRestricao: "Transferência" },
    ],
  };
}

/* DOM que imita o estado logo após a inclusão: o popup de comprovante aberto
   (para o fecharPopupComprovante fechar) MAIS a tela de pesquisa por CPF/CNPJ
   (routerlink + campo + botões), para onde o CRATOS volta para a próxima parte. */
function corpoPosInclusao() {
  return `
    <a routerlink="/veiculo/pesquisa">Pesquisar restrição</a>
    <input id="documentoIdentificacao" />
    <input id="numeroProcesso" />
    <button type="button">Limpar</button>
    <button type="button">Pesquisar</button>
    <div class="modal-content">
      <div class="modal-header">
        <h5 class="modal-title">RENAJUD - Restrições Judiciais Sobre Veículos Automotores</h5>
        <button type="button" aria-label="Close" class="btn-close"></button>
      </div>
      <div class="modal-body"><h5>Comprovante de Inclusão de Restrição Veicular</h5></div>
      <div class="modal-footer"><button type="button" class="btn btn-secondary">Imprimir</button></div>
    </div>
    <div id="resultado">Nenhum veículo encontrado</div>`;
}

function montar(estado, corpo) {
  const dom = new JSDOM(`<!doctype html><html><body>${corpo || ""}</body></html>`,
    { url: "https://renajud.pdpj.jus.br/veiculo/restricao/inclusao", runScripts: "outside-only" });
  const w = dom.window;
  /* ativo:false → iniciarFluxo NÃO roda (não precisamos do fluxo inteiro; dirigimos
     a folha direto pelo evento). fabricarFolha lê o estado assim mesmo. */
  const mem = { "cratos:renajud_estado": estado };
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

/* ── 1. DOIS EXECUTADOS COM VEÍCULO: a folha da 1ª puxa a busca da 2ª ──────── */
{
  const { w, enviadas } = montar({
    ativo: false, operacao: "inclusao", numProcesso: "00000012320255180008",
    executados: [{ nome: "JOAO", cpfcnpj: DOC_A }, { nome: "MARIA", cpfcnpj: DOC_B }],
  }, corpoPosInclusao());

  // espiões nos botões da tela de pesquisa
  let clicouLimpar = false, clicouPesquisar = false;
  Array.from(w.document.querySelectorAll("button"))
    .find((b) => /^\s*limpar\s*$/i.test(b.textContent || ""))
    .addEventListener("click", () => { clicouLimpar = true; });
  Array.from(w.document.querySelectorAll("button"))
    .find((b) => /^\s*pesquisar\s*$/i.test(b.textContent || ""))
    .addEventListener("click", () => { clicouPesquisar = true; });

  disparar(w, "POST", 200, respParaDoc(DOC_A, "JOAO"));
  await dormir(1500);

  const folha = enviadas.find((x) => x.tipo === "fabricar_pdf");
  checar(!!folha, "a folha da 1ª parte sai normalmente (o avanço não atropela)");

  const campo = w.document.querySelector('input[id="documentoIdentificacao"]');
  checar(campo && campo.value.replace(/\D/g, "") === DOC_B,
    "⛔ depois da folha da 1ª parte, o CRATOS pesquisa SOZINHO o 2º executado " +
    "(documentoIdentificacao = CPF/CNPJ da 2ª parte). É isto que a 1.2.9 não faz.");
  checar(clicouLimpar, "limpa o formulário antes de pesquisar a próxima parte");
  checar(clicouPesquisar, "aciona 'Pesquisar' para o 2º executado");
}

/* ── 2. UM EXECUTADO SÓ: não há para onde avançar ─────────────────────────── */
{
  const { w, enviadas } = montar({
    ativo: false, operacao: "inclusao", numProcesso: "00000012320255180008",
    executados: [{ nome: "JOAO", cpfcnpj: DOC_A }],
  }, corpoPosInclusao());

  disparar(w, "POST", 200, respParaDoc(DOC_A, "JOAO"));
  await dormir(1200);

  const folha = enviadas.find((x) => x.tipo === "fabricar_pdf");
  checar(!!folha, "com um executado, a folha sai igual");
  const campo = w.document.querySelector('input[id="documentoIdentificacao"]');
  checar(!campo.value, "um executado só → NÃO dispara nenhuma busca nova (nada a avançar)");
}

/* ── 3. FOLHA DO ÚLTIMO EXECUTADO: não reinicia a busca ───────────────────── */
{
  // A folha veio da parte de índice 1 (documento B), que é a última. Não pode
  // voltar a pesquisar ninguém.
  const { w } = montar({
    ativo: false, operacao: "inclusao", numProcesso: "00000012320255180008",
    executados: [{ nome: "JOAO", cpfcnpj: DOC_A }, { nome: "MARIA", cpfcnpj: DOC_B }],
  }, corpoPosInclusao());

  disparar(w, "POST", 200, respParaDoc(DOC_B, "MARIA"));
  await dormir(1200);

  const campo = w.document.querySelector('input[id="documentoIdentificacao"]');
  checar(!campo.value,
    "folha do ÚLTIMO executado (índice fora do fim da lista) NÃO reinicia a busca");
}

/* ── 4. DOCUMENTO DESCONHECIDO: não chuta um avanço ───────────────────────── */
{
  const { w } = montar({
    ativo: false, operacao: "inclusao", numProcesso: "00000012320255180008",
    executados: [{ nome: "JOAO", cpfcnpj: DOC_A }, { nome: "MARIA", cpfcnpj: DOC_B }],
  }, corpoPosInclusao());

  // proprietário cujo documento não está na lista de executados
  disparar(w, "POST", 200, respParaDoc("99999999999", "ESTRANHO"));
  await dormir(1200);

  const campo = w.document.querySelector('input[id="documentoIdentificacao"]');
  checar(!campo.value,
    "documento fora da lista de executados → não avança às cegas (sem _idxAtual, não chuta)");
}

/* ── 5. NÃO AVANÇA DUAS VEZES (grampo vê fetch E XHR) ─────────────────────── */
{
  const { w } = montar({
    ativo: false, operacao: "inclusao", numProcesso: "00000012320255180008",
    executados: [{ nome: "JOAO", cpfcnpj: DOC_A }, { nome: "MARIA", cpfcnpj: DOC_B }],
  }, corpoPosInclusao());

  disparar(w, "POST", 200, respParaDoc(DOC_A, "JOAO"));
  await dormir(300);
  disparar(w, "POST", 200, respParaDoc(DOC_A, "JOAO"));   // duplicata do MESMO ato
  await dormir(1200);

  const campo = w.document.querySelector('input[id="documentoIdentificacao"]');
  checar(campo.value.replace(/\D/g, "") === DOC_B,
    "avança para a 2ª parte (B), não pula para além dela por causa da duplicata");
}

/* ── 6. BAIXA não é por parte: o avanço não se aplica ─────────────────────── */
{
  const { w, enviadas } = montar({
    ativo: false, operacao: "baixa", numProcesso: "00000012320255180008",
    executados: [{ nome: "JOAO", cpfcnpj: DOC_A }, { nome: "MARIA", cpfcnpj: DOC_B }],
  }, corpoPosInclusao());

  disparar(w, "DELETE", 200, respParaDoc(DOC_A, "JOAO"));
  await dormir(1200);

  const folha = enviadas.find((x) => x.tipo === "fabricar_pdf");
  checar(!!folha, "a baixa gera a folha");
  const campo = w.document.querySelector('input[id="documentoIdentificacao"]');
  checar(!campo.value,
    "na BAIXA (busca por processo, lista tudo de uma vez) não há avanço por executado");
}

/* ── 7. RESTRIÇÃO JÁ EXISTENTE: certifica o preexistente e avança ─────────── */
{
  // Campo (11/09): POST /veiculos/restricoes volta HTTP 400 com o corpo
  // "Veículo já possui restrição Renajud do mesmo orgão, processo e tipo"
  // (o WS retornou 422). NÃO é falha: a constrição já está lançada. Em vez de
  // travar, o CRATOS emite a certidão de restrição PREEXISTENTE e avança.
  const CORPO_JA_POSSUI = {
    codigo: "400",
    mensagem: "Não foi possível realizar a operação. A execução do método " +
      "RenajudWsClient#incluiRestricaoVeiculo retornou o código HTTP 422. " +
      "RENAJUD-WS (Erro de negócio): Veículo já possui restrição Renajud do mesmo " +
      "orgão, processo e tipo",
  };
  const { w, enviadas, faixas } = montar({
    ativo: false, operacao: "inclusao", numProcesso: "00000012320255180008",
    executados: [{ nome: "COMERCIO EXEMPLO LTDA", cpfcnpj: DOC_A },
                 { nome: "MARIA", cpfcnpj: DOC_B }],
    config: { tipoRestricao: ["Circulação (Restrição Total)"] },
  }, corpoPosInclusao());

  // simula o fluxo parado na 1ª parte (com veículo), que é quando a inclusão falha
  checar(!!w.__cratosRenajud, "expõe o hook de teste __cratosRenajud (para simular a parte parada)");
  if (w.__cratosRenajud) w.__cratosRenajud.idxAtual = 0;

  disparar(w, "POST", 400, CORPO_JA_POSSUI);
  await dormir(1500);

  const cert = enviadas.find((x) => x.tipo === "fabricar_pdf");
  checar(!!cert, "⛔ o erro 'já possui restrição' EMITE certidão (a 1.3.0 engolia o erro e travava)");
  checar(cert && /PREEXISTENTE/i.test(cert.titulo || ""),
    "o título diz RESTRIÇÃO PREEXISTENTE — não se passa por uma inclusão feita agora");
  checar(cert && !/DE INCLUS/i.test(cert.titulo || ""),
    "⛔ NÃO afirma inclusão nova (o CRATOS não incluiu nada; o sistema disse que já existia)");
  checar(cert && (cert.linhas || []).some((l) => /j[áa] possui restri/i.test(l)),
    "o texto certifica a resposta do sistema (já possui restrição)");
  checar(cert && /Restricao Preexistente\.pdf$/.test(cert.filename || ""),
    "nome do arquivo no padrão do CRATOS (Restricao Preexistente)");
  checar(cert && cert.numProcesso === "00000012320255180008" && cert.convenio === "RENAJUD",
    "a certidão leva numProcesso e convenio (entra no diário e conta como folha)");
  const campo = w.document.querySelector('input[id="documentoIdentificacao"]');
  checar(campo && campo.value.replace(/\D/g, "") === DOC_B,
    "⛔ depois de certificar o preexistente, avança sozinho para o próximo executado");
  checar(faixas.some((f) => f[0] === "dizer"), "avisa na faixa (verde) que certificou e seguiu");
}

/* ── 8. OUTRO erro do RENAJUD: não vira certidão, mas NÃO some calado ─────── */
{
  const { w, enviadas, faixas } = montar({
    ativo: false, operacao: "inclusao", numProcesso: "00000012320255180008",
    executados: [{ nome: "JOAO", cpfcnpj: DOC_A }, { nome: "MARIA", cpfcnpj: DOC_B }],
  }, corpoPosInclusao());
  if (w.__cratosRenajud) w.__cratosRenajud.idxAtual = 0;

  disparar(w, "POST", 500, "<html>erro interno</html>");
  await dormir(1200);

  checar(!enviadas.some((x) => x.tipo === "fabricar_pdf"),
    "erro genérico (500) NÃO vira certidão (a regra de ferro continua valendo)");
  checar(faixas.some((f) => f[0] === "alertar"),
    "⛔ erro genérico deixa de ser engolido em silêncio — vira faixa âmbar");
  const campo = w.document.querySelector('input[id="documentoIdentificacao"]');
  checar(!campo.value,
    "erro genérico NÃO avança (não dá para ter certeza de que a parte terminou)");
}

console.log("\n=== teste-renajud-multiparte.js ===");
oks.forEach((d) => console.log("  ok   " + d));
falhas.forEach((d) => console.log("  FALHA " + d));
console.log(`\n${oks.length} passaram, ${falhas.length} falharam ` +
  `(${oks.length + falhas.length} asserções)\n`);
process.exit(falhas.length ? 1 : 0);

})();
