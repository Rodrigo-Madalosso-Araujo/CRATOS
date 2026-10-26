/*
 * conteudo/sniper-api.js — GRAMPO DE LEITURA da API do SNIPER (contexto da PÁGINA).
 *
 * Por que existe: o SNIPER é um app Angular que fala com sniper-api.pdpj.jus.br/v2/
 * com um token do SSO do PDPJ que mora DENTRO do app. O content script vive num mundo
 * isolado e não enxerga o fetch/XHR da página. Este arquivo é injetado como <script>
 * (web_accessible_resources) e repassa ao content script, por CustomEvent (detail em
 * STRING), as respostas que a PRÓPRIA página recebeu — e o corpo do POST que iniciou
 * a investigação, para a certidão dizer quais fontes foram de fato enviadas.
 *
 * SÓ LEITURA: não lê nem repassa cabeçalho (o token nunca sai daqui), não altera
 * requisição nem resposta, não reemite nada.
 */
(function () {
  "use strict";
  if (window.__cratosSniperGrampo) return;
  window.__cratosSniperGrampo = true;

  var ALVO = /sniper-api\.pdpj\.jus\.br\/v2\//i;
  var EVENTO = "cratos:sniper:api";

  function avisar(metodo, url, status, corpo, enviado) {
    try {
      window.dispatchEvent(new CustomEvent(EVENTO, {
        detail: JSON.stringify({
          metodo: String(metodo || "GET").toUpperCase(),
          url: String(url || ""),
          status: status,
          corpo: typeof corpo === "string" ? corpo : "",
          enviado: typeof enviado === "string" ? enviado : null,
        }),
      }));
    } catch (e) { /* o content script cai no prazo e avisa */ }
  }

  var fetchOriginal = window.fetch;
  if (fetchOriginal) {
    window.fetch = function (entrada, init) {
      var url = typeof entrada === "string" ? entrada : (entrada && entrada.url) || "";
      var metodo = (init && init.method) || (entrada && typeof entrada === "object" && entrada.method) || "GET";
      var enviado = init && typeof init.body === "string" ? init.body : null;
      var p = fetchOriginal.apply(this, arguments);
      if (ALVO.test(url) && String(metodo).toUpperCase() !== "OPTIONS") {
        p.then(function (r) {
          try { r.clone().text().then(function (t) { avisar(metodo, url, r.status, t, enviado); }, function () {}); }
          catch (e) { /* nada */ }
        }, function () { avisar(metodo, url, 0, "", enviado); });
      }
      return p;
    };
  }

  var abrir = XMLHttpRequest.prototype.open;
  var enviar = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (metodo, url) {
    this.__cratosSniper = { metodo: metodo, url: String(url || "") };
    return abrir.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (corpo) {
    var info = this.__cratosSniper;
    if (info && ALVO.test(info.url) && String(info.metodo).toUpperCase() !== "OPTIONS") {
      var enviado = typeof corpo === "string" ? corpo : null;
      var xhr = this;
      xhr.addEventListener("loadend", function () {
        var t = "";
        try { t = typeof xhr.responseText === "string" ? xhr.responseText : ""; } catch (e) { /* responseType não-texto */ }
        if (!t) {
          try { if (xhr.response && typeof xhr.response === "object") t = JSON.stringify(xhr.response); } catch (e) { /* nada */ }
        }
        avisar(info.metodo, xhr.responseURL || info.url, xhr.status, t, enviado);
      });
    }
    return enviar.apply(this, arguments);
  };
})();
