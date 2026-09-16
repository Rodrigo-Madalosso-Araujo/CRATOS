/*
 * registro.js — registro central dos módulos de convênio.
 *
 * Cada módulo é um objeto que segue este contrato. O motor (background.js) só
 * conhece o contrato, nunca um convênio específico. Adicionar um convênio novo =
 * criar um arquivo em modulos/ e chamar Registro.adicionar(...). Nada mais muda.
 *
 * CONTRATO de um módulo:
 * {
 *   nome:         "infojob",                // id único, minúsculo
 *   rotulo:       "InfoJob",               // nome exibido ao usuário
 *   requer:       ["cpfcnpj"],             // campos que cada parte precisa ter
 *   suportaLote:  false,                    // true = recebe todas as partes de uma vez
 *
 *   // schema de configuração (renderiza a tela de opções sozinho)
 *   config: {
 *     <chave>: { tipo, opcoes?, min?, max?, padrao, rotulo }
 *   },
 *
 *   resumirConfig(cfg): string,             // linha legível p/ a confirmação
 *
 *   async executar(parte|partes, ctx): { status, protocolo?, dados? },
 *   async coletarResultado(bloco, ctx): { textoCertidao, html? },
 * }
 */

const Registro = {
  _modulos: new Map(),

  adicionar(mod) {
    if (!mod || !mod.nome) throw new Error("CRATOS: módulo sem nome.");
    this._modulos.set(mod.nome, mod);
  },

  obter(nome) { return this._modulos.get(nome); },

  todos() { return Array.from(this._modulos.values()); },

  /* Metadados leves para a UI — sem funções, serializável para o content script. */
  catalogo() {
    return this.todos().map((m) => ({
      nome: m.nome,
      rotulo: m.rotulo,
      requer: m.requer || [],
      config: m.config || {},
    }));
  },
};

if (typeof module !== "undefined") { module.exports = { Registro }; }
