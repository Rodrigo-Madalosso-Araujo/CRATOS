/*
 * conteudo/ccs.js — content script do CCS (www3.bcb.gov.br/ccs/*).
 *
 * ═══ COMO ANDA ═══
 * O CCS é Struts server-side: cada clique é uma página nova, e este script nasce de
 * novo em cada uma. Então NADA de posição em memória: a cada carga ele lê o código da
 * tela (`[CCSFWxxxx]`, no canto) e o estado `cratos:ccs_estado`, e faz o passo
 * daquela tela. A máquina de estados mora no storage, como no resto do CRATOS.
 *
 *   DIA 1 (modo "requisicao")
 *     1201 inicial      → vai para a 0501
 *     0501 formulário   → cpfCnpj (um por linha) + nº do processo + motivo → Continuar
 *     0502 termo        → aceite automático só se a Preferência mandar; senão PARA
 *     0801 resultado    → guarda o nº da requisição; exibição dos inativos; → Solicitar
 *     0601 seleção      → marca pelo critério, conferindo pelo SUFIXO; envio automático
 *                         só com a marcação LIMPA; senão PARA para o seu clique
 *     0602 confirmação  → CERTIDÃO DE ENVIO + registro da requisição (para a coleta)
 *
 *   COLETA (modo "coleta", botão do painel)
 *     0801 da requisição (direto pelo nº guardado; plano B: 1301/1302 em janelas de
 *     30 dias) → status por instituição → resposta nova? "Gerar Arquivo PDF" → 0802
 *     espera arquivo com data de geração POSTERIOR ao clique → baixa (decide pelos
 *     bytes %PDF) → certidão do ESTADO ATUAL (quem respondeu, quem falta).
 *
 * ═══ REGRAS QUE NÃO SE DOBRAM ═══
 *  - O SUFIXO dos campos da 0601 (chbRelSelecionado<CPF/CNPJ+ISPB+ddmmaaaa>) contém o
 *    CPF: NUNCA vai para log, faixa ou storage.
 *  - Marcação pelo CRITÉRIO, nunca pela visibilidade da linha — e nunca pelo
 *    `selecionarTodos()` da página, que marca até linha escondida.
 *  - Pendência é certidão de ESTADO; falha técnica (arquivo que não veio, que não é
 *    PDF, geração que não terminou) é faixa, NUNCA certidão.
 *  - HTML dinâmico só por CratosHTML.definir(el, html``) — regra da 1.5.5.
 *
 * Detalhes que só o teste ao vivo confirma ficam PARAMETRIZADOS aqui em cima
 * (formato do documento e do processo; período da 0501 fica em branco).
 */

(function iniciarCcs() {
  if (!/(^|\.)bcb\.gov\.br$/.test(location.hostname) || !/^\/ccs\//i.test(location.pathname)) return;
  console.log("CRATOS/CCS: content script ativo em", location.pathname);

  const html = CratosHTML.html;
  const BASE = location.origin + "/ccs/";
  const URL_CCS = {
    requisitar: BASE + "requisitarConsultaCpfCnpj.do?method=iniciar",
    requisicoes: BASE + "iniciarConsultaRequisicoesRealizadas.do?method=iniciarConsultaRequisicoes",
    requisicao: (n) => BASE +
      "visualizarRequisicaoRealizadaCpfCnpj.do?method=visualizarRequisicaoRealizada&numeroRequisicao=" +
      encodeURIComponent(String(n)),
    arquivos: BASE + "listarArquivosDownload.do?method=listarArquivosDownload",
    baixar: (nome) => BASE + "baixarArquivo.do?method=baixarArquivo&nomeArquivo=" + encodeURIComponent(nome),
  };

  /* ── parâmetros a confirmar no 1º teste ao vivo ─────────────────────────── */
  const FORMATO_DOC = "digitos";        // cpfCnpj: só dígitos, um por linha
  const VALIDADE_MS = 60 * 60 * 1000;   // cada passo renova; espera do termo/envio cabe aqui
  const POLL_ARQUIVO_MS = 8000;          // CCSFW0802: recarrega a cada 8 s…
  const LIMITE_ARQUIVO_MS = 3 * 60 * 1000; // …por até 3 min depois do clique em "Gerar"
  const FOLGA_RELOGIO_MS = 2 * 60 * 1000;  // relógio do BCB × o nosso
  const JANELA_DIAS = 30;                // limite da CCSFW1301 (informado pelo Rodrigo)
  const MAX_JANELAS = 6;                 // ~6 meses para trás no plano B
  const PREFIXO = "chbRelSelecionado";

  /* Pontos de saída para o mundo — trocáveis no teste (jsdom não navega). */
  const io = {
    navegar: (url) => location.assign(url),
    recarregar: () => location.reload(),
    clicar: (el) => el.click(),
    agora: () => Date.now(),
    baixar: (url) => fetch(url, { credentials: "include" }),
    esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
  };

  Store.get("ccs_estado").then(async (est) => {
    if (!(await Store.ligada())) { console.log("CRATOS/CCS: extensão desligada."); return; }
    if (!est || !est.ativo) return;
    const idade = io.agora() - new Date(est.abertoEm || 0).getTime();
    if (idade > VALIDADE_MS) { console.log("CRATOS/CCS: estado antigo — ignorando."); return; }
    await processar(est);
  }).catch((e) => falhar(e));

  /* ═══ DESPACHO POR TELA ═══ */
  async function processar(est) {
    const tela = codigoTela(document);
    if (!tela) {
      if (document.querySelector('input[type="password"]') || /indexEstatico|login|signin/i.test(location.href)) {
        avisar("aguardando seu login no CCS (Banco Central). Assim que você entrar, eu sigo sozinho.");
      } else {
        alertar("não reconheci esta tela do CCS (falta o código [CCSFW…] no canto). Se for o login, " +
          "entre; eu sigo depois.");
      }
      return;
    }
    try {
      if (est.modo === "coleta") return await passoColeta(est, tela);
      return await passoRequisicao(est, tela);
    } catch (e) {
      falhar(e);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
   * DIA 1 — requisição e solicitação de detalhamento
   * ═══════════════════════════════════════════════════════════════════════════ */
  async function passoRequisicao(est, tela) {
    switch (tela) {
      case "0501": return tela0501(est);
      case "0502": return tela0502(est);
      case "0801": return tela0801Requisicao(est);
      case "0601": return tela0601(est);
      case "0602": return tela0602(est);
      default: {
        /* Qualquer outra tela (inicial 1201, depois do login, menu): vai para o
           formulário. Com teto, para não girar se o CCS devolver sempre para cá. */
        const idas = (est.idas || 0) + 1;
        if (idas > 3) throw new Error("o CCS não abriu o formulário de consulta depois de 3 tentativas.");
        await salvar(est, { idas });
        avisar("abrindo a requisição de consulta por CPF/CNPJ…");
        io.navegar(URL_CCS.requisitar);
      }
    }
  }

  async function tela0501(est) {
    if (est.fase === "0501_enviado") {
      throw new Error("o CCS devolveu o formulário de consulta" + motivoDaPagina() +
        ". Confira os dados na tela.");
    }
    const campoDoc = campo("cpfCnpj");
    const campoProc = campo("numeroProcesso");
    const campoMotivo = campo("motivoConsulta");
    if (!campoDoc || !campoProc) {
      throw new Error("o formulário de consulta (CCSFW0501) não tem o campo " +
        (!campoDoc ? "CPF/CNPJ" : "Número do Processo") + " — o CCS pode ter mudado.");
    }
    const docs = (est.docs || []).map((d) => FORMATO_DOC === "digitos" ? d.doc : formatarDoc(d.doc));
    preencher(campoDoc, docs.join("\n"));
    preencher(campoProc, formatoProcesso(campoProc, est.numeroDigitos));
    if (campoMotivo) preencher(campoMotivo, (est.config || {}).motivo || "Execução trabalhista");
    /* Período de Solicitação (dataInicio/dataFim) fica em branco — decisão de 15/10. */
    const btn = botao(/^continuar$/i, campoDoc.form);
    if (!btn) throw new Error("não achei o botão Continuar na CCSFW0501.");
    await salvar(est, { fase: "0501_enviado" });
    avisar(`consulta preenchida (${docs.length} CPF/CNPJ) — enviando…`);
    io.clicar(btn);
  }

  async function tela0502(est) {
    if (est.fase === "0502_enviado") {
      throw new Error("o CCS voltou ao Termo de Uso depois do aceite" + motivoDaPagina() + ".");
    }
    if (!confereProcesso(est)) throw new Error("o número do processo na tela não é o deste processo.");
    const termo = campo("assinaturaTermoResponsabilidade");
    const btn = botao(/requisitar\s+consulta/i);
    if (!termo || !btn) throw new Error("não achei o Termo de Uso ou o botão Requisitar Consulta (CCSFW0502).");
    if ((est.config || {}).aceitarTermo) {
      if (!termo.checked) io.clicar(termo);
      if (!termo.checked) throw new Error("não consegui marcar o aceite do Termo de Uso.");
      await salvar(est, { fase: "0502_enviado", termoAutomatico: true, termoEm: agoraIso() });
      avisar("Termo de Uso aceito por configuração sua — requisitando a consulta…");
      io.clicar(btn);
      return;
    }
    await salvar(est, { fase: "0502_aguardando", termoAutomatico: false });
    alertar("preenchi a consulta. Leia e aceite o Termo de Uso e clique em “Requisitar Consulta” — " +
      "eu sigo depois.");
  }

  async function tela0801Requisicao(est) {
    if (est.fase === "0801_solicitado") {
      throw new Error("cliquei em Solicitar Detalhamentos e o CCS voltou ao resultado" + motivoDaPagina() + ".");
    }
    if (!confereProcesso(est)) throw new Error("o número do processo na tela não é o deste processo.");
    const numeroRequisicao = lerNumeroRequisicao() || est.numeroRequisicao || null;
    aplicarExibicaoInativos(est);
    const btn = botao(/solicitar\s+detalhamentos/i);
    if (!btn) {
      if (!lerStatus0801()) return semRelacionamentos(est, numeroRequisicao);
      throw new Error("não achei o botão “Solicitar Detalhamentos dos CPF/CNPJ Consultados” (CCSFW0801).");
    }
    await salvar(est, { fase: "0801_solicitado", numeroRequisicao, idas: 0 });
    avisar(`requisição${numeroRequisicao ? " nº " + numeroRequisicao : ""} feita — abrindo a solicitação de detalhamento…`);
    io.clicar(btn);
  }

  async function tela0601(est) {
    if (est.fase === "0601_enviado") {
      throw new Error("cliquei em Solicitar Detalhamentos e o CCS voltou à seleção" + motivoDaPagina() + ".");
    }
    aplicarExibicaoInativos(est);
    const linhas = lerLinhas0601(document);
    if (!linhas.length) return semRelacionamentos(est, est.numeroRequisicao);

    const cfg = est.config || {};
    const criterio = cfg.criterio === "sem_data_fim" ? "sem_data_fim" : "todas";
    const quer = (l) => l.detalhavel && (criterio === "todas" || !l.dataFim);
    const pretendidas = linhas.filter(quer);
    const resumo = linhas.map((l) => ({
      instituicao: l.instituicao, dataInicio: l.dataInicio, dataFim: l.dataFim,
      doc: l.doc, detalhavel: l.detalhavel, pedida: quer(l),
    }));
    if (!pretendidas.length) {
      await salvar(est, { linhas: resumo, criterio });
      return semRelacionamentos(est, est.numeroRequisicao,
        criterio === "todas" ? null : "nenhum relacionamento sem Data Fim");
    }

    /* Marca/desmarca LINHA A LINHA pelo sufixo — nunca pelo selecionarTodos(). */
    for (const l of linhas) {
      if (!l.detalhavel) continue;
      if (l.el.checked !== quer(l)) io.clicar(l.el);
    }
    /* Confere de novo, relendo do DOM pelo NOME (o sufixo), não pela referência. */
    let marcadasCertas = 0, marcadasErradas = 0;
    for (const l of linhas) {
      if (!l.detalhavel) continue;
      const atual = document.getElementsByName(PREFIXO + l.sufixo)[0];
      const marcada = !!(atual && atual.checked);
      if (marcada && quer(l)) marcadasCertas++;
      if (marcada && !quer(l)) marcadasErradas++;
    }
    const limpa = marcadasCertas === pretendidas.length && marcadasErradas === 0 && marcadasCertas >= 1;
    const naoDetalhaveis = linhas.filter((l) => !l.detalhavel).length;
    const extra = naoDetalhaveis ? ` (${naoDetalhaveis} sem comunicação com o CCS ficaram de fora)` : "";
    const base = { linhas: resumo, criterio, marcadas: marcadasCertas, pretendidas: pretendidas.length };

    if (!limpa) {
      await salvar(est, Object.assign(base, { fase: "0601_aguardando", envioAutomatico: false, divergente: true }));
      alertar(`a marcação não saiu limpa (pretendidas ${pretendidas.length}, marcadas ${marcadasCertas}` +
        (marcadasErradas ? `, ${marcadasErradas} fora do critério` : "") + "). NÃO enviei. Confira as " +
        "marcações e clique você em “Solicitar Detalhamentos” — a certidão registra o total que o CCS informar.");
      return;
    }
    if (cfg.envioAutomatico) {
      const btn = botao(/^solicitar\s+detalhamentos$/i);
      if (!btn) throw new Error("não achei o botão Solicitar Detalhamentos (CCSFW0601).");
      await salvar(est, Object.assign(base, { fase: "0601_enviado", envioAutomatico: true, envioEm: agoraIso() }));
      avisar(`marquei ${marcadasCertas} relacionamento(s)${extra} — enviando por configuração sua…`);
      io.clicar(btn);
      return;
    }
    await salvar(est, Object.assign(base, { fase: "0601_aguardando", envioAutomatico: false }));
    alertar(`marquei ${marcadasCertas} relacionamento(s) (${criterio === "todas" ? "todos os detalháveis" :
      "só os sem Data Fim"})${extra}. Confira e clique em “Solicitar Detalhamentos” — eu sigo depois.`);
  }

  async function tela0602(est) {
    if (est.certidaoEnvio) return;           // já certificado (recarga da página)
    if (!confereProcesso(est)) throw new Error("o número do processo na tela não é o deste processo.");
    const quadro = lerQuadro0602();
    const numeroRequisicao = quadro.numeroRequisicao || est.numeroRequisicao || null;
    const proc = est.numeroDigitos;

    const arquivo = await fabricarCertidaoEnvio(est, quadro, numeroRequisicao);

    /* Registro para a COLETA ir direto à requisição (a CCSFW1301 só busca 30 dias). */
    if (numeroRequisicao) {
      await atualizarRegistro(proc, numeroRequisicao, (r) => Object.assign(r, {
        em: r.em || agoraIso(),
        docs: (est.docs || []).map((d) => d.doc),
        pedidas: quadro.total != null ? quadro.total : (est.marcadas || null),
        juntadas: r.juntadas || 0,
        encerrada: false,
        ultimaCertidao: hojeChave(),
      }));
    }
    await salvar(est, { ativo: false, fase: "concluido", numeroRequisicao, certidaoEnvio: arquivo });
    const chip = await aplicarChip(est);
    const diverge = quadro.total != null && est.marcadas != null && quadro.total !== est.marcadas;
    const msg = `detalhamento solicitado${numeroRequisicao ? " (requisição nº " + numeroRequisicao + ")" : ""}` +
      `${quadro.total != null ? ", " + quadro.total + " instituição(ões)" : ""}. Certidão de envio gerada.\n` +
      "As respostas levam até ~48h: colete depois pelo botão “Coletar CCS” do painel." +
      (chip.texto ? "\n" + chip.texto : "");
    if (chip.falhou && !diverge && numeroRequisicao) alertar(msg);
    else if (diverge) alertar(msg + `\nAtenção: o CCS informou ${quadro.total} solicitações e eu conferi ` +
      `${est.marcadas} marcadas — a certidão registra a divergência.`);
    else if (!numeroRequisicao) alertar(msg + "\nNão consegui ler o nº da requisição: a coleta vai procurar pelo processo.");
    else avisar(msg, "#4ade80");
  }

  /* Chip "CCS - aguardar resposta" (1.6.4): só depois do envio confirmado; falha não
     trava nada — vira linha âmbar na faixa. */
  async function aplicarChip(est) {
    if (!(est.config && est.config.chip)) return { texto: "" };
    let r = null;
    try { r = await browser.runtime.sendMessage({ tipo: "ccs_marcar" }); } catch (e) { r = { ok: false, erro: String(e.message || e) }; }
    if (r && r.pulado) return { texto: "" };
    const et = r && r.etiqueta;
    if (r && r.ok !== false && (!et || et.ok !== false)) return { texto: "Chip “CCS - aguardar resposta” aplicado no processo." };
    const motivo = (et && et.erro) || (r && r.erro) || "sem resposta";
    return { falhou: true, texto: "Não consegui aplicar o chip “CCS - aguardar resposta” (" + motivo + ") — aplique à mão, se usar." };
  }

  /* Nada a detalhar: não envia, avisa, e diz ao painel que esta consulta precisa de
     você (pulso ok:false → "conferir" no relatório, a fila segue). */
  async function semRelacionamentos(est, numeroRequisicao, porque) {
    const motivo = porque || "o CCS não retornou relacionamento detalhável para os CPF/CNPJ consultados";
    await salvar(est, { ativo: false, fase: "sem_relacionamentos", numeroRequisicao: numeroRequisicao || null });
    try {
      await Store.set("orq_conv_feito", {
        convenio: "CCS", numProcesso: est.numProcesso, operacao: "consulta",
        ok: false, feitos: 0, esperados: 1, motivo, em: io.agora(),
      });
    } catch (e) {}
    alertar(`${motivo}. NADA foi enviado às instituições. Se for o caso, certifique à mão.`);
  }

  /* ═══════════════════════════════════════════════════════════════════════════
   * COLETA — respostas das instituições
   * ═══════════════════════════════════════════════════════════════════════════ */
  async function passoColeta(est, tela) {
    const fila = est.fila || [];
    if (est.fase === "coleta_buscar") {
      if (tela === "1301") return tela1301(est);
      const idas = (est.idas || 0) + 1;
      if (idas > 3) throw new Error("o CCS não abriu a consulta de requisições realizadas.");
      await salvar(est, { idas });
      return io.navegar(URL_CCS.requisicoes);
    }
    if (est.fase === "coleta_consultado") {
      if (tela === "1302") return tela1302(est);
      if (tela === "1301") throw new Error("o CCS devolveu a consulta de requisições" + motivoDaPagina() + ".");
    }
    if (est.fase === "coleta_gerando") {
      if (tela === "0802") return tela0802(est);
      /* Ainda na requisição (o clique em "Gerar" pode só ter baixado/gerado sem
         navegar): vai à lista de arquivos. */
      return io.navegar(URL_CCS.arquivos);
    }
    if (est.fase === "coleta_ir") {
      if (tela === "0801") return tela0801Coleta(est);
      if (!fila.length) return finalizarColeta(est);
      return io.navegar(URL_CCS.requisicao(fila[0]));
    }
    alertar(`coleta em fase inesperada (${est.fase}) na tela CCSFW${tela}. Clique em “Coletar CCS” de novo.`);
  }

  async function tela1301(est) {
    const k = est.janela || 0;
    const fim = new Date(io.agora());
    fim.setHours(12, 0, 0, 0);
    fim.setDate(fim.getDate() - k * JANELA_DIAS);
    const ini = new Date(fim);
    ini.setDate(ini.getDate() - (JANELA_DIAS - 1));
    const cIni = campo("dataInicio"), cFim = campo("dataFim"), cProc = campo("numeroProcesso");
    if (!cIni || !cFim || !cProc) throw new Error("a consulta de requisições (CCSFW1301) não tem os campos esperados.");
    preencher(cIni, dataBR(ini));
    preencher(cFim, dataBR(fim));
    preencher(cProc, formatoProcesso(cProc, est.numeroDigitos));
    const btn = botao(/^consultar$/i, cProc.form);
    if (!btn) throw new Error("não achei o botão Consultar (CCSFW1301).");
    await salvar(est, { fase: "coleta_consultado", idas: 0 });
    avisar(`procurando a requisição deste processo de ${dataBR(ini)} a ${dataBR(fim)}…`);
    io.clicar(btn);
  }

  async function tela1302(est) {
    const achadas = lerRequisicoes1302(est.numeroDigitos);
    if (achadas.length) {
      await salvar(est, { fase: "coleta_ir", fila: achadas, idas: 0 });
      return io.navegar(URL_CCS.requisicao(achadas[0]));
    }
    const k = (est.janela || 0) + 1;
    if (k < MAX_JANELAS) {
      await salvar(est, { fase: "coleta_buscar", janela: k });
      return io.navegar(URL_CCS.requisicoes);
    }
    const n = await pedirNumeroRequisicao();
    if (!n) {
      await salvar(est, { ativo: false, fase: "cancelado" });
      CratosFaixa.parar("ccs", "não achei requisição do CCS deste processo nos últimos ~6 meses, e o número " +
        "não foi informado.", { cauda: "Nada foi juntado. O nº da requisição está na certidão de envio." });
      return;
    }
    await salvar(est, { fase: "coleta_ir", fila: [n] });
    io.navegar(URL_CCS.requisicao(n));
  }

  async function tela0801Coleta(est) {
    const N = String((est.fila || [])[0] || "");
    const naTela = lerNumeroRequisicao();
    if (naTela && N && naTela !== N) throw new Error(`a tela mostra a requisição nº ${naTela}, e eu esperava a nº ${N}.`);
    if (!confereProcesso(est)) throw new Error("a requisição na tela não é deste processo — nada foi baixado.");
    /* 1.6.3 (tela real, 19/10): a 0801 mostra os relacionamentos de UM CPF/CNPJ por vez
       — o "selecionado" da tabela "CPF/CNPJ Consultados"; os demais são links. O PDF
       de detalhamentos é da requisição INTEIRA (Rodrigo), mas o STATUS precisa ser
       lido documento a documento: lendo só o selecionado, resposta do outro executado
       passaria por "nada novo" e a certidão listaria metade das pendências. */
    const docSel = lerDocSelecionado();
    const doDoc = lerStatus0801(docSel);
    if (!doDoc) throw new Error("não reconheci a tabela de relacionamentos da requisição (CCSFW0801).");
    const porDoc = Object.assign({}, (est.leitura && est.leitura.numero === N) ? est.leitura.porDoc : {});
    porDoc[docSel || "_"] = doDoc;
    const faltam = lerLinksDocs().filter((l) => !(l.doc in porDoc));
    if (faltam.length) {
      const visitas = (est.visitasDocs || 0) + 1;
      if (visitas > 20) throw new Error("passei por documentos demais nesta requisição sem terminar a leitura.");
      await salvar(est, { leitura: { numero: N, porDoc }, visitasDocs: visitas });
      avisar(`lendo os relacionamentos do próximo CPF/CNPJ da requisição (${Object.keys(porDoc).length + 1} de ` +
        `${Object.keys(porDoc).length + faltam.length})…`);
      return io.navegar(faltam[0].href);
    }
    const status = agregarStatus(porDoc);
    await salvar(est, { leitura: null, visitasDocs: 0 });

    const reg = (await lerRegistro(est.numeroDigitos)).find((r) => String(r.numeroRequisicao) === N) || {};
    const R = status.respondidas.length;
    const jaJuntadas = reg.juntadas || 0;

    if (R > jaJuntadas) {
      const btn = botao(/gerar\s+arquivo\s+pdf/i);
      if (!btn) throw new Error("não achei o botão “Gerar Arquivo PDF com Detalhamentos”.");
      const cliqueEm = io.agora();
      await salvar(est, { fase: "coleta_gerando", cliqueEm, estabilizado: false,
        atual: { numero: N, status, ultimaResposta: ultimaResposta(status) } });
      avisar(`${R} instituição(ões) respondeu(ram) — pedindo ao CCS o PDF de detalhamentos…`);
      io.clicar(btn);
      /* Se o clique não navegou (gerou em segundo plano), vamos nós à lista. */
      await io.esperar(4000);
      const agora = await Store.get("ccs_estado");
      if (agora && agora.fase === "coleta_gerando" && codigoTela(document) === "0801") io.navegar(URL_CCS.arquivos);
      return;
    }

    /* Nada novo desde a última juntada. Pendência → certidão de ESTADO, no máximo
       uma por dia (uma coleta repetida no mesmo dia não enche os autos). */
    let resultado;
    if (status.pendentes.length && reg.ultimaCertidao !== hojeChave()) {
      const arquivo = await fabricarCertidaoColeta(est, N, status, []);
      await atualizarRegistro(est.numeroDigitos, N, (r) => Object.assign(r, { ultimaCertidao: hojeChave() }));
      resultado = { numero: N, tipo: "estado", respondidas: R, pendentes: status.pendentes.length, arquivo };
    } else {
      if (!status.pendentes.length && R > 0) {
        await atualizarRegistro(est.numeroDigitos, N, (r) => Object.assign(r, { encerrada: true }));
      }
      resultado = { numero: N, tipo: "nada", respondidas: R, pendentes: status.pendentes.length };
    }
    await proximaRequisicao(est, resultado);
  }

  /* CCSFW0802 (tela REAL, print de 19/10): "Lista dos arquivos disponíveis para download" —
     Nome do arquivo | Data da geração. O NOME é <nº requisição>-<AAAAMMDDhhmm>-<login>.pdf
     (a hora da geração está NO NOME); a coluna traz SÓ a data. A 1.6.3 lia a coluna
     ("19/10/2026" = meia-noite), achava o arquivo "anterior ao clique" e nunca o pegava.
     Critério (1.6.4): serve o PDF da requisição gerado DEPOIS DA ÚLTIMA RESPOSTA lida na
     0801 — o PDF é cumulativo, então ele já traz todas — ou gerado pelo nosso clique.
     Vários: o MAIS RECENTE (o PDF é da requisição inteira; um só). Sem hora no nome: só por
     dia, e só se o dia for posterior ao da última resposta. */
  async function tela0802(est) {
    const N = String((est.atual && est.atual.numero) || (est.fila || [])[0] || "");
    const ultima = (est.atual && est.atual.ultimaResposta) || null;
    const pdf = escolherPdf0802(lerArquivos0802(), N, ultima, est.cliqueEm || 0);

    if (!pdf) {
      const passou = io.agora() - (est.cliqueEm || 0);
      if (passou > LIMITE_ARQUIVO_MS) {
        /* Falha técnica, não pendência: nada de certidão. */
        alertar(`o CCS ainda não terminou de gerar o PDF da requisição nº ${N} (esperei ` +
          `${Math.round(passou / 60000)} min). Nada foi juntado — clique em “Coletar CCS” de novo daqui a pouco.`);
        return proximaRequisicao(est, { numero: N, tipo: "timeout" });
      }
      avisar(`aguardando o CCS gerar o PDF da requisição nº ${N}… (${Math.round(passou / 1000)} s)`);
      await io.esperar(POLL_ARQUIVO_MS);
      return io.recarregar();
    }

    const cfg = est.config || {};
    const hoje = dataBR(new Date(io.agora())).replace(/\//g, "-");
    const status = (est.atual && est.atual.status) || { respondidas: [], pendentes: [], naoSolicitadas: 0 };
    const resp = await io.baixar(pdf.link || URL_CCS.baixar(pdf.nome));
    if (!resp || (resp.ok === false)) throw new Error(`o CCS não entregou o arquivo ${pdf.nome} (HTTP ${resp && resp.status}).`);
    const bytes = new Uint8Array(await resp.arrayBuffer());
    /* Decide pelos BYTES: o CCS serve o PDF como application/xml. */
    if (!(bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
      throw new Error(`o arquivo ${pdf.nome} não veio como PDF — nada foi juntado.`);
    }
    /* O PDF é da requisição inteira: nome pelo 1º executado CONSULTADO, sem documento
       (o meio do nome do arquivo do CCS é a hora da geração, não um CPF). */
    const consultado = executadoConsultado(est, status);
    const r = await browser.runtime.sendMessage({
      tipo: "ccs_pdf",
      base64: bytesParaBase64(bytes),
      numProcesso: est.numProcesso,
      nomeAbrev: doisPrimeiros(consultado.nome || ""),
      pasta: cfg.pasta || "CRATOS",
      rotulo: `CCS detalhamento ${hoje}`,
    }).catch(() => ({ ok: true, presumido: true }));
    const baixados = [(r && r.filename) || pdf.nome];

    const arquivo = await fabricarCertidaoColeta(est, N, status, baixados);
    await atualizarRegistro(est.numeroDigitos, N, (rg) => Object.assign(rg, {
      juntadas: status.respondidas.length,
      ultimaCertidao: hojeChave(),
      encerrada: status.pendentes.length === 0,
    }));
    await proximaRequisicao(est, {
      numero: N, tipo: "pdf", arquivos: baixados.length, respondidas: status.respondidas.length,
      pendentes: status.pendentes.length, arquivo,
    });
  }

  /* Quem serve, entre os arquivos da lista (ver tela0802). */
  function escolherPdf0802(arquivos, N, ultimaResposta, cliqueEm) {
    const minuto = (ms) => Math.floor(ms / 60000) * 60000;
    const diaDe = (ms) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
    const servem = arquivos.filter((a) => {
      if (String(a.nome).indexOf(N + "-") !== 0) return false;
      if (a.geradoEm) {
        const g = a.geradoEm.getTime();
        return (ultimaResposta != null && g > minuto(ultimaResposta)) ||
               (cliqueEm && g >= minuto(cliqueEm - FOLGA_RELOGIO_MS));
      }
      return !!a.dia && ultimaResposta != null && a.dia.getTime() > diaDe(ultimaResposta);
    });
    servem.sort((x, y) => ((y.geradoEm || y.dia).getTime() - (x.geradoEm || x.dia).getTime()));
    return servem[0] || null;
  }

  /* Maior data/hora de resposta lida na 0801 (ms), ou null. */
  function ultimaResposta(status) {
    let max = null;
    for (const r of (status && status.respondidas) || []) {
      const m = String(r.resposta || "").match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
      if (!m) continue;
      const t = new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]).getTime();
      if (max == null || t > max) max = t;
    }
    return max;
  }

  /* 1º executado CONSULTADO (na coleta `est.docs` traz todas as partes do processo). */
  function executadoConsultado(est, status) {
    const docsStatus = ((status && status.docs) || []).filter(Boolean);
    return (est.docs || []).find((x) => docsStatus.indexOf(x.doc) >= 0) ||
      (est.docs || []).find((x) => x.polo !== "ativo") || (est.docs || [])[0] || {};
  }

  async function proximaRequisicao(est, resultado) {
    const resultados = (est.resultados || []).concat(resultado ? [resultado] : []);
    const fila = (est.fila || []).slice(1);
    if (fila.length) {
      await salvar(est, { fila, resultados, fase: "coleta_ir", estabilizado: false, atual: null, cliqueEm: null });
      return io.navegar(URL_CCS.requisicao(fila[0]));
    }
    return finalizarColeta(Object.assign({}, est, { fila, resultados }));
  }

  async function finalizarColeta(est) {
    const resultados = est.resultados || [];
    await salvar(est, { ativo: false, fase: "coleta_concluida", resultados });
    await Store.set("ccs_coleta_resultado", { numProcesso: est.numProcesso, resultados, em: io.agora() });
    const pdfs = resultados.filter((r) => r.tipo === "pdf");
    const pend = resultados.reduce((s, r) => s + (r.pendentes || 0), 0);
    const falhou = resultados.some((r) => r.tipo === "timeout");
    const linha = pdfs.length
      ? `${pdfs.reduce((s, r) => s + (r.arquivos || 0), 0)} PDF(s) de detalhamento baixado(s) com a certidão da coleta`
      : "nenhuma resposta nova para juntar";
    const msg = `coleta do CCS concluída: ${linha}` + (pend ? `; ${pend} instituição(ões) ainda sem resposta` : "") +
      ".\nVolte ao PJe e use “Juntar certidão dos convênios”.";
    if (falhou) alertar(msg + "\nUma requisição ficou sem o PDF (geração não terminou) — colete de novo.");
    else avisar(msg, "#4ade80");
  }

  /* ═══════════════════════════════════════════════════════════════════════════
   * CERTIDÕES (texto → background fabricar_pdf → Cofre + diário + pulso)
   * ═══════════════════════════════════════════════════════════════════════════ */
  /* LGPD (15/10): CPF completo só dos executados consultados (já nos autos);
     instituições pelo nome; NADA de "Pessoas com as quais o CPF/CNPJ possui vínculos". */
  async function fabricarCertidaoEnvio(est, quadro, numeroRequisicao) {
    const linhasEst = est.linhas || [];
    const pedidas = linhasEst.filter((l) => l.detalhavel && l.pedida);
    const foraCriterio = linhasEst.filter((l) => l.detalhavel && !l.pedida);
    const naoDetalhaveis = linhasEst.filter((l) => !l.detalhavel);
    const docs = est.docs || [];
    const multiplos = docs.length > 1;
    const nomeDoc = (doc) => { const d = docs.find((x) => x.doc === doc); return d ? d.nome : formatarDoc(doc); };
    const rel = (l, i) => `${i + 1}) ${l.instituicao || "(instituição não identificada)"}` +
      (l.dataInicio ? ` — vínculo desde ${l.dataInicio}` : "") + (l.dataFim ? ` até ${l.dataFim}` : "") +
      (multiplos && l.doc ? ` (${nomeDoc(l.doc)})` : "");

    const linhas = ["",
      `Certifico e dou fé que, nesta data (${dataBR(new Date(io.agora()))}), foi requisitada consulta ao ` +
      `Cadastro de Clientes do Sistema Financeiro Nacional (CCS), do Banco Central do Brasil, no processo ` +
      `nº ${est.numProcesso}` + (numeroRequisicao ? `, sob a requisição nº ${numeroRequisicao}` : "") +
      `, e solicitado às instituições o detalhamento dos relacionamentos, nos seguintes termos:`, ""];
    if (numeroRequisicao) linhas.push(`Requisição nº: ${numeroRequisicao}`);
    linhas.push(`Motivo da consulta: ${(est.config || {}).motivo || "Execução trabalhista"}`);
    if (quadro.dataHora) linhas.push(`Data/hora do envio (registrada pelo CCS): ${quadro.dataHora}`);
    if (quadro.total != null) linhas.push(`Total de solicitações de detalhamento enviadas (informado pelo CCS): ${quadro.total}`);
    linhas.push(`Critério de seleção: ${est.criterio === "sem_data_fim"
      ? "somente os relacionamentos sem data fim (ativos)" : "todos os relacionamentos detalháveis"}`);

    linhas.push("", `Pessoas consultadas (${docs.length}):`);
    docs.forEach((d, i) => linhas.push(`${i + 1}) ${d.nome} - CPF/CNPJ ${formatarDoc(d.doc)}`));

    if (linhasEst.length) {
      linhas.push("", `Instituições a que foi solicitado o detalhamento (${pedidas.length}):`);
      pedidas.forEach((l, i) => linhas.push(rel(l, i)));
      if (foraCriterio.length) {
        linhas.push("", `Relacionamentos com data fim, não solicitados pelo critério acima (${foraCriterio.length}):`);
        foraCriterio.forEach((l, i) => linhas.push(rel(l, i)));
      }
      if (naoDetalhaveis.length) {
        linhas.push("", `Relacionamentos não detalháveis — a instituição não tem comunicação com o CCS, ` +
          `por isso o detalhamento não pôde ser pedido (${naoDetalhaveis.length}):`);
        naoDetalhaveis.forEach((l, i) => linhas.push(rel(l, i)));
      }
    } else {
      linhas.push("", "Instituições: conforme a requisição registrada no CCS (a seleção foi feita diretamente na tela).");
    }

    /* Rastro (Res. CNJ 615/2025): quem decidiu cada clique. */
    linhas.push("");
    linhas.push(est.termoAutomatico
      ? `O aceite do Termo de Uso e Responsabilidade do CCS foi registrado automaticamente pelo CRATOS, ` +
        `por configuração do(a) usuário(a), em ${dataHoraDeIso(est.termoEm)}.`
      : "O aceite do Termo de Uso e Responsabilidade do CCS foi feito pelo(a) responsável por este ato.");
    linhas.push(est.envioAutomatico
      ? `A solicitação de detalhamento foi enviada automaticamente pelo CRATOS, por configuração do(a) ` +
        `usuário(a), em ${dataHoraDeIso(est.envioEm)}, depois de conferidas ${est.marcadas} marcação(ões).`
      : "A solicitação de detalhamento foi enviada pelo(a) responsável por este ato.");
    if (quadro.total != null && est.marcadas != null && quadro.total !== est.marcadas) {
      linhas.push(`Observo que o CCS informou ${quadro.total} solicitação(ões) enviada(s), enquanto ` +
        `${est.marcadas} relacionamento(s) havia(m) sido marcado(s) pelo critério.`);
    }
    linhas.push("", "As instituições respondem de forma assíncrona (em regra, em até 48 horas). As respostas " +
      "serão juntadas quando disponíveis.", "", "Era o que me cumpria certificar.");

    const filename = `${pasta(est)}/${est.numeroDigitos}_${doisPrimeiros((docs[0] || {}).nome)} CCS envio.pdf`;
    await enviarCertidao(est, "CERTIDÃO DE CONSULTA AO CCS (BACEN)", linhas, filename, "envio");
    return filename;
  }

  /* Certidão do ESTADO ATUAL da requisição — não é comparativa com a anterior
     (Rodrigo, 15/10): diz quem já respondeu e quem falta. `arquivos` vazio = não
     houve PDF nesta coleta (certidão de estado). */
  async function fabricarCertidaoColeta(est, numero, status, arquivos) {
    const agora = new Date(io.agora());
    const comPdf = arquivos && arquivos.length > 0;
    const linhas = ["",
      `Certifico e dou fé que, nesta data (${dataBR(agora)}), consultei no Cadastro de Clientes do Sistema ` +
      `Financeiro Nacional (CCS), do Banco Central do Brasil, a requisição nº ${numero}, referente ao processo ` +
      `nº ${est.numProcesso}` +
      (comPdf
        ? ", e obtive o arquivo de detalhamentos gerado pelo próprio CCS (PDF), que reúne todas as respostas " +
          "recebidas até esta data e segue anexo."
        : status.respondidas.length
          ? ". Não houve resposta nova a juntar desde o arquivo de detalhamentos já juntado."
          : ". Até esta data, nenhuma instituição havia respondido à solicitação de detalhamento."),
      "", "Situação das instituições neste momento:"];
    const bloco = (resp, pend) => {
      linhas.push("", `Responderam (${resp.length}):`);
      if (!resp.length) linhas.push("(nenhuma)");
      resp.forEach((r, i) => linhas.push(`${i + 1}) ${r.instituicao}` +
        (r.resposta ? ` — resposta em ${r.resposta}` : "")));
      linhas.push("", `Aguardando resposta (${pend.length}):`);
      if (!pend.length) linhas.push("(nenhuma)");
      pend.forEach((p, i) => {
        const dias = diasDesde(p.solicitadoEm, agora);
        linhas.push(`${i + 1}) ${p.instituicao}` + (p.solicitadoEm ? ` — solicitado em ${p.solicitadoEm}` : "") +
          (dias != null ? ` (há ${dias} dia${dias === 1 ? "" : "s"})` : ""));
      });
    };
    /* Vários executados na requisição: a situação sai AGRUPADA por executado. */
    const docsStatus = (status.docs || []).filter(Boolean);
    if (docsStatus.length > 1) {
      for (const d of docsStatus) {
        const parte = (est.docs || []).find((x) => x.doc === d);
        linhas.push("", `${parte ? parte.nome + " - " : ""}CPF/CNPJ ${formatarDoc(d)}:`);
        bloco(status.respondidas.filter((r) => r.doc === d), status.pendentes.filter((p) => p.doc === d));
      }
    } else {
      bloco(status.respondidas, status.pendentes);
    }
    if (comPdf) {
      linhas.push("", `Arquivo(s) anexado(s) (${arquivos.length}):`);
      arquivos.forEach((a, i) => linhas.push(`${i + 1}) ${String(a).split("/").pop()}`));
    }
    linhas.push("", status.pendentes.length
      ? "As instituições pendentes poderão responder posteriormente."
      : "Todas as instituições a que foi solicitado o detalhamento responderam. Encerrado o ciclo desta requisição.");
    linhas.push("", "Era o que me cumpria certificar.");

    const sufixoNome = comPdf ? "CCS respostas" : "CCS aguardando";
    /* Nome do arquivo pelo primeiro executado CONSULTADO — na coleta `est.docs` traz
       todas as partes do processo (para dar nome aos PDFs), e a primeira costuma ser o
       exequente (relatório de 19/10). */
    const consultado = executadoConsultado(est, status);
    const filename = `${pasta(est)}/${est.numeroDigitos}_${doisPrimeiros(consultado.nome)} ` +
      `${sufixoNome} ${dataBR(agora).replace(/\//g, "-")}.pdf`;
    await enviarCertidao(est, comPdf ? "CERTIDÃO — RESPOSTAS DO CCS (BACEN)" : "CERTIDÃO — CCS (BACEN): AGUARDANDO RESPOSTAS",
      linhas, filename, comPdf ? "respostas" : "aguardando");
    return filename;
  }

  async function enviarCertidao(est, titulo, linhas, filename, detalhe) {
    await browser.runtime.sendMessage({
      tipo: "fabricar_pdf",
      convenio: "CCS",
      numProcesso: est.numProcesso,
      operacao: "consulta",
      detalhe,
      titulo,
      linhas,
      filename: filename.replace(/\s+/g, " "),
    }).catch(() => { /* Promise rejeita no FF mesmo baixando; presunção de sucesso */ });
  }

  /* ═══════════════════════════════════════════════════════════════════════════
   * LEITURA DAS TELAS
   * ═══════════════════════════════════════════════════════════════════════════ */
  function codigoTela(doc) {
    const t = (doc && doc.body && doc.body.textContent) || "";
    const m = t.match(/\[\s*CCSFW\s*(\d{4})\s*\]/i);
    return m ? m[1] : null;
  }

  /* CCSFW0601: uma linha por relacionamento. Detalhável = checkbox COM sufixo e
     habilitado. A data de início vem do próprio sufixo (ddmmaaaa no fim), o que
     permite separar com segurança a Data Fim do texto da linha. */
  function lerLinhas0601(doc) {
    const caixas = Array.from(doc.querySelectorAll('input[type="checkbox"]'))
      .filter((c) => String(c.name || "").indexOf(PREFIXO) === 0);
    return caixas.map((c) => {
      const sufixo = String(c.name).slice(PREFIXO.length);
      const detalhavel = sufixo.length >= 27 && /^\d+$/.test(sufixo) && !c.disabled;
      const tr = c.closest("tr");
      const celulas = tr ? Array.from(tr.cells || tr.children).map(texto) : [];
      const datas = [];
      for (const t of celulas) for (const d of (t.match(/\b\d{2}\/\d{2}\/\d{4}\b/g) || [])) datas.push(d);
      let dataInicio = null, dataFim = null, docPessoa = null;
      if (detalhavel) {
        const tail = sufixo.slice(-8);
        dataInicio = `${tail.slice(0, 2)}/${tail.slice(2, 4)}/${tail.slice(4)}`;
        docPessoa = sufixo.slice(0, sufixo.length - 16);
        const outras = datas.filter((d) => d !== dataInicio);
        dataFim = outras[0] || null;
      } else {
        dataInicio = datas[0] || null;
        dataFim = datas[1] || null;
      }
      const instituicao = celulas
        .map((t) => t.replace(/\b\d{2}\/\d{2}\/\d{4}\b/g, "").trim())
        .find((t) => t && !/^[\d./\s-]+$/.test(t)) || null;
      return { el: c, sufixo: detalhavel ? sufixo : null, detalhavel, instituicao, dataInicio, dataFim,
        doc: docPessoa && (docPessoa.length === 11 || docPessoa.length === 14) ? docPessoa : null };
    });
  }

  /* CCSFW0801 (tela REAL, prints de 19/10): "Relacionamentos" do CPF/CNPJ selecionado —
     Detentora do relacionamento | Responsável pelas informações | Data Início | Data Fim |
     Detalhamento: Usuário | Data/Hora Solicitação | Data/Hora Resposta.
     O status mora na ÚLTIMA coluna: "Não solicitado", "Pendente" ou a data/hora da
     resposta. A página é montada com tabelas ANINHADAS: a 1.6.2 pegava a célula de
     layout de fora (cujo texto também começa por "Detentora…"), subia para a tabela
     errada e não achava linha nenhuma. Agora: acha a LINHA de cabeçalho pelos rótulos
     (sem tabela dentro) e lê as linhas de dados que vêm DEPOIS dela, na ordem do
     documento — funciona com aninhamento e com cabeçalho e corpo em tabelas separadas.
     Texto desconhecido na resposta conta como PENDENTE (lado conservador): nunca vira
     "respondida" sem data. */
  function lerStatus0801(doc) {
    const trs = Array.from(document.querySelectorAll("tr"));
    const iCab = trs.findIndex((tr) => !tr.querySelector("table") &&
      Array.from(tr.cells).some((c) => /^detentora\b/i.test(texto(c))));
    if (iCab < 0) return null;
    const respondidas = [], pendentes = [];
    let naoSolicitadas = 0, linhasLidas = 0;
    const DATA = /(?<!\d)\d{2}\/\d{2}\/\d{4}(?!\d)/;
    const DH = /(?<!\d)\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}(?::\d{2})?(?!\d)/;
    for (let i = iCab + 1; i < trs.length; i++) {
      const tr = trs[i];
      if (tr.querySelector("table")) continue;               // linha de layout
      const cel = Array.from(tr.cells).map(texto);
      const linha = cel.join(" ");
      if (/pessoas com as quais/i.test(linha)) break;
      if (!DATA.test(linha)) {                               // 2ª linha do cabeçalho, ou fim da tabela
        if (linhasLidas) break;
        continue;
      }
      linhasLidas++;
      const instituicao = cel[0] || "(instituição não identificada)";
      const resp = cel[cel.length - 1] || "";
      const solic = cel.length >= 2 ? cel[cel.length - 2] : "";
      if (/n[ãa]o\s+(foi\s+)?solicitad/i.test(resp) || /n[ãa]o\s+foi\s+solicitado/i.test(linha)) {
        naoSolicitadas++;
        continue;
      }
      const mResp = resp.match(DH);
      if (mResp && !/pendente/i.test(resp)) {
        respondidas.push({ instituicao, resposta: mResp[0], doc: doc || null });
        continue;
      }
      const mSol = solic.match(DH) || linha.match(DH);
      pendentes.push({ instituicao, solicitadoEm: mSol ? mSol[0].slice(0, 10) : null, doc: doc || null });
    }
    if (!linhasLidas) return null;
    return { respondidas, pendentes, naoSolicitadas };
  }

  /* CPF/CNPJ selecionado: o quadro "Requisição" traz "CPF/CNPJ:" (com dois-pontos —
     o cabeçalho da tabela "CPF/CNPJ Consultados" é sem, e não pode casar). */
  function lerDocSelecionado() {
    const v = valorDoRotulo(/^cpf\s*\/\s*cnpj\s*:$/i);
    const d = digitos(v);
    return d.length === 11 || d.length === 14 ? d : null;
  }

  /* Os OUTROS documentos da requisição: links da tabela "CPF/CNPJ Consultados". */
  function lerLinksDocs() {
    const vistos = new Set();
    const out = [];
    for (const a of Array.from(document.querySelectorAll('a[href*="visualizarRequisicaoCliente"]'))) {
      const d = digitos(texto(a));
      if ((d.length !== 11 && d.length !== 14) || vistos.has(d)) continue;
      vistos.add(d);
      out.push({ doc: d, href: a.href });
    }
    return out;
  }

  function agregarStatus(porDoc) {
    const docs = Object.keys(porDoc);
    const out = { respondidas: [], pendentes: [], naoSolicitadas: 0, docs: docs.filter((d) => d !== "_") };
    for (const d of docs) {
      out.respondidas.push(...porDoc[d].respondidas);
      out.pendentes.push(...porDoc[d].pendentes);
      out.naoSolicitadas += porDoc[d].naoSolicitadas || 0;
    }
    return out;
  }

  function lerNumeroRequisicao() {
    const v = valorDoRotulo(/^n[úu]mero\s+(da\s+)?requisi[çc][ãa]o\s*:?$/i);
    if (v && digitos(v)) return digitos(v);
    for (const el of Array.from(document.querySelectorAll("[href], [onclick]"))) {
      const s = (el.getAttribute("href") || "") + " " + (el.getAttribute("onclick") || "");
      const m = s.match(/numeroRequisicao=(\d+)/i);
      if (m) return m[1];
    }
    const h = document.querySelector('input[name="numRequisicao"], input[name="numeroRequisicao"]');
    return h && digitos(h.value) ? digitos(h.value) : null;
  }

  function lerQuadro0602() {
    const num = valorDoRotulo(/^n[úu]mero\s+(da\s+)?requisi[çc][ãa]o\s*:?$/i);
    const total = valorDoRotulo(/^total\s+de\s+solicita/i);
    const dh = valorDoRotulo(/^data\s*\/?\s*hora/i);
    const t = total != null ? parseInt(digitos(total), 10) : NaN;
    return {
      numeroRequisicao: num && digitos(num) ? digitos(num) : null,
      total: isNaN(t) ? null : t,
      dataHora: dh ? (dh.match(/\d{2}\/\d{2}\/\d{4}(\s+\d{2}:\d{2}(:\d{2})?)?/) || [dh])[0] : null,
    };
  }

  function lerRequisicoes1302(numeroDigitos) {
    const achadas = [];
    for (const el of Array.from(document.querySelectorAll("[href], [onclick]"))) {
      const s = (el.getAttribute("href") || "") + " " + (el.getAttribute("onclick") || "");
      const m = s.match(/numeroRequisicao=(\d+)/i);
      if (!m) continue;
      const tr = el.closest("tr");
      const linha = tr ? textoEspacado(tr) : "";
      /* Trava de processo: a linha tem de trazer ESTE número. */
      if (!processosDoTexto(linha).some((p) => p === numeroDigitos)) continue;
      if (achadas.indexOf(m[1]) < 0) achadas.push(m[1]);
    }
    return achadas;
  }

  /* CCSFW0802: "Nome do arquivo" | "Data da geração". Hora da geração pelo NOME
     (<req>-<AAAAMMDDhhmm>-<login>.pdf); a coluna só tem a data. */
  function lerArquivos0802() {
    const saida = [];
    for (const tr of Array.from(document.querySelectorAll("tr"))) {
      if (tr.querySelector("th") || tr.querySelector("table")) continue;
      const celulas = Array.from(tr.cells).map(texto);
      const nome = celulas.find((t) => /\.pdf$/i.test(t));
      if (!nome) continue;
      const mn = nome.match(/^\d+-(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})-/);
      const md = celulas.join(" ").match(/(?<!\d)(\d{2})\/(\d{2})\/(\d{4})(?!\d)/);
      const a = tr.querySelector('a[href*="baixarArquivo"]');
      saida.push({
        nome,
        geradoEm: mn ? new Date(+mn[1], +mn[2] - 1, +mn[3], +mn[4], +mn[5]) : null,
        dia: md ? new Date(+md[3], +md[2] - 1, +md[1]) : null,
        link: a ? a.href : null,
      });
    }
    return saida;
  }

  /* ═══ apoio de tela ═══ */
  function campo(nome) { return document.querySelector(`[name="${nome}"]`); }

  function botao(re, escopo) {
    const raiz = escopo || document;
    const cands = Array.from(raiz.querySelectorAll('input[type="submit"], input[type="button"], button, a'));
    return cands.find((b) => re.test(texto(b) || String(b.value || "").trim())) || null;
  }

  function preencher(el, valor) {
    el.focus && el.focus();
    el.value = valor;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.blur && el.blur();
  }

  /* Campo com limite curto → só dígitos; senão a máscara CNJ (a confirmar ao vivo). */
  function formatoProcesso(el, d) {
    const max = Number(el && el.maxLength);
    return max > 0 && max < 25 ? digitos(d) : formatarProcesso(d);
  }

  /* Valor ao lado de um rótulo: célula seguinte, ou o que vem depois de ":". */
  function valorDoRotulo(re) {
    for (const el of Array.from(document.querySelectorAll("td, th, label, b, strong, span, dt"))) {
      const t = texto(el);
      if (!t || t.length > 80) continue;
      const [rot, ...resto] = t.split(":");
      if (re.test(t) || re.test(rot.trim())) {
        const depois = resto.join(":").trim();
        if (depois) return depois;
        const prox = el.nextElementSibling || (el.parentElement && el.parentElement.nextElementSibling);
        if (prox && texto(prox)) return texto(prox);
      }
    }
    return null;
  }

  /* Rádio "mostrar/esconder vínculos": mexe só na EXIBIÇÃO. Padrão = inativos à
     mostra. Se não der para identificar as opções, não mexe. */
  function aplicarExibicaoInativos(est) {
    const esconder = !!((est.config || {}).esconderInativos);
    const radios = Array.from(document.querySelectorAll('input[type="radio"][name="rdbMostrarEsconderVinculos"]'));
    if (!radios.length) return;
    const rotulo = (r) => {
      const l = r.id && document.querySelector(`label[for="${r.id}"]`);
      return ((l && texto(l)) || texto(r.parentElement) || "") + " " + (r.value || "");
    };
    const alvo = radios.find((r) => esconder ? /escond|ocult/i.test(rotulo(r)) : /mostr|exib|todos/i.test(rotulo(r)));
    if (alvo && !alvo.checked) io.clicar(alvo);
  }

  /* Trava de processo: se a tela mostra número(s) de processo, um deles tem de ser
     o nosso. Tela sem número não reprova (não há o que conferir). */
  function confereProcesso(est) {
    const achados = processosDoTexto(textoEspacado(document.body));
    return !achados.length || achados.indexOf(est.numeroDigitos) >= 0;
  }
  function processosDoTexto(t) {
    /* Lookaround de DÍGITO, não \b: "Processo:0011530-…0008Data" não tem fronteira de
       palavra entre o 8 e o D, e o número sumiria da conferência. */
    const fmt = String(t || "").match(/(?<!\d)\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}(?!\d)/g) || [];
    const cru = String(t || "").match(/(?<!\d)\d{20}(?!\d)/g) || [];
    return fmt.map(digitos).concat(cru);
  }

  /* Mensagem de erro que a página mostrou — sem CPF/CNPJ (vai para a faixa e o console). */
  function motivoDaPagina() {
    const els = document.querySelectorAll('.erro, .error, .mensagemErro, .msgErro, .alert, [class*="erro"], ' +
      '[class*="Erro"], [class*="error"], font[color="red"], font[color="#FF0000"], font[color="#ff0000"]');
    const t = Array.from(els).map(texto).filter(Boolean).join(" · ").slice(0, 300);
    return t ? ` ("${mascararDocs(t)}")` : " (sem mensagem de erro na tela)";
  }
  function mascararDocs(t) {
    return String(t)
      .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, "[CNPJ]")
      .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[CPF]");
  }

  /* Popup do plano B: o nº da requisição está na certidão de envio. Espera sem prazo. */
  function pedirNumeroRequisicao() {
    return new Promise((resolve) => {
      const fundo = document.createElement("div");
      fundo.id = "cratos-ccs-popup";
      fundo.style.cssText = "position:fixed;inset:0;z-index:2147483645;background:rgba(0,0,0,.55);" +
        "display:flex;align-items:center;justify-content:center;font:14px/1.45 system-ui,sans-serif";
      const cartao = document.createElement("div");
      cartao.style.cssText = "background:#111;color:#e8e8e8;border-left:4px solid #facc15;border-radius:8px;" +
        "padding:16px 18px;max-width:420px;box-shadow:0 4px 24px rgba(0,0,0,.6)";
      CratosHTML.definir(cartao, html`
        <div style="font-weight:700;margin-bottom:8px">CRATOS — CCS</div>
        <div style="margin-bottom:10px">Não achei a requisição deste processo nos últimos ~6 meses pela busca do
          CCS. Informe o <b>nº da requisição</b> (está na certidão de envio juntada nos autos):</div>
        <input id="cratos-ccs-num" inputmode="numeric" style="width:100%;padding:6px;margin-bottom:10px;
          background:#000;color:#e8e8e8;border:1px solid #555;border-radius:4px">
        <div id="cratos-ccs-erro" style="color:#ff6b6b;font-size:12px;min-height:16px"></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px">
          <button id="cratos-ccs-cancelar" style="padding:6px 10px">Cancelar</button>
          <button id="cratos-ccs-ok" style="padding:6px 10px;font-weight:700">Confirmar</button>
        </div>`);
      fundo.appendChild(cartao);
      (document.body || document.documentElement).appendChild(fundo);
      const inp = cartao.querySelector("#cratos-ccs-num");
      const fechar = (v) => { fundo.remove(); resolve(v); };
      cartao.querySelector("#cratos-ccs-cancelar").onclick = () => fechar(null);
      const ok = () => {
        const n = digitos(inp.value);
        if (!n) { cartao.querySelector("#cratos-ccs-erro").textContent = "Digite só o número da requisição."; return; }
        fechar(n);
      };
      cartao.querySelector("#cratos-ccs-ok").onclick = ok;
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") ok(); });
      try { inp.focus(); } catch (e) {}
    });
  }

  /* ═══ registro das requisições (para a coleta) — cratos:ccs_req:<20 dígitos> ═══ */
  async function lerRegistro(numeroDigitos) {
    return (await Store.get("ccs_req:" + numeroDigitos)) || [];
  }
  async function atualizarRegistro(numeroDigitos, numero, fn) {
    const lista = await lerRegistro(numeroDigitos);
    let r = lista.find((x) => String(x.numeroRequisicao) === String(numero));
    if (!r) { r = { numeroRequisicao: String(numero), juntadas: 0, encerrada: false }; lista.push(r); }
    fn(r);
    await Store.set("ccs_req:" + numeroDigitos, lista);
    return r;
  }

  async function salvar(est, patch) {
    const novo = Object.assign({}, est, patch, { abertoEm: agoraIso() });
    Object.assign(est, novo);
    await Store.set("ccs_estado", novo);
    return novo;
  }

  /* ═══ utilidades ═══ */
  function texto(el) { return el ? String(el.textContent || "").replace(/\s+/g, " ").trim() : ""; }
  /* textContent cola células vizinhas ("…0008" + "15/10/2026" = "…000815/10/2026");
     para procurar números, juntamos os nós de texto COM espaço. */
  function textoEspacado(raiz) {
    if (!raiz) return "";
    const partes = [];
    const w = document.createTreeWalker(raiz, 4 /* NodeFilter.SHOW_TEXT */);
    for (let n = w.nextNode(); n; n = w.nextNode()) partes.push(n.nodeValue);
    return partes.join(" ").replace(/\s+/g, " ").trim();
  }
  function digitos(s) { return String(s == null ? "" : s).replace(/\D/g, ""); }
  function pasta(est) {
    return String(((est.config || {}).pasta) || "CRATOS").replace(/[\\:*?"<>|]/g, "").trim() || "CRATOS";
  }
  function formatarDoc(d) {
    const x = digitos(d);
    if (x.length === 11) return x.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
    if (x.length === 14) return x.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
    return x || "(sem documento)";
  }
  function formatarProcesso(d) {
    const x = digitos(d);
    return x.length === 20
      ? `${x.slice(0, 7)}-${x.slice(7, 9)}.${x.slice(9, 13)}.${x.slice(13, 14)}.${x.slice(14, 16)}.${x.slice(16)}`
      : x;
  }
  function doisPrimeiros(nome) {
    return String(nome || "").trim().split(/\s+/).slice(0, 2).join(" ").replace(/[/\\:*?"<>|]/g, "");
  }
  const p2 = (n) => String(n).padStart(2, "0");
  function dataBR(d) { return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`; }
  function agoraIso() { return new Date(io.agora()).toISOString(); }
  function hojeChave() { const d = new Date(io.agora()); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; }
  function dataHoraDeIso(iso) {
    const d = iso ? new Date(iso) : new Date(io.agora());
    return `${dataBR(d)} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  }
  function diasDesde(ddmmaaaa, agora) {
    const m = String(ddmmaaaa || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (!m) return null;
    const a = new Date(+m[3], +m[2] - 1, +m[1]);
    const b = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
    return Math.max(0, Math.round((b - a) / 86400000));
  }
  function bytesParaBase64(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  function avisar(t, cor) { return CratosFaixa.mostrar("ccs", t, cor || "#facc15"); }
  function alertar(t) { return CratosFaixa.mostrar("ccs", t, "#facc15"); }
  function falhar(e) {
    const msg = mascararDocs((e && e.message) || String(e));
    CratosFaixa.parar("ccs", msg);
    Store.get("ccs_estado").then((est) => {
      if (est) Store.set("ccs_estado", Object.assign({}, est, { ativo: false, fase: "erro", erro: msg }));
    }).catch(() => {});
  }

  /* Gancho de teste (jsdom): leitores, certidões e os pontos de saída (io). */
  if (typeof window !== "undefined") {
    window.__cratosCcs = {
      io, processar, codigoTela, lerLinhas0601, lerStatus0801, lerNumeroRequisicao, lerQuadro0602,
      lerRequisicoes1302, lerArquivos0802, fabricarCertidaoEnvio, fabricarCertidaoColeta, mascararDocs,
      lerDocSelecionado, lerLinksDocs, agregarStatus, escolherPdf0802, ultimaResposta,
    };
  }
})();
