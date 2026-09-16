/*
 * modulos/cnib.js — módulo CNIB 2.0 (indisponibilidade.onr.org.br).
 * Contrato: { id, label, tipo, operacoes, executar(ctx, operacao) }.
 * ctx = { idProcesso, numeroProcesso, base, partes, tabId }.
 *
 * v0.2.90: só INCLUSÃO (ordem de indisponibilidade genérica). A baixa
 * (Ordem > Autorizar Cancelamento) entra na 0.2.91, depois do recon dela.
 *
 * ESCOPO "PREPARAR" (mesma regra do RENAJUD): o CRATOS monta a ordem e PARA
 * no passo 4. "Enviar Indisponibilidade" e a assinatura com certificado são
 * SEMPRE do usuário — a assinatura, aliás, é UI nativa, extensão não alcança.
 *
 * O CNIB é Blazor Server: não há API de negócio, tudo trafega por WebSocket.
 * Quem dirige a tela é conteudo/cnib.js; aqui só montamos o estado e abrimos a aba.
 */

const ModuloCNIB = {
  id: "CNIB",
  label: "CNIB (Indisponibilidade de Bens)",
  tipo: "interativo",
  operacoes: ["inclusao", "baixa"],

  async executar(ctx, operacao) {
    try {
      if (operacao !== "inclusao" && operacao !== "baixa") {
        return { ok: false, motivo: `CNIB: operação "${operacao}" não implementada.` };
      }

      const cfgTudo = (await Store.get(CHAVES.config)) || {};
      const cfg = cfgTudo.cnib || {};

      const executados = (ctx.partes || [])
        .filter((p) => p.polo === "passivo" && p.cpfcnpj)
        .map((p) => ({ nome: p.nome, cpfcnpj: String(p.cpfcnpj).replace(/\D/g, ""), tipoPessoa: p.tipoPessoa }));

      if (operacao === "inclusao" && !executados.length) {
        return { ok: false, motivo: "Nenhum executado (polo passivo) com CPF/CNPJ no processo." };
      }

      const numero = String(ctx.numeroProcesso || "").replace(/\D/g, "");
      if (numero.length !== 20) {
        return { ok: false, motivo: `Número do processo inesperado (${numero.length} dígitos; esperado 20).` };
      }

      /* GUARDA DE VARA — o perfil do CNIB pode ter mais de uma entidade e a escolha
         é manual no login. A vara NÃO aparece em nenhuma tela do wizard: só no
         comprovante, depois de assinada. Então conferimos aqui, com o que o content
         script gravou na tela de login. Sem orgaoEsperado configurado, só informa. */
      const org = (await Store.get("cnib_organizacao")) || null;
      const esperado = String(cfg.orgaoEsperado || "").trim();
      if (esperado && org && org.nome && !_mesmoOrgao(org.nome, esperado)) {
        return {
          ok: false,
          motivo: `Vara divergente — o CNIB está logado em "${org.nome}", mas as ` +
                  `Preferências esperam "${esperado}". Nada foi preenchido.`,
        };
      }

      /* Valor da dívida: por padrão o CNIB fica em "Não informar" (praxe — as
         certidões não registram valor). Só busca o PJe-Calc se a opção estiver ligada. */
      let valor = null;
      if (operacao === "inclusao" && cfg.informarValor === "sim") {
        if ((cfg.origemValor || "pje_calc") === "manual") {
          valor = String(cfg.valorManual || "").trim() || null;
        } else {
          const calc = await ApiPje.obterValorCalculo(ctx.idProcesso);
          // O campo do CNIB é pt-BR SEM "R$" (ex.: 1.234,56).
          valor = calc ? calc.valorFormatado.replace(/[R$\s ]/g, "") : null;
        }
        if (!valor) {
          return { ok: false, motivo: "Opção 'informar valor' ligada, mas não achei valor (PJe-Calc vazio?)." };
        }
      }

      /* Segredo de justiça: lê do processo capturado em vez de assumir "Não".
         Campo ainda não confirmado no JSON do TRT18 — se não vier, fica "Não"
         e o usuário corrige na tela (o CRATOS não envia nada sozinho). */
      const processo = (await Store.get(CHAVES.processo)) || {};
      const segredo = _lerSegredo(processo);

      await Store.set("cnib_estado", {
        ativo: true,
        operacao,
        numProcesso: ctx.numeroProcesso,
        numeroDigitos: numero,
        executados,
        segredo,                       // true | false | null (null = não sabemos)
        config: {
          informarValor: cfg.informarValor === "sim",
          valor,
          nomeProcesso: cfg.nomeProcesso || "Processo de execução judicial ou cumprimento de sentença",
          priorizarPrenotacao: cfg.priorizarPrenotacao === "sim",
        },
        // baixa: memória do laço "uma ordem por vez"
        protocolosFeitos: [],
        ordemAtual: null,
        abertoEm: new Date().toISOString(),
      });

      await abrirCnib(operacao);

      /* `esperados` na INCLUSÃO = 1: uma ordem só, um comprovante, para TODOS os
         executados (o passo 1 adiciona todos na mesma ordem). NÃO é um por
         executado. Na BAIXA é 1 comprovante POR protocolo cancelado, número que
         só se conhece na tela — então NÃO mandamos `esperados`, e o painel a
         conclui pelo botão (o comprovante por protocolo já cai no Cofre). */
      return {
        ok: true,
        aguardando: true,
        organizacao: (org && org.nome) || null,
        esperados: operacao === "inclusao" ? 1 : undefined,
      };
    } catch (e) {
      console.error("CRATOS/CNIB: erro:", e.message);
      return { ok: false, motivo: e.message || String(e) };
    }
  },
};

/* Comparação tolerante de nome de vara: sem acento, sem pontuação, sem
   ordinal gráfico ("8ª" vs "8a"), espaços colapsados. */
function _mesmoOrgao(a, b) {
  const n = (s) => String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[ºª°]/g, "a")
    .replace(/[^a-z0-9 ]/gi, " ")
    .replace(/\s+/g, " ").trim().toLowerCase();
  return n(a) === n(b);
}

/* O shape do PJe do TRT18 para segredo de justiça ainda não foi confirmado —
   tentamos os nomes plausíveis e, se nenhum existir, devolvemos null (= não sei). */
function _lerSegredo(processo) {
  const g = (processo && processo._brutoGerais) || {};
  for (const k of ["segredoJustica", "segredoDeJustica", "sigiloso", "segredo", "processoSigiloso"]) {
    if (typeof g[k] === "boolean") return g[k];
  }
  if (typeof g.nivelSigilo === "number") return g.nivelSigilo > 0;
  return null;
}

/* Config em Preferências. Uso "escolha" (radio) em vez de "toggle" porque o
   toggle do opcoes.js rotula fixo como "Consultar", que não faz sentido aqui. */
if (typeof Registro !== "undefined") {
  Registro.adicionar({
    nome: "cnib",
    rotulo: "CNIB — ordem de indisponibilidade",
    config: {
      _avisoEscopo: {
        tipo: "aviso",
        nivel: "risco",
        rotulo: "O que o CRATOS faz — e o que fica com você",
        itens: [
          "<b>Inclusão de ordem:</b> preenche o passo 1 (processo, executados, segredo), " +
            "segue pela indisponibilidade genérica e PARA no passo 4. " +
            "O <i>Enviar Indisponibilidade</i> e a assinatura com certificado são sempre seus.",
          "<b>Cancelamento TOTAL:</b> localiza a ordem e prepara os dados. O " +
            "<i>ENVIAR CANCELAMENTO</i> e a assinatura são seus.",
          "<b>Cancelamento PARCIAL: feito 100% à mão, fora da extensão.</b> " +
            "Escolher quais matrículas saem da indisponibilidade é decisão jurídica " +
            "caso a caso — automatizar isso só criaria risco de liberar bem errado. " +
            "O CRATOS não atua nessa tela por decisão de projeto, não por falta de recurso.",
          "<b>Indisponibilidade específica</b> (escolher matrículas na inclusão) segue a " +
            "mesma regra: é sua.",
        ],
      },
      orgaoEsperado: {
        tipo: "texto",
        padrao: "",
        rotulo: "Vara esperada (vazio = só informa; preenchido = bloqueia se o CNIB estiver logado em outra)",
      },
      informarValor: {
        tipo: "escolha",
        opcoes: [{ valor: "nao", rotulo: "Não informar" }, { valor: "sim", rotulo: "Informar" }],
        padrao: "nao",
        rotulo: "Informar o valor da dívida?",
      },
      origemValor: {
        tipo: "escolha",
        opcoes: [{ valor: "pje_calc", rotulo: "PJe-Calc (último cálculo)" }, { valor: "manual", rotulo: "Valor fixo abaixo" }],
        padrao: "pje_calc",
        rotulo: "De onde vem o valor (só se 'Informar')",
      },
      valorManual: { tipo: "texto", padrao: "", rotulo: "Valor fixo (ex.: 1.234,56)" },
      nomeProcesso: {
        tipo: "lista",
        opcoes: [
          "Processo de execução judicial ou cumprimento de sentença",
          "Demais processos",
        ],
        padrao: "Processo de execução judicial ou cumprimento de sentença",
        rotulo: "Nome do Processo (tela 1 do CNIB)",
      },
      priorizarPrenotacao: {
        tipo: "escolha",
        opcoes: [{ valor: "nao", rotulo: "Não" }, { valor: "sim", rotulo: "Sim" }],
        padrao: "nao",
        rotulo: "Priorizar a prenotação à ordem registral regular? (na JT, não se usa)",
      },
    },
  });
}
