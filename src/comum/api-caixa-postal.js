/*
 * api-caixa-postal.js — leitura da caixa postal do eCAC (Receita) via API REST JSON.
 *
 * Descoberto no ambiente real (TRT18, Firefox, caixa postal v2.0.0):
 *   GET https://www3.cav.receita.fazenda.gov.br/caixapostal/api/mensagens
 *       ?pagina=0&tamanho=20&campoOrdenacao=dataEnvio&direcao=desc
 *   same-origin, autenticado por cookie de sessão (mesmo padrão do PJe).
 *
 * Cada mensagem traz:
 *   assunto: "[INFOJUD] Solicitação/Processo disponível: {numSolic}/{numProcessoLimpo}"
 *   isn: id único | lida: bool | dataEnvio: "YYYY-MM-DD" | possuiAnexos: bool
 *
 * A TRAVA ANTI-VAZAMENTO vive aqui: só devolve a mensagem cujo número de processo
 * (extraído do assunto) bate com o processo pedido. Nunca devolve "a mais recente"
 * sem conferir — isso impede coletar a resposta fiscal de outro processo.
 */

const ApiCaixaPostal = {
  _base: "https://www3.cav.receita.fazenda.gov.br",
  _pathApi: "/caixapostal/api/mensagens",

  async _getJson(qs) {
    const url = this._base + this._pathApi + qs;
    // credentials:"include" força o envio do cookie de sessão da Receita.
    // Se a Receita ainda recusar (403), a leitura terá de ser feita por um content
    // script same-origin numa aba da Receita (ver coletar via aba no background).
    const resp = await fetch(url, {
      headers: { Accept: "application/json" },
      credentials: "include",
    });
    if (!resp.ok) {
      const e = new Error(`CRATOS/caixa-postal: ${resp.status} em ${this._pathApi}`);
      e.status = resp.status;
      throw e;
    }
    return resp.json();
  },

  /* Lê uma página de mensagens (mais recentes primeiro). */
  async listarMensagens(pagina = 0, tamanho = 50) {
    const qs = `?pagina=${pagina}&tamanho=${tamanho}&campoOrdenacao=dataEnvio&direcao=desc`;
    const j = await this._getJson(qs);
    return {
      totais: j.totais || {},
      mensagens: (j.mensagens || []).map(normalizarMensagem),
    };
  },

  /*
   * Acha a mensagem INFOJUD correspondente ao processo pedido — COM TRAVA.
   * numeroProcesso: string do PJe (com ou sem formatação); comparamos só dígitos.
   * Retorna { encontrada, mensagem?, motivo? }.
   *
   * Por padrão exige que a mensagem esteja NÃO LIDA (é a resposta recém-chegada),
   * mas isso é ajustável — na dúvida, buscamos entre as mais recentes.
   */
  async acharSolicitacaoDoProcesso(numeroProcesso, { exigirNaoLida = false, maxPaginas = 3 } = {}) {
    const alvo = soDigitos(numeroProcesso);
    if (alvo.length < 15) {
      return { encontrada: false, motivo: "numero_processo_invalido" };
    }

    const candidatas = [];
    for (let p = 0; p < maxPaginas; p++) {
      const { mensagens } = await this.listarMensagens(p, 50);
      if (!mensagens.length) break;
      for (const m of mensagens) {
        if (!m.ehInfojud) continue;
        if (soDigitos(m.numProcesso) !== alvo) continue;   // ← A TRAVA
        if (exigirNaoLida && m.lida) continue;
        candidatas.push(m);
      }
      // como vem ordenado por data desc, se já achamos algo podemos parar cedo
      if (candidatas.length) break;
    }

    if (!candidatas.length) {
      return { encontrada: false, motivo: exigirNaoLida ? "sem_mensagem_nao_lida" : "nao_encontrada" };
    }
    // mais recente primeiro (a lista já vem desc; candidatas mantém a ordem)
    return { encontrada: true, mensagem: candidatas[0], todas: candidatas };
  },
  /* exposto para o background normalizar mensagens vindas do fallback via aba */
  _normalizar(m) { return normalizarMensagem(m); },
};

function normalizarMensagem(m) {
  const assunto = m.assunto || "";
  const ehInfojud = /\[INFOJUD\]/i.test(assunto);
  const { numSolicitacao, numProcesso } = extrairDoAssunto(assunto);
  return {
    isn: m.isn,
    assunto,
    lida: !!m.lida,
    dataEnvio: m.dataEnvio || "",
    possuiAnexos: !!m.possuiAnexos,
    ehInfojud,
    numSolicitacao,   // ex.: "20260809000001"
    numProcesso,      // dígitos do processo, ex.: "00000033320175180008"
  };
}

/* Assunto: "[INFOJUD] Solicitação/Processo disponível: 20260809000001/00000033320175180008" */
function extrairDoAssunto(assunto) {
  const m = assunto.match(/:\s*(\d+)\s*\/\s*(\d+)/);
  if (m) return { numSolicitacao: m[1], numProcesso: m[2] };
  return { numSolicitacao: "", numProcesso: "" };
}

function soDigitos(s) { return String(s || "").replace(/\D/g, ""); }

if (typeof module !== "undefined") { module.exports = { ApiCaixaPostal }; }
