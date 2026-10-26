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

module.exports = { PROCESSOS_PJ, PROCESSOS_PF_PAG, ID_PARTE_PJ, ID_PARTE_PF, INFO, PROC, PROC_FMT, OUTRO_PROC, ID, CNPJ, CPF, NOME_PJ, NOME_PF, FONTES_TELA, telaInicial, PARTES,
  respostaFonte, MODOS, ID_BLOQUEIO };
