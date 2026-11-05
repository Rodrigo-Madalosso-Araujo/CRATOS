/*
 * modulos/renajud.js — módulo RENAJUD NOVO (renajud.pdpj.jus.br), no orquestrador.
 * Contrato real: { id, label, tipo, operacoes, executar(ctx, operacao) }.
 * ctx = { idProcesso, numeroProcesso, base, partes, tabId }.
 *
 * Escopo "preparar" (inclusão e baixa): o background semeia renajud_estado e
 * abre/reusa a aba do RENAJUD; o conteudo/renajud.js dirige o SPA. Nunca dá o
 * clique consequente (Confirmar/Cancelar) — isso é do usuário.
 *
 * Depende de abrirRenajud() no background (análogo ao abrirOrdemSab).
 */

const ModuloRENAJUD = {
  /* 1.9.2 (nacionalização): "https://pje.trt18.jus.br" → "TRIBUNAL REGIONAL DO TRABALHO DA
     18A REGIAO" — o nome exato da lista do RENAJUD (recon de 26/10: id "TRT18"). */
  tribunalDoHost(base) {
    const m = String(base || "").match(/\/\/pje\.trt(\d{1,2})\.jus\.br/i);
    if (!m) return "";
    const n = parseInt(m[1], 10);
    return n >= 1 && n <= 24 ? `TRIBUNAL REGIONAL DO TRABALHO DA ${n}A REGIAO` : "";
  },
  id: "RENAJUD",
  label: "RENAJUD (Veículos)",
  tipo: "interativo",
  operacoes: ["inclusao", "baixa"],

  async executar(ctx, operacao) {
    try {
      const cfgTudo = (await Store.get(CHAVES.config)) || {};
      const cfg = cfgTudo.renajud || {};
      const executados = (ctx.partes || []).filter((p) => p.polo === "passivo");

      if (operacao === "inclusao" && executados.length === 0) {
        return { ok: false, motivo: "Nenhum executado (polo passivo) no processo." };
      }

      await Store.set("renajud_estado", {
        ativo: true,
        operacao,                       // "inclusao" | "baixa"
        numProcesso: ctx.numeroProcesso,
        executados,                     // [{nome, cpfcnpj, tipoPessoa, polo}]
        config: {
          tipoRestricao: cfg.tipoRestricao || [],
          ramoJustica: cfg.ramoJustica || "JUSTICA DO TRABALHO",
          /* 1.9.2: sem escolha nas Preferências, o tribunal sai do endereço do PJe */
          tribunal: cfg.tribunal || ModuloRENAJUD.tribunalDoHost(ctx.base) || "",
          orgao: cfg.orgao || "",
          magistrado: cfg.magistrado || "",
        },
        abertoEm: new Date().toISOString(),
      });

      await abrirRenajud(operacao);

      /* Interativo: o painel espera as folhas chegarem. `esperados` = nº de
         executados = nº de folhas (uma por executado). O painel conta as que
         caem no Cofre e avança sozinho quando bate esse número — dois
         executados, duas folhas, avança. Quem tem menos folha que executado
         (parte sem veículo) fica no botão, que é o fallback certo. */
      return { ok: true, aguardando: true, esperados: executados.length };
    } catch (e) {
      console.error("CRATOS/RENAJUD: erro:", e.message);
      return { ok: false, motivo: e.message || String(e) };
    }
  },
};

// Config em Preferências (espelha sab.js). Campos texto = nacionalizável.
if (typeof Registro !== "undefined") {
  Registro.adicionar({
    nome: "renajud",
    rotulo: "RENAJUD (novo) — padrões da restrição",
    config: {
      tipoRestricao: {
        tipo: "multiselect",
        opcoes: ["Transferência", "Licenciamento", "Circulação (Restrição Total)"],
        padrao: [],
        rotulo: "Tipo(s) de restrição",
      },
      tribunal: {
        tipo: "lista",
        opcoes: [
        "CONSELHO SUPERIOR DA JUSTICA DO TRABALHO",
        "TRIBUNAL REGIONAL DO TRABALHO DA 1A REGIAO",
        "TRIBUNAL REGIONAL DO TRABALHO DA 2A REGIAO",
        "TRIBUNAL REGIONAL DO TRABALHO DA 3A REGIAO",
        "TRIBUNAL REGIONAL DO TRABALHO DA 4A REGIAO",
        "TRIBUNAL REGIONAL DO TRABALHO DA 5A REGIAO",
        "TRIBUNAL REGIONAL DO TRABALHO DA 6A REGIAO",
        "TRIBUNAL REGIONAL DO TRABALHO DA 7A REGIAO",
        "TRIBUNAL REGIONAL DO TRABALHO DA 8A REGIAO",
        "TRIBUNAL REGIONAL DO TRABALHO DA 9A REGIAO",
        "TRIBUNAL REGIONAL DO TRABALHO DA 10A REGIAO",
        "TRIBUNAL REGIONAL DO TRABALHO DA 11A REGIAO",
        "TRIBUNAL REGIONAL DO TRABALHO DA 12A REGIAO",
        "TRIBUNAL REGIONAL DO TRABALHO DA 13A REGIAO",
        "TRIBUNAL REGIONAL DO TRABALHO DA 14A REGIAO",
        "TRIBUNAL REGIONAL DO TRABALHO DA 15A REGIAO",
        "TRIBUNAL REGIONAL DO TRABALHO DA 16A REGIAO",
        "TRIBUNAL REGIONAL DO TRABALHO DA 17A REGIAO",
        "TRIBUNAL REGIONAL DO TRABALHO DA 18A REGIAO",
        "TRIBUNAL REGIONAL DO TRABALHO DA 19A REGIAO",
        "TRIBUNAL REGIONAL DO TRABALHO DA 20A REGIAO",
        "TRIBUNAL REGIONAL DO TRABALHO DA 21A REGIAO",
        "TRIBUNAL REGIONAL DO TRABALHO DA 22A REGIAO",
        "TRIBUNAL REGIONAL DO TRABALHO DA 23A REGIAO",
        "TRIBUNAL REGIONAL DO TRABALHO DA 24A REGIAO",
        "TRIBUNAL SUPERIOR DO TRABALHO"
      ],
        padrao: "",
        rotuloVazio: "Automático — pelo endereço do PJe",
        rotulo: "Tribunal",
      },
      orgao: {
        tipo: "lista",
        opcoes: [
        "COORDENADORIA DE MANDADOS JUDICIAIS",
        "DECIMA OITAVA VARA DO TRABALHO DE GOIANIA",
        "DECIMA PRIMEIRA VARA DO TRABALHO DE GOIANIA",
        "DECIMA QUARTA VARA DO TRABALHO DE GOIANIA",
        "DECIMA QUINTA VARA DO TRABALHO DE GOIANIA",
        "DECIMA SEGUNDA VARA DO TRABALHO DE GOIANIA",
        "DECIMA SETIMA VARA DO TRABALHO DE GOIANIA",
        "DECIMA SEXTA VARA DO TRABALHO DE GOIANIA",
        "DECIMA TERCEIRA VARA DO TRABALHO DE GOIANIA",
        "DECIMA VARA DO TRABALHO DE GOIANIA",
        "JUIZO AUXILIAR DE EXECUCAO",
        "NONA VARA DO TRABALHO DE GOIANIA",
        "NUCLEO DE PESQUISA PATRIMONIAL",
        "OITAVA VARA DO TRABALHO DE GOIANIA",
        "POSTO AVANCADO DE IPORA",
        "POSTO AVANCADO DE PIRES DO RIO",
        "POSTO AVANCADO DE PORANGATU",
        "PRIMEIRA VARA DO TRABALHO DE ANAPOLIS",
        "PRIMEIRA VARA DO TRABALHO DE APARECIDA DE GOIANIA",
        "PRIMEIRA VARA DO TRABALHO DE GOIANIA",
        "PRIMEIRA VARA DO TRABALHO DE ITUMBIARA",
        "PRIMEIRA VARA DO TRABALHO DE RIO VERDE",
        "QUARTA VARA DO TRABALHO DE ANAPOLIS",
        "QUARTA VARA DO TRABALHO DE GOIANIA",
        "QUARTA VARA DO TRABALHO DE RIO VERDE",
        "QUINTA VARA DO TRABALHO DE GOIANIA",
        "SECRETARIAGERAL JUDICIARIA",
        "SEGUNDA VARA DO TRABALHO DE ANAPOLIS",
        "SEGUNDA VARA DO TRABALHO DE APARECIDA DE GOIANIA",
        "SEGUNDA VARA DO TRABALHO DE GOIANIA",
        "SEGUNDA VARA DO TRABALHO DE ITUMBIARA",
        "SEGUNDA VARA DO TRABALHO DE RIO VERDE",
        "SETIMA VARA DO TRABALHO DE GOIANIA",
        "SEXTA VARA DO TRABALHO DE GOIANIA",
        "TERCEIRA VARA DO TRABALHO",
        "TERCEIRA VARA DO TRABALHO DE ANAPOLIS",
        "TERCEIRA VARA DO TRABALHO DE APARECIDA DE GOIANIA",
        "TERCEIRA VARA DO TRABALHO DE GOIANIA",
        "TERCEIRA VARA DO TRABALHO DE RIO VERDE",
        "VARA DO TRABALHO DE AGUAS LINDAS",
        "VARA DO TRABALHO DE CALDAS NOVAS",
        "VARA DO TRABALHO DE CATALAO",
        "VARA DO TRABALHO DE CERES",
        "VARA DO TRABALHO DE FORMOSA",
        "VARA DO TRABALHO DE GOIANESIA",
        "VARA DO TRABALHO DE GOIAS",
        "VARA DO TRABALHO DE INHUMAS",
        "VARA DO TRABALHO DE JATAI",
        "VARA DO TRABALHO DE LUZIANIA",
        "VARA DO TRABALHO DE MINEIROS",
        "VARA DO TRABALHO DE PALMEIRAS DE GOIAS",
        "VARA DO TRABALHO DE POSSE",
        "VARA DO TRABALHO DE QUIRINOPOLIS",
        "VARA DO TRABALHO DE SAO LUIS DE MONTES BELOS",
        "VARA DO TRABALHO DE URUACU",
        "VARA DO TRABALHO DE VALPARAISO DE GOIAS",
        "VARO DO TRABALHO DE GOIATUBA"
      ],
        padrao: "",
        rotulo: "Órgão / Unidade",
        listaDinamica: "renajud_orgaos",   // 1.9.2: a lista lida do RENAJUD substitui a do TRT18
        nota: "Em branco, o CRATOS pede que você escolha o órgão na primeira inclusão e guarda aqui.",
      },
      magistrado: { tipo: "texto", padrao: "", rotulo: "Magistrado (documento ou nome)",
        nota: "Em branco, o CRATOS pede que você escolha o magistrado na primeira inclusão e guarda aqui." },
      ramoJustica: {
        tipo: "lista",
        opcoes: [
        "CONSELHO NACIONAL DE JUSTICA",
        "JUSTICA DO TRABALHO",
        "JUSTICA ELEITORAL",
        "JUSTICA ESTADUAL",
        "JUSTICA FEDERAL",
        "JUSTICA MILITAR DA UNIAO",
        "JUSTICA MILITAR ESTADUAL",
        "SUPERIOR TRIBUNAL DE JUSTICA",
        "SUPREMO TRIBUNAL FEDERAL"
      ],
        padrao: "JUSTICA DO TRABALHO",
        rotulo: "Ramo da Justiça",
      },
    },
  });
}
