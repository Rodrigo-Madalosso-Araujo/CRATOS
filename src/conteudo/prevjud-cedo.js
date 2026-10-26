/*
 * conteudo/prevjud-cedo.js — ESCUTA de leitura da API do PREVJUD, em document_START.
 *
 * 1.8.4 (teste ao vivo de 22/10): o grampo injetado como <script> na página NÃO entrava
 * (`window.__cratosPrevjudGrampo` = undefined no console da página) — a página o barra
 * ou se recarrega por cima. Agora a escuta é feita DAQUI, do lado da extensão, pelo
 * recurso próprio do Firefox para isso (`window.wrappedJSObject` + `exportFunction`):
 * nada é inserido na página, não há o que a política de segurança do site barrar, e
 * entra antes de qualquer código da página.
 *
 * SÓ LEITURA: não lê nem repassa cabeçalho (o token nunca sai daqui), não altera
 * requisição nem resposta. Toda falha aqui é engolida e a chamada da PÁGINA segue
 * intacta — a escuta nunca pode quebrar o PREVJUD.
 *
 * 1.9.0 (revisão de segurança, 22/10):
 *  - SÓ as rotas do Dossiê Previdenciário (`dossiePrevidenciario/` e `previdenciario/`)
 *    e, na lista de pedidos, só a do tipo PREVIDENCIARIO. Dossiê Médico e o resto do
 *    PREVJUD passam batidos — o CRATOS não capta dado de saúde.
 *  - CANAL INTERNO: nada vai para evento da página (que qualquer script do site poderia
 *    ler ou FORJAR). O content script assina por `window.__cratosPrevjudEscuta`, que
 *    existe só no lado da extensão.
 *  - Desligável: sem tarefa do CRATOS, conteudo/prevjud.js chama `desligar()`, que
 *    apaga a memória e para de guardar. Até lá, só as primeiras 40 respostas ficam na
 *    memória (a lista que a tela busca ao abrir).
 *  - Sem o recurso do Firefox, não faz nada: conteudo/prevjud.js põe o grampo de
 *    página (reserva) SÓ se houver tarefa ativa.
 * Endereço RELATIVO é completado antes de comparar.
 */
(function () {
  "use strict";
  var ALVO = /\/previdenciario-api\/api\/v\d+\/(dossiePrevidenciario|previdenciario)\//i;
  var MEMORIA = 40;
  var memoria = [];
  var seq = 0;
  var ligada = true;
  var receber = null, receberInicio = null;

  function absoluta(u) {
    try { return new URL(String(u == null ? "" : u), location.href).href; } catch (e) { return String(u == null ? "" : u); }
  }
  function permitido(url, enviado) {
    if (!ligada || !ALVO.test(url)) return false;
    if (/pesquisarPedidosDossie/i.test(url) && typeof enviado === "string" && /"tipo"\s*:/.test(enviado) &&
      !/"tipo"\s*:\s*"PREVIDENCIARIO"/i.test(enviado)) return false;
    return true;
  }
  /* cada pedido leva um nº (`k`) no INÍCIO e no FIM: o content script sabe quando TODOS
     os documentos que a página pediu terminaram de chegar (1.8.6) */
  var req = 0;
  function avisarInicio(k, metodo, url) {
    if (!ligada || !receberInicio) return;
    try { receberInicio(JSON.stringify({ k: k, metodo: String(metodo || "GET").toUpperCase(), url: String(url || "") })); } catch (e) { /* nada */ }
  }
  function avisar(metodo, url, status, corpo, enviado, k) {
    if (!ligada) return;
    try {
      var detail = JSON.stringify({
        n: ++seq,
        k: k == null ? null : k,
        metodo: String(metodo || "GET").toUpperCase(),
        url: String(url || ""),
        status: Number(status) || 0,
        corpo: typeof corpo === "string" ? corpo : "",
        enviado: typeof enviado === "string" ? enviado : null,
      });
      if (receber) { receber(detail); return; }
      memoria.push(detail);
      if (memoria.length > MEMORIA) memoria.shift();
    } catch (e) { /* o content script cai no prazo e avisa */ }
  }
  var canal = {
    assinar: function (fApi, fInicio) {
      if (!ligada) return false;
      receber = typeof fApi === "function" ? fApi : null;
      receberInicio = typeof fInicio === "function" ? fInicio : null;
      var lista = memoria;
      memoria = [];
      for (var i = 0; i < lista.length; i++) { try { receber(lista[i]); } catch (e) { /* nada */ } }
      return true;
    },
    desligar: function () { ligada = false; receber = null; receberInicio = null; memoria = []; },
  };
  function marcar(como) {
    try { window.__cratosPrevjudCedo = como; } catch (e) { /* nada */ }
    try { document.documentElement.setAttribute("data-cratos-prevjud", "escutando"); } catch (e) { /* nada */ }
  }

  function escutarPeloFirefox() {
    var pw = window.wrappedJSObject;
    if (!pw || typeof exportFunction !== "function") return false;
    var exportar = exportFunction;
    var proto = pw.XMLHttpRequest && pw.XMLHttpRequest.prototype;
    if (!proto || typeof proto.open !== "function" || typeof proto.send !== "function") return false;
    var abrir = proto.open;
    var enviar = proto.send;
    var buscar = pw.fetch;
    var info = new WeakMap();
    /* ⛔ 1.8.5: o repasse à função ORIGINAL é feito com o Reflect.apply DESTE lado,
       entregando os valores um a um. Na 1.8.4 era o "apply" da PÁGINA recebendo o
       `arguments` da extensão, que o Firefox barra: toda chamada da página falhava,
       inclusive a do login (a tela parou no "Plataforma Digital do Poder Judiciário"). */
    var chamar = Reflect.apply;
    var lista = function (args) { return Array.prototype.slice.call(args); };

    exportar(function (metodo, url) {
      try { info.set(this, { metodo: String(metodo || "GET"), url: absoluta(url) }); } catch (e) { /* nada */ }
      return chamar(abrir, this, lista(arguments));
    }, proto, { defineAs: "open" });

    exportar(function (corpo) {
      var xhr = this;
      try {
        var i = info.get(xhr);
        if (i && i.metodo.toUpperCase() !== "OPTIONS" && permitido(i.url, typeof corpo === "string" ? corpo : null)) {
          var enviado = typeof corpo === "string" ? corpo : null;
          var k = ++req;
          avisarInicio(k, i.metodo, i.url);
          xhr.addEventListener("loadend", function () {
            var t = "";
            try { t = typeof xhr.responseText === "string" ? xhr.responseText : ""; } catch (e) { /* responseType não-texto */ }
            if (!t) {
              try {
                var r = xhr.wrappedJSObject ? xhr.wrappedJSObject.response : xhr.response;
                if (r && typeof r === "object") t = (pw.JSON || JSON).stringify(r);
              } catch (e) { /* nada */ }
            }
            var u = i.url;
            try { u = xhr.responseURL || i.url; } catch (e) { /* nada */ }
            avisar(i.metodo, u, xhr.status, t, enviado, k);
          });
        }
      } catch (e) { /* a chamada da página segue */ }
      return chamar(enviar, this, lista(arguments));
    }, proto, { defineAs: "send" });

    if (typeof buscar === "function") {
      exportar(function (entrada, init) {
        var p = chamar(buscar, pw, lista(arguments));
        try {
          var bruta = typeof entrada === "string" ? entrada : (entrada && (entrada.url || entrada.href)) || String(entrada || "");
          var url = absoluta(bruta);
          var metodo = String((init && init.method) || (entrada && typeof entrada === "object" && entrada.method) || "GET");
          var enviado = init && typeof init.body === "string" ? init.body : null;
          if (metodo.toUpperCase() !== "OPTIONS" && permitido(url, enviado)) {
            var k = ++req;
            avisarInicio(k, metodo, url);
            p.then(exportar(function (r) {
              try {
                r.clone().text().then(exportar(function (t) { avisar(metodo, url, r.status, String(t), enviado, k); }, pw),
                  exportar(function () { avisar(metodo, url, r.status, "", enviado, k); }, pw));
              } catch (e) { avisar(metodo, url, 0, "", enviado, k); }
            }, pw), exportar(function () { avisar(metodo, url, 0, "", enviado, k); }, pw));
          }
        } catch (e) { /* a chamada da página segue */ }
        return p;
      }, pw, { defineAs: "fetch" });
    }

    /* ⛔ Teste na instalação, sem rede: se a chamada da página não passar pela escuta,
       desfaz TUDO na hora e cai no método antigo — a página nunca fica quebrada. */
    try {
      var x = new pw.XMLHttpRequest();
      x.open("GET", location.href);
      try { x.abort(); } catch (e) { /* nada */ }
      if (typeof buscar === "function") {
        var r = pw.fetch("data:,");
        try { r.then(null, exportar(function () { /* nada */ }, pw)); } catch (e) { /* nada */ }
      }
    } catch (e) {
      try { proto.open = abrir; proto.send = enviar; if (typeof buscar === "function") pw.fetch = buscar; } catch (e2) { /* nada */ }
      try { console.warn("CRATOS/PREVJUD: escuta pelo Firefox recusada no teste — usando o método antigo.", String((e && e.message) || e)); } catch (e3) { /* nada */ }
      return false;
    }
    return true;
  }

  var ok = false;
  try { ok = escutarPeloFirefox(); } catch (e) { ok = false; }
  if (ok) {
    marcar("firefox");
    try { window.__cratosPrevjudEscuta = canal; } catch (e) { /* nada */ }
  }
  /* sem o recurso do Firefox: nada aqui (a reserva é decidida pelo content script) */
})();
