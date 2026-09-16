/*
 * modulos/serasajud.js — módulo SerasaJUD (serasa-judicial.serasaexperian.com.br).
 * Contrato: { id, label, tipo, operacoes, executar(ctx, operacao) }.
 * ctx = { idProcesso, numeroProcesso, base, partes, tabId }.
 *
 * ESCOPO "PREPARAR", como em todos os outros: o CRATOS monta a ordem e PARA no
 * diálogo "Confirmar inclusão/baixa da dívida?". Quem confirma é o usuário.
 * Nós temos o POST da ordem capturado no recon (sabemos exatamente o corpo que o
 * site manda), e mesmo assim NÃO o chamamos: mandar ato de constrição por baixo
 * do pano é o oposto do que esta extensão se propõe.
 *
 * UMA ORDEM POR PROCESSO, com todos os executados como titulares (decisão do
 * Rodrigo, 19/08) — é como o site é montado: `titulares` é um array no POST, e a
 * própria tela avisa "se houver mais devedores, adicionar nesse momento".
 *
 * SEM DÉBITO DE NACIONALIZAÇÃO: o órgão, a UF e o JTR vêm das credenciais do
 * usuário (o app consulta o corporativo do PJe no login). Diferente do RENAJUD,
 * um beta-tester de outro tribunal usa isto sem configurar nada.
 */

const ModuloSERASAJUD = {
  id: "SERASAJUD",
  label: "SerasaJUD (Negativação)",
  tipo: "interativo",
  operacoes: ["inclusao", "baixa"],

  async executar(ctx, operacao) {
    try {
      if (operacao !== "inclusao" && operacao !== "baixa") {
        return { ok: false, motivo: `SerasaJUD: operação "${operacao}" não implementada.` };
      }

      const cfgTudo = (await Store.get(CHAVES.config)) || {};
      const cfg = cfgTudo.serasajud || {};

      const numero = String(ctx.numeroProcesso || "").replace(/\D/g, "");
      if (numero.length !== 20) {
        return { ok: false, motivo: `Número do processo inesperado (${numero.length} dígitos; esperado 20).` };
      }

      /* ═══ TITULARES = OS EXECUTADOS ═══
         "O importante são os executados constarem TODOS, pois daí gera a
         restrição" (Rodrigo, 19/08). Respeitamos a marcação do painel, e o
         content script confere a tabela linha a linha depois: executado que não
         entrou é restrição que não existe, e isso não pode passar calado. */
      const marcadas = ctx.partes || [];
      const semDocumento = marcadas.filter((p) => !p.cpfcnpj).map((p) => p.nome);

      const titulares = [];
      const vistos = new Set();
      const nomesAlterados = [];
      for (const p of marcadas) {
        if (!p.cpfcnpj) continue;
        const doc = String(p.cpfcnpj).replace(/\D/g, "");
        if (!doc || vistos.has(doc)) continue;
        vistos.add(doc);
        const nome = _limparNome(p.nome);
        if (nome !== String(p.nome || "").trim()) nomesAlterados.push({ de: p.nome, para: nome });
        titulares.push({ nome, cpfcnpj: doc, polo: p.polo });
      }

      if (!titulares.length) {
        return {
          ok: false,
          motivo: semDocumento.length
            ? `Nenhuma das partes marcadas tem CPF/CNPJ (${semDocumento.join(", ")}).`
            : "Nenhuma parte marcada no painel.",
        };
      }

      /* Aviso, não bloqueio: negativar quem está no polo ativo é erro caro
         (restrição de crédito no nome de quem deveria receber). O content script
         mostra isso em vermelho antes de preencher. */
      const ativosMarcados = titulares.filter((t) => t.polo === "ativo").map((t) => t.nome);

      /* ═══ CREDOR: o primeiro exequente ═══
         A ordem é registrada POR PROCESSO; com mais de um exequente basta o
         primeiro (Rodrigo, 19/08). O valor é a dívida total — repeti-lo em vários
         credores afirmaria que cada um é credor do total. */
      const processo = (await Store.get(CHAVES.processo)) || {};
      const todasDoProcesso = (processo.partes || []).length ? processo.partes : marcadas;
      const ativos = todasDoProcesso.filter((p) => p.polo === "ativo");
      const credor = ativos[0]
        ? {
            nome: _limparNome(ativos[0].nome),
            cpfcnpj: String(ativos[0].cpfcnpj || "").replace(/\D/g, ""),
          }
        : null;
      if (credor && credor.nome !== String(ativos[0].nome || "").trim()) {
        nomesAlterados.push({ de: ativos[0].nome, para: credor.nome });
      }

      if (!credor || !credor.nome) {
        return { ok: false, motivo: "Não achei o exequente (polo ativo) no processo capturado." };
      }

      /* ═══ VALOR ═══ mesmo desenho do CNIB: PJe-Calc por padrão, fixo se você quiser. */
      let valor = null, dataLiquidacao = null;
      if ((cfg.origemValor || "pje_calc") === "manual") {
        valor = String(cfg.valorManual || "").trim() || null;
      } else {
        const calc = await ApiPje.obterValorCalculo(ctx.idProcesso);
        if (calc) {
          valor = calc.valorFormatado.replace(/\s/g, "");   // "R$12.550,51"
          dataLiquidacao = calc.dataLiquidacao;             // pode ser null — de propósito
        }
      }
      if (!valor) {
        return { ok: false, motivo: "Não achei o valor da dívida (PJe-Calc vazio?). Confira ou use valor fixo nas Preferências." };
      }

      /* ═══ DATA DA DÍVIDA — só a BAIXA precisa, e ela é obrigatória lá ═══
         Sem a data de liquidação, PARAMOS AQUI. Preencher com a data de hoje, ou
         com a de importação do cálculo, seria pôr no processo uma data que
         ninguém afirmou — num ato de baixa. */
      if (operacao === "baixa" && !dataLiquidacao) {
        return {
          ok: false,
          motivo: "A baixa exige a Data da Dívida, e o PJe-Calc não trouxe data de " +
                  "liquidação neste processo. Faça esta baixa à mão — não preencho data por conta própria.",
        };
      }

      await Store.set("serasajud_estado", {
        ativo: true,
        operacao,
        numProcesso: ctx.numeroProcesso,
        numeroDigitos: numero,
        titulares,
        semDocumento,
        nomesAlterados,
        ativosMarcados,
        credor,
        valor,
        dataLiquidacao,
        config: {
          horasSla: String(cfg.horasSla || "120"),
          gerarCertidao: cfg.gerarCertidao !== "nao",
          pasta: cfg.pasta || "CRATOS",
        },
        fase: "iniciado",
        abertoEm: new Date().toISOString(),
      });

      await abrirSerasajud();

      /* `esperados: 1` — o SerasaJUD emite UMA certidão para TODOS os titulares
         (uma ordem só; fabricarCertidao roda uma vez, no fim do laço). Não é um
         por titular. Uma certidão chega → o painel avança. */
      return { ok: true, aguardando: true, titulares: titulares.length, esperados: 1 };
    } catch (e) {
      console.error("CRATOS/SERASAJUD: erro:", e.message);
      return { ok: false, motivo: e.message || String(e) };
    }
  },
};

/* ═══ LIMPEZA DE NOME ═══
 * O campo de nome do SerasaJUD TRAVA com símbolo especial — o "&" foi o flagrado
 * em produção (19/08), e o formulário simplesmente não aceita o valor.
 *
 * Duas regras, e a primeira é uma escolha, não uma limpeza:
 *  · "&" vira " E ". Em razão social brasileira o & se lê "e" — apagar deixaria
 *    "SILVA & CIA" como "SILVA CIA", que soa truncado. "SILVA E CIA" é como se
 *    escreve por extenso.
 *  · o resto do que não for letra, dígito, espaço, ponto ou hífen vira espaço.
 *    Ponto e hífen ficam porque são onipresentes ("LTDA.", "MARIA-JOSÉ") e não
 *    foram acusados de travar nada.
 *
 * Quem identifica a parte na ordem é o CPF/CNPJ, não a grafia do nome — mas a
 * troca não passa calada: vai para `nomesAlterados` e a faixa mostra antes de
 * você confirmar. Nome que sobra vazio depois da limpeza NÃO é usado.
 */
function _limparNome(nome) {
  const original = String(nome == null ? "" : nome).trim();
  const limpo = original
    .replace(/&/g, " E ")
    .replace(/[^A-Za-zÀ-ÿ0-9 .\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (limpo || original).slice(0, 55).trim();
}

/* Config em Preferências. */
if (typeof Registro !== "undefined") {
  Registro.adicionar({
    nome: "serasajud",
    rotulo: "SerasaJUD — negativação",
    config: {
      _avisoEscopo: {
        tipo: "aviso",
        nivel: "risco",
        rotulo: "O que o CRATOS faz — e o que fica com você",
        itens: [
          "<b>Inclusão e baixa:</b> o CRATOS preenche a ordem inteira e PARA no " +
            "diálogo <i>“Confirmar inclusão/baixa da dívida?”</i>. O clique em " +
            "<b>Confirmar</b> é sempre seu.",
          "<b>Uma ordem por processo</b>, com <b>todos os executados marcados</b> como " +
            "titulares — é assim que a restrição é gerada. Se algum executado não " +
            "entrar na tabela, o CRATOS para e avisa: executado que falta é restrição " +
            "que não existe.",
          "<b>Negativar é constrição.</b> Se você marcar uma parte do polo ATIVO, ela " +
            "entra (a marcação é sua), mas com aviso em vermelho na tela — restrição " +
            "de crédito no nome de quem deveria receber é erro caro de desfazer.",
          "<b>Data da Dívida (baixa):</b> vem da <i>data de liquidação</i> do cálculo do " +
            "PJe-Calc. Se o cálculo não tiver essa data, o CRATOS <b>não inventa</b>: " +
            "recusa a baixa e pede que você a faça à mão.",
          "<b>Credor:</b> o primeiro exequente do processo. A ordem é registrada por " +
            "processo, então basta um.",
          "<b>Certidão:</b> só é emitida <b>depois</b> que você clica em Confirmar e o " +
            "servidor responde com sucesso — e é montada a partir do que foi REALMENTE " +
            "enviado, não do que a extensão preencheu. Se você cancelar, nada é gerado.",
        ],
      },
      horasSla: {
        tipo: "escolha",
        opcoes: [
          { valor: "120", rotulo: "5 dias" },
          { valor: "72", rotulo: "3 dias" },
          { valor: "48", rotulo: "2 dias" },
          { valor: "24", rotulo: "1 dia" },
        ],
        padrao: "120",
        rotulo: "Prazo de atendimento (o padrão do próprio SerasaJUD é 5 dias)",
      },
      origemValor: {
        tipo: "escolha",
        opcoes: [
          { valor: "pje_calc", rotulo: "PJe-Calc (último cálculo)" },
          { valor: "manual", rotulo: "Valor fixo abaixo" },
        ],
        padrao: "pje_calc",
        rotulo: "De onde vem o valor da dívida",
      },
      valorManual: { tipo: "texto", padrao: "", rotulo: "Valor fixo (ex.: R$1.234,56)" },
      gerarCertidao: {
        tipo: "escolha",
        opcoes: [{ valor: "sim", rotulo: "Sim" }, { valor: "nao", rotulo: "Não" }],
        padrao: "sim",
        rotulo: "Gerar certidão depois que você confirmar a ordem?",
      },
      pasta: {
        tipo: "texto",
        padrao: "CRATOS",
        rotulo: "Pasta de download (dentro da pasta de downloads do Firefox)",
      },
    },
  });
}
