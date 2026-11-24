/*
 * modulos/censec.js — módulo CENSEC / CEP (censec.org.br).
 * Contrato: { id, label, tipo, operacoes, executar(ctx, operacao) }.
 * ctx = { idProcesso, numeroProcesso, base, partes, tabId }.
 *
 * SÓ CONSULTA. O CENSEC é central de consulta — não há nada a incluir nem a
 * baixar. Por isso "operacoes: [consulta]" e nenhuma guarda de escopo:
 * não existe ato de constrição aqui, só leitura.
 *
 * Este módulo apenas monta o estado e abre a aba. Quem dirige a tela (e escuta
 * a resposta da API) é conteudo/censec.js, com o grampo conteudo/censec-api.js.
 *
 * Login é manual: certificado digital + token por e-mail. Se a aba cair na tela
 * de login, o content script avisa na faixa e fica esperando — ao entrar, ele
 * roda de novo e retoma sozinho.
 */

const ModuloCENSEC = {
  id: "CENSEC",
  label: "CENSEC (Escrituras e Procurações)",
  tipo: "interativo",          // depende de login manual; não roda sem o usuário
  operacoes: ["consulta"],

  async executar(ctx, operacao) {
    try {
      if (operacao !== "consulta") {
        return { ok: false, motivo: `CENSEC: operação "${operacao}" não existe (só consulta).` };
      }

      const cfgTudo = (await Store.get(CHAVES.config)) || {};
      const cfg = cfgTudo.censec || {};

      /* QUEM CONSULTAMOS: exatamente quem você marcou no painel, de QUALQUER polo.
         A 0.3.1 filtrava polo === "passivo" — herança do CNIB, colada aqui sem
         pensar. Lá faz sentido: indisponibilidade é constrição, e só se constringe
         executado. Aqui não: o CENSEC é consulta, e consultar o autor é decisão
         legítima de quem conduz o processo. O efeito prático do filtro era feio —
         com autor e réu marcados, o autor sumia da fila em silêncio e a consulta
         "terminava" tendo feito metade do serviço.

         Sem documento não há o que consultar (a busca é por CPF/CNPJ), mas essa
         parte NÃO some calada: volta em `semDocumento` e o content script avisa. */
      const marcadas = (ctx.partes || []);
      const semDocumento = marcadas.filter((p) => !p.cpfcnpj).map((p) => p.nome);

      const partes = [];
      const jaVistos = new Set();
      for (const p of marcadas) {
        if (!p.cpfcnpj) continue;
        const doc = String(p.cpfcnpj).replace(/\D/g, "");
        if (!doc || jaVistos.has(doc)) continue;   // mesma pessoa em dois polos: uma consulta só
        jaVistos.add(doc);
        partes.push({ nome: p.nome, cpfcnpj: doc, polo: p.polo, tipoPessoa: p.tipoPessoa });
      }

      if (!partes.length) {
        return {
          ok: false,
          motivo: semDocumento.length
            ? `Nenhuma das partes marcadas tem CPF/CNPJ (${semDocumento.join(", ")}).`
            : "Nenhuma parte marcada no painel.",
        };
      }

      const numero = String(ctx.numeroProcesso || "").replace(/\D/g, "");
      if (numero.length !== 20) {
        return { ok: false, motivo: `Número do processo inesperado (${numero.length} dígitos; esperado 20).` };
      }

      /* 1.9.8 — PERÍODO da consulta (Rodrigo, 23/11): SÓ nas Preferências (10, 5, 3, 2 ou
         1 ano, ou Personalizado com as datas gravadas lá). Vale para a CEP e para a CANP,
         e a certidão diz qual foi. Período inválido = o CENSEC não abre. */
      const P = globalThis.CratosPeriodo;
      const escolha = { valor: cfg.periodoPadrao || (P && P.PADRAO) || "10a", inicio: cfg.periodoInicio, fim: cfg.periodoFim };
      const periodo = P ? P.resolver(escolha) : { erro: "módulo de período ausente" };
      if (periodo.erro) {
        return { ok: false, motivo: escolha.valor === "personalizado"
          ? `CENSEC: período personalizado inválido (${periodo.erro}) — ajuste nas Preferências do CENSEC.`
          : `CENSEC: ${periodo.erro}.` };
      }

      await Store.set("censec_estado", {
        ativo: true,
        operacao: "consulta",
        numProcesso: ctx.numeroProcesso,
        numeroDigitos: numero,
        partes,
        semDocumento,
        config: {
          pasta: cfg.pasta || "CRATOS",
          gerarNegativa: cfg.gerarNegativa !== "nao",
          /* toggle salvo como {ativo:bool}; desligado por padrão */
          puxarPartes: !!(cfg.puxarPartes && cfg.puxarPartes.ativo),
          /* 1.9.8: CANP (atos de São Paulo, no Signo) — ligada de fábrica (Rodrigo, 23/11) */
          consultarCanp: !(cfg.consultarCanp && cfg.consultarCanp.ativo === false),
        },
        periodo: { inicio: periodo.inicio, fim: periodo.fim, rotulo: periodo.rotulo, valor: periodo.valor },
        feitos: [],
        fase: "iniciado",
        abertoEm: new Date().toISOString(),
      });

      await abrirCensec();

      /* `esperados` = nº de partes = nº de certidões (uma por parte, sempre —
         com gerarNegativa, parte sem ato também gera a negativa). O painel conta
         as que chegam e avança sozinho ao bater esse número. */
      return { ok: true, aguardando: true, partes: partes.length, esperados: partes.length };
    } catch (e) {
      console.error("CRATOS/CENSEC: erro:", e.message);
      return { ok: false, motivo: e.message || String(e) };
    }
  },
};

/* Config em Preferências. */
if (typeof Registro !== "undefined") {
  Registro.adicionar({
    nome: "censec",
    rotulo: "CENSEC — Escrituras e Procurações (CEP)",
    config: {
      _avisoEscopo: {
        tipo: "aviso",
        nivel: "info",
        rotulo: "Como o CRATOS consulta o CENSEC",
        itens: [
          "<b>Login é seu:</b> certificado digital + token por e-mail. O CRATOS " +
            "abre a aba e espera; assim que você entrar, ele retoma sozinho.",
          "<b>Consulta quem VOCÊ marcou no painel</b>, de qualquer polo — autor, réu, " +
            "terceiro. Diferente do CNIB, que só age no polo passivo: lá é constrição, " +
            "aqui é consulta. Uma parte por vez, um PDF por parte — inclusive a " +
            "<b>certidão negativa</b>, quando não há atos.",
          "<b>A certidão é fabricada a partir dos dados da própria busca</b>, não de um " +
            "print da tela. A CEP devolve <b>no máximo 300 atos</b> por busca: quando bate " +
            "nesse teto, o CRATOS divide o período ao meio e busca de novo (até 10 buscas por " +
            "parte). Se ainda assim não cobrir tudo, a certidão diz que é parcial e qual " +
            "período ficou coberto — nunca \"foram encontrados 300\".",
          "<b>Período:</b> a consulta é sempre delimitada por datas, escolhidas abaixo (10, 5, 3, 2 " +
            "ou 1 ano até ontem, ou Personalizado — o CENSEC não aceita o dia de hoje como data final). A certidão informa o período.",
          "<b>CANP (atos de São Paulo):</b> o próprio CENSEC manda consultar os atos paulistas " +
            "na CANP, no Signo. Com a opção ligada, o CRATOS consulta lá também e põe o resultado " +
            "num bloco da certidão. O login no Signo é seu (certificado digital; o CRATOS só " +
            "deixa o seu certificado escolhido).",
          "<b>Captcha:</b> se o CENSEC pedir um desafio, o CRATOS <b>congela</b> e espera " +
            "você resolver na tela. Não tenta contornar.",
          "<b>Escopo:</b> só CEP (Escrituras e Procurações). CESDI fica para depois.",
        ],
      },
      gerarNegativa: {
        tipo: "escolha",
        opcoes: [{ valor: "sim", rotulo: "Sim" }, { valor: "nao", rotulo: "Não" }],
        padrao: "sim",
        rotulo: "Gerar certidão também quando não houver atos (negativa)?",
      },
      pasta: {
        tipo: "texto",
        padrao: "CRATOS",
        rotulo: "Pasta de download (dentro da pasta de downloads do Firefox)",
      },
      /* Partes de cada ato na certidão. Desligado por padrão: é uma chamada extra
         por ato e deixa a certidão mais longa — quem quiser o detalhe, liga. */
      puxarPartes: {
        tipo: "toggle",
        padrao: { ativo: false },
        rotulo: "Listar as partes de cada ato na certidão (nome, CPF/CNPJ e qualidade)",
      },
      /* 1.9.8 */
      periodoPadrao: {
        tipo: "escolha",
        opcoes: [
          { valor: "10a", rotulo: "Últimos 10 anos" },
          { valor: "5a", rotulo: "Últimos 5 anos" },
          { valor: "3a", rotulo: "Últimos 3 anos" },
          { valor: "2a", rotulo: "Últimos 2 anos" },
          { valor: "1a", rotulo: "Último ano" },
          { valor: "personalizado", rotulo: "Personalizado (datas abaixo)" },
        ],
        padrao: "10a",
        rotulo: "Período da consulta (CEP e CANP)",
      },
      periodoInicio: {
        tipo: "data",
        padrao: "",
        rotulo: "Personalizado — data inicial",
        linha: "personalizado",
        linhaNota: "Só vale com \"Personalizado\" marcado e fica valendo até você mudar. A data final pode ser no máximo ontem: o CENSEC não aceita o dia de hoje.",
      },
      periodoFim: {
        tipo: "data",
        padrao: "",
        rotulo: "Personalizado — data final",
        linha: "personalizado",
        maxOntem: true,
      },
      consultarCanp: {
        tipo: "toggle",
        padrao: { ativo: true },
        rotulo: "Consultar também a CANP — atos de São Paulo, no Signo (login seu, com certificado)",
      },
    },
  });
}
