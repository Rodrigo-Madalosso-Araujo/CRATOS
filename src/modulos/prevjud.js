/*
 * modulos/prevjud.js — módulo PREVJUD (Dossiê Previdenciário, CNJ/INSS — previdenciario.pdpj.jus.br).
 * Contrato: { id, label, tipo, operacoes, executar(ctx, operacao), coletar(msg) }.
 *
 * SÓ o Dossiê Previdenciário, por CPF + nº do processo (Rodrigo, 21/10). Dossiê Médico,
 * processo administrativo, consulta por benefício, PENHORA JUDICIAL, implantação e
 * intimação ficam FORA — trava em conteudo/prevjud.js (`clicarSeguro`).
 *
 * Este módulo monta o estado e abre a aba. Quem opera a tela e ESCUTA a API é
 * conteudo/prevjud.js, com o grampo conteudo/prevjud-api.js (contexto da página).
 * Os PDFs oficiais (Extrato CNIS etc.) vêm DENTRO das respostas da API (pdfBase64) ao
 * abrir o "Visualizar": o CRATOS os salva como vieram, sem reprodução.
 *
 * O número de PDFs só se sabe quando o dossiê fica pronto: o módulo NÃO informa
 * `esperados`; o content script manda o pulso TERMINAL no fim (padrão do INFOJUD).
 */

/* Documentos do dossiê: trecho do endpoint (…/1.0.0/{trecho}/{protocolo}) → rótulo e
   interruptor nas Preferências. `secao` = onde o JSON do dossiê (obterDossie) traz a
   mensagem do INSS quando não há o documento. A ordem é a dos botões da tela. */
const PREVJUD_DOCS = [
  { chave: "beneficios", rotulo: "Declaração de Benefícios", rx: "^beneficios$", secao: "beneficios" },
  { chave: "carta", rotulo: "Carta de Concessão", rx: "^carta-concessao", secao: "cartaConcessao" },
  { chave: "cadastrais", rotulo: "Dados Cadastrais", rx: "^dados-cadastrais", secao: "consultaFiliadoTO" },
  { chave: "quadro", rotulo: "Quadro Resumo", rx: "^quadro", secao: null },
  { chave: "extrato", rotulo: "Extrato CNIS", rx: "^extrato", secao: "extratoPrevidenciario" },
  { chave: "historico", rotulo: "Histórico de Créditos", rx: "^hist", secao: "historicoCreditos" },
];

const PREVJUD_URL = "https://previdenciario.pdpj.jus.br/dossie-previdenciario";

/* Config salva → { documentos: {chave: bool}, outros: bool, pasta }. Documento LIGADO
   por padrão: só `{ ativo: false }` explícito desliga. */
function _prevjudConfig(cfg) {
  const c = cfg || {};
  const ligado = (k) => { const t = c[k]; return !(t && t.ativo === false); };
  const documentos = {};
  for (const d of PREVJUD_DOCS) documentos[d.chave] = ligado("doc_" + d.chave);
  return {
    documentos,
    outros: ligado("doc_outros"),
    pasta: String(c.pasta || "CRATOS").replace(/[\\:*?"<>|]/g, "").trim() || "CRATOS",
  };
}

/* Executados do painel → só pessoa física com CPF válido (o dossiê é por CPF). */
function _prevjudDocs(partes) {
  const docs = [];
  const semCpf = [];
  const vistos = new Set();
  for (const p of partes || []) {
    const d = String((p && p.cpfcnpj) || "").replace(/\D/g, "");
    if (d.length !== 11) { if (p && p.nome) semCpf.push({ nome: String(p.nome).trim(), doc: d }); continue; }
    if (vistos.has(d)) continue;
    vistos.add(d);
    docs.push({ nome: String(p.nome || "").trim(), cpf: d });
  }
  return { docs, semCpf };
}

const ModuloPREVJUD = {
  id: "PREVJUD",
  label: "PREVJUD (Dossiê Previdenciário)",
  tipo: "interativo",
  operacoes: ["consulta"],

  async executar(ctx, operacao) {
    try {
      if (operacao !== "consulta") {
        return { ok: false, motivo: `PREVJUD: operação "${operacao}" não existe — o CRATOS só pede o Dossiê Previdenciário (consulta).` };
      }
      const numero = String(ctx.numeroProcesso || "").replace(/\D/g, "");
      if (numero.length !== 20) {
        return { ok: false, motivo: `Número do processo inesperado (${numero.length} dígitos; esperado 20).` };
      }
      const { docs, semCpf } = _prevjudDocs(ctx.partes);
      if (!docs.length) {
        return {
          ok: false,
          motivo: semCpf.length
            ? `O Dossiê Previdenciário é por CPF, e nenhuma das partes marcadas é pessoa física com CPF (${semCpf.map((x) => x.nome).join(", ")}).`
            : "Nenhuma parte marcada no painel.",
        };
      }
      const cfgTudo = (await Store.get(CHAVES.config)) || {};
      const config = _prevjudConfig(cfgTudo.prevjud);
      if (!Object.values(config.documentos).some(Boolean) && !config.outros) {
        return { ok: false, motivo: "Todos os documentos do PREVJUD estão desligados nas Preferências." };
      }
      await Store.set("prevjud_estado", {
        ativo: true,
        modo: "solicitar",
        numProcesso: ctx.numeroProcesso,
        numeroDigitos: numero,
        docs,
        semCpf,
        config,
        pedidos: [],
        fase: "iniciado",
        abertoEm: new Date().toISOString(),
      });
      await abrirPrevjud(PREVJUD_URL);
      /* sem `esperados`: o content script manda o pulso terminal quando termina */
      return { ok: true, aguardando: true };
    } catch (e) {
      console.error("CRATOS/PREVJUD: erro:", e.message);
      return { ok: false, motivo: e.message || String(e) };
    }
  },

  /* COLETA (botão do painel): pedidos que ficaram "em processamento" — os anotados
     neste navegador; sem nenhum, procura pelo nº do processo na lista do PREVJUD. */
  async coletar(msg) {
    try {
      const numero = String((msg && msg.numeroProcesso) || "").replace(/\D/g, "");
      if (numero.length !== 20) return { ok: false, motivo: "numero_processo_invalido" };
      const registro = (await Store.get("prevjud_req:" + numero)) || [];
      const abertos = registro.filter((r) => r && r.protocolo && !r.encerrado);
      const cfgTudo = (await Store.get(CHAVES.config)) || {};
      const nomes = {};
      for (const pt of (msg && msg.partes) || []) {
        const d = String((pt && pt.cpfcnpj) || "").replace(/\D/g, "");
        if (d.length === 11 && pt.nome) nomes[d] = String(pt.nome).trim();
      }
      if (!abertos.length) {
        /* Sem pedido anotado (ex.: o PREVJUD não devolveu o protocolo): procura na LISTA
           do PREVJUD pelo nº do processo — últimos 7 dias (Rodrigo, 21/10). */
        await Store.set("prevjud_estado", {
          ativo: true, modo: "coleta", descobrir: true, numProcesso: msg.numeroProcesso, numeroDigitos: numero,
          docs: [], semCpf: [], nomes, config: _prevjudConfig(cfgTudo.prevjud), pedidos: [],
          fase: "iniciado", abertoEm: new Date().toISOString(),
        });
        await Store.set("prevjud_coleta_resultado", null);
        await abrirPrevjud(PREVJUD_URL);
        return { ok: true, pedidos: 0, descobrir: true };
      }
      await Store.set("prevjud_estado", {
        ativo: true,
        modo: "coleta",
        numProcesso: msg.numeroProcesso,
        numeroDigitos: numero,
        docs: abertos.map((r) => ({ nome: r.nome, cpf: r.cpf })),
        semCpf: [],
        nomes,
        config: _prevjudConfig(cfgTudo.prevjud),
        pedidos: abertos.map((r) => ({ cpf: r.cpf, nome: r.nome, protocolo: r.protocolo, solicitadoEm: r.solicitadoEm, status: r.status || null })),
        fase: "iniciado",
        abertoEm: new Date().toISOString(),
      });
      await Store.set("prevjud_coleta_resultado", null);
      await abrirPrevjud(PREVJUD_URL);
      return { ok: true, pedidos: abertos.length };
    } catch (e) {
      return { ok: false, motivo: "erro", erro: e.message || String(e) };
    }
  },
};

async function abrirPrevjud(url) {
  const abas = await browser.tabs.query({ url: "https://previdenciario.pdpj.jus.br/*" });
  if (abas.length) {
    await browser.tabs.update(abas[0].id, { url, active: true });
  } else {
    await browser.tabs.create({ url, active: true });
  }
  return { ok: true };
}

/* PDF oficial do dossiê (pdfBase64 da API) → Cofre + diário + pulso, no padrão CRATOS
   (com o CPF no nome, para homônimos não colidirem). Confere %PDF pelos bytes. */
async function salvarPdfPrevjud(msg) {
  try {
    let bytes = _b64ToBytes(String(msg.base64 || ""));
    /* defesa: base64 de base64 ("JVBERi…" codificado de novo) */
    if (bytes.length > 5 && bytes[0] === 0x4a && bytes[1] === 0x56 && bytes[2] === 0x42 && bytes[3] === 0x45 && bytes[4] === 0x52) {
      bytes = _b64ToBytes(new TextDecoder("ascii").decode(bytes).replace(/\s+/g, ""));
    }
    if (!(bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
      return { ok: false, erro: "o arquivo do PREVJUD não é PDF" };
    }
    const b64 = _bytesParaBase64(bytes);
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const filename = montarNomePdf(msg.pasta || "CRATOS", msg.numProcesso, msg.nomeAbrev,
      msg.rotulo || "PREVJUD", "pdf", msg.cpf);
    baixarERegistrar(url, filename, {
      numProcesso: msg.numProcesso, convenio: "PREVJUD", operacao: "consulta", detalhe: msg.detalhe || "documento",
    }, b64);
    return { ok: true, filename, presumido: true };
  } catch (e) {
    return { ok: false, erro: String(e.message || e) };
  }
}

/* Config em Preferências. */
if (typeof Registro !== "undefined") {
  const config = {
    _avisoEscopo: {
      tipo: "aviso",
      nivel: "info",
      rotulo: "Como o CRATOS opera o PREVJUD",
      itens: [
        "<b>Login é seu</b> (jus.br / marketplace da PDPJ). O CRATOS abre o Dossiê Previdenciário e " +
          "espera o formulário; aí segue sozinho.",
        "<b>Só o Dossiê Previdenciário</b>, por CPF dos executados <b>pessoa física</b> + nº do processo. " +
          "O CRATOS <b>nunca</b> abre Dossiê Médico, processo administrativo, penhora, implantação ou intimação.",
        "<b>Juntados os PDFs oficiais</b> do INSS (como vieram), conforme os documentos ligados abaixo, " +
          "e uma <b>certidão</b> que diz, por CPF e documento: obtido, sem resposta positiva (com a " +
          "mensagem do INSS), não disponibilizado nesta consulta, ou não solicitado.",
        "<b>Espera:</b> até 15 minutos com a aba coberta. O que não ficar pronto vai na certidão como " +
          "\"em processamento\" e é buscado depois pelo botão <i>Coletar PREVJUD</i> do painel.",
        "<b>Sigilo:</b> os anexos entram <b>sigilosos</b> nos autos. Nada do conteúdo do dossiê é copiado para a certidão.",
      ],
    },
  };
  for (const d of PREVJUD_DOCS) {
    config["doc_" + d.chave] = { tipo: "toggle", padrao: { ativo: true }, rotulo: "Juntar " + d.rotulo };
  }
  config.doc_outros = { tipo: "toggle", padrao: { ativo: true }, rotulo: "Juntar outros documentos que o PREVJUD passar a oferecer" };
  config.pasta = { tipo: "texto", padrao: "CRATOS", rotulo: "Pasta de download (dentro da pasta de downloads do Firefox)" };
  Registro.adicionar({ nome: "prevjud", rotulo: "PREVJUD — Dossiê Previdenciário (CNJ/INSS)", config });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { ModuloPREVJUD, PREVJUD_DOCS, _prevjudConfig, _prevjudDocs };
}
