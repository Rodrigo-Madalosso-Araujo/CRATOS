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

  const fetchOriginal = window.fetch;
  window.fetch = async function (entrada, init) {
    const url = typeof entrada === "string" ? entrada : (entrada && entrada.url) || "";
    const resposta = await fetchOriginal.apply(this, arguments);
    if (ALVO.test(url)) {
      try {
        const corpo = await resposta.clone().text();
        avisar({ ok: resposta.ok, status: resposta.status, corpo });
      } catch (e) {
        avisar({ ok: false, status: resposta.status, erro: String(e && e.message || e) });
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
  XMLHttpRequest.prototype.send = function () {
    if (ALVO.test(this.__cratosUrl || "")) {
      this.addEventListener("loadend", () => {
        let corpo = "";
        try { corpo = typeof this.responseText === "string" ? this.responseText : ""; } catch (e) {}
        avisar({ ok: this.status >= 200 && this.status < 300, status: this.status, corpo });
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

  window.addEventListener(EVENTO_PARTES_PEDIR, async (ev) => {
    let pedido = null;
    try { pedido = JSON.parse(ev.detail); } catch (e) { return; }
    const reqId = pedido && pedido.reqId;
    const atoIds = (pedido && Array.isArray(pedido.atoIds)) ? pedido.atoIds : [];
    const resultados = {};
    for (const atoId of atoIds) {
      resultados[atoId] = await buscarPartesDeUmAto(atoId);
    }
    responderPartes({ reqId, resultados });
  });

  console.log("CRATOS/CENSEC: grampo de API ativo (busca + canal de partes).");
})();
