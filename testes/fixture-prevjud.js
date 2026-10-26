/*
 * fixture-prevjud.js — tela e respostas FICTÍCIAS do PREVJUD (Dossiê Previdenciário) para
 * teste-prevjud.js. A ESTRUTURA segue as gravações do recon de 21/10 e o print da tela (ids dos campos,
 * linhas só com Visualizar e download, APLICAR do filtro refaz a lista,
 * rotas da API, chaves do dossiê, PDFs em pdfBase64). Os DADOS são inventados. Não é suíte.
 */
const PROC = "00000031420245180008";
const PROC_FMT = "0000003-14.2024.5.18.0008";
const CPF_A = "12345678909";
const CPF_B = "98765432100";
const NOME_A = "FULANO FICTICIO DA SILVA";
const NOME_B = "BELTRANA EXEMPLO PEREIRA";
const CNPJ = "11222333000181";
const NOME_PJ = "EMPRESA FICTICIA LTDA";

/* "PDF" mínimo, em base64 (como vem no pdfBase64) */
const PDF_B64 = Buffer.from("%PDF-1.4\n% ficticio\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n", "latin1").toString("base64");
const PROTO = { [CPF_A]: "1a2b3c4d-0000-4000-8000-00000000000a", [CPF_B]: "5e6f7a8b-0000-4000-8000-00000000000b" };
const PROTO_VELHO = "9f9f9f9f-0000-4000-8000-0000000000ff";   // pedido antigo do mesmo CPF A

function tela(o) {
  const op = o || {};
  return `<!doctype html><html><head><title>PREVJUD</title></head><body>
    <nav>
      <a href="https://previdenciario.pdpj.jus.br/dossie-medico" id="lk-medico">view_quilt Dossiê Médico</a>
      <a href="https://previdenciario.pdpj.jus.br/dossie-previdenciario">view_quilt Dossiê Previdenciário</a>
      <a href="https://previdenciario.pdpj.jus.br/penhora-judicial" id="lk-penhora">view_quilt Penhora Judicial</a>
    </nav>
    <mat-card><form>
      <mat-form-field><label for="solicitacaoCpf">CPF</label><input id="solicitacaoCpf" name="solicitacaoCpf" formcontrolname="solicitacaoCpf" type="text"></mat-form-field>
      <mat-form-field><label for="solicitacaoProcesso">Nº do Processo</label><input id="solicitacaoProcesso" name="solicitacaoProcesso" formcontrolname="solicitacaoProcesso" type="text"></mat-form-field>
    </form>
    <mat-card-actions><button type="submit">SOLICITAR</button></mat-card-actions></mat-card>
    <mat-card id="filtro"><input placeholder="Informe o período"><label><input type="radio" name="mostrar"> Solicitados</label>
      <label><input type="radio" name="mostrar"> Concluídos</label>
      <button type="button">LIMPAR</button><button type="submit">APLICAR</button></mat-card>
    <table class="mat-table"><thead><tr><th>CPF</th><th>Processo</th><th>Situação</th><th>Ações</th></tr></thead>
      <tbody id="pedidos">${op.semPedidoVelho ? "" : linhaPedido(CPF_A, PROTO_VELHO, "FINALIZADO")}</tbody></table>
    <div id="dialogo"><button type="button">Fechar</button></div>
  </body></html>`;
}
function linhaPedido(cpf, protocolo, status) {
  const f = cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  return `<tr data-proto="${protocolo}"><td>${f}</td><td>${PROC_FMT}</td><td class="st">${status}</td>
    <td><div><button type="submit" aria-label="Visualizar"><mat-icon>visibility</mat-icon></button>
    <button type="submit" aria-label="Baixar"><mat-icon>download</mat-icon></button></div></td></tr>`;
}

function dossie(protocolo, cpf, o) {
  const op = o || {};
  return {
    cabecalho: { protocolo, nomeCliente: "TRT18", tipoParametro: "CPF", parametro: cpf, tipoDossie: "PREVIDENCIARIO", status: "FINALIZADO" },
    processamentoTO: { consultasRealizadas: 6, tempoProcessamento: 1200, volumeRetorno: 3 },
    dossiePrevidenciario: {
      consultaFiliadoTO: { filiadoTO: { nome: "NOME FICTICIO", nomeMae: "MAE FICTICIA", etnia: "NAO INFORMADA", cpf }, mensagemTO: null },
      beneficios: { listaBeneficios: [], mensagemTO: { result: "OK", httpCode: 200, errorMessage: "" } },
      cartaConcessao: { listaRespostaConcalTO: [], mensagemTO: [{ result: "Não existe carta de concessão para o CPF 123.456.789-09", httpCode: 404, errorMessage: "" }] },
      extratoPrevidenciario: { listaVinculosTO: [{}], mensagemTO: null },
      historicoCreditos: { creditosTO: null, mensagemTO: op.historicoErroTecnico
        ? { result: "Erro interno", httpCode: 500, errorMessage: "timeout" }
        : { result: "Não há créditos para o período", httpCode: 404, errorMessage: "" } },
    },
    dossieMedico: null,
  };
}

module.exports = { PROC, PROC_FMT, CPF_A, CPF_B, NOME_A, NOME_B, CNPJ, NOME_PJ, PDF_B64, PROTO, PROTO_VELHO, tela, linhaPedido, dossie };
