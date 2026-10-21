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

/* ═══ CratosHTML — montagem SEGURA de HTML (1.5.5) ════════════════════════════
 * Endurecimento pedido na análise da Divisão de Segurança Cibernética (chamado
 * 35323): todo dado externo (nome de parte, polo, documento, mensagem de erro de
 * sistema, número de solicitação, nome de arquivo…) que vai para a tela como HTML
 * tem de passar por escape.
 *
 * Mora AQUI, no storage.js, de propósito: é o único arquivo carregado em TODOS
 * os contextos (todo content script, a tela de opções, o background e os testes).
 * Um arquivo novo exigiria mexer em cada bloco do manifest.
 *
 * Como usar (regra para código novo, inclusive módulos futuros):
 *   const html = CratosHTML.html;
 *   CratosHTML.definir(el, html`<b>${parte.nome}</b>`);    // interpolação SEMPRE escapada
 *   const linhas = partes.map((p) => html`<li>${p.nome}</li>`);
 *   CratosHTML.definir(el, html`<ul>${linhas}</ul>`);       // fragmento html`` entra cru; array junta
 *   CratosHTML.definir(el, textoSolto);                    // texto puro vira texto (escapado)
 *   el.innerHTML = "<p>fixo</p>";                           // só LITERAL fixo, sem ${} nem +
 * NUNCA atribuir HTML montado a innerHTML/outerHTML nem usar insertAdjacentHTML:
 * a suíte teste-seguranca-html.js varre src/ e reprova.
 * Só o que NASCEU de html`` (ou de confiavel/marcacaoLimitada) entra sem escape.
 * Uma string comum é sempre escapada — esquecer o escape vira texto na tela,
 * nunca HTML executável. É seguro por construção, não por disciplina.
 *
 * `confiavel(s)` é para CONSTANTE do próprio código (ex.: o SVG do botão de
 * energia). Nunca para dado que veio de fora. Cada uso deve ter comentário.
 */
if (typeof globalThis.CratosHTML === "undefined") {
  const MAPA = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" };
  const esc = (s) => (s === null || s === undefined) ? "" : String(s).replace(/[&<>"'`]/g, (c) => MAPA[c]);

  /* Marca de "HTML já seguro". É um String (objeto), então innerHTML, +, join e
     template literal o convertem para o texto sem nada de especial — inclusive
     através do Xray do content script do Firefox. */
  class HtmlSeguro extends String {}

  const _peca = (v) => {
    if (v instanceof HtmlSeguro) return v.valueOf();
    if (Array.isArray(v)) return v.map(_peca).join("");
    if (v === null || v === undefined || v === false) return "";
    return esc(v);
  };

  /* Tagged template: literais ficam como estão; interpolações são escapadas. */
  const html = (partes, ...valores) => {
    let s = partes[0];
    for (let i = 0; i < valores.length; i++) s += _peca(valores[i]) + partes[i + 1];
    return new HtmlSeguro(s);
  };

  /* Texto confiável do PRÓPRIO código com marcação simples (<b>, <i>, <br>…):
     escapa tudo e devolve só essas tags, sem atributos. Usado nos avisos das
     Preferências, que vêm do schema dos módulos. */
  const TAGS_OK = /&lt;(\/?)(b|i|em|strong|code|br)\s*\/?&gt;/gi;
  const marcacaoLimitada = (s) => new HtmlSeguro(esc(s).replace(TAGS_OK, "<$1$2>"));

  const confiavel = (s) => new HtmlSeguro(String(s == null ? "" : s));

  /* O ÚNICO ponto de escrita de HTML dinâmico do CRATOS. Fragmento html`` entra
     como HTML; qualquer outra coisa entra ESCAPADA (aparece como texto).
     Não usa innerHTML: monta os nós num documento à parte (DOMParser — não roda
     script nem carrega nada) e os coloca no elemento. É o caminho que a Mozilla
     recomenda para extensões, e o addons-linter não acusa "unsafe innerHTML". A
     segurança, porém, vem do html`` — o DOMParser não sanitiza nada sozinho. */
  const definir = (el, frag) => {
    if (!el) return;
    const doc = new DOMParser().parseFromString("<!doctype html><body>" + _peca(frag), "text/html");
    el.replaceChildren(...Array.from(doc.body.childNodes));
  };

  globalThis.CratosHTML = Object.freeze({ esc, attr: esc, html, confiavel, marcacaoLimitada, definir, HtmlSeguro });
  if (typeof module !== "undefined" && module.exports) module.exports.CratosHTML = globalThis.CratosHTML;
}
