/*
 * teste-juntada-estrutura.js — a juntada em qualquer TRT (1.9.8). Dados FICTÍCIOS.
 *
 * Relato de 23/11/2026: noutro tribunal, ao criar a certidão, o PJe respondia 404
 * "PJE-003 — Recurso não encontrado" em .../minuta/A/template?idEstruturaDocumento=62.
 * O 62 é a estrutura "Anexar Documentos" do TRT18; no TRT3 ela é a 95 (console de 23/11).
 * A tela de anexar lê a estrutura de `.../documentos/minuta/A/parametros`
 * (estruturasDocumento: [{ id, titulo, padraoFuncionalidade }]) — o CRATOS passa a fazer
 * o mesmo. E o tipo "Documento Diverso" dos anexos deixa de ter a reserva 115/"80".
 *
 * O que se trava aqui:
 *  1. TRT3: template e minuta com a estrutura 95 (nenhum 62 em lugar nenhum).
 *  2. Escolha: pelo título; senão a única padrão; ambíguo ou vazio → para ANTES da minuta.
 *  3. Sem "Documento Diverso" no PJe → para ANTES da minuta (nada criado).
 *  4. Lote do SAB: o número do processo é link para o processo no PJe (pedido de 23/11).
 *
 * Reprova a 1.9.7. Rodar: node teste-juntada-estrutura.js
 * Versão antiga: CRATOS_SRC=<pasta do src> node teste-juntada-estrutura.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const NOME = "teste-juntada-estrutura";
const oks = [], falhas = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }

const TIPOS_TRT3 = [
  { id: 701, nomeTipoProcessoDocumento: "Certidão", codigoDocumento: "9001" },
  { id: 702, nomeTipoProcessoDocumento: "Documento Diverso", codigoDocumento: "9002" },
];
const EST_TRT3 = [{ id: 95, titulo: "Anexar Documentos", padraoFuncionalidade: true }];

function montar(op) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>",
    { url: "https://pje.trt3.jus.br/pjekz/processo/4321/detalhe", runScripts: "outside-only" });
  const w = dom.window;
  const mem = {};
  w.browser = {
    storage: { local: { get: async (k) => ({ [k]: mem[k] }), set: async (o) => Object.assign(mem, o), remove: async () => {} },
      onChanged: { addListener: () => {} } },
    runtime: { sendMessage: async (m) => (m && m.tipo === "cofre_pegar" ? { ok: true, arquivos: [] } : { ok: true }),
      onMessage: { addListener: () => {} }, getURL: (p) => "moz-extension://x/" + p },
  };
  const rede = [];
  const json = (st, corpo) => ({ ok: st >= 200 && st < 300, status: st, json: async () => corpo, text: async () => JSON.stringify(corpo) });
  w.fetch = async (url, init) => {
    const u = String(url), metodo = (init && init.method) || "GET";
    let corpo = null;
    try { corpo = init && init.body ? JSON.parse(init.body) : null; } catch (e) { /* nada */ }
    rede.push({ url: u, metodo, corpo });
    if (/minuta\/A\/metadados$/.test(u) && metodo === "GET") return { ok: true, status: 204, json: async () => null, text: async () => "" };
    if (/minuta\/A\/parametros$/.test(u)) return json(200, { estruturasDocumento: op.estruturas, documentos: [] });
    if (/tiposdocumentoprocesso\/processo\/\d+$/.test(u)) return json(200, op.tipos);
    if (/dominio\/tiposdocumentoprocesso$/.test(u)) return json(200, op.catalogo || op.tipos);
    if (/minuta\/A\/template/.test(u)) {
      if (!/idEstruturaDocumento=95$/.test(u) && op.so95) return json(404, { codigoErro: "PJE-003" });
      return json(200, { topicos: [{ id: 1, conteudo: "" }], minutaTipoFuncionalidade: "ANEXAR" });
    }
    if (/minuta\/A\/metadados$/.test(u) && metodo === "POST") return json(200, { id: 5001, version: 1, md5: "m", idPessoaInclusao: 77 });
    return json(200, {});
  };
  w.console.log = () => {}; w.console.warn = () => {}; w.console.error = () => {};
  for (const f of ["comum/storage.js", "comum/relatorio.js", "comum/faixa.js", "comum/sab-leitura.js", "comum/periodo.js", "conteudo/painel.js"]) {
    const arq = path.join(SRC, f);
    if (fs.existsSync(arq)) w.eval(fs.readFileSync(arq, "utf8"));
  }
  return { w, rede };
}

const CERT = { tipo: "realizados", titulo: "Certidão de convênios", html: "<p>CERTIDÃO FICTÍCIA</p>", arquivos: [] };
const criouMinuta = (rede) => rede.some((x) => x.metodo === "POST" && /minuta\/A\/metadados$/.test(x.url));

(async () => {
  /* ── 1. TRT3 ── */
  {
    const { w, rede } = montar({ estruturas: EST_TRT3, tipos: TIPOS_TRT3, so95: true });
    let erro = null;
    try { await w.__cratosJuntada.juntarCertidao("4321", CERT, "0000001-23.2026.5.03.0001"); } catch (e) { erro = e; }
    const tpl = rede.find((x) => /minuta\/A\/template/.test(x.url));
    const meta = rede.find((x) => x.metodo === "POST" && /minuta\/A\/metadados$/.test(x.url));
    checar(!erro && tpl && /idEstruturaDocumento=95$/.test(tpl.url),
      "⛔ TRT3: o modelo é pedido com a estrutura 95, lida dos parâmetros do processo (antes: 62 → 404 PJE-003)");
    checar(meta && meta.corpo && meta.corpo.estruturaDocumento && meta.corpo.estruturaDocumento.id === 95 &&
      meta.corpo.estruturaDocumento.titulo === "Anexar Documentos" && meta.corpo.idTipo === 701,
      "TRT3: a minuta nasce com a estrutura 95 e o tipo \"Certidão\" do catálogo de lá");
    checar(rede.some((x) => /minuta\/A\/parametros$/.test(x.url)) && !rede.some((x) => /=62\b/.test(x.url)),
      "os parâmetros do PJe são lidos; nenhum 62 do TRT18 em lugar nenhum");
  }

  /* ── 2. regra de escolha ── */
  {
    const E = (() => { const { w } = montar({ estruturas: [], tipos: TIPOS_TRT3 }); return w.__cratosJuntada.escolherEstrutura; })();
    const tenta = (lista) => { try { return E ? E({ estruturasDocumento: lista }) : null; } catch (e) { return e; } };
    const a = tenta([{ id: 10, titulo: "Petição", padraoFuncionalidade: true }, { id: 95, titulo: "anexar documentos", padraoFuncionalidade: false }]);
    checar(a && a.id === 95, "pelo título \"Anexar Documentos\" (sem acento/caixa), mesmo havendo outra marcada como padrão");
    const b = tenta([{ id: 33, titulo: "Juntada", padraoFuncionalidade: true }, { id: 34, titulo: "Outra", padraoFuncionalidade: false }]);
    checar(b && b.id === 33, "sem o título: a ÚNICA marcada como padrão");
    const c = tenta([{ id: 1, titulo: "A", padraoFuncionalidade: true }, { id: 2, titulo: "B", padraoFuncionalidade: true }]);
    checar(c && typeof c.message === "string" && /não consegui decidir/.test(c.message), "duas padrão e nenhuma \"Anexar Documentos\": não chuta — para");
    const d = tenta([]);
    checar(d && typeof d.message === "string" && /não informou/.test(d.message), "lista vazia: para");
  }
  for (const [rotulo, estruturas] of [["sem estrutura", []], ["estrutura ambígua", [{ id: 1, titulo: "A", padraoFuncionalidade: true }, { id: 2, titulo: "B", padraoFuncionalidade: true }]]]) {
    const { w, rede } = montar({ estruturas, tipos: TIPOS_TRT3 });
    let erro = null;
    try { await w.__cratosJuntada.juntarCertidao("4321", CERT, "x"); } catch (e) { erro = e; }
    checar(erro && /Nada foi criado/.test(erro.message) && !criouMinuta(rede) && !rede.some((x) => /template/.test(x.url)),
      `⛔ ${rotulo}: para ANTES do modelo e da minuta — o processo fica intacto`);
  }

  /* ── 3. sem "Documento Diverso" ── */
  {
    const soCert = [{ id: 701, nomeTipoProcessoDocumento: "Certidão", codigoDocumento: "9001" }];
    const { w, rede } = montar({ estruturas: EST_TRT3, tipos: soCert, catalogo: soCert });
    let erro = null;
    try { await w.__cratosJuntada.juntarCertidao("4321", CERT, "x"); } catch (e) { erro = e; }
    checar(erro && /Documento Diverso/.test(erro.message) && /Nada foi criado/.test(erro.message) && !criouMinuta(rede),
      "⛔ sem o tipo \"Documento Diverso\" no PJe: para antes da minuta (sem a reserva 115/\"80\" do TRT18)");
    const painel = fs.readFileSync(path.join(SRC, "conteudo", "painel.js"), "utf8");
    checar(!/\|\|\s*115\b/.test(painel) && !/\|\|\s*"80"/.test(painel) && !/idEstruturaDocumento=62/.test(painel),
      "painel: nenhum número do TRT18 (62, 115, \"80\") como reserva");
  }

  /* ── 4. lote do SAB: número com link ── */
  {
    const { w } = montar({ estruturas: EST_TRT3, tipos: TIPOS_TRT3 });
    const L = w.__cratosJuntada.linkProcessoLote;
    const box = w.document.createElement("div");
    if (L) w.CratosHTML.definir(box, L({ numero: "00014660820255180008", idPJe: 98765 }));
    const a = box.querySelector("a");
    checar(a && a.getAttribute("href") === "https://pje.trt3.jus.br/pjekz/processo/98765/detalhe" &&
      a.getAttribute("target") === "_blank" && /noopener/.test(a.getAttribute("rel") || "") && /0001466-08\.2025\.5\.18\.0008/.test(a.textContent),
      "⛔ lote do SAB: o número do processo abre o processo no PJe deste tribunal (nova aba)");
    const box2 = w.document.createElement("div");
    if (L) w.CratosHTML.definir(box2, L({ numero: "00014660820255180008", idPJe: "12 OR 1" }));
    checar(L && !box2.querySelector("a") && /0001466-08/.test(box2.textContent), "sem id do PJe confiável: só o número, sem link");
  }

  console.log(`\n=== ${NOME} ===`);
  oks.forEach((d) => console.log("  ok   " + d));
  falhas.forEach((d) => console.log("  FALHA " + d));
  console.log(`\n${oks.length} passaram, ${falhas.length} falharam (${oks.length + falhas.length} asserções)\n`);
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.log("FALHA geral: " + e.stack); process.exit(1); });
