/*
 * modulos/historico.js — HISTÓRICO DO PROCESSO, SEM DADO DE PARTE (2.0).
 *
 * Decisão do Rodrigo (16/11/2026): "O que o CRATOS não deve gravar é dados das partes. O
 * restante, para orientação, não fere LGPD." O diário (com nomes de arquivo, que levam
 * nome e documento da parte) continua morrendo com a aba (1.9.0). Este histórico guarda
 * SÓ: convênio, fase e data. Nada de nome, documento, arquivo, valor ou texto livre —
 * `registrar` descarta qualquer outro campo, e o teste confere.
 *
 * Serve à "Situação do processo": lembra, por exemplo, que o INFOJUD foi pedido em 11/11
 * mesmo depois de a aba ter sido fechada.
 *
 * Prazo (Rodrigo, 16/11): o histórico de um processo é apagado 6 meses depois do último
 * evento dele. Teto de 200 eventos por processo (os mais antigos saem primeiro).
 *
 * Chave: cratos:historico:<20 dígitos> = { atualizadoEm, eventos: [{ convenio, fase, em }] }
 */
(function () {
  "use strict";
  if (globalThis.CratosHistorico) return;

  const PREFIXO = "historico:";
  const PRAZO_MS = 183 * 24 * 3600 * 1000;       // ~6 meses
  const TETO = 200;
  const CONVENIOS = ["SAB", "INFOJUD", "RENAJUD", "CNIB", "CENSEC", "SERASAJUD", "CCS", "SNIPER", "PREVJUD"];
  const FASES = ["pedido", "resposta", "inclusao", "baixa", "consulta", "indisponivel"];
  const armazem = () => browser.storage.local;
  const NS = () => (globalThis.CRATOS_NS || "cratos:");

  function digitos(v) { return String(v == null ? "" : v).replace(/\D/g, ""); }
  function chave(num) { return NS() + PREFIXO + digitos(num); }

  const H = {
    PREFIXO, PRAZO_MS, TETO,
    _fila: Promise.resolve(),

    /* Só convênio conhecido, fase conhecida e processo de 20 dígitos. O resto nem entra. */
    registrar(numProcesso, convenio, fase, em) {
      const n = digitos(numProcesso);
      const c = String(convenio || "").toUpperCase() === "SISBAJUD" ? "SAB" : String(convenio || "").toUpperCase();
      if (n.length !== 20 || CONVENIOS.indexOf(c) < 0 || FASES.indexOf(fase) < 0) return Promise.resolve(null);
      const quando = new Date(em == null ? Date.now() : em);
      if (isNaN(quando.getTime())) return Promise.resolve(null);
      const proximo = this._fila.then(async () => {
        const k = chave(n);
        const got = await armazem().get(k);
        const atual = (got && got[k]) || { eventos: [] };
        const eventos = Array.isArray(atual.eventos) ? atual.eventos : [];
        eventos.push({ convenio: c, fase, em: quando.toISOString() });
        const limpo = { atualizadoEm: new Date().toISOString(), eventos: eventos.slice(-TETO) };
        await armazem().set({ [k]: limpo });
        return limpo;
      });
      this._fila = proximo.catch(() => {});
      return proximo.catch(() => null);
    },

    async ler(numProcesso) {
      const k = chave(numProcesso);
      const got = await armazem().get(k);
      const h = got && got[k];
      if (!h || !Array.isArray(h.eventos)) return [];
      if (Date.now() - Date.parse(h.atualizadoEm) > PRAZO_MS) return [];
      return h.eventos.map((e) => ({ convenio: e.convenio, fase: e.fase, em: e.em, origem: "historico" }));
    },

    /* Apaga o histórico de processo sem evento há mais de 6 meses. Roda ao abrir o Firefox. */
    async purgar(agora) {
      const t = agora == null ? Date.now() : agora;
      const tudo = await armazem().get(null);
      const fora = [];
      for (const [k, v] of Object.entries(tudo || {})) {
        if (k.indexOf(NS() + PREFIXO) !== 0) continue;
        const ult = v && Date.parse(v.atualizadoEm);
        if (!ult || t - ult > PRAZO_MS) fora.push(k);
      }
      if (fora.length) await armazem().remove(fora);
      return fora;
    },

    ehChave(k) { return String(k || "").indexOf(NS() + PREFIXO) === 0; },
  };

  globalThis.CratosHistorico = H;
  if (typeof module !== "undefined" && module.exports) module.exports = H;
})();
