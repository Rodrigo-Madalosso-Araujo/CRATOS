/*
 * comum/convenios-uso.js — CONVÊNIOS EM USO (1.9.4, pedido do Rodrigo em 13/11/2026).
 *
 * Uma chave liga/desliga por convênio, nas Preferências. Desligado, o convênio some de
 * tudo o que inicia trabalho novo: a fila (inclusão e baixa), o botão de coleta dele, o
 * lote do SAB, o "Verificar disponibilidade" e os pendentes dos Primeiros passos. A
 * configuração dele fica guardada; o que já foi feito continua indo para a juntada.
 *
 * SAB: regra DURA, por tribunal. O SAB existe só nos TRTs da lista abaixo; nos demais
 * ele NÃO APARECE (nem a chave). Quando o SAB chegar a outro tribunal, libera-se aqui,
 * numa versão nova do CRATOS ("conforme for implementando o SAB nos demais, atualizamos
 * o CRATOS liberando o módulo" — Rodrigo, 13/11). Tribunal ainda desconhecido (nenhum
 * processo aberto) = não se decide nada: o SAB aparece.
 *
 * Puro + registro do bloco nas Preferências (pseudo-módulo "convenios", como a
 * juntada: só configuração, sem `executar`). Carregado logo depois do registro.js, para
 * ser o PRIMEIRO bloco da tela.
 */
(function () {
  "use strict";
  if (globalThis.CratosConveniosUso) return;

  const SAB_TRTS = [3, 10, 18];          // onde o SAB existe (13/11/2026)

  /* A ordem é a do painel; `nome` = o do módulo (chave do config), `id` = o do painel. */
  const CONVENIOS = [
    { nome: "sab", id: "SAB", rotulo: "SAB (bloqueio / SISBAJUD)" },
    { nome: "infojud", id: "INFOJUD", rotulo: "INFOJUD (e-CAC / Receita)" },
    { nome: "renajud", id: "RENAJUD", rotulo: "RENAJUD (veículos)" },
    { nome: "cnib", id: "CNIB", rotulo: "CNIB (indisponibilidade)" },
    { nome: "censec", id: "CENSEC", rotulo: "CENSEC (escrituras e procurações)" },
    { nome: "serasajud", id: "SERASAJUD", rotulo: "SerasaJUD (negativação)" },
    { nome: "ccs", id: "CCS", rotulo: "CCS (Banco Central)" },
    { nome: "sniper", id: "SNIPER", rotulo: "SNIPER (investigação patrimonial)" },
    { nome: "prevjud", id: "PREVJUD", rotulo: "PREVJUD (Dossiê Previdenciário)" },
  ];

  /* "https://pje.trt18.jus.br" → 18; desconhecido → null. */
  function trtDoHost(base) {
    const m = String(base || "").match(/(?:^|\/\/)pje\.trt(\d{1,2})\.jus\.br/i);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    return n >= 1 && n <= 24 ? n : null;
  }
  /* 1.9.7 (nacionalização): a ORIGEM do PJe de um TRT, a partir de um endereço qualquer
     daquele PJe — "https://pje.trt19.jus.br/pjekz/processo/1/detalhe" →
     "https://pje.trt19.jus.br". Só os 24 TRTs, só https, sem porta nem usuário; qualquer
     outra coisa → null. É o que substitui o "pje.trt18.jus.br" fixo no código: quem abre
     o SAB ou faz a verificação de controle usa o PJe da aba em que a pessoa está. */
  function basePje(endereco) {
    let u;
    try { u = new URL(String(endereco || "")); } catch (e) { return null; }
    if (u.protocol !== "https:" || u.port || u.username || u.password) return null;
    const m = u.hostname.toLowerCase().match(/^pje\.trt(\d{1,2})\.jus\.br$/);
    if (!m || String(parseInt(m[1], 10)) !== m[1]) return null;
    const n = parseInt(m[1], 10);
    return n >= 1 && n <= 24 ? "https://pje.trt" + n + ".jus.br" : null;
  }
  /* true / false / null (não sei: tribunal desconhecido). */
  function sabExiste(base) {
    const n = trtDoHost(base);
    return n == null ? null : SAB_TRTS.indexOf(n) >= 0;
  }
  /* O convênio pode aparecer neste tribunal? (só o SAB tem restrição hoje) */
  function existeNoTribunal(idOuNome, base) {
    const k = String(idOuNome || "").toLowerCase();
    return k === "sab" ? sabExiste(base) !== false : true;
  }
  /* Ligado = existe no tribunal E a pessoa não desligou. Sem nada salvo = ligado. */
  function ligado(config, idOuNome, base) {
    const k = String(idOuNome || "").toLowerCase();
    if (!existeNoTribunal(k, base)) return false;
    const v = config && config.convenios && config.convenios[k];
    return !(v && typeof v === "object" && v.ativo === false);
  }
  function ligados(config, base) {
    return CONVENIOS.filter((c) => ligado(config, c.nome, base)).map((c) => c.id);
  }

  const api = { SAB_TRTS, CONVENIOS, trtDoHost, basePje, sabExiste, existeNoTribunal, ligado, ligados };
  globalThis.CratosConveniosUso = api;

  if (typeof Registro !== "undefined") {
    const config = {
      _aviso: {
        tipo: "aviso",
        texto: "Desligue os convênios que você não usa: eles saem da lista da fila e dos botões de coleta do painel. " +
          "A configuração de cada um continua guardada, e o que já foi feito continua indo para a juntada. " +
          "O SAB só aparece nos tribunais em que ele existe.",
      },
    };
    for (const c of CONVENIOS) config[c.nome] = { tipo: "toggle", padrao: { ativo: true }, rotulo: c.rotulo };
    Registro.adicionar({ nome: "convenios", rotulo: "Convênios em uso", requer: [], config });
  }
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
