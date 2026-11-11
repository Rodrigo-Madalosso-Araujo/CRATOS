/*
 * modulos/sniper.js — módulo SNIPER (investigação patrimonial do CNJ, sniper.pdpj.jus.br).
 * Contrato: { id, label, tipo, operacoes, executar(ctx, operacao) }.
 * ctx = { idProcesso, numeroProcesso, base, partes, tabId }.
 *
 * SÓ CONSULTA (investigação). O SNIPER também permite constrição para o perfil de
 * magistrado (Sisbajud, Renajud, ONR): o CRATOS NÃO toca nisso — ver a trava
 * `clicarSeguro` em conteudo/sniper.js e o plano (cratos/plano-sniper.md).
 *
 * Este módulo monta o estado e abre a aba. Quem opera a tela e ESCUTA a API é
 * conteudo/sniper.js, com o grampo conteudo/sniper-api.js (contexto da página).
 * Login (SSO do PDPJ / certificado / gov.br) é sempre do usuário.
 *
 * Saem DOIS PDFs: o relatório (dados que a API entregou à tela, por fonte) e a
 * certidão. O SNIPER não devolve nada depois (Rodrigo, 21/10): fonte "em andamento"
 * é certificada assim, sem coleta posterior.
 */

/* As 8 fontes do SNIPER, pelo slug da API (GET /v2/sistemas) e pelo fim do rótulo do
   checkbox na tela (gravação de 21/10). A ordem é a da tela. */
const SNIPER_FONTES = [
  { slug: "sisbajud", rotulo: "Sisbajud (contas)", tela: "contas" },
  { slug: "renajud", rotulo: "Renajud (veículos)", tela: "veículos" },
  { slug: "serp", rotulo: "SERP/ONR (imóveis)", tela: "imóveis" },
  { slug: "anacjud", rotulo: "AnacJud (aeronaves)", tela: "aeronaves" },
  { slug: "embarcacao", rotulo: "Tribunal Marítimo (embarcações)", tela: "embarcações" },
  { slug: "bem-declarado", rotulo: "TSE (bens declarados)", tela: "bens declarados" },
  { slug: "sngb", rotulo: "SNGB (bens apreendidos)", tela: "bens apreendidos" },
  { slug: "sancao", rotulo: "CGU (sanções diversas)", tela: "sanções diversas" },
];

const SNIPER_URL = "https://sniper.pdpj.jus.br/";

/* Config salva → { fontes: [slugs], pasta }. Fonte LIGADA por padrão: só
   `{ ativo: false }` explícito desliga (como o chip do CCS). */
function _sniperConfig(cfg) {
  const c = cfg || {};
  const fontes = SNIPER_FONTES
    .filter((f) => { const t = c["fonte_" + f.slug]; return !(t && t.ativo === false); })
    .map((f) => f.slug);
  /* 1.9.3 (11/11, pedido do Rodrigo): juntar ou não o grafo (com as fichas dos terceiros)
     e os processos das partes (DataJud). Ausente = ligado (o relatório de sempre).
     Desligado = o CRATOS nem abre a aba correspondente, e o relatório e a certidão dizem
     "não incluído, por configuração" — nunca "sem vínculos" / "sem processos". */
  const ligado = (k) => !(c[k] && c[k].ativo === false);
  return {
    fontes,
    processos: ligado("juntarProcessos"),
    grafo: ligado("juntarGrafo"),
    pasta: String(c.pasta || "CRATOS").replace(/[\\:*?"<>|]/g, "").trim() || "CRATOS",
  };
}

const ModuloSNIPER = {
  id: "SNIPER",
  label: "SNIPER (investigação patrimonial)",
  tipo: "interativo",
  operacoes: ["consulta"],

  async executar(ctx, operacao) {
    try {
      if (operacao !== "consulta") {
        return { ok: false, motivo: `SNIPER: operação "${operacao}" não existe — o CRATOS só faz a investigação (consulta).` };
      }
      const numero = String(ctx.numeroProcesso || "").replace(/\D/g, "");
      if (numero.length !== 20) {
        return { ok: false, motivo: `Número do processo inesperado (${numero.length} dígitos; esperado 20).` };
      }
      const cfgTudo = (await Store.get(CHAVES.config)) || {};
      const config = _sniperConfig(cfgTudo.sniper);
      if (!config.fontes.length) {
        return { ok: false, motivo: "Todas as fontes do SNIPER estão desligadas nas Preferências." };
      }
      /* Partes marcadas no painel: só para CONFERIR contra a lista que o SNIPER traz
         (v1 usa a seleção padrão do SNIPER — todo o polo passivo com documento). */
      const docsPainel = [];
      const vistos = new Set();
      for (const p of ctx.partes || []) {
        const d = String((p && p.cpfcnpj) || "").replace(/\D/g, "");
        if ((d.length !== 11 && d.length !== 14) || vistos.has(d)) continue;
        vistos.add(d);
        docsPainel.push({ nome: String(p.nome || "").trim(), doc: d, polo: p.polo || null });
      }
      await Store.set("sniper_estado", {
        ativo: true,
        numProcesso: ctx.numeroProcesso,
        numeroDigitos: numero,
        docsPainel,
        config,
        fase: "iniciado",
        abertoEm: new Date().toISOString(),
      });
      await abrirSniper(SNIPER_URL);
      /* Dois PDFs: relatório + certidão. O painel avança quando os dois chegam. */
      return { ok: true, aguardando: true, esperados: 2 };
    } catch (e) {
      console.error("CRATOS/SNIPER: erro:", e.message);
      return { ok: false, motivo: e.message || String(e) };
    }
  },
};

/* Abre (ou reusa) a aba do SNIPER na tela inicial. Sem sessão, o PDPJ manda ao SSO;
   o content script espera o formulário aparecer e segue sozinho. */
async function abrirSniper(url) {
  const abas = await browser.tabs.query({ url: "https://sniper.pdpj.jus.br/*" });
  if (abas.length) {
    await browser.tabs.update(abas[0].id, { url, active: true });
  } else {
    await browser.tabs.create({ url, active: true });
  }
  return { ok: true };
}

/* Config em Preferências. */
if (typeof Registro !== "undefined") {
  const config = {
    _avisoEscopo: {
      tipo: "aviso",
      nivel: "info",
      rotulo: "Como o CRATOS opera o SNIPER",
      itens: [
        "<b>Login é seu</b> (SSO do PDPJ, certificado ou gov.br). O CRATOS abre a aba e espera " +
          "o formulário aparecer; aí segue sozinho.",
        "<b>Só investigação.</b> O CRATOS informa o processo, mantém as partes que o SNIPER " +
          "traz (polo passivo), marca as fontes abaixo e clica em <b>Iniciar investigação</b>. " +
          "<b>Nunca</b> clica em bloqueio, restrição ou qualquer constrição.",
        "<b>Saem dois PDFs:</b> o <b>relatório</b>, montado com os dados que o SNIPER entregou à " +
          "tela (uma seção por fonte), e a <b>certidão</b>, que diz, fonte por fonte, se houve " +
          "resultado, se não houve, se a fonte deu erro ou se estava em andamento.",
        "<b>Erro de uma fonte nunca vira \"nada encontrado\".</b> E o que o SNIPER mostra é o " +
          "que vale: ele não devolve resultado depois.",
        "<b>Dados cadastrais e processos:</b> o relatório começa com o cadastro da Receita e os " +
          "processos em nome de cada parte (abas Dados e Processos do \"Mais detalhes\" do SNIPER). " +
          "Os <b>processos</b> e o <b>grafo</b> podem ser desligados abaixo: aí o CRATOS nem os busca, e o " +
          "relatório e a certidão dizem que não foram incluídos por configuração. O cadastro entra sempre. " +
          "<b>Grafo de vínculos (1.9.3):</b> no fim do relatório, cada grafo da aba \"Grafo\" do SNIPER " +
          "redesenhado numa página (legenda do SNIPER), e uma ficha por terceiro vinculado (\"Detalhes do " +
          "objeto\" e relações, com a data de entrada). Vínculos não expandidos (*) não entram. Se o grafo " +
          "não carregar, o relatório diz que não pôde ser obtido — nunca \"sem vínculos\".",
        "<b>Enquanto trabalha</b>, o CRATOS cobre a aba do SNIPER com um aviso (não clique nela). " +
          "Ao terminar, a aba <b>fecha sozinha</b>; se algo der errado, ela fica aberta para você conferir.",
        "<b>Sigilo:</b> os anexos entram <b>sigilosos</b> nos autos.",
      ],
    },
  };
  for (const f of SNIPER_FONTES) {
    config["fonte_" + f.slug] = {
      tipo: "toggle",
      padrao: { ativo: true },
      rotulo: "Consultar " + f.rotulo,
    };
  }
  config.juntarProcessos = {
    tipo: "toggle",
    padrao: { ativo: true },
    rotulo: "Juntar os processos em nome das partes (DataJud — aba Processos do \"Mais detalhes\")",
  };
  config.juntarGrafo = {
    tipo: "toggle",
    padrao: { ativo: true },
    rotulo: "Juntar o grafo de vínculos (com a ficha de cada terceiro vinculado)",
  };
  config.pasta = {
    tipo: "texto",
    padrao: "CRATOS",
    rotulo: "Pasta de download (dentro da pasta de downloads do Firefox)",
  };
  Registro.adicionar({
    nome: "sniper",
    rotulo: "SNIPER — investigação patrimonial (CNJ)",
    config,
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { ModuloSNIPER, SNIPER_FONTES, _sniperConfig };
}
