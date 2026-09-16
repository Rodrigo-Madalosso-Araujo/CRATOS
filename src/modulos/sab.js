/*
 * modulos/sab.js — módulo SAB (Busca e Bloqueio de Ativos Financeiros).
 *
 * Tipo: INTERATIVO — prepara a operação e entrega o volante ao usuário.
 * O orquestrador aguarda a confirmação "Concluí" do painel antes de avançar.
 *
 * INCLUSÃO:
 *   1. Lança o movimento 11382 via POST same-origin (sem abrir aba).
 *   2. Consulta sab-api para obter o idSab do processo.
 *   3. Sinaliza ao background para abrir a aba do SAB na tela de minuta.
 *      O content script (conteudo/sab.js) cuida do popup de confirmação
 *      do valor e do preenchimento do campo "Valor da obrigação".
 *   4. Após "Concluí" do usuário: gera certidão PDF e sinaliza orquestrador.
 *
 * BAIXA: gancho reservado — fluxo a definir.
 */

const ModuloSAB = (() => {

  const ID_MOVIMENTO_SAB = 11382;
  const SAB_API_PROCESSOS = "/sab-api/api/processos";

  /* Aguarda o content script gravar o resultado do lançamento no storage. */
  async function _aguardarResultadoMovimento(maxMs) {
    const fim = Date.now() + maxMs;
    while (Date.now() < fim) {
      const r = await Store.get("sab_movimento_resultado");
      if (r) return r;
      await new Promise((res) => setTimeout(res, 400));
    }
    return null;
  }

  /* Busca o idSab do processo na API do SAB (same-origin). */
  async function _buscarIdSab(base, numeroProcesso) {
    const url = `${base}${SAB_API_PROCESSOS}` +
      `?pagina=1&tamanhoPagina=10&numeroProcesso=${encodeURIComponent(numeroProcesso)}`;
    const resp = await fetch(url, { headers: { Accept: "application/json" } });
    if (!resp.ok) throw new Error(`SAB API ${resp.status}`);
    const dados = await resp.json();
    if (!dados.resultado || !dados.resultado[0]) {
      throw new Error("Processo não encontrado no SAB — verifique se o movimento foi aceito.");
    }
    return {
      idSab: dados.resultado[0].id,
      situacao: dados.resultado[0].situacao,
      idPJe: dados.resultado[0].idPJe,
    };
  }

  /* Busca o idSab com retentativas — cobre indexação lenta do SAB após os 10s. */
  async function _buscarIdSabComRetry(base, numeroProcesso, tentativas = 3, intervaloMs = 5000) {
    let ultimoErro;
    for (let i = 1; i <= tentativas; i++) {
      try {
        return await _buscarIdSab(base, numeroProcesso);
      } catch (e) {
        ultimoErro = e;
        console.log(`CRATOS/SAB: idSab ainda não disponível (tentativa ${i}/${tentativas}). ` +
          (i < tentativas ? `Nova tentativa em ${intervaloMs / 1000}s...` : "Desistindo."));
        if (i < tentativas) await new Promise(r => setTimeout(r, intervaloMs));
      }
    }
    throw ultimoErro;
  }

  /* Busca a determinação ATIVA do processo (para a baixa). Retorna o id usado na
     rota /sab/determinacoes/{id}. O filtro numeroProcesso segue o padrão do
     endpoint /processos; loga o 1º item para confirmar o nome do campo id no teste
     real. Filtra client-side por número de processo caso a API ignore o filtro. */
  async function _buscarDeterminacaoAtiva(base, numeroProcesso, tentativas = 3, intervaloMs = 3000) {
    const url = `${base}/sab-api/api/determinacoes` +
      `?pagina=1&tamanhoPagina=10&situacao=M,E,S,A,P,I` +
      `&numeroProcesso=${encodeURIComponent(numeroProcesso)}`;
    const norm = (s) => String(s || "").replace(/\D/g, "");
    const alvo = norm(numeroProcesso);
    let ultimoErro;
    for (let i = 1; i <= tentativas; i++) {
      try {
        const resp = await fetch(url, { headers: { Accept: "application/json" } });
        if (!resp.ok) throw new Error(`SAB determinacoes ${resp.status}`);
        const dados = await resp.json();
        const lista = dados.resultado || dados.content || dados || [];
        if (lista[0]) console.log("CRATOS/SAB: 1ª determinação (conferir campo 'id'):", lista[0]);
        // Se a API não filtrou, restringe pelo número do processo (best-effort).
        const doProcesso = lista.filter((d) => {
          const cand = norm(d.numeroProcesso || (d.processo && d.processo.numero) || d.numero || "");
          return cand && cand === alvo;
        });
        const pool = doProcesso.length ? doProcesso : lista;
        // Ativa = a que NÃO está interrompida/cancelada.
        const ativa = pool.find((d) => {
          const s = String(d.situacao || "").toUpperCase();
          return !s.includes("INTERROMP") && !s.includes("CANCEL");
        }) || pool[0];
        if (!ativa || ativa.id == null) throw new Error("Determinação do processo não encontrada no SAB.");
        return { idDeterminacao: ativa.id, situacao: ativa.situacao };
      } catch (e) {
        ultimoErro = e;
        if (i < tentativas) await new Promise((r) => setTimeout(r, intervaloMs));
      }
    }
    throw ultimoErro;
  }

  return {
    id: "SAB",
    label: "SAB (Bloqueio)",
    tipo: "interativo",
    operacoes: ["inclusao", "baixa"],

    /*
     * executar(ctx, operacao) — chamado pelo orquestrador.
     * ctx: { idProcesso, numeroProcesso, base, partes, ... }
     * Retorna Promise<{ ok, aguardando?, motivo? }>
     */
    async executar(ctx, operacao) {
      if (operacao === "baixa") {
        // BAIXA = interromper a determinação ativa. 100% automática (decisão do
        // usuário): sem movimento no PJe; o content script clica Interromper,
        // preenche a justificativa fixa e confirma, depois gera a certidão.
        try {
          console.log("CRATOS/SAB: baixa — buscando determinação ativa de", ctx.numeroProcesso);
          const { idDeterminacao } = await _buscarDeterminacaoAtiva(ctx.base, ctx.numeroProcesso);
          console.log("CRATOS/SAB: idDeterminacao =", idDeterminacao);
          const cfgTudo = (await Store.get(CHAVES.config)) || {};
          const justificativa =
            (cfgTudo.sab && cfgTudo.sab.justificativaBaixa) || "Determinação judicial";
          await abrirDeterminacaoSab({
            idDeterminacao,
            numProcesso: ctx.numeroProcesso,
            operacao: "baixa",
            justificativa,
          });
          // Interativo para a fila: o content script sinaliza "sab_concluido_auto"
          // ao interromper — o orquestrador segue quando concluir.
          return { ok: true, aguardando: true, idDeterminacao };
        } catch (e) {
          console.error("CRATOS/SAB: erro na baixa:", e.message);
          return { ok: false, motivo: e.message || String(e) };
        }
      }

      // ── INCLUSÃO ────────────────────────────────────────────────────────
      try {
        // ETAPA 1: lança o movimento 11382. O POST precisa sair da PÁGINA
        // (origem https://pje...), não do background (origem moz-extension:// →
        // recusado por CORS/papel, ARQ-516). Enviamos ao content script da aba do PJe.
        // O retorno direto do tabs.sendMessage é frágil no MV2 (o "Receiving end does
        // not exist" acontece mesmo com o POST bem-sucedido), então NÃO dependemos dele:
        // limpamos o resultado, disparamos, e fazemos polling no storage.
        console.log("CRATOS/SAB: solicitando lançamento do movimento", ID_MOVIMENTO_SAB,
          "na aba", ctx.tabId);
        if (ctx.tabId == null) {
          throw new Error("Aba do PJe desconhecida (tabId nulo) — reabra o painel e tente de novo.");
        }
        await Store.set("sab_movimento_resultado", null);
        browser.tabs.sendMessage(ctx.tabId, {
          tipo: "pje_lancar_movimento",
          idProcesso: Number(ctx.idProcesso),
          idMovimento: ID_MOVIMENTO_SAB,
        }).catch(() => { /* retorno ignorado — confiamos no storage */ });

        // Polling: aguarda o content script gravar o resultado (até ~15s)
        const resMov = await _aguardarResultadoMovimento(15000);
        if (!resMov) {
          throw new Error("Sem resposta do lançamento do movimento (timeout).");
        }
        if (!resMov.ok) {
          throw new Error(resMov.erro || `Falha ao lançar movimento (${resMov.status || "?"})`);
        }
        console.log("CRATOS/SAB: movimento lançado com sucesso.");

        // O SAB indexa o movimento recém-lançado com alguns segundos de atraso
        // (ElasticSearch). Buscar o idSab cedo demais falha com "não encontrado".
        // Espera 10s antes de consultar, com log de andamento.
        const ESPERA_INDEX_MS = 10000;
        console.log(`CRATOS/SAB: aguardando ${ESPERA_INDEX_MS / 1000}s para o SAB indexar o movimento...`);
        await new Promise(r => setTimeout(r, ESPERA_INDEX_MS));

        // ETAPA 2: obtém o idSab do processo
        console.log("CRATOS/SAB: buscando idSab para o processo", ctx.numeroProcesso);
        const { idSab, idPJe } = await _buscarIdSabComRetry(ctx.base, ctx.numeroProcesso);
        console.log("CRATOS/SAB: idSab =", idSab);

        // ETAPA 3: obtém o valor do último cálculo (PJe-Calc)
        const idPJeEfetivo = idPJe || ctx.idProcesso;
        const calc = await ApiPje.obterValorCalculo(idPJeEfetivo);
        console.log("CRATOS/SAB: valor do cálculo =", calc);

        // ETAPA 4: sinaliza ao background para abrir a aba do SAB
        // O content script (conteudo/sab.js) cuida do popup e do preenchimento.
        // abrirOrdemSab está no mesmo contexto (background) — chamamos direto, pois
        // runtime.sendMessage enviado do background NÃO volta para o próprio background
        // (era a causa do "Receiving end does not exist" no último passo).
        await abrirOrdemSab({
          idSab,
          numProcesso: ctx.numeroProcesso,
          calc,   // { total, valorFormatado, dataFormatada } | null
          /* Levados adiante porque as marcações (chip/GIGS) só acontecem lá na
             frente, quando o SAB conclui — e ali o ctx já não existe mais.
             O POST precisa sair da aba do PJe, então o tabId vai junto. */
          tabPje: ctx.tabId,
          idProcessoPje: Number(ctx.idProcesso),
        });

        // Retorna aguardando — o orquestrador exibe "Concluí — próximo" no painel.
        return { ok: true, aguardando: true, idSab };

      } catch (e) {
        console.error("CRATOS/SAB: erro na inclusão:", e.message);
        return { ok: false, motivo: e.message || String(e) };
      }
    },
  };

})();

/*
 * Registra o SAB no catálogo para aparecer na tela de Preferências, com os padrões
 * da ordem de bloqueio. São aplicados no passo 3 do wizard (quando o usuário chega
 * lá manualmente). Defaults iguais ao que o SAB já traz — quem não configurar não
 * vê diferença. Chave "escolha" = seleção única (radio).
 */
if (typeof Registro !== "undefined") {
  Registro.adicionar({
    nome: "sab",
    rotulo: "SAB — padrões da ordem de bloqueio",
    config: {
      /* O valor do PJe-Calc está congelado na data de liquidação do cálculo — no
         caso real de 02/09, um cálculo de 13/08. Ligado, o CRATOS pede ao PRÓPRIO
         PJe o fator do período (`/calculos/taxasatualizacao`) e multiplica, que é
         o que a tela de cálculo do PJe faz. O índice é do PJe; nós só aplicamos.
         O popup mostra o valor original, o fator e a data — e continua editável. */
      atualizarValor: {
        tipo: "escolha",
        opcoes: [
          { valor: "sim", rotulo: "Atualizar o valor para a data de hoje" },
          { valor: "nao", rotulo: "Usar o valor do cálculo, sem atualizar" },
        ],
        padrao: "sim",
        rotulo: "Valor da obrigação",
      },
      repeticao: {
        tipo: "escolha",
        opcoes: [
          { valor: "teimosinhas", rotulo: "Por teimosinhas" },
          { valor: "automacao", rotulo: "Por automação" },
        ],
        padrao: "teimosinhas",
        rotulo: "Repetição contínua",
      },
      contaSalario: {
        tipo: "escolha",
        opcoes: [
          { valor: "nao", rotulo: "Não bloquear conta salário" },
          { valor: "sim", rotulo: "Bloquear conta salário" },
        ],
        padrao: "nao",
        rotulo: "Bloquear conta salário?",
      },
      contaUnica: {
        tipo: "escolha",
        opcoes: [
          { valor: "sim", rotulo: "Utilizar conta única" },
          { valor: "nao", rotulo: "Não utilizar conta única" },
        ],
        padrao: "sim",
        rotulo: "Utilizar conta única?",
      },
      justificativaBaixa: {
        tipo: "texto",
        padrao: "Determinação judicial",
        rotulo: "Justificativa da baixa (interrupção da determinação)",
      },

      /* ═══ MARCAÇÕES DE CONTROLE, DEPOIS QUE A ORDEM FOI AUTORIZADA ═══
       * Nascem DESLIGADAS de propósito: chip e atividade são controle interno
       * da vara, e cada secretaria organiza o dela de um jeito. Ligar por
       * padrão encheria a tela de gente que não pediu.
       *
       * Disparam só quando o SAB conclui de verdade (determinação autorizada) —
       * marcar antes seria afirmar "aguardando resposta" de uma ordem que o
       * usuário ainda podia abandonar.
       *
       * Casados por NOME, nunca por id: a lista de chips e a de atividades são
       * configuração de tribunal. */
      chipSisbajud: {
        tipo: "toggle",
        padrao: { ativo: false },
        rotulo: 'Aplicar o chip "SISBAJUD - aguardar resposta" ao concluir a inclusão',
      },
      gigsSisbajud: {
        tipo: "toggle",
        padrao: { ativo: false },
        rotulo: 'Lançar no GIGS a atividade "SISBAJUD - SAB em processamento: A partir de *"',
      },
    },
  });
}

if (typeof module !== "undefined") { module.exports = { ModuloSAB }; }
