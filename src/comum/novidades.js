/*
 * comum/novidades.js — "Novidades da versão" (1.9.0, pedido do Rodrigo de 21/10).
 *
 * O texto mora AQUI, dentro do pacote: nada vem da rede (não muda nada para a STI).
 * Carregado no background (marca a atualização e registra a Preferência) e no
 * painel do PJe (mostra o cartão). Escrever as novidades junto com o roteiro de
 * teste de cada versão, em linguagem de usuário, 3 a 5 linhas.
 *
 * Regra: depois de uma ATUALIZAÇÃO, o painel mostra o cartão UMA vez ("Entendi"
 * apaga). Instalação nova não mostra. Quem pular versões (ex.: 1.6.5 → 1.9.0) vê
 * as novidades de todas as versões que pulou (até 4). Preferência desliga.
 */
(function () {
  "use strict";
  if (globalThis.CratosNovidades) return;

  /* da mais nova para a mais velha */
  const VERSOES = [
    { versao: "1.9.7", data: "18/11/2026", itens: [
      "O CRATOS passa a funcionar no PJe de todos os TRTs, e não só no da 18ª Região. O SAB continua aparecendo só nos tribunais em que ele existe.",
      "Certidão de convênios: passa a dizer contra quem a diligência foi feita, com nome e CPF/CNPJ — uma vez na abertura, quando as partes são as mesmas em todos os convênios, ou em cada linha, quando são diferentes.",
      "SNIPER: investiga só as partes marcadas no CRATOS. Antes, ia todo o polo passivo que o SNIPER trazia.",
      "Painel: os terceiros interessados do processo voltam a aparecer na lista de partes (às vezes sumiam). Eles vêm desmarcados.",
    ] },
    { versao: "1.9.6", data: "13/11/2026", itens: [
      "Juntada: o tipo de documento passa a ser procurado também no catálogo completo do PJe — antes, processo que ainda não tinha nenhum \"Sisbajud (transferência)\" recusava a juntada.",
      "SAB: a \"possível duplicidade\" agora compara data E hora (um documento juntado de manhã não é mais confundido com a ordem da tarde do mesmo dia).",
      "Lote do SAB: o relatório só mostra \"juntado\" quando a minuta foi criada de fato.",
    ] },
    { versao: "1.9.5", data: "13/11/2026", itens: [
      "SAB: a transferência já enviada ao banco passa a ser juntada mesmo antes da confirmação da instituição (é nela que a vara intima a parte). Na certidão consolidada ela aparece como \"transf. enviada\", com o valor.",
    ] },
    { versao: "1.9.4", data: "13/11/2026", itens: [
      "SAB: novo botão \"Coletar SAB\" no processo — uma certidão consolidada por determinação (no visual do relatório do SNIPER), com os relatórios de detalhamento das ordens com transferência, obtidos pelo próprio SAB. O que já está nos autos não é juntado de novo.",
      "SAB: \"Coletar respostas SAB\" no Meu painel — escolha o dia (vem o dia útil anterior) e o CRATOS junta, processo a processo, as transferências daquele dia, com relatório final e assinatura assistida (quem assina é você).",
      "SAB: alerta \"obrigação realizada — verificar garantia do juízo\" quando o remanescente chega a R$ 0,00, e atividade opcional no GIGS (Preferências).",
      "SAB: na BAIXA, com duas ou mais determinações ativas, o CRATOS pergunta qual interromper; sem nenhuma ativa, avisa.",
      "Preferências: novo bloco \"Convênios em uso\" — desligue os convênios que você não usa e eles saem da fila e dos botões do painel. O SAB só aparece nos tribunais em que existe (TRTs 3, 10 e 18).",
      "Certidões em PDF: travessão, aspas curvas e reticências voltam a aparecer (sumiam do texto).",
    ] },
    { versao: "1.9.3", data: "10/11/2026", itens: [
      "Manual do usuário dentro do CRATOS: botão nas Preferências e nos Primeiros passos, abre sem internet e sempre na versão instalada.",
      "Nas Preferências, o \"?\" ao lado de cada convênio abre o manual direto na seção dele.",
      "O botão \"Localizar resultado na caixa postal\" passa a se chamar \"Coletar INFOJUD (resultados na caixa postal)\", como os de CCS e PREVJUD.",
      "SNIPER: o relatório ganha visual novo (seções em azul, tabelas, selo por fonte, páginas numeradas) e passa a trazer o grafo de vínculos, redesenhado, com uma ficha por terceiro vinculado. Nas Preferências, você escolhe se junta o grafo e os processos das partes (DataJud).",
      "Preferências: \"Exportar configurações\" e \"Importar configurações\" — backup, outro computador ou o padrão da unidade, conferindo o que muda antes de aplicar.",
      "Fila: novo botão \"Refazer — no fim da fila\" quando um convênio dá erro (nos atos, só enquanto a ordem não pode ter chegado ao sistema).",
    ] },
    { versao: "1.9.2", data: "26/10/2026", itens: [
      "Primeiros passos: uma página com o essencial para configurar (vara do e-CAC, RENAJUD, pasta, juntada). Abre na primeira instalação e fica num botão das Preferências.",
      "INFOJUD: o botão \"Ler as varas do meu e-CAC\" traz a lista de varas do seu próprio e-CAC para as Preferências.",
      "RENAJUD: o tribunal vem do endereço do PJe; o órgão e o magistrado, se estiverem em branco, são perguntados na primeira inclusão e guardados.",
      "INFOJUD: novo padrão de consultas (CPF: DIRPF 2 anos, DITR, DECRED e DIMOB 1 ano, DOI; CNPJ: DITR, DECRED e DIMOB 1 ano, DOI), que vale mesmo sem abrir as Preferências.",
      "Preferências → Sobre: botão \"Procurar atualização\", que confere na hora se há versão nova e oferece \"Instalar agora\".",
      "CCS: quando o Banco Central devolve a página em branco duas vezes, o aviso explica as duas causas possíveis (instabilidade do BCB ou cookie antigo) e o que fazer em cada uma.",
      "Correção: o cartão de novidades não aparece mais dobrado.",
    ] },
    { versao: "1.9.1", data: "26/10/2026", itens: [
      "CCS: quando o Banco Central devolve uma página vazia, o CRATOS avisa que é instabilidade do CCS e pede para tentar o Coletar CCS mais tarde.",
      "CCS: se aparecer uma tela que o CRATOS não conhece, o aviso e o relatório de problema dizem qual tela foi (sem dados de pessoas).",
      "Primeira versão distribuída também pela atualização automática do Firefox.",
    ] },
    { versao: "1.9.0", data: "22/10/2026", itens: [
      "Este cartão: a cada atualização, o CRATOS conta aqui o que mudou.",
      "Botão \"Verificar disponibilidade\": mede se um convênio está fora do ar e, se estiver, oferece uma certidão de indisponibilidade (só com a sua confirmação).",
      "Na fila, quando um convênio falha ou não responde, o CRATOS verifica sozinho se o sistema está fora do ar e marca \"indisponível\".",
      "Mais privacidade: os dados de cada processo são apagados ao fechar a aba dele. Junte as certidões antes de fechar — se houver arquivo do CRATOS ainda não juntado, o Firefox pede confirmação.",
      "Atualização automática: as próximas versões chegam sozinhas pelo Firefox.",
      "INFOJUD: antes das solicitações, o CRATOS pesquisa as empresas em que cada executado pessoa física é o responsável (\"Recuperar NI – CNPJ\") e gera uma certidão com o endereço de cada uma.",
    ] },
    { versao: "1.8", data: "22/10/2026", itens: [
      "PREVJUD (Dossiê Previdenciário): o CRATOS pede o dossiê de cada executado pessoa física, espera o INSS e junta os PDFs oficiais, com certidão documento por documento.",
      "Nas Preferências, você escolhe quais documentos do dossiê juntar.",
      "Botão \"Coletar PREVJUD\": busca os dossiês prontos do processo (últimos 7 dias), mesmo que já tenham sido juntados.",
    ] },
    { versao: "1.7", data: "21/10/2026", itens: [
      "SNIPER (investigação patrimonial): o CRATOS faz a investigação e junta o relatório, com o cadastro da Receita e os processos de cada parte, mais a certidão.",
    ] },
    { versao: "1.6", data: "19/10/2026", itens: [
      "CCS (Bacen): requisição e coleta das respostas das instituições.",
      "Baixa sem restrição ativa (CNIB e RENAJUD) passa a gerar certidão.",
      "Endurecimento de segurança pedido pela STI.",
    ] },
  ];

  /* "1.8.7" > "1.8" etc. — compara número a número; ausente = 0 */
  function comparar(a, b) {
    const x = String(a || "0").split(".").map((n) => parseInt(n, 10) || 0);
    const y = String(b || "0").split(".").map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const d = (x[i] || 0) - (y[i] || 0);
      if (d) return d;
    }
    return 0;
  }
  /* "1.8" cobre 1.8.0…1.8.x: é nova para quem vinha de uma versão ANTERIOR a 1.8.0 */
  function inicioDe(v) { return String(v).split(".").length === 2 ? v + ".0" : v; }

  /* As entradas que quem atualizou de `de` para `para` ainda não viu (até 4). */
  function paraMostrar(de, para) {
    return VERSOES.filter((e) => comparar(inicioDe(e.versao), para) <= 0 &&
      (!de || comparar(de, inicioDe(e.versao)) < 0)).slice(0, 4);
  }

  /* runtime.onInstalled (background). Só ATUALIZAÇÃO marca; instalação nova, não. */
  async function aoInstalar(detalhes, versaoAtual, store) {
    if (!detalhes || detalhes.reason !== "update") return null;
    const de = String(detalhes.previousVersion || "");
    if (!versaoAtual || de === versaoAtual) return null;   // recarga da mesma versão
    if (!paraMostrar(de, versaoAtual).length) return null;
    const pend = { de, para: versaoAtual, em: Date.now() };
    await store.set("novidades_pendente", pend);
    return pend;
  }

  globalThis.CratosNovidades = { VERSOES, comparar, paraMostrar, aoInstalar };

  /* Preferência (tela de opções lê o catálogo do background) */
  if (typeof Registro !== "undefined") {
    Registro.adicionar({
      nome: "novidades",
      rotulo: "Novidades da versão",
      config: {
        mostrar: { tipo: "toggle", padrao: { ativo: true }, rotulo: "Mostrar no painel as novidades depois de cada atualização" },
      },
    });
  }
  if (typeof module !== "undefined" && module.exports) module.exports = globalThis.CratosNovidades;
})();
