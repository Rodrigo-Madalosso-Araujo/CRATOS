/*
 * teste-ccs-requisicao.js — CCS, DIA 1 até a solicitação de detalhamento (telas 1201,
 * 0501, 0502, 0801) + módulo de fundo + fiação (manifest, orquestrador, painel).
 * Dados 100% FICTÍCIOS (fixture-ccs.js).
 *
 * O que se trava aqui:
 *  1. Módulo de fundo: uma requisição por processo, executados sem repetir documento,
 *     padrões de fábrica de 15/10 (termo e envio NÃO automáticos, critério = todas,
 *     inativos à mostra, motivo "Execução trabalhista"); coleta vai DIRETO ao nº guardado.
 *  2. 0501: um CPF/CNPJ por linha, nº do processo, motivo; período EM BRANCO.
 *  3. 0501 devolvida com erro → para, e a mensagem da página chega SEM o CPF.
 *  4. ⛔ 0502: sem a Preferência, o CRATOS NÃO aceita o Termo de Uso — para e espera.
 *     Com a Preferência, aceita e registra hora (rastro, Res. CNJ 615/2025).
 *  5. ⛔ Trava de processo: tela de outro processo → para, nada é clicado.
 *  6. 0801: guarda o nº da requisição, deixa os inativos À MOSTRA (padrão) e segue.
 *  7. Sem relacionamento → NADA é enviado; o painel recebe "conferir" (pulso ok:false).
 *
 * Reprova a 1.5.4 (não há módulo CCS).
 * Rodar: node teste-ccs-requisicao.js   ·   versão antiga: CRATOS_SRC=<pasta> node …
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const H = require("./harness-ccs.js");
const { F, montar, estadoBase, ate, tick } = H;

const falhas = [];
const oks = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }
const NOME = "teste-ccs-requisicao.js";

function moduloDeFundo(mem, abas) {
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    browser: {
      storage: { local: {
        get: async (k) => ({ [k]: mem[k] }),
        set: async (o) => Object.assign(mem, JSON.parse(JSON.stringify(o))),
        remove: async () => {},
      }, onChanged: { addListener() {} } },
      tabs: {
        query: async () => [],
        create: async (o) => { abas.push(o.url); return { id: 1 }; },
        update: async (id, o) => { abas.push(o.url); return { id }; },
      },
    },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of [["comum", "storage.js"], ["modulos", "registro.js"], ["modulos", "ccs.js"]]) {
    vm.runInContext(fs.readFileSync(path.join(H.SRC, ...f), "utf8"), ctx);
  }
  vm.runInContext("globalThis.__M = ModuloCCS; globalThis.__R = Registro;", ctx);
  return { M: ctx.__M, R: ctx.__R };
}

(async () => {
  if (!H.existeCcs()) H.reprovaSemModulo(NOME);

  /* ── 1. módulo de fundo ────────────────────────────────────────────────── */
  {
    const mem = {}, abas = [];
    const { M, R } = moduloDeFundo(mem, abas);
    const partes = [
      { nome: "FULANO FICTICIO DA SILVA", cpfcnpj: "123.456.789-09", polo: "passivo" },
      { nome: "FULANO REPETIDO", cpfcnpj: F.CPF, polo: "passivo" },
      { nome: "SEM DOCUMENTO LTDA", cpfcnpj: "", polo: "passivo" },
      { nome: "EMPRESA FICTICIA LTDA", cpfcnpj: "11.222.333/0001-81", polo: "passivo" },
    ];
    const r = await M.executar({ numeroProcesso: F.PROC_FMT, partes }, "consulta");
    const est = mem["cratos:ccs_estado"] || {};
    checar(r.ok && r.aguardando && r.esperados === 1, "módulo: consulta inicia e espera UMA certidão (a de envio)");
    checar(est.docs && est.docs.length === 2 && est.docs[0].doc === F.CPF && est.docs[1].doc === F.CNPJ,
      "módulo: UMA requisição com os executados, sem repetir documento e sem quem não tem CPF/CNPJ");
    const c = est.config || {};
    checar(c.aceitarTermo === false && c.envioAutomatico === false && c.criterio === "todas" &&
      c.esconderInativos === false && c.motivo === "Execução trabalhista",
      "⛔ módulo: padrões de fábrica — termo e envio NÃO automáticos, todas as detaláveis, inativos à mostra, motivo");
    checar(abas[0] === "https://www3.bcb.gov.br/ccs/iniciar.do?method=iniciar",
      "⛔ módulo: abre o CCS pela ENTRADA (iniciar.do), não pela página interna — a volta do login vinha em branco (1.6.5)");
    checar((await M.executar({ numeroProcesso: F.PROC_FMT, partes }, "baixa")).ok === false,
      "módulo: CCS não tem baixa");
    checar((await M.executar({ numeroProcesso: F.PROC_FMT, partes: [partes[2]] }, "consulta")).ok === false,
      "módulo: sem CPF/CNPJ não há o que consultar");
    checar((await M.executar({ numeroProcesso: "123", partes }, "consulta")).ok === false,
      "módulo: número de processo inválido é recusado");
    const rTab = await M.executar({ numeroProcesso: F.PROC_FMT, partes, tabId: 7, idProcesso: 123 }, "consulta");
    const eTab = mem["cratos:ccs_estado"] || {};
    checar(rTab.ok && eTab.tabPje === 7 && eTab.idProcessoPje === 123 && eTab.config.chip === true,
      "⛔ chip: ligado por padrão; guarda a aba e o id do processo no PJe (o chip sai da página do PJe)");
    mem["cratos:config"] = { ccs: { chipCcs: { ativo: false } } };
    await M.executar({ numeroProcesso: F.PROC_FMT, partes, tabId: 7, idProcesso: 123 }, "consulta");
    checar((mem["cratos:ccs_estado"] || {}).config.chip === false, "chip desligado nas Preferências → config.chip false");
    delete mem["cratos:config"];
    const reg = R.obter("ccs");
    checar(reg && reg.config.aceitarTermo.padrao === "nao" && reg.config.envioAutomatico.padrao === "nao" &&
      reg.config.criterio.padrao === "todas" && reg.config.esconderInativos.padrao === "nao" &&
      reg.config.motivo.padrao === "Execução trabalhista",
      "Preferências: as cinco opções do CCS com os padrões combinados");
    checar(reg && reg.config.chipCcs && reg.config.chipCcs.tipo === "toggle" && reg.config.chipCcs.padrao.ativo === true,
      "Preferências: chip “CCS - aguardar resposta” LIGADO de fábrica");

    mem["cratos:ccs_req:" + F.PROC] = [
      { numeroRequisicao: "1111", encerrada: true }, { numeroRequisicao: F.REQ, encerrada: false }];
    abas.length = 0;
    const rc = await M.coletar({ numeroProcesso: F.PROC_FMT, partes });
    const ec = mem["cratos:ccs_estado"];
    checar(rc.ok && rc.direto && ec.modo === "coleta" && ec.fila.length === 1 && ec.fila[0] === F.REQ &&
      ec.fase === "coleta_ir" && /iniciar\.do\?method=iniciar/.test(abas[0]),
      "⛔ coleta: segue DIRETO à requisição guardada (sem a busca limitada a 30 dias), entrando pela tela inicial; encerrada fica de fora");
    mem["cratos:ccs_req:" + F.PROC] = [];
    abas.length = 0;
    const rb = await M.coletar({ numeroProcesso: F.PROC_FMT, partes });
    checar(rb.ok && !rb.direto && mem["cratos:ccs_estado"].fase === "coleta_buscar" &&
      /iniciar\.do\?method=iniciar/.test(abas[0]),
      "coleta sem nº guardado: plano B (consulta de requisições), também entrando pela tela inicial");
  }

  /* ── tela inicial → formulário ─────────────────────────────────────────── */
  {
    const t = montar({ tela: F.TELA_1201, estado: estadoBase() });
    await ate(() => t.nav.length);
    checar(t.nav[0] && /requisitarConsultaCpfCnpj\.do\?method=iniciar/.test(t.nav[0]),
      "CCSFW1201 (ou depois do login): vai para o formulário de consulta");
  }
  {
    const t = montar({ tela: "<html><body><form><input type=password name=senha></form></body></html>",
      url: "https://www3.bcb.gov.br/ccs/indexEstatico.jsp", estado: estadoBase() });
    await tick();
    checar(!t.nav.length && t.faixas.some((f) => /login/i.test(f.t)), "tela de login: espera o login, sem navegar");
  }

  /* ── 2. 0501 ───────────────────────────────────────────────────────────── */
  {
    const est = estadoBase({ docs: [
      { nome: "FULANO FICTICIO DA SILVA", doc: F.CPF }, { nome: "EMPRESA FICTICIA LTDA", doc: F.CNPJ }] });
    const t = montar({ tela: F.TELA_0501, estado: est });
    await ate(() => t.cliques.length);
    const d = t.d;
    checar(d.querySelector('[name="cpfCnpj"]').value === F.CPF + "\n" + F.CNPJ, "0501: um CPF/CNPJ por linha");
    checar(d.querySelector('[name="numeroProcesso"]').value === F.PROC_FMT, "0501: número do processo (formato CNJ)");
    checar(d.querySelector('[name="motivoConsulta"]').value === "Execução trabalhista",
      "0501: motivo da Preferência; o nº do processo NÃO vai no motivo");
    checar(d.querySelector('[name="dataInicio"]').value === "" && d.querySelector('[name="dataFim"]').value === "",
      "0501: Período de Solicitação fica em branco");
    checar(t.cliques[0] === "Continuar" && t.mem["cratos:ccs_estado"].fase === "0501_enviado", "0501: clica Continuar");
  }
  /* ── 3. 0501 devolvida ─────────────────────────────────────────────────── */
  {
    const t = montar({ tela: F.TELA_0501_ERRO, estado: estadoBase({ fase: "0501_enviado" }) });
    await ate(() => t.paradas.length);
    const p = (t.paradas[0] || {}).t || "";
    checar(/devolveu o formulário/.test(p) && /\[CPF\] inválido/.test(p), "0501 devolvida: para e mostra o motivo da página");
    checar(p.indexOf("123.456.789-09") < 0 && p.indexOf(F.CPF) < 0, "⛔ 0501 devolvida: o CPF da mensagem NÃO vai à faixa/console");
    checar(!t.cliques.length, "0501 devolvida: não reenvia sozinho");
  }

  /* ── 4. 0502 ───────────────────────────────────────────────────────────── */
  {
    const t = montar({ tela: F.TELA_0502(), estado: estadoBase({ fase: "0501_enviado" }) });
    await tick(80);
    const termo = t.d.querySelector('[name="assinaturaTermoResponsabilidade"]');
    checar(!termo.checked && !t.cliques.length, "⛔ 0502 (padrão): o CRATOS NÃO aceita o Termo nem requisita por você");
    const e = t.mem["cratos:ccs_estado"];
    checar(e.fase === "0502_aguardando" && e.termoAutomatico === false && t.faixas.some((f) => /Termo de Uso/.test(f.t)),
      "0502 (padrão): para e pede que você aceite o Termo");
  }
  {
    const est = estadoBase({ fase: "0501_enviado" });
    est.config.aceitarTermo = true;
    const t = montar({ tela: F.TELA_0502(), estado: est });
    await ate(() => t.cliques.indexOf("Requisitar Consulta") >= 0);
    const e = t.mem["cratos:ccs_estado"];
    checar(t.d.querySelector('[name="assinaturaTermoResponsabilidade"]').checked &&
      t.cliques.indexOf("Requisitar Consulta") > 0, "0502 (Preferência ligada): marca o aceite e requisita");
    checar(e.termoAutomatico === true && !!e.termoEm && e.fase === "0502_enviado",
      "0502 (Preferência ligada): registra aceite automático + hora (rastro)");
  }
  /* ── 5. trava de processo ──────────────────────────────────────────────── */
  {
    const est = estadoBase({ fase: "0501_enviado" });
    est.config.aceitarTermo = true;
    const t = montar({ tela: F.TELA_0502(F.OUTRO_PROC_FMT), estado: est });
    await ate(() => t.paradas.length);
    checar(t.paradas.length === 1 && !t.cliques.length, "⛔ trava de processo: termo de OUTRO processo → para, nada é clicado");
  }

  /* ── 6. 0801 da requisição ─────────────────────────────────────────────── */
  {
    const t = montar({ tela: F.TELA_0801_REQUISICAO(), estado: estadoBase({ fase: "0502_enviado" }) });
    await ate(() => t.cliques.some((c) => /Solicitar Detalhamentos/.test(c)));
    const e = t.mem["cratos:ccs_estado"];
    checar(e.numeroRequisicao === F.REQ, "0801: guarda o nº da requisição (para a coleta)");
    checar(t.d.getElementById("rM").checked && !t.d.getElementById("rE").checked,
      "⛔ 0801 (padrão): inativos À MOSTRA — troca o rádio que vinha em 'esconder'");
    checar(e.fase === "0801_solicitado", "0801: segue para a seleção de detalhamento");
  }
  {
    const est = estadoBase({ fase: "0502_enviado" });
    est.config.esconderInativos = true;
    const t = montar({ tela: F.TELA_0801_REQUISICAO(), estado: est });
    await ate(() => t.cliques.length);
    checar(t.d.getElementById("rE").checked && !t.cliques.some((c) => /radio/.test(c)),
      "0801 (Preferência 'esconder'): mantém escondidos, sem mexer");
  }
  /* ── 7. sem relacionamentos ────────────────────────────────────────────── */
  {
    const t = montar({ tela: F.TELA_0801_REQUISICAO({ semLinhas: true, semBotao: true }),
      estado: estadoBase({ fase: "0502_enviado" }) });
    await ate(() => t.mem["cratos:orq_conv_feito"]);
    const p = t.mem["cratos:orq_conv_feito"] || {};
    checar(p.convenio === "CCS" && p.ok === false && !t.cliques.some((c) => !/^radio:/.test(c)),
      "sem relacionamentos: NADA é enviado e o painel recebe 'conferir' (pulso ok:false)");
    checar(!t.msgs.some((m) => m.tipo === "ccs_marcar"), "sem relacionamentos: NÃO aplica o chip (nada foi enviado)");
    checar(t.mem["cratos:ccs_estado"].ativo === false && t.faixas.some((f) => /NADA foi enviado/.test(f.t)),
      "sem relacionamentos: encerra e diz que nada foi enviado");
  }
  /* ── desligado ─────────────────────────────────────────────────────────── */
  {
    const t = montar({ tela: F.TELA_0501, estado: estadoBase(), mem: { "cratos:extensao_ligada": false } });
    await tick(80);
    checar(!t.cliques.length && t.d.querySelector('[name="cpfCnpj"]').value === "", "extensão desligada: o CCS não age");
  }

  /* ── fiação ────────────────────────────────────────────────────────────── */
  {
    const man = JSON.parse(fs.readFileSync(path.join(H.SRC, "manifest.json"), "utf8"));
    const cs = (man.content_scripts || []).find((c) => (c.matches || []).indexOf("*://www3.bcb.gov.br/ccs/*") >= 0);
    checar(cs && cs.js.indexOf("comum/storage.js") === 0 && cs.js.indexOf("comum/faixa.js") >= 0 &&
      cs.js[cs.js.length - 1] === "conteudo/ccs.js", "manifest: content script do CCS (storage → faixa → ccs.js)");
    const bg = man.background.scripts;
    checar(bg.indexOf("modulos/ccs.js") > bg.indexOf("modulos/registro.js") && bg.indexOf("modulos/ccs.js") < bg.indexOf("background.js"),
      "manifest: modulos/ccs.js no background, depois do registro");
    checar(man.permissions.indexOf("*://www3.bcb.gov.br/*") >= 0, "manifest: permissão do host do CCS");
    const b = fs.readFileSync(path.join(H.SRC, "background.js"), "utf8");
    checar(/case "CCS":\s*return ModuloCCS\.executar/.test(b) && /case "ccs_coletar":/.test(b) && /case "ccs_pdf":/.test(b) &&
      /CCS: "\*:\/\/www3\.bcb\.gov\.br\/ccs\/\*"/.test(b), "background: orquestrador, coleta, PDF e fechamento de aba do CCS");
    const p = fs.readFileSync(path.join(H.SRC, "conteudo", "painel.js"), "utf8");
    checar(/id: "CCS",[^\n]*ops: \["consulta"\]/.test(p), "painel: CCS na lista (consulta, aparece na INCLUSÃO)");
    checar(/id="cx-coletar-ccs"/.test(p) && /tipo: "ccs_coletar"/.test(p), "painel: botão “Coletar CCS”");
  }

  H.relatorio(NOME, oks, falhas);
})();
