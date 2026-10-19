/*
 * modulos/ccs.js — módulo CCS (Cadastro de Clientes do SFN / Banco Central).
 * Contrato: { id, label, tipo, operacoes, executar(ctx, operacao) }, como os demais.
 * ctx = { idProcesso, numeroProcesso, base, partes, tabId }.
 *
 * ═══ O QUE O CCS TEM DE PARTICULAR (mapa completo: doc do projeto cratos/plano-ccs.md) ═══
 *  - NÃO HÁ API. É Struts server-side (formulário → HTML pronto, ISO-8859-1, TOKEN
 *    anti-CSRF). O módulo opera a PRÓPRIA TELA na aba logada, guiado pelo código de
 *    tela `[CCSFWxxxx]` — como o SerasaJUD/eCAC. Nada de POST direto: as validações
 *    da página rodam no clique e o TOKEN segue sozinho.
 *  - Duas fases, em DIAS diferentes:
 *      dia 1  → requisitar a consulta (0501/0502) e solicitar o detalhamento às
 *               instituições (0801 → 0601 → 0602). Sai a CERTIDÃO DE ENVIO.
 *      depois → COLETA (botão próprio no painel): as instituições respondem em até
 *               ~48h; junta-se o PDF de detalhamentos que o PRÓPRIO CCS gera, com a
 *               certidão do ESTADO ATUAL (quem respondeu, quem falta).
 *  - Só o PDF de detalhamento é juntado (decisão do Rodrigo, 15/10): tela, "imprimir",
 *    TXT e SIMBA vêm incompletos. O PDF é documento do BCB — vai como veio.
 *  - SIGILO BANCÁRIO (LC 105/2001): a juntada do CRATOS já cria os anexos com
 *    `sigiloso: true`; o CCS não abre exceção.
 *
 * UMA REQUISIÇÃO POR PROCESSO, com todos os executados marcados (um CPF/CNPJ por linha
 * no textarea `cpfCnpj`) — decisão de 15/10.
 *
 * O login (ADFS do BCB) NUNCA é automatizado: a aba abre, o content script espera.
 */

const CCS_BASE = "https://www3.bcb.gov.br/ccs/";
const CCS_URL = {
  inicio: CCS_BASE + "iniciar.do?method=iniciar",
  requisitar: CCS_BASE + "requisitarConsultaCpfCnpj.do?method=iniciar",
  requisicoes: CCS_BASE + "iniciarConsultaRequisicoesRealizadas.do?method=iniciarConsultaRequisicoes",
  requisicao: (n) => CCS_BASE +
    "visualizarRequisicaoRealizadaCpfCnpj.do?method=visualizarRequisicaoRealizada&numeroRequisicao=" +
    encodeURIComponent(String(n)),
  arquivos: CCS_BASE + "listarArquivosDownload.do?method=listarArquivosDownload",
};

/* Lê a config salva com os padrões de fábrica. Padrões de 15/10 (Rodrigo): termo e
   envio NÃO automáticos, critério = todas as detalháveis, inativos À MOSTRA (o colega
   especialista: inativo é onde aparece fraude), motivo "Execução trabalhista". */
function _ccsConfig(cfg) {
  const c = cfg || {};
  return {
    aceitarTermo: c.aceitarTermo === "sim",
    envioAutomatico: c.envioAutomatico === "sim",
    criterio: c.criterio === "sem_data_fim" ? "sem_data_fim" : "todas",
    esconderInativos: c.esconderInativos === "sim",
    motivo: String(c.motivo == null || c.motivo === "" ? "Execução trabalhista" : c.motivo).trim()
      || "Execução trabalhista",
    pasta: String(c.pasta || "CRATOS").replace(/[\\:*?"<>|]/g, "").trim() || "CRATOS",
    /* Chip "CCS - aguardar resposta" depois do envio confirmado — LIGADO por padrão
       (Rodrigo, 19/10). Só `{ ativo: false }` explícito desliga. */
    chip: !(c.chipCcs && c.chipCcs.ativo === false),
  };
}

/* Executados do painel → [{ nome, doc, polo }], sem repetir documento. Só CPF (11) ou
   CNPJ (14): o CCS consulta por documento, e parte sem documento não tem o que pedir. */
function _ccsDocs(partes) {
  const docs = [];
  const vistos = new Set();
  const semDocumento = [];
  for (const p of partes || []) {
    const d = String((p && p.cpfcnpj) || "").replace(/\D/g, "");
    if (d.length !== 11 && d.length !== 14) { if (p && p.nome) semDocumento.push(p.nome); continue; }
    if (vistos.has(d)) continue;
    vistos.add(d);
    docs.push({ nome: String(p.nome || "").trim(), doc: d, polo: p.polo || null });
  }
  return { docs, semDocumento };
}

const ModuloCCS = {
  id: "CCS",
  label: "CCS (Bacen — relacionamentos)",
  tipo: "interativo",
  operacoes: ["consulta"],

  /* DIA 1: grava o estado e abre a tela de requisição. Quem anda daqui em diante é
     o content script (conteudo/ccs.js), tela a tela. */
  async executar(ctx, operacao) {
    try {
      if (operacao !== "consulta") {
        return { ok: false, motivo: `CCS: operação "${operacao}" não existe — o CCS é só consulta.` };
      }
      const numero = String(ctx.numeroProcesso || "").replace(/\D/g, "");
      if (numero.length !== 20) {
        return { ok: false, motivo: `Número do processo inesperado (${numero.length} dígitos; esperado 20).` };
      }
      const { docs, semDocumento } = _ccsDocs(ctx.partes);
      if (!docs.length) {
        return {
          ok: false,
          motivo: semDocumento.length
            ? `Nenhuma das partes marcadas tem CPF/CNPJ (${semDocumento.join(", ")}).`
            : "Nenhuma parte marcada no painel.",
        };
      }
      const cfgTudo = (await Store.get(CHAVES.config)) || {};
      await Store.set("ccs_estado", {
        ativo: true,
        modo: "requisicao",
        numProcesso: ctx.numeroProcesso,
        numeroDigitos: numero,
        docs,
        semDocumento,
        config: _ccsConfig(cfgTudo.ccs),
        /* A aba e o id do processo no PJe: o chip sai da PÁGINA do PJe (ARQ-516),
           como as marcações do SAB. */
        tabPje: ctx.tabId != null ? ctx.tabId : null,
        idProcessoPje: ctx.idProcesso || null,
        fase: "iniciado",
        abertoEm: new Date().toISOString(),
      });
      /* 1.6.5: pela ENTRADA do CCS (CCSFW1201), não pela página interna. Sem sessão, o
         BCB manda ao ADFS e devolve a esta entrada; a volta direto a uma página interna
         vinha em branco (campo, 19/10). O content script segue da 1201 ao formulário. */
      await abrirCcs(CCS_URL.inicio);
      /* UMA certidão (a de envio) para a requisição inteira — o painel avança quando
         ela chega. */
      return { ok: true, aguardando: true, esperados: 1 };
    } catch (e) {
      console.error("CRATOS/CCS: erro:", e.message);
      return { ok: false, motivo: e.message || String(e) };
    }
  },

  /* COLETA (botão do painel). Vai DIRETO à requisição quando o número foi guardado
     no dia 1; senão (envio em outra máquina, ou feito à mão), o content script
     procura pelo processo em janelas de 30 dias — o limite do próprio CCS. */
  async coletar(msg) {
    try {
      const numero = String((msg && msg.numeroProcesso) || "").replace(/\D/g, "");
      if (numero.length !== 20) return { ok: false, motivo: "numero_processo_invalido" };
      const cfgTudo = (await Store.get(CHAVES.config)) || {};
      const registro = (await Store.get("ccs_req:" + numero)) || [];
      const abertas = registro.filter((r) => r && r.numeroRequisicao && !r.encerrada)
        .map((r) => String(r.numeroRequisicao));
      const { docs } = _ccsDocs(msg.partes);
      await Store.set("ccs_estado", {
        ativo: true,
        modo: "coleta",
        numProcesso: msg.numeroProcesso,
        numeroDigitos: numero,
        docs,
        config: _ccsConfig(cfgTudo.ccs),
        fila: abertas,               // vazia → plano B (busca por janelas)
        janela: 0,
        resultados: [],
        fase: abertas.length ? "coleta_ir" : "coleta_buscar",
        abertoEm: new Date().toISOString(),
      });
      await Store.set("ccs_coleta_resultado", null);
      /* 1.6.5: pela entrada (ver executar); da 1201 o content script vai à requisição
         guardada ou à consulta por janelas. */
      await abrirCcs(CCS_URL.inicio);
      return { ok: true, direto: abertas.length > 0, requisicoes: abertas.length };
    } catch (e) {
      return { ok: false, motivo: "erro", erro: e.message || String(e) };
    }
  },
};

/* Abre (ou reusa) a aba do CCS. Sessão caída → o BCB manda para o ADFS; o content
   script avisa e retoma quando você voltar logado. */
async function abrirCcs(url) {
  const abas = await browser.tabs.query({ url: "*://www3.bcb.gov.br/ccs/*" });
  if (abas.length) {
    await browser.tabs.update(abas[0].id, { url, active: true });
  } else {
    await browser.tabs.create({ url, active: true });
  }
  return { ok: true };
}

/* Config em Preferências. */
if (typeof Registro !== "undefined") {
  Registro.adicionar({
    nome: "ccs",
    rotulo: "CCS — Cadastro de Clientes do SFN (Bacen)",
    config: {
      _avisoEscopo: {
        tipo: "aviso",
        nivel: "info",
        rotulo: "Como o CRATOS opera o CCS",
        itens: [
          "<b>Login é seu</b> (ADFS do Banco Central). O CRATOS abre a aba e espera; assim " +
            "que você entrar, ele retoma sozinho.",
          "<b>Dia 1:</b> uma requisição por processo, com <b>todos os executados marcados</b> " +
            "(um CPF/CNPJ por linha). O CRATOS preenche, para no <b>Termo de Uso</b> e na " +
            "<b>solicitação de detalhamento</b> — a não ser que você ligue o automático abaixo. " +
            "Sai a <b>certidão de envio</b>.",
          "<b>Coleta (dia seguinte):</b> botão <i>Coletar CCS</i> no painel. Junta o " +
            "<b>PDF de detalhamentos do próprio CCS</b> (cumulativo) e uma certidão com quem " +
            "já respondeu e <b>quem falta responder</b>. Sem resposta nova, não junta de novo.",
          "<b>Só o PDF do CCS é juntado:</b> tela, TXT e SIMBA vêm incompletos.",
          "<b>Sigilo bancário:</b> os anexos entram <b>sigilosos</b> nos autos.",
          "<b>Chip:</b> depois do envio confirmado, o CRATOS aplica o chip <i>CCS - aguardar " +
            "resposta</i> no processo (desligue abaixo, se a vara não usa). A etiqueta precisa existir " +
            "entre as etiquetas manuais da vara.",
          "<b>Relacionamento não detalhável</b> (instituição sem comunicação com o CCS) é " +
            "pulado e listado na certidão de envio.",
        ],
      },
      aceitarTermo: {
        tipo: "escolha",
        opcoes: [{ valor: "nao", rotulo: "Não — paro no termo para você aceitar" },
                 { valor: "sim", rotulo: "Sim — aceito por você" }],
        padrao: "nao",
        rotulo: "Aceitar automaticamente o Termo de Uso e Responsabilidade (CCSFW0502)?",
      },
      envioAutomatico: {
        tipo: "escolha",
        opcoes: [{ valor: "nao", rotulo: "Não — marco e paro para você clicar" },
                 { valor: "sim", rotulo: "Sim — marco e envio (só se a marcação sair limpa)" }],
        padrao: "nao",
        rotulo: "Enviar a solicitação de detalhamento automaticamente (CCSFW0601)?",
      },
      criterio: {
        tipo: "escolha",
        opcoes: [{ valor: "todas", rotulo: "Todos os relacionamentos detalháveis" },
                 { valor: "sem_data_fim", rotulo: "Só os sem Data Fim (ativos)" }],
        padrao: "todas",
        rotulo: "Quais relacionamentos detalhar (vínculo encerrado pode ter tido movimentação no período)",
      },
      esconderInativos: {
        tipo: "escolha",
        opcoes: [{ valor: "nao", rotulo: "Não — manter os inativos à mostra" },
                 { valor: "sim", rotulo: "Sim — esconder" }],
        padrao: "nao",
        rotulo: "Esconder relacionamentos inativos na tela (só exibição; não muda a marcação)",
      },
      chipCcs: {
        tipo: "toggle",
        padrao: { ativo: true },
        rotulo: 'Aplicar o chip "CCS - aguardar resposta" depois que a solicitação de detalhamento for enviada',
      },
      motivo: {
        tipo: "texto",
        padrao: "Execução trabalhista",
        rotulo: "Motivo da consulta (o nº do processo já vai no campo próprio)",
      },
      pasta: {
        tipo: "texto",
        padrao: "CRATOS",
        rotulo: "Pasta de download (dentro da pasta de downloads do Firefox)",
      },
    },
  });
}

if (typeof module !== "undefined") {
  module.exports = { ModuloCCS, CCS_URL, _ccsConfig, _ccsDocs };
}
