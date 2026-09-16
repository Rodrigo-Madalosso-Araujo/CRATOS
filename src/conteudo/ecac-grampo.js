/*
 * conteudo/ecac-grampo.js — GRAMPO DE ALERTA, roda no CONTEXTO DA PÁGINA.
 *
 * POR QUE EXISTE (21/08, produção): o eCAC falhou ao montar o combobox de anos
 * — a resposta veio como a página de erro 500 do app de autenticação — e ele
 * gritou num `alert()`. O Rodrigo clicou em OK, a extensão seguiu, terminou e
 * FECHOU a aba. O texto do alerta, que era a única pista do que houve, foi
 * embora junto.
 *
 * POR QUE O `window.alert` DO CONTENT SCRIPT NÃO SERVIA: content script no
 * Firefox enxerga a página por Xray. Escrever `window.alert = ...` de lá cria
 * uma propriedade que SÓ O CONTENT SCRIPT vê; a página continua chamando o
 * `alert` nativo. O `ecac-infojud.js` fazia exatamente isso desde o port do
 * InfoJOB, com o comentário "intercepta alerts do eCAC para não travar a
 * automação" — nunca interceptou nada, e o diálogo de 21/08 é a prova.
 *
 * O QUE ESTE GRAMPO FAZ — E O QUE ELE NÃO FAZ:
 *  · CAPTURA o texto e repassa ao content script por CustomEvent (detail em
 *    STRING, como no censec-api.js: objeto cru não atravessa a fronteira de
 *    forma confiável no Firefox).
 *  · NÃO ENGOLE o alerta: chama o original e o diálogo aparece igual. Engolir
 *    seria esconder do usuário que a sessão dele caiu — e quem decide o que
 *    fazer diante de um aviso da Receita é ele, não o CRATOS. O preço é que o
 *    alerta continua travando a página até o OK; o ganho é que agora ele deixa
 *    rastro.
 *
 * READ-ONLY sobre o comportamento: observa e repassa.
 */
(function () {
  "use strict";
  if (window.__cratosEcacGrampo) return;
  window.__cratosEcacGrampo = true;

  const EVENTO = "cratos:ecac:alerta";
  const alertOriginal = window.alert;

  window.alert = function (msg) {
    try {
      window.dispatchEvent(new CustomEvent(EVENTO, {
        detail: JSON.stringify({ texto: String(msg == null ? "" : msg) }),
      }));
    } catch (e) { /* se o aviso não sair, o alerta ainda tem de aparecer */ }
    return alertOriginal.apply(this, arguments);
  };
})();
