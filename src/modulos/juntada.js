/*
 * modulos/juntada.js — só CONFIGURAÇÃO.
 *
 * A juntada não é um convênio: não tem `executar`, não entra na fila do
 * orquestrador e não aparece na lista de convênios do painel. Ela existe aqui
 * apenas para ter um lugar próprio na tela de Preferências — o `catalogo()` do
 * Registro pede nome, rótulo e config, e nada mais.
 *
 * Por que não pendurar este toggle no SAB ou no INFOJUD: a juntada é do
 * PROCESSO, não de um convênio. Pendurada no lugar errado, ela seria procurada
 * onde não está — e é a mesma doença das três cópias da pasta de download.
 */
if (typeof Registro !== "undefined") {
  Registro.adicionar({
    nome: "juntada",
    rotulo: "Juntada da certidão no PJe",
    requer: [],
    config: {
      /* Decisão do Rodrigo em 20/08, implementada em 02/09 (1.1.1): o gatilho é
         automático, com Preferência para desligar.
         ⚠ Ligado, ao fim da fila o CRATOS CRIA a minuta nos autos. Ela nasce
         como rascunho NÃO ASSINADO — e o CRATOS não assina, nem chega perto do
         botão. Ainda assim é documento que passa a existir no processo, e por
         isso a opção existe e o painel mostra o que fez. */
      automatica: {
        tipo: "escolha",
        opcoes: [
          { valor: "sim", rotulo: "Criar a minuta da certidão ao terminar a fila" },
          { valor: "nao", rotulo: "Não criar sozinho — eu uso o botão do painel" },
        ],
        padrao: "sim",
        rotulo: "Ao terminar os convênios",
      },
      /* Visibilidade do documento às partes (pedido do Rodrigo, HAR de 03/09).
         Os anexos nascem `sigiloso:true`, então SEM isto as partes não enxergam
         a certidão. Marcando os dois polos, dá para todos. Vazio = não mexe na
         visibilidade das partes (só o incluidor, como antes). Aplicada na
         MINUTA, junto da criação — a extensão nunca assina. */
      visibilidadePartes: {
        tipo: "multiselect",
        opcoes: ["Polo ativo", "Polo passivo"],
        padrao: ["Polo ativo", "Polo passivo"],
        rotulo: "Dar visibilidade da certidão às partes",
      },
      aviso: {
        tipo: "aviso",
        texto: "O CRATOS cria a minuta e PARA. Conferir, anexar o que faltar e " +
          "assinar é sempre ato seu — aqui não existe diálogo de confirmação: se " +
          "você já assinou algo na sessão, o clique em Assinar assina direto.",
      },
    },
  });
}
