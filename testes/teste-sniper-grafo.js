/*
 * teste-sniper-grafo.js — o GRAFO DE VÍNCULOS do SNIPER no relatório (1.9.3).
 * Dados 100% FICTÍCIOS (fixture-sniper.js → GRAFO), no formato das respostas da API.
 *
 * O que se trava aqui (a leitura na tela fica no teste-sniper.js, seção 8):
 *  1. MODELO (comum/grafo-sniper.js → montar): o desenho = partes + vizinhos diretos
 *     (/grafo/node/{uuid}); um grafo por componente, na ordem das partes; parte sem
 *     ligação não vira página (vai para "sem vínculos"); tom escuro só para quem tem
 *     TODAS as relações no desenho (/relationships); ficha só de TERCEIRO, com a data de
 *     entrada e SEM a relação "*" (fora do desenho); candidatura tratada como as outras.
 *  2. ⛔ Resposta faltando (parte sem /grafo/node, sem partes) → ok:false, nunca um grafo
 *     "vazio" (regra de ferro: falha técnica não vira "sem vínculos").
 *  3. Desenho em camadas: toda seta desce (sócio em cima, empresa embaixo).
 *  4. PÁGINAS (paginas): uma por grafo + uma por terceiro; só as fontes /F1 e /F2; só
 *     bytes Latin-1/WinAnsi; parênteses escapados; travessão no código WinAnsi.
 *  5. FUNDO (background.js): gerarPDFTexto(…, extras) acrescenta as páginas DEPOIS do
 *     texto; fabricar_pdf passa o modelo; o PDF abre (qpdf) e o texto sai (pdftotext).
 *
 * Reprova a 1.9.2 (não há comum/grafo-sniper.js).
 * Rodar: node teste-sniper-grafo.js   ·   versão antiga: CRATOS_SRC=<pasta> node …
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");
const F = require("./fixture-sniper.js");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const NOME = "teste-sniper-grafo.js";
const oks = [], falhas = [];
const checar = (c, d) => (c ? oks : falhas).push(d);

const ARQ = path.join(SRC, "comum", "grafo-sniper.js");
if (!fs.existsSync(ARQ)) {
  console.log(`\n=== ${NOME} ===\n  FALHA  a versão em ${SRC} não tem o grafo do SNIPER (comum/grafo-sniper.js).\n\n0 passaram — a suíte inteira reprova nesta versão.\n`);
  process.exit(1);
}

const ctx = { console: { log() {}, warn() {}, error() {} } };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(ARQ, "utf8"), ctx);
const G = ctx.CratosGrafoSniper;
const G1 = F.GRAFO;
const entrada = (o) => Object.assign({
  partes: G1.PARTES.filter((p) => p.selecionada).map((p) => p.uuid),
  nos: G1.NO, rel: G1.REL,
  meta: { processo: F.PROC_FMT, investigacao: F.ID, consultaEm: "2026-11-10T15:00:00-03:00" },
}, o || {});

/* ── 1. modelo ─────────────────────────────────────────────────────────── */
const m = G.montar(JSON.parse(JSON.stringify(entrada())));
checar(m.ok && m.grafos.length === 2, "modelo: dois grafos (dois componentes), como na tela");
const [g1, g2] = m.grafos || [];
checar(g1 && g1.numero === 1 && g1.nos.length === 5 && g1.arestas.length === 4 && g1.partes.length === 3 &&
  g1.partes[0] === F.NOME_PJ, "grafo 1: 3 partes + 2 terceiros, 4 ligações, na ordem das partes do SNIPER");
checar(g2 && g2.nos.length === 5 && g2.arestas.length === 4 && g2.partes.join() === "COMERCIO FICTICIO S.A." && g2.terceiros.length === 4,
  "grafo 2: 1 parte + 4 terceiros (vizinhos diretos), 4 ligações");
checar(m.totalTerceiros === 6 && m.totalArestas === 8, "modelo: 6 terceiros e 8 ligações no total");
checar(!JSON.stringify(m).includes("EMPRESA FORA DO DESENHO"),
  "⛔ o nó que só aparece no /relationships (fora do desenho do SNIPER) NÃO entra");
checar(Array.isArray(m.semVinculos) && m.semVinculos.join() === "CICRANO ISOLADO FICTICIO" &&
  !m.grafos.some((g) => g.nos.some((n) => n.rotulo === "CICRANO ISOLADO FICTICIO")),
  "parte sem nenhuma ligação: não vira página, vai para \"sem vínculos\"");
checar(!JSON.stringify(m).includes("g-nao-selecionada"), "parte NÃO selecionada na investigação fica de fora");
const no = (nome) => m.grafos.reduce((a, g) => a.concat(g.nos), []).find((n) => n.rotulo === nome) || {};
checar(no("SICRANA TERCEIRA FICTICIA").expandido === false && no("ESSENCIA FICTICIA DO COURO LTDA").expandido === false &&
  no("SOCIO FICTICIO JUNIOR").expandido === false,
  "tom CLARO: relação fora do desenho (o \"*\") ou sem /relationships para afirmar");
checar(no("HOLDING FICTICIA (PARTICIPACOES) LTDA").expandido === true && no("ADMINISTRADOR FICTICIO NETO").expandido === true &&
  no("CANDIDATURA FICTICIA 2024").expandido === true && no(F.NOME_PJ).expandido === true,
  "tom ESCURO: todas as relações no desenho (e as partes)");
checar(no("CANDIDATURA FICTICIA 2024").grupo === "candidatura" && no("HOLDING FICTICIA (PARTICIPACOES) LTDA").grupo === "entidade" &&
  no("ADMINISTRADOR FICTICIO NETO").grupo === "individuo", "legenda do SNIPER: entidade / indivíduo / candidatura (genérico)");
const terc = (nome) => m.grafos.reduce((a, g) => a.concat(g.terceiros), []).find((t) => t.rotulo === nome) || {};
checar(m.grafos.every((g) => g.terceiros.every((t) => !g.partes.includes(t.rotulo))) && !terc(F.NOME_PJ).rotulo,
  "ficha só de TERCEIRO (as partes já estão no relatório)");
const t5 = terc("ESSENCIA FICTICIA DO COURO LTDA");
checar(t5.entrada && t5.entrada.length === 1 && t5.entrada[0].nome === "COMERCIO FICTICIO S.A." && t5.entrada[0].parte === true &&
  t5.entrada[0].relacao === "Sócio" && t5.entrada[0].data === "20/11/2020",
  "ficha: relação de entrada com origem, relação e DATA DE ENTRADA na sociedade");
checar(t5.entrada && !t5.entrada.some((r) => /FORA DO DESENHO/.test(r.nome)), "⛔ ficha: a relação \"*\" (não expandida) NÃO entra");
const t1 = terc("SICRANA TERCEIRA FICTICIA");
checar(t1.entrada && t1.entrada.length === 0 && t1.saida.length === 1 && t1.saida[0].nome === F.NOME_PJ,
  "ficha: sócia de uma parte → relação de SAÍDA (a seta sai de quem tem o vínculo)");
checar(t1.doc && t1.doc.tipo === "CPF" && t1.doc.valor === "444.555.666-77" && terc("HOLDING FICTICIA (PARTICIPACOES) LTDA").doc.valor === "12.312.312/0001-12",
  "CPF/CNPJ do nó, formatado (sem máscara de sigilo — decisão do Rodrigo)");
checar(t1.props && t1.props.some(([k, v]) => k === "Município" && v === "CIDADE FICTICIA"), "ficha: os \"Detalhes do objeto\" vêm todos, como o SNIPER exibe");

/* ── 2. ⛔ resposta faltando ─────────────────────────────────────────────── */
{
  const semNo = Object.assign({}, G1.NO); delete semNo["g-p4"];
  const r = G.montar(entrada({ nos: semNo }));
  checar(r.ok === false && r.faltam === 1 && !r.grafos, "⛔ parte sem /grafo/node: ok:false (\"não pôde ser obtido\"), nunca grafo parcial");
  const r2 = G.montar(entrada({ partes: [] }));
  checar(r2.ok === false && !r2.grafos, "⛔ sem partes: ok:false");
  const r3 = G.montar(entrada({ rel: {} }));
  checar(r3.ok && r3.grafos.every((g) => g.nos.every((n) => n.parte || n.expandido === false)),
    "sem /relationships: o grafo sai, todo terceiro em tom claro (não dá para afirmar que está expandido)");
}

/* ── 3. camadas ────────────────────────────────────────────────────────── */
{
  const desce = m.grafos.every((g) => {
    const p = Object.fromEntries(g.nos.map((n) => [n.id, n]));
    return g.arestas.every((a) => p[a.de].y < p[a.para].y);
  });
  checar(desce, "desenho em camadas: toda seta desce (sócio em cima, empresa embaixo)");
  const cheio = G.montar({
    partes: ["x0"],
    nos: { x0: { id: "x0", group: "company", label: "EMPRESA CENTRAL FICTICIA", properties: {},
      graph: { nodes: Array.from({ length: 12 }, (_, i) => ({ id: "s" + i, group: "person", label: "SOCIO FICTICIO " + i, properties: {} })),
        edges: Array.from({ length: 12 }, (_, i) => ({ from: "s" + i, to: "x0", id: "e" + i, label: "Sócio", properties: {} })) } } },
  });
  const xs = cheio.ok ? cheio.grafos[0].nos.map((n) => n.x) : [];
  checar(cheio.ok && Math.max(...xs) - Math.min(...xs) <= G.COLS * 100 && cheio.grafos[0].altura >= 3 * 100,
    "camada larga quebra em linhas (no máximo 5 por linha): 12 sócios não estouram a página");
}

/* ── 4. páginas ────────────────────────────────────────────────────────── */
const bg = fs.readFileSync(path.join(SRC, "background.js"), "utf8");
const W = JSON.parse("[" + (bg.match(/const _W_HELV = \(([\s\S]*?)\)\.split/) || ["", '""'])[1].replace(/"\s*\+\s*"/g, "").replace(/"/g, "") + "]");
const WB = JSON.parse("[" + (bg.match(/const _W_HELV_BOLD = \(([\s\S]*?)\)\.split/) || ["", '""'])[1].replace(/"\s*\+\s*"/g, "").replace(/"/g, "") + "]");
const pags = G.paginas(m, { W, WB });
checar(pags.length === 2 + 6, "páginas: uma por grafo + uma ficha por terceiro (2 + 6)");
checar(/Grafo de v\xednculos \x97 1 de 2/.test(pags[0]) && /Terceiro vinculado \x97 grafo 1/.test(pags[1]),
  "ordem: grafo 1, fichas do grafo 1, grafo 2… (travessão no código WinAnsi)");
checar(pags.every((p) => /BT/.test(p) && (p.match(/\bBT\b/g) || []).length === (p.match(/\bET\b/g) || []).length),
  "cada página: blocos de texto fechados (BT/ET)");
checar(pags.every((p) => !/\/F[03-9]\b/.test(p) && Array.from(p).every((c) => c.charCodeAt(0) <= 0xFF)),
  "só as fontes /F1 e /F2 do gerarPDFTexto, só bytes de 1 byte (WinAnsi)");
checar(pags.join("").includes("HOLDING FICTICIA \\(PARTICIPACOES\\) LTDA") && !/[^\\]\(PARTICIPACOES\)/.test(pags.join("")),
  "⛔ parênteses de nome escapados (não quebram o PDF)");
checar(/Legenda \\\(a do SNIPER\\\)/.test(pags[0]) && /Grafo redesenhado pelo CRATOS/.test(pags[0]) && /n\xba 4242/.test(pags[0]),
  "página do grafo: legenda e nota de procedência (redesenhado, investigação nº)");
const fichaT5 = pags.find((p) => /Detalhes do objeto/.test(p) && p.includes("(ESSENCIA FICTICIA DO COURO LTDA) Tj")) || "";
checar(/Detalhes do objeto/.test(fichaT5) && /Rela\xe7\xf5es de entrada/.test(fichaT5) && /\(20\/11\/2020\) Tj/.test(fichaT5) &&
  !/FORA DO DESENHO/.test(fichaT5), "ficha: Detalhes do objeto + Relações de entrada com a data; sem a relação \"*\"");
checar(G.paginas({ ok: false, motivo: "x" }, { W, WB }).length === 0 && G.paginas(null, {}).length === 0,
  "⛔ modelo de falha: nenhuma página (o texto do relatório é que diz \"não pôde ser obtido\")");
{
  const longo = JSON.parse(JSON.stringify(entrada()));
  const t = longo.nos["g-p4"].graph.nodes.find((n) => n.id === "g-t2");
  for (let i = 0; i < 70; i++) t.properties["Campo fictício " + i] = "valor fictício " + i;
  const pl = G.paginas(G.montar(longo), { W, WB });
  checar(pl.length === 9 && pl.some((p) => /grafo 2 \\\(cont\.\\\)/.test(p)), "ficha longa continua na página seguinte (\"(cont.)\")");
}

/* ── 5. fundo ──────────────────────────────────────────────────────────── */
{
  checar(/case "abrir_manual"|fabricar_pdf/.test(bg) && /gerarPDFTexto\(msg\.linhas \|\| \[\], msg\.titulo \|\| "CRATOS", paginasExtras\(msg\)\)/.test(bg),
    "fabricar_pdf passa o modelo do grafo ao gerarPDFTexto (páginas extras)");
  const man = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8"));
  const bgs = man.background.scripts;
  const cs = (man.content_scripts || []).find((c) => (c.matches || []).includes("https://sniper.pdpj.jus.br/*")) || { js: [] };
  checar(bgs.indexOf("comum/grafo-sniper.js") >= 0 && bgs.indexOf("comum/grafo-sniper.js") < bgs.indexOf("background.js") &&
    cs.js.indexOf("comum/grafo-sniper.js") >= 0 && cs.js.indexOf("comum/grafo-sniper.js") < cs.js.indexOf("conteudo/sniper.js"),
    "manifest: grafo-sniper.js no fundo e no content script do SNIPER, antes de quem o usa");
  const ini = bg.indexOf("function paginasExtras"), fimPE = bg.indexOf("/* Mesma fabricação", ini);
  const iW = bg.indexOf("const _W_HELV = "), fim = bg.indexOf("function latin1Bytes");
  const fimL = bg.indexOf("\n}\n", fim) + 3;
  let ok = ini > 0 && iW > 0 && fim > 0;
  if (ok) {
    const c2 = { console: ctx.console, CratosGrafoSniper: G };
    vm.createContext(c2);
    vm.runInContext(bg.slice(iW, fimL) + "\n" + bg.slice(ini, fimPE) + "\nthis.__g = gerarPDFTexto; this.__pe = paginasExtras;", c2);
    const linhas = ["", "Processo: " + F.PROC_FMT, "GRAFO DE VÍNCULOS (SNIPER)"];
    const semGrafo = c2.__g(linhas, "RELATÓRIO FICTÍCIO", c2.__pe({}));
    const comGrafo = c2.__g(linhas, "RELATÓRIO FICTÍCIO", c2.__pe({ grafoSniper: m }));
    const conta = (b) => Number((Buffer.from(b).toString("latin1").match(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/) || [])[1]);
    checar(conta(semGrafo) === 1 && conta(comGrafo) === 1 + 8, "PDF: sem modelo = só o texto; com modelo = texto + 8 páginas do grafo, DEPOIS do texto");
    checar(c2.__pe({ grafoSniper: { ok: true, grafos: "lixo" } }).length === 0, "modelo malformado: sem páginas extras (o relatório sai)");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cratos-grafo-"));
    const arq = path.join(tmp, "relatorio.pdf");
    fs.writeFileSync(arq, Buffer.from(comGrafo));
    let valido = false, txt = "";
    try { execFileSync("qpdf", ["--check", arq], { stdio: "pipe" }); valido = true; } catch (e) { valido = false; }
    try { txt = execFileSync("pdftotext", ["-layout", arq, "-"], { encoding: "utf8" }); } catch (e) { txt = ""; }
    checar(valido, "PDF com o grafo passa no qpdf --check (estrutura e xref íntegros)");
    checar(/Grafo de vínculos — 2 de 2/.test(txt) && /SICRANA TERCEIRA FICTICIA/.test(txt) && /Relações de entrada/.test(txt) &&
      /HOLDING FICTICIA \(PARTICIPACOES\) LTDA/.test(txt), "texto do PDF legível (acentos, travessão e parênteses certos)");
    if (process.env.CRATOS_GRAFO_PDF) fs.copyFileSync(arq, process.env.CRATOS_GRAFO_PDF);
    fs.rmSync(tmp, { recursive: true, force: true });
  } else checar(false, "fundo: gerarPDFTexto/paginasExtras não encontrados");
}

/* ── 6. relatório desenhado (1.9.3) ───────────────────────────────────── */
{
  const blocos = [
    { t: "secao", texto: "Identificação" },
    { t: "kv", pares: [["Processo", F.PROC_FMT], ["Investigação no SNIPER", "nº 4242"]] },
    { t: "secao", texto: "Resumo das fontes" },
    { t: "tabela", colunas: [{ titulo: "Fonte", peso: 5 }, { titulo: "Situação", peso: 3 }],
      linhas: [["Sisbajud (contas)", { texto: "com resultado", tom: "ok" }], ["SNGB (bens apreendidos)", { texto: "erro da fonte", tom: "erro" }]] },
    { t: "secao", texto: "SNGB (bens apreendidos)", selo: { texto: "erro da fonte", tom: "erro" } },
    { t: "par", tom: "alerta", texto: "A fonte retornou erro: Erro fictício (com parênteses)." },
    { t: "tabela", titulo: "Processos em nome da parte: 120", colunas: [{ titulo: "Número" }, { titulo: "Tribunal" }],
      linhas: Array.from({ length: 120 }, (_, i) => [`00000${10 + i}-11.2025.5.18.0001`, "TRT18"]) },
  ];
  const meta = { processo: F.PROC_FMT, investigacao: "4242", consultaEm: "2026-11-10T15:00:00-03:00" };
  const tp = G.relatorio(blocos, meta, { W, WB });
  checar(tp.length >= 3 && tp.every((p) => /Relat\xf3rio de investiga\xe7\xe3o patrimonial/.test(p)),
    "relatório desenhado: tabela longa quebra em páginas, cada uma com o cabeçalho");
  checar(tp.slice(1).some((p) => /\(N\xfamero\) Tj/.test(p)), "tabela que continua repete o cabeçalho azul na página seguinte");
  checar(/0\.660 0\.110 0\.110 rg[\s\S]*\(erro da fonte\) Tj/.test(tp[0]) && /0\.080 0\.400 0\.200 rg[\s\S]*\(com resultado\) Tj/.test(tp[0]),
    "selos com a cor da situação (erro em vermelho, resultado em verde)");
  checar(tp.join("").includes("\\(com par\xeanteses\\)"), "⛔ parênteses escapados também no texto do relatório");
  const todas = G.rodape(tp.concat(G.paginas(m, { W, WB })), meta, { W, WB });
  const n = todas.length;
  checar(/\(p\xe1gina 1 de \d+\) Tj/.test(todas[0]) && todas[n - 1].includes(`(p\xe1gina ${n} de ${n}) Tj`),
    "rodapé em todas as páginas, contando também as do grafo (\"página k de N\")");
  checar(G.relatorio([], meta, {}).length === 0 && G.relatorio(null, meta, {}).length === 0, "sem blocos: nada (o fundo usa o texto corrido)");
  const longo = G.relatorio([{ t: "secao", texto: "x" }], { titulo: "Relatório de investigação patrimonial — SNIPER (CNJ)", processo: F.PROC_FMT, investigacao: "4242" }, { W, WB })[0];
  const pt = Number((longo.match(/\/F2 ([\d.]+) Tf\n1 0 0 1 50 800 Tm/) || [])[1]);
  checar(pt > 9 && pt < 14, "cabeçalho: o título encolhe para não encostar no processo à direita");

  /* fundo: pdfDesenhado */
  const iD = bg.indexOf("function pdfDesenhado"), fD = bg.indexOf("/* Mesma fabricação", iD);
  if (iD > 0) {
    const iW = bg.indexOf("const _W_HELV = "), fim = bg.indexOf("function latin1Bytes"), fimL = bg.indexOf("\n}\n", fim) + 3;
    const ini = bg.indexOf("function paginasExtras"), fimPE = bg.indexOf("/* Relatório do SNIPER DESENHADO", ini);
    const c3 = { console: ctx.console, CratosGrafoSniper: G };
    vm.createContext(c3);
    vm.runInContext(bg.slice(iW, fimL) + "\n" + bg.slice(ini, fimPE) + "\n" + bg.slice(iD, fD) + "\nthis.__d = pdfDesenhado;", c3);
    const pdf = c3.__d({ relatorioSniper: blocos, relatorioSniperMeta: meta, grafoSniper: m });
    checar(!!pdf && c3.__d({ relatorioSniper: "lixo" }) === null && c3.__d({}) === null,
      "fundo: com blocos sai o desenhado; sem blocos (ou lixo) → null e vai o texto corrido");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cratos-rel-"));
    const arq = path.join(tmp, "r.pdf");
    fs.writeFileSync(arq, Buffer.from(pdf || []));
    let ok = false, t = "";
    try { execFileSync("qpdf", ["--check", arq], { stdio: "pipe" }); ok = true; } catch (e) { ok = false; }
    try { t = execFileSync("pdftotext", ["-layout", arq, "-"], { encoding: "utf8" }); } catch (e) { t = ""; }
    checar(ok && /Resumo das fontes/.test(t) && /erro da fonte/.test(t) && new RegExp(`página ${n} de ${n}`).test(t) && /Grafo de vínculos — 2 de 2/.test(t),
      "PDF desenhado íntegro (qpdf) e legível: relatório, grafo e rodapé paginado");
    if (process.env.CRATOS_REL_PDF) fs.copyFileSync(arq, process.env.CRATOS_REL_PDF);
    fs.rmSync(tmp, { recursive: true, force: true });
  } else checar(false, "fundo: pdfDesenhado não existe");
}

console.log(`\n=== ${NOME} ===`);
for (const d of oks) console.log("  ok     " + d);
for (const d of falhas) console.log("  FALHA  " + d);
console.log(`\n${oks.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
