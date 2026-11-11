/*
 * fixture-sniper.js — tela e respostas FICTÍCIAS do SNIPER para teste-sniper.js.
 *
 * A ESTRUTURA segue a gravação do recon de 21/10 (formcontrolname="proc", os 8
 * checkboxes com o tipo do bem no fim do rótulo, o botão "Iniciar investigação", as
 * rotas e as chaves de /v2/…). Os DADOS são inventados: nenhum nome, documento,
 * processo ou bem real. Não é suíte (não começa com "teste-").
 */
const PROC = "00000031420245180008";
const PROC_FMT = "0000003-14.2024.5.18.0008";
const OUTRO_PROC = "00999992220235180001";
const ID = "4242";
const CNPJ = "11222333000181";
const CPF = "12345678909";
const NOME_PJ = "EMPRESA FICTICIA LTDA";
const NOME_PF = "FULANO FICTICIO DA SILVA";

const FONTES_TELA = [
  ["sisbajud", "Sisbajud (contas)"], ["renajud", "Renajud (veículos)"], ["serp", "SERP/ONR (imóveis)"],
  ["anacjud", "AnacJud (aeronaves)"], ["embarcacao", "Tribunal Marítimo (embarcações)"],
  ["bem-declarado", "TSE (bens declarados)"], ["sngb", "SNGB (bens apreendidos)"], ["sancao", "CGU (sanções diversas)"],
];

function telaInicial(o) {
  const op = o || {};
  const caixas = FONTES_TELA.map(([, rot], i) => `
      <mat-checkbox class="mat-mdc-checkbox"><div class="mdc-form-field">
        <input type="checkbox" id="mat-mdc-checkbox-${i + 1}-input" checked>
        <label for="mat-mdc-checkbox-${i + 1}-input">${rot}</label></div></mat-checkbox>`).join("");
  return `<!doctype html><html><head><title>SNIPER</title></head><body>
    <app-root><mat-card><form>
      <h2>Busca e restrição de bens</h2>
      <mat-form-field><label for="mat-input-1">Nº do processo*</label>
        <input id="mat-input-1" formcontrolname="proc" type="text"></mat-form-field>
      <mat-select id="mat-select-1"><span>Pessoa(s)</span></mat-select>
      <mat-checkbox><input type="checkbox" id="mat-mdc-checkbox-0-input" checked>
        <label for="mat-mdc-checkbox-0-input">Selecionar todos</label></mat-checkbox>
      ${caixas}
      <section><div><button type="submit" disabled><mat-icon>search</mat-icon> Iniciar investigação</button></div></section>
      ${op.botaoPerigoso ? '<button type="button" id="perigo"><mat-icon>lock</mat-icon> Bloquear todos os bens</button>' : ""}
    </form></mat-card></app-root></body></html>`;
}

const PARTES = [
  { nome: NOME_PJ, documento: CNPJ, tipo: "pessoa_juridica", selecionada: true },
  { nome: NOME_PF, documento: CPF, tipo: "pessoa_fisica", selecionada: true },
];

function respostaFonte(slug, modo) {
  const campos = {
    sisbajud: [
      { name: "nome_proprietario", title: "Nome proprietário", show_in_table: true },
      { name: "documento", title: "Documento", show_in_table: true },
      { name: "contas_ativas", title: "Contas ativas", show_in_table: true },
      { name: "id_parte", title: "ID parte", show_in_table: true },
      { name: "id_para_bloqueio", title: "ID para bloquear esse registro", show_in_table: true },
    ],
  }[slug] || [{ name: "nome_proprietario", title: "Nome proprietário(a)", show_in_table: true }, { name: "descricao", title: "Descrição", show_in_table: true }];
  const base = { fields: campos, result: [] };
  if (modo === "com") {
    base.result = [{ nome_proprietario: NOME_PJ, documento: "11.222.333/0001-81", contas_ativas: ["BANCO FICTICIO UM", "BANCO FICTICIO DOIS"],
      id_parte: 77, uuid: null, tipo_do_bem: "conta-bancaria", id_para_bloqueio: "99887766554433" }];
  }
  if (modo === "andamento") base.extra_data = { on_going: true, status_msg: "Pesquisa em andamento nos cartórios" };
  if (modo === "erro") base.extra = { error_msg: "Erro ao buscar dados" };
  return base;
}

/* modo padrão de cada fonte no "caso feliz" */
const MODOS = { sisbajud: "com", renajud: "vazio", serp: "andamento", anacjud: "vazio", embarcacao: "vazio",
  "bem-declarado": "vazio", sngb: "erro", sancao: "vazio" };

/* /v2/investigacao/{idParte}/info/ — cadastro da Receita (chaves como na gravação de 21/10) */
const ID_PARTE_PJ = "4400001";
const ID_PARTE_PF = "4400002";
const INFO = {
  [ID_PARTE_PJ]: {
    "CNPJ": "11.222.333/0001-81", "Razão social": NOME_PJ, "Nome fantasia": "FICTICIA COMERCIO",
    "Data de cadastro": "01/02/2015", "Natureza jurídica": "Sociedade Empresária Limitada",
    "CPF do(a) responsável": "987.654.321-00", "Qualificação do responsável": "Sócio-Administrador",
    "Capital social": "R$ 50.000,00", "Porte": "Empresa de pequeno porte", "Opção pelo Simples": "Sim",
    "Endereço": "RUA FICTICIA, 100, CENTRO, GOIANIA/GO", "Telefone(s)": "62 30000000",
    "E-mail": "CONTATO@FICTICIA.EXEMPLO", "Situação cadastral (01/03/2015)": "Ativa",
    "Atividades econômicas": ["4711-3/02 Comércio varejista", "4729-6/99 Outros"], "extra": {},
  },
  [ID_PARTE_PF]: {
    "CPF": "123.456.789-09", "Nome": NOME_PF, "Data de nascimento": "01/01/1980", "Nome da mãe": "MAE FICTICIA DA SILVA",
    "Endereço": "AV FICTICIA, 200, GOIANIA/GO", "Situação cadastral (01/07/2022)": "Regular", "extra": {},
  },
};

/* /v2/investigacao/{idParte}/processos/ — aba "Processos" do "Mais detalhes" (1.7.3).
   PJ: lista inteira de uma vez (paginação só da tela, o caso mais provável): 12 ações.
   PF: formato alternativo, paginado NO SERVIDOR (10 + 2), com outros nomes de campo —
   para a leitura tolerante e o avanço de página. Tudo inventado. */
const CLASSE_ARVORE = ["PROCESSO CÍVEL E DO TRABALHO", "Processo de Conhecimento", "Procedimento de Conhecimento",
  "Procedimentos Trabalhistas", "Ação Trabalhista - Rito Ordinário"];
const PROCESSOS_PJ = Array.from({ length: 12 }, (_, i) => ({
  numero: `00000${String(10 + i).padStart(2, "0")}-11.2025.5.18.0001`,
  classe: i === 0 ? ["PROCESSO CÍVEL E DO TRABALHO", "Processo de Execução", "Execução Fiscal"] : CLASSE_ARVORE,
  tribunal: i % 2 ? "TJGO" : "TRT18",
  assunto: i % 2 ? "Indenização do Prejuízo" : "Verbas Rescisórias",
  ultimo_movimento: i === 1 ? "Incluído em pauta para #{data_hora} #{local}." : "Expedição de #{tipo_de_documento}.",
}));
const PROCESSOS_PF_TODOS = Array.from({ length: 12 }, (_, i) => ({
  numeroProcesso: `000${String(100 + i)}0122026818${String(i % 10)}051`.slice(0, 20).padEnd(20, "0"),
  classe: { nome: "PROCESSO CÍVEL E DO TRABALHO", filho: { nome: "Recursos", filho: { nome: "Agravo de Instrumento" } } },
  siglaTribunal: "TJGO",
  assuntos: [{ nome: "Dissolução" }],
  ultimoMovimento: { data: "2026-09-15T10:00:00", nome: "Confirmada a intimação eletrônica" },
}));
const PROCESSOS_PF_PAG = [
  { count: 12, next: "https://sniper-api.pdpj.jus.br/v2/investigacao/4400002/processos/?page=2", results: PROCESSOS_PF_TODOS.slice(0, 10) },
  { count: 12, next: null, results: PROCESSOS_PF_TODOS.slice(10) },
];

/* tudo o que aparece no fixture e é "dado" — para conferir o que NÃO pode sair do relatório */
const ID_BLOQUEIO = "99887766554433";

/* ── GRAFO DE VÍNCULOS (1.9.3) — 100% fictício, no FORMATO das respostas da API
   (/v2/investigacao/{id}/partes/, /v2/grafo/node/{uuid}, …/relationships).
   Grafo 1: 3 partes (P1 empresa, P2 e P3 pessoas) + 2 terceiros (T1 sócia de P1, com uma
            relação fora do desenho; C1 candidatura de P2).
   Grafo 2: 1 parte (P4 empresa) + 4 terceiros (T2 holding sócia, T3 administrador, T5
            empresa de que P4 é sócia — com uma entrada fora do desenho —, T6 sócio).
   P5: parte sem nenhuma ligação. */
const GN = (id, group, label, properties) => ({ id, group, extra: {}, properties, label });
const GE = (from, to, label, data, n) => ({ name: "is_partner", from, to, id: `is_partner|${from}|${n || "01"}`, label,
  properties: Object.assign({ "Qualificação": label }, data ? { "Data de entrada na sociedade": data } : {}, { "Tipo de sócio": "fictício" }) });
const GRAFO_NOS = {
  p1: GN("g-p1", "company", NOME_PJ, { "Razão social": NOME_PJ, "CNPJ": CNPJ, "Situação cadastral": "ATIVA" }),
  p2: GN("g-p2", "person", NOME_PF, { "Nome": NOME_PF, "CPF": CPF }),
  p3: GN("g-p3", "person", "BELTRANA FICTICIA SOUZA", { "Nome": "BELTRANA FICTICIA SOUZA", "CPF": "11122233396" }),
  p4: GN("g-p4", "company", "COMERCIO FICTICIO S.A.", { "Razão social": "COMERCIO FICTICIO S.A.", "CNPJ": "99888777000166" }),
  p5: GN("g-p5", "person", "CICRANO ISOLADO FICTICIO", { "Nome": "CICRANO ISOLADO FICTICIO", "CPF": "55566677788" }),
  t1: GN("g-t1", "person", "SICRANA TERCEIRA FICTICIA", { "Nome": "SICRANA TERCEIRA FICTICIA", "CPF": "44455566677", "Município": "CIDADE FICTICIA" }),
  c1: GN("g-c1", "candidacy", "CANDIDATURA FICTICIA 2024", { "Cargo": "VEREADOR", "Ano": "2024", "Situação": "NÃO ELEITO" }),
  t2: GN("g-t2", "company", "HOLDING FICTICIA (PARTICIPACOES) LTDA", { "Razão social": "HOLDING FICTICIA (PARTICIPACOES) LTDA", "CNPJ": "12312312000112",
    "Endereço": "RUA DAS FICCOES, 100, SALA 2 — BAIRRO INVENTADO — CIDADE FICTICIA/GO", "Capital social": "R$ 100.000,00" }),
  t3: GN("g-t3", "person", "ADMINISTRADOR FICTICIO NETO", { "Nome": "ADMINISTRADOR FICTICIO NETO", "CPF": "32132132100" }),
  t5: GN("g-t5", "company", "ESSENCIA FICTICIA DO COURO LTDA", { "Razão social": "ESSENCIA FICTICIA DO COURO LTDA", "CNPJ": "45645645000145", "Situação cadastral": "BAIXADA" }),
  t6: GN("g-t6", "person", "SOCIO FICTICIO JUNIOR", { "Nome": "SOCIO FICTICIO JUNIOR", "CPF": "65465465400" }),
  fora: GN("g-fora", "company", "EMPRESA FORA DO DESENHO LTDA", { "Razão social": "EMPRESA FORA DO DESENHO LTDA" }),
};
const N = GRAFO_NOS;
const GRAFO_ARESTAS = {
  p2p1: GE("g-p2", "g-p1", "Sócio-Administrador", "10/03/2012"),
  p3p1: GE("g-p3", "g-p1", "Sócio", "10/03/2012"),
  t1p1: GE("g-t1", "g-p1", "Sócio", "01/02/2015"),
  p2c1: { name: "is_candidate", from: "g-p2", to: "g-c1", id: "is_candidate|g-p2|01", label: "Candidato", properties: {} },
  t2p4: GE("g-t2", "g-p4", "Sócio", "05/06/2019"),
  t3p4: GE("g-t3", "g-p4", "Administrador", ""),
  p4t5: GE("g-p4", "g-t5", "Sócio", "20/11/2020"),
  t6p4: GE("g-t6", "g-p4", "Sócio", "05/06/2019", "02"),
  /* fora do desenho (só no /relationships): o "*" do SNIPER */
  t1fora: GE("g-t1", "g-fora", "Sócio", "07/07/2007", "09"),
  forat5: GE("g-fora", "g-t5", "Sócio", "08/08/2008", "08"),
};
const A = GRAFO_ARESTAS;
const comGrafo = (no, nos, arestas) => Object.assign({}, no, { graph: { nodes: nos, edges: arestas } });
const GRAFO = {
  PARTES: [
    { id: 701, selecionada: true, uuid: "g-p1" }, { id: 702, selecionada: true, uuid: "g-p2" },
    { id: 703, selecionada: true, uuid: "g-p3" }, { id: 704, selecionada: true, uuid: "g-p4" },
    { id: 705, selecionada: true, uuid: "g-p5" }, { id: 706, selecionada: false, uuid: "g-nao-selecionada" },
  ],
  NO: {
    "g-p1": comGrafo(N.p1, [N.p2, N.p3, N.t1], [A.p2p1, A.p3p1, A.t1p1]),
    "g-p2": comGrafo(N.p2, [N.p1, N.c1], [A.p2p1, A.p2c1]),
    "g-p3": comGrafo(N.p3, [N.p1], [A.p3p1]),
    "g-p4": comGrafo(N.p4, [N.t2, N.t3, N.t5, N.t6], [A.t2p4, A.t3p4, A.p4t5, A.t6p4]),
    "g-p5": comGrafo(N.p5, [], []),
  },
  REL: {
    "g-p1": {
      "g-p1": comGrafo(N.p1, [N.p2, N.p3, N.t1], [A.p2p1, A.p3p1, A.t1p1]),
      "g-t1": comGrafo(N.t1, [N.p1, N.fora], [A.t1p1, A.t1fora]),
      "g-fora": comGrafo(N.fora, [N.t1, N.t5], [A.t1fora, A.forat5]),
    },
    "g-p2": { "g-c1": comGrafo(N.c1, [N.p2], [A.p2c1]) },
    "g-p4": {
      "g-t2": comGrafo(N.t2, [N.p4], [A.t2p4]),
      "g-t3": comGrafo(N.t3, [N.p4], [A.t3p4]),
      "g-t5": comGrafo(N.t5, [N.p4, N.fora], [A.p4t5, A.forat5]),
    },
  },
};

module.exports = { GRAFO, PROCESSOS_PJ, PROCESSOS_PF_PAG, ID_PARTE_PJ, ID_PARTE_PF, INFO, PROC, PROC_FMT, OUTRO_PROC, ID, CNPJ, CPF, NOME_PJ, NOME_PF, FONTES_TELA, telaInicial, PARTES,
  respostaFonte, MODOS, ID_BLOQUEIO };
