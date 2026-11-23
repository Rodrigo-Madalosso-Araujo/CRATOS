/*
 * conteudo/censec-api.js — GRAMPO DE API, roda no CONTEXTO DA PÁGINA.
 *
 * Por que existe: a busca do CEP é uma chamada REST honesta
 * (POST /api/atos/cep/busca) que devolve TODOS os atos de uma vez — a paginação
 * da tela é client-side. Ler a resposta é muito melhor que raspar a tabela.
 *
 * Por que não chamamos a API direto: a autenticação é Bearer OIDC e o token vive
 * dentro do app Angular. Um fetch do content script sairia sem Authorization.
 * Então deixamos o SITE buscar e escutamos a resposta que ele já recebe.
 *
 * O content script vive num mundo isolado e não enxerga o fetch da página; por
 * isso este arquivo é injetado como <script> (web_accessible_resources) e
 * conversa de volta por CustomEvent, com o corpo em STRING (objeto cru não
 * atravessa a fronteira de forma confiável no Firefox).
 *
 * READ-ONLY: observa e repassa. Não altera requisição nem resposta.
 */
(function () {
  "use strict";
  if (window.__cratosCensecGrampo) return;
  window.__cratosCensecGrampo = true;

  const ALVO = /\/api\/atos\/cep\/busca/i;
  const EVENTO = "cratos:censec:busca";

  function avisar(payload) {
    try {
      window.dispatchEvent(new CustomEvent(EVENTO, { detail: JSON.stringify(payload) }));
    } catch (e) { /* nada a fazer: o content script vai cair no timeout */ }
  }

  /* 1.9.8: o FILTRO que de fato foi ao servidor (documento e datas), para o content
     script conferir que a busca foi feita com o período pedido — se a data não pegou no
     formulário, a certidão diria um período que não foi consultado. Só esses três campos
     saem daqui (o corpo leva também o token do captcha, que fica onde está). */
  function filtroDoCorpo(corpo) {
    try {
      const b = JSON.parse(typeof corpo === "string" ? corpo : "");
      return { cpfCnpj: b.cpfCnpj || null, dataInicio: b.dataInicio || null, dataFim: b.dataFim || null };
    } catch (e) { return null; }
  }

  const fetchOriginal = window.fetch;
  window.fetch = async function (entrada, init) {
    const url = typeof entrada === "string" ? entrada : (entrada && entrada.url) || "";
    const resposta = await fetchOriginal.apply(this, arguments);
    if (ALVO.test(url)) {
      const filtro = filtroDoCorpo(init && init.body);
      try {
        const corpo = await resposta.clone().text();
        avisar({ ok: resposta.ok, status: resposta.status, corpo, filtro });
      } catch (e) {
        avisar({ ok: false, status: resposta.status, erro: String(e && e.message || e), filtro });
      }
    }
    return resposta;
  };

  const abrirOriginal = XMLHttpRequest.prototype.open;
  const enviarOriginal = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (metodo, url) {
    this.__cratosUrl = url;
    return abrirOriginal.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (corpoPedido) {
    if (ALVO.test(this.__cratosUrl || "")) {
      const filtro = filtroDoCorpo(corpoPedido);
      this.addEventListener("loadend", () => {
        let corpo = "";
        try { corpo = typeof this.responseText === "string" ? this.responseText : ""; } catch (e) {}
        avisar({ ok: this.status >= 200 && this.status < 300, status: this.status, corpo, filtro });
      });
    }
    return enviarOriginal.apply(this, arguments);
  };

  /* ═══════════════════════════════════════════════════════════════════════════
   * CANAL DE PARTES — o grampo passa a FAZER chamadas, não só escutar.
   *
   * As partes de um ato não vêm na busca; ficam em
   *   GET /api/busca-atos/cep/{atoId}/partes
   * O content script (mundo isolado) não pode chamar isso: o fetch dele sai com
   * origem moz-extension:// e sem a credencial da sessão (ARQ-516). Aqui, no
   * contexto da página, um fetch same-origin com credentials:"include" leva o
   * cookie access_token sozinho — CONFIRMADO no ambiente real (16/09): o endpoint
   * responde 200 só com o cookie + X-Subscription, sem precisar montar o Bearer.
   *
   * Continua honesto: só GET de leitura, do mesmo dado que a tela mostraria se
   * você abrisse o ato. Nada é alterado no site.
   * ═══════════════════════════════════════════════════════════════════════════ */
  const EVENTO_PARTES_PEDIR = "cratos:censec:partes:pedir";
  const EVENTO_PARTES_RESP = "cratos:censec:partes:resposta";
  const SUBSCRIPTION = "00000000-0000-0000-0000-000000000000";
  const LIMITE_PARTES = 100;   // uma tacada cobre qualquer ato normal
  const TETO_PARTES = 1000;    // trava de segurança contra laço de paginação

  function responderPartes(payload) {
    try {
      window.dispatchEvent(new CustomEvent(EVENTO_PARTES_RESP, { detail: JSON.stringify(payload) }));
    } catch (e) { /* content script cai no timeout */ }
  }

  async function buscarPartesDeUmAto(atoId) {
    const id = String(atoId || "").trim();
    if (!id) return { ok: false, erro: "atoId vazio" };
    const partes = [];
    try {
      let offset = 0, total = Infinity;
      while (offset < total && offset < TETO_PARTES) {
        const url = `/api/busca-atos/cep/${encodeURIComponent(id)}/partes` +
          `?q=&offset=${offset}&limit=${LIMITE_PARTES}&order=desc&orderBy=nome&cursor=null`;
        // fetchOriginal para não reentrar no interceptor da busca
        const r = await fetchOriginal.call(window, url, {
          credentials: "include",
          headers: { "Accept": "application/json", "X-Subscription": SUBSCRIPTION },
        });
        if (!r.ok) return { ok: false, status: r.status };
        const j = await r.json();
        const items = Array.isArray(j.items) ? j.items : [];
        for (const p of items) {
          partes.push({
            nome: p.nome || "",
            documento: p.numeroDocumento || p.cpfCnpj || "",
            qualidade: p.qualidade || "",
          });
        }
        total = Number(j.totalCount);
        if (!Number.isFinite(total)) total = partes.length;
        if (!items.length) break;
        offset += items.length;
      }
      return { ok: true, partes };
    } catch (e) {
      return { ok: false, erro: String((e && e.message) || e) };
    }
  }

  /* 1.9.8 — ATO POR ATO, TRÊS POR VEZ, COM ANDAMENTO. Até a 1.9.7 os atos iam um a um
     e a resposta só saía no fim, inteira — e o content script esperava 45 s pelo TODO.
     Com 300 procurações passava disso, e a certidão saía sem as partes de NENHUM ato
     (caso real do Rodrigo, 23/11). Agora cada ato que termina vai logo (EVENTO_ITEM), e o
     content script só desiste se ficar um tempo sem chegar nada. */
  const EVENTO_PARTES_ITEM = "cratos:censec:partes:item";
  const SIMULTANEOS = 3;

  window.addEventListener(EVENTO_PARTES_PEDIR, async (ev) => {
    let pedido = null;
    try { pedido = JSON.parse(ev.detail); } catch (e) { return; }
    const reqId = pedido && pedido.reqId;
    const atoIds = (pedido && Array.isArray(pedido.atoIds)) ? pedido.atoIds.slice() : [];
    const resultados = {};
    let proximo = 0, feitos = 0;
    async function trabalhador() {
      while (proximo < atoIds.length) {
        const atoId = atoIds[proximo++];
        const r = await buscarPartesDeUmAto(atoId);
        resultados[atoId] = r;
        feitos++;
        try {
          window.dispatchEvent(new CustomEvent(EVENTO_PARTES_ITEM,
            { detail: JSON.stringify({ reqId, atoId, resultado: r, feitos, total: atoIds.length }) }));
        } catch (e) { /* segue */ }
      }
    }
    await Promise.all(Array.from({ length: Math.min(SIMULTANEOS, atoIds.length) }, trabalhador));
    responderPartes({ reqId, resultados });
  });

  console.log("CRATOS/CENSEC: grampo de API ativo (busca + canal de partes).");
})();
