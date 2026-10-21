/*
 * teste-ccs-coleta.js — CCS: certidão de ENVIO (CCSFW0602) e a COLETA das respostas
 * (0801 → 0802, plano B 1301/1302), certidão do ESTADO ATUAL e o PDF do BCB.
 * Dados 100% FICTÍCIOS (fixture-ccs.js).
 *
 * O que se trava aqui:
 *  1. ⛔ Certidão de envio (LGPD, 15/10): CPF completo só do executado consultado;
 *     instituições pelo nome; não detaláveis listadas; NADA de "Pessoas com vínculos".
 *     Rastro (Res. CNJ 615/2025): diz se termo/envio foram por configuração.
 *     Divergência entre o total do CCS e o conferido aparece na certidão.
 *  2. Registro da requisição para a coleta ir direto (a 1301 só busca 30 dias).
 *  3. Coleta com resposta nova → "Gerar Arquivo PDF" → ⛔ só aceita arquivo com data de
 *     geração POSTERIOR ao clique (o nome é fixo e é sobrescrito) → baixa → certidão do
 *     estado atual (quem respondeu, ⛔ quem falta) — não comparativa.
 *  4. ⛔ Regra de ferro: geração que não termina ou arquivo que não é PDF → faixa, NUNCA
 *     certidão. Pendência sem resposta nova → certidão de ESTADO, no máximo 1 por dia.
 *  5. ⛔ Trava de processo na requisição; plano B em janelas de 30 dias; nº à mão.
 *  6. Background: PDF do CCS entra no Cofre/diário como CCS (consulta); ⛔ anexo sigiloso.
 *
 * Reprova a 1.5.4 (não há módulo CCS).
 * Rodar: node teste-ccs-coleta.js   ·   versão antiga: CRATOS_SRC=<pasta> node …
 */
const fs = require("fs");
const path = require("path");
const H = require("./harness-ccs.js");
const { F, montar, estadoBase, ate, tick, AGORA } = H;

const falhas = [];
const oks = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }
const NOME = "teste-ccs-coleta.js";
const certidoes = (t) => t.msgs.filter((m) => m.tipo === "fabricar_pdf");
const textoCert = (m) => ((m && m.linhas) || []).join("\n");
const LINHAS_EST = [
  { instituicao: "BANCO QUIXABEIRA S.A.", dataInicio: "01/01/2020", dataFim: null, doc: F.CPF, detalhavel: true, pedida: true },
  { instituicao: "BANCO TENORIO S.A.", dataInicio: "15/03/2021", dataFim: "02/02/2022", doc: F.CPF, detalhavel: true, pedida: true },
  { instituicao: "COOPERATIVA SEM COMUNICACAO", dataInicio: "10/10/2019", dataFim: null, doc: null, detalhavel: false, pedida: false },
];
const EST0602 = (extra) => estadoBase(Object.assign({
  fase: "0601_aguardando", numeroRequisicao: F.REQ, linhas: LINHAS_EST, criterio: "todas",
  marcadas: 2, pretendidas: 2, termoAutomatico: false, envioAutomatico: false,
}, extra || {}));
const ESTCOLETA = (extra) => estadoBase(Object.assign({
  modo: "coleta", fase: "coleta_ir", fila: [F.REQ], janela: 0, resultados: [],
}, extra || {}));
const REGKEY = "cratos:ccs_req:" + F.PROC;
const ONTEM = "2026-10-15", HOJE = "2026-10-16";

(async () => {
  if (!H.existeCcs()) H.reprovaSemModulo(NOME);

  /* ── 1/2. certidão de envio ─────────────────────────────────────────────── */
  {
    const t = montar({ tela: F.TELA_0602(), estado: EST0602() });
    await ate(() => certidoes(t).length && (t.mem["cratos:ccs_estado"] || {}).ativo === false);
    const c = certidoes(t)[0] || { linhas: [] };
    const tx = textoCert(c);
    checar(c.convenio === "CCS" && c.operacao === "consulta" && c.filename === `CRATOS/${F.PROC}_FULANO FICTICIO CCS envio.pdf`,
      "certidão de envio: convênio CCS (consulta → família 'Convênios realizados'), nome no padrão CRATOS");
    checar(/requisição nº 4242/.test(tx) && /Total de solicitações de detalhamento enviadas \(informado pelo CCS\): 2/.test(tx) &&
      /15\/10\/2026 10:30:00/.test(tx), "certidão de envio: nº da requisição, total e data/hora lidos da CCSFW0602");
    checar(/FULANO FICTICIO DA SILVA - CPF\/CNPJ 123\.456\.789-09/.test(tx),
      "⛔ LGPD: CPF completo do executado consultado (já nos autos)");
    checar(/BANCO QUIXABEIRA S\.A\. — vínculo desde 01\/01\/2020/.test(tx) && /até 02\/02\/2022/.test(tx),
      "certidão de envio: instituições pedidas pelo nome, com o período do vínculo");
    checar(/não detalháveis[\s\S]*COOPERATIVA SEM COMUNICACAO/.test(tx),
      "certidão de envio: relacionamento não detalhável listado, com o porquê");
    checar(tx.indexOf(F.TERCEIRO_NOME) < 0 && tx.indexOf("987.654.321-00") < 0 && tx.indexOf(F.TERCEIRO_CPF) < 0 &&
      !/Pessoas com as quais/i.test(tx), "⛔ LGPD: NADA de 'Pessoas com vínculos' (terceiros) na certidão");
    checar(/Termo de Uso e Responsabilidade do CCS foi feito pelo\(a\) responsável/.test(tx) &&
      /solicitação de detalhamento foi enviada pelo\(a\) responsável/.test(tx),
      "rastro: termo e envio feitos pelo(a) responsável (sem automático)");
    const reg = (t.mem[REGKEY] || [])[0] || {};
    checar(reg.numeroRequisicao === F.REQ && reg.juntadas === 0 && reg.encerrada === false && reg.ultimaCertidao === HOJE,
      "registro da requisição para a coleta (nº, nada juntado ainda)");
    checar(t.faixas.some((f) => /Coletar CCS/.test(f.t)), "faixa: orienta a coletar depois pelo botão do painel");
  }
  {
    const t = montar({ tela: F.TELA_0602({ total: 5 }), estado: EST0602({
      termoAutomatico: true, termoEm: "2026-10-16T12:00:00.000Z", envioAutomatico: true, envioEm: "2026-10-16T12:01:00.000Z" }) });
    await ate(() => certidoes(t).length);
    const tx = textoCert(certidoes(t)[0]);
    checar(/Termo de Uso[\s\S]*registrado automaticamente pelo CRATOS, por configuração/.test(tx) &&
      /enviada automaticamente pelo CRATOS, por configuração/.test(tx),
      "⛔ rastro (Res. CNJ 615/2025): termo e envio por configuração do usuário, com hora");
    checar(/Observo que o CCS informou 5 solicitação\(ões\)[\s\S]*2 relacionamento/.test(tx),
      "divergência entre o total do CCS e o conferido entra na certidão");
  }
  {
    const t = montar({ tela: F.TELA_0602({ proc: F.OUTRO_PROC_FMT }), estado: EST0602() });
    await ate(() => t.paradas.length);
    checar(t.paradas.length === 1 && !certidoes(t).length, "⛔ trava de processo na 0602: outro processo → para, sem certidão");
  }

  /* ── 2b. chip "CCS - aguardar resposta" (1.6.4) ─────────────────────────── */
  {
    const comChip = () => { const e = EST0602(); e.config.chip = true; return e; };
    const t = montar({ tela: F.TELA_0602(), estado: comChip(),
      respostas: { ccs_marcar: { ok: true, chip: "CCS - aguardar resposta", etiqueta: { ok: true } } } });
    await ate(() => t.msgs.some((m) => m.tipo === "ccs_marcar") && t.faixas.some((f) => /Chip/.test(f.t)));
    const iCert = t.msgs.findIndex((m) => m.tipo === "fabricar_pdf");
    const iChip = t.msgs.findIndex((m) => m.tipo === "ccs_marcar");
    checar(iCert >= 0 && iChip > iCert, "⛔ chip: pedido só DEPOIS do envio confirmado e da certidão de envio");
    checar(t.faixas.some((f) => /Chip “CCS - aguardar resposta” aplicado/.test(f.t) && f.c === "#4ade80"),
      "chip aplicado: a faixa verde diz");
    const t2 = montar({ tela: F.TELA_0602(), estado: comChip(),
      respostas: { ccs_marcar: { ok: false, etiqueta: { ok: false, erro: 'não achei o chip "CCS - aguardar resposta" na lista de etiquetas manuais desta vara' } } } });
    await ate(() => t2.faixas.some((f) => /chip/.test(f.t)));
    checar(certidoes(t2).length === 1 && t2.faixas.some((f) => /Não consegui aplicar o chip/.test(f.t) && /etiquetas manuais/.test(f.t) && f.c === "#facc15"),
      "chip que falha: faixa âmbar com o motivo — a certidão sai igual (não trava nada)");
    const t3 = montar({ tela: F.TELA_0602(), estado: EST0602() });
    await ate(() => certidoes(t3).length && (t3.mem["cratos:ccs_estado"] || {}).ativo === false);
    await tick(50);
    checar(!t3.msgs.some((m) => m.tipo === "ccs_marcar"), "chip desligado nas Preferências: não pede nada");

    /* background: a aba do PJe aplica a etiqueta (mesmo caminho do SAB) */
    const bg = fs.readFileSync(path.join(H.SRC, "background.js"), "utf8");
    const corta = (ini) => { const i = bg.indexOf(ini); return i < 0 ? "" : bg.slice(i, bg.indexOf("\n}\n", i) + 3); };
    const mem = {}, enviadas = [];
    const StoreF = { get: async (k) => mem[k], set: async (k, v) => { mem[k] = v; } };
    const browserF = { tabs: { sendMessage: async (tab, m) => { enviadas.push({ tab, m });
      setTimeout(() => { mem.pje_marcacao_resultado = { ok: true, etiqueta: { ok: true } }; }, 20); } } };
    const temFn = bg.indexOf("async function marcarProcessoAposCcs") >= 0;
    const fn = temFn ? new Function("Store", "browser", (bg.match(/const CHIP_CCS = [^\n]+/) || [""])[0] + "\n" +
      corta("async function marcarProcessoAposCcs") + corta("async function _aguardarMarcacao") + "\nreturn marcarProcessoAposCcs;")(StoreF, browserF)
      : async () => ({ ok: null });
    mem.ccs_estado = { config: { chip: true }, tabPje: 7, idProcessoPje: 123 };
    const r = await fn();
    checar(r && r.ok && enviadas[0] && enviadas[0].tab === 7 && enviadas[0].m.tipo === "pje_marcar_processo" &&
      enviadas[0].m.idProcesso === 123 && enviadas[0].m.etiqueta === "CCS - aguardar resposta" && !enviadas[0].m.gigs,
      "⛔ background: manda a aba do PJe aplicar o chip “CCS - aguardar resposta” (sem GIGS)");
    mem.ccs_estado = { config: { chip: true }, tabPje: null };
    checar((await fn()).ok === false, "sem a aba do PJe registrada: avisa, não inventa");
  }

  /* ── 3. coleta com resposta nova ──────────────────────────────────────── */
  {
    const t = montar({ tela: F.TELA_0801_COLETA(), estado: ESTCOLETA(),
      mem: { [REGKEY]: [{ numeroRequisicao: F.REQ, juntadas: 0, encerrada: false, ultimaCertidao: ONTEM }] } });
    await ate(() => t.nav.length);
    const e = t.mem["cratos:ccs_estado"];
    checar(t.cliques.indexOf("Gerar Arquivo PDF com Detalhamentos") >= 0 && e.fase === "coleta_gerando" && e.cliqueEm === AGORA,
      "coleta: resposta nova → pede ao CCS o PDF de detalhamentos (só o PDF; TXT/SIMBA fora)");
    checar(!t.cliques.some((c) => /TXT|SIMBA/.test(c)), "coleta: não toca em TXT nem SIMBA");
    const st = (e && e.atual && e.atual.status) || { respondidas: [], pendentes: [] };
    checar(st.respondidas.length === 1 && st.pendentes.length === 1 && st.naoSolicitadas === 1 &&
      st.respondidas[0].resposta === "15/10/2026 18:00" && st.pendentes[0].instituicao === "BANCO TENORIO S.A.",
      "coleta: status por instituição (respondeu / pendente / não solicitado) — a tabela de terceiros é ignorada");
    checar(/listarArquivosDownload/.test(t.nav[0]), "coleta: o clique não navegou → vai à lista de arquivos");
  }
  {
    /* 0802 REAL (print de 19/10): nome <req>-<AAAAMMDDhhmm>-<login>.pdf; coluna só com a DATA.
       Última resposta lida na 0801: 15/10/2026 18:00. Clique em "Gerar": 16/10 09:00. */
    const ULTIMA = new Date(2026, 9, 15, 18, 0).getTime();
    const est = ESTCOLETA({ fase: "coleta_gerando", cliqueEm: AGORA, atual: { numero: F.REQ, ultimaResposta: ULTIMA,
      status: { respondidas: [{ instituicao: "BANCO QUIXABEIRA S.A.", resposta: "15/10/2026 18:00", doc: F.CPF }],
        pendentes: [{ instituicao: "BANCO TENORIO S.A.", solicitadoEm: "15/10/2026", doc: F.CPF }], naoSolicitadas: 1, docs: [F.CPF] } } });
    const REG0 = () => ({ [REGKEY]: [{ numeroRequisicao: F.REQ, juntadas: 0, encerrada: false, ultimaCertidao: ONTEM }] });
    const arq = (hora, data) => ({ nome: `${F.REQ}-${hora}-USUARIO.TESTE.pdf`, data });

    const velho = [arq("202610151700", "15/10/2026")];   // ANTES da última resposta
    const t = montar({ tela: F.TELA_0802(velho), estado: est });
    checar((t.api.escolherPdf0802 ? 1 : 0) && t.api.ultimaResposta({ respondidas: [{ resposta: "15/10/2026 18:00" }] }) === ULTIMA,
      "última resposta lida da 0801 (para julgar o PDF)");
    await ate(() => t.recargas);
    checar(t.recargas === 1 && !t.baixados.length && !certidoes(t).length,
      "⛔ 0802: PDF gerado ANTES da última resposta não serve (faltaria resposta) — espera e recarrega");

    const t2 = montar({ tela: F.TELA_0802(velho), estado: est, agora: AGORA + 4 * 60 * 1000 });
    await ate(() => t2.mem["cratos:ccs_coleta_resultado"]);
    const res = t2.mem["cratos:ccs_coleta_resultado"] || {};
    checar(!certidoes(t2).length && !t2.baixados.length && ((res.resultados || [])[0] || {}).tipo === "timeout" &&
      t2.faixas.some((f) => /ainda não terminou de gerar/.test(f.t)),
      "⛔ geração que não termina = faixa, NUNCA certidão (regra de ferro)");

    /* O CASO DO PRINT: PDF de uma tentativa ANTERIOR, gerado depois da última resposta. */
    const anterior = [arq("202610151830", "15/10/2026")];
    const t4 = montar({ tela: F.TELA_0802(anterior), estado: est, mem: REG0() });
    await ate(() => t4.mem["cratos:ccs_coleta_resultado"]);
    const pdf = t4.msgs.find((m) => m.tipo === "ccs_pdf") || {};
    checar(t4.recargas === 0 && t4.baixados.length === 1 && /nomeArquivo=4242-202610151830-/.test(t4.baixados[0]),
      "⛔ PDF anterior gerado DEPOIS da última resposta serve — baixa na hora (o bug do print de 19/10)");
    checar(!pdf.doc && pdf.rotulo === "CCS detalhamento 16-10-2026" && pdf.nomeAbrev === "FULANO FICTICIO",
      "PDF vai ao background SEM documento falso (o meio do nome é a hora), com o nome do executado");
    const c = certidoes(t4)[0] || {};
    const tx = textoCert(c);
    checar(/CCS respostas 16-10-2026\.pdf$/.test(c.filename || "") && /gerado pelo próprio CCS \(PDF\), que reúne todas as respostas/.test(tx),
      "certidão da coleta: diz que o PDF é do CCS e cumulativo");
    checar(/Responderam \(1\):\n1\) BANCO QUIXABEIRA S\.A\. — resposta em 15\/10\/2026 18:00/.test(tx),
      "certidão da coleta: quem já respondeu");
    checar(/Aguardando resposta \(1\):\n1\) BANCO TENORIO S\.A\. — solicitado em 15\/10\/2026 \(há 1 dia\)/.test(tx),
      "⛔ certidão da coleta: QUEM FALTA responder, e há quantos dias");
    checar(!/desde a última|anterior/i.test(tx.replace("Não houve resposta nova a juntar desde o arquivo", "")),
      "certidão da coleta: estado atual, não comparativa com a anterior");
    checar(tx.indexOf(F.TERCEIRO_NOME) < 0, "⛔ certidão da coleta: sem terceiros");
    const reg = (t4.mem[REGKEY] || [])[0] || {};
    checar(reg.juntadas === 1 && reg.ultimaCertidao === HOJE && reg.encerrada === false,
      "registro: 1 resposta juntada; requisição segue aberta (há pendente)");
    checar((((t4.mem["cratos:ccs_coleta_resultado"] || {}).resultados || [])[0] || {}).tipo === "pdf" &&
      t4.mem["cratos:ccs_estado"].ativo === false, "coleta concluída e publicada para o painel");

    const varios = [arq("202610151830", "15/10/2026"), { nome: "9999-202610160905-USUARIO.TESTE.pdf", data: "16/10/2026" },
      arq("202610160901", "16/10/2026")];
    const t6 = montar({ tela: F.TELA_0802(varios), estado: est, mem: REG0() });
    await ate(() => t6.mem["cratos:ccs_coleta_resultado"]);
    checar(t6.baixados.length === 1 && /nomeArquivo=4242-202610160901-/.test(t6.baixados[0]),
      "vários PDFs da requisição: baixa só o MAIS RECENTE (um PDF por requisição); outra requisição é ignorada");

    const semHora = (data) => [{ nome: `${F.REQ}-DETALHAMENTO.pdf`, data }];
    const t7 = montar({ tela: F.TELA_0802(semHora("16/10/2026")), estado: est, mem: REG0() });
    await ate(() => t7.mem["cratos:ccs_coleta_resultado"]);
    const t8 = montar({ tela: F.TELA_0802(semHora("15/10/2026")), estado: est });
    await ate(() => t8.recargas);
    checar(t7.baixados.length === 1 && t8.recargas === 1 && !t8.baixados.length,
      "sem hora no nome: só por dia — serve se for de dia POSTERIOR ao da última resposta");

    const t5 = montar({ tela: F.TELA_0802(anterior), estado: est,
      baixar: async () => { const b = F.XML_BYTES; return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) }; } });
    await ate(() => t5.paradas.length);
    checar(t5.paradas.length && /não veio como PDF/.test(t5.paradas[0].t) && !certidoes(t5).length &&
      !t5.msgs.some((m) => m.tipo === "ccs_pdf"), "⛔ arquivo que não é PDF (decidido pelos bytes) → erro, nada juntado");
  }

  /* ── 4. nada novo / pendências ────────────────────────────────────────── */
  {
    const mem = { [REGKEY]: [{ numeroRequisicao: F.REQ, juntadas: 1, encerrada: false, ultimaCertidao: ONTEM }] };
    const t = montar({ tela: F.TELA_0801_COLETA(), estado: ESTCOLETA(), mem });
    await ate(() => t.mem["cratos:ccs_coleta_resultado"]);
    const c = certidoes(t)[0] || {};
    checar(!t.cliques.some((x) => /Gerar/.test(x)) && /CCS aguardando 16-10-2026\.pdf$/.test(c.filename || ""),
      "nada novo + pendência: não gera PDF de novo; certidão de ESTADO");
    checar(/Não houve resposta nova a juntar/.test(textoCert(c)) && /Aguardando resposta \(1\)/.test(textoCert(c)),
      "certidão de estado: diz que não houve resposta nova e quem falta");
    const t2 = montar({ tela: F.TELA_0801_COLETA(), estado: ESTCOLETA(), mem: { [REGKEY]: t.mem[REGKEY] } });
    await ate(() => t2.mem["cratos:ccs_coleta_resultado"]);
    checar(!certidoes(t2).length && (((t2.mem["cratos:ccs_coleta_resultado"] || {}).resultados || [])[0] || {}).tipo === "nada",
      "⛔ certidão de estado no máximo 1 por dia (2ª coleta no mesmo dia não enche os autos)");
  }
  {
    const t = montar({ tela: F.TELA_0801_COLETA({ nenhumaRespondeu: true }), estado: ESTCOLETA(),
      mem: { [REGKEY]: [{ numeroRequisicao: F.REQ, juntadas: 0, encerrada: false, ultimaCertidao: ONTEM }] } });
    await ate(() => t.mem["cratos:ccs_coleta_resultado"]);
    checar(/nenhuma instituição havia respondido/.test(textoCert(certidoes(t)[0])) && !t.cliques.some((x) => /Gerar/.test(x)),
      "ninguém respondeu: certidão de estado, sem PDF");
  }
  {
    const t = montar({ tela: F.TELA_0801_COLETA({ todasResponderam: true }), estado: ESTCOLETA(),
      mem: { [REGKEY]: [{ numeroRequisicao: F.REQ, juntadas: 2, encerrada: false, ultimaCertidao: ONTEM }] } });
    await ate(() => t.mem["cratos:ccs_coleta_resultado"]);
    checar(!certidoes(t).length && (t.mem[REGKEY] || [])[0].encerrada === true,
      "todas responderam e já foram juntadas: nada a fazer; requisição encerrada");
  }
  {
    const t = montar({ tela: F.TELA_0801_COLETA({ proc: F.OUTRO_PROC_FMT }), estado: ESTCOLETA() });
    await ate(() => t.paradas.length);
    checar(t.paradas.length === 1 && !t.cliques.length && !certidoes(t).length,
      "⛔ trava de processo na coleta: requisição de outro processo → para, nada baixado");
  }

  /* ── 5. plano B ───────────────────────────────────────────────────────── */
  {
    const t = montar({ tela: F.TELA_1301, estado: ESTCOLETA({ fase: "coleta_buscar", fila: [] }) });
    await ate(() => t.cliques.length);
    const v = (n) => t.d.querySelector(`[name="${n}"]`).value;
    checar(v("dataFim") === "16/10/2026" && v("dataInicio") === "17/09/2026" && v("numeroProcesso") === F.PROC_FMT &&
      t.cliques[0] === "Consultar", "plano B: janela de 30 dias (17/09 a 16/10) filtrando pelo processo");
    const t2 = montar({ tela: F.TELA_1301, estado: ESTCOLETA({ fase: "coleta_buscar", fila: [], janela: 2 }) });
    await ate(() => t2.cliques.length);
    checar(t2.d.querySelector('[name="dataFim"]').value === "17/08/2026" &&
      t2.d.querySelector('[name="dataInicio"]').value === "19/07/2026", "plano B: janelas sucessivas para trás");
  }
  {
    const linhas = F.linha1302("7777", F.OUTRO_PROC_FMT) + F.linha1302(F.REQ, F.PROC_FMT);
    const t = montar({ tela: F.TELA_1302(linhas), estado: ESTCOLETA({ fase: "coleta_consultado", fila: [] }) });
    await ate(() => t.nav.length);
    const e = t.mem["cratos:ccs_estado"];
    checar(e.fila.length === 1 && e.fila[0] === F.REQ && /numeroRequisicao=4242/.test(t.nav[0]),
      "⛔ plano B: só a requisição DESTE processo entra na fila (trava de processo)");
    const t2 = montar({ tela: F.TELA_1302(""), estado: ESTCOLETA({ fase: "coleta_consultado", fila: [], janela: 0 }) });
    await ate(() => t2.nav.length);
    checar(t2.mem["cratos:ccs_estado"].janela === 1 && /iniciarConsultaRequisicoesRealizadas/.test(t2.nav[0]),
      "plano B: nada nesta janela → tenta a anterior");
    const t3 = montar({ tela: F.TELA_1302(""), estado: ESTCOLETA({ fase: "coleta_consultado", fila: [], janela: 5 }) });
    await ate(() => t3.d.getElementById("cratos-ccs-num"));
    t3.d.getElementById("cratos-ccs-num").value = "4242";
    t3.d.getElementById("cratos-ccs-ok").click();
    await ate(() => t3.nav.length);
    checar(/numeroRequisicao=4242/.test(t3.nav[0] || ""), "plano B esgotado (~6 meses): pede o nº da requisição e vai direto");
  }

  /* ── 5b. vários executados (tela real: um CPF/CNPJ por vez) ─────────────── */
  {
    const docs = [
      { nome: "EXEQUENTE FICTICIO", doc: "11144477735", polo: "ativo" },     // vem primeiro, como no relatório
      { nome: "FULANO FICTICIO DA SILVA", doc: F.CPF, polo: "passivo" },
      { nome: "EMPRESA FICTICIA LTDA", doc: F.CNPJ, polo: "passivo" },
    ];
    const mem = { [REGKEY]: [{ numeroRequisicao: F.REQ, juntadas: 0, encerrada: false, ultimaCertidao: ONTEM }] };
    const t1 = montar({ tela: F.TELA_0801_COLETA({ docs: [F.CPF, F.CNPJ], selecionado: F.CPF }),
      estado: ESTCOLETA({ docs }), mem });
    checar(t1.api.lerDocSelecionado() === F.CPF, "0801 real: lê o CPF/CNPJ SELECIONADO no quadro (o cabeçalho “CPF/CNPJ” da lista não casa)");
    const links = t1.api.lerLinksDocs();
    checar(links.length === 1 && links[0].doc === F.CNPJ, "0801 real: os outros documentos são os links da tabela “CPF/CNPJ Consultados”");
    await ate(() => t1.nav.length);
    const e1 = t1.mem["cratos:ccs_estado"];
    checar(/visualizarRequisicaoCliente/.test(t1.nav[0] || "") && /cpfCnpj=11222333000181/.test(t1.nav[0]) &&
      !t1.cliques.some((c) => /Gerar/.test(c)) && e1.leitura && e1.leitura.porDoc[F.CPF],
      "⛔ vários executados: lê o selecionado, guarda e vai LER o outro documento antes de decidir");

    const t2 = montar({ tela: F.TELA_0801_COLETA({ docs: [F.CPF, F.CNPJ], selecionado: F.CNPJ }),
      estado: e1, mem: { [REGKEY]: t1.mem[REGKEY] } });
    await ate(() => t2.nav.length);
    const e2 = t2.mem["cratos:ccs_estado"];
    const st = (e2.atual && e2.atual.status) || { respondidas: [], pendentes: [] };
    checar(t2.cliques.indexOf("Gerar Arquivo PDF com Detalhamentos") >= 0 && st.respondidas.length === 1 &&
      st.pendentes.length === 2 && st.naoSolicitadas === 1 && st.docs.length === 2,
      "⛔ vários executados: soma os dois documentos (1 respondeu, 2 pendentes, 1 não solicitado) e gera o PDF único");
    checar(st.pendentes.some((p) => p.instituicao === "BANCO DA EMPRESA S.A." && p.doc === F.CNPJ),
      "a pendência do SEGUNDO executado não se perde");

    const novo = [{ nome: `${F.REQ}-202610160900-USUARIO.TESTE.pdf`, data: "16/10/2026" }];
    const t3 = montar({ tela: F.TELA_0802(novo), estado: e2,
      mem: { [REGKEY]: t2.mem[REGKEY] } });
    await ate(() => t3.mem["cratos:ccs_coleta_resultado"]);
    const c = certidoes(t3)[0] || {};
    const tx = textoCert(c);
    checar(/FULANO FICTICIO DA SILVA - CPF\/CNPJ 123\.456\.789-09:\s*Responderam \(1\):\s*1\) BANCO QUIXABEIRA/.test(tx) &&
      /EMPRESA FICTICIA LTDA - CPF\/CNPJ 11\.222\.333\/0001-81:\s*Responderam \(0\):\s*\(nenhuma\)\s*Aguardando resposta \(1\):\s*1\) BANCO DA EMPRESA/.test(tx),
      "⛔ certidão da coleta AGRUPADA por executado");
    checar(/_FULANO FICTICIO CCS respostas/.test(c.filename || "") && !/EXEQUENTE/.test(c.filename || "") && !/EXEQUENTE/.test(tx),
      "⛔ nome do arquivo pelo executado consultado — não pelo exequente (1ª parte do processo)");
  }

  /* ── 6. background + sigilo ───────────────────────────────────────────── */
  {
    const bg = fs.readFileSync(path.join(H.SRC, "background.js"), "utf8");
    const pega = (ini) => { const i = bg.indexOf(ini); return i < 0 ? "" : bg.slice(i, bg.indexOf("\n}\n", i) + 3); };
    const regs = [];
    const fn = new Function("baixarERegistrar", "URL", "Blob",
      pega("function _b64ToBytes") + pega("function montarNomePdf") + pega("async function salvarPdfCcs") +
      "\nreturn salvarPdfCcs;")(
      (url, filename, registro, b64) => regs.push({ filename, registro, b64 }),
      { createObjectURL: () => "blob:x" }, function Blob() {});
    const r = await fn({ base64: F.PDF_BYTES.toString("base64"), numProcesso: F.PROC_FMT, doc: F.CPF,
      nomeAbrev: "FULANO FICTICIO", pasta: "CRATOS", rotulo: "CCS detalhamento 16-10-2026" });
    checar(r.ok && regs[0] && regs[0].filename === `CRATOS/${F.PROC}_FULANO FICTICIO_${F.CPF} CCS detalhamento 16-10-2026.pdf` &&
      regs[0].registro.convenio === "CCS" && regs[0].registro.operacao === "consulta" && regs[0].b64,
      "background: PDF do CCS vai ao Cofre/diário como CCS (consulta), nome com o documento");
    const r2 = await fn({ base64: F.XML_BYTES.toString("base64"), numProcesso: F.PROC_FMT, doc: F.CPF });
    checar(r2.ok === false && regs.length === 1, "background: recusa o que não é PDF (segunda trava)");
    const painel = fs.readFileSync(path.join(H.SRC, "conteudo", "painel.js"), "utf8");
    const anexar = painel.slice(painel.indexOf("async function anexarPdfs"), painel.indexOf("async function acaoJuntar"));
    checar(/sigiloso: true/.test(anexar), "⛔ sigilo bancário: os anexos da juntada (inclusive o PDF do CCS) entram sigilosos");
  }

  H.relatorio(NOME, oks, falhas);
})();
