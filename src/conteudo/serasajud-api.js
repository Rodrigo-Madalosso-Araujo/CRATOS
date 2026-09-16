/*
 * conteudo/serasajud-api.js — GRAMPO DE API, roda no CONTEXTO DA PÁGINA.
 *
 * Por que existe: o CRATOS para no diálogo "Confirmar inclusão/baixa da dívida?"
 * — quem confirma é o usuário. Mas a certidão só pode ser emitida se o ato
 * REALMENTE aconteceu. Então escutamos o POST que o próprio site faz quando você
 * confirma, e só com o 201 na mão é que a certidão é fabricada.
 *
 * Ela é montada a partir do CORPO QUE FOI ENVIADO, não do que a extensão
 * pretendia enviar: se você editar algo na tela antes de confirmar, a certidão
 * reflete o que foi de fato para o Serasa.
 *
 * READ-ONLY: observa e repassa. Não altera requisição, não altera resposta, e
 * NUNCA dispara o POST por conta própria.
 */
(function () {
  "use strict";
  if (window.__cratosSerasajudGrampo) return;
  window.__cratosSerasajudGrampo = true;

  /* Dois alvos, dois eventos:
     · o POST da ordem, que prova que o ato aconteceu;
     · o GET da listagem do órgão, que é onde vive o NÚMERO OFICIAL da ordem
       (numeroOrdem/anoOrdem) e o status corrente. O POST devolve só o id
       interno; o número que se cita num despacho está aqui. */
  const ALVO_POST = /\/serasajud-solicitacao\/v1\/ordens(\?|$)/i;
  const ALVO_LISTA = /\/serasajud-solicitacao\/v1\/ordens\/orgao/i;
  const EVENTO = "cratos:serasajud:ordem";
  const EVENTO_LISTA = "cratos:serasajud:lista";

  function avisar(payload, evento) {
    try {
      window.dispatchEvent(new CustomEvent(evento || EVENTO, { detail: JSON.stringify(payload) }));
    } catch (e) { /* nada a fazer: o content script cai no timeout */ }
  }

  const fetchOriginal = window.fetch;
  window.fetch = async function (entrada, init) {
    const url = typeof entrada === "string" ? entrada : (entrada && entrada.url) || "";
    const metodo = ((init && init.method) || (entrada && entrada.method) || "GET").toUpperCase();
    const enviado = (init && init.body) || null;
    const resposta = await fetchOriginal.apply(this, arguments);
    const ehPost = metodo === "POST" && ALVO_POST.test(url) && !ALVO_LISTA.test(url);
    const ehLista = ALVO_LISTA.test(url);
    if (ehPost || ehLista) {
      try {
        const corpo = await resposta.clone().text();
        avisar({ ok: resposta.ok, status: resposta.status, enviado: String(enviado || ""), corpo },
          ehLista ? EVENTO_LISTA : EVENTO);
      } catch (e) {
        avisar({ ok: false, status: resposta.status, erro: String((e && e.message) || e) },
          ehLista ? EVENTO_LISTA : EVENTO);
      }
    }
    return resposta;
  };

  const abrirOriginal = XMLHttpRequest.prototype.open;
  const enviarOriginal = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (metodo, url) {
    this.__cratosMetodo = String(metodo || "").toUpperCase();
    this.__cratosUrl = url;
    return abrirOriginal.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (corpoEnviado) {
    const url = this.__cratosUrl || "";
    const ehPost = this.__cratosMetodo === "POST" && ALVO_POST.test(url) && !ALVO_LISTA.test(url);
    const ehLista = ALVO_LISTA.test(url);
    if (ehPost || ehLista) {
      this.addEventListener("loadend", () => {
        let corpo = "";
        try { corpo = typeof this.responseText === "string" ? this.responseText : ""; } catch (e) {}
        avisar({
          ok: this.status >= 200 && this.status < 300,
          status: this.status,
          enviado: String(corpoEnviado || ""),
          corpo,
        }, ehLista ? EVENTO_LISTA : EVENTO);
      });
    }
    return enviarOriginal.apply(this, arguments);
  };

  console.log("CRATOS/SERASAJUD: grampo de API ativo (POST /v1/ordens e GET /v1/ordens/orgao).");
})();
