/*
 * teste-cnib-detalhe.js — a leitura do modal "Detalhes da Ordem" do CNIB e o
 * plano B da certidão.
 *
 * O fixture é o HTML REAL, capturado no inspetor em 02/09/2026 (ordem
 * 202609.0214.04900000-IA-228). Não é um DOM que eu inventei para passar: é o
 * que o CNIB entrega. As três armadilhas exercitadas aqui existem nele:
 *   (a) "Organização de Origem" usa `lblOrganizacaoOrigemDescricao`, não
 *       `lblValorDescricao` — varrer pela classe do valor perde a vara;
 *   (b) no cartão do segredo de justiça o VALOR tem classe de RÓTULO;
 *   (c) "Status da Ordem" e "Status da Criação da Ordem" têm os MESMOS quatro
 *       rótulos — sem escopo por cartão, o segundo sobrescreve o primeiro.
 *
 * Mais: modal pela metade não vira certidão, o `%PDF-` é conferido por magic
 * bytes (uma página de erro de 40 KB com HTTP 200 NÃO passa), e a mensagem de
 * fabricação leva numProcesso/convenio/operacao — sem os três o documento nasce
 * invisível para o diário, que é exatamente o que o plano B existe para evitar.
 *
 * Rodar: node teste-cnib-detalhe.js
 * Versão antiga: CRATOS_SRC=<pasta do xpi descompactado> node teste-cnib-detalhe.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const ARQ = path.join(SRC, "conteudo", "cnib.js");

const falhas = [];
const oks = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }

/* ────────────────────────────────────────────────────────────────────────────
   FIXTURE — HTML real do modal, 02/09/2026.
   ──────────────────────────────────────────────────────────────────────────── */
const CARTAO_DADOS = `
<div class="ordem-card"><!--!--><div class="row"><div class="col"><label class="lblTitulo">Dados da Ordem</label></div></div>
  <div class="row"><div class="col-3"><div class="row"><div class="col"><label class="lblDescricao">Número do Processo</label></div></div>
      <div class="row"><div class="col"><label class="lblValorDescricao">0000001-23.2025.5.18.0008</label></div></div></div>
    <div class="col-3"><div class="row"><div class="col"><label class="lblDescricao">Nome do Processo</label></div></div>
      <div class="row"><div class="col"><label class="lblValorDescricao">Processo de execução judicial ou cumprimento de sentença</label></div></div></div>
    <div class="col-6"><div class="row"><div class="col"><label class="lblDescricao">Organização de Origem</label></div></div>
      <div class="row"><div class="col"><label class="lblOrganizacaoOrigemDescricao">Comitê Gestor do Sistema - Supremo Tribunal Federal - Tribunal Superior do Trabalho - Tribunal Regional do Trabalho da 18° Região - GOIANIA - 8ª VARA DO TRABALHO DE GOIANIA</label></div></div></div></div></div>`;

/* Os gêmeos. Repare que os rótulos são IDÊNTICOS e os valores, diferentes de
   propósito no teste (data e status), para que a confusão apareça. */
const CARTAO_STATUS = `
<div class="ordem-card"><div class="row"><div class="col "><label class="lblTitulo">Status da Ordem</label></div></div>
  <div class="row"><div class="col-2"><div class="row"><div class="col"><label class="lblDescricao">Status</label></div></div>
      <div class="row"><div class="col"><label class="lblValorDescricao">Concluído</label></div></div></div>
    <div class="col-3"><div class="row"><div class="col"><label class="lblDescricao">Aprovado por</label></div></div>
      <div class="row"><div class="col"><label data-toggle="tooltip" class="lblValorDescricao" data-original-title="Comitê Gestor / ...">FULANO DE TAL EXEMPLO:S000000  </label></div></div></div>
    <div class="col-2"><div class="row"><div class="col"><label class="lblDescricao">Data de Aprovação</label></div></div>
      <div class="row"><div class="col"><label class="lblValorDescricao">02/09/2026 14:33:15</label></div></div></div>
    <div class="col-3"><div class="row"><div class="col"><label class="lblDescricao">Protocolo</label></div></div>
      <div class="row"><div class="col"><label class="lblValorDescricao" style="cursor:pointer">202609.0214.04900000-IA-228</label></div></div></div></div></div>`;

const CARTAO_CRIACAO = `
<div class="ordem-card "><div class="row"><div class="col"><div class="ordem-card__header"><label class="lblTitulo mb-0">Status da Criação da Ordem</label></div></div></div>
  <div class="row mt-2"><div class="col-3"><div class="row"><div class="col"><label class="lblDescricao">Status</label></div></div>
      <div class="row"><div class="col"><label class="lblValorDescricao">CRIACAO-STATUS</label></div></div></div>
    <div class="col-3"><div class="row"><div class="col"><label class="lblDescricao">Aprovado por</label></div></div>
      <div class="row"><div class="col"><label class="lblValorDescricao">CRIACAO-APROVADOR</label></div></div></div>
    <div class="col-3"><div class="row"><div class="col"><label class="lblDescricao">Data de Aprovação</label></div></div>
      <div class="row"><div class="col"><label class="lblValorDescricao">01/09/2026 09:00:00</label></div></div></div>
    <div class="col-3"><div class="row"><div class="col"><label class="lblDescricao">Protocolo</label></div></div>
      <div class="row"><div class="col"><label class="lblValorDescricao">202609.0214.04900000-IA-228</label></div></div></div></div></div>`;

const CARTAO_SEGREDO = `
<div class="ordem-card"><div class="row"><div class="col "><label class="lblTitulo">Processo tramita sob segredo de justiça</label></div></div>
  <div class="ml-3"><div class="row"><div><label class="lblDescricao">Não</label></div></div></div></div>`;

function bloco(exec) {
  return `<div class="row"><div class="col-4"><label class="lblValorDescricao">${exec.doc}</label></div>
    <div class="col-4"><label class="lblValorDescricao">${exec.nome}</label></div>
    <div class="col-4"><label class="lblValorDescricao"><span>${exec.status} </span></label></div></div>`;
}

const CABECALHO_EXEC = `<hr>
<div class="row"><div class="col mb-2 "><label class="lblTitulo">Executado/Réu da Ordem</label></div></div>
<div class="row"><div class="col-4"><div class="row"><div class="col"><label class="lblDescricao">CPF ou CNPJ</label></div></div></div>
  <div class="col-4"><div class="row"><div class="col"><label class="lblDescricao">Nome ou Razão Social</label></div></div></div>
  <div class="col-4"><div class="row"><div class="col"><label class="lblDescricao">Status:</label></div></div></div></div>`;

const RODAPE = `<div class="order-detail-footer mt-5"><div class="d-flex">
  <button type="button" class="btn btn-out-line-orn mx-2" onclick="window.location='dashboard';">Dashboard</button></div>
  <button type="button" class="btn btn-primary" onclick="window.open('/relatorio/detalhe');">Imprimir</button></div>`;

const EXEC_UM = [{ doc: "55.666.777/0001-04", nome: "EMPRESA EXEMPLOECIALIDADES &amp; DISTRIBUIDORA DE ALIMENTOS SA EM RECUPERACAO JUDICIAL", status: "Parte Indisponibilizada" }];
const EXEC_DOIS = EXEC_UM.concat([{ doc: "123.456.789-09", nome: "FULANO DE TAL", status: "Parte Indisponibilizada" }]);

function modal(execs, opts) {
  const o = opts || {};
  return `<div class="order-detail-modal-body">
    ${o.semDados ? "" : CARTAO_DADOS}
    ${CARTAO_STATUS}
    ${CARTAO_CRIACAO}
    ${CARTAO_SEGREDO}
    ${CABECALHO_EXEC}
    ${(execs || []).map(bloco).join("\n")}
    ${RODAPE}</div>`;
}

/* ────────────────────────────────────────────────────────────────────────────
   AMBIENTE
   ──────────────────────────────────────────────────────────────────────────── */
const enviadas = [];
function montar(html) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`,
    { url: "https://indisponibilidade.onr.org.br/ordem/cadastro", runScripts: "outside-only" });
  const w = dom.window;
  const memoria = {};
  w.browser = {
    storage: { local: {
      get: async (k) => ({ [k]: memoria[k] }),
      set: async (o) => Object.assign(memoria, o),
      remove: async () => {},
    } },
    runtime: {
      sendMessage: async (m) => { enviadas.push(m); return { ok: true }; },
      onMessage: { addListener: () => {} },
      getURL: (p) => p,
      getManifest: () => ({ version: "teste" }),
    },
    downloads: { download: async () => 1 },
  };
  w.console.warn = () => {};
  w.console.log = () => {};
  w.eval(fs.readFileSync(path.join(SRC, "comum", "storage.js"), "utf8"));
  w.eval(fs.readFileSync(ARQ, "utf8"));
  return w;
}

/* Versão sem o leitor (qualquer coisa até a 1.0.7) não tem o gancho. Reprova
   ALTO e explicando, em vez de estourar um TypeError que parece bug do teste. */
{
  const w = montar(modal(EXEC_UM));
  if (!w.__cratosCnib) {
    console.log("\n=== teste-cnib-detalhe.js ===");
    console.log("  FALHA  a versão em " + SRC + " não tem o leitor do modal " +
      "(window.__cratosCnib). Nesta versão o CNIB depende só do fetch do PDF: se " +
      "ele falhar, a execução termina SEM documento — que é o bug que esta suíte " +
      "existe para travar.");
    console.log("\n0 passaram — a suíte inteira reprova nesta versão.\n");
    process.exit(1);
  }
}

/* ────────────────────────────────────────────────────────────────────────────
   1. AS TRÊS ARMADILHAS
   ──────────────────────────────────────────────────────────────────────────── */
{
  const w = montar(modal(EXEC_UM));
  const api = w.__cratosCnib;
  checar(!!api, "o gancho de teste __cratosCnib existe (senão nada abaixo mede o código real)");

  const d = api.lerDetalhesOrdem(w.document);
  checar(!!d, "lê o modal completo");

  // (a) Organização de Origem — classe de valor DIFERENTE das outras
  checar(/8ª VARA DO TRABALHO DE GOIANIA/.test(d.organizacao),
    "ARMADILHA 1: pega a Organização de Origem, que NÃO usa lblValorDescricao");
  checar(d.organizacao !== "", "ARMADILHA 1: a vara não vem vazia");

  // (b) segredo de justiça — o valor tem classe de rótulo
  checar(d.segredo === "Não",
    "ARMADILHA 2: no cartão do segredo, o valor tem classe de RÓTULO e mesmo assim é lido");
  checar(d.segredo !== "Processo tramita sob segredo de justiça",
    "ARMADILHA 2: não confunde o título do cartão com o valor");

  // (c) gêmeos — Status da Ordem vs Status da Criação da Ordem
  checar(d.status === "Concluído",
    "ARMADILHA 3: o Status vem do cartão 'Status da Ordem'");
  checar(d.statusCriacao === "CRIACAO-STATUS",
    "ARMADILHA 3: o Status da Criação vem do SEU cartão");
  checar(d.status !== d.statusCriacao,
    "ARMADILHA 3: um cartão não sobrescreve o outro");
  checar(d.dataAprovacao === "02/09/2026 14:33:15",
    "ARMADILHA 3: a Data de Aprovação é a do cartão certo");
  checar(d.aprovadoPor.indexOf("FULANO") === 0,
    "ARMADILHA 3: 'Aprovado por' é o do cartão certo, e vem sem o espaço duplo do fim");

  // campos simples
  checar(d.protocolo === "202609.0214.04900000-IA-228", "lê o protocolo");
  checar(d.numProcesso === "0000001-23.2025.5.18.0008", "lê o número do processo");
  checar(/cumprimento de sentença/.test(d.nomeProcesso), "lê o nome do processo");
}

/* ────────────────────────────────────────────────────────────────────────────
   2. EXECUTADOS — um, dois, e o cabeçalho que não é dado
   ──────────────────────────────────────────────────────────────────────────── */
{
  const w = montar(modal(EXEC_UM));
  const d = w.__cratosCnib.lerDetalhesOrdem(w.document);
  checar(d.executados.length === 1, "um executado: lê exatamente um");
  checar(d.executados[0].documento === "55.666.777/0001-04", "executado: documento");
  checar(/EMPRESA EXEMPLOECIALIDADES/.test(d.executados[0].nome), "executado: razão social");
  checar(d.executados[0].status === "Parte Indisponibilizada",
    "executado: status, que vem embrulhado num <span>");
  checar(!d.executados.some((e) => /CPF ou CNPJ/.test(e.documento)),
    "a LINHA DE CABEÇALHO não entra como executado");
}
{
  const w = montar(modal(EXEC_DOIS));
  const d = w.__cratosCnib.lerDetalhesOrdem(w.document);
  checar(d.executados.length === 2, "dois executados: lê os dois (nenhum some em silêncio)");
  checar(d.executados[1].nome === "FULANO DE TAL", "dois executados: o segundo é lido inteiro");
  const linhas = w.__cratosCnib.linhasCertidaoCnib(d, "inclusao");
  checar(linhas.filter((l) => /^\d\)/.test(l)).length === 2,
    "a certidão numera os dois executados");
}

/* ────────────────────────────────────────────────────────────────────────────
   3. MODAL PELA METADE — não vira certidão
   ──────────────────────────────────────────────────────────────────────────── */
{
  const w = montar(modal(EXEC_UM, { semDados: true }));
  const d = w.__cratosCnib.lerDetalhesOrdem(w.document);
  checar(d === null,
    "modal sem o cartão de Dados (Blazor ainda montando) devolve null, não meia certidão");
}
{
  const w = montar(modal([]));   // sem nenhuma linha de executado
  const d = w.__cratosCnib.lerDetalhesOrdem(w.document);
  checar(d === null, "modal sem executado nenhum devolve null");
}
{
  const w = montar(`<div>outra tela qualquer</div>`);
  const d = w.__cratosCnib.lerDetalhesOrdem(w.document);
  checar(d === null, "fora do modal, devolve null (não inventa leitura)");
}

/* ────────────────────────────────────────────────────────────────────────────
   4. MAGIC BYTES — o bug que fazia página de erro virar .pdf
   ──────────────────────────────────────────────────────────────────────────── */
{
  const w = montar(modal(EXEC_UM));
  const { ehPdf } = w.__cratosCnib;
  const buf = (s) => {
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b.buffer;
  };
  checar(ehPdf(buf("%PDF-1.4\n...")) === true, "aceita PDF de verdade");
  checar(ehPdf(buf("﻿%PDF-1.7 ")) === true, "aceita PDF com BOM/espaço antes");

  const erroHtml = "<!DOCTYPE html><html><head><title>Erro</title></head><body>" +
    "Ocorreu um erro interno na aplicação".repeat(500) + "</body></html>";
  checar(ehPdf(buf(erroHtml)) === false,
    "REPROVA página de erro de 40 KB com HTTP 200 — o critério antigo (tamanho > 1 KB) aceitava");
  checar(ehPdf(buf("")) === false, "reprova resposta vazia");
  checar(ehPdf(buf("PK")) === false, "reprova .zip (não é PDF)");
  checar(ehPdf(buf("qualquer coisa com %PDF- bem no meio do texto, longe do começo")) === false,
    "reprova conteúdo que só MENCIONA %PDF- longe do início");
}

/* ────────────────────────────────────────────────────────────────────────────
   5. GUARDA DO PROCESSO
   ──────────────────────────────────────────────────────────────────────────── */
{
  const w = montar(modal(EXEC_UM));
  const { confereProcesso } = w.__cratosCnib;
  checar(confereProcesso("0000001-23.2025.5.18.0008", "00000012320255180008") === true,
    "compara por dígitos: mascarado na tela e cru no estado são o mesmo processo");
  checar(confereProcesso("0000001-23.2025.5.18.0008", "00099992220255180008") === false,
    "processo diferente é recusado (certidão de processo errado é pior que nenhuma)");
  checar(confereProcesso("", "00000012320255180008") === true,
    "campo vazio não inventa impedimento");
}


/* ────────────────────────────────────────────────────────────────────────────
   FIXTURE 2 — tela de CANCELAMENTO (HTML real de 02/09,
   /ordem/cancelar/detalhe/3636201/Total). Estrutura DIFERENTE do modal:
   sem .ordem-card, executados em <span>, processo em dígitos.
   ──────────────────────────────────────────────────────────────────────────── */
function parte(doc, rotDoc, nome, rotNome) {
  return `<br>
    <span class="mx-2"><strong>${rotDoc}: </strong>${doc}</span>
    <i class="mx-2"> | </i>
    <span class="mx-2"><strong>${rotNome}: </strong>${nome}</span> <br>`;
}
function telaCancelamento(partes, opts) {
  const o = opts || {};
  return `<div class="form-body-container-v5"><div class="form-body-v5">
  <input type="hidden" id="hdfhasRendered" value="idDateilRender">
  <div class="row"><div class="col"><label class="lblTitulo">Dados da Ordem</label></div></div>
  <div class="row"><div class="col-3"><div class="row"><div class="col"><label class="lblDescricao">Número do Processo</label></div></div>
      <div class="row"><div class="col"><label class="lblValorDescricao">00000022220145180008</label></div></div></div>
    <div class="col-3"><div class="row"><div class="col"><label class="lblDescricao">Nome do Processo</label></div></div>
      <div class="row"><div class="col"><label class="lblValorDescricao">GBA METALURGICA S/A</label></div></div></div></div>
  <div class="row d-flex justify-content-center"><label class="fw-bold text-danger">FOI AUTORIZADO O CANCELAMENTO DA INDISPONIBILIDADE ABAIXO NO DIA 02/09/2026 as 15:33:04</label></div><hr>
  <div class="row"><div class="col "><label class="lblTitulo">Status da Ordem de Cancelamento</label></div></div>
  <div class="row"><div class="col-3"><div class="row"><div class="col"><label class="lblDescricao">Status</label></div></div>
      <div class="row"><div class="col"><label class="lblValorDescricao">Enviado</label></div></div></div>
    <div class="col-3"><div class="row"><div class="col"><label class="lblDescricao">Aprovado por</label></div></div>
      <div class="row"><div class="col"><label data-toggle="tooltip" class="lblValorDescricao">FULANO DE TAL EXEMPLO:S000000  </label></div></div></div>
    <div class="col-3"><div class="row"><div class="col"><label class="lblDescricao">Data de Aprovação</label></div></div>
      <div class="row"><div class="col"><label class="lblValorDescricao">02/09/2026 15:33:04</label></div></div></div>
    <div class="col-3"><div class="row"><div class="col"><label class="lblDescricao">Protocolo</label></div></div>
      <div class="row"><div class="col"><label class="lblValorDescricao">202609.0215.03600000-TA-513</label></div></div></div></div><hr>
  <div class="row"><div class="col "><label class="lblTitulo">Status da Criação da Ordem</label></div></div>
  <div class="row"><div class="col-3"><div class="row"><div class="col"><label class="lblDescricao">Status</label></div></div>
      <div class="row"><div class="col"><label class="lblValorDescricao">Enviado</label></div></div></div>
    <div class="col-3"><div class="row"><div class="col"><label class="lblDescricao">Aprovado por</label></div></div>
      <div class="row"><div class="col"><label class="lblValorDescricao">BELTRANA EXEMPLO PEREIRA:S000000  </label></div></div></div>
    <div class="col-3"><div class="row"><div class="col"><label class="lblDescricao">Data de Aprovação</label></div></div>
      <div class="row"><div class="col"><label class="lblValorDescricao">11/10/2024 11:17:11</label></div></div></div>
    <div class="col-3"><div class="row"><div class="col"><label class="lblDescricao">Protocolo</label></div></div>
      <div class="row"><div class="col"><label class="lblValorDescricao">202410.1111.03600000-IA-910</label></div></div></div></div>
  <div class="row"><div class="col "><label class="lblTitulo">Processo tramita sob segredo de justiça</label></div></div>
  <div class="ml-3"><div class="row"><div><label class="lblDescricao">Não</label></div></div></div><hr>
  <div class="row mt-2"><div class="col-12"><div class="form-group">
    ${o.semPartes ? "" : partes.join("\n")}
  </div></div></div><hr>
  <div class="row mt-2"><div class="col-12"><div class="d-flex flex-row justify-content-end">
    <a class="btn btn-primary" href="/ordem/cancelamento/total">Cancelar Outra Ordem</a>
    <a id="hpkPrintCancellationDetail" target="_blank" class="btn btn-primary ml-3"
       href="/relatorio/cancelamento/detalhe/A8A1BC68">Imprimir</a>
  </div></div></div>
  </div></div>`;
}
const PARTES_REAIS = [
  parte("44.555.666/0001-02", "CNPJ", "GBA METALURGICA S/A (GBA METALURGICA)", "Razão Social"),
  parte("333.444.555-96", "CPF", "WANIA MARIA BEUTLER MARCONATO", "Nome"),
  parte("222.333.444-05", "CPF", "JOSE AUGUSTO MARCONATO", "Nome"),
];

/* ────────────────────────────────────────────────────────────────────────────
   7. TELA DE CANCELAMENTO
   ──────────────────────────────────────────────────────────────────────────── */
{
  const w = montar(telaCancelamento(PARTES_REAIS));
  const api = w.__cratosCnib;

  checar(api.lerDetalhesOrdem(w.document) === null,
    "o leitor do MODAL não lê a tela de cancelamento (estruturas diferentes) — devolve null em vez de meia leitura");

  const c = api.lerDetalhesCancelamento(w.document);
  checar(!!c, "o leitor do cancelamento lê a tela");
  checar(c.protocolo === "202609.0215.03600000-TA-513",
    "protocolo do CANCELAMENTO vem do cartão 'Status da Ordem de Cancelamento'");
  checar(c.protocoloOriginal === "202410.1111.03600000-IA-910",
    "protocolo da ordem ORIGINAL vem do cartão da criação — são dois fatos, não um");
  checar(c.protocolo !== c.protocoloOriginal, "os dois protocolos não se confundem");
  checar(c.aprovadoPor.indexOf("FULANO") === 0, "quem autorizou o cancelamento");
  checar(c.criadoPor.indexOf("BELTRANA") === 0,
    "quem registrou a ordem original — pode ser outra pessoa, de outra vara");
  checar(c.dataAprovacao === "02/09/2026 15:33:04" && c.dataCriacao === "11/10/2024 11:17:11",
    "as duas datas, cada uma do seu cartão");
  checar(c.numProcesso === "00000022220145180008",
    "nesta tela o processo vem em DÍGITOS (no modal vem mascarado)");
  checar(api.formatarProcesso(c.numProcesso) === "0000002-22.2014.5.18.0008",
    "a certidão mascara o número para leitura humana");
  checar(c.segredo === "Não", "lê o segredo de justiça (valor com classe de rótulo, como no modal)");
  checar(/FOI AUTORIZADO O CANCELAMENTO/.test(c.aviso), "captura o aviso em vermelho da tela");

  checar(c.executados.length === 3,
    "lê os TRÊS executados — que aqui não são tabela, são <span> soltos");
  checar(c.executados[0].documento === "44.555.666/0001-02" && /GBA METALURGICA/.test(c.executados[0].nome),
    "CNPJ + Razão Social do primeiro");
  checar(c.executados[1].documento === "333.444.555-96" && c.executados[1].nome === "WANIA MARIA BEUTLER MARCONATO",
    "CPF + Nome do segundo");
  checar(c.executados[2].nome === "JOSE AUGUSTO MARCONATO", "o terceiro não some");
  checar(!c.executados.some((e) => /^(CPF|CNPJ)/.test(e.documento)),
    "o rótulo não vaza para dentro do valor");

  const linhas = api.linhasCertidaoCancelamento(c);
  const txt = linhas.join("\n");
  checar(/202609\.0215\.03600000-TA-513/.test(txt), "a certidão traz o protocolo do cancelamento");
  checar(/202410\.1111\.03600000-IA-910/.test(txt), "a certidão traz o protocolo da ordem original");
  checar(/0000002-22\.2014\.5\.18\.0008/.test(txt), "a certidão traz o processo mascarado");
  checar(linhas.filter((l) => /^\d\)/.test(l)).length === 3, "a certidão numera os três executados");
  checar(!/CERTIFICO QUE FOI CANCELAD/i.test(txt),
    "a certidão relata o que a tela informou, sem afirmar efeito que não observou");
}
{
  const w = montar(telaCancelamento([], { semPartes: true }));
  checar(w.__cratosCnib.lerDetalhesCancelamento(w.document) === null,
    "tela de cancelamento sem nenhuma parte devolve null (não vira certidão vazia)");
}
{
  const w = montar(modal(EXEC_UM));
  checar(w.__cratosCnib.lerDetalhesCancelamento(w.document) === null,
    "o leitor do cancelamento não lê o modal da inclusão — cada um na sua tela");
}


/* ────────────────────────────────────────────────────────────────────────────
   8. ANATOMIA DO PROTOCOLO (explicada pelo Rodrigo, 02/09)
       202609.0215.03600000-TA-513
       └AAAAMM┘ └DDHH┘ └─ordem─┘ └tipo┘└seq┘
   Cada ATO gera protocolo próprio; o que atravessa a vida da ordem é o miolo.
   ──────────────────────────────────────────────────────────────────────────── */
{
  const w = montar(telaCancelamento(PARTES_REAIS));
  const api = w.__cratosCnib;

  checar(api.ordemDoProtocolo("202609.0215.03600000-TA-513") === "03600000",
    "extrai o número da ORDEM do protocolo do cancelamento");
  checar(api.ordemDoProtocolo("202410.1111.03600000-IA-910") === "03600000",
    "o mesmo número aparece no protocolo da inclusão de 2024 — é o fio que liga os dois atos");
  checar(api.ordemDoProtocolo("202609.0214.04900000-IA-228") === "04900000",
    "outra ordem, outro número");
  checar(api.ordemDoProtocolo("qualquer coisa") === "",
    "protocolo fora do padrão não vira número inventado");

  const c = api.lerDetalhesCancelamento(w.document);
  checar(c.ordem === "03600000" && c.ordemOriginal === "03600000",
    "os dois protocolos da tela apontam para a mesma ordem");
  checar(c.mesmaOrdem === true, "e isso é reconhecido");
  checar(api.linhasCertidaoCancelamento(c).some((l) => /Ordem CNIB nº 03600000/.test(l)),
    "a certidão de cancelamento nomeia a ordem — é o que amarra os dois protocolos");
}
{
  /* Tela inconsistente: protocolos de ordens diferentes. */
  const html = telaCancelamento(PARTES_REAIS)
    .replace("202410.1111.03600000-IA-910", "202410.1111.09999999-IA-910");
  const w = montar(html);
  const c = w.__cratosCnib.lerDetalhesCancelamento(w.document);
  checar(c.mesmaOrdem === false,
    "protocolos de ordens DIFERENTES são detectados (a certidão ligaria coisas que não se ligam)");
  checar(c !== null, "mas a leitura não é bloqueada: o cancelamento já aconteceu, é caso de aviso");
}
{
  /* Na INCLUSÃO os gêmeos trazem o MESMO protocolo — é o normal, não um bug:
     "Status da Ordem" é o ato mais recente e, recém-criada, o ato mais recente
     é a própria criação. A certidão não deve repetir a linha. */
  const html = modal(EXEC_UM).replace("CRIACAO-APROVADOR", "FULANO DE TAL EXEMPLO:S000000");
  const w = montar(html);
  const d = w.__cratosCnib.lerDetalhesOrdem(w.document);
  const linhas = w.__cratosCnib.linhasCertidaoCnib(d, "inclusao");
  checar(d.protocolo === d.protocoloCriacao,
    "na inclusão recém-criada os dois cartões trazem o mesmo protocolo (é o esperado)");
  checar(linhas.filter((l) => /^Protocolo/.test(l)).length === 1,
    "a certidão de inclusão traz UMA linha de protocolo quando os dois coincidem");
}
{
  /* Ordem que já sofreu outro ato: os cartões divergem, e aí os dois protocolos
     precisam aparecer — certificar como inclusão nova o que já foi cancelado
     seria falso. */
  const html = modal(EXEC_UM).replace(
    '<label class="lblValorDescricao">202609.0214.04900000-IA-228</label></div></div></div></div></div>\n\nconst CARTAO_SEGREDO',
    '<label class="lblValorDescricao">202609.0214.04900000-IA-228</label></div></div></div></div></div>\n\nconst CARTAO_SEGREDO');
  const w = montar(modal(EXEC_UM).replace(
    /(Status da Criação da Ordem[\s\S]*?)202609\.0214\.04900000-IA-228/,
    "$1202410.1111.04900000-IA-777"));
  const d = w.__cratosCnib.lerDetalhesOrdem(w.document);
  const linhas = w.__cratosCnib.linhasCertidaoCnib(d, "inclusao");
  checar(d.protocolo !== d.protocoloCriacao, "os protocolos divergem neste caso");
  checar(linhas.some((l) => /Protocolo da criação da ordem/.test(l)),
    "quando divergem, a certidão traz os DOIS protocolos");
}

/* ────────────────────────────────────────────────────────────────────────────
   6. A MENSAGEM DE FABRICAÇÃO — o bug silencioso do delta
   ──────────────────────────────────────────────────────────────────────────── */
{
  enviadas.length = 0;
  const w = montar(modal(EXEC_UM));
  const api = w.__cratosCnib;
  const d = api.lerDetalhesOrdem(w.document);
  return_check(api, d);
}
function return_check(api, d) {
  const p = api.fabricarCertidaoOrdem(d, "inclusao", { numProcesso: "00000012320255180008" });
  p.then(() => {
    const m = enviadas.find((x) => x.tipo === "fabricar_pdf");
    checar(!!m, "fabricarCertidaoOrdem manda uma mensagem fabricar_pdf");
    checar(m && m.numProcesso === "00000012320255180008",
      "⛔ a mensagem leva numProcesso — SEM ELE o PDF baixa mas NÃO entra no diário");
    checar(m && m.convenio === "CNIB", "a mensagem leva convenio: sem ele o diário grava '?'");
    checar(m && m.operacao === "inclusao",
      "a mensagem leva operacao: é o que separa 'Convênios realizados' de 'Cancelamento'");
    checar(m && /CNIB Inclusao \(certidao\)\.pdf$/.test(m.filename),
      "o nome do arquivo diz que é CERTIDÃO, não comprovante — não se passa pelo documento oficial");
    checar(m && m.filename.indexOf("CRATOS/") === 0, "o arquivo vai para a pasta do CRATOS");
    checar(m && /CERTID(Ã|A)O/.test(m.titulo), "o título diz CERTIDÃO");
    checar(m && Array.isArray(m.linhas) && m.linhas.some((l) => /202609\.0214/.test(l)),
      "as linhas trazem o protocolo");
    checar(m && m.linhas.some((l) => /8ª VARA DO TRABALHO/.test(l)),
      "as linhas trazem a vara (a armadilha 1 chegando até o documento)");
    checar(m && !m.linhas.some((l) => l.length > 0 && l === l.slice(0, 90) && /\s$/.test(l)),
      "o módulo não quebra linha: quem mede largura é o gerarPDFTexto");
    fim();
  });
}

function fim() {
  console.log("\n=== teste-cnib-detalhe.js ===");
  oks.forEach((d) => console.log("  ok   " + d));
  falhas.forEach((d) => console.log("  FALHA " + d));
  console.log(`\n${oks.length} passaram, ${falhas.length} falharam ` +
    `(${oks.length + falhas.length} asserções)\n`);
  process.exit(falhas.length ? 1 : 0);
}
