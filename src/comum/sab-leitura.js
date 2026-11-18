/*
 * comum/sab-leitura.js — LEITURA do SAB para as respostas do SISBAJUD (1.9.4, 13/11/2026).
 *
 * Três usos:
 *   1. "Coletar SAB" no processo: certidão consolidada por determinação (desenho do
 *      SNIPER) + os relatórios de detalhamento das ordens COM TRANSFERÊNCIA;
 *   2. "Coletar respostas SAB" em lote (Meu painel): as ordens com transferência cujo
 *      último protocolo caiu no dia escolhido — o mesmo recorte do relatório SAO18-SAB2
 *      do SAO, conferido em 6, 9, 10, 11 e 12/11 —, sem depender do SAO;
 *   3. a BAIXA do SAB: qual determinação interromper (nunca adivinhar entre duas).
 *
 * SÓ LEITURA. Os endereços são GET da API do próprio SAB, na mesma origem do PJe, com
 * a sessão do navegador (cookie). Nenhum token é lido; nenhuma transição é chamada —
 * `/transicoes` (Interromper etc.) não aparece aqui de propósito.
 *
 * REGRA DE FERRO: ordem sem resposta é "aguardando", nunca "nada bloqueado"; PDF que
 * não veio é "não obtido", nunca omitido em silêncio.
 *
 * As funções de modelo e de desenho são puras (testáveis no Node). O cliente da API
 * recebe o `fetch` por injeção.
 */
(function () {
  "use strict";
  if (globalThis.CratosSabLeitura) return;

  const API = "/sab-api/api";
  const PAGINAS_MAX = 60;           // 100 por página → 6.000 itens: folga larga

  /* ═══ FORMATOS ═══ */
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const dig = (s) => String(s == null ? "" : s).replace(/\D/g, "");
  const centavos = (v) => Math.round(num(v) * 100);
  function reais(v) {
    const c = centavos(v), neg = c < 0, a = Math.abs(c);
    const int = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return `${neg ? "-" : ""}R$ ${int},${String(a % 100).padStart(2, "0")}`;
  }
  function docFmt(d) {
    const s = dig(d);
    if (s.length === 11) return `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9)}`;
    if (s.length === 14) return `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-${s.slice(12)}`;
    return String(d == null ? "" : d);
  }
  function numeroCnj(n) {
    const s = dig(n);
    return s.length === 20 ? `${s.slice(0, 7)}-${s.slice(7, 9)}.${s.slice(9, 13)}.${s.slice(13, 14)}.${s.slice(14, 16)}.${s.slice(16)}` : String(n || "");
  }
  const norm = (s) => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ").trim().toLowerCase();

  /* Data do SAB/PJe → hora de Brasília. Sem fuso ("2026-11-12T10:38:00") já é a hora
     local do servidor; com fuso (Z / ±hh:mm), converte para -03:00 (sem horário de
     verão desde 2019). Devolve null se não reconhecer — e quem chama decide. */
  function dataLocal(v) {
    if (v == null || v === "") return null;
    const s = String(v);
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/);
    if (!m) {
      const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
      if (!br) return null;
      m = [null, br[3], br[2], br[1], br[4], br[5], null, null];
    }
    let [, a, me, d, h, mi] = m;
    if (m[7]) {
      const t = Date.parse(s);
      if (!Number.isFinite(t)) return null;
      const x = new Date(t - 3 * 3600 * 1000);
      a = String(x.getUTCFullYear()); me = String(x.getUTCMonth() + 1).padStart(2, "0");
      d = String(x.getUTCDate()).padStart(2, "0");
      h = String(x.getUTCHours()).padStart(2, "0"); mi = String(x.getUTCMinutes()).padStart(2, "0");
    }
    const hm = h != null ? `${h}:${mi}` : "";
    return { ymd: `${a}-${me}-${d}`, dmy: `${d}/${me}/${a}`, dm: `${d}/${me}`, hm, dmyhm: hm ? `${d}/${me}/${a} ${hm}` : `${d}/${me}/${a}` };
  }
  /* "Agora" em Brasília, a partir de um Date (injeção para teste). */
  function agoraLocal(agora) {
    const t = agora instanceof Date || (agora && typeof agora.getTime === "function") ? agora.getTime() : Date.now();
    return dataLocal(new Date(t).toISOString());
  }

  /* Dia útil anterior — só fim de semana (feriado fica com quem usa: o campo é editável). */
  function diaUtilAnterior(ymdOuDate) {
    let a, m, d;
    if (typeof ymdOuDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(ymdOuDate)) [a, m, d] = ymdOuDate.split("-").map(Number);
    else { const l = agoraLocal(ymdOuDate); [a, m, d] = l.ymd.split("-").map(Number); }
    const x = new Date(Date.UTC(a, m - 1, d));
    do { x.setUTCDate(x.getUTCDate() - 1); } while (x.getUTCDay() === 0 || x.getUTCDay() === 6);
    return x.toISOString().slice(0, 10);
  }

  /* ═══ SITUAÇÕES ═══ */
  const SIT_DET = {
    EM_PROCESSAMENTO: { texto: "em processamento", tom: "andamento" },
    AUTORIZADA: { texto: "autorizada", tom: "andamento" },
    FINALIZADA: { texto: "finalizada", tom: "ok" },
    INTERROMPIDA: { texto: "interrompida", tom: "vazio" },
    CANCELADA: { texto: "cancelada", tom: "vazio" },
    MINUTA: { texto: "minuta", tom: "vazio" },
  };
  const rotuloSit = (s) => (SIT_DET[s] || { texto: String(s || "?").toLowerCase().replace(/_/g, " "), tom: "vazio" });
  const HIST = {
    MINUTA: "minuta em", AUTORIZADA: "autorizada em", EM_PROCESSAMENTO: "em processamento desde",
    FINALIZADA: "finalizada em", INTERROMPIDA: "interrompida em", CANCELADA: "cancelada em",
  };
  const SIT_ORDEM = {
    RESPONDIDA: { texto: "respondida", tom: "ok" },
    ENVIADA: { texto: "aguardando", tom: "andamento" },
    NAO_ENVIADA: { texto: "não enviada", tom: "vazio" },
  };
  const TIPO_ORDEM = { BLOQUEIO_DE_VALOR: "Bloqueio", DESDOBRAMENTO_BLOQUEIO_VALORES: "Desdobramento" };

  /* Ativa = pode ser interrompida. Lista NEGATIVA de propósito: situação nova que o SAB
     inventar aparece para a pessoa escolher, em vez de sumir. */
  function ehAtiva(sit) {
    const s = String(sit || "").toUpperCase();
    return !!s && !/MINUTA|FINALIZ|INTERROMP|CANCEL/.test(s);
  }

  /* BAIXA: qual determinação interromper. Nunca escolhe entre duas. */
  function escolherDeterminacaoBaixa(lista, idEscolhido) {
    const ativas = (Array.isArray(lista) ? lista : []).filter((d) => d && d.id != null && ehAtiva(d.situacao));
    if (idEscolhido != null && idEscolhido !== "") {
      const a = ativas.find((d) => String(d.id) === String(idEscolhido));
      return a ? { id: a.id, situacao: a.situacao } : { erro: "escolhida_inativa", ativas };
    }
    if (!ativas.length) return { erro: "nenhuma", ativas };
    if (ativas.length > 1) return { erro: "varias", ativas };
    return { id: ativas[0].id, situacao: ativas[0].situacao };
  }

  /* COLETA no processo: o que aparece no seletor. MINUTA fica de fora (não rodou);
     marcadas de saída: as ativas e as que têm transferência ainda não juntada. */
  function candidatasColeta(lista, novasPorDet) {
    const novas = novasPorDet || {};
    return (Array.isArray(lista) ? lista : [])
      .filter((d) => d && d.id != null && String(d.situacao || "").toUpperCase() !== "MINUTA")
      .map((d) => ({
        id: d.id, situacao: d.situacao, rotulo: rotuloSit(d.situacao).texto,
        novas: num(novas[d.id]),
        desde: dataLocal((d.ultimaSituacao && d.ultimaSituacao.ocorridoEm) || d.dataAutorizacao),
        marcada: ehAtiva(d.situacao) || num(novas[d.id]) > 0,
      }))
      .sort((a, b) => (Number(b.marcada) - Number(a.marcada)) || (Number(b.id) - Number(a.id)));
  }

  /* ═══ O QUE JÁ ESTÁ NOS AUTOS ═══
     Os anexos que o CRATOS junta levam o protocolo no título; o índice acha o protocolo
     em qualquer documento ou anexo ativo da timeline. Documento do tipo "Sisbajud
     (transferência)" SEM protocolo (juntado à mão ou pelo SABRe) não prova qual ordem
     é — vira "possível duplicidade" para as ordens até aquela data. */
  const RE_PROTOCOLO = /(?:^|\D)(20\d{12})(?!\d)/g;
  function indiceJuntados(timeline) {
    const lista = Array.isArray(timeline) ? timeline : (timeline && timeline.resultado) || [];
    const porProtocolo = {};
    const semProtocolo = [];
    const visitar = (doc) => {
      if (!doc || doc.ativo === false) return;
      const titulo = String(doc.titulo || "");
      const data = dataLocal(doc.data);
      let achou = false;
      RE_PROTOCOLO.lastIndex = 0;
      let m;
      while ((m = RE_PROTOCOLO.exec(titulo))) {
        achou = true;
        const atual = porProtocolo[m[1]];
        if (!atual || (data && atual.ymd > data.ymd)) porProtocolo[m[1]] = data || { ymd: "", dm: "" };
      }
      if (!achou && norm(doc.tipo) === "sisbajud (transferencia)" && data) semProtocolo.push(data);
    };
    for (const d of lista) {
      visitar(d);
      for (const a of (d && Array.isArray(d.anexos) ? d.anexos : [])) visitar(a);
    }
    return { porProtocolo, semProtocolo };
  }
  function situacaoNosAutos(indice, protocolo, dataOrdem) {
    if (!indice) return null;
    const p = String(protocolo || "");
    if (p && indice.porProtocolo[p]) return { ja: true, em: indice.porProtocolo[p].dm || "" };
    const d = dataLocal(dataOrdem);
    if (d) {
      /* 1.9.6: DATA E HORA. Só a data fazia o "Sisbajud (transferência)" juntado de manhã
         (a resposta de uma ordem anterior, rotina da vara) passar por duplicata de uma
         ordem protocolada à tarde do mesmo dia (bug de campo, 13/11). */
      const ch = (x) => x.ymd + " " + (x.hm || "00:00");
      const alvo = ch(d);
      const depois = indice.semProtocolo.filter((x) => (x.hm && d.hm ? ch(x) > alvo : x.ymd >= d.ymd))
        .sort((a, b) => (ch(a) < ch(b) ? -1 : 1));
      if (depois.length) return { possivel: true, em: depois[0].dm };
    }
    return null;
  }

  /* ═══ MODELO DE UMA DETERMINAÇÃO ═══ */
  function somaOrdem(o) {
    const bl = Array.isArray(o && o.bloqueios) ? o.bloqueios : [];
    return {
      alvo: bl.reduce((mx, b) => Math.max(mx, num(b.valorAplicado)), 0),
      bloqueado: bl.reduce((s, b) => s + num(b.valorBloqueado), 0),
      transferido: bl.reduce((s, b) => s + num(b.valorTransferido), 0),
    };
  }
  const comTransferencia = (o) => centavos(somaOrdem(o).transferido) > 0;
  /* O QUE SE JUNTA (Rodrigo, 13/11): a resposta com transferência, AINDA QUE o banco não
     tenha respondido — o relatório da ordem de transferência (desdobramento) já enviada é
     o documento em que a vara intima a parte ("é isso que eu quero, essa resposta, ainda
     que esteja aguardando resposta"). Respondida: sempre. Desdobramento ENVIADO: também.
     Bloqueio ainda sem resposta e qualquer ordem NÃO ENVIADA: não — aí não há resultado. */
  const ehDesdobramento = (o) => String((o && o.tipoOrdem) || "") === "DESDOBRAMENTO_BLOQUEIO_VALORES";
  function ordemJuntavel(o) {
    if (!comTransferencia(o)) return false;
    const s = String((o && o.situacao) || "");
    return s === "RESPONDIDA" || (s === "ENVIADA" && ehDesdobramento(o));
  }
  const dataDaOrdem = (o) => (o && (o.dataUltimoProtocolo || o.dataProtocolo)) || null;

  function obrigacaoRealizada(det) {
    const obs = Array.isArray(det && det.obrigacoes) ? det.obrigacoes : [];
    if (!obs.length) return false;
    const rem = obs.reduce((s, o) => s + num(o.valorRemanescente), 0);
    return obs.every((o) => o.realizada === true) || centavos(rem) <= 0;
  }

  function modelo(det, situacoes, ordens) {
    const d = det || {};
    const obs = Array.isArray(d.obrigacoes) ? d.obrigacoes : [];
    const executados = (Array.isArray(d.executados) ? d.executados : []).map((ex) => {
      const id = ex && ex.id;
      const minhas = obs.filter((o) => (o.obrigacoesExecutados || []).some((oe) => oe && oe.executado && oe.executado.id === id));
      return {
        nome: (ex && ex.pessoa && ex.pessoa.nome) || "(sem nome)",
        doc: docFmt(ex && ex.pessoa && ex.pessoa.numeroDocumento),
        valorExecucao: minhas.reduce((s, o) => s + num(o.valorReferencia), 0),
        realizado: minhas.reduce((s, o) => s + (o.obrigacoesExecutados || [])
          .filter((oe) => oe && oe.executado && oe.executado.id === id)
          .reduce((t, oe) => t + num(oe.valorRealizado), 0), 0),
      };
    });
    const hist = (Array.isArray(situacoes) ? situacoes : []).slice()
      .filter((s) => s && s.situacao)
      .sort((a, b) => String(a.ocorridoEm || "").localeCompare(String(b.ocorridoEm || "")))
      .map((s) => {
        const dt = dataLocal(s.ocorridoEm);
        const rot = HIST[s.situacao] || `${rotuloSit(s.situacao).texto} em`;
        return dt ? `${rot} ${dt.dmy}, ${dt.hm}`.replace(/, $/, "") : rot;
      });
    const linhas = (Array.isArray(ordens) ? ordens : []).filter(Boolean).map((o) => {
      const s = somaOrdem(o);
      const dt = dataLocal(dataDaOrdem(o));
      return {
        id: o.id, protocolo: String(o.numeroProtocolo || o.codigo || ""), data: dt, dataBruta: dataDaOrdem(o),
        tipo: TIPO_ORDEM[o.tipoOrdem] || String(o.tipoOrdem || "").toLowerCase().replace(/_/g, " "),
        situacao: String(o.situacao || ""), respondida: String(o.situacao || "") === "RESPONDIDA",
        transfEnviada: String(o.situacao || "") === "ENVIADA" && ehDesdobramento(o), juntavel: ordemJuntavel(o),
        alvo: s.alvo, bloqueado: s.bloqueado, transferido: s.transferido, comTransferencia: centavos(s.transferido) > 0,
      };
    }).sort((a, b) => String(b.dataBruta || "").localeCompare(String(a.dataBruta || "")));
    const rep = d.repeticaoProgramada;
    return {
      id: d.id,
      situacao: d.situacao,
      processo: (d.processo && d.processo.numero) || "",
      exequente: d.exequente ? `${d.exequente.nome || ""}${d.exequente.numeroDocumento ? ` - ${dig(d.exequente.numeroDocumento).length === 14 ? "CNPJ" : "CPF"} ${docFmt(d.exequente.numeroDocumento)}` : ""}` : "",
      juiz: d.nomeMagistrado || "",
      valorTotal: d.valorTotalObrigacao,
      repeticao: rep === true || (rep && typeof rep === "object" && rep.ativa !== false) ? "Repetição programada (teimosinha)" : rep === false ? "Sem repetição programada" : "",
      historico: hist.length ? hist.join("; ").replace(/^./, (c) => c.toUpperCase()) : "",
      executados,
      remanescente: obs.reduce((s, o) => s + num(o.valorRemanescente), 0),
      temObrigacoes: obs.length > 0,
      realizada: obrigacaoRealizada(d),
      ordens: linhas,
    };
  }

  /* ═══ A CERTIDÃO, EM BLOCOS (desenho do SNIPER, comum/grafo-sniper.js) ═══
     `anexos`: { [protocolo]: { n } | { ja, em } | { falhou } | { possivel, em } } —
     o que aconteceu com o relatório de cada ordem com transferência. */
  const ALERTA_REALIZADA = "Obrigação realizada no SAB (remanescente R$ 0,00): verificar a garantia do juízo.";
  function certidaoBlocos(m, opts) {
    const o = opts || {};
    const ag = agoraLocal(o.agora);
    const anexos = o.anexos || {};
    const proc = numeroCnj(o.numProcesso || m.processo);
    const sit = rotuloSit(m.situacao);
    const kv = [];
    if (m.exequente) kv.push(["Exequente", m.exequente]);
    if (m.juiz) kv.push(["Juiz solicitante", m.juiz]);
    if (m.valorTotal != null) kv.push(["Valor total das obrigações", reais(m.valorTotal)]);
    if (m.repeticao) kv.push(["Repetição", m.repeticao]);
    if (m.historico) kv.push(["Histórico", m.historico]);
    const B = [
      { t: "par", texto: `Certifico e dou fé que, nesta data (${ag.dmy}, às ${ag.hm}), consultei no SAB (Sistema de Busca e Bloqueio de Ativos Financeiros) a determinação de bloqueio nº ${m.id} do processo nº ${proc}, com a posição abaixo.` },
      { t: "espaco" },
      { t: "secao", texto: `Determinação nº ${m.id}`, selo: { texto: sit.texto, tom: sit.tom } },
      { t: "kv", pares: kv },
      { t: "secao", texto: "Executados" },
      { t: "tabela", colunas: [{ titulo: "Executado", peso: 5 }, { titulo: "CPF/CNPJ", peso: 3 }, { titulo: "Valor da execução", peso: 2.4 }, { titulo: "Realizado (SAB)", peso: 2.2 }],
        linhas: m.executados.map((e) => [e.nome, e.doc, reais(e.valorExecucao), reais(e.realizado)]) },
    ];
    if (m.temObrigacoes) {
      B.push({ t: "par", tom: "nota", texto: `Remanescente da obrigação, segundo o SAB: ${reais(m.remanescente)}. Os valores por executado são os apurados pelo próprio SAB (não há soma do CRATOS: numa teimosinha, o desdobramento movimenta o que uma ordem anterior bloqueou).` });
    }
    if (m.realizada) B.push({ t: "par", tom: "alerta", texto: ALERTA_REALIZADA });

    const rotAnexo = (l) => {
      const a = anexos[l.protocolo];
      if (!l.comTransferencia || !a) return "";
      if (a.n) return String(a.n);
      if (a.ja) return `já juntado${a.em ? ` em ${a.em}` : ""}`;
      if (a.possivel) return "conferir";
      if (a.falhou) return "não obtido";
      return "";
    };
    B.push({ t: "secao", texto: `Ordens de bloqueio (${m.ordens.length})` });
    B.push({ t: "tabela",
      colunas: [{ titulo: "Protocolo", peso: 3.1 }, { titulo: "Data", peso: 2.6 }, { titulo: "Tipo", peso: 2.6 }, { titulo: "Situação", peso: 2.3 }, { titulo: "Alvo", peso: 2.4 }, { titulo: "Bloqueado", peso: 2.2 }, { titulo: "Transferido", peso: 2.2 }, { titulo: "Anexo", peso: 1.9 }],
      linhas: m.ordens.map((l) => [l.protocolo, l.data ? l.data.dmyhm : "", l.tipo,
        l.transfEnviada ? { texto: "transf. enviada", tom: "andamento" } : SIT_ORDEM[l.situacao] || { texto: String(l.situacao || "?").toLowerCase().replace(/_/g, " "), tom: "vazio" },
        centavos(l.alvo) > 0 ? reais(l.alvo) : "—", l.respondida || l.transfEnviada ? reais(l.bloqueado) : "—", l.respondida || l.transfEnviada ? reais(l.transferido) : "—", rotAnexo(l)]) });
    if (m.ordens.some((l) => l.transfEnviada)) {
      B.push({ t: "par", tom: "nota", texto: "\"Transf. enviada\": ordem de transferência já protocolada no SISBAJUD, com o valor indicado; a confirmação da instituição financeira ainda não constava do SAB no momento desta certidão." });
    }
    if (m.ordens.some((l) => !l.respondida && !l.transfEnviada)) {
      B.push({ t: "par", tom: "nota", texto: "\"Aguardando\": ordem enviada ao SISBAJUD e ainda não respondida no momento desta certidão; não representa resultado (nem positivo nem negativo). \"Não enviada\": ordem registrada no SAB e ainda não enviada ao SISBAJUD." });
    }
    const anexadas = m.ordens.filter((l) => l.comTransferencia && anexos[l.protocolo] && anexos[l.protocolo].n)
      .sort((a, b) => anexos[a.protocolo].n - anexos[b.protocolo].n);
    B.push({ t: "secao", texto: `Anexos: ordens com transferência de valores (${anexadas.length})` });
    if (anexadas.length) {
      B.push({ t: "tabela", colunas: [{ titulo: "Anexo", peso: 1 }, { titulo: "Ordem (protocolo)", peso: 3 }, { titulo: "Data", peso: 2.4 }, { titulo: "Transferido", peso: 2.4 }, { titulo: "Documento", peso: 4.6 }],
        linhas: anexadas.map((l) => [String(anexos[l.protocolo].n), l.protocolo, l.data ? l.data.dmy : "", reais(l.transferido), "Relatório de detalhamento (SISBAJUD, obtido pelo SAB)"]) });
      B.push({ t: "par", tom: "nota", texto: "Os valores por instituição financeira constam dos relatórios anexos." });
    } else {
      B.push({ t: "par", tom: "nota", texto: "Nenhum relatório anexado a esta certidão." });
    }
    const com = m.ordens.filter((l) => l.comTransferencia);
    const ja = com.filter((l) => anexos[l.protocolo] && anexos[l.protocolo].ja);
    const conf = com.filter((l) => anexos[l.protocolo] && anexos[l.protocolo].possivel);
    const falhou = com.filter((l) => anexos[l.protocolo] && anexos[l.protocolo].falhou);
    if (ja.length) B.push({ t: "par", tom: "nota", texto: `Já constam dos autos, e por isso não foram anexados de novo, os relatórios das ordens ${ja.map((l) => l.protocolo).join(", ")}.` });
    if (conf.length) B.push({ t: "par", tom: "nota", texto: `Há nos autos documento "Sisbajud (transferência)" sem o número da ordem, juntado depois da ordem ${conf.map((l) => l.protocolo).join(", ")}; para não duplicar, o relatório não foi anexado: conferir.` });
    if (falhou.length) B.push({ t: "par", tom: "alerta", texto: `O relatório de detalhamento da(s) ordem(ns) ${falhou.map((l) => l.protocolo).join(", ")} não pôde ser obtido do SAB nesta consulta (falha técnica, não resultado). Colete de novo.` });
    B.push({ t: "espaco" });
    /* Num parágrafo só: o "Era o que me cumpria certificar." não fica sozinho na página. */
    B.push({ t: "par", texto: "A consulta foi feita pelo CRATOS, a pedido do(a) responsável por este ato. Era o que me cumpria certificar." });

    const meta = { titulo: "Certidão — SAB/SISBAJUD: posição consolidada das ordens", processo: proc,
      rotuloId: `Determinação nº ${m.id}`, origem: "SAB", consultaEm: o.agora ? new Date(o.agora.getTime()).toISOString() : new Date().toISOString() };
    return { blocos: B, meta, linhas: blocosEmLinhas(B) };
  }

  /* Reserva em texto corrido (se o desenho falhar, o fundo usa `linhas`). */
  function blocosEmLinhas(B) {
    const out = [];
    for (const b of B) {
      if (b.t === "par") out.push(b.texto, "");
      else if (b.t === "secao") out.push(`${b.texto}${b.selo ? ` (${b.selo.texto})` : ""}`);
      else if (b.t === "kv") for (const [k, v] of b.pares) out.push(`${k}: ${v}`);
      else if (b.t === "tabela") {
        out.push(b.colunas.map((c) => c.titulo).join(" | "));
        for (const l of b.linhas) out.push(l.map((c) => (c && typeof c === "object" ? c.texto : c)).join(" | "));
        out.push("");
      }
    }
    return out;
  }

  /* ═══ LOTE ═══ */
  /* Ordens com transferência cujo ÚLTIMO protocolo caiu no dia (data de Brasília). */
  function ordensDoDia(ordens, ymd) {
    return (Array.isArray(ordens) ? ordens : []).filter((o) => {
      if (!comTransferencia(o)) return false;
      const d = dataLocal(o.dataUltimoProtocolo || o.dataProtocolo);
      return !!d && d.ymd === ymd;
    });
  }
  /* Uma entrada por processo, na ordem do número. */
  function agruparPorProcesso(itens) {
    const mapa = new Map();
    for (const it of itens || []) {
      const p = (it.ordem && it.ordem.processo) || (it.det && it.det.processo) || {};
      const k = dig(p.numero);
      if (!k) continue;
      if (!mapa.has(k)) mapa.set(k, { numero: k, idPJe: p.idPJe || null, itens: [] });
      const g = mapa.get(k);
      if (!g.idPJe && p.idPJe) g.idPJe = p.idPJe;
      g.itens.push(it);
    }
    return [...mapa.values()].sort((a, b) => (a.numero < b.numero ? -1 : 1));
  }

  /* ═══ NOMES DE ARQUIVO ═══ (o protocolo no nome é o que permite não juntar duas vezes) */
  const pastaSegura = (p) => String(p || "CRATOS").replace(/[\\:*?"<>|]/g, "").replace(/\.\./g, "")
    .split("/").map((x) => x.trim()).filter(Boolean).join("/") || "CRATOS";
  const nomeDetalhamento = (numProcesso, protocolo, pasta) =>
    `${pastaSegura(pasta)}/${dig(numProcesso)}_Sisbajud (transferência) - ${dig(protocolo)}.pdf`;
  const nomeCertidao = (numProcesso, idDet, pasta) =>
    `${pastaSegura(pasta)}/${dig(numProcesso)}_SAB determinacao ${dig(idDet)} certidao.pdf`;

  /* ═══ CLIENTE DA API (só GET) ═══ */
  function bytesParaBase64(u8) {
    let s = "";
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function cliente(opcoes) {
    const o = opcoes || {};
    const base = o.base || (typeof location !== "undefined" ? location.origin : "");
    const f = o.fetch || ((...a) => fetch(...a));
    /* 1.9.7: X-XSRF-TOKEN, como o PJe faz (o TRT19 recusa leitura sem ele). No fundo, vem
       em `o.xsrf`; na página, do cookie, lido a cada chamada. */
    const cabecalhos = () => {
      const x = o.xsrf != null ? o.xsrf : (globalThis.CratosPje ? globalThis.CratosPje.xsrfDaPagina() : "");
      if (globalThis.CratosPje) return globalThis.CratosPje.cabecalhosLeitura(x);
      const h = { Accept: "application/json" };
      if (x) { try { h["X-XSRF-TOKEN"] = decodeURIComponent(x); } catch (e) { h["X-XSRF-TOKEN"] = String(x); } }
      return h;
    };
    async function json(caminho) {
      const r = await f(base + caminho, { headers: cabecalhos(), credentials: "include" });
      if (!r.ok) throw new Error(`o SAB respondeu ${r.status} (${caminho.split("?")[0]})`);
      return r.json();
    }
    async function paginado(caminho, filtro) {
      const sep = caminho.indexOf("?") >= 0 ? "&" : "?";
      const tudo = [];
      for (let p = 1; p <= PAGINAS_MAX; p++) {
        const r = await json(`${caminho}${sep}pagina=${p}&tamanhoPagina=100${filtro || ""}`);
        const lista = (r && (r.resultado || r.content)) || (Array.isArray(r) ? r : []);
        tudo.push(...lista);
        const qtd = Number(r && r.qtdPaginas);
        if (!lista.length || !(qtd > p)) break;
      }
      return tudo;
    }
    return {
      async processoPorNumero(numero) {
        const alvo = dig(numero);
        const r = await json(`${API}/processos?pagina=1&tamanhoPagina=10&numeroProcesso=${encodeURIComponent(numero)}`);
        return ((r && r.resultado) || []).find((x) => dig(x.numero) === alvo) || null;
      },
      async determinacoesDoProcesso(idSab) {
        const lista = await paginado(`${API}/determinacoes`, `&idProcesso=${encodeURIComponent(idSab)}`);
        /* Se o filtro fosse ignorado, viriam as do órgão inteiro: confere quando dá. */
        return lista.filter((d) => !(d && d.processo && d.processo.id != null) || String(d.processo.id) === String(idSab));
      },
      todasDeterminacoes() { return paginado(`${API}/determinacoes`); },
      determinacao(id) { return json(`${API}/determinacoes/${encodeURIComponent(id)}`); },
      situacoes(id) { return json(`${API}/determinacoes/${encodeURIComponent(id)}/situacoes`); },
      ordens(id, resolucao) {
        return paginado(`${API}/determinacoes/${encodeURIComponent(id)}/ordens`, resolucao ? `&resolucaoBloqueio=${encodeURIComponent(resolucao)}` : "");
      },
      ordemPorProtocolo(p) { return json(`${API}/ordens/protocolo/${encodeURIComponent(dig(p))}`); },
      async timeline(idPJe) {
        const r = await f(`${base}/pje-comum-api/api/processos/id/${encodeURIComponent(idPJe)}/timeline?buscarMovimentos=false&buscarDocumentos=true`,
          { headers: cabecalhos(), credentials: "include" });
        if (!r.ok) throw new Error(`o PJe respondeu ${r.status} (timeline)`);
        return r.json();
      },
      async pdfOrdem(idOrdem) {
        const r = await f(`${base}${API}/ordens/${encodeURIComponent(idOrdem)}/relatorio-detalhamento-sisbajud`,
          { headers: Object.assign(cabecalhos(), { Accept: "application/pdf" }), credentials: "include" });
        if (!r.ok) throw new Error(`o SAB respondeu ${r.status} ao relatório da ordem`);
        const u8 = new Uint8Array(await r.arrayBuffer());
        if (u8.length < 5 || String.fromCharCode(...u8.subarray(0, 5)) !== "%PDF-") throw new Error("o SAB não devolveu um PDF");
        return bytesParaBase64(u8);
      },
    };
  }

  const api = {
    cliente, dataLocal, agoraLocal, diaUtilAnterior, reais, docFmt, numeroCnj,
    ehAtiva, escolherDeterminacaoBaixa, candidatasColeta, rotuloSit,
    indiceJuntados, situacaoNosAutos, comTransferencia, ordemJuntavel, somaOrdem, obrigacaoRealizada,
    modelo, certidaoBlocos, blocosEmLinhas, ordensDoDia, agruparPorProcesso,
    nomeDetalhamento, nomeCertidao, bytesParaBase64, ALERTA_REALIZADA,
  };
  globalThis.CratosSabLeitura = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
