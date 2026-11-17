/*
 * comum/situacao.js — SITUAÇÃO DO PROCESSO (2.0, plano aprovado pelo Rodrigo em 16/11/2026).
 *
 * Uma linha por convênio em uso, dizendo em que pé ele está NAQUELE processo. Nada é
 * guardado aqui: a função é pura e monta a linha na hora, a partir de quatro fontes.
 *
 *  1. pendências de configuração (Preferências);
 *  2. a aba atual: o que está pronto para juntar (diário/Cofre) e o que falhou;
 *  3. o SAB ao vivo (transferência respondida e ainda não juntada);
 *  4. os eventos do processo: o histórico SEM DADO DE PARTE (convênio, fase, data)
 *     e a linha do tempo do PJe (o que o próprio CRATOS juntou nos autos).
 *
 * REGRA DE FERRO NA TELA: falha técnica é "não obtido", nunca resposta negativa. E
 * sem nenhum registro o selo diz "sem registro do CRATOS", NUNCA "nada pedido": o
 * CRATOS só reconhece o que ele mesmo fez ou juntou; alguém pode ter feito à mão.
 *
 * Eventos: { convenio, fase, em, juntado }
 *   fase: "pedido" | "resposta" | "inclusao" | "baixa" | "consulta" | "indisponivel"
 */
(function () {
  "use strict";
  if (globalThis.CratosSituacao) return;

  const NOMES = {
    SAB: "SAB (SISBAJUD)", INFOJUD: "INFOJUD", RENAJUD: "RENAJUD", CNIB: "CNIB",
    CENSEC: "CENSEC", SERASAJUD: "SerasaJUD", CCS: "CCS", SNIPER: "SNIPER", PREVJUD: "PREVJUD",
  };
  /* Convênios cuja resposta chega depois do pedido: pedido sem resposta = "aguardando". */
  const DIFERIDOS = ["INFOJUD", "CCS", "PREVJUD"];
  const RE_CONV = /\b(SAB|SISBAJUD|RENAJUD|CNIB|CENSEC|SERASAJUD|CCS|INFOJUD|PREVJUD|SNIPER)\b/i;

  function norm(s) {
    return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  }
  function idConv(s) {
    const u = String(s || "").toUpperCase();
    return u === "SISBAJUD" ? "SAB" : u;
  }
  function dm(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0");
  }

  /* A fase de um anexo do CRATOS nos autos, pela família (título da certidão-mãe) e
     pelo nome do arquivo (o anexo leva o nome do arquivo sem ".pdf"). */
  function faseDoAnexo(conv, tituloMae, tituloAnexo) {
    const mae = norm(tituloMae), a = norm(tituloAnexo);
    if (mae.indexOf("indisponiv") >= 0) return "indisponivel";
    if (mae.indexOf("cancelamento") >= 0) return "baixa";
    if (conv === "SAB" && (mae.indexOf("respostas do sab") >= 0 || mae.indexOf("sisbajud (transferencia)") >= 0)) return "resposta";
    if (conv === "CCS") return a.indexOf("detalhamento") >= 0 ? "resposta" : "pedido";
    if (conv === "PREVJUD") return a.indexOf("coleta") >= 0 ? "resposta" : "pedido";
    if (conv === "INFOJUD") return "consulta";       // a fase do INFOJUD vem do histórico
    if (conv === "CENSEC" || conv === "SNIPER") return "consulta";
    if (mae.indexOf("convenios realizados") >= 0) return "inclusao";
    return null;
  }

  /* Linha do tempo do PJe → eventos. Só documentos e anexos ATIVOS. Um anexo sem nome
     de convênio é ignorado (não é do CRATOS ou não dá para saber de qual convênio é). */
  function eventosDosAutos(timeline) {
    const lista = Array.isArray(timeline) ? timeline : (timeline && timeline.resultado) || [];
    const ev = [];
    for (const doc of lista) {
      if (!doc || doc.ativo === false) continue;
      const titulo = String(doc.titulo || doc.tipo || "");
      const anexos = Array.isArray(doc.anexos) ? doc.anexos : [];
      if (norm(doc.tipo) === "sisbajud (transferencia)" && !anexos.length) {
        ev.push({ convenio: "SAB", fase: "resposta", em: doc.data, juntado: true, origem: "autos" });
      }
      for (const a of anexos) {
        if (!a || a.ativo === false) continue;
        const m = String(a.titulo || "").match(RE_CONV);
        if (!m) continue;
        const conv = idConv(m[1]);
        const fase = faseDoAnexo(conv, titulo + " " + (doc.tipo || ""), a.titulo);
        if (fase) ev.push({ convenio: conv, fase, em: a.data || doc.data, juntado: true, origem: "autos" });
      }
    }
    return ev;
  }

  const ROTULO = {
    pendente: "configuração pendente", pronto: "para juntar", naoobtido: "não obtido",
    aguardando: "aguardando", juntado: "juntado", incluido: "incluído", baixado: "baixado",
    consultado: "consultado", indisponivel: "indisponível", semregistro: "sem registro do CRATOS",
  };

  /* O estado de UM convênio. Ordem de prioridade: o que pede ação primeiro. */
  function estadoDe(conv, f) {
    const pend = f.pendencias && f.pendencias[conv];
    if (pend) return { estado: "pendente", detalhe: String(pend) };
    const prontos = (f.sessao && f.sessao.prontos && f.sessao.prontos[conv]) || 0;
    if (prontos) return { estado: "pronto", detalhe: prontos === 1 ? "1 documento pronto para juntar" : prontos + " documentos prontos para juntar", n: prontos };
    const falha = f.sessao && f.sessao.falhas && f.sessao.falhas[conv];
    if (falha) return { estado: "naoobtido", detalhe: String(falha) };
    if (conv === "SAB" && f.sab && f.sab.paraJuntar) {
      const n = f.sab.paraJuntar;
      return { estado: "pronto", detalhe: n === 1 ? "1 transferência respondida, ainda não juntada" : n + " transferências respondidas, ainda não juntadas", n };
    }
    const evs = (f.eventos || []).filter((e) => idConv(e.convenio) === conv && !isNaN(Date.parse(e.em)))
      .sort((a, b) => Date.parse(a.em) - Date.parse(b.em));
    if (conv === "SAB" && f.sab && f.sab.aguardando) {
      return { estado: "aguardando", detalhe: f.sab.aguardando === 1 ? "1 ordem aguardando o banco" : f.sab.aguardando + " ordens aguardando o banco" };
    }
    if (!evs.length) return { estado: "semregistro", detalhe: "Nada feito ou juntado por ele neste processo" };
    const ult = evs[evs.length - 1];
    const quando = dm(ult.em);
    if (DIFERIDOS.indexOf(conv) >= 0) {
      const ultPedido = evs.filter((e) => e.fase === "pedido").pop();
      const ultResp = evs.filter((e) => e.fase === "resposta").pop();
      if (ultPedido && (!ultResp || Date.parse(ultResp.em) < Date.parse(ultPedido.em))) {
        return { estado: "aguardando", detalhe: "Pedido em " + dm(ultPedido.em) + ", resposta ainda não juntada" };
      }
      if (ultResp) return { estado: "juntado", detalhe: "Resposta juntada em " + dm(ultResp.em) };
    }
    switch (ult.fase) {
      case "indisponivel": return { estado: "indisponivel", detalhe: "Sistema indisponível em " + quando + " (certificado)" };
      case "baixa": return { estado: "baixado", detalhe: "Baixa em " + quando };
      case "inclusao": return { estado: "incluido", detalhe: "Inclusão em " + quando };
      case "resposta": return { estado: "juntado", detalhe: "Resposta juntada em " + quando };
      case "pedido": return { estado: "aguardando", detalhe: "Pedido em " + quando };
      default: return { estado: "consultado", detalhe: "Consulta em " + quando };
    }
  }

  /* `f` = { convenios: ["SAB", ...] (em uso, na ordem), pendencias, sessao, sab, eventos } */
  function montar(f) {
    const fontes = f || {};
    return (fontes.convenios || []).map((c) => {
      const conv = idConv(c);
      const e = estadoDe(conv, fontes);
      return Object.assign({ id: conv, nome: NOMES[conv] || conv, rotulo: ROTULO[e.estado] }, e);
    });
  }

  /* Texto para o leitor de tela: nome, situação, detalhe. Nunca CPF, CNPJ ou valores
     (minimização: o que o NVDA fala, quem está em volta ouve). */
  function falaDe(linha) {
    const rot = linha.estado === "pronto" && linha.n ? linha.n + " para juntar" : linha.rotulo;
    return linha.nome + ": " + rot + ". " + linha.detalhe + ".";
  }

  /* A fase de um registro do diário (para o histórico sem dado de parte). Usa os mesmos
     sinais que a leitura dos autos — operação, detalhe e o nome do arquivo —, para as
     duas fontes concordarem. `reg.fase` explícita vence. Sem fase reconhecível: null
     (não registra nada; melhor faltar do que inventar). */
  const FASES = ["pedido", "resposta", "inclusao", "baixa", "consulta", "indisponivel"];
  function faseDoRegistro(reg, nomeArquivo) {
    const r = reg || {};
    if (FASES.indexOf(r.fase) >= 0) return r.fase;
    const conv = idConv(r.convenio);
    if (!NOMES[conv]) return null;
    const op = norm(r.operacao), det = norm(r.detalhe), arq = norm(nomeArquivo);
    if (op === "baixa" || op === "exclusao" || op === "cancelamento") return "baixa";
    if (op === "indisponibilidade") return "indisponivel";
    if (op === "respostas_sab" || op === "transferencia_sab") return "resposta";
    if (conv === "CCS") return (det === "detalhamento" || arq.indexOf("detalhamento") >= 0) ? "resposta"
      : arq.indexOf("envio") >= 0 ? "pedido" : "consulta";
    if (conv === "PREVJUD") return arq.indexOf("coleta") >= 0 ? "resposta" : det === "certidao" ? "pedido" : "consulta";
    if (conv === "INFOJUD") return det === "empresas" ? "consulta" : det ? "resposta" : "pedido";
    if (conv === "CENSEC" || conv === "SNIPER") return "consulta";
    return "inclusao";                       // SAB, RENAJUD, CNIB, SerasaJUD sem operação de baixa
  }

  const api = { montar, eventosDosAutos, faseDoAnexo, faseDoRegistro, estadoDe, falaDe, dm, NOMES, ROTULO, FASES };
  globalThis.CratosSituacao = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
