/*
 * background.js — motor do CRATOS.
 *
 * Responsabilidades:
 *  1. Capturar os dados do processo (via ApiPje) quando o painel pede, e gravar
 *     em storage (cratos:processo). O painel escuta essa chave e se atualiza.
 *  2. Manter o estado da fila de execução (cratos:execucao) — sequencial,
 *     agrupado por convênio: todas as partes de um convênio, depois o próximo.
 *
 * O estado da fila mora AQUI (no storage), não em variáveis do content script.
 * Recarregar a aba não perde o lugar: a máquina de estados é a fonte da verdade.
 */

/* Clique no ícone da barra (browser_action) abre as Configurações direto — como o
   InfoJOB, mas sem popup intermediário. Requer que o manifest NÃO defina default_popup. */
browser.browserAction.onClicked.addListener(() => {
  browser.runtime.openOptionsPage();
});

browser.runtime.onMessage.addListener((msg, sender) => {
  // Só trata as mensagens deste grupo; retorna Promise apenas para elas.
  // Para as demais, retorna undefined SÍNCRONO, deixando outros listeners responderem
  // (evita race condition em que este listener async "vencia" com undefined).
  switch (msg?.tipo) {
    case "capturar":
      return capturar(msg.base, msg.idProcesso, msg.numeroProcesso);
    case "catalogo":
      return Promise.resolve({ modulos: Registro.catalogo() });
    case "iniciarExecucao":
      return iniciarExecucao(msg.plano);
    case "abrirEcacERegistrar":
      return abrirEcacERegistrar(msg.plano);
    case "ecac_pronto":
      return entregarFilaEcac();
    case "ecac_fechar_aba":
      return fecharAbaEcac(sender);
    case "sab_abrir_ordem":
      return abrirOrdemSab(msg);
    case "sab_certidao":
      return gerarCertidaoSab(msg);
    case "sab_fechar_aba":
      return fecharAbaSab(sender);
    case "sab_concluido_auto":
      return marcarProcessoAposSab();
    case "cnib_salvar_pdf":
      return salvarPdfCnib(msg);
    case "ccs_pdf":
      return salvarPdfCcs(msg);
    case "ccs_coletar":
      return ModuloCCS.coletar(msg);
    case "ccs_marcar":
      return marcarProcessoAposCcs();
    case "orquestra_executar":
      return orquestraExecutar(msg, sender);
    case "orq_fechar_aba":
      return fecharAbaConvenio(msg.convenioId);
    case "coletar_achar":
      return coletarAchar(msg.numeroProcesso);
    case "coletar_colher":
      return coletarColher(msg.contexto);
    case "coletar_tudo":
      return coletarTudo(msg.numeroProcesso, msg.pasta, msg.soEfin);
    case "diario_ler":
      return Diario.ler(msg.numProcesso).then((d) => ({ ok: true, diario: d, certidoes: montarCertidoes(d) }));
    case "diario_limpar":
      return Diario.limpar(msg.numProcesso).then(() => ({ ok: true }));
    case "diario_marcar_juntado":
      return Diario.marcarJuntados(msg.numProcesso, msg.familia).then(() => ({ ok: true }));
    /* Cofre em memória (ver o bloco do Cofre). `listar` devolve só nome+tamanho,
       para a tela decidir; `pegar` devolve os bytes, e só a juntada usa. */
    case "cofre_listar":
      return Promise.resolve({ ok: true, arquivos: Cofre.listar(msg.numProcesso) });
    case "cofre_pegar":
      return Promise.resolve({ ok: true, arquivos: Cofre.pegar(msg.numProcesso) });
    case "cofre_limpar":
      Cofre.limpar(msg.numProcesso);
      return Promise.resolve({ ok: true });
    default:
      return undefined;  // não é minha: não respondo (deixa outro listener)
  }
});

async function capturar(base, idProcesso, numeroProcesso) {
  try {
    ApiPje.setBase(base);
    await Store.set(CHAVES.trt, base);
    const processo = await ApiPje.capturarProcesso(idProcesso, numeroProcesso);
    await Store.set(CHAVES.processo, processo);
    return { ok: true, processo };
  } catch (e) {
    const falha = { ok: false, erro: String(e.message || e), status: e.status || null };
    await Store.set(CHAVES.processo, { erro: falha });
    return falha;
  }
}

/*
 * plano = {
 *   convenios: ["infojob", ...],           // ordem de execução
 *   partes: [{nome, cpfcnpj, ...}, ...],   // partes selecionadas pelo usuário
 *   config: { infojob: {...}, ... },
 * }
 *
 * Monta a fila expandida (convênio × partes, agrupada por convênio) e grava o
 * estado inicial. A execução propriamente dita (chamar módulo.executar e avançar
 * os índices) será ligada quando a automação de um convênio existir de verdade —
 * por ora deixamos o estado montado e observável para validar a UI.
 */
async function iniciarExecucao(plano) {
  const itens = [];
  for (const nomeConv of plano.convenios) {
    const mod = Registro.obter(nomeConv);
    if (!mod) continue;
    const partesValidas = plano.partes.filter((p) =>
      (mod.requer || []).every((campo) => p[campo])
    );
    for (const parte of partesValidas) {
      itens.push({
        convenio: nomeConv,
        parte,
        status: "na_fila",   // na_fila → executando → concluido | erro
        resultado: null,
      });
    }
  }

  const estado = {
    id: gerarId(),
    criadoEm: new Date().toISOString(),
    convenioIdx: 0,
    parteIdx: 0,
    itens,
    fase: itens.length ? "pronto" : "vazio",
  };

  await Store.set(CHAVES.execucao, estado);
  return { ok: true, estado };
}

function gerarId() {
  return "exec_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
}

/*
 * PEDAÇO 2c — ligação mínima para TESTAR O REGISTRO.
 * Abre o eCAC (tela de solicitação DECJUIZ) em ABA NOVA e grava a fila de pedidos.
 * A aba do PJe fica intacta. O content script ecac-infojud.js acorda na aba nova,
 * pede a fila (ecac_pronto) e começa a registrar. SEM coleta ainda.
 *
 * plano = { partes: [ {processo, nome, nomeAbrev, ni, tipo}, ... ], config: {...} }
 * (as partes já vêm mapeadas pelo módulo infojud.mapearParte)
 */
/* ═══ A PORTA DO INFOJUD MUDOU (recon de 21/08) ═══
 * Até a 1.0.1 abríamos o link profundo
 * `Servicos/ATSDR/Decjuiz/solicitacao.asp`. A Receita passou a REDIRECIONAR isso
 * para o menu (`Aplicacao.aspx?id=5032&origem=menu`), e o content script — que
 * corretamente só age em `solicitacao.asp` — ficava parado. O sintoma era a aba
 * abrir no eCAC e nada acontecer.
 *
 * O SERVIÇO EM SI NÃO MUDOU: o recon mostra `solicitacao.asp` com os mesmos
 * campos de sempre (processo, tipoProcesso, siglavara, justificativa,
 * novocpfcnpj, novotipo, novoano, btnInserirPedido, Enviar). Mudou o CAMINHO
 * até ele:
 *    Aplicacao.aspx?id=5032   (topo, a casca do eCAC)
 *      └─ iframe: Servicos/ATSDR/Decjuiz/principal.asp   (menu do serviço)
 *           └─ clicar "Registrar Solicitação"
 *                └─ iframe: solicitacao.asp?cnpj=…   ← daqui pra frente é o de sempre
 *
 * `id=5032` é do eCAC federal (mesmo para todo mundo), não do TRT18 — não é
 * débito de nacionalização novo. Ainda assim, o content script NÃO se ancora
 * nesta URL: ele procura o LINK do menu, que é o que ele precisa tocar. */
const ECAC_SOLICITACAO_URL =
  "https://cav.receita.fazenda.gov.br/ecac/Aplicacao.aspx?id=5032&origem=menu";

async function abrirEcacERegistrar(plano) {
  /* GUARDA DE CONTRATO. Esta função tem duas portas — a mensagem do painel e o
     orquestrador — e uma delas chamou com a forma errada por sabe-se lá quanto
     tempo. O estrago não foi o erro: foi o SILÊNCIO. A fila ia vazia para o
     storage, a aba abria, e o content script (corretamente) não fazia nada.
     Fila vazia agora NÃO abre aba: falha aqui, com motivo, é falha que aparece
     no painel em vez de virar aba parada. */
  const partes = plano && Array.isArray(plano.partes) ? plano.partes : null;
  if (!partes || !partes.length) {
    console.error("CRATOS/INFOJUD: plano inválido em abrirEcacERegistrar:", plano);
    return {
      ok: false,
      motivo: "não consegui montar a lista de partes para o INFOJUD. " +
              "Nada foi aberto — confira as partes marcadas e execute de novo.",
    };
  }

  /* Zera as anomalias da execução ANTERIOR. São elas que decidem, lá no fim, se
     a aba pode fechar (`finalizarRegistro`) — se sobrassem de ontem, toda
     execução nova nasceria "suja" e a aba nunca mais fecharia sozinha. */
  await Store.set("ecac_anomalias", []);

  // grava a fila que o content script do eCAC vai consumir
  await Store.set("ecac_fila", {
    partes,
    config: plano.config || {},
    idx: 0,
    criadoEm: new Date().toISOString(),
  });

  const aba = await browser.tabs.create({ url: ECAC_SOLICITACAO_URL, active: true });

  /* `aguardando: true` — E ISTO É O QUE IMPEDE O ATROPELO (21/08).
     O registro no eCAC leva mais de um minuto: o content script preenche parte
     por parte e termina no "Enviar". Sem esta flag o painel lia `{ok:true}`,
     marcava "✓ Concluído" na hora e disparava o PRÓXIMO convênio — o Rodrigo
     viu o RENAJUD abrir enquanto o INFOJUD ainda estava lançando pedidos.
     O INFOJUD é longo como o CNIB e o SerasaJUD, e agora se comporta como eles:
     o painel mostra "⏸ Aguardando conclusão…" e espera o usuário. */
  return { ok: true, aguardando: true, tabId: aba.id, total: partes.length };
}

async function entregarFilaEcac() {
  const fila = await Store.get("ecac_fila");
  return { ok: !!fila, fila: fila || null };
}

/*
 * Fecha a aba de registro do eCAC ao fim do fluxo. Usa sender.tab.id — ou seja,
 * fecha exatamente a aba que pediu o fechamento (o content script do eCAC), sem
 * precisar rastrear o tabId desde a abertura. Limpa a ecac_fila junto para que uma
 * visita manual futura a solicitacao.asp NÃO seja fechada por engano (a fila estaria
 * com idx >= partes.length e dispararia o fechamento de novo). A colheita não depende
 * da fila (abre a própria aba do caixa postal), então limpar aqui é seguro.
 */
async function fecharAbaEcac(sender) {
  const tabId = sender && sender.tab && sender.tab.id;
  await Store.set("ecac_fila", null);
  if (tabId == null) return { ok: false, erro: "sem tabId no sender" };
  try {
    await browser.tabs.remove(tabId);
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: String(e.message || e) };
  }
}

/*
 * Fecha a aba do convênio quando o painel conclui e AVANÇA a fila (o mesmo
 * gatilho). Por HOST — o painel não guarda tabId do convênio, e a aba é sempre
 * a do site do órgão. Fecha todas as abas daquele host (normalmente uma).
 * Idempotente: sem aba, não faz nada. SAB e INFOJUD têm o próprio fechamento.
 */
const HOST_CONVENIO = {
  RENAJUD: "*://renajud.pdpj.jus.br/*",
  CNIB: "*://indisponibilidade.onr.org.br/*",
  CENSEC: "*://*.censec.org.br/*",
  SERASAJUD: "*://serasa-judicial.serasaexperian.com.br/*",
  CCS: "*://www3.bcb.gov.br/ccs/*",
};
async function fecharAbaConvenio(convenioId) {
  const host = HOST_CONVENIO[String(convenioId || "").toUpperCase()];
  if (!host) return { ok: true, fechadas: 0 };   // convênio sem aba própria (ex.: SAB)
  try {
    const abas = await browser.tabs.query({ url: host });
    for (const a of abas) { try { await browser.tabs.remove(a.id); } catch (e) {} }
    return { ok: true, fechadas: abas.length };
  } catch (e) {
    return { ok: false, erro: String(e.message || e) };
  }
}

/*
 * Abre a aba do SAB na tela de minuta nova e semeia o estado pro content script.
 * msg: { idSab, numProcesso, calc }
 */
async function abrirOrdemSab(msg) {
  const { idSab, numProcesso, calc } = msg;
  const url = `https://pje.trt18.jus.br/sab/determinacoes/nova/processo/${idSab}`;

  await Store.set("sab_estado", {
    ativo: true,
    idSab,
    numProcesso,
    calc: calc || null,
    tabPje: msg.tabPje != null ? msg.tabPje : null,
    idProcessoPje: msg.idProcessoPje || null,
    abertoEm: new Date().toISOString(),
  });

  // Reaproveita aba do SAB se já aberta, senão cria
  const abasSab = await browser.tabs.query({
    url: "*://pje.trt18.jus.br/sab/*"
  });
  if (abasSab.length) {
    await browser.tabs.update(abasSab[0].id, { url, active: true });
  } else {
    await browser.tabs.create({ url, active: true });
  }
  return { ok: true };
}

/*
 * MARCAÇÕES DE CONTROLE DEPOIS QUE O SAB CONCLUIU (chip + atividade do GIGS).
 *
 * Roda no `sab_concluido_auto`, que o content script do SAB dispara quando a
 * determinação foi AUTORIZADA — e não quando a extensão terminou de preencher.
 * A diferença importa: "aguardar resposta" só é verdade depois que a ordem
 * existe. Marcar antes seria pôr no processo uma afirmação que o usuário ainda
 * podia desfazer fechando a aba.
 *
 * Só na INCLUSÃO. Na baixa, "SAB em processamento" seria o oposto do que houve.
 *
 * NUNCA derruba o fluxo: se a marcação falhar, o SAB já concluiu e a certidão já
 * foi gerada. O erro vira aviso, não exceção.
 */
const CHIP_SAB = "SISBAJUD - aguardar resposta";
const GIGS_SAB = "SISBAJUD - SAB em processamento: A partir de *";

async function marcarProcessoAposSab() {
  try {
    const est = (await Store.get("sab_estado")) || {};
    if ((est.operacao || "inclusao") === "baixa") return { ok: true, pulado: "baixa" };

    const cfg = ((await Store.get(CHAVES.config)) || {}).sab || {};
    const querChip = !!(cfg.chipSisbajud && cfg.chipSisbajud.ativo);
    const querGigs = !!(cfg.gigsSisbajud && cfg.gigsSisbajud.ativo);
    if (!querChip && !querGigs) return { ok: true, pulado: "desligado" };

    if (est.tabPje == null || !est.idProcessoPje) {
      console.warn("CRATOS/SAB: marcações pedidas, mas a aba do PJe não foi registrada.");
      return { ok: false, erro: "aba do PJe desconhecida" };
    }

    await Store.set("pje_marcacao_resultado", null);
    /* O POST tem de sair da PÁGINA do PJe (ARQ-516). Mesmo caminho do movimento:
       tabs.sendMessage + polling no storage, porque o retorno do sendMessage é
       frágil no MV2 mesmo quando a chamada deu certo. */
    browser.tabs.sendMessage(est.tabPje, {
      tipo: "pje_marcar_processo",
      idProcesso: est.idProcessoPje,
      etiqueta: querChip ? CHIP_SAB : null,
      gigs: querGigs ? GIGS_SAB : null,
    }).catch(() => {});

    const r = await _aguardarMarcacao(15000);
    if (!r) { console.warn("CRATOS/SAB: marcações sem resposta (timeout)."); return { ok: false, erro: "timeout" }; }
    console.log("CRATOS/SAB: marcações —", JSON.stringify(r));
    return r;
  } catch (e) {
    console.warn("CRATOS/SAB: falha nas marcações:", e.message);
    return { ok: false, erro: String(e.message || e) };
  }
}

/* Chip do CCS (1.6.4, pedido do Rodrigo): depois do ENVIO confirmado (CCSFW0602) —
   marcar antes afirmaria "aguardando resposta" de uma solicitação ainda abandonável.
   Mesmo caminho do SAB: a aba do PJe aplica a etiqueta (casada por NOME). Sem GIGS e
   sem remoção ao fim do ciclo (decisão de 19/10). */
const CHIP_CCS = "CCS - aguardar resposta";
async function marcarProcessoAposCcs() {
  try {
    const est = (await Store.get("ccs_estado")) || {};
    if (!(est.config && est.config.chip)) return { ok: true, pulado: "desligado" };
    if (est.tabPje == null || !est.idProcessoPje) return { ok: false, erro: "a aba do PJe não foi registrada" };
    await Store.set("pje_marcacao_resultado", null);
    browser.tabs.sendMessage(est.tabPje, {
      tipo: "pje_marcar_processo", idProcesso: est.idProcessoPje, etiqueta: CHIP_CCS, gigs: null,
    }).catch(() => {});
    const r = await _aguardarMarcacao(15000);
    if (!r) return { ok: false, erro: "a aba do PJe não respondeu" };
    return Object.assign({ chip: CHIP_CCS }, r);
  } catch (e) {
    return { ok: false, erro: String(e.message || e) };
  }
}

async function _aguardarMarcacao(ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const r = await Store.get("pje_marcacao_resultado");
    if (r) return r;
    await new Promise((s) => setTimeout(s, 300));
  }
  return null;
}

/*
 * Abre a determinação JÁ EXISTENTE (baixa) em /sab/determinacoes/{id} e semeia o
 * estado de baixa para o content script conduzir a interrupção automática.
 * (Host fixo trt18 — mesmo débito de nacionalização do abrirOrdemSab.)
 */
async function abrirDeterminacaoSab(msg) {
  const { idDeterminacao, numProcesso, operacao, justificativa } = msg;
  const url = `https://pje.trt18.jus.br/sab/determinacoes/${idDeterminacao}`;

  await Store.set("sab_estado", {
    ativo: true,
    operacao: operacao || "baixa",
    idDeterminacao,
    numProcesso,
    justificativa: justificativa || "Determinação judicial",
    abertoEm: new Date().toISOString(),
  });

  const abasSab = await browser.tabs.query({ url: "*://pje.trt18.jus.br/sab/*" });
  if (abasSab.length) {
    await browser.tabs.update(abasSab[0].id, { url, active: true });
  } else {
    await browser.tabs.create({ url, active: true });
  }
  return { ok: true };
}

/*
 * Gera a certidão de inclusão no SAB (PDF fabricado byte a byte).
 * msg: { numProcesso, nomeAbrev, dataFormatada }
 * Reutiliza gerarPDFTexto do motor de certidões do INFOJUD.
 */
/*
 * Abre/reusa a aba do RENAJUD NOVO (renajud.pdpj.jus.br). Não força a rota nem
 * automatiza login: reaproveita a aba já logada (como o eCAC). A navegação in-app
 * (routerLink) é feita pelo conteudo/renajud.js.
 */
async function abrirRenajud(operacao) {
  const host = "https://renajud.pdpj.jus.br/";
  const abas = await browser.tabs.query({ url: "*://renajud.pdpj.jus.br/*" });
  if (abas.length) {
    await browser.tabs.update(abas[0].id, { active: true });
  } else {
    await browser.tabs.create({ url: host, active: true });
  }
  return { ok: true };
}

/*
 * Abre/reusa a aba do CNIB 2.0 já na tela de cadastro da ordem. Se a sessão não
 * estiver ativa o próprio CNIB redireciona para o login (certificado A3) — o
 * conteudo/cnib.js espera, registra a entidade escolhida e retoma. Não
 * automatizamos autenticação.
 */
async function abrirCnib(operacao) {
  const base = "https://indisponibilidade.onr.org.br";
  const url = operacao === "baixa"
    ? base + "/ordem/cancelamento/total"
    : base + "/ordem/cadastro";
  const abas = await browser.tabs.query({ url: "*://indisponibilidade.onr.org.br/*" });
  if (abas.length) {
    await browser.tabs.update(abas[0].id, { url, active: true });
  } else {
    await browser.tabs.create({ url, active: true });
  }
  return { ok: true };
}

/*
 * Abre (ou reusa) a aba do SerasaJUD direto em Cadastrar Ordem.
 * Se a sessão tiver caído, o próprio site manda para o login (certificado /
 * credencial PJe); conteudo/serasajud.js percebe, avisa e retoma quando entrar.
 */
async function abrirSerasajud() {
  /* A HOME, não a rota profunda. Pedir /cadastrar-ordem por URL dispara o giro
     de autenticação do SerasaJUD (/?token=…) que devolve o usuário para /ordem
     de qualquer jeito. Abrimos onde ele vai parar e o content script clica em
     "Cadastrar Ordem" — navegação interna, sem vaivém. */
  const url = "https://serasa-judicial.serasaexperian.com.br/ordem";
  const abas = await browser.tabs.query({ url: "*://serasa-judicial.serasaexperian.com.br/*" });
  if (abas.length) {
    await browser.tabs.update(abas[0].id, { url, active: true });
  } else {
    await browser.tabs.create({ url, active: true });
  }
  return { ok: true };
}

/*
 * Abre (ou reusa) a aba do CENSEC direto na busca do CEP.
 * O UUID zerado da rota é curinga do próprio site (o maisPJe usa o mesmo).
 * Se a sessão tiver caído, o CENSEC manda para o login (certificado + token por
 * e-mail); conteudo/censec.js percebe, avisa na faixa e retoma quando você entrar.
 */
async function abrirCensec() {
  const url = "https://www.censec.org.br/private/s/00000000-0000-0000-0000-000000000000/cep";
  const abas = await browser.tabs.query({ url: "*://*.censec.org.br/*" });
  if (abas.length) {
    await browser.tabs.update(abas[0].id, { url, active: true });
  } else {
    await browser.tabs.create({ url, active: true });
  }
  return { ok: true };
}

/*
 * Salva o comprovante do CNIB com o NOSSO nome.
 * O "Imprimir" do CNIB é um <a href="/relatorio/.../{hash}"> que baixa um PDF
 * pronto do servidor — o Firefox nomeia o arquivo pelo hash da URL, e nenhum
 * truque de document.title muda isso (title só vale para "imprimir em PDF").
 * Então o content script busca o PDF same-origin e manda os bytes para cá.
 * Mesmo caminho já usado nas certidões do INFOJUD, com a mesma presunção de
 * sucesso (blob URL rejeita a Promise no Firefox mas baixa direito).
 */
/* ═══════════════════════════════════════════════════════════════════════════
 * DIÁRIO DA SESSÃO — o que foi feito neste processo, e que arquivo saiu disso.
 *
 * É o que vira a lista numerada da certidão de convênios ("1 - SAB (inclusão);
 * 2 - RENAJUD; …"). Sem ele, a certidão consolidada não teria de onde sair:
 * hoje cada convênio gera o seu PDF e esquece.
 *
 * ONDE FOI INSTRUMENTADO, e por que ali: **no download**. Todo PDF do CRATOS
 * — certidão fabricada, comprovante do CNIB, resposta do INFOJUD colhida da
 * caixa postal — passa por `browser.downloads.download`. Um ponto só, como a
 * CratosFaixa foi para o rastro do relatório. Instrumentar os seis módulos
 * daria o mesmo resultado e seis lugares para esquecer.
 *
 * O QUE ELE **NÃO** GUARDA: os bytes do PDF. Decisão do Rodrigo (20/08) —
 * quem anexa os arquivos é o usuário, escolhendo-os na pasta CRATOS na própria
 * tela do PJe. Então aqui fica só o NOME do arquivo, para a extensão poder
 * dizer "anexe estes". Guardar PDF significaria dado de parte parado no
 * navegador e tornaria falso o cartão "Sobre o CRATOS". Não vale a troca.
 *
 * Chaveado pelo NÚMERO do processo (20 dígitos), que é o que existe em todos os
 * pontos de download — o id interno do PJe nem sempre está à mão ali.
 * ═══════════════════════════════════════════════════════════════════════════ */
const Diario = {
  _chave(numProcesso) {
    return "diario:" + String(numProcesso || "").replace(/\D/g, "");
  },

  /* ═══ FILA DE ESCRITA — não é zelo, é correção ═══
   * `registrar` faz ler-alterar-gravar no storage, e os downloads NÃO são
   * esperados um pelo outro: o CENSEC baixa uma certidão por parte, a coleta do
   * INFOJUD baixa vários arquivos seguidos. Sem fila, as chamadas leem todas o
   * mesmo estado antigo e a última grava por cima — o teste flagrou 5 downloads
   * virando 1 item. Encadear as promessas serializa as escritas E preserva a
   * ordem de execução, que é o que a lista da certidão precisa. */
  _fila: Promise.resolve(),

  registrar(numProcesso, entrada) {
    const proximo = this._fila.then(() => this._registrar(numProcesso, entrada));
    this._fila = proximo.catch(() => {});   // uma falha não trava a fila inteira
    return proximo;
  },

  async _registrar(numProcesso, entrada) {
    try {
      const digitos = String(numProcesso || "").replace(/\D/g, "");
      if (digitos.length !== 20) return null;            // sem processo, sem diário
      const k = this._chave(digitos);
      const atual = (await Store.get(k)) || { numProcesso: digitos, itens: [] };
      atual.itens.push(Object.assign({ em: new Date().toISOString() }, entrada));
      atual.atualizadoEm = new Date().toISOString();
      await Store.set(k, atual);
      return atual;
    } catch (e) {
      console.warn("CRATOS/diário: falha ao registrar:", e.message);
      return null;                                        // diário nunca derruba fluxo
    }
  },

  async ler(numProcesso) { return (await Store.get(this._chave(numProcesso))) || null; },

  /* Fecha uma família depois que a minuta foi criada nos autos. Não apaga: só
     carimba. Assim o diário continua contando a história do processo, e a
     próxima certidão só oferece o que ainda não foi. */
  marcarJuntados(numProcesso, tipo) {
    const proximo = this._fila.then(async () => {
      const k = this._chave(numProcesso);
      const atual = await Store.get(k);
      if (!atual) return null;
      const fam = _FAMILIAS.find((f) => f.tipo === tipo);
      if (!fam) return atual;
      const agora = new Date().toISOString();
      let n = 0;
      for (const it of atual.itens) {
        if (!it.juntadoEm && fam.operacoes.indexOf(it.operacao) >= 0) { it.juntadoEm = agora; n++; }
      }
      await Store.set(k, atual);
      console.log("CRATOS/diário:", n, "item(ns) marcados como juntados —", tipo);
      return atual;
    });
    this._fila = proximo.catch(() => {});
    return proximo;
  },
  async limpar(numProcesso) { await Store.set(this._chave(numProcesso), null); },
};

/* ═══ A CERTIDÃO CONSOLIDADA, EM HTML ═══
 * O PJe guarda o corpo da minuta como HTML, com as classes dele (`corpo`,
 * `ck_assinatura`) — não é texto puro. Este gerador devolve só o TÓPICO 0
 * ("Conteúdo principal"); o tópico "Assinatura" vem pronto do servidor e é
 * somenteLeitura: quem assina se identifica sozinho.
 *
 * O texto segue o que o Rodrigo escreveu à mão no recon de 20/08 — inclusive a
 * ordem das frases e o "Era o que me cumpria certificar."
 *
 * A LISTA É O DIÁRIO. Cada convênio aparece uma vez, na ordem em que rodou,
 * com a operação entre parênteses quando ela existe ("SAB (inclusão)"). Rodar o
 * mesmo convênio duas vezes no mesmo processo não duplica a linha — o que
 * duplica são os arquivos, e esses o usuário anexa vendo a lista.
 */
const _P_CORPO = 'style="font-size:12pt;line-height:1.5;margin-left:0 !important;' +
                 'text-align:justify;text-indent:4.5cm;"';

function _escHtml(t) {
  return String(t == null ? "" : t)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* Duas famílias de ato, dois documentos. Decisão do Rodrigo (20/08): inclusão e
   baixa são atos distintos e viram certidões distintas nos autos — não dois
   parágrafos do mesmo papel. Consulta (CENSEC, INFOJUD) anda com a inclusão:
   é o que se "realizou" no processo, e nunca aparece na certidão de baixa. */
const _FAMILIAS = [
  {
    tipo: "realizados",
    titulo: "Convênios realizados",
    operacoes: ["inclusao", "consulta", null, undefined, ""],
    abertura: "CERTIFICO E DOU FÉ, para conhecimento do MM. Juiz, que foram " +
              "realizados os seguintes convênios:",
    fecho: "CERTIFICO, por fim, que as respostas dos convênios estão anexadas a " +
           "presente certidão.",
  },
  {
    tipo: "baixa",
    titulo: "Cancelamento das restrições",
    operacoes: ["baixa", "exclusao", "cancelamento"],
    /* Uma fórmula só para SAB, RENAJUD, CNIB e SerasaJUD — e o termo é
       CANCELAMENTO, escolha do Rodrigo (20/08). Cada sistema chama o ato de um
       jeito (cancelamento no CNIB, interrupção no SAB, retirada de restrição no
       RENAJUD, baixa de dívida no SerasaJUD), mas no processo é tudo
       cancelamento de restrição. */
    abertura: "CERTIFICO E DOU FÉ, para conhecimento do MM. Juiz, que procedi ao " +
              "cancelamento das restrições nos seguintes convênios:",
    fecho: "CERTIFICO, por fim, que os comprovantes dos cancelamentos estão " +
           "anexados a presente certidão.",
  },
];

/* Devolve UMA certidão por família presente no diário. Sessão só de inclusão dá
   uma; sessão só de baixa dá uma; a sessão mista (rara, porque os dois atos
   vivem em momentos diferentes do processo) dá duas. Nunca devolve documento em
   branco: família sem item não vira certidão. */
function montarCertidoes(diario) {
  /* Item já juntado NÃO reaparece. É isto que impede a certidão de agosto de
     listar as inclusões de março — e é melhor do que apagar o diário: o
     histórico fica, mas sai da fila. */
  const itens = ((diario && diario.itens) || []).filter((i) => !i.juntadoEm);
  if (!itens.length) return [];

  const p = (txt) => `<p class="corpo" ${_P_CORPO}>${txt}</p>`;
  const saida = [];

  for (const fam of _FAMILIAS) {
    const meus = itens.filter((i) => fam.operacoes.indexOf(i.operacao) >= 0);
    if (!meus.length) continue;

    /* Um convênio por linha, na ordem em que rodou, sem repetir. A operação NÃO
       vai entre parênteses: a frase de abertura já diz qual é o ato, e repetir
       daria "1 - SAB (baixa); 2 - RENAJUD (baixa)". */
    const nomes = [];
    for (const it of meus) {
      const nome = String(it.convenio || "?").toUpperCase();
      if (nomes.indexOf(nome) < 0) nomes.push(nome);
    }
    /* UM CONVÊNIO POR LINHA (Rodrigo, 21/08). Antes saíam todos no mesmo
       parágrafo, separados por ponto e vírgula — e numa certidão com cinco
       convênios aquilo vira um bloco que ninguém lê. Cada item é um parágrafo
       próprio; o último fecha com ponto, os demais com ponto e vírgula, como se
       escreve uma relação. */
    /* `linhasRelacao`, não `itens`: `itens` já é o diário, no escopo de fora —
       reusar o nome dava TDZ e derrubava a função inteira. */
    const relacao = (lista) => lista.map((t, i) =>
      `${i + 1} - ${_escHtml(t)}${i === lista.length - 1 ? "." : ";"}`);

    /* 1.6.2 — NADA A CANCELAR. Na baixa, convênio que pesquisou e não achou restrição
       ativa (CNIB "não localizado"/"já cancelada", RENAJUD "Nenhuma restrição
       encontrada") gera certidão própria com detalhe "nada_a_cancelar". Ele NÃO pode
       entrar no "procedi ao cancelamento" — a certidão afirmaria um cancelamento que
       não houve. Convênio com algum cancelamento de fato fica no grupo de cancelados. */
    let corpo;
    if (fam.tipo === "baixa") {
      const cancelou = (nome) => meus.some((it) =>
        String(it.convenio || "?").toUpperCase() === nome && it.detalhe !== "nada_a_cancelar");
      const cancelados = nomes.filter(cancelou);
      const nada = nomes.filter((n) => !cancelou(n));
      const fraseNada = "não foram localizadas restrições ativas a cancelar nos seguintes convênios:";
      if (!nada.length) {
        corpo = p(fam.abertura) + relacao(cancelados).map(p).join("") + p(fam.fecho);
      } else if (!cancelados.length) {
        corpo = p("CERTIFICO E DOU FÉ, para conhecimento do MM. Juiz, que " + fraseNada) +
          relacao(nada).map(p).join("") +
          p("CERTIFICO, por fim, que as certidões das pesquisas estão anexadas a presente certidão.");
      } else {
        corpo = p(fam.abertura) + relacao(cancelados).map(p).join("") +
          p("CERTIFICO, ainda, que " + fraseNada) + relacao(nada).map(p).join("") +
          p("CERTIFICO, por fim, que os comprovantes dos cancelamentos e as certidões das pesquisas " +
            "estão anexados a presente certidão.");
      }
    } else {
      corpo = p(fam.abertura) + relacao(nomes).map(p).join("") + p(fam.fecho);
    }

    saida.push({
      tipo: fam.tipo,
      titulo: fam.titulo,
      html: p("CERTIDÃO") + corpo + p("Era o que me cumpria certificar."),
      convenios: nomes,
      /* Os arquivos de CADA certidão são só os daquela família — o comprovante
         de baixa não pode ir anexo à certidão de inclusão. */
      arquivos: [...new Set(meus.map((i) => i.arquivo).filter(Boolean))],
    });
  }
  return saida;
}

/* Baixa e registra no diário, em uma chamada só. Todo download do CRATOS passa
   por aqui — é o que garante que o diário não fique para trás quando alguém
   acrescentar um convênio novo. */
/* ═══════════════════════════════════════════════════════════════════════════
 * COFRE — os bytes dos PDFs, EM MEMÓRIA, enquanto o navegador estiver aberto
 * ═══════════════════════════════════════════════════════════════════════════
 * Para ANEXAR os PDFs na juntada é preciso tê-los em base64 na hora do POST. As
 * opções eram três, e duas são ruins:
 *  · ler a pasta de downloads — IMPOSSÍVEL: o Firefox não dá acesso a disco, e
 *    `browser.downloads` salva mas não devolve conteúdo;
 *  · guardar em `storage.local` — estoura a cota sem `unlimitedStorage`, que
 *    APARECE NA CAIXA DE INSTALAÇÃO ao lado dos hosts, e tornaria falso o cartão
 *    "Sobre" ("sobrescritos a cada nova operação"), obrigando a inventar
 *    política de expurgo;
 *  · guardar EM MEMÓRIA — que é o que fazemos. O CRATOS é MV2 e o background é
 *    PERSISTENTE: os bytes vivem aqui do convênio até a juntada, minutos depois,
 *    na mesma sessão do navegador.
 *
 * O que compra: nada em disco, nada para expurgar, nenhuma permissão nova, o
 * cartão "Sobre" continua verdadeiro. O que custa: fechou o navegador (ou
 * recarregou a extensão), os bytes se foram — e a juntada volta ao
 * comportamento de sempre, listando os nomes para o usuário anexar à mão.
 * Degradação honesta: o pior caso é exatamente o que já era o normal.
 */
/* Uint8Array -> base64, em blocos: String.fromCharCode estoura com PDF grande
   se mandarmos tudo de uma vez. */
function _bytesParaBase64(bytes) {
  let bin = "";
  const passo = 0x8000;
  for (let i = 0; i < bytes.length; i += passo) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + passo));
  }
  return btoa(bin);
}

const Cofre = {
  _porProcesso: new Map(),          // numProcesso(dígitos) -> [{nome, base64, bytes, em}]
  TETO_PROCESSO: 9 * 1024 * 1024,   // abaixo do teto de upload do PJe (10 MB)

  _chave(n) { return String(n || "").replace(/\D/g, ""); },

  guardar(numProcesso, filename, base64) {
    const k = this._chave(numProcesso);
    if (!k || !base64) return null;
    let nome = String(filename || "").split("/").pop();
    const bytes = Math.floor(base64.length * 3 / 4);
    const lista = this._porProcesso.get(k) || [];
    /* ⛔ REDE DE SEGURANÇA (camada 2, 04/09). O critério é o CONTEÚDO EXATO, não
       o nome nem o tamanho (tamanho colide entre PDFs diferentes — o Rodrigo
       apontou certo). Mesmo nome:
         · MESMO base64  → é o ato refeito (retry): fica a versão nova;
         · base64 DIFERENTE → são DOIS documentos (ex.: duas executadas homônimas):
           mantém os dois, renomeando o novo — NUNCA descarta em silêncio.
       Assim, mesmo que um convênio esqueça de deixar o nome único, nenhum
       documento some da juntada. O nome final é o que vai ao diário e à juntada
       (por isso `guardar` DEVOLVE o nome de fato usado). */
    const existente = lista.find((x) => x.nome === nome);
    if (existente) {
      if (existente.base64 === base64) {
        lista.splice(lista.indexOf(existente), 1);          // retry: troca
      } else {
        nome = this._nomeUnico(lista, nome);                // documento diferente: preserva os dois
      }
    }
    lista.push({ nome, base64, bytes, em: Date.now() });
    /* Teto por processo: descarta os MAIS ANTIGOS até caber. Guardar demais e
       estourar no POST seria pior que guardar de menos e avisar. */
    let total = lista.reduce((s, x) => s + x.bytes, 0);
    while (total > this.TETO_PROCESSO && lista.length > 1) total -= lista.shift().bytes;
    this._porProcesso.set(k, lista);
    return nome;
  },

  /* "arquivo.pdf" -> "arquivo (2).pdf" (e (3), (4)… até não colidir). */
  _nomeUnico(lista, nome) {
    const m = String(nome).match(/^(.*?)(\.[^.]+)?$/);
    const base = m[1] || nome;
    const ext = m[2] || "";
    let n = 2, cand;
    do { cand = `${base} (${n})${ext}`; n++; } while (lista.some((x) => x.nome === cand));
    return cand;
  },

  listar(numProcesso) {
    return (this._porProcesso.get(this._chave(numProcesso)) || [])
      .map((x) => ({ nome: x.nome, bytes: x.bytes }));
  },
  pegar(numProcesso) {
    return (this._porProcesso.get(this._chave(numProcesso)) || [])
      .map((x) => ({ nome: x.nome, base64: x.base64, bytes: x.bytes }));
  },
  limpar(numProcesso) { this._porProcesso.delete(this._chave(numProcesso)); },
};

/* Gancho de teste — o cofre é a peça nova da juntada e precisa ser exercitado
   direto, sem subir o background inteiro. */
globalThis.__cratosCofre = Cofre;

/* `base64` é opcional: quem tem os bytes passa e alimenta o cofre; quem não tem
   segue igual — download e diário não mudam. */
function baixarERegistrar(url, filename, registro, base64) {
  /* O NOME QUE VALE é o que o Cofre de fato guardou — ele pode ter renomeado para
     não sobrescrever um documento diferente (rede de segurança). O diário, o pulso
     de contagem e a juntada precisam TODOS falar desse mesmo nome, senão a juntada
     não casa o arquivo. Por isso o diário/pulso usam `nomeCofre` quando existir. */
  let nomeCofre = null;
  try {
    if (registro && registro.numProcesso && base64) {
      nomeCofre = Cofre.guardar(registro.numProcesso, filename, base64);
    }
  } catch (e) { console.warn("CRATOS: não consegui guardar no cofre:", e.message); }
  browser.downloads.download({ url, filename, conflictAction: "uniquify", saveAs: false })
    .then((id) => console.log("CRATOS: baixado id", id, "->", filename))
    .catch(() => console.log("CRATOS: Promise rejeitada (esperado no FF), download prosseguiu:", filename));
  setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 120000);
  if (registro && registro.numProcesso) {
    const nomeFinal = nomeCofre || String(filename || "").split("/").pop();
    Diario.registrar(registro.numProcesso, {
      convenio: registro.convenio || "?",
      operacao: registro.operacao || null,
      detalhe: registro.detalhe || null,
      arquivo: nomeFinal,
    });
    emitirPulsoConclusao(registro, nomeFinal);
  }
}

/* PULSO DE CHEGADA (1.2.0 → 1.2.2). Cada artefato que cai no Cofre gera um pulso
   `orq_conv_feito`. A PROVA no disco, não um flag ("artefato é prova, flag é
   promessa", a lição de 1.1.1).

   O painel CONTA as chegadas e avança quando bate o `esperados` que o módulo
   informou no dispatch (= nº de certidões daquele convênio). Dois executados,
   duas folhas → avança. É o modelo do Rodrigo, e o certo:
     · o número de certidões é do MÓDULO (ele conhece os executados), não daqui;
     · aqui só se anuncia "chegou MAIS um" — com o NOME do arquivo, para o painel
       contar DISTINTOS e não somar um reenvio duas vezes.
   Convênio cujo `esperados` o módulo não informa (ex.: CNIB baixa, nº de
   protocolos só conhecido na tela) o painel conclui pelo BOTÃO — a chegada é
   contada, mas sem alvo não dispara avanço. O INFOJUD não passa por aqui (não
   gera artefato na hora); ele emite o próprio pulso no finalizarRegistro. */
function emitirPulsoConclusao(registro, filename) {
  const convenio = String(registro.convenio || "").toUpperCase();
  if (!convenio || convenio === "?") return;
  Store.set("orq_conv_feito", {
    convenio,
    numProcesso: registro.numProcesso,
    operacao: registro.operacao || null,
    ok: true,
    arquivo: String(filename || "").split("/").pop(),
    em: Date.now(),
  }).catch((e) => console.warn("CRATOS: não consegui emitir pulso de chegada:", e.message));
}

async function salvarPdfCnib(msg) {
  try {
    const bytes = _b64ToBytes(msg.base64);
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    baixarERegistrar(url, msg.filename, {
      numProcesso: msg.numProcesso, convenio: "CNIB",
      operacao: msg.operacao || null, detalhe: msg.detalhe || null,
    }, msg.base64);
    return { ok: true, filename: msg.filename, presumido: true };
  } catch (e) {
    return { ok: false, erro: String(e.message || e) };
  }
}

/*
 * PDF de detalhamentos do CCS — o documento do PRÓPRIO Banco Central, baixado pelo
 * content script (same-origin) e conferido pelos bytes (%PDF) lá. Aqui só nomeamos no
 * padrão CRATOS (com o CPF/CNPJ, para executados homônimos não colidirem) e passamos
 * pelo caminho de sempre: Cofre (para a juntada anexar, sigiloso) + diário + pulso.
 */
async function salvarPdfCcs(msg) {
  try {
    const bytes = _b64ToBytes(msg.base64);
    if (!(bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
      return { ok: false, erro: "o arquivo do CCS não é PDF" };
    }
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const filename = montarNomePdf(msg.pasta || "CRATOS", msg.numProcesso, msg.nomeAbrev,
      msg.rotulo || "CCS detalhamento", "pdf", msg.doc);
    baixarERegistrar(url, filename, {
      numProcesso: msg.numProcesso, convenio: "CCS", operacao: "consulta", detalhe: "detalhamento",
    }, msg.base64);
    return { ok: true, filename, presumido: true };
  } catch (e) {
    return { ok: false, erro: String(e.message || e) };
  }
}

/*
 * Despachante do orquestrador — recebe o convenioId + operacao + ctx do painel
 * e chama o módulo correto. Cada módulo vive em modulos/{id}.js, carregado pelo manifest.
 */
async function orquestraExecutar(msg, sender) {
  const { convenioId, operacao, ctx } = msg;
  // Guarda o tabId de quem disparou (a aba do PJe) — usado para delegar POSTs
  // que precisam sair da origem da página (ex.: lançar movimento).
  if (sender && sender.tab) ctx.tabId = sender.tab.id;
  switch (convenioId) {
    case "SAB":
      return ModuloSAB.executar(ctx, operacao);
    case "INFOJUD":
      return executarInfojud(ctx, operacao);
    case "RENAJUD":
      return ModuloRENAJUD.executar(ctx, operacao);
    case "CNIB":
      return ModuloCNIB.executar(ctx, operacao);
    case "CENSEC":
      return ModuloCENSEC.executar(ctx, operacao);
    case "SERASAJUD":
      return ModuloSERASAJUD.executar(ctx, operacao);
    case "CCS":
      return ModuloCCS.executar(ctx, operacao);
    default:
      return { ok: false, motivo: `Convênio ${convenioId} não implementado nesta versão.` };
  }
}

/*
 * Repassa o lançamento de movimento ao content script da aba do PJe, que faz o
 * POST com a origem legítima da página (o background sairia com moz-extension://
 * e o PJe recusa por CORS/papel — ARQ-516). [Mantido como referência; o módulo SAB
 * agora chama tabs.sendMessage diretamente com o ctx.tabId.]
 */

/*
 * Adaptador do INFOJUD para o contrato do orquestrador.
 * O fluxo original do INFOJUD (abrirEcacERegistrar) continua igual —
 * aqui só fazemos a ponte entre o orquestrador e o motor existente.
 */
async function executarInfojud(ctx, operacao) {
  if (operacao !== "consulta") {
    return { ok: false, motivo: "INFOJUD é só consulta." };
  }
  // Reutiliza o fluxo existente: captura já rodou, monta o plano e abre o eCAC
  const processo = await Store.get(CHAVES.processo);
  if (!processo) return { ok: false, motivo: "Processo não capturado." };

  const cfgTudo = (await Store.get(CHAVES.config)) || {};
  const cfg = cfgTudo.infojud || {};
  /* `.filter(Boolean)` não bastava: `mapearParte` SEMPRE devolve objeto, mesmo
     para parte sem documento — então quem não tinha CPF/CNPJ entrava na fila com
     NI vazio e ia parar no eCAC assim. O corte tem de ser pelo NI: 11 dígitos
     (CPF) ou 14 (CNPJ), nada no meio. */
  const mapeadas = (ctx.partes || processo.partes || []).map(p =>
    ModuloInfojud.mapearParte(p, processo, cfg)   // o OBJETO, não só o número
  ).filter(Boolean);

  const niValido = (m) => (m.tipo === "CPF" && m.ni.length === 11) ||
                          (m.tipo === "CNPJ" && m.ni.length === 14);
  const partes = mapeadas.filter(niValido);
  const semDocumento = mapeadas.filter((m) => !niValido(m)).map((m) => m.nome || "(sem nome)");

  if (!partes.length) {
    return {
      ok: false,
      motivo: semDocumento.length
        ? `Nenhuma parte marcada tem CPF/CNPJ válido para o INFOJUD (${semDocumento.join(", ")}).`
        : "Nenhuma parte marcada para o INFOJUD.",
    };
  }
  if (semDocumento.length) {
    console.warn("CRATOS/INFOJUD: fora da fila por falta de CPF/CNPJ:", semDocumento.join(", "));
  }

  /* ⚠️ ERA AQUI O BUG (achado em 21/08, com o Rodrigo): esta linha chamava
     `abrirEcacERegistrar(partes, cfg, processo)` — TRÊS argumentos posicionais —
     contra uma função que recebe UM objeto `{partes, config}`. O `plano` virava
     o array, `plano.partes` virava `undefined`, e a fila ia para o storage vazia.
     O content script chegava em `solicitacao.asp`, lia a fila, achava nada e
     saía calado ("fila recebida? não/vazia" no console dele).
     Duas portas, dois contratos: o painel manda `{plano}` pela mensagem
     `abrirEcacERegistrar` (certo desde sempre) e o ORQUESTRADOR chamava direto,
     posicional. Como hoje o painel roda tudo pelo orquestrador, o INFOJUD estava
     quebrado por essa fresta. */
  return abrirEcacERegistrar({ partes, config: cfg, processo });
}

/*
 * Fecha a aba do SAB de quem enviou a mensagem (o content script do SAB), após a
 * auto-conclusão. Usa sender.tab.id — fecha exatamente a aba certa.
 */
async function fecharAbaSab(sender) {
  const tabId = sender && sender.tab && sender.tab.id;
  if (tabId == null) return { ok: false, erro: "sem tabId" };
  try {
    await browser.tabs.remove(tabId);
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: String(e.message || e) };
  }
}

async function gerarCertidaoSab(msg) {
  const { numProcesso, nomeAbrev, dataFormatada } = msg;
  const operacao = msg.operacao || "inclusao";
  const ehBaixa = operacao === "baixa";
  const pasta = "CRATOS";
  const proc = String(numProcesso || "").replace(/\D/g, "");
  const nome = String(nomeAbrev || "").replace(/[\/\\:*?"<>|]/g, "").trim();
  const sufixo = ehBaixa ? "SAB Baixa" : "SAB Inclusão";
  const filename = `${pasta}/${proc}_${nome} ${sufixo}.pdf`;

  const hoje = dataFormatada || (() => {
    const d = new Date();
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}/${d.getFullYear()}`;
  })();

  const agora = (() => {
    const d = new Date();
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${dd}/${mm}/${d.getFullYear()} ${hh}:${mi}`;
  })();

  const titulo = ehBaixa ? "CERTIDÃO DE BAIXA NO SAB" : "CERTIDÃO DE INCLUSÃO NO SAB";
  /* A atualização é fato da INCLUSÃO (é lá que o valor entra na ordem). */
  const atz = (!ehBaixa && msg.atualizacao && msg.atualizacao.ok) ? msg.atualizacao : null;

  /* Cada item de `linhas` é uma linha LÓGICA (um parágrafo, uma linha em branco).
     gerarPDFTexto mede a largura real e quebra onde couber — não quebre aqui:
     cortar por contagem de caractere e deixar o gerador reparticionar o excedente
     deixa palavra órfã sozinha no meio do texto. */

  const linhas = ehBaixa ? [
    "",
    `Certifico e dou fé que, nesta data (${hoje}), procedi à interrupção da ` +
      `determinação de bloqueio deste processo no SAB - Busca e Bloqueio de Ativos ` +
      `Financeiros, cessando as reiterações automáticas e liberando eventuais valores ` +
      `bloqueados sem desdobramentos.`,
    "",
    "Era o que me cumpria certificar.",
    /* STI, 21/08: sem "Emitido pelo sistema CRATOS" enquanto não homologar. */
  ] : [
    "",
    `Certifico e dou fé que, nesta data (${hoje}), procedi à inclusão deste ` +
      `processo no SAB - Busca e Bloqueio de Ativos Financeiros e que as consultas serão ` +
      `reiteradas, independentemente de manifestação da parte, até a garantia integral do ` +
      `juízo ou até determinação superior em contrário.`,
    "",
    `Certifico, outrossim, que, por medida de economia e celeridade processual, ` +
      `somente as pesquisas com resultado positivo serão publicadas.`,
    "",
    /* Só entra se o valor que foi para a ordem É o atualizado — o content script
       confere isso antes de mandar. Documento que afirma atualização sem ela é
       pior que documento sem a linha. */
    ...(atz ? [
      `Certifico, ainda, que o valor da obrigação foi atualizado até ${atz.dataFinalBR}, ` +
        `a partir do cálculo de liquidação de ${atz.dataInicialBR} ` +
        `(${atz.originalFormatado}), pelo fator de atualização fornecido pelo próprio ` +
        `PJe (${String(atz.fator).replace(".", ",")}), resultando em ${atz.formatado}.`,
      "",
    ] : []),
    "Era o que me cumpria certificar.",
    /* STI, 21/08: sem "Emitido pelo sistema CRATOS" enquanto não homologar. */
  ];

  // Fabrica e baixa o PDF pelo mesmo caminho das certidões do INFOJUD.
  try {
    const bytes = gerarPDFTexto(linhas, titulo);
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    baixarERegistrar(url, filename, {
      numProcesso: msg.numProcesso, convenio: "SAB", operacao: msg.operacao || "inclusao",
    }, _bytesParaBase64(bytes));
    return { ok: true, filename, presumido: true };
  } catch (e) {
    console.error("CRATOS/SAB: falha ao gerar certidão:", e.message);
    return { ok: false, erro: String(e.message || e) };
  }
}

/*
 * PASSO 1 da coleta — acha a solicitação INFOJUD do processo, COM TRAVA.
 * Estratégia de autenticação:
 *   1) tenta fetch direto (background) com credentials — rápido se a Receita aceitar;
 *   2) se falhar (403 cross-origin), lê via content script SAME-ORIGIN numa aba
 *      da Receita já aberta; se não houver aba, avisa o usuário.
 * Não baixa nada. Só identifica e reporta.
 */
async function coletarAchar(numeroProcesso) {
  const alvo = String(numeroProcesso || "").replace(/\D/g, "");
  if (alvo.length < 15) return { ok: false, motivo: "numero_processo_invalido" };

  // A API do www3.cav exige JWT no header (cookie não basta): o fetch do background
  // sempre dá 403. Vamos direto ao content script same-origin, que lê o tokenJWT do
  // sessionStorage da caixa postal e faz a chamada autenticada.
  let mensagens = null;
  const viaAba = await lerCaixaPostalViaAba(0, 50);
  if (!viaAba.ok) {
    /* NÃO achatar tudo em "sem_sessao_receita": a versão anterior fazia isso e
       mandava o usuário conferir uma sessão que estava viva, quando o problema
       era a aba fria demorando a carregar. */
    return {
      ok: false,
      motivo: viaAba.motivo || "sem_sessao_receita",
      detalhe: viaAba.erro,
      abaAberta: !!viaAba.abaAberta,
    };
  }
  mensagens = (viaAba.json.mensagens || []).map((m) => ApiCaixaPostal._normalizar(m));

  const casadas = mensagens.filter((m) => m.ehInfojud && m.numProcesso === alvo);
  if (!casadas.length) return { ok: false, motivo: "nao_encontrada", numeroProcesso };

  const mapear = (m) => ({
    isn: m.isn, numSolicitacao: m.numSolicitacao, numProcesso: m.numProcesso,
    dataEnvio: m.dataEnvio, lida: m.lida, assunto: m.assunto,
  });
  const solicitacoes = casadas.map(mapear);
  return {
    ok: true,
    numeroProcesso,
    solicitacao: solicitacoes[0],   // compat: a primeira
    solicitacoes,                   // todas as casadas
    totalCasadas: casadas.length,
    naoLidas: casadas.filter((m) => !m.lida).length,
  };
}

/*
 * COLETA AUTOMÁTICA (v0.2.32) — fila via API + navegação direta.
 * Monta a fila (INFOJUD + processo casado, tudo via API), navega a aba direto para
 * resultadoSolicitacao.asp?numeroSolicitacao={n} da 1ª e deixa a máquina de estado
 * do content script colher e avançar. Faz polling até o fim. Não raspa a lista da
 * caixa postal (a versão nova não expõe a tabela do InfoJOB).
 *
 * A TRAVA anti-vazamento é o CASAMENTO do número do processo (em coletarAchar),
 * não o status de leitura. Até a 1.4.0 a fila era montada só com as NÃO lidas — e
 * aí, depois que a mensagem daquele processo era lida (aberta, ou já colhida uma
 * vez), a fila saía vazia e não dava para rebaixar. Agora baixa TODAS as casadas,
 * lidas ou não; o resultado no eCAC fica de pé por meses. (Campo, 16/09.)
 */
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const URL_RESULTADO_BG =
  "https://cav.receita.fazenda.gov.br/servicos/ATSDR/decjuiz/resultadoSolicitacao.asp?numeroSolicitacao=";

/* Monta a fila de download a partir das solicitações casadas com o processo:
   número (só dígitos, >= 10), TODAS elas — lidas ou não — com dedupe. Extraída
   para ser exercitada isolada: até a 1.4.0 a fila era montada só com as NÃO
   lidas, e uma mensagem já lida (aberta ou colhida uma vez) deixava a fila vazia,
   impedindo rebaixar o processo. */
function filaDeSolicitacoes(solicitacoes) {
  const vistos = new Set();
  return (solicitacoes || [])
    .map((s) => String((s && s.numSolicitacao) || "").replace(/\D/g, ""))
    .filter((n) => n.length >= 10)
    .filter((n) => (vistos.has(n) ? false : (vistos.add(n), true)));
}
/* Gancho de teste (jsdom): exercitar a montagem da fila sem simular o motor. */
try { globalThis.__cratosColeta = { filaDeSolicitacoes }; } catch (e) {}

async function coletarTudo(numeroProcesso, pasta, soEfin) {
  const alvo = String(numeroProcesso || "").replace(/\D/g, "");
  if (alvo.length < 15) return { ok: false, motivo: "numero_processo_invalido" };

  // 1) monta a fila via API (reusa a leitura via aba da caixa postal, com a trava)
  const achar = await coletarAchar(numeroProcesso);
  if (!achar.ok) return { ok: false, motivo: achar.motivo || "nao_encontrada", detalhe: achar.detalhe };

  /* TODAS as solicitações casadas com o processo, lidas ou não (a trava é o
     casamento do processo, feito em coletarAchar; leitura não filtra mais nada). */
  const fila = filaDeSolicitacoes(achar.solicitacoes);
  console.log("CRATOS/coleta: fila (todas as casadas):", fila.length, "->", fila.join(", "),
    "| total casadas:", achar.totalCasadas, "| não lidas:", achar.naoLidas);

  if (!fila.length) {
    return {
      ok: true, filaVazia: true,
      total: 0, colhidos: 0, falhas: [], pendentes: [], mensagens: 0,
      totalCasadas: achar.totalCasadas || 0,
    };
  }

  // 2) semeia o estado dirigido por fila
  await Store.set("coleta_estado", {
    ativo: true, numProcesso: alvo, pasta: pasta || "CRATOS",
    fila, idx: 0, soEfin: !!soEfin,   // botão "Baixar só o e-Financeira": colhe só esse tipo
    total: 0, colhidos: 0, falhas: [], pendentes: [],
  });

  // 3) navega a aba direto para o 1º resultado (a URL abre por GET, sessão por cookie)
  const url0 = URL_RESULTADO_BG + fila[0];
  const abasDecjuiz = await browser.tabs.query({ url: "*://cav.receita.fazenda.gov.br/*" });
  let abaResultado = null;
  if (abasDecjuiz.length) {
    abaResultado = abasDecjuiz[0].id;
    await browser.tabs.update(abaResultado, { url: url0, active: true });
  } else {
    const nova = await browser.tabs.create({ url: url0, active: true });
    abaResultado = nova.id;
  }

  // 4) polling do estado até o fim (ou timeout)
  const t0 = Date.now();
  const TIMEOUT_MS = 4 * 60 * 1000;
  while (Date.now() - t0 < TIMEOUT_MS) {
    await sleep(1500);
    let est = null;
    try { est = await Store.get("coleta_estado"); } catch (e) {}
    if (!est) break;
    if (!est.ativo) {
      /* Terminou de baixar os documentos → fecha a aba do eCAC/caixa postal. Os
         downloads passam por browser.downloads (background), não dependem da aba
         viva, então fechar aqui é seguro. Só no fim LIMPO; no timeout a aba fica
         aberta para o usuário ver o que travou (mesma regra da aba de registro). */
      if (abaResultado != null) { try { await browser.tabs.remove(abaResultado); } catch (e) {} }
      return {
        ok: true, total: est.total, colhidos: est.colhidos,
        falhas: est.falhas || [], pendentes: est.pendentes || [],
        mensagens: est.fila ? est.fila.length : 0,
      };
    }
  }
  const est = (await Store.get("coleta_estado")) || {};
  return {
    ok: true, timeout: true,
    total: est.total || 0, colhidos: est.colhidos || 0,
    falhas: est.falhas || [], pendentes: est.pendentes || [],
    mensagens: (est.fila && est.idx) || 0,
  };
}

/* PASSO 2 (teste) — manda a aba que está na tela de resultado (resultadoSolicitacao)
   colher os PDFs. Procura entre as abas da Receita a que responde na tela certa. */
async function coletarColher(contexto) {
  const abas = await browser.tabs.query({ url: "*://*.receita.fazenda.gov.br/*" });
  if (!abas.length) return { ok: false, erro: "nenhuma aba da Receita aberta" };
  for (const aba of abas) {
    try {
      const r = await browser.tabs.sendMessage(aba.id, { tipo: "cp_colher_itens", contexto: contexto || {} });
      if (r && r.ok) return r;
      if (r && r.erro && !/nenhum item/.test(r.erro)) return r;
    } catch (e) { /* aba sem content script ou fora da tela; tenta próxima */ }
  }
  return { ok: false, erro: "nenhuma aba na tela de resultado respondeu" };
}

/* Lê a caixa postal via content script SAME-ORIGIN no host www3.cav (onde o
   tokenJWT vive no sessionStorage). Procura uma aba já aberta na caixa postal;
   se não houver, abre uma e espera carregar. */
const CAIXA_POSTAL_APP = "https://www3.cav.receita.fazenda.gov.br/caixapostal/";

async function lerCaixaPostalViaAba(pagina, tamanho, opts) {
  /* ═══════════════════════════════════════════════════════════════════════════
   * ⚠ REESCRITO EM 02/09, DEPOIS DE FALHAR EM PRODUÇÃO NA PRIMEIRA COLHEITA
   * AUTOMÁTICA. A versão anterior:
   *   · esperava 15s por um PING do content script e seguia mesmo sem resposta;
   *   · se ninguém respondia, devolvia "nenhuma aba respondeu", que o painel
   *     traduzia como **sem_sessao_receita** — mandando o usuário conferir uma
   *     sessão que podia estar perfeitamente viva.
   * Ou seja: o sintoma (aba lenta) saía com o nome de outra doença (sessão).
   * Quando o usuário clicava o botão à mão, a aba já estava aberta e quente, e
   * por isso funcionava — a colheita automática é o primeiro caso em que a aba
   * nasce FRIA. **Aba fria é o caso normal aqui, não a exceção.**
   *
   * Agora: espera pelo TOKEN (que é o que a leitura precisa), não por um ping;
   * dá tempo de verdade; e, se demorar, TORNA A ABA VISÍVEL — porque a razão
   * mais comum de o token não aparecer é o app estar pedindo login, e login o
   * usuário tem de ver. A aba não é fechada quando falha: ela é a saída.
   */
  const o = opts || {};
  const limite = o.esperaMs || 60000;
  const ALVO_ABAS = "*://www3.cav.receita.fazenda.gov.br/caixapostal/*";

  let abas = await browser.tabs.query({ url: ALVO_ABAS });
  let abaAberta = null;
  if (!abas.length) {
    abaAberta = await browser.tabs.create({ url: CAIXA_POSTAL_APP, active: !!o.visivel });
  }

  const t0 = Date.now();
  let ativou = !!o.visivel;
  let ultimo = "carregando";

  while (Date.now() - t0 < limite) {
    /* Relê a lista a cada volta: a aba recém-criada pode ainda estar navegando
       (about:blank -> login -> app) e só entra no filtro depois. */
    let lista = [];
    try { lista = await browser.tabs.query({ url: ALVO_ABAS }); } catch (e) {}
    if (abaAberta && !lista.some((t) => t.id === abaAberta.id)) lista.push(abaAberta);

    for (const aba of lista) {
      let resp = null;
      try {
        resp = await browser.tabs.sendMessage(aba.id, { tipo: "cp_fetch_mensagens", pagina, tamanho });
      } catch (e) { ultimo = "carregando"; continue; }
      if (resp && resp.ok) {
        /* Só fecha o que ELA abriu, e só quando deu certo. Aba do usuário não
           se fecha nunca. */
        if (abaAberta) { try { await browser.tabs.remove(abaAberta.id); } catch (e) {} }
        return resp;
      }
      if (resp && resp.erro === "sem_token") ultimo = "sem_token";
      else if (resp && resp.erro) ultimo = String(resp.erro);
    }

    /* Passados 20s sem token, a hipótese mais provável é login. Traz a aba para
       a frente: se o gov.br estiver pedindo autenticação, só o usuário resolve,
       e ele precisa VER a tela. */
    if (!ativou && abaAberta && Date.now() - t0 > 20000) {
      ativou = true;
      try { await browser.tabs.update(abaAberta.id, { active: true }); } catch (e) {}
    }
    await new Promise((r) => setTimeout(r, 1500));
  }

  return {
    ok: false,
    erro: ultimo === "sem_token"
      ? "a caixa postal abriu, mas não liberou a credencial de sessão (provável login pendente)"
      : "a caixa postal não terminou de carregar a tempo",
    motivo: ultimo === "sem_token" ? "caixa_sem_token" : "caixa_nao_carregou",
    abaId: abaAberta ? abaAberta.id : null,
    abaAberta: !!abaAberta,
  };
}

/* Espera o content script de uma aba responder a um ping simples (com timeout). */
async function esperarConteudoPronto(tabId, timeoutMs) {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    await new Promise((r) => setTimeout(r, 800));
    try {
      const pong = await browser.tabs.sendMessage(tabId, { tipo: "cp_ping" });
      if (pong && pong.ok) return true;
    } catch (e) { /* ainda não pronto */ }
  }
  return false;
}

/* Limpa estado de execução pendente ao instalar/atualizar (mesma higiene da maisPJe). */
browser.runtime.onInstalled.addListener(async () => {
  await Store.remove(CHAVES.execucao);
});

/*
 * ====== PASSO 2B da coleta — download dos PDFs (INFOJUD) ======
 *
 * A URL do PDF do eCAC (solicitadorPDFMidas.asp) é USO-ÚNICO: cancelar e rebaixar
 * falha (testado). Então o content script (same-origin, autenticado) faz o fetch do
 * PDF UMA vez, converte em base64, e envia ao background, que baixa via blob com o
 * nome certo CRATOS/{proc}_{nome} {tipo} {ano}.pdf. Um único consumo da URL.
 */
let _contextoColeta = null;   // { numProcesso, nomeAbrev, pasta }

// Recebe o PDF (base64) do content script e baixa com nome no padrão CRATOS/.
browser.runtime.onMessage.addListener((msg) => {
  if (msg && msg.tipo === "baixar_pdf_base64") {
    return (async () => {
      try {
        const ext = (msg.ext || "pdf").replace(/[^a-z0-9]/gi, "").toLowerCase() || "pdf";
        const mime = ext === "zip" ? "application/zip" : "application/pdf";
        const bytes = _b64ToBytes(msg.base64);
        const blob = new Blob([bytes], { type: mime });
        const url = URL.createObjectURL(blob);
        const filename = montarNomePdf(
          (_contextoColeta && _contextoColeta.pasta) || msg.pasta || "CRATOS",
          (_contextoColeta && _contextoColeta.numProcesso) || msg.numProcesso || msg.ni,
          (_contextoColeta && _contextoColeta.nomeAbrev) || msg.nomeAbrev,
          msg.tipoLabel || "DOC",
          ext,
          msg.ni
        );

        // PRESUNÇÃO DE SUCESSO: no Firefox, downloads.download com blob URL do
        // background baixa o arquivo corretamente mas REJEITA a Promise (falso erro).
        // Confirmado em teste real: arquivo cai na subpasta, nome certo, sem abrir aba.
        // Então disparamos e presumimos sucesso — não travamos no retorno mentiroso.
        baixarERegistrar(url, filename, {
          numProcesso: (_contextoColeta && _contextoColeta.numProcesso) || msg.numProcesso,
          convenio: "INFOJUD", detalhe: msg.tipoLabel || null,
        }, msg.base64 || null);
        return { ok: true, filename, presumido: true };
      } catch (e) {
        // só falha real: erro ao montar bytes/blob/nome (não o download em si)
        return { ok: false, erro: String(e.message || e) };
      }
    })();
  }
  /* eFinanceira: recebe o ZIP inteiro (base64) e descompacta AQUI, no background.
     A abertura do zip usa DecompressionStream, que no content script do Firefox
     (sandbox/Xray) recusa o buffer ("Value could not be converted to ArrayBufferView")
     — bug de campo da 1.5.0. O background é página de extensão normal, sem essa
     membrana. Tira o(s) PDF(s), renomeia e baixa cada um. Zip sem PDF => vazioEfin
     (assíncrono ainda não pronto): o content script emite a certidão de estado. */
  if (msg && msg.tipo === "efin_zip") {
    return (async () => {
      try {
        const bytes = _b64ToBytes(msg.base64);
        let entradas;
        try {
          entradas = await CratosUnzip.entries(bytes);
        } catch (e) {
          return { ok: false, erro: "falha ao abrir o zip do eFinanceira: " + String(e.message || e) };
        }
        const itens = CratosUnzip.rotularEfinPdfs(entradas, msg.exercicio);
        if (!itens.length) return { ok: true, vazioEfin: true };   // zip sem PDF: ainda não consolidado
        const ni = msg.ni;
        const arquivos = [];
        for (const it of itens) {
          const blob = new Blob([it.bytes], { type: "application/pdf" });
          const url = URL.createObjectURL(blob);
          const filename = montarNomePdf(
            (_contextoColeta && _contextoColeta.pasta) || "CRATOS",
            (_contextoColeta && _contextoColeta.numProcesso) || ni,
            (_contextoColeta && _contextoColeta.nomeAbrev) || "",
            it.label, "pdf", ni
          );
          baixarERegistrar(url, filename, {
            numProcesso: (_contextoColeta && _contextoColeta.numProcesso) || null,
            convenio: "INFOJUD", detalhe: it.label,
          }, _bytesParaBase64(it.bytes));
          arquivos.push(filename);
        }
        return { ok: true, arquivos };
      } catch (e) {
        return { ok: false, erro: String(e.message || e) };
      }
    })();
  }
  if (msg && msg.tipo === "armar_contexto") {
    _contextoColeta = {
      numProcesso: msg.numProcesso || "",
      nomeAbrev: msg.nomeAbrev || "",
      pasta: msg.pasta || "CRATOS",
    };
    return Promise.resolve({ ok: true });
  }
  if (msg && msg.tipo === "encerrar_contexto") {
    _contextoColeta = null;
    return Promise.resolve({ ok: true });
  }
});

function _b64ToBytes(b64) {
  const bin = atob(b64);
  const len = bin.length;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Monta o nome do arquivo no padrão combinado: {pasta}/{processo}_{nome} {tipo}.{ext}
function montarNomePdf(pasta, numProcesso, nomeAbrev, tipoLabel, ext, ni) {
  const limpar = (s) => String(s || "").replace(/[\/\\:*?"<>|]/g, "").trim();
  const proc = String(numProcesso || "").replace(/\D/g, "");
  const nome = limpar(nomeAbrev);
  const tipo = limpar(tipoLabel);
  const base = limpar(pasta) || "CRATOS";
  const e = String(ext || "pdf").replace(/[^a-z0-9]/gi, "").toLowerCase() || "pdf";
  /* O DOCUMENTO depois do nome (decisão do Rodrigo, 04/09): duas executadas
     homônimas (ex.: matriz e filial, mesmo nome, CNPJ diferentes) geravam o MESMO
     nome de arquivo por tipo (DITR, DOI…) → o Cofre sobrescrevia um pelo outro e a
     juntada perdia o conjunto da 2ª. Com o NI, cada uma é única. */
  const doc = String(ni || "").replace(/\D/g, "");
  const idParte = doc ? `_${doc}` : "";
  return `${base}/${proc}_${nome}${idParte} ${tipo}.${e}`.replace(/\s+/g, " ");
}

/*
 * Fabricação de PDF-texto para resultados "não consta" (DITR, Info.Cadastrais, DIPJ).
 * Portado de gerarPDFTexto/sanitizePDF do InfoJOB: monta um PDF 1.4 válido byte a byte,
 * sem biblioteca. O content script manda { titulo, linhas, filename }; baixamos via
 * blob URL com o nome no padrão CRATOS/.
 */
browser.runtime.onMessage.addListener((msg) => {
  if (msg && msg.tipo === "fabricar_pdf") {
    try {
      const bytes = gerarPDFTexto(msg.linhas || [], msg.titulo || "CRATOS");
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      // mesma presunção de sucesso do baixar_pdf_base64 (blob URL rejeita a Promise no FF)
      baixarERegistrar(url, msg.filename, {
        numProcesso: msg.numProcesso, convenio: msg.convenio || "?",
        operacao: msg.operacao || null, detalhe: msg.detalhe || null,
      }, _bytesParaBase64(bytes));
      return Promise.resolve({ ok: true, filename: msg.filename, presumido: true });
    } catch (e) {
      return Promise.resolve({ ok: false, erro: String(e.message || e) });
    }
  }
});

/* ═══ MÉTRICAS DO HELVETICA (WinAnsiEncoding), códigos 32..255 ═══
 * Larguras em 1/1000 do corpo, direto do AFM das fontes base-14 do PDF.
 * Servem para uma coisa só: saber onde quebrar a linha. Antes quebrávamos por
 * CONTAGEM DE CARACTERES, o que é um chute — 90 caracteres podem dar 400pt de
 * "iii..." ou 700pt de "WWW...". Resultado: a margem direita ora sobrava, ora
 * não existia (o texto encostava na borda da folha).
 * Acentuadas latinas têm a mesma largura da letra-base nessas fontes, então a
 * medida vale para "execução" tanto quanto para "execucao".
 */
const _W_HELV = ("278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556," +
  "556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556," +
  "833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556," +
  "556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260," +
  "334,584,350,556,350,222,556,333,1000,556,556,333,1000,667,333,1000,350,611,350,350,222,222,333," +
  "333,350,556,1000,333,1000,500,333,944,350,500,667,278,333,556,556,556,556,260,556,333,737,370," +
  "556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667," +
  "667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722," +
  "722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556," +
  "556,556,556,556,584,611,556,556,556,556,500,556,500").split(",").map(Number);

const _W_HELV_BOLD = ("278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556," +
  "556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722," +
  "611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556," +
  "611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389," +
  "280,389,584,350,556,350,278,556,500,1000,556,556,333,1000,667,333,1000,350,611,350,350,278,278," +
  "500,500,350,556,1000,333,1000,556,333,944,350,500,667,278,333,556,556,556,556,280,556,333,737," +
  "370,556,584,333,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722," +
  "722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722," +
  "722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611," +
  "611,611,611,611,611,584,611,611,611,611,611,556,611,556").split(",").map(Number);

/* Largura do texto em pontos. Mede o texto CRU, não o escapado por sanitizePDF:
   a barra invertida de "\(" é sintaxe do arquivo, não desenha glifo nenhum. */
function larguraPDF(texto, tamanho, negrito) {
  const tab = negrito ? _W_HELV_BOLD : _W_HELV;
  let soma = 0;
  const s = String(texto == null ? "" : texto);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    soma += (c >= 32 && c <= 255) ? tab[c - 32] : 0;
  }
  return (soma * tamanho) / 1000;
}

/* Quebra UMA linha lógica no que couber em `largura`. Preserva a indentação da
   linha original nas continuações — as linhas de cartório da certidão do CENSEC
   entram indentadas e devem continuar assim. Palavra maior que a linha inteira
   (um nome de cartório sem espaços, um hash) é partida no caractere, senão o
   laço nunca terminaria. */
function quebrarPorLargura(texto, largura, tamanho, negrito) {
  const bruto = String(texto == null ? "" : texto).replace(/\r?\n/g, " ");
  if (!bruto.trim()) return [bruto];
  if (larguraPDF(bruto, tamanho, negrito) <= largura) return [bruto];

  const indent = (bruto.match(/^\s*/) || [""])[0];
  const palavras = bruto.trim().split(/\s+/);
  const saida = [];
  let atual = indent;

  const cabe = (s) => larguraPDF(s, tamanho, negrito) <= largura;

  for (let palavra of palavras) {
    // palavra sozinha maior que a linha: parte no caractere
    while (!cabe(indent + palavra)) {
      let corte = 1;
      while (corte < palavra.length && cabe(indent + palavra.slice(0, corte + 1))) corte++;
      if (atual.trim()) { saida.push(atual); atual = indent; }
      saida.push(indent + palavra.slice(0, corte));
      palavra = palavra.slice(corte);
      if (!palavra) break;
    }
    if (!palavra) continue;

    const tentativa = atual.trim() ? atual + " " + palavra : indent + palavra;
    if (cabe(tentativa)) {
      atual = tentativa;
    } else {
      saida.push(atual);
      atual = indent + palavra;
    }
  }
  if (atual.trim()) saida.push(atual);
  return saida.length ? saida : [bruto];
}

/*
 * PDF de texto, MÚLTIPLAS PÁGINAS, com MARGEM DOS DOIS LADOS.
 *
 * Histórico das duas correções que moram aqui:
 *  1. era de uma página só e cortava em silêncio (`if (y < 50) break`);
 *  2. quebrava linha por contagem de caracteres, então o texto encostava na
 *     borda direita da folha (margem esquerda de 50pt, margem direita de zero).
 * Agora a quebra é por LARGURA REAL e a caixa de texto é simétrica.
 * ASSINATURA INALTERADA: gerarPDFTexto(arrayDeLinhas, tituloString).
 */
function gerarPDFTexto(linhas, titulo) {
  const LARGURA_PAG = 595, ALTURA_PAG = 842;      // A4 em pontos
  const marginX = 50, lineH = 20;
  const LARGURA_UTIL = LARGURA_PAG - 2 * marginX;  // 495pt — a mesma sobra dos dois lados
  const CORPO_PT = 12, TITULO_PT = 16, TITULO_PT_MIN = 10;
  const Y_TITULO = 780, Y_CORPO = 750, Y_MIN = 50;
  const porPagina = Math.floor((Y_CORPO - Y_MIN) / lineH) + 1;

  const entrada = Array.isArray(linhas) ? linhas : [String(linhas == null ? "" : linhas)];

  // Reflui TUDO na largura útil antes de paginar (uma linha lógica pode virar várias).
  const todas = [];
  for (const l of entrada) todas.push(...quebrarPorLargura(l, LARGURA_UTIL, CORPO_PT, false));
  if (!todas.length) todas.push("");

  /* Título: em vez de quebrar em duas (o que empurraria o corpo e bagunçaria a
     paginação), diminuímos o corpo até caber. Título de certidão é curto; isso
     só age no caso extremo, e nunca deixa passar da margem. */
  const tituloBase = String(titulo == null ? "" : titulo);
  let tituloPt = TITULO_PT;
  const maiorTitulo = tituloBase + (todas.length > porPagina ? " (cont.)" : "");
  while (tituloPt > TITULO_PT_MIN && larguraPDF(maiorTitulo, tituloPt, true) > LARGURA_UTIL) tituloPt--;

  const paginas = [];
  for (let i = 0; i < todas.length; i += porPagina) paginas.push(todas.slice(i, i + porPagina));

  // Um content stream por página. Título repetido, com "(cont.)" da 2ª em diante.
  const streams = paginas.map((linhasDaPagina, idx) => {
    const tit = idx === 0 ? tituloBase : tituloBase + " (cont.)";
    let y = Y_TITULO;
    let st = "BT\n/F2 " + tituloPt + " Tf\n1 0 0 1 " + marginX + " " + y + " Tm\n(" +
      sanitizePDF(tit) + ") Tj\n";
    y = Y_CORPO;
    st += "/F1 " + CORPO_PT + " Tf\n";
    for (const linha of linhasDaPagina) {
      st += "1 0 0 1 " + marginX + " " + y + " Tm\n(" + sanitizePDF(linha) + ") Tj\n";
      y -= lineH;
    }
    st += "ET\n";
    return st;
  });

  /* Numeração dos objetos:
     1 = Catalog, 2 = Pages, depois por página (Page, Contents) em pares,
     e por fim as duas fontes. */
  const n = paginas.length;
  const idPagina = (i) => 3 + i * 2;
  const idConteudo = (i) => 4 + i * 2;
  const idF1 = 3 + n * 2;
  const idF2 = idF1 + 1;
  const total = idF2;

  const partes = [];
  partes.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  const kids = paginas.map((_, i) => idPagina(i) + " 0 R").join(" ");
  partes.push("2 0 obj\n<< /Type /Pages /Kids [" + kids + "] /Count " + n + " >>\nendobj\n");
  for (let i = 0; i < n; i++) {
    partes.push(idPagina(i) + " 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] " +
      "/Contents " + idConteudo(i) + " 0 R /Resources << /Font << /F1 " + idF1 + " 0 R /F2 " +
      idF2 + " 0 R >> >> >>\nendobj\n");
    // Latin-1: 1 byte por caractere -> comprimento em chars == bytes.
    partes.push(idConteudo(i) + " 0 obj\n<< /Length " + streams[i].length + " >>\nstream\n" +
      streams[i] + "\nendstream\nendobj\n");
  }
  partes.push(idF1 + " 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica " +
    "/Encoding /WinAnsiEncoding >>\nendobj\n");
  partes.push(idF2 + " 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold " +
    "/Encoding /WinAnsiEncoding >>\nendobj\n");

  const header = "%PDF-1.4\n";
  let pos = header.length;
  const offsets = [];
  const buf = [latin1Bytes(header)];
  for (const parte of partes) {
    offsets.push(pos);
    const b = latin1Bytes(parte);
    buf.push(b);
    pos += b.length;
  }

  const xrefPos = pos;
  const xref = "xref\n0 " + (total + 1) + "\n0000000000 65535 f \n" +
    offsets.map((o) => String(o).padStart(10, "0") + " 00000 n ").join("\n") +
    "\ntrailer\n<< /Size " + (total + 1) + " /Root 1 0 R >>\nstartxref\n" + xrefPos + "\n%%EOF\n";
  buf.push(latin1Bytes(xref));

  const tam = buf.reduce((s, b) => s + b.length, 0);
  const out = new Uint8Array(tam);
  let off = 0;
  for (const b of buf) { out.set(b, off); off += b.length; }
  return out;
}

function sanitizePDF(str) {
  return (str || "")
    .replace(/\r?\n/g, " ")               // sem quebras dentro de uma linha
    .replace(/[()\\]/g, "\\$&")           // escapa ( ) \ (sintaxe de string do PDF)
    .split("")
    .filter((c) => { const n = c.charCodeAt(0); return n >= 0x20 && n <= 0xFF; }) // imprimíveis Latin-1 (mantém acentos)
    .join("")
    .substring(0, 300);
}

/* Converte string para bytes Latin-1 (1 byte por char) — é o encoding que o
   WinAnsiEncoding do PDF espera para acentos. TextEncoder (UTF-8) quebraria os
   acentos em 2 bytes e desalinharia o /Length do stream. */
function latin1Bytes(str) {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xFF;
  return out;
}
