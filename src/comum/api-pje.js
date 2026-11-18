/*
 * api-pje.js — leitura da API do PJe (somente GET, autenticado pelo cookie de sessão).
 *
 * IMPORTANTE: os caminhos e o formato de resposta abaixo seguem o padrão observado
 * na extensão maisPJe (que funciona no TRT18). O que É estável: os endpoints respondem
 * e o cookie autentica. O que ainda PRECISA ser confirmado com uma resposta real:
 * o NOME dos campos no JSON (o "shape"). Por isso toda a dependência de formato está
 * concentrada nas funções normalizar*() no fim do arquivo — é o único lugar a mexer
 * quando virmos o JSON verdadeiro. O resto do código não conhece o formato do PJe.
 */

const ApiPje = {
  /* base é algo como "https://pje.trt18.jus.br" */
  _base: null,

  setBase(base) { this._base = base.replace(/\/+$/, ""); },

  /* 1.9.7: o X-XSRF-TOKEN que o painel lê do cookie da página (o TRT19 recusa GET sem
     ele). Só em memória; vai só para a base do PJe definida acima. */
  _xsrf: "",
  setXsrf(t) { this._xsrf = String(t || ""); },

  _cabecalhos() {
    if (globalThis.CratosPje) return globalThis.CratosPje.cabecalhosLeitura(this._xsrf);
    const h = { Accept: "application/json" };
    if (this._xsrf) { try { h["X-XSRF-TOKEN"] = decodeURIComponent(this._xsrf); } catch (e) { h["X-XSRF-TOKEN"] = this._xsrf; } }
    return h;
  },

  async _getJson(caminho) {
    if (!this._base) throw new Error(_semBase());
    const url = this._base + caminho;
    const resp = await fetch(url, { headers: this._cabecalhos() });
    if (!resp.ok) {
      // Diferente da maisPJe, NÃO engolimos o erro: 403 e 404 precisam ser distinguíveis.
      const e = new Error(`CRATOS: ${resp.status} em ${caminho}`);
      e.status = resp.status;
      throw e;
    }
    return resp.json();
  },

  /* ---- chamadas cruas (retornam JSON bruto do PJe) ---- */

  obterProcessoPorId(idProcesso) {
    return this._getJson(`/pje-comum-api/api/processos/id/${idProcesso}`);
  },

  obterPartesPorId(idProcesso) {
    return this._getJson(`/pje-comum-api/api/processos/id/${idProcesso}/partes`);
  },

  /* ---- fluxo de alto nível: captura tudo que o CRATOS precisa ---- */

  async capturarProcesso(idProcesso, numeroProcesso) {
    const [brutoGerais, brutoPartes] = await Promise.all([
      this.obterProcessoPorId(idProcesso).catch((e) => ({ _erro: e.status || true })),
      this.obterPartesPorId(idProcesso),
    ]);

    return {
      id: idProcesso,
      numero: numeroProcesso || normalizarNumero(brutoGerais),
      capturadoEm: new Date().toISOString(),
      partes: normalizarPartes(brutoPartes),
      _brutoGerais: brutoGerais,
      _brutoPartes: brutoPartes,
    };
  },

  /*
   * Busca o valor do último cálculo do PJe-Calc (portado do maisPJe,
   * função pjeApiObterValorExecucaoPJeCalc). Critério: o cálculo com
   * dataHoraImportacao mais recente. Compartilhado por SAB, CNIB e SerasaJUD.
   * Retorna { total, valorFormatado, dataFormatada, dataISO,
   *           dataLiquidacao, dataLiquidacaoISO } | null.
   */
  async obterValorCalculo(idProcesso) {
    try {
      const dados = await this._getJson(
        `/pje-comum-api/api/calculos/processo?idProcesso=${idProcesso}` +
        `&pagina=1&tamanhoPagina=10&ordenacaoCrescente=true` +
        `&mostrarCalculosHomologados=true&incluirCalculosHomologados=true`
      );
      if (!dados || !dados.resultado || !dados.resultado[0]) return null;

      // Pega o mais recente por dataHoraImportacao (= critério do maisPJe)
      let ultimo = dados.resultado[0];
      let dtUltimo = new Date(ultimo.dataHoraImportacao || 0);
      for (const calc of dados.resultado) {
        const dt = new Date(calc.dataHoraImportacao || 0);
        if (dt > dtUltimo) { dtUltimo = dt; ultimo = calc; }
      }

      const total = ultimo.total || 0;
      const valorFormatado = new Intl.NumberFormat("pt-BR", {
        style: "currency", currency: "BRL",
      }).format(total);

      const brDe = (d) => {
        const dd = String(d.getDate()).padStart(2, "0");
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        return `${dd}/${mm}/${d.getFullYear()}`;
      };
      const dataFormatada = brDe(dtUltimo);

      /* ═══ SÃO DUAS DATAS DIFERENTES, e a distinção importa ═══
       * `dataHoraImportacao` = quando o cálculo foi JUNTADO ao processo.
       * `dataLiquidacao`     = até quando o cálculo foi ATUALIZADO.
       * Para escolher QUAL cálculo vale, mandamos na importação (o último
       * juntado). Mas quando um convênio pede "data da dívida" — o SerasaJUD
       * pede, e é campo obrigatório na baixa — o que se usa é a LIQUIDAÇÃO.
       * O maisPJe tem as duas implementações e elas DISCORDAM entre si: o
       * gigs-plugin.js ordena e devolve por importação, o gigs-background.js por
       * liquidação. Aqui a escolha é explícita: seleção por importação, data da
       * dívida por liquidação.
       * Sem `dataLiquidacao` no JSON devolvemos NULL, e quem usar que avise o
       * usuário. Chutar data em ato de baixa não está em questão. */
      let dataLiquidacao = null, dataLiquidacaoISO = null;
      if (ultimo.dataLiquidacao) {
        const dl = new Date(ultimo.dataLiquidacao);
        if (!isNaN(dl.getTime())) {
          dataLiquidacao = brDe(dl);
          dataLiquidacaoISO = dl.toISOString();
        }
      }

      return {
        total, valorFormatado,
        dataFormatada, dataISO: dtUltimo.toISOString(),   // importação (o de sempre)
        dataLiquidacao, dataLiquidacaoISO,                // pode vir null — de propósito
      };
    } catch (e) {
      console.warn("CRATOS/api-pje: erro ao buscar valor do cálculo:", e.message);
      return null;
    }
  },

  /*
   * Lança um movimento no processo via POST same-origin.
   * Portado da requisição observada no DevTools — o corpo é JSON estruturado:
   * { assinar: false, movimentos: [{id}], processos: [idProcesso] }
   * Não abre aba, não clica em nada — fetch direto, mais robusto que mini-selenium.
   */
  async lancarMovimento(idProcesso, idMovimento, xsrfToken) {
    if (!this._base) throw new Error(_semBase());
    const url = this._base +
      "/pje-comum-api/api/definicaomovimentos?agrupamento=false";
    // O token CSRF vem do content script (que tem acesso ao document.cookie);
    // background scripts não têm document, então o token é passado como parâmetro.
    const xsrf = decodeURIComponent(xsrfToken || "");
    console.log("CRATOS/api-pje: lançando movimento", idMovimento,
      "| token recebido:", xsrf ? `sim (${xsrf.length} chars)` : "VAZIO",
      "| processos:", [idProcesso]);
    const body = JSON.stringify({
      assinar: false,
      movimentos: [{ id: idMovimento }],
      processos: [idProcesso],
    });
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-XSRF-TOKEN": xsrf,
      },
      body,
    });
    if (!resp.ok) {
      const corpo = await resp.text().catch(() => "");
      console.warn("CRATOS/api-pje: falha", resp.status, "corpo:", corpo.slice(0, 400));
      const e = new Error(`CRATOS: ${resp.status} ao lançar movimento ${idMovimento}`);
      e.status = resp.status;
      throw e;
    }
    return { ok: true };
  },
};

/* =========================================================================
 * NORMALIZAÇÃO — o único ponto acoplado ao formato do PJe do TRT18.
 * Ajustar aqui quando virmos a resposta real. Tudo defensivo: campo ausente
 * vira string vazia ou array vazio, nunca quebra.
 * ========================================================================= */

function normalizarNumero(brutoGerais) {
  if (!brutoGerais || brutoGerais._erro) return "";
  return brutoGerais.numero || brutoGerais.numeroProcesso || "";
}

/* Formato real (TRT18 e TRT19, 18/11/2026): { ATIVO: [...], PASSIVO: [...], TERCEIROS: [...] }.
   Cada item já é a parte e traz o PRÓPRIO polo ("ativo", "passivo", "outros"); advogados
   vêm aninhados em `representantes[]` e são ignorados de propósito — o CRATOS consulta as
   PARTES, não os procuradores.

   1.9.7 — até a 1.9.6 só se conheciam ATIVO, PASSIVO, TERCEIRO e OUTROS, e qualquer outra
   chave era PULADA em silêncio: os 35 terceiros de um processo do TRT19 sumiam do painel.
   Agora, nesta ordem: (1) a chave do grupo, se conhecida; (2) o `polo` da própria parte;
   (3) "indefinido" — a parte ENTRA, com o polo marcado como não identificado, e o painel
   avisa. Parte nenhuma some. Só se pula o que não é lista de partes. */
const _POLOS_GRUPO = {
  ATIVO: "ativo", POLOATIVO: "ativo",
  PASSIVO: "passivo", POLOPASSIVO: "passivo",
  TERCEIRO: "terceiro", TERCEIROS: "terceiro", OUTROS: "terceiro", OUTRO: "terceiro",
};
const _POLOS_PARTE = { ativo: "ativo", a: "ativo", passivo: "passivo", p: "passivo",
  terceiro: "terceiro", terceiros: "terceiro", outros: "terceiro", outro: "terceiro", t: "terceiro" };

function _poloDaParte(it) {
  const v = it && typeof it.polo === "string" ? it.polo.trim().toLowerCase() : "";
  return _POLOS_PARTE[v] || null;
}

function _ehListaDePartes(itens) {
  return Array.isArray(itens) && itens.some((x) => x && typeof x === "object" && ("nome" in x || "documento" in x || "idPessoa" in x));
}

function normalizarPartes(bruto) {
  if (!bruto) return [];
  const partes = [];
  const pegar = (itens, poloGrupo) => {
    for (const it of itens) {
      if (!it || typeof it !== "object") continue;
      partes.push(normalizarPessoa(it, poloGrupo || _poloDaParte(it) || "indefinido"));
    }
  };
  if (Array.isArray(bruto)) { pegar(bruto, null); return partes; }   // lista plana: o polo vem de cada parte
  for (const [chave, itens] of Object.entries(bruto)) {
    if (!Array.isArray(itens)) continue;                           // não é polo (ex.: um total)
    const poloGrupo = _POLOS_GRUPO[chave.toUpperCase().replace(/[^A-Z]/g, "")] || null;
    if (!poloGrupo && !_ehListaDePartes(itens)) continue;          // lista de outra coisa
    pegar(itens, poloGrupo);
  }
  return partes;
}

function normalizarPessoa(it, polo) {
  const p = it || {};
  const juridica = p.tipoPessoa === "J" || p.tipoDocumento === "CNPJ" || !!p.pessoaJuridica;
  return {
    nome: p.nome || "",
    cpfcnpj: soDigitos(p.documento || p.cpf || (p.pessoaJuridica && p.pessoaJuridica.cnpj) || ""),
    tipoPessoa: juridica ? "juridica" : "fisica",
    tipoParte: p.tipo || "",          // AUTOR, RÉU, etc.
    polo,
    idPessoa: p.idPessoa || null,
  };
}

function soDigitos(s) { return String(s || "").replace(/\D/g, ""); }

if (typeof module !== "undefined") { module.exports = { ApiPje }; }

/* `setBase()` não foi chamado — é erro meu de programação, não do usuário. Mas
 * a mensagem do Error é a que pode chegar na faixa da tela, então ela precisa
 * ser útil para quem lê; o diagnóstico fica no console, para mim. */
function _semBase() {
  console.error("CRATOS/api-pje: ApiPje.setBase() não foi chamado — base indefinida.");
  return "não consegui falar com o PJe nesta aba. Abra o processo no PJe e execute de novo.";
}
