/*
 * fixture-ccs.js — telas FICTÍCIAS do CCS (Bacen) para as suítes teste-ccs-*.js.
 *
 * A ESTRUTURA segue o mapa do recon de 15/10 (nomes de campo, formulários, botões,
 * códigos [CCSFWxxxx], o sufixo CPF/CNPJ + ISPB + ddmmaaaa). Os DADOS são inventados:
 * CPF 123.456.789-09, CNPJ 11.222.333/0001-81, "FULANO FICTICIO" e as instituições
 * não existem. Nenhum dado real de caso entra em fixture do CRATOS (regra de 16/09).
 *
 * Não é suíte (não começa com "teste-"): a bateria não o roda sozinho.
 */
const CPF = "12345678909";
const CNPJ = "11222333000181";
const TERCEIRO_CPF = "98765432100";
const TERCEIRO_NOME = "CICLANO TERCEIRO VINCULADO";
const PROC = "00000031420245180008";
const PROC_FMT = "0000003-14.2024.5.18.0008";
const OUTRO_PROC_FMT = "0099999-99.2023.5.18.0001";
const REQ = "4242";

const ISPB = { quixabeira: "00000001", tenorio: "00000002", oculto: "00000003", cnpjBanco: "00000004" };
const suf = (doc, ispb, ddmmaaaa) => doc + ispb + ddmmaaaa;
const SUF = {
  ativo: suf(CPF, ISPB.quixabeira, "01012020"),
  comFim: suf(CPF, ISPB.tenorio, "15032021"),
  ocultoComFim: suf(CPF, ISPB.oculto, "05052018"),
  cnpjAtivo: suf(CNPJ, ISPB.cnpjBanco, "20022022"),
};

const cod = (c) => `<div style="text-align:right;font-size:9px">[CCSFW${c}]</div>`;
const pagina = (titulo, corpo, c) =>
  `<!doctype html><html><head><title>CCS - ${titulo}</title></head><body>
   <div id="oCMenu_item11">Consultas de cliente</div>${corpo}${cod(c)}</body></html>`;

const TELA_1201 = pagina("Inicial", `<h3>Bem-vindo ao CCS</h3>`, "1201");

const TELA_0501 = pagina("Requisitar consulta", `
  <form name="requisitarConsultaCpfCnpjForm" method="post"
        action="/ccs/validarParametrosRequisicaoCpfCnpj.do?method=validarParametrosRequisicao">
    <input type="hidden" name="org.apache.struts.taglib.html.TOKEN" value="tok0501">
    <table>
      <tr><td>* CPF/CNPJ</td><td><textarea name="cpfCnpj" rows="4"></textarea></td></tr>
      <tr><td>* Número do Processo</td><td><input type="text" name="numeroProcesso" maxlength="25"></td></tr>
      <tr><td>Período de Solicitação</td><td><input name="dataInicio"> a <input name="dataFim"></td></tr>
      <tr><td>Motivo da Consulta</td><td><textarea name="motivoConsulta"></textarea></td></tr>
    </table>
    <input type="submit" value="Continuar">
  </form>`, "0501");

const TELA_0501_ERRO = TELA_0501.replace("<form", `<div class="mensagemErro">CPF/CNPJ 123.456.789-09 inválido.</div><form`);

const TELA_0502 = (proc) => pagina("Confirmação", `
  <form name="confirmarConsultaCpfCnpjForm" method="post" action="/ccs/confirmarConsultaCpfCnpj.do?method=requisitar">
    <input type="hidden" name="org.apache.struts.taglib.html.TOKEN" value="tok0502">
    <table><tr><td>Número do Processo:</td><td>${proc || PROC_FMT}</td></tr>
      <tr><td>CPF/CNPJ:</td><td>123.456.789-09</td></tr></table>
    <div>TERMO DE USO E RESPONSABILIDADE — texto do termo…</div>
    <input type="checkbox" name="assinaturaTermoResponsabilidade" value="S"> Li e aceito
    <input type="submit" value="Requisitar Consulta">
  </form>`, "0502");

const RADIOS = `
  <input type="radio" id="rM" name="rdbMostrarEsconderVinculos" value="M" onclick="exibirEsconder()">
  <label for="rM">Mostrar todos os vínculos</label>
  <input type="radio" id="rE" name="rdbMostrarEsconderVinculos" value="E" checked onclick="exibirEsconder()">
  <label for="rE">Esconder vínculos inativos</label>`;

const PESSOAS_VINCULO = `
  <h4>Pessoas com as quais o CPF/CNPJ selecionado possui vínculos</h4>
  <table><tr><th>CPF/CNPJ</th><th>Nome</th></tr>
    <tr><td>987.654.321-00</td><td>${TERCEIRO_NOME}</td></tr></table>`;

const TELA_0801_REQUISICAO = (opts) => {
  const o = opts || {};
  const linhas = o.semLinhas ? "" : `
      <tr><td>BANCO QUIXABEIRA S.A.</td><td>01/01/2020</td><td></td><td></td><td></td><td></td></tr>
      <tr><td>BANCO TENORIO S.A.</td><td>15/03/2021</td><td>02/02/2022</td><td></td><td></td><td></td></tr>`;
  return pagina("Resultado", `
  <table>
    <tr><td>Tribunal:</td><td>TRT 18ª Região</td></tr>
    <tr><td>Número Requisição:</td><td>${REQ}</td></tr>
    <tr><td>Número Processo:</td><td>${o.proc || PROC_FMT}</td></tr>
  </table>
  ${RADIOS}
  <h4>Relacionamentos</h4>
  <table id="rel">
    <tr><th rowspan="2">Detentora</th><th rowspan="2">Data Início</th><th rowspan="2">Data Fim</th><th colspan="3">Detalhamento</th></tr>
    <tr><th>Usuário</th><th>Data/Hora Solicitação</th><th>Data/Hora Resposta</th></tr>
    ${linhas}
  </table>
  ${PESSOAS_VINCULO}
  <a href="javascript:imprimir('imprimirRequisicaoCpfCnpj.do?method=imprimir','imprimir')">imprimir</a>
  <form name="x" method="post" action="/ccs/solicitarDetalhamentoVisualizacao.do?method=solicitarDetalhamento">
    <input type="button" value="Gerar Arquivo PDF com Detalhamentos"
      onclick="location='visualizarRequisicaoPdfTxt.do?method=visualizarSolicitacaoPdf&numeroRequisicao=${REQ}'">
    ${o.semBotao ? "" : `<input type="submit" value="Solicitar Detalhamentos dos CPF/CNPJ Consultados">`}
  </form>`, "0801");
};

/* 0601: quatro relacionamentos detalháveis (um ESCONDIDO com data fim) + um NÃO
   detalhável (sem sufixo, disabled). `preMarcado` simula a página que já vem marcada. */
const linha0601 = (sufixo, inst, ini, fim, extra) => `
  <tr ${extra && extra.oculta ? 'style="display:none" class="inativo"' : ""}>
    <td><input type="checkbox" name="chbRelSelecionado${sufixo}" value="S"${extra && extra.marcado ? " checked" : ""}></td>
    <td>${inst}</td><td>${ini}</td><td>${fim || ""}</td>
    <td><input type="text" name="edtDataInicioDetalhe${sufixo}" value="${ini}" onblur="formataData(this)">
        <input type="text" name="edtDataFimDetalhe${sufixo}" value="15/10/2026" onblur="formataData(this)"></td>
  </tr>`;

const TELA_0601 = (opts) => {
  const o = opts || {};
  const rows = o.soNaoDetalhavel ? "" : [
    linha0601(SUF.ativo, "BANCO QUIXABEIRA S.A.", "01/01/2020", null),
    linha0601(SUF.comFim, "BANCO TENORIO S.A.", "15/03/2021", "02/02/2022", { marcado: !!o.preMarcado }),
    linha0601(SUF.ocultoComFim, "BANCO ESCONDIDO S.A.", "05/05/2018", "01/01/2019", { oculta: true }),
    o.comCnpj ? linha0601(SUF.cnpjAtivo, "BANCO DA EMPRESA S.A.", "20/02/2022", null) : "",
  ].join("");
  return pagina("Detalhamento", `
  <form name="solicitarDetalhamentoCpfCnpjForm" method="post"
        action="/ccs/solicitarDetalhamentoCpfCnpj.do?method=solicitarDetalhamento">
    <input type="hidden" name="org.apache.struts.taglib.html.TOKEN" value="tok0601">
    <input type="hidden" name="numRequisicao" value="${REQ}">
    ${RADIOS}
    <table>
      <tr><th>Detalhar</th><th>Detentora</th><th>Data Início</th><th>Data Fim</th><th>Período</th></tr>
      ${rows}
      <tr><td><input type="checkbox" name="chbRelSelecionado" disabled></td>
          <td>COOPERATIVA SEM COMUNICACAO</td><td>10/10/2019</td><td></td>
          <td><input type="text" name="edtDataInicioDetalhe" disabled></td></tr>
      ${o.cnpjNaoDetalhavel ? "" : ""}
    </table>
    <input type="button" value="Selecionar Todos" onclick="selecionarTodos()">
    <input type="button" value="Limpar Todos" onclick="limparTodos()">
    <input type="submit" value="Solicitar Detalhamentos">
    <input type="button" value="Voltar"
      onclick="location='visualizarRequisicaoCpfCnpj.do?method=visualizarRequisicaoCliente&numeroRequisicao=${REQ}'">
  </form>`, "0601");
};

const TELA_0602 = (opts) => {
  const o = opts || {};
  return pagina("Envio", `
  <table><tr><th colspan="2">Requisição</th></tr>
    <tr><td>Número Requisição:</td><td>${REQ}</td></tr>
    <tr><td>Número Processo:</td><td>${o.proc || PROC_FMT}</td></tr>
    <tr><td>Total de Solicitações de Detalhamento enviadas:</td><td>${o.total != null ? o.total : 2}</td></tr>
    <tr><td>Data/Hora:</td><td>15/10/2026 10:30:00</td></tr>
  </table>
  <p>Os detalhamentos foram solicitados às instituições.</p>
  <p>O sistema está aguardando a resposta das instituições.</p>
  <input type="button" value="Voltar para a página de requisição">`, "0602");
};

const TELA_1301 = pagina("Consultar requisições", `
  <form name="consultarRequisicoesForm" method="post" action="/ccs/exibirRequisicoesRealizadas.do?method=consultarRequisicoes">
    <input name="dataInicio"> <input name="dataFim"> <input name="numeroRequisicao">
    <input name="numeroProcesso" maxlength="25"> <input name="cpfCnpj">
    <input type="submit" value="Consultar"> <input type="button" value="Limpar">
  </form>`, "1301");

const linha1302 = (req, proc) => `<tr><td><a href="visualizarRequisicaoRealizadaCpfCnpj.do?method=visualizarRequisicaoRealizada&numeroRequisicao=${req}">${req}</a></td>
  <td>${proc}</td><td>15/10/2026</td></tr>`;
const TELA_1302 = (linhas) => pagina("Requisições realizadas", `
  <table><tr><th>Requisição</th><th>Processo</th><th>Data</th></tr>${linhas || ""}</table>`, "1302");

/* 0801 da COLETA — no DESENHO REAL (prints de 19/10): tabela "CPF/CNPJ Consultados"
   (o selecionado em negrito, SEM link; os demais são links visualizarRequisicaoCliente),
   quadro "Requisição" do selecionado (com "CPF/CNPJ:"), rádios, e "Relacionamentos" do
   selecionado — com 7 colunas e DENTRO de tabelas de layout aninhadas (foi o que
   derrubou a 1.6.2). Status na última coluna: "Pendente", "Não solicitado" ou data/hora.
   opts.selecionado: CPF|CNPJ (padrão CPF); opts.docs: [CPF] ou [CPF, CNPJ];
   opts.linhas: { [doc]: [[inst, ini, fim, usuario, solicitacao, resposta], ...] }. */
const LINHAS_PADRAO = (o) => ({
  [CPF]: [
    ["BANCO QUIXABEIRA S.A.", "01/01/2020", "", "USUARIO.TESTE", "15/10/2026 10:30",
      o.nenhumaRespondeu ? "Pendente" : "15/10/2026 18:00"],
    ["BANCO TENORIO S.A.", "15/03/2021", "02/02/2022", "USUARIO.TESTE", "15/10/2026 10:30",
      o.todasResponderam ? "16/10/2026 08:00" : "Pendente"],
    ["COOPERATIVA SEM COMUNICACAO", "10/10/2019", "", "", "", "Não solicitado"],
  ],
  [CNPJ]: [
    ["BANCO DA EMPRESA S.A.", "20/02/2022", "", "USUARIO.TESTE", "15/10/2026 10:30", "Pendente"],
  ],
});
const TELA_0801_COLETA = (opts) => {
  const o = opts || {};
  const req = o.req || REQ;
  const docs = o.docs || [CPF];
  const sel = o.selecionado || docs[0];
  const linhas = Object.assign(LINHAS_PADRAO(o), o.linhas || {});
  const fmt = (d) => d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")
    : d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  const consultados = docs.map((d) => `<tr class="fundoPadraoAClaro3">
      <td align="left">${d === sel ? `<b>${fmt(d)}</b>` :
        `<a href="visualizarRequisicaoCpfCnpj.do?method=visualizarRequisicaoCliente&numeroRequisicao=${req}&cpfCnpj=${d}"><b>${fmt(d)}</b></a>`}</td>
      <td align="center">${d.length === 11 ? "CPF" : "CNPJ"}</td><td align="left">NOME FICTICIO ${d.slice(-2)}</td>
      <td align="center"></td><td align="center"></td><td align="left"></td></tr>`).join("");
  const rel = (linhas[sel] || []).map((l) => `<tr class="fundoPadraoAClaro2">${l.map((c, i) =>
      `<td align="${i < 2 ? "left" : "center"}">${c}</td>`).join("")}</tr>`).join("");
  return pagina("Resultado de requisitar consulta por CPF/CNPJ", `
  <table width="100%"><tr><td>
    <b>Tribunal:</b> TRIBUNAL REGIONAL DO TRABALHO DA 18 REGIAO
    <input type="button" value="Gerar Arquivo TXT com Detalhamentos">
    <input type="button" value="Gerar Arquivo PDF com Detalhamentos"
      onclick="location='visualizarRequisicaoPdfTxt.do?method=visualizarSolicitacaoPdf&numeroRequisicao=${req}'">
    <input type="button" value="Gerar Arquivo SIMBA com Detalhamentos">
    <a href="#">Versão para impressão.</a>
    <form name="f"><table class="textoPequeno">
      <tr><td colspan="6">CPF/CNPJ Consultados</td></tr>
      <tr><th>CPF/CNPJ</th><th>Tipo</th><th>Nome (SRF)</th><th colspan="2">Período Solicitado</th><th>Visualização on-line</th></tr>
      ${consultados}
    </table><input type="hidden" name="numRequisicao" value="${req}"></form>
    <div>Informações gerais para o CPF/CNPJ selecionado</div>
    <table><tr><td colspan="2">Requisição</td></tr>
      <tr><td>Nome (SRF):</td><td>NOME FICTICIO ${sel.slice(-2)}</td></tr>
      <tr><td>CPF/CNPJ:</td><td>${fmt(sel)}</td></tr>
      <tr><td>Número Requisição:</td><td>${req}</td></tr>
      <tr><td>Número Processo:</td><td>${o.proc || PROC_FMT}</td></tr>
      <tr><td>Usuário Autorização:</td><td>USUARIO.TESTE</td></tr>
      <tr><td>Data/Hora Autorização:</td><td>15/10/2026 10:30</td></tr>
    </table>
    ${RADIOS}
  </td></tr>
  <tr><td><div class="faixaTitulo">Relacionamentos</div></td></tr>
  <tr><td><table class="layout"><tr><td>
    <table>
      <tr><th rowspan="2">Detentora do relacionamento</th><th rowspan="2">Responsável pelas informações</th>
          <th rowspan="2">Data Início</th><th rowspan="2">Data Fim</th><th colspan="3">Detalhamento</th></tr>
      <tr><th>Usuário</th><th>Data/Hora Solicitação</th><th>Data/Hora Resposta</th></tr>
      ${rel}
    </table>
  </td></tr></table></td></tr></table>
  ${PESSOAS_VINCULO}`, "0801");
};

const TELA_0802 = (arquivos) => pagina("Arquivos", `
  <table><tr><th>Nome do arquivo</th><th>Data da geração</th></tr>
  ${(arquivos || []).map((a) => `<tr><td><a href="baixarArquivo.do?method=baixarArquivo&nomeArquivo=${a.nome}">${a.nome}</a></td><td>${a.data}</td></tr>`).join("")}
  </table>`, "0802");

const PDF_BYTES = Buffer.from("%PDF-1.4\n% detalhamento fictício\n%%EOF\n", "latin1");
const XML_BYTES = Buffer.from("<?xml version='1.0'?><erro>sessão</erro>", "latin1");

module.exports = {
  CPF, CNPJ, TERCEIRO_CPF, TERCEIRO_NOME, PROC, PROC_FMT, OUTRO_PROC_FMT, REQ, SUF,
  TELA_1201, TELA_0501, TELA_0501_ERRO, TELA_0502, TELA_0801_REQUISICAO, TELA_0601, TELA_0602,
  TELA_1301, TELA_1302, linha1302, TELA_0801_COLETA, TELA_0802, PDF_BYTES, XML_BYTES,
};
