/*
 * teste-ccs-marcacao.js — CCS, tela CCSFW0601 (seleção dos relacionamentos a detalhar).
 * Dados 100% FICTÍCIOS (fixture-ccs.js).
 *
 * O que se trava aqui:
 *  1. Leitura: sufixo = CPF/CNPJ + ISPB + ddmmaaaa → data de início vem do sufixo, Data
 *     Fim do texto da linha; linha SEM sufixo/disabled = não detalhável (IF sem
 *     comunicação com o CCS).
 *  2. ⛔ Critério (a) "todas": marca TODAS as detaláveis — inclusive a linha ESCONDIDA
 *     (a marcação é pelo critério, nunca pela visibilidade) — e nunca chama o
 *     selecionarTodos() da página.
 *  3. ⛔ Critério (b) "sem Data Fim": só as ativas; DESMARCA a que a página trouxe marcada.
 *  4. ⛔ Envio: sem a Preferência, marca e PARA (não clica "Solicitar Detalhamentos").
 *     Com a Preferência, só envia se a marcação saiu LIMPA (trava); senão não envia.
 *  5. Só linha não detalhável → nada é enviado; painel recebe "conferir".
 *  6. ⛔ O sufixo (contém o CPF) não vai para faixa, console nem storage.
 *
 * Reprova a 1.5.4 (não há módulo CCS).
 * Rodar: node teste-ccs-marcacao.js   ·   versão antiga: CRATOS_SRC=<pasta> node …
 */
const H = require("./harness-ccs.js");
const { F, montar, estadoBase, ate, tick } = H;

const falhas = [];
const oks = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }
const NOME = "teste-ccs-marcacao.js";
const EST0601 = (cfg) => {
  const e = estadoBase({ fase: "0801_solicitado", numeroRequisicao: F.REQ });
  Object.assign(e.config, cfg || {});
  return e;
};
const marcado = (t, suf) => {
  const el = t.d.getElementsByName("chbRelSelecionado" + suf)[0];
  return !!(el && el.checked);
};
const semSufixoVazado = (t) => {
  const tudo = JSON.stringify(t.mem) + t.faixas.map((f) => f.t).join("\n") + t.paradas.map((p) => p.t).join("\n") +
    t.logs.join("\n");
  return Object.values(F.SUF).every((s) => tudo.indexOf(s) < 0);
};

(async () => {
  if (!H.existeCcs()) H.reprovaSemModulo(NOME);

  /* ── 1. leitura ────────────────────────────────────────────────────────── */
  {
    const t = montar({ tela: F.TELA_0601({ comCnpj: true }), estado: null });
    const linhas = t.api.lerLinhas0601(t.d);
    const det = linhas.filter((l) => l.detalhavel);
    const ativo = linhas.find((l) => l.sufixo === F.SUF.ativo) || {};
    const comFim = linhas.find((l) => l.sufixo === F.SUF.comFim) || {};
    const cnpj = linhas.find((l) => l.sufixo === F.SUF.cnpjAtivo) || {};
    const nd = linhas.find((l) => !l.detalhavel) || {};
    checar(linhas.length === 5 && det.length === 4, "0601: lê 4 detaláveis + 1 não detalhável");
    checar(ativo.dataInicio === "01/01/2020" && ativo.dataFim === null && ativo.instituicao === "BANCO QUIXABEIRA S.A.",
      "0601: data de início vem do sufixo; linha ativa sem Data Fim; nome da instituição");
    checar(comFim.dataInicio === "15/03/2021" && comFim.dataFim === "02/02/2022", "0601: Data Fim lida do texto da linha");
    checar(ativo.doc === F.CPF && cnpj.doc === F.CNPJ, "0601: documento da pessoa vem do sufixo (CPF 11 / CNPJ 14)");
    checar(nd.sufixo === null && nd.instituicao === "COOPERATIVA SEM COMUNICACAO",
      "0601: checkbox sem sufixo e disabled = não detalhável (IF sem comunicação)");
  }

  /* ── 2. critério (a), envio manual (padrão) ────────────────────────────── */
  {
    const t = montar({ tela: F.TELA_0601(), estado: EST0601() });
    await ate(() => (t.mem["cratos:ccs_estado"] || {}).fase === "0601_aguardando");
    checar(marcado(t, F.SUF.ativo) && marcado(t, F.SUF.comFim) && marcado(t, F.SUF.ocultoComFim),
      "⛔ critério 'todas': marca todas as detaláveis — inclusive a linha ESCONDIDA");
    checar(!t.selecionouTodos && !t.cliques.some((c) => /Selecionar Todos/.test(c)),
      "⛔ nunca usa o selecionarTodos() da página");
    checar(!t.cliques.some((c) => /^Solicitar Detalhamentos$/.test(c)),
      "⛔ envio (padrão): marca e PARA — não clica em Solicitar Detalhamentos");
    const e = t.mem["cratos:ccs_estado"];
    checar(e.marcadas === 3 && e.pretendidas === 3 && e.envioAutomatico === false && (e.linhas || []).length === 4,
      "estado guarda o resumo (sem sufixo) para a certidão: 3 pedidas de 4 linhas");
    checar(t.faixas.some((f) => /marquei 3 relacionamento/.test(f.t) && /1 sem comunicação/.test(f.t)),
      "faixa: quantas marcou e quantas ficaram de fora por falta de comunicação");
    checar(semSufixoVazado(t), "⛔ o sufixo (com o CPF) não aparece na faixa, no console nem no storage");
  }

  /* ── 3. critério (b) ───────────────────────────────────────────────────── */
  {
    const t = montar({ tela: F.TELA_0601({ preMarcado: true }), estado: EST0601({ criterio: "sem_data_fim" }) });
    await ate(() => (t.mem["cratos:ccs_estado"] || {}).fase === "0601_aguardando");
    checar(marcado(t, F.SUF.ativo) && !marcado(t, F.SUF.comFim) && !marcado(t, F.SUF.ocultoComFim),
      "⛔ critério 'sem Data Fim': só a ativa; DESMARCA a que a página trouxe marcada");
    const e = t.mem["cratos:ccs_estado"];
    checar(e.marcadas === 1 && e.criterio === "sem_data_fim" &&
      e.linhas.filter((l) => l.detalhavel && !l.pedida).length === 2,
      "critério 'sem Data Fim': registra as 2 com data fim como não pedidas pelo critério");
  }

  /* ── 4. envio automático ───────────────────────────────────────────────── */
  {
    const t = montar({ tela: F.TELA_0601(), estado: EST0601({ envioAutomatico: true }) });
    await ate(() => t.cliques.some((c) => /^Solicitar Detalhamentos$/.test(c)));
    const e = t.mem["cratos:ccs_estado"];
    checar(t.cliques.some((c) => /^Solicitar Detalhamentos$/.test(c)) && e.fase === "0601_enviado",
      "envio automático com marcação limpa: envia");
    checar(e.envioAutomatico === true && !!e.envioEm, "envio automático: registra que foi por configuração + hora (rastro)");
  }
  {
    /* Um checkbox que "não pega" o clique: a marcação não sai limpa. */
    const t = montar({ tela: F.TELA_0601(), estado: EST0601({ envioAutomatico: true }),
      recusarClique: (el) => el.name === "chbRelSelecionado" + F.SUF.comFim });
    await ate(() => (t.mem["cratos:ccs_estado"] || {}).fase === "0601_aguardando");
    const e = t.mem["cratos:ccs_estado"];
    checar(!t.cliques.some((c) => /^Solicitar Detalhamentos$/.test(c)) && e.divergente === true,
      "⛔ trava: marcação divergente → NÃO envia, mesmo com o automático ligado");
    checar(t.faixas.some((f) => /NÃO enviei/.test(f.t)), "trava: avisa e devolve o clique para você");
  }

  /* ── 5. só não detalhável ──────────────────────────────────────────────── */
  {
    const t = montar({ tela: F.TELA_0601({ soNaoDetalhavel: true }), estado: EST0601({ envioAutomatico: true }) });
    await ate(() => t.mem["cratos:orq_conv_feito"]);
    checar(!t.cliques.some((c) => /Solicitar/.test(c)) && (t.mem["cratos:orq_conv_feito"] || {}).ok === false,
      "só relacionamento não detalhável: nada é enviado; painel recebe 'conferir'");
  }
  {
    /* Critério (b) e nenhuma ativa: idem — nada a pedir. */
    const tela = F.TELA_0601().replace(/<tr >\s*<td><input type="checkbox" name="chbRelSelecionado1234567890900000001[\s\S]*?<\/tr>/, "");
    const t = montar({ tela, estado: EST0601({ criterio: "sem_data_fim", envioAutomatico: true }) });
    await ate(() => t.mem["cratos:orq_conv_feito"]);
    checar(!t.cliques.some((c) => /^Solicitar Detalhamentos$/.test(c)) &&
      /sem Data Fim/.test((t.mem["cratos:orq_conv_feito"] || {}).motivo || ""),
      "critério 'sem Data Fim' sem nenhuma ativa: não envia e diz por quê");
  }

  H.relatorio(NOME, oks, falhas);
})();
