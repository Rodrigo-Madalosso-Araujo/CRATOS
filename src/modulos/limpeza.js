/*
 * modulos/limpeza.js — os dados de cada processo vivem SÓ enquanto a aba dele está
 * aberta (1.9.0, decisão do Rodrigo em 22/10: "manter a extensão clean de
 * arquivamentos a curto prazo"; LGPD, necessidade e término do tratamento).
 *
 *  - O painel avisa ao fundo em que aba do PJe está cada processo (`registrar`).
 *  - Fechou a aba → apaga TUDO daquele processo (diário de arquivos, registros de
 *    pedidos do CCS/PREVJUD, estados de trabalho parados, a captura do processo) e os
 *    PDFs da memória — a menos que o mesmo processo esteja aberto em outra aba.
 *  - Abriu o Firefox → apaga o que tiver sobrado (navegador fechado ou travado).
 *  - Ficam SEMPRE: Preferências, liga/desliga, marca de novidades, ordem e posição do
 *    painel, organização do CNIB — nada disso tem dado de parte.
 * Estado de trabalho ATIVO (convênio rodando agora noutra aba) não é apagado ao fechar.
 */
const LIMPEZA_MANTER = ["config", "extensao_ligada", "novidades_pendente", "trt", "orquestra_ordem", "botao_pos", "cnib_organizacao"]
  .map((k) => "cratos:" + k);

const Limpeza = {
  abas: new Map(),            // tabId -> Set(nº do processo, 20 dígitos)
  armazem: () => browser.storage.local,
  aoApagarProcesso: null,     // gancho do fundo (ex.: limpar o Cofre em memória)

  digitos(v) { return String(v == null ? "" : v).replace(/\D/g, ""); },
  procDe(v) {
    if (!v || typeof v !== "object") return "";
    return this.digitos(v.numeroDigitos || v.numProcesso || v.numeroProcesso || v.numero || "");
  },

  registrar(tabId, numProcesso) {
    const n = this.digitos(numProcesso);
    if (tabId == null || n.length !== 20) return false;
    if (!this.abas.has(tabId)) this.abas.set(tabId, new Set());
    this.abas.get(tabId).add(n);
    return true;
  },

  async aoFecharAba(tabId) {
    const procs = this.abas.get(tabId);
    this.abas.delete(tabId);
    if (!procs) return [];
    const abertos = new Set();
    for (const s of this.abas.values()) for (const n of s) abertos.add(n);
    const apagados = [];
    for (const n of procs) {
      if (abertos.has(n)) continue;              // o mesmo processo segue aberto noutra aba
      await this.apagarProcesso(n);
      apagados.push(n);
    }
    return apagados;
  },

  async apagarProcesso(num) {
    const n = this.digitos(num);
    if (n.length !== 20) return [];
    const tudo = await this.armazem().get(null);
    const fora = [];
    for (const [k, v] of Object.entries(tudo || {})) {
      if (!k.startsWith("cratos:") || LIMPEZA_MANTER.includes(k)) continue;
      const suf = k.match(/:(\d{20})$/);
      if (suf) { if (suf[1] === n) fora.push(k); continue; }
      if (this.procDe(v) === n && !(v && v.ativo)) fora.push(k);
    }
    if (fora.length) await this.armazem().remove(fora);
    try { if (this.aoApagarProcesso) this.aoApagarProcesso(n); } catch (e) { /* nada */ }
    return fora;
  },

  async aoIniciar() {
    const tudo = await this.armazem().get(null);
    const fora = Object.keys(tudo || {}).filter((k) => k.startsWith("cratos:") && !LIMPEZA_MANTER.includes(k));
    if (fora.length) await this.armazem().remove(fora);
    return fora;
  },
};

if (typeof module !== "undefined" && module.exports) module.exports = { Limpeza, LIMPEZA_MANTER };
