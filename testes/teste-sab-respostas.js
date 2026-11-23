/*
 * teste-sab-respostas.js — 1.9.4: respostas do SAB/SISBAJUD e a baixa sem adivinhação.
 *
 * Dados 100% FICTÍCIOS (processos, nomes, CPFs, protocolos). O que se trava aqui:
 *   1. comum/sab-leitura.js — datas de Brasília, dia útil anterior, a escolha da
 *      determinação da BAIXA (nenhuma / uma / várias), o seletor da coleta, o índice do
 *      que já está nos autos (protocolo no título; "Sisbajud (transferência)" sem
 *      protocolo = possível duplicidade), o modelo e a certidão em blocos;
 *   2. ⛔ REGRA DE FERRO: ordem aguardando ≠ resultado; relatório que não veio é
 *      "não obtido (falha técnica, não resultado)", nunca some;
 *   3. o cliente da API só faz GET, nunca chama /transicoes, e recusa o que não é PDF;
 *   4. fundo: uma certidão por GRUPO (determinação), fecho conforme o que vai anexo,
 *      marcarJuntados só do grupo, Cofre.remover só dos anexados, travessão no PDF;
 *   5. módulo SAB (baixa): duas ativas sem escolha → erro; com escolha → ela; nenhuma →
 *      "não há determinação ativa para interromper"; determinação de outro processo
 *      nunca entra;
 *   6. painel: "Coletar SAB" (seletor, certidões por determinação, anexos sem
 *      duplicidade), escolha da baixa (nada pré-marcado) e o lote do dia (aguardando
 *      fora, rascunho pulado, alerta de obrigação realizada, GIGS opcional, minuta do
 *      tipo "Sisbajud (transferência)", NUNCA assinatura).
 *
 * Rodar: node teste-sab-respostas.js   (CRATOS_SRC=<src antigo> para ver reprovar)
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const falhas = [];
const oks = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }
function fim() {
  console.log("\n=== teste-sab-respostas.js ===");
  oks.forEach((d) => console.log("  ok   " + d));
  falhas.forEach((d) => console.log("  FALHA " + d));
  console.log(`\n${oks.length} passaram, ${falhas.length} falharam (${oks.length + falhas.length} asserções)\n`);
  process.exit(falhas.length ? 1 : 0);
}
const ARQ_LEITURA = path.join(SRC, "comum", "sab-leitura.js");
if (!fs.existsSync(ARQ_LEITURA)) {
  checar(false, "comum/sab-leitura.js não existe nesta versão (coleta do SAB, lote e baixa por escolha)");
  fim();
}
const L = require(ARQ_LEITURA);

/* ═══ CENÁRIO FICTÍCIO ═══════════════════════════════════════════════════════ */
const P1 = { id: 900, numero: "00009999920265180008", idPJe: 555 };
const P2 = { id: 901, numero: "00008888820265180008", idPJe: 556 };
const P3 = { id: 902, numero: "00007777720265180008", idPJe: 557 };
const bl = (aplicado, bloqueado, transferido) => [{ pessoa: { nome: "EMPRESA FICTICIA LTDA" }, valorAplicado: aplicado, valorBloqueado: bloqueado, valorTransferido: transferido, contas: [] }];
const ordem = (id, prot, sit, data, b, proc, idDet, tipo) => ({
  id, numeroProtocolo: prot, situacao: sit, dataProtocolo: data, dataUltimoProtocolo: data,
  tipoOrdem: tipo || "BLOQUEIO_DE_VALOR", bloqueios: b, processo: { numero: proc.numero, idPJe: proc.idPJe },
  obrigacao: { idDeterminacao: idDet },
});
const ORDENS = {
  43999: [
    ordem(1, "20260087519703", "RESPONDIDA", "2026-11-12T13:24:00", bl(90100.45, 110.15, 50), P1, 43999, "DESDOBRAMENTO_BLOQUEIO_VALORES"),
    ordem(2, "20260086552018", "RESPONDIDA", "2026-10-28T06:47:00", bl(90210.24, 1250, 1250), P1, 43999),
    ordem(3, "20260088072394", "ENVIADA", "2026-11-12T10:38:00", bl(90354.11, 0, 200), P1, 43999, "DESDOBRAMENTO_BLOQUEIO_VALORES"),   // transferência pedida, banco ainda não respondeu
    ordem(4, "20260087191199", "RESPONDIDA", "2026-11-04T06:38:00", bl(90160.24, 59.79, 0), P1, 43999),
    ordem(5, "20260086999999", "RESPONDIDA", "2026-11-12T09:00:00", bl(90160.24, 30, 30), P1, 43999),
    ordem(10, "20260088111110", "ENVIADA", "2026-11-12T08:00:00", [], P1, 43999),                       // bloqueio sem resposta
    ordem(11, "20260088111111", "NAO_ENVIADA", "2026-11-12T12:00:00", bl(90000, 0, 40), P1, 43999, "DESDOBRAMENTO_BLOQUEIO_VALORES"),   // transferência ainda não enviada
  ],
  43000: [ordem(6, "20260087000001", "RESPONDIDA", "2026-11-12T15:00:00", bl(500, 100, 100), P1, 43000)],
  45000: [ordem(7, "20260087000002", "RESPONDIDA", "2026-11-12T11:00:00", bl(800, 10, 10), P2, 45000)],
  46000: [ordem(8, "20260087000003", "RESPONDIDA", "2026-11-12T11:00:00", bl(800, 10, 10), P3, 46000)],
};
const detResumo = (id, sit, proc, ocorrido) => ({ id, situacao: sit, processo: { id: proc.id, numero: proc.numero, idPJe: proc.idPJe }, ultimaSituacao: { ocorridoEm: ocorrido } });
let DETS = [
  detResumo(43999, "EM_PROCESSAMENTO", P1, "2026-10-16T09:12:00"),
  detResumo(43000, "FINALIZADA", P1, "2026-11-12T15:05:00"),
  detResumo(44001, "MINUTA", P1, "2026-11-10T10:00:00"),
  detResumo(45000, "EM_PROCESSAMENTO", P2, "2026-10-01T10:00:00"),
  detResumo(46000, "INTERROMPIDA", P3, "2026-11-01T10:00:00"),
];
const detCompleta = (id) => {
  const r = DETS.find((d) => d.id === id);
  const realizada = id === 43000;
  return Object.assign({}, r, {
    nomeMagistrado: "JUIZ FICTICIO DA SILVA", valorTotalObrigacao: realizada ? 100 : 100000,
    exequente: { nome: "MARIA FICTICIA DE SOUZA", numeroDocumento: "00000000191" },
    repeticaoProgramada: true,
    executados: [{ id: 11, pessoa: { nome: "EMPRESA FICTICIA LTDA", numeroDocumento: "00000000000191" } },
      { id: 12, pessoa: { nome: "SOCIO FICTICIO JUNIOR", numeroDocumento: "00000000272" } }],
    obrigacoes: [{ valorReferencia: realizada ? 100 : 100000, valorRemanescente: realizada ? 0 : 98700, realizada,
      obrigacoesExecutados: [{ executado: { id: 11 }, valorRealizado: realizada ? 100 : 1300 }, { executado: { id: 12 }, valorRealizado: 0 }] }],
  });
};
const TIMELINE = {
  555: [
    { id: 300, titulo: "Certidão", tipo: "Certidão", data: "2026-10-29T10:00:00", ativo: true,
      anexos: [{ id: 301, titulo: "00009999920265180008_Sisbajud (transferência) - 20260086552018", tipo: "Sisbajud (transferência)", data: "2026-10-29T10:00:00" }] },
    { id: 302, titulo: "Despacho", tipo: "Despacho", data: "2026-11-01T10:00:00", ativo: true, anexos: [] },
    /* a rotina da vara: de manhã, a resposta de uma ordem ANTERIOR, sem protocolo no título */
    { id: 303, titulo: "Sisbajud (transferência)", tipo: "Sisbajud (transferência)", data: "2026-11-12T07:39:00", ativo: true, anexos: [] },
  ],
  556: [],
  557: [],
};

/* fetch falso: guarda TODAS as chamadas (método + caminho) */
function fetchFalso(opc) {
  const o = opc || {};
  const chamadas = [];
  const resp = (status, corpo, bin) => ({
    ok: status >= 200 && status < 300, status,
    json: async () => (typeof corpo === "string" ? JSON.parse(corpo) : corpo),
    text: async () => (typeof corpo === "string" ? corpo : JSON.stringify(corpo || "")),
    arrayBuffer: async () => new Uint8Array(bin || Buffer.from(JSON.stringify(corpo || ""))).buffer,
  });
  let idDoc = 8000;
  const f = async (url, init) => {
    const u = new URL(url, "https://pje.trt18.jus.br");
    const metodo = (init && init.method) || "GET";
    const caminho = u.pathname;
    chamadas.push({ metodo, caminho, busca: u.search, corpo: init && init.body });
    const q = u.searchParams;
    let m;
    if (caminho === "/sab-api/api/processos") {
      const n = q.get("numeroProcesso").replace(/\D/g, "");
      const p = [P1, P2, P3].find((x) => x.numero === n);
      return resp(200, { resultado: p ? [p] : [] });
    }
    if (caminho === "/sab-api/api/determinacoes") {
      const idp = q.get("idProcesso");
      /* filtro de processo do SAB "ignorado" de propósito no cenário da baixa: o
         cliente precisa conferir processo.id do lado de cá */
      let lista = idp && !o.ignorarFiltro ? DETS.filter((d) => String(d.processo.id) === idp) : DETS;
      const pag = Number(q.get("pagina"));
      const metade = Math.ceil(lista.length / 2);
      const pg = pag === 1 ? lista.slice(0, metade) : lista.slice(metade);
      return resp(200, { resultado: pg, pagina: pag, qtdPaginas: lista.length > 1 ? 2 : 1 });
    }
    if ((m = caminho.match(/^\/sab-api\/api\/determinacoes\/(\d+)$/))) return resp(200, detCompleta(Number(m[1])));
    if ((m = caminho.match(/^\/sab-api\/api\/determinacoes\/(\d+)\/situacoes$/))) {
      return resp(200, [{ situacao: "EM_PROCESSAMENTO", ocorridoEm: "2026-10-16T09:12:00" }, { situacao: "MINUTA", ocorridoEm: "2026-10-15T17:40:00" }, { situacao: "AUTORIZADA", ocorridoEm: "2026-10-16T09:05:00" }]);
    }
    if ((m = caminho.match(/^\/sab-api\/api\/determinacoes\/(\d+)\/ordens$/))) {
      let l = ORDENS[m[1]] || [];
      if (q.get("resolucaoBloqueio") === "COM_TRANSFERENCIAS") l = l.filter((x) => x.bloqueios.some((b) => b.valorTransferido > 0));
      const pag = Number(q.get("pagina"));
      const pg = pag === 1 ? l.slice(0, 3) : l.slice(3);
      return resp(200, { resultado: pg, pagina: pag, qtdPaginas: l.length > 3 ? 2 : 1, totalRegistros: l.length });
    }
    if ((m = caminho.match(/^\/sab-api\/api\/ordens\/(\d+)\/relatorio-detalhamento-sisbajud$/))) {
      if (m[1] === "5") return resp(500, "erro");
      return resp(200, "", Buffer.from("%PDF-1.4 relatorio ficticio " + m[1]));
    }
    if ((m = caminho.match(/^\/pje-comum-api\/api\/processos\/id\/(\d+)\/timeline$/))) return resp(200, TIMELINE[m[1]] || []);
    /* 1.9.8: a estrutura do documento vem dos parâmetros do processo (62 no TRT18) */
    if (/^\/pje-comum-api\/api\/processos\/id\/\d+\/documentos\/minuta\/A\/parametros$/.test(caminho)) {
      return resp(200, { estruturasDocumento: [{ id: 62, titulo: "Anexar Documentos", padraoFuncionalidade: true }] });
    }
    if ((m = caminho.match(/^\/pje-comum-api\/api\/processos\/id\/(\d+)\/documentos\/minuta\/A\/metadados$/))) {
      if (metodo === "GET") return resp(m[1] === "556" ? 200 : 204, m[1] === "556" ? { id: 1 } : "");
      return resp(200, { id: 7000 + Number(m[1]), version: 1, md5: "x", idPessoaInclusao: 1 });
    }
    /* 1.9.6: a lista "do processo" = tipos dos documentos que JÁ EXISTEM nele (no 555, nenhum
       "Sisbajud (transferência)" ainda); o catálogo inteiro vem de /dominio/tiposdocumentoprocesso */
    if ((m = caminho.match(/\/dominio\/tiposdocumentoprocesso\/processo\/(\d+)$/))) {
      const l = [{ id: 57, nomeTipoProcessoDocumento: "Certidão" }, { id: 115, nomeTipoProcessoDocumento: "Documento Diverso", codigoDocumento: "80" }];
      if (m[1] !== "555") l.push({ id: 999, nomeTipoProcessoDocumento: "Sisbajud (transferência)", codigoDocumento: "77" });
      return resp(200, l);
    }
    if (/\/dominio\/tiposdocumentoprocesso\/?$/.test(caminho)) {
      const l = [{ id: 57, nomeTipoProcessoDocumento: "Certidão", ativo: true }, { id: 115, nomeTipoProcessoDocumento: "Documento Diverso", codigoDocumento: "80", ativo: true },
        { id: 998, nomeTipoProcessoDocumento: "Sisbajud (transferência)", codigoDocumento: "76", ativo: false }];
      if (!o.semTipo) l.push({ id: 999, nomeTipoProcessoDocumento: "Sisbajud (transferência)", codigoDocumento: "77", ativo: true });
      return resp(200, l);
    }
    if (/\/documentos\/minuta\/A\/template$/.test(caminho)) return resp(200, { topicos: [{ id: 1, conteudo: "", somenteLeitura: false }], minutaTipoFuncionalidade: "A" });
    if (/\/parametros\//.test(caminho)) return resp(200, { valorVariavel: "10" });
    if (/\/visibilidadesigilo\/$/.test(caminho)) return resp(200, { resultado: [] });
    if (/\/documentos\/$/.test(caminho) && metodo === "POST") return resp(200, { id: ++idDoc });
    if (caminho === "/pje-gigs-api/api/tiposatividades") return resp(200, [{ id: 31, descricao: "SISBAJUD - verificar garantia do juízo" }]);
    if (caminho === "/pje-gigs-api/api/atividade") return resp(200, {});
    return resp(204, "");
  };
  f.chamadas = chamadas;
  return f;
}

(async () => {
  /* ═══ 1. FUNÇÕES PURAS ════════════════════════════════════════════════════ */
  {
    const a = L.dataLocal("2026-11-12T10:38:00");
    checar(a && a.ymd === "2026-11-12" && a.dmyhm === "12/11/2026 10:38", "dataLocal: sem fuso = hora de Brasília como veio");
    const z = L.dataLocal("2026-11-13T01:30:00Z");
    checar(z && z.ymd === "2026-11-12" && z.hm === "22:30", "dataLocal: com Z converte para -03:00 (vira o dia anterior)");
    checar(L.dataLocal("lixo") === null, "dataLocal: data irreconhecível → null (quem chama decide)");
    checar(L.diaUtilAnterior("2026-11-16") === "2026-11-13", "dia útil anterior de segunda = sexta");
    checar(L.diaUtilAnterior("2026-11-17") === "2026-11-16", "dia útil anterior de terça = segunda");
    checar(L.diaUtilAnterior("2026-11-15") === "2026-11-13", "dia útil anterior de domingo = sexta");
    checar(L.reais(1234567.8) === "R$ 1.234.567,80" && L.reais(0) === "R$ 0,00", "reais: formato brasileiro");

    const ds = [{ id: 1, situacao: "EM_PROCESSAMENTO" }, { id: 2, situacao: "INTERROMPIDA" }, { id: 3, situacao: "MINUTA" }, { id: 4, situacao: "FINALIZADA" }];
    checar(L.escolherDeterminacaoBaixa(ds).id === 1, "baixa: uma ativa → ela");
    const duas = ds.concat([{ id: 5, situacao: "EM_PROCESSAMENTO" }]);
    const rv = L.escolherDeterminacaoBaixa(duas);
    checar(rv.erro === "varias" && rv.ativas.length === 2 && rv.id === undefined, "⛔ baixa: duas ativas sem escolha → NÃO escolhe (erro 'varias')");
    checar(L.escolherDeterminacaoBaixa(duas, "5").id === 5, "baixa: duas ativas + escolha → a escolhida");
    checar(L.escolherDeterminacaoBaixa(duas, "2").erro === "escolhida_inativa", "baixa: escolha de uma interrompida → recusa");
    checar(L.escolherDeterminacaoBaixa(ds.filter((d) => d.id !== 1)).erro === "nenhuma", "baixa: nenhuma ativa → erro 'nenhuma'");

    const c = L.candidatasColeta([{ id: 10, situacao: "INTERROMPIDA" }, { id: 11, situacao: "MINUTA" }, { id: 12, situacao: "EM_PROCESSAMENTO" }, { id: 13, situacao: "FINALIZADA" }], { 13: 2 });
    checar(c.length === 3 && !c.some((x) => x.id === 11), "coleta: MINUTA fica fora do seletor");
    checar(c.find((x) => x.id === 12).marcada && c.find((x) => x.id === 13).marcada && !c.find((x) => x.id === 10).marcada,
      "coleta: marcadas = ativa + finalizada com transferência nova; interrompida sem nova desmarcada");

    const idx = L.indiceJuntados(TIMELINE[555].concat([
      { id: 400, titulo: "Sisbajud (transferência)", tipo: "Sisbajud (transferência)", data: "2026-11-05T10:00:00", ativo: true, anexos: [] },
      { id: 401, titulo: "x 20260011111111", tipo: "Certidão", data: "2026-11-05T10:00:00", ativo: false, anexos: [] },
    ]));
    const ja = L.situacaoNosAutos(idx, "20260086552018", "2026-10-28T06:47:00");
    checar(ja && ja.ja && ja.em === "29/10", "autos: protocolo no título do anexo → 'já juntado em 29/10'");
    checar(L.situacaoNosAutos(idx, "20260087519703", "2026-11-12T13:24:00") === null,
      "⛔ autos: 'Sisbajud (transferência)' juntado de MANHÃ não é duplicata da ordem da TARDE do mesmo dia (data e hora)");
    const tarde = L.situacaoNosAutos(L.indiceJuntados([{ id: 1, titulo: "Sisbajud (transferência)", tipo: "Sisbajud (transferência)", data: "2026-11-12T16:00:00", ativo: true }]), "20260087519703", "2026-11-12T13:24:00");
    checar(tarde && tarde.possivel, "autos: juntado DEPOIS da ordem no mesmo dia → possível duplicidade");
    const pos = L.situacaoNosAutos(idx, "20260087191199", "2026-11-04T06:38:00");
    checar(pos && pos.possivel, "autos: 'Sisbajud (transferência)' sem protocolo, juntado depois da ordem → possível duplicidade");
    checar(L.situacaoNosAutos(idx, "20260087519703", "2026-11-12T13:24:00") === null, "autos: ordem posterior ao documento sem protocolo → livre");
    checar(L.situacaoNosAutos(idx, "20260011111111", "2026-11-12T10:00:00") === null, "autos: documento inativo (excluído) não conta");

    const m = L.modelo(detCompleta(43999), [], ORDENS[43999]);
    checar(m.executados[0].realizado === 1300 && m.executados[0].valorExecucao === 100000 && m.executados[1].realizado === 0,
      "modelo: realizado e valor da execução por executado vêm do SAB (obrigacoesExecutados / valorReferencia)");
    checar(m.remanescente === 98700 && !m.realizada, "modelo: remanescente do SAB; não realizada");
    checar(m.ordens[0].protocolo === "20260087519703" && m.ordens[0].tipo === "Desdobramento", "modelo: ordens da mais recente para a mais antiga");
    checar(L.modelo(detCompleta(43000), [], []).realizada, "modelo: remanescente 0 → obrigação realizada");

    const des = L.certidaoBlocos(m, { numProcesso: P1.numero, agora: new Date("2026-11-13T14:20:00Z"),
      anexos: { 20260087519703: { n: 1 }, 20260086552018: { ja: true, em: "29/10" }, 20260086999999: { falhou: true } } });
    const tudo = JSON.stringify(des.blocos);
    checar(/nesta data \(13\/11\/2026, às 11:20\)/.test(tudo), "certidão: data e hora de Brasília no 'Certifico'");
    checar(des.meta.rotuloId === "Determinação nº 43999" && des.meta.origem === "SAB", "certidão: rodapé com a determinação e a origem SAB");
    const tabOrd = des.blocos.find((b) => b.t === "tabela" && b.colunas[0].titulo === "Protocolo");
    const lEnv = tabOrd.linhas.find((l) => l[0] === "20260088111110");
    checar(lEnv[3].texto === "aguardando" && lEnv[5] === "—" && lEnv[6] === "—", "⛔ bloqueio ENVIADO: 'aguardando' e '—' (não R$ 0,00)");
    const lTr = tabOrd.linhas.find((l) => l[0] === "20260088072394");
    checar(lTr[3].texto === "transf. enviada" && lTr[6] === "R$ 200,00" && /confirmação da instituição financeira ainda não constava/.test(tudo),
      "transferência ENVIADA (desdobramento): 'transf. enviada', com o valor e a nota de que o banco ainda não confirmou");
    checar(L.ordemJuntavel(ORDENS[43999][2]) && L.ordemJuntavel(ORDENS[43999][0]) && !L.ordemJuntavel(ORDENS[43999][5]) && !L.ordemJuntavel(ORDENS[43999][6]) && !L.ordemJuntavel(ORDENS[43999][3]),
      "⛔ juntável = com transferência E (respondida OU transferência enviada); bloqueio sem resposta e não enviada, não");
    checar(/não representa resultado/.test(tudo), "⛔ nota: aguardando não representa resultado");
    checar(tabOrd.linhas.find((l) => l[0] === "20260086552018")[7] === "já juntado em 29/10", "certidão: anexo já nos autos marcado 'já juntado em 29/10'");
    checar(/não pôde ser obtido do SAB nesta consulta \(falha técnica, não resultado\)/.test(tudo), "⛔ relatório não obtido → alerta de falha técnica, nunca omitido");
    const tabAnx = des.blocos.find((b) => b.t === "tabela" && b.colunas[1] && b.colunas[1].titulo === "Ordem (protocolo)");
    checar(tabAnx && tabAnx.linhas.length === 1 && tabAnx.linhas[0][1] === "20260087519703", "certidão: tabela de anexos só com o que foi anexado agora");
    checar(!/nada bloqueado|certidão negativa|resultado negativo/i.test(tudo), "⛔ certidão nunca diz 'nada bloqueado'");
    checar(!tudo.includes(L.ALERTA_REALIZADA), "certidão: sem alerta de obrigação realizada quando há remanescente");
    const desR = L.certidaoBlocos(L.modelo(detCompleta(43000), [], ORDENS[43000]), { numProcesso: P1.numero });
    checar(JSON.stringify(desR.blocos).includes("verificar a garantia do juízo") && !/juízo garantido/i.test(JSON.stringify(desR.blocos)),
      "certidão: obrigação realizada → 'verificar a garantia do juízo' (nunca 'juízo garantido')");
    checar(Array.isArray(des.linhas) && des.linhas.length > 10, "certidão: texto corrido de reserva (se o desenho falhar)");

    const dia = L.ordensDoDia(ORDENS[43999].concat([ordem(9, "20260087000009", "RESPONDIDA", "2026-11-13T01:00:00Z", bl(1, 1, 1), P1, 43999)]), "2026-11-12");
    checar(dia.map((o) => o.id).join(",") === "1,3,5,11,9", "lote: só ordens com transferência e último protocolo no dia (com conversão de fuso)");
    checar(L.nomeDetalhamento(P1.numero, "20260087519703", "../CRATOS") === "CRATOS/00009999920265180008_Sisbajud (transferência) - 20260087519703.pdf",
      "nome do relatório leva o protocolo; pasta sem '../'");
    const g = L.agruparPorProcesso([{ ordem: ORDENS[45000][0] }, { ordem: ORDENS[43999][0] }, { ordem: ORDENS[43000][0] }]);
    checar(g.length === 2 && g[0].numero === P2.numero && g[1].itens.length === 2 && g[1].idPJe === 555, "lote: agrupa por processo");
  }

  /* ═══ 2. CLIENTE DA API ═══════════════════════════════════════════════════ */
  {
    const f = fetchFalso();
    const cli = L.cliente({ base: "https://pje.trt18.jus.br", fetch: f });
    const ords = await cli.ordens(43999);
    checar(ords.length === 7, "cliente: ordens paginadas (2 páginas) → todas");
    const com = await cli.ordens(43999, "COM_TRANSFERENCIAS");
    checar(com.length === 5, "cliente: filtro COM_TRANSFERENCIAS");
    const pdf = await cli.pdfOrdem(1);
    checar(Buffer.from(pdf, "base64").toString().startsWith("%PDF-"), "cliente: relatório em base64");
    let erro = null; try { await cli.pdfOrdem(5); } catch (e) { erro = e; }
    checar(erro && /500/.test(erro.message), "cliente: relatório com erro → exceção (não PDF vazio)");
    const f2 = fetchFalso({ ignorarFiltro: true });
    const d2 = await L.cliente({ base: "", fetch: f2 }).determinacoesDoProcesso(900);
    checar(d2.length === 3 && d2.every((d) => d.processo.id === 900), "⛔ cliente: filtro do SAB ignorado → confere processo.id (outro processo nunca entra)");
    checar(f.chamadas.every((c) => c.metodo === "GET") && !f.chamadas.some((c) => /transicoes/.test(c.caminho)),
      "⛔ cliente: só GET, e nunca /transicoes");
  }

  /* ═══ 3. FUNDO (background.js) ════════════════════════════════════════════ */
  const bg = fs.readFileSync(path.join(SRC, "background.js"), "utf8");
  const ini = bg.indexOf("const _P_CORPO");
  const iFn = bg.indexOf("function montarCertidoes(");
  const montar = new Function(bg.slice(ini, bg.indexOf("\n}\n", iFn) + 3) + "\nreturn montarCertidoes;")();
  {
    const it = (op, det, grupo, arq) => ({ convenio: "SAB", operacao: op, detalhe: det, grupo, rotuloGrupo: grupo ? `determinação nº ${grupo}` : undefined, arquivo: arq });
    const cs = montar({ itens: [
      it("respostas_sab", "certidao", "43999", "c1.pdf"), it("respostas_sab", "detalhamento", "43999", "d1.pdf"),
      it("respostas_sab", "certidao", "43000", "c2.pdf"),
      { convenio: "RENAJUD", operacao: "inclusao", arquivo: "r.pdf" },
    ] });
    const sab = cs.filter((c) => c.tipo === "sab_respostas");
    checar(sab.length === 2, "fundo: uma certidão por determinação (grupo)");
    const c1 = sab.find((c) => c.grupo === "43999"), c2 = sab.find((c) => c.grupo === "43000");
    checar(c1 && c1.arquivos.join() === "c1.pdf,d1.pdf" && c2.arquivos.join() === "c2.pdf", "fundo: cada certidão leva só os arquivos do seu grupo");
    checar(c1.titulo === "Respostas do SAB/SISBAJUD (determinação nº 43999)", "fundo: título com a determinação");
    checar(/estão anexados a presente/.test(c1.html) && /e os relatórios de detalhamento/.test(c1.html), "fundo: fecho com certidão + relatórios");
    checar(/certidão consolidada da posição das ordens está anexada/.test(c2.html) && !/relatórios/.test(c2.html), "fundo: só a certidão → 'está anexada', sem prometer relatórios");
    checar(cs.some((c) => c.tipo !== "sab_respostas" && c.grupo === undefined), "fundo: as outras famílias seguem sem grupo");
    const tr = montar({ itens: [it("transferencia_sab", "detalhamento", "lote-2026-11-12", "t1.pdf"), it("transferencia_sab", "detalhamento", "lote-2026-11-12", "t2.pdf")] });
    checar(tr.length === 1 && tr[0].tipoDocumento === "Sisbajud (transferência)" && tr[0].tipoAnexo === "Sisbajud (transferência)" && !/CERTIDÃO/.test(tr[0].html),
      "fundo: 'só a resposta' → documento 'Sisbajud (transferência)', sem moldura de certidão");

    /* Diário: marcar só o grupo juntado */
    const iD = bg.indexOf("const Diario = {");
    const fD = bg.indexOf("\n};\n", iD) + 4;
    const mem = {};
    const Store = { get: async (k) => mem[k], set: async (k, v) => { mem[k] = v; } };
    const iF = bg.indexOf("const _FAMILIAS = [");
    const fams = new Function(bg.slice(iF, bg.indexOf("\n];\n", iF) + 4) + "\nreturn _FAMILIAS;")();
    const Diario = new Function("Store", "_FAMILIAS", bg.slice(iD, fD) + "\nreturn Diario;")(Store, fams);
    for (const x of [it("respostas_sab", "certidao", "43999", "c1.pdf"), it("respostas_sab", "certidao", "43000", "c2.pdf")]) await Diario.registrar(P1.numero, x);
    await Diario.marcarJuntados(P1.numero, "sab_respostas", "43999");
    const lido = await Diario.ler(P1.numero);
    checar(lido.itens.find((x) => x.grupo === "43999").juntadoEm && !lido.itens.find((x) => x.grupo === "43000").juntadoEm,
      "⛔ diário: juntar a determinação 43999 NÃO fecha a 43000");

    /* Cofre.remover */
    const iC = bg.indexOf("const Cofre = {");
    const Cofre = new Function(bg.slice(iC, bg.indexOf("globalThis.__cratosCofre", iC)) + "\nreturn Cofre;")();
    Cofre.guardar(P1.numero, "CRATOS/a.pdf", "QUJD"); Cofre.guardar(P1.numero, "CRATOS/b.pdf", "REVG");
    checar(typeof Cofre.remover === "function", "cofre: existe remover (só os anexados)");
    if (Cofre.remover) { Cofre.remover(P1.numero, ["a.pdf"]); checar(Cofre.listar(P1.numero).map((x) => x.nome).join() === "b.pdf", "cofre: remover tira só o anexado; a outra certidão mantém o seu"); }

    /* Travessão & cia. no PDF (WinAnsi) */
    const iS = bg.indexOf("function sanitizePDF");
    const iW = bg.indexOf("const _WINANSI");
    const san = iW >= 0 ? new Function(bg.slice(iW, bg.indexOf("\n}\n", bg.indexOf("function paraWinAnsi")) + 3) + bg.slice(iS, bg.indexOf("\n}\n", iS) + 3) + "\nreturn sanitizePDF;")() : null;
    const s = san ? san("Certidão — SAB “x” ‘y’ … •") : "";
    checar(san && s.includes("\x97") && s.includes("\x93") && s.includes("\x94") && s.includes("\x91") && s.includes("\x92") && s.includes("\x85") && s.includes("\x95"),
      "⛔ PDF: travessão, aspas curvas, reticências e marcador viram WinAnsi (não somem)");
  }

  /* ═══ 4. MÓDULO SAB — a BAIXA ═════════════════════════════════════════════ */
  {
    const src = fs.readFileSync(path.join(SRC, "modulos", "sab.js"), "utf8");
    const abertas = [];
    const ctxVm = {
      console: { log() {}, warn() {}, error() {} }, setTimeout: (fn) => { fn(); return 0; }, URL,
      Store: { get: async () => ({}), set: async () => {} }, CHAVES: { config: "cratos:config" },
      abrirDeterminacaoSab: async (o) => { abertas.push(o); }, abrirOrdemSab: async () => {}, ApiPje: {},
      encodeURIComponent, module: { exports: {} }, btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    };
    ctxVm.globalThis = ctxVm;
    vm.createContext(ctxVm);
    vm.runInContext(fs.readFileSync(ARQ_LEITURA, "utf8"), ctxVm);
    vm.runInContext(src, ctxVm);
    const Mod = ctxVm.module.exports.ModuloSAB;
    const rodar = async (dets, extra, ignorarFiltro) => {
      DETS = dets; abertas.length = 0;
      ctxVm.fetch = fetchFalso({ ignorarFiltro });
      return Mod.executar(Object.assign({ base: "https://pje.trt18.jus.br", numeroProcesso: P1.numero }, extra || {}), "baixa");
    };
    const salvo = DETS;
    const duas = [detResumo(43999, "EM_PROCESSAMENTO", P1, "2026-10-16T09:12:00"), detResumo(43500, "EM_PROCESSAMENTO", P1, "2026-10-20T09:12:00"), detResumo(45000, "EM_PROCESSAMENTO", P2, "2026-10-01T10:00:00")];
    let r = await rodar(duas);
    checar(!r.ok && /2 determinações ativas/.test(r.motivo) && !abertas.length, "⛔ módulo: duas ativas sem escolha → não abre nada, pede a escolha");
    r = await rodar(duas, { sabIdDeterminacao: "43500" });
    checar(r.ok && abertas.length === 1 && abertas[0].idDeterminacao === 43500, "módulo: com a escolha do painel → interrompe a escolhida");
    r = await rodar([detResumo(43999, "INTERROMPIDA", P1, "x"), detResumo(45000, "EM_PROCESSAMENTO", P2, "x")], {}, true);
    checar(!r.ok && /não há determinação ativa para interromper/.test(r.motivo) && !abertas.length,
      "⛔ módulo: nenhuma ativa no processo → avisa (a ativa de OUTRO processo não é usada)");
    r = await rodar([detResumo(43999, "EM_PROCESSAMENTO", P1, "x"), detResumo(43000, "FINALIZADA", P1, "x")]);
    checar(r.ok && abertas[0] && abertas[0].idDeterminacao === 43999, "módulo: uma ativa → ela");
    DETS = salvo;
  }

  /* ═══ 5. PAINEL ═══════════════════════════════════════════════════════════ */
  const { montarPainel } = require("./harness-painel.js");
  const espera = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 4000)) { if (fn()) return true; await new Promise((r) => setTimeout(r, 15)); } return false; };
  /* fundo simulado: diário (com o montarCertidoes REAL) + cofre */
  function fundoSimulado() {
    const itens = [];
    const cofre = [];
    return async (msg) => {
      if (msg.tipo === "fabricar_pdf" || msg.tipo === "sab_registrar_pdf") {
        const nome = msg.filename.split("/").pop();
        itens.push({ convenio: "SAB", operacao: msg.operacao, detalhe: msg.detalhe, grupo: msg.grupo, rotuloGrupo: msg.rotuloGrupo, arquivo: nome });
        cofre.push({ nome, base64: msg.base64 || "JVBERi0=", bytes: 10 });
        return { ok: true, filename: msg.filename };
      }
      if (msg.tipo === "diario_ler") return { ok: true, certidoes: montar({ itens }) };
      if (msg.tipo === "diario_marcar_juntado") {
        const fam = { sab_respostas: "respostas_sab", sab_transferencia: "transferencia_sab" }[msg.familia];
        itens.forEach((x) => { if (x.operacao === fam && (msg.grupo == null || x.grupo === msg.grupo)) x.juntadoEm = "agora"; });
        return { ok: true };
      }
      if (msg.tipo === "cofre_pegar") return { ok: true, arquivos: cofre.slice() };
      return undefined;
    };
  }

  /* 5a. Coletar SAB no processo */
  {
    const f = fetchFalso();
    const e = montarPainel(SRC, { responder: fundoSimulado(), fetch: f });
    const P = e.P;
    if (!P.coletarSab) { checar(false, "painel: não há 'Coletar SAB' nesta versão"); fim(); }
    P.setProcesso({ id: 555, numero: P1.numero });
    P.setPartes([{ nome: "EMPRESA FICTICIA LTDA", cpfcnpj: "00000000000191", polo: "PASSIVO" }]);
    P.renderModoSelecao();
    checar(!!e.d.querySelector("#cx-coletar-sab"), "painel: botão 'Coletar SAB' na tela do processo");
    await P.coletarSab();
    const caixas = Array.from(e.d.querySelectorAll(".cx-sab-det"));
    checar(caixas.length === 2 && caixas.every((c) => c.checked), "painel: seletor com as 2 determinações do processo (minuta e outro processo fora), as duas marcadas");
    e.d.querySelector("#cx-sab-ir").click();
    await espera(() => e.d.querySelector("#cx-sab-juntar"));
    const fab = e.msgs.filter((m) => m.tipo === "fabricar_pdf");
    const reg = e.msgs.filter((m) => m.tipo === "sab_registrar_pdf");
    checar(fab.length === 2 && fab.every((m) => m.desenho && Array.isArray(m.desenho.blocos) && m.convenio === "SAB" && m.operacao === "respostas_sab"),
      "painel: uma certidão desenhada por determinação (convênio SAB, respostas_sab)");
    checar(fab.map((m) => m.grupo).sort().join() === "43000,43999", "painel: grupo = a determinação");
    const regProt = reg.map((m) => m.filename.match(/(\d{14})\.pdf$/)[1]).sort().join();
    checar(regProt === "20260087000001,20260087519703,20260088072394", "⛔ painel: anexa os relatórios novos, inclusive a transferência enviada (o já juntado, o que falhou e o não enviado ficam fora)");
    const cert43999 = JSON.stringify(fab.find((m) => m.grupo === "43999").desenho.blocos);
    checar(/já juntado em 29\/10/.test(cert43999) && /20260086999999 não pôde ser obtido/.test(cert43999), "painel: certidão diz o já juntado e o não obtido");
    const txt = e.d.querySelector("#cx-sab-status").textContent;
    checar(/verificar a garantia do juízo/.test(txt), "painel: alerta de obrigação realizada no resultado");
    checar(!f.chamadas.some((c) => /atividade$/.test(c.caminho)), "painel: GIGS desligado por padrão → nenhuma atividade lançada");
    checar(!f.chamadas.some((c) => /assinar|assinatura|transicoes/i.test(c.caminho)), "⛔ painel (coleta): nada de assinar nem de transição do SAB");
  }

  /* 5b. Baixa com duas ativas: escolha única, nada pré-marcado */
  {
    const salvo = DETS;
    DETS = [detResumo(43999, "EM_PROCESSAMENTO", P1, "2026-10-16T09:12:00"), detResumo(43500, "EM_PROCESSAMENTO", P1, "2026-10-20T09:12:00")];
    const e = montarPainel(SRC, { fetch: fetchFalso() });
    const P = e.P;
    P.setProcesso({ id: 555, numero: P1.numero });
    P.setPartesSelecionadas([{ nome: "EMPRESA FICTICIA LTDA", cpfcnpj: "00000000000191" }]);
    P.setModo("baixa");
    P.renderListaConvenios();
    e.d.querySelectorAll(".cx-sel-conv").forEach((c) => { c.checked = c.dataset.id === "SAB"; });
    const pr = P.executarSelecionados();
    await espera(() => e.d.querySelector('input[name="cx-sab-baixa"]'));
    const radios = Array.from(e.d.querySelectorAll('input[name="cx-sab-baixa"]'));
    checar(radios.length === 2 && radios.every((r) => !r.checked) && e.d.querySelector("#cx-sab-baixa-ok").disabled,
      "⛔ baixa: duas ativas → escolha única, nada pré-marcado, botão travado até escolher");
    checar(!e.msgs.some((m) => m.tipo === "orquestra_executar"), "baixa: a fila não anda antes da escolha");
    radios[1].checked = true; radios[1].dispatchEvent(new e.w.Event("change"));
    e.d.querySelector("#cx-sab-baixa-ok").click();
    await espera(() => e.msgs.some((m) => m.tipo === "orquestra_executar"));
    const ex = e.msgs.find((m) => m.tipo === "orquestra_executar");
    checar(ex && ex.ctx && String(ex.ctx.sabIdDeterminacao) === radios[1].value, "baixa: a escolha vai no ctx para o módulo");
    await Promise.race([pr, new Promise((r) => setTimeout(r, 200))]);
    DETS = salvo;
  }

  /* 5c. Lote do dia (Meu painel) */
  {
    const f = fetchFalso();
    const e = montarPainel(SRC, { responder: fundoSimulado(), fetch: f, mem: { "cratos:config": { sab: { gigsObrigacaoRealizada: { ativo: true } } } } });
    const P = e.P;
    P.renderSemProcesso();
    checar(!!e.d.querySelector("#cx-lote-sab"), "lote: botão 'Coletar respostas SAB' na tela sem processo");
    await P.abrirLoteSab();
    const inp = e.d.querySelector("#cx-lote-dia");
    const hoje = new Date();
    checar(inp && inp.value === L.diaUtilAnterior(hoje), "lote: data já vem no dia útil anterior");
    checar(e.d.querySelector('input[name="cx-lote-modo"][value="resposta"]').checked, "lote: modalidade padrão 'só a resposta'");
    checar(e.d.querySelector("#cx-lote-gigs").checked, "lote: GIGS segue a Preferência (ligada neste cenário)");
    inp.value = "2026-11-12";
    e.d.querySelector("#cx-lote-ir").click();
    await espera(() => /Respostas SAB de 12\/11\/2026/.test(e.d.querySelector("#cx-lote-sab-area").textContent), 8000);
    const txt = e.d.querySelector("#cx-lote-sab-area").textContent;
    checar(/3 processo\(s\) com transferência; 1 com juntada/.test(txt) || /2 processo\(s\) com transferência; 1 com juntada/.test(txt),
      "lote: relatório final com os processos e as juntadas");
    checar(!f.chamadas.some((c) => /determinacoes\/46000\/ordens/.test(c.caminho)), "lote: determinação encerrada antes do dia nem é lida");
    checar(/sem resposta \(não juntado\): 20260088111111/.test(txt) && !/não juntado\): [^\n]*20260088072394/.test(txt), "⛔ lote: transferência ainda NÃO ENVIADA fica fora e aparece no relatório; a ENVIADA é juntada");
    checar(/rascunho/.test(txt) && /00008888820265180008|0000888-88/.test(txt), "lote: processo com rascunho é pulado, com o motivo");
    checar(/20260086999999 não obtido/.test(txt), "⛔ lote: relatório não obtido aparece como falha");
    checar(/verificar garantia do juízo/.test(txt), "lote: alerta de obrigação realizada");
    const metas = f.chamadas.filter((c) => c.metodo === "POST" && /minuta\/A\/metadados$/.test(c.caminho));
    checar(metas.length === 1 && /"tipo":"Sisbajud \(transferência\)"/.test(metas[0].corpo) && /"idTipo":999/.test(metas[0].corpo) && /\/555\//.test(metas[0].caminho),
      "⛔ lote: uma minuta, no processo certo, do tipo 'Sisbajud (transferência)' — achado no catálogo (o processo ainda não tinha nenhum), o ATIVO");
    const anexos = f.chamadas.filter((c) => c.metodo === "POST" && /\/processos\/id\/555\/documentos\/$/.test(c.caminho));
    checar(anexos.length === 3 && anexos.every((c) => /Sisbajud \(transferência\) - 2026/.test(c.corpo)), "lote: anexos com o protocolo no título (base do 'não juntar duas vezes')");
    const gigs = f.chamadas.filter((c) => /pje-gigs-api\/api\/atividade$/.test(c.caminho));
    checar(gigs.length === 1 && /"idProcesso":"555"/.test(gigs[0].corpo), "lote: GIGS (opção ligada) só no processo com obrigação realizada");
    checar(!f.chamadas.some((c) => /assinar|assinatura|transicoes/i.test(c.caminho)), "⛔ lote: o CRATOS nunca assina nem chama transição do SAB");
    checar(!!e.d.querySelector("#cx-lote-assinar"), "lote: oferece a assinatura assistida");
  }

  /* 5d. Juntada que falha: o relatório NÃO diz "juntado" */
  {
    const f = fetchFalso({ semTipo: true });
    const e = montarPainel(SRC, { responder: fundoSimulado(), fetch: f });
    e.P.renderSemProcesso();
    await e.P.abrirLoteSab();
    e.d.querySelector("#cx-lote-dia").value = "2026-11-12";
    e.d.querySelector("#cx-lote-ir").click();
    await espera(() => /Respostas SAB de 12\/11\/2026/.test(e.d.querySelector("#cx-lote-sab-area").textContent), 8000);
    const txt = e.d.querySelector("#cx-lote-sab-area").textContent;
    checar(!/✓ juntado/.test(txt) && /NÃO juntado/.test(txt) && /não achei o tipo de documento "Sisbajud \(transferência\)"/.test(txt) && !e.d.querySelector("#cx-lote-assinar"),
      "⛔ lote: juntada que falha não aparece como 'juntado' (mostra 'NÃO juntado' e o motivo; nada para assinar)");
  }
  fim();
})().catch((e) => { checar(false, "exceção: " + (e && e.stack || e)); fim(); });
