/*
 * conteudo/prevjud-api.js — GRAMPO DE LEITURA da API do PREVJUD (contexto da PÁGINA).
 * 1.8.4: é o método de RESERVA — o principal escuta do lado da extensão (prevjud-cedo.js).
 *
 * Por que existe: o PREVJUD é um app Angular que fala com /previdenciario-api/ (mesmo host)
 * com um token do SSO do PDPJ que mora DENTRO do app. Os PDFs oficiais do dossiê vêm
 * dentro dessas respostas (pdfBase64). O content script vive num mundo
 * isolado e não enxerga o fetch/XHR da página. Este arquivo é injetado como <script>
 * (web_accessible_resources) e repassa ao content script, por CustomEvent (detail em
 * STRING), as respostas que a PRÓPRIA página recebeu — e o corpo do POST da solicitação,
 * para conferir CPF e processo enviados.
 *
 * SÓ LEITURA: não lê nem repassa cabeçalho (o token nunca sai daqui), não altera
 * requisição nem resposta, não reemite nada.
 */
(function () {
  "use strict";
  if (window.__cratosPrevjudGrampo) return;
  window.__cratosPrevjudGrampo = true;
  try { document.documentElement.setAttribute("data-cratos-prevjud", "escutando"); } catch (e) { /* nada */ }
  /* endereço relativo completado antes de comparar (1.8.4) */
  function absoluta(u) {
    try { return new URL(String(u == null ? "" : u), location.href).href; } catch (e) { return String(u == null ? "" : u); }
  }

  /* 1.9.0: só as rotas do Dossiê Previdenciário; lista de pedidos só do tipo PREVIDENCIARIO */
  var ALVO = /\/previdenciario-api\/api\/v\d+\/(dossiePrevidenciario|previdenciario)\//i;
  function permitido(url, enviado) {
    if (!ALVO.test(url)) return false;
    if (/pesquisarPedidosDossie/i.test(url) && typeof enviado === "string" && /"tipo"\s*:/.test(enviado) &&
      !/"tipo"\s*:\s*"PREVIDENCIARIO"/i.test(enviado)) return false;
    return true;
  }
  var EVENTO = "cratos:prevjud:api";
  /* Memória curta (1.8.2): o grampo entra em document_start, antes do content script
     principal; as primeiras respostas (a lista de pedidos que a tela busca ao abrir)
     ficam aqui e são reenviadas UMA vez, quando o content script pede. Teto de 40. */
  var MEMORIA = 40;
  var memoria = [];
  var seq = 0;
  var reenviou = false;

  /* 1.8.6: cada pedido leva um nº (`k`) no INÍCIO e no FIM — o content script sabe quando
     TODOS os documentos que a página pediu terminaram de chegar (o "Transferido" da aba Rede). */
  var req = 0;
  function avisarInicio(k, metodo, url) {
    try {
      window.dispatchEvent(new CustomEvent("cratos:prevjud:inicio", { detail: JSON.stringify({
        k: k, metodo: String(metodo || "GET").toUpperCase(), url: String(url || "") }) }));
    } catch (e) { /* nada */ }
  }
  function avisar(metodo, url, status, corpo, enviado, k) {
    try {
      var detail = JSON.stringify({
        n: ++seq,
        k: k == null ? null : k,
        metodo: String(metodo || "GET").toUpperCase(),
        url: String(url || ""),
        status: status,
        corpo: typeof corpo === "string" ? corpo : "",
        enviado: typeof enviado === "string" ? enviado : null,
      });
      if (!reenviou) { memoria.push(detail); if (memoria.length > MEMORIA) memoria.shift(); }
      window.dispatchEvent(new CustomEvent(EVENTO, { detail: detail }));
    } catch (e) { /* o content script cai no prazo e avisa */ }
  }
  window.addEventListener("cratos:prevjud:reenviar", function () {
    if (reenviou) return;
    reenviou = true;
    var lista = memoria;
    memoria = [];
    for (var i = 0; i < lista.length; i++) {
      try { window.dispatchEvent(new CustomEvent(EVENTO, { detail: lista[i] })); } catch (e) { /* nada */ }
    }
  });

  var fetchOriginal = window.fetch;
  if (fetchOriginal) {
    window.fetch = function (entrada, init) {
      var url = absoluta(typeof entrada === "string" ? entrada : (entrada && (entrada.url || entrada.href)) || "");
      var metodo = (init && init.method) || (entrada && typeof entrada === "object" && entrada.method) || "GET";
      var enviado = init && typeof init.body === "string" ? init.body : null;
      var p = fetchOriginal.apply(this, arguments);
      if (permitido(url, enviado) && String(metodo).toUpperCase() !== "OPTIONS") {
        var k = ++req;
        avisarInicio(k, metodo, url);
        p.then(function (r) {
          try { r.clone().text().then(function (t) { avisar(metodo, url, r.status, t, enviado, k); }, function () { avisar(metodo, url, r.status, "", enviado, k); }); }
          catch (e) { avisar(metodo, url, 0, "", enviado, k); }
        }, function () { avisar(metodo, url, 0, "", enviado, k); });
      }
      return p;
    };
  }

  var abrir = XMLHttpRequest.prototype.open;
  var enviar = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (metodo, url) {
    this.__cratosPrevjud = { metodo: metodo, url: absoluta(url) };
    return abrir.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (corpo) {
    var info = this.__cratosPrevjud;
    if (info && permitido(info.url, typeof corpo === "string" ? corpo : null) && String(info.metodo).toUpperCase() !== "OPTIONS") {
      var enviado = typeof corpo === "string" ? corpo : null;
      var xhr = this;
      var k = ++req;
      avisarInicio(k, info.metodo, info.url);
      xhr.addEventListener("loadend", function () {
        var t = "";
        try { t = typeof xhr.responseText === "string" ? xhr.responseText : ""; } catch (e) { /* responseType não-texto */ }
        if (!t) {
          try { if (xhr.response && typeof xhr.response === "object") t = JSON.stringify(xhr.response); } catch (e) { /* nada */ }
        }
        avisar(info.metodo, xhr.responseURL || info.url, xhr.status, t, enviado, k);
      });
    }
    return enviar.apply(this, arguments);
  };
})();
