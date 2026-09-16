/*
 * conteudo/renajud-api.js — GRAMPO de API do RENAJUD (contexto da PÁGINA).
 *
 * O content script (mundo isolado) não enxerga o fetch/XHR da página. Este script
 * é injetado no contexto da página (web_accessible_resources) e grampeia fetch/XHR:
 * quando passa uma chamada a .../api/v1/veiculos/restricoes, devolve MÉTODO + STATUS
 * + corpo da resposta ao content script por CustomEvent (detail em STRING).
 *
 *   POST   200 -> inclusão (folha de inclusão)
 *   DELETE 200 -> baixa   (folha de baixa)
 *   DELETE 400 "RENAJUD-WEB" -> restrição do RENAJUD ANTIGO (roteamento futuro)
 *   GET        -> busca (ignorado pelo content script)
 *
 * NÃO re-emite requisição (duplicaria a restrição): só escuta a que a página já faz.
 */
(function () {
  if (window.__cratosRenajudHook) return;
  window.__cratosRenajudHook = true;
  var ALVO = "/veiculos/restricoes";

  function emitir(metodo, status, corpo) {
    try {
      document.dispatchEvent(new CustomEvent("cratos:renajud:restricao", {
        detail: JSON.stringify({ metodo: metodo, status: status, corpo: String(corpo || "") }),
      }));
    } catch (e) { /* silencioso */ }
  }

  // fetch
  var of = window.fetch;
  if (of) {
    window.fetch = function () {
      var req = arguments[0];
      var url = (typeof req === "string") ? req : (req && req.url) || "";
      var metodo = ((typeof req === "object" && req && req.method) ||
        (arguments[1] && arguments[1].method) || "GET").toUpperCase();
      var p = of.apply(this, arguments);
      if (String(url).indexOf(ALVO) !== -1) {
        p.then(function (r) {
          try { r.clone().text().then(function (t) { emitir(metodo, r.status, t); }); } catch (e) {}
        }).catch(function () {});
      }
      return p;
    };
  }

  // XHR (rede de segurança)
  var oo = XMLHttpRequest.prototype.open;
  var os = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__cM = (m || "GET").toUpperCase(); this.__cU = u; return oo.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    var self = this;
    this.addEventListener("load", function () {
      try {
        if (String(self.__cU || "").indexOf(ALVO) !== -1) emitir(self.__cM, self.status, self.responseText);
      } catch (e) {}
    });
    return os.apply(this, arguments);
  };
})();
