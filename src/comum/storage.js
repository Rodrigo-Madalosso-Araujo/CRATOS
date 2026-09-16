/*
 * storage.js — acesso ao browser.storage.local com namespace "cratos:".
 * Carregado tanto no content script quanto no background.
 * Nenhuma chave é gravada sem o prefixo, para nunca colidir com outra extensão.
 *
 * Guard de idempotência: em páginas que casam mais de um content_script (ex.: /sab/
 * casa tanto "pje.trt18.jus.br/*" quanto "pje.trt18.jus.br/sab/*"), este arquivo pode
 * ser injetado duas vezes. O guard evita "redeclaration of const" e mantém uma única
 * instância de Store/CHAVES/CRATOS_NS.
 */
if (typeof globalThis.CRATOS_NS === "undefined") {

  globalThis.CRATOS_NS = "cratos:";
  const CRATOS_NS = globalThis.CRATOS_NS;

  const Store = {
  _k(chave) {
    return chave.startsWith(CRATOS_NS) ? chave : CRATOS_NS + chave;
  },

  async get(chave) {
    const k = this._k(chave);
    const r = await browser.storage.local.get(k);
    return r[k];
  },

  async set(chave, valor) {
    await browser.storage.local.set({ [this._k(chave)]: valor });
    return valor;
  },

  async remove(chave) {
    await browser.storage.local.remove(this._k(chave));
  },

  /* Chave global liga/desliga da extensão. Padrão LIGADO: só `false` explícito
     desliga (undefined = nunca configurado = ligado). Content scripts conferem no
     carregamento e saem de cena se estiver desligado. */
  async ligada() {
    return (await this.get("extensao_ligada")) !== false;
  },

  /* Escuta mudanças de UMA chave específica (já com namespace resolvido).
     Devolve uma função para cancelar a escuta. */
  onChange(chave, callback) {
    const alvo = this._k(chave);
    const handler = (mudancas, area) => {
      if (area !== "local") return;
      if (alvo in mudancas) {
        callback(mudancas[alvo].newValue, mudancas[alvo].oldValue);
      }
    };
    browser.storage.onChanged.addListener(handler);
    return () => browser.storage.onChanged.removeListener(handler);
  },
};

/* Chaves conhecidas — um lugar só, para não espalhar strings soltas. */
  const CHAVES = {
    processo: "processo",     // dados capturados do processo em tela
    execucao: "execucao",     // estado da fila de execução (motor)
    config: "config",         // configurações dos módulos
    trt: "trt",               // domínio/base do PJe detectado
  };

  // Expõe no escopo global para os demais scripts (content e background)
  globalThis.Store = Store;
  globalThis.CHAVES = CHAVES;

  if (typeof module !== "undefined") { module.exports = { Store, CHAVES, CRATOS_NS }; }

} // fim do guard de idempotência
