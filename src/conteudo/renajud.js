/*
 * conteudo/renajud.js — content script do RENAJUD NOVO (renajud.pdpj.jus.br).
 *
 * SPA Angular, DOM-driven (não há API JSON). Padrão: MutationObserver para os
 * componentes Angular + preenchimento reativo (setter nativo + eventos + ENTER,
 * que é o que fixa os campos typeahead — método comprovado do maisPJe).
 *
 * ESCOPO "PREPARAR" (decisão do Rodrigo):
 *   - INCLUSÃO: navega, preenche CPF/CNPJ -> Pesquisar; quando o usuário chega no
 *     componente de inclusão, preenche a restrição e clica "Inserir" e PARA.
 *     O usuário confirma (clica "Confirmar").
 *   - BAIXA: navega para a busca de restrições e preenche o nº do processo +
 *     Pesquisar. O usuário seleciona e cancela.
 *
 * Estado semeado pelo background (renajud_estado): { ativo, operacao,
 *   numProcesso, executados:[{nome,cpfcnpj,tipoPessoa,polo}], config:{...} }.
 */

(function iniciarRenajud() {
  if (!/renajud\.pdpj\.jus\.br/.test(location.host)) return;
  console.log("CRATOS/RENAJUD(novo): content script ativo");

  /* Chave global liga/desliga: desligado, o CRATOS não age (nem fabrica folha nem
     dirige o fluxo). Cache lido no carregamento (os eventos do grampo chegam bem
     depois); o fluxo confere fresco com await. */
  let _cratosLigado = true;
  Store.ligada().then((v) => { _cratosLigado = v; }).catch(() => {});

  /* ═══════════════════════════════════════════════════════════════════════════
   * FOLHA FABRICADA A PARTIR DO JSON — no lugar da impressão nativa
   * ═══════════════════════════════════════════════════════════════════════════
   * O RENAJUD novo responde ao POST/DELETE de `/api/v1/veiculos/restricoes` com
   * tudo que a folha precisa. Grampeamos essa resposta (mesmo padrão do CENSEC:
   * script no CONTEXTO DA PÁGINA, CustomEvent com detail em STRING) e emitimos a
   * certidão pelo `gerarPDFTexto`.
   *
   * POR QUE ISTO É MELHOR QUE CLICAR "IMPRIMIR":
   *  · o nome do arquivo deixa de depender do `document.title`, que só ficava de
   *    pé por 6s — se o usuário demorasse a salvar, o nome saía errado
   *    (pendência conhecida do módulo, agora resolvida na raiz);
   *  · a extensão passa a TER OS BYTES, então o RENAJUD entra no diário da sessão
   *    e na certidão consolidada. Antes disto ele era invisível para a juntada —
   *    a mesma cegueira que a inclusão do CNIB teve até a 1.0.1;
   *  · PDF vetorial, no mesmo desenho das outras certidões.
   *
   * ⚠ É CERTIDÃO, NÃO É COMPROVANTE. A folha não é o documento emitido pelo
   * RENAJUD: é o servidor certificando o ato que praticou, com os dados que o
   * sistema devolveu. Título e texto dizem isso, e só se emite a partir de
   * resposta de SUCESSO — erro de servidor nunca vira certidão.
   */
  (function injetarGrampo() {
    try {
      const s = document.createElement("script");
      s.src = browser.runtime.getURL("conteudo/renajud-api.js");
      s.onload = () => s.remove();
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {
      console.warn("CRATOS/RENAJUD: não consegui injetar o grampo de API:", e.message);
    }
  })();

  /* Uma folha por ATO, não por carregamento de página: hoje o RENAJUD faz um
     executado por vez (dívida técnica nº 4), mas quando isso mudar a guarda
     precisa continuar valendo por operação, e não por aba. */
  const _folhasFeitas = new Set();

  /* MULTI-PARTE (11/09): o RENAJUD faz um executado por vez, mas o encadeamento
     das partes deixou de ser manual. O gatilho para o próximo executado é a
     FOLHA (certidão) do anterior — uma certidão por executado (todos os veículos
     num ato só), então folha = parte concluída. Estado do encadeamento: */
  const _avancados = new Set();       // índices de executados já concluídos (não avança 2x)
  let _idxAtual = -1;                 // índice do executado em que o fluxo parou (tem veículo)
  let _prepInclusaoTravada = false;   // trava o auto-preenchimento da inclusão; rearmado por parte

  document.addEventListener("cratos:renajud:restricao", (ev) => {
    if (!_cratosLigado) return;   // extensão desligada: não fabrica folha
    let env = null;
    try { env = JSON.parse(ev.detail); } catch (e) { return; }
    const metodo = String(env.metodo || "").toUpperCase();
    const status = Number(env.status || 0);

    /* Restrição inserida no RENAJUD ANTIGO (WEB) não sai pela baixa nova. Isto
       serve de ROTEAMENTO — não de conclusão sobre o ato. Texto de erro de
       servidor diz de ONDE vem a restrição; não diz o que houve com ela. */
    if (metodo === "DELETE" && status === 400 &&
        _norm(env.corpo).replace(/[^a-z0-9]/g, "").includes("renajudweb")) {
      /* A mensagem fala de ORIGEM e de CAMINHO. Não diz o que aconteceu com a
         restrição — o servidor recusou a via, não relatou o estado dela. */
      _faixa("alertar", "esta restrição tem origem no RENAJUD ANTIGO (WEB), e o " +
        "RENAJUD novo não opera sobre ela. Tente retirá-la pelo RENAJUD antigo; por " +
        "enquanto esse caminho é manual. Nada foi certificado.");
      return;
    }
    /* RESTRIÇÃO JÁ EXISTENTE (campo 11/09): a inclusão volta HTTP 400 (o WS
       retornou 422) com "Veículo já possui restrição Renajud do mesmo órgão,
       processo e tipo". Isto NÃO é falha técnica — é uma AFIRMAÇÃO de negócio: a
       constrição já está lançada. É a única exceção à regra "erro nunca vira
       certidão", e por isso está amarrada a ESTE texto (estável, sem acento). A
       certidão certifica a RESPOSTA DO SISTEMA (já existia), nunca uma inclusão
       feita agora. Depois de certificar, avança para o próximo executado —
       senão a cadeia travava exatamente aqui (o `status >= 300 return` engolia). */
    if (metodo === "POST" && status >= 400 &&
        _norm(env.corpo).replace(/[^a-z0-9]/g, "").includes("japossuirestricao")) {
      certificarRestricaoPreexistente()
        .catch((e) => console.warn("CRATOS/RENAJUD: certidão de preexistente falhou:", e.message));
      return;
    }
    /* ERRO INTERNO do RENAJUD (campo, 19/10): a retirada voltou com "Não foi possível
       realizar a operação. A execução do método RenajudWsClient#pesquisaRestricaoJudicial
       retornou o código HTTP 500. RENAJUD-WS (Erro Interno)… ID: <uuid>". Não é recusa:
       o serviço falhou ao localizar a restrição — o que costuma acontecer com restrição
       lançada no RENAJUD ANTIGO. A faixa orienta (Rodrigo: "tente retirar pelo antigo";
       no futuro o CRATOS abrirá o antigo sozinho) e repete o ID para o chamado. Mesma
       regra do RENAJUD-WEB: diz o que o SERVIDOR respondeu, nunca o estado da restrição. */
    if (metodo !== "GET" && status >= 300 && (_norm(env.corpo).replace(/[^a-z0-9]/g, "").includes("errointerno") ||
        /retornou o codigo http 5\d\d/.test(_norm(env.corpo)))) {
      const id = (String(env.corpo || "").match(/\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i) || [])[1];
      const ato = metodo === "DELETE" ? "à retirada" : metodo === "POST" ? "à inclusão" : "à operação";
      _faixa("alertar", "o RENAJUD respondeu com ERRO INTERNO " + ato + " (HTTP " + status + ") e não " +
        "confirmou nada. Nada foi certificado." + (metodo === "DELETE"
          ? " Esse erro costuma aparecer em restrição lançada no RENAJUD ANTIGO — tente retirá-la por lá."
          : " Tente de novo mais tarde.") + (id ? " ID de rastreabilidade: " + id : ""));
      return;
    }
    /* Qualquer OUTRO erro não vira certidão — mas também não some calado: vira
       faixa âmbar e a fila NÃO avança (não dá para ter certeza de que terminou).
       1.6.3: a faixa traz a MENSAGEM do servidor — antes você tinha de procurá-la na tela. */
    if (status >= 300) {
      /* 1.6.2: a BUSCA (GET) não é ato. Busca vazia que volte com erro HTTP não pode
         virar "recusou a operação" — quem lê o resultado da busca é a baixa, pela
         tela (aguardarResultadoBaixa). A faixa fica só para inclusão e retirada. */
      if (metodo === "GET") return;
      const msgServidor = _mensagemDoServidor(env.corpo);
      _faixa("alertar", "o RENAJUD recusou a operação (HTTP " + status + ")" +
        (msgServidor ? ": “" + msgServidor + "”" : "") + ". Nada foi " +
        "certificado; confira na tela e, se for o caso, refaça esta parte.");
      return;
    }

    let dados = null;
    try { dados = JSON.parse(env.corpo); } catch (e) { return; }
    if (!dados || !dados.dadosProcesso || !dados.veiculos) return;   // GET da busca

    if (metodo === "POST") fabricarFolha(dados, "inclusao");
    else if (metodo === "DELETE") fabricarFolha(dados, "baixa");
  });

  /* Mensagem legível do corpo de erro: JSON (message/mensagem/detail/erro) ou texto
     sem marcação, cortado — vai para a faixa, que é texto (sem HTML). */
  function _mensagemDoServidor(corpo) {
    const bruto = String(corpo || "");
    let msg = "";
    try {
      const j = JSON.parse(bruto);
      const cand = j && (j.message || j.mensagem || j.detail || j.erro || j.error ||
        (Array.isArray(j.errors) && j.errors[0] && (j.errors[0].message || j.errors[0])));
      if (typeof cand === "string") msg = cand;
    } catch (e) {
      msg = bruto.replace(/<[^>]*>/g, " ");
    }
    msg = msg.replace(/\s+/g, " ").trim();
    return msg.length > 220 ? msg.slice(0, 217) + "…" : msg;
  }

  function _faixa(nivel, texto) {
    try {
      /* 1.6.2: CratosFaixa.<nível>(MÓDULO, texto). Antes ia só o texto — ele virava o
         "módulo" e a faixa saía como "CRATOS — undefined" (folha emitida, restrição
         do RENAJUD antigo, recusa da operação). */
      if (typeof CratosFaixa !== "undefined" && CratosFaixa[nivel]) return CratosFaixa[nivel]("renajud", texto);
    } catch (e) {}
    console.log("CRATOS/RENAJUD:", texto);
  }

  async function fabricarFolha(dados, operacao) {
    const dp = dados.dadosProcesso || {};
    const org = dp.orgao || {};
    const veics = Array.isArray(dados.veiculos) ? dados.veiculos : [];

    let est = {};
    try { est = (await Store.get("renajud_estado")) || {}; } catch (e) {}
    /* A baixa NÃO traz numeroProcesso no corpo — cai no estado. */
    const proc = _formatarProc(dp.numeroProcesso || est.numProcesso || "");
    const chave = operacao + "|" + soDigitos(proc) + "|" + veics.map((v) => v.placa).join(",");
    if (_folhasFeitas.has(chave)) return;
    _folhasFeitas.add(chave);

    const ehBaixa = operacao === "baixa";
    const ok = veics.filter((v) => !v.mensagemErro);
    const comErro = veics.filter((v) => v.mensagemErro);

    const linhas = [
      "",
      "Tribunal: " + ((org.tribunal || {}).nome || ""),
      "Órgão Judiciário: " + (org.nome || ""),
      (ehBaixa ? "Restrição retirada por: " : "Restrição incluída por: ") +
        ((dp.magistrado || {}).nome || ""),
      "Processo: " + proc,
      "Data: " + _dataBR(),
      "",
    ];
    if (ok.length) {
      linhas.push(ehBaixa ? "Veículos com restrição RETIRADA:" : "Veículos com restrição INCLUÍDA:");
      linhas.push("");
      ok.forEach((v, i) => {
        linhas.push((i + 1) + ") " + v.placa + " - " + (v.marcaModelo || "") +
          " - " + ((v.proprietario || {}).nome || "") +
          (v.tipoRestricao ? " - " + v.tipoRestricao : ""));
      });
      linhas.push("");
    }
    /* Veículo que falhou vai em BLOCO SEPARADO, nunca na mesma lista dos que
       deram certo: uma lista só, sob um título que afirma inclusão, seria um
       documento se contradizendo. */
    if (comErro.length) {
      linhas.push(ehBaixa ? "Veículos em que a retirada NÃO se efetivou:"
                          : "Veículos em que a inclusão NÃO se efetivou:");
      linhas.push("");
      comErro.forEach((v, i) => {
        linhas.push((i + 1) + ") " + v.placa + " - " + (v.marcaModelo || "") +
          " - motivo informado pelo sistema: " + v.mensagemErro);
      });
      linhas.push("");
    }
    linhas.push("Certidão emitida a partir da resposta do RENAJUD a esta operação.");
    /* STI, 21/08: sem "Emitido pelo sistema CRATOS" enquanto não homologar. */

    const prop = ((ok[0] || veics[0] || {}).proprietario || {});
    const parte = _primeirosDois(prop.nome || "");
    /* Ordinal da executada no nome (1E, 2E…) — duas partes homônimas de documentos
       diferentes gerariam o MESMO nome, e o Cofre (que guarda por nome)
       sobrescreveria uma folha pela outra na juntada. O ordinal torna cada folha
       única. (Campo, 03-04/09.) */
    const ne = _rotuloExec(est, prop.documento);
    const sufixo = ehBaixa ? "RENAJUD Baixa" : "RENAJUD Inclusao";
    const filename = "CRATOS/" + soDigitos(proc) +
      (ne ? "_" + ne : "") + (parte ? "_" + parte : "") + " " + sufixo + ".pdf";
    const titulo = ehBaixa ? "CERTIDÃO DE RETIRADA DE RESTRIÇÃO VEICULAR"
                           : "CERTIDÃO DE INCLUSÃO DE RESTRIÇÃO VEICULAR";

    try {
      /* numProcesso/convenio/operacao NÃO são enfeite: sem os três o
         `fabricar_pdf` baixa o arquivo e NÃO registra no diário — a folha
         nasceria invisível para a certidão consolidada e para a juntada, que é
         justamente o ganho desta mudança. */
      await browser.runtime.sendMessage({
        tipo: "fabricar_pdf", titulo, linhas, filename,
        convenio: "RENAJUD",
        numProcesso: est.numProcesso || soDigitos(proc),
        operacao: ehBaixa ? "baixa" : "inclusao",
        detalhe: veics.length + " veículo(s)",
      });
      _faixa("dizer", "folha do RENAJUD emitida: " + filename.split("/").pop());
      console.log("CRATOS/RENAJUD: folha (" + operacao + ") fabricada ->", filename);
      /* Fecha o popup de comprovante que o RENAJUD abre depois da restrição — ele
         é MODAL e trava a tela, impedindo a próxima parte. A folha já veio do
         grampo; fechamos pelo X, nunca pelo "Imprimir". */
      await fecharPopupComprovante();

      /* ENCADEAMENTO DAS PARTES (só inclusão): esta folha é a certidão da parte
         que você acabou de incluir — o gatilho para o CRATOS pesquisar sozinho o
         PRÓXIMO executado. Descobre qual parte terminou pelo DOCUMENTO do
         proprietário na resposta (com _idxAtual de reserva), e avança para a
         seguinte. A baixa não é por parte (busca por processo), então fica de
         fora. Dívida técnica nº 4 quitada. */
      if (!ehBaixa) {
        let i = _indexExec(est, prop.documento);
        if (i < 0) i = _idxAtual;
        if (i >= 0 && !_avancados.has(i)) {
          _avancados.add(i);
          avancarParaProximoExecutado(est, i + 1)
            .catch((err) => console.warn("CRATOS/RENAJUD: avanço p/ próximo executado falhou:", err.message));
        }
      }
    } catch (e) {
      _folhasFeitas.delete(chave);   // deixa tentar de novo
      _faixa("alertar", "não consegui emitir a folha do RENAJUD (" + (e.message || e) +
        "). Use o 'Imprimir' da própria tela para salvar o comprovante.");
      /* NÃO emite pulso de conclusão: o RENAJUD faz um executado por vez, MANUAL
         (dívida técnica nº 4), então uma folha (ou a falta dela) NÃO é o fim do
         convênio. Aqui ele conclui pelo BOTÃO — quem sabe que terminou as partes
         é o usuário. Emitir daqui avançaria a fila no meio das partes. */
    }
  }

  /* Fecha o modal de comprovante do RENAJUD (o que tem "Imprimir" no rodapé).
     ⛔ CLICA NO X (`.btn-close` do header), NUNCA no "Imprimir": a folha já foi
     fabricada pelo grampo, e o "Imprimir" abriria o diálogo nativo (o que a gente
     justamente substituiu). Reconhece o modal certo pela ASSINATURA — um modal
     com botão "Imprimir" no rodapé E um `.btn-close` no header —, para não fechar
     por engano outro diálogo do site. */
  async function fecharPopupComprovante() {
    try {
      const achar = () => {
        for (const mc of document.querySelectorAll(".modal-content")) {
          const temImprimir = Array.from(mc.querySelectorAll("button"))
            .some((b) => /^\s*imprimir\s*$/i.test(b.textContent || ""));
          const x = mc.querySelector('.modal-header .btn-close, .btn-close[aria-label="Close"]');
          if (temImprimir && x) return x;
        }
        return null;
      };
      const x = await esperar(() => achar(), 8000);
      if (!x) { console.warn("CRATOS/RENAJUD: popup de comprovante não apareceu para fechar."); return false; }
      x.click();
      _faixa("dizer", "comprovante fechado — a tela está livre para a próxima parte.");
      console.log("CRATOS/RENAJUD: popup de comprovante fechado pelo X (btn-close).");
      return true;
    } catch (e) {
      console.warn("CRATOS/RENAJUD: erro ao fechar o popup de comprovante:", e.message);
      return false;
    }
  }

  // "00000012320255180008" -> "0000001-23.2025.5.18.0008"
  function _formatarProc(n) {
    const d = String(n || "").replace(/\D/g, "");
    if (d.length !== 20) return String(n || "");
    return d.slice(0, 7) + "-" + d.slice(7, 9) + "." + d.slice(9, 13) + "." +
           d.slice(13, 14) + "." + d.slice(14, 16) + "." + d.slice(16, 20);
  }

  Store.get("renajud_estado").then(async (est) => {
    if (!(await Store.ligada())) { console.log("CRATOS/RENAJUD: extensão desligada — não vou agir."); return; }
    if (!est || !est.ativo) {
      console.debug("CRATOS/RENAJUD: sem estado ativo — ignorando.");
      return;
    }
    iniciarFluxo(est).catch((e) => console.error("CRATOS/RENAJUD:", e.message));
  }).catch((e) => console.warn("CRATOS/RENAJUD: erro ao ler estado:", e.message));

  async function iniciarFluxo(est) {
    // Guarda nível 1: se o maisPJe está injetado nesta página, o CRATOS se
    // contém — os dois dirigindo a mesma tela conflitam (ex.: HTTP 400). Cede.
    if (await detectarMaisPje()) {
      console.warn("CRATOS/RENAJUD: maisPJe detectado nesta página. Para evitar " +
        "conflito, o CRATOS NÃO vai agir. Desative o maisPJe (ou use um perfil " +
        "separado do Firefox) e execute novamente.");
      return;
    }

    const rota = est.operacao === "baixa"
      ? "/veiculo/restricao/pesquisa"
      : "/veiculo/pesquisa";

    // 1) Detecção do passo por ROTA (URL) — sinal mais confiável — com o
    //    componente como reforço, e um poll de segurança (troca de rota SPA nem
    //    sempre gera mutação observável). Rotas:
    //      inclusão -> /veiculo/restricao/inclusao
    //      baixa    -> /veiculo/restricao/pesquisa
    //    OBS: o componente de inclusão tem TYPO no RENAJUD ('app-veiuclo-...').
    let feitoPesquisa = false, feitoExclusao = false;
    const SEL_INCLUSAO = "app-veiuclo-restricao-inclusao, app-veiculo-restricao-inclusao";
    const SEL_PESQUISA = "app-veiculo-restricao-pesquisa, app-veiculo-pesquisa, app-veiuclo-pesquisa";
    const SEL_EXCLUSAO = "app-veiculo-restricao-exclusao, app-veiuclo-restricao-exclusao";
    const pararObs = () => { obs.disconnect(); clearInterval(poll); };
    const verificar = () => {
      const path = location.pathname;
      if (est.operacao === "inclusao") {
        /* MULTI-PARTE: NÃO é one-shot. O observer segue vivo a operação inteira;
           _prepInclusaoTravada garante UM preenchimento por parte e é rearmado
           quando o CRATOS avança para o próximo executado. Antes, o pararObs()
           aqui matava o watcher na 1ª parte — e a 2ª nunca era preparada. */
        if (!_prepInclusaoTravada && (path.includes("/restricao/inclusao") || document.querySelector(SEL_INCLUSAO))) {
          _prepInclusaoTravada = true; prepararInclusao(est);
        }
      } else if (est.operacao === "baixa") {
        // Fase 2 (retirar): tela de exclusão — prioridade e encerra o watcher.
        if (!feitoExclusao && (path.includes("/restricao/exclusao") || document.querySelector(SEL_EXCLUSAO))) {
          feitoExclusao = true; pararObs(); prepararExclusao(est);
        } else if (!feitoPesquisa && (path.includes("/restricao/pesquisa") || document.querySelector(SEL_PESQUISA))) {
          // Fase 1 (busca): NÃO encerra — ainda esperamos a tela de exclusão.
          feitoPesquisa = true; prepararBaixa(est);
        }
      }
    };
    const obs = new MutationObserver(verificar);
    obs.observe(document.body, { childList: true, subtree: true });
    const poll = setInterval(verificar, 500);
    setTimeout(() => { obs.disconnect(); clearInterval(poll); }, 10 * 60 * 1000);

    // 2) Navega in-app pelo routerLink (o app já está logado; reusa a aba).
    const link = await esperar(() => document.querySelector(`a[routerlink="${rota}"]`), 20000);
    if (!link) {
      console.warn("CRATOS/RENAJUD: link", rota, "não encontrado (logado? app carregado?).");
      return;
    }
    link.click();

    // 3) INCLUSÃO: já preenche o CPF/CNPJ do 1º executado e Pesquisa. O componente
    //    de inclusão aparece depois (quando o usuário for incluir a restrição) e o
    //    observer chama prepararInclusao().  (multi-parte = melhoria futura)
    if (est.operacao === "inclusao") {
      const execs = est.executados || [];
      if (!execs.length) {
        return CratosFaixa.parar("renajud",
          "nenhum executado com CPF/CNPJ veio marcado no painel, e é o executado " +
          "que recebe a restrição. Marque a parte no painel do PJe e execute de novo.");
      }
      // Espera o form de pesquisa montar de fato (documentoIdentificacao E
      // numeroProcesso existirem) — senão o RENAJUD estoura 'controls.
      // numeroProcesso is undefined' ao validar o Pesquisar (form ainda montando
      // logo após o SSO).
      await esperar(() => document.querySelector('input[id="documentoIdentificacao"]'), 20000);
      await esperar(() => document.querySelector('input[id="numeroProcesso"]'), 10000);
      try { await Store.set("renajud_exec_veiculo", ""); } catch (e) {}
      await buscarExecutadoComVeiculo(est, 0);
    }
    // BAIXA: o routerLink leva à busca; o observer pega o componente de pesquisa.

    // Segurança: checa se o passo já está presente (rota já aberta).
    verificar();
  }

  // ── INCLUSÃO (preparar) ────────────────────────────────────────────────────
  async function prepararInclusao(est) {
    if (maisPjePresente()) {
      /* Não é falha: é convivência. Duas extensões preenchendo o mesmo
         formulário brigam e o resultado é imprevisível — o CRATOS sai. Mas sair
         calado faz parecer que ele não funciona. */
      return CratosFaixa.alertar("renajud",
        "o maisPJe está nesta tela e assumiu o preenchimento — o CRATOS saiu de " +
        "cena para os dois não brigarem pelo mesmo formulário.");
    }
    const c = est.config || {};
    console.log("CRATOS/RENAJUD: preparando inclusão de restrição.");
    // Espera o form da inclusão montar (campos de restrição + Dados do Processo).
    await esperar(() => document.querySelector('#ramoJustica input') || acharLabelExato("Transferência"), 15000);

    // Tipos de restrição: marca o checkbox de cada tipo escolhido (por label exato).
    const tipos = Array.isArray(c.tipoRestricao)
      ? c.tipoRestricao : (c.tipoRestricao ? [c.tipoRestricao] : []);
    for (const t of tipos) {
      const ok = await esperar(() => (marcarPorLabel(t) ? true : null), 6000);
      if (!ok) console.warn("CRATOS/RENAJUD: tipo de restrição não encontrado:", t);
      await sleep(200);
    }

    // Campos typeahead: digita e SELECIONA A OPÇÃO EXATA do dropdown (evita casar
    // 'OITAVA' dentro de 'DÉCIMA OITAVA'); só cai no Enter se não houver exata.
    await preencherEscolha('#ramoJustica input', c.ramoJustica || "JUSTICA DO TRABALHO"); await sleep(500);
    if (c.tribunal)   { await preencherEscolha('#tribunal input', c.tribunal); await sleep(500); }
    if (c.orgao)      { await preencherEscolha('#orgao input', c.orgao); await sleep(500); }
    // Nº do processo: OBRIGATÓRIO nesta tela de inclusão (seção "Dados do
    // Processo"). O "não lançar processo" de antes valia só para a tela de BUSCA
    // (que pesquisa por CPF/CNPJ). Aqui vai só os dígitos (padrão do maisPJe).
    await preencher('input[id="numeroProcesso"]', soDigitos(est.numProcesso)); await sleep(500);
    if (c.magistrado) { await preencherEscolha('#documentoMagistrado input', c.magistrado); await sleep(500); }

    // PREPARAR: aciona "Inserir" e PARA. Confirmação é do usuário.
    await clicar("button", "Inserir");
    console.log("CRATOS/RENAJUD: campos preenchidos e 'Inserir' acionado. " +
                "Confira e clique 'Confirmar'. Depois volte ao PJe e clique 'Concluí'.");
    /* A impressão nativa saiu daqui: quem produz o documento agora é o grampo de
       API, quando o RENAJUD responder ao POST da inclusão. Manter as duas coisas
       ligadas ao mesmo tempo geraria folha em duplicidade. */
  }

  // ── BAIXA (preparar) ───────────────────────────────────────────────────────
  async function prepararBaixa(est) {
    if (maisPjePresente()) {
      return CratosFaixa.alertar("renajud",
        "o maisPJe está nesta tela e assumiu o preenchimento — o CRATOS saiu de " +
        "cena para os dois não brigarem pelo mesmo formulário.");
    }
    console.log("CRATOS/RENAJUD: preparando busca para baixa.");
    const inp = await esperar(() => document.querySelector('input[id="numeroProcesso"]'), 15000);
    if (!inp) {
      return CratosFaixa.parar("renajud",
        "a tela de baixa do RENAJUD não carregou o campo do número do processo " +
        "em 15 segundos. Se a sua sessão caiu, entre de novo e execute outra vez.");
    }
    // "Limpar" inicializa o form (mesma robustez da inclusão): sem isso, o
    // preencher roda antes do reactive form montar e o valor não fixa.
    await clicar("button", "Limpar");
    await sleep(600);
    /* 1.6.2: confere que o número FIXOU antes de pesquisar. Com o campo vazio o
       RENAJUD responde "Necessário informar pelo menos um parâmetro de pesquisa" —
       e uma busca que não aconteceu não pode virar certidão de coisa nenhuma. */
    let fixou = false;
    for (let i = 0; i < 3 && !fixou; i++) {
      await esperar(() => document.querySelector('input[id="numeroProcesso"]'), 8000);
      colarComMascara('input[id="numeroProcesso"]', est.numProcesso);
      await sleep(400);
      const campo = document.querySelector('input[id="numeroProcesso"]');
      fixou = !!campo && soDigitos(campo.value) === soDigitos(est.numProcesso);
      if (!fixou) await sleep(600);
    }
    if (!fixou) {
      return CratosFaixa.parar("renajud",
        "o número do processo não fixou no campo de busca da baixa (3 tentativas). Nada foi " +
        "pesquisado nem certificado. Preencha à mão e clique em Pesquisar.");
    }
    const vazioAntes = alertaNenhumaRestricao();
    await clicar("button", "Pesquisar");
    const desfecho = await aguardarResultadoBaixa(vazioAntes);
    return concluirBuscaBaixa(est, desfecho);
  }

  /* ═══ RESULTADO DA BUSCA DA BAIXA (1.6.2) ═══
   * Print do Rodrigo (19/10): sem restrição, o componente de pesquisa mostra
   * <div class="alert alert-secondary" role="alert">Nenhuma restrição encontrada</div>.
   * Três desfechos: "tabela" (há restrição — segue como sempre, a retirada é sua),
   * "vazio" (certidão de nada a retirar) e "outro"/"timeout" (faixa, nunca certidão). */
  function alertaNenhumaRestricao() {
    const raiz = document.querySelector("app-veiculo-restricao-pesquisa") || document;
    return Array.from(raiz.querySelectorAll('.alert, [role="alert"]'))
      .some((a) => _norm(a.textContent).includes("nenhuma restricao encontrada"));
  }

  /* Página INTEIRA, de propósito: se a lista de restrições renderizar fora do
     componente de pesquisa, perder a tabela daria alarme falso justo quando HÁ
     restrição. (O "Limpar" antes do Pesquisar tira resultado velho.) */
  function tabelaDeRestricoes() {
    return Array.from(document.querySelectorAll("table")).some((t) =>
      Array.from(t.querySelectorAll("tbody tr")).some((tr) => tr.querySelector("td")));
  }

  function aguardarResultadoBaixa(vazioAntes, timeout) {
    const limite = timeout || 20000;
    return new Promise((resolve) => {
      const t0 = Date.now();
      let sumiu = !vazioAntes;          // aviso velho na tela: só vale depois de sumir e voltar
      const tick = () => {
        if (tabelaDeRestricoes()) return resolve({ tipo: "tabela" });
        const vazio = alertaNenhumaRestricao();
        if (!vazio) sumiu = true;
        if (vazio && sumiu && Date.now() - t0 > 600) return resolve({ tipo: "vazio" });
        const corpo = _norm(document.body ? document.body.textContent : "");
        if (corpo.includes("necessario informar pelo menos um parametro")) {
          return resolve({ tipo: "outro", msg: "Necessário informar pelo menos um parâmetro de pesquisa" });
        }
        if (Date.now() - t0 > limite) return resolve({ tipo: "timeout" });
        setTimeout(tick, 300);
      };
      tick();
    });
  }

  async function concluirBuscaBaixa(est, desfecho) {
    const tipo = desfecho && desfecho.tipo;
    if (tipo === "tabela") {
      console.log("CRATOS/RENAJUD: busca preenchida (proc " + est.numProcesso + "). " +
                  "Selecione a(s) restrição(ões) e vá em 'Retirar'.");
      return "tabela";
    }
    if (tipo === "vazio") {
      const r = await fabricarCertidaoNadaARetirar(est);
      try {
        await Store.set("renajud_estado", Object.assign({}, est, { ativo: false, fase: "nada_a_retirar" }));
      } catch (e) {}
      if (!r.ok) {
        CratosFaixa.alertar("renajud", "o RENAJUD não encontrou restrição deste processo, mas não " +
          "consegui gerar a certidão (" + r.motivo + ").");
        return "vazio_sem_certidao";
      }
      /* Pulso TERMINAL: a baixa do RENAJUD espera uma folha por executado; aqui não
         há retirada, há UMA certidão — o painel segue por este sinal. */
      try {
        await Store.set("orq_conv_feito", {
          convenio: "RENAJUD", numProcesso: est.numProcesso, operacao: "baixa", ok: true, em: Date.now(),
        });
      } catch (e) {}
      _faixa("dizer", "nenhuma restrição deste processo no RENAJUD — nada a retirar.\nCertidão gerada: " + r.filename);
      return "vazio";
    }
    CratosFaixa.alertar("renajud", (tipo === "outro"
      ? "o RENAJUD respondeu “" + desfecho.msg + "” à busca"
      : "a busca da baixa não trouxe resultado que eu reconheça em 20 segundos") +
      ". NADA foi certificado — confira a tela.");
    return tipo || "timeout";
  }

  function fabricarCertidaoNadaARetirar(est) {
    const proc = soDigitos(est.numProcesso);
    const filename = "CRATOS/" + proc + " RENAJUD Baixa (nada a retirar).pdf";
    const linhas = [
      "",
      "Certifico e dou fé que, nesta data (" + _dataBR() + "), procedi à pesquisa, no RENAJUD - " +
        "Restrições Judiciais Sobre Veículos Automotores, de restrições judiciais vinculadas ao " +
        "processo nº " + est.numProcesso + ", para fins de retirada, e que o sistema informou: " +
        "“Nenhuma restrição encontrada”. Não há, portanto, restrição veicular ativa a retirar.",
      "",
      "Era o que me cumpria certificar.",
    ];
    return browser.runtime.sendMessage({
      tipo: "fabricar_pdf",
      convenio: "RENAJUD",
      numProcesso: est.numProcesso,
      operacao: "baixa",
      detalhe: "nada_a_cancelar",
      titulo: "CERTIDÃO DE PESQUISA NO RENAJUD — NADA A RETIRAR",
      linhas,
      filename,
    }).then((r) => ({ ok: !r || r.ok !== false, filename, motivo: r && r.erro }))
      .catch(() => ({ ok: true, filename }));   // Promise rejeita no FF mesmo baixando
  }

  // Fase 2 da baixa: tela de exclusão (/veiculo/restricao/exclusao). Preenche os
  // "Dados do Processo" (mesmos campos da inclusão) e PARA — o 'Retirar' + a
  // confirmação são do usuário.
  async function prepararExclusao(est) {
    if (maisPjePresente()) {
      return CratosFaixa.alertar("renajud",
        "o maisPJe está nesta tela e assumiu o preenchimento — o CRATOS saiu de " +
        "cena para os dois não brigarem pelo mesmo formulário.");
    }
    const c = est.config || {};
    console.log("CRATOS/RENAJUD: preparando retirada — preenchendo Dados do Processo.");
    await esperar(() => document.querySelector('#ramoJustica input'), 15000);
    await preencherEscolha('#ramoJustica input', c.ramoJustica || "JUSTICA DO TRABALHO"); await sleep(500);
    if (c.tribunal)   { await preencherEscolha('#tribunal input', c.tribunal); await sleep(500); }
    if (c.orgao)      { await preencherEscolha('#orgao input', c.orgao); await sleep(500); }
    colarComMascara('input[id="numeroProcesso"]', est.numProcesso); await sleep(500);
    if (c.magistrado) { await preencherEscolha('#documentoMagistrado input', c.magistrado); await sleep(500); }
    console.log("CRATOS/RENAJUD: Dados do Processo preenchidos. Confira e clique 'Retirar'.");
    /* Idem baixa: a folha vem do grampo, na resposta do DELETE. */
  }

  // Lê o "Proprietário" da tabela de restrições (tela de exclusão) — 1ª linha.
  function _proprietarioNaTela() {
    for (const table of document.querySelectorAll("table")) {
      const ths = table.querySelectorAll("th");
      let idx = -1;
      ths.forEach((th, i) => { if (_norm(th.textContent).includes("proprietario")) idx = i; });
      if (idx < 0) continue;
      const linha = table.querySelector("tbody tr") ||
        Array.from(table.querySelectorAll("tr")).find((tr) => tr.querySelector("td"));
      const tds = linha ? linha.querySelectorAll("td") : [];
      if (tds[idx]) return (tds[idx].textContent || "").replace(/\s+/g, " ").trim();
    }
    return "";
  }

  // Primeiros dois "nomes" (palavras) — ex.: "EMPRESA EXEMPLO IND LTDA" -> "EMPRESA EXEMPLO".
  function _primeirosDois(nome) {
    return String(nome || "").trim().split(/\s+/).slice(0, 2).join(" ");
  }

  /* Ordinal da executada ("1E", "2E"…) pela posição em est.executados, casando
     pelo documento. Fallback: os dígitos do próprio documento (também únicos) se
     a parte não estiver na lista — melhor um nome feio do que dois arquivos que
     colidem e um some da juntada. */
  function _rotuloExec(est, doc) {
    const d = String(doc || "").replace(/\D/g, "");
    const i = _indexExec(est, d);
    if (i >= 0) return (i + 1) + "E";
    return d || "";
  }

  /* Índice do executado (em est.executados) que casa com o documento; -1 se não
     estiver na lista. É o que liga a folha (que traz o documento do proprietário)
     à parte certa, para avançar para a SEGUINTE — não para a errada. */
  function _indexExec(est, doc) {
    const d = String(doc || "").replace(/\D/g, "");
    if (!d) return -1;
    const execs = (est && est.executados) || [];
    return execs.findIndex((e) => String(e.cpfcnpj || "").replace(/\D/g, "") === d);
  }

  /* Avança o fluxo de INCLUSÃO para o próximo executado: volta à tela de pesquisa
     por CPF/CNPJ (o app pode estar na tela de inclusão depois do ato), rearma o
     auto-preenchimento da inclusão e pesquisa a próxima parte. Se não houver
     próxima, não faz nada: o painel avança sozinho ao contar as folhas (uma por
     executado). */
  async function avancarParaProximoExecutado(est, proxIdx) {
    const execs = (est && est.executados) || [];
    if (proxIdx >= execs.length) {
      console.log("CRATOS/RENAJUD: todos os executados foram processados.");
      return;
    }
    const link = await esperar(() => document.querySelector('a[routerlink="/veiculo/pesquisa"]'), 15000);
    if (link) link.click();
    const campo = await esperar(() => document.querySelector('input[id="documentoIdentificacao"]'), 15000);
    if (!campo) {
      return _faixa("alertar",
        "incluí a restrição da parte anterior, mas não consegui voltar à tela de " +
        "pesquisa para o próximo executado. Pesquise a próxima parte manualmente, " +
        "ou use 'Pular para o próximo' no painel.");
    }
    _prepInclusaoTravada = false;   // a próxima parte volta a ter auto-preenchimento na inclusão
    await buscarExecutadoComVeiculo(est, proxIdx);
  }

  /* Emite a certidão de RESTRIÇÃO PREEXISTENTE para o executado em que o fluxo
     parou (_idxAtual) e avança para o próximo. Certifica a resposta do sistema
     ("já possui restrição"), NÃO uma inclusão feita agora. Nível da parte (sem
     placa): já é verdadeiro e útil; a placa exigiria ler a tela/grampear a busca
     e tem a ambiguidade de qual veículo. Conta como folha (entra no diário e o
     painel soma), então a fila fecha sozinha. */
  async function certificarRestricaoPreexistente() {
    let est = {};
    try { est = (await Store.get("renajud_estado")) || {}; } catch (e) {}
    const execs = est.executados || [];
    const exec = (_idxAtual >= 0 && _idxAtual < execs.length) ? execs[_idxAtual] : null;
    if (!exec) {
      return _faixa("alertar",
        "o RENAJUD informou que o veículo já possui esta restrição, mas não consegui " +
        "identificar o executado para certificar. Confira na tela.");
    }
    if (_avancados.has(_idxAtual)) return;   // duplicata (grampo vê fetch E XHR)
    _avancados.add(_idxAtual);

    const proc = String(est.numProcesso || "").replace(/\D/g, "");
    const nomeArq = _primeirosDois(String(exec.nome || "").replace(/[\/\\:*?"<>|]/g, "").trim());
    const ne = _rotuloExec(est, exec.cpfcnpj);
    const filename = "CRATOS/" + proc + (ne ? "_" + ne : "") + "_" + nomeArq +
      " RENAJUD Restricao Preexistente.pdf";
    const doc = _formatarDoc(exec.cpfcnpj);
    const c = est.config || {};
    const tipos = Array.isArray(c.tipoRestricao) ? c.tipoRestricao.join(", ") : (c.tipoRestricao || "");
    const linhas = [
      "",
      "Certifico e dou fé que, nesta data (" + _dataBR() + "), ao proceder à inclusão de " +
        "restrição" + (tipos ? " de " + tipos : "") + " no RENAJUD - Restrições Judiciais Sobre " +
        "Veículos Automotores, em nome de " + exec.nome + ", inscrito(a) no CPF/CNPJ sob o nº " +
        doc + ", no processo nº " + _formatarProc(proc) + ", o sistema informou que o veículo " +
        "já possui restrição Renajud do mesmo órgão, processo e tipo.",
      "",
      "Certifico, portanto, que a restrição pretendida já se encontra lançada.",
      "",
      "Era o que me cumpria certificar.",
      /* STI, 21/08: sem "Emitido pelo sistema CRATOS" enquanto não homologar. */
    ];
    try {
      await browser.runtime.sendMessage({
        tipo: "fabricar_pdf",
        convenio: "RENAJUD",
        numProcesso: est.numProcesso || proc,
        operacao: "inclusao",
        titulo: "CERTIDÃO DE RESTRIÇÃO PREEXISTENTE NO RENAJUD",
        linhas, filename,
        detalhe: "restrição preexistente",
      });
      _faixa("dizer", "o veículo já possuía esta restrição deste processo — emiti a certidão " +
        "de restrição preexistente e segui para o próximo executado.");
      console.log("CRATOS/RENAJUD: certidão de restrição preexistente ->", filename);
    } catch (e) {
      _avancados.delete(_idxAtual);   // deixa tentar de novo
      return _faixa("alertar", "o veículo já possuía esta restrição, mas não consegui emitir a " +
        "certidão (" + (e.message || e) + "). Confira na tela.");
    }
    await avancarParaProximoExecutado(est, _idxAtual + 1);
  }

  // ── Helpers (autocontidos; método de preenchimento fiel ao maisPJe) ─────────
  function esperar(fn, timeoutMs = 20000) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const tick = () => {
        let el = null; try { el = fn(); } catch (e) {}
        if (el) return resolve(el);
        if (Date.now() - t0 > timeoutMs) return resolve(null);
        setTimeout(tick, 200);
      };
      tick();
    });
  }

  function _resolver(seletorOuEl) {
    return (seletorOuEl instanceof HTMLElement) ? seletorOuEl : document.querySelector(seletorOuEl);
  }

  // setter nativo + input/change/keyup + ENTER (fixa typeahead) + blur.
  async function preencher(seletorOuEl, valor) {
    const el = _resolver(seletorOuEl);
    if (!el) { console.warn("CRATOS/RENAJUD: input não encontrado:", seletorOuEl); return false; }
    el.focus();
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, valor == null ? "" : String(valor));
    for (const t of ["input", "change", "keyup"]) el.dispatchEvent(new Event(t, { bubbles: true }));
    _tecla(el, "Enter", 13);
    el.blur();
    return true;
  }

  async function clicar(seletorOuEl, texto) {
    let el = (seletorOuEl instanceof HTMLElement) ? seletorOuEl : null;
    if (!el) el = await esperar(() => _acharPorTexto(seletorOuEl, texto), 12000);
    if (!el) { console.warn("CRATOS/RENAJUD: botão não encontrado:", seletorOuEl, texto || ""); return false; }
    if (el.hasAttribute("disabled")) { await sleep(300); }
    el.click();
    return true;
  }

  function _acharPorTexto(seletor, texto) {
    const cands = document.querySelectorAll(seletor || "button");
    if (!texto) return cands[0] || null;
    const alvo = String(texto).trim().toLowerCase();
    for (const c of cands) {
      if ((c.textContent || "").trim().toLowerCase() === alvo) return c;
    }
    // fallback: contém o texto
    for (const c of cands) {
      if ((c.textContent || "").trim().toLowerCase().includes(alvo)) return c;
    }
    return null;
  }

  function acharLabel(texto) {
    const alvo = String(texto).trim().toLowerCase();
    for (const l of document.querySelectorAll("label")) {
      if ((l.textContent || "").trim().toLowerCase() === alvo) return l;
    }
    for (const l of document.querySelectorAll("label")) {
      if ((l.textContent || "").trim().toLowerCase().includes(alvo)) return l;
    }
    return null;
  }

  function _tecla(el, key, keyCode) {
    for (const type of ["keydown", "keypress", "keyup"]) {
      el.dispatchEvent(new KeyboardEvent(type, { key, keyCode, which: keyCode, bubbles: true }));
    }
  }

  function soDigitos(s) { return String(s || "").replace(/\D/g, ""); }
  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  // Campo com máscara Angular (ngx-mask, ex.: numeroProcesso da baixa) só aceita
  // EVENTO DE PASTE REAL (ClipboardEvent + DataTransfer) — .value/eventos comuns
  // falham. Mesmo método comprovado do "Valor da obrigação" do SAB.
  function colarComMascara(seletorOuEl, valor) {
    const el = _resolver(seletorOuEl);
    if (!el) { console.warn("CRATOS/RENAJUD: campo mascarado não encontrado:", seletorOuEl); return false; }
    const v = String(valor == null ? "" : valor).trim();
    el.focus();
    try { el.select(); } catch (e) {}
    const dt = new DataTransfer();
    dt.setData("text/plain", v);
    const pasteEvent = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt });
    const aceitou = !el.dispatchEvent(pasteEvent);
    if (!aceitou || !el.value) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(el, v);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste", data: v }));
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
    console.log("CRATOS/RENAJUD: campo mascarado ->", el.value);
    return true;
  }

  // ── Guarda nível 1: detecção do maisPJe na página ───────────────────────────
  // O maisPJe deixa marcas próprias no DOM (menu Kaizen, tooltips, atributo maisPje).
  function maisPjePresente() {
    return !!(
      document.querySelector('menumaispje') ||
      document.querySelector('[id^="maisPje"]') ||
      document.querySelector('[id^="maisPJe"]') ||
      document.querySelector('[maisPje]')   // atributo é case-insensitive no HTML
    );
  }
  // checa agora e de novo após um instante (o menu do maisPJe é injetado async).
  async function detectarMaisPje() {
    if (maisPjePresente()) return true;
    await sleep(800);
    return maisPjePresente();
  }

  // Busca o executado idx; se não tiver veículo, tenta o próximo automaticamente.
  async function buscarExecutadoComVeiculo(est, idx) {
    const execs = est.executados || [];
    if (idx >= execs.length) {
      console.log("CRATOS/RENAJUD: todos os " + execs.length +
        " executado(s) foram pesquisados.");
      return;
    }
    const exec = execs[idx];
    await clicar("button", "Limpar"); await sleep(600);
    await preencher('input[id="documentoIdentificacao"]', exec.cpfcnpj); await sleep(400);
    await clicar("button", "Pesquisar");
    console.log("CRATOS/RENAJUD: pesquisado", CratosMascara.nome(exec.nome), "(" + CratosMascara.doc(exec.cpfcnpj) + ") — " +
      (idx + 1) + "/" + execs.length + ".");

    const res = await esperarResultadoBusca();
    if (res === "vazio") {
      console.log("CRATOS/RENAJUD: sem veículo para " + CratosMascara.nome(exec.nome) + " — gerando certidão negativa e seguindo.");
      fabricarCertidaoNegativa(est, exec);
      await buscarExecutadoComVeiculo(est, idx + 1);
    } else if (res === "achou") {
      est.execComVeiculo = exec;
      _idxAtual = idx;   // reserva: se o documento do proprietário não casar, o avanço parte daqui
      try { await Store.set("renajud_exec_veiculo", exec.nome || ""); } catch (e) {}
      console.log("CRATOS/RENAJUD: veículos de " + CratosMascara.nome(exec.nome) +
        " listados. Selecione e vá a 'incluir restrição'.");
    } else {
      console.warn("CRATOS/RENAJUD: resposta indefinida da busca (timeout) para " + CratosMascara.nome(exec.nome) + ".");
    }
  }

  // Aguarda o resultado da busca: "vazio" (nenhum veículo), "achou" (tabela de
  // veículos) ou "timeout".
  function esperarResultadoBusca(timeout = 9000) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const temTabela = () => Array.from(document.querySelectorAll("table")).some((t) => {
        if (!_visivel(t)) return false;
        const s = _norm(t.textContent);
        return s.includes("marca/modelo") || s.includes("marca modelo") || s.includes("proprietario");
      });
      const tick = () => {
        // Tabela de veículos tem PRIORIDADE — evita casar o "nenhum veículo" STALE
        // da busca anterior. Só aceita "vazio" após settle mínimo (resultado novo
        // renderizar).
        if (temTabela()) return resolve("achou");
        const vazio = _norm(document.body.textContent).includes("nenhum veiculo encontrado");
        if (vazio && Date.now() - t0 > 2000) return resolve("vazio");
        if (Date.now() - t0 > timeout) return resolve(vazio ? "vazio" : "timeout");
        setTimeout(tick, 300);
      };
      tick();
    });
  }

  // Fabrica (via background) uma certidão PDF de consulta NEGATIVA para o executado
  // sem veículos. Baixa automática, nome no padrão CRATOS. Reaproveita o handler
  // genérico 'fabricar_pdf' do background (gerarPDFTexto).
  function fabricarCertidaoNegativa(est, exec) {
    const proc = String(est.numProcesso || "").replace(/\D/g, "");
    /* DOIS PRIMEIROS NOMES no arquivo (igual à folha) — o nome inteiro da parte
       ("FULANO - EMPRESA X - ME") deixava o nome comprido e estourava o limite de
       100 caracteres da descrição do anexo no PJe (ARQ-043, campo 04/09). */
    const nomeArq = _primeirosDois(String(exec.nome || "").replace(/[\/\\:*?"<>|]/g, "").trim());
    /* Ordinal da executada — sem ele, duas negativas de homônimas colidiam no
       Cofre e a juntada perdia uma (campo, 03-04/09). */
    const ne = _rotuloExec(est, exec.cpfcnpj);
    const filename = "CRATOS/" + proc + (ne ? "_" + ne : "") + "_" + nomeArq +
      " RENAJUD Consulta Negativa.pdf";
    const doc = _formatarDoc(exec.cpfcnpj);
    const linhas = [
      "",
      /* Parágrafo INTEIRO: quem quebra é o gerarPDFTexto, que mede a largura real.
         Cortar aqui em 90 caracteres e deixar o gerador reparticionar o excedente
         produzia linha órfã na certidão. */
      "Certifico e dou fé que, nesta data (" + _dataBR() + "), procedi à consulta ao " +
        "RENAJUD - Restrições Judiciais Sobre Veículos Automotores, em nome de " + exec.nome +
        ", inscrito(a) no CPF/CNPJ sob o nº " + doc + ", e que NÃO foram encontrados veículos " +
        "registrados em seu nome.",
      "",
      "Era o que me cumpria certificar.",
      /* STI, 21/08: sem "Emitido pelo sistema CRATOS" enquanto não homologar. */
    ];
    browser.runtime.sendMessage({
      tipo: "fabricar_pdf",
      convenio: "RENAJUD",
      numProcesso: est.numProcesso,
      operacao: est.operacao || null,
      titulo: "CERTIDÃO DE CONSULTA AO RENAJUD",
      linhas,
      filename,
    })
      .then(() => console.log("CRATOS/RENAJUD: certidão negativa gerada ->", filename))
      .catch(() => console.log("CRATOS/RENAJUD: certidão negativa (Promise rejeitada, ok no FF) ->", filename));
  }

  function _formatarDoc(digitos) {
    const d = String(digitos || "").replace(/\D/g, "");
    if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
    if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
    return d;
  }
  function _dataBR() {
    const d = new Date(), p = (n) => String(n).padStart(2, "0");
    return p(d.getDate()) + "/" + p(d.getMonth() + 1) + "/" + d.getFullYear();
  }
  function _dataHoraBR() {
    const d = new Date(), p = (n) => String(n).padStart(2, "0");
    return _dataBR() + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  /* ── A IMPRESSÃO NATIVA FOI REMOVIDA (1.0.8) ──────────────────────────────
     Até a 1.0.7 o comprovante saía do "Imprimir" do próprio RENAJUD, com o
     nome do arquivo vindo do `document.title` — que o site só segurava por
     6s e que o Firefox lê no instante em que o USUÁRIO salva. Se ele
     demorasse, o nome saía errado; e, pior, o arquivo nascia fora do
     alcance da extensão: sem bytes, o RENAJUD não entrava no diário nem na
     juntada.
     Agora a folha vem do grampo de API (topo deste arquivo). As funções
     `iniciarImpressaoResultado` e `acharBotaoImprimir` foram APAGADAS de
     propósito, e não comentadas: código de impressão dormindo aqui voltaria
     a ser ligado por engano e produziria folha em duplicidade. O histórico
     está no git e nas notas.
     ──────────────────────────────────────────────────────────────────── */

  // ── Seleção EXATA em typeahead + checkbox por label (novos) ─────────────────
  // Painéis de dropdown ABERTOS (ng-select e afins). NÃO procuramos no conteúdo
  // geral da página: a tabela de restrições repete textos (órgão, magistrado) que
  // casariam errado — e mousedown numa célula de tabela não seleciona nada.
  const SEL_PAINEL = 'ng-dropdown-panel, .ng-dropdown-panel, .dropdown-menu, [role="listbox"], mat-select-panel';
  const SEL_OPCAO = '.ng-option, [role="option"], .dropdown-item, mat-option, ul[role="listbox"] li';

  // normaliza p/ comparação: sem acento, espaços colapsados, minúsculo.
  function _norm(s) {
    return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ").trim().toLowerCase();
  }

  function _visivel(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function acharOpcaoExata(valor) {
    const alvo = _norm(valor);
    for (const painel of document.querySelectorAll(SEL_PAINEL)) {
      if (!_visivel(painel)) continue;
      for (const c of painel.querySelectorAll(SEL_OPCAO)) {
        if (_norm(c.textContent) === alvo) return c;
      }
    }
    return null;
  }

  function acharLabelExato(texto) {
    const alvo = _norm(texto);
    for (const l of document.querySelectorAll("label")) {
      if (_norm(l.textContent) === alvo) return l;
    }
    return null;
  }

  function marcarPorLabel(texto) {
    const lbl = acharLabelExato(texto);
    if (!lbl) return false;
    let input = null;
    if (lbl.htmlFor) input = document.getElementById(lbl.htmlFor);
    if (!input) input = lbl.querySelector('input[type="checkbox"], input[type="radio"]');
    if (!input && lbl.parentElement) {
      input = lbl.parentElement.querySelector('input[type="checkbox"], input[type="radio"]');
    }
    if (input) { if (!input.checked) input.click(); return true; }
    lbl.click();
    return true;
  }

  // Typeahead: digita, aguarda o dropdown e clica a opção EXATA. Fallback = Enter.
  // Preenche um campo ng-select. Estratégia:
  //  1) abre o componente (clica no container);
  //  2) tenta achar a opção EXATA já renderizada (listas pequenas mostram tudo) —
  //     digitar quebra o filtro do ng-select em listas pequenas, então evitamos;
  //  3) se não achou (lista grande/virtualizada, ex.: Órgão), aí sim digita p/
  //     filtrar e procura de novo;
  //  4) seleciona via mousedown (ng-select ignora click).
  async function preencherEscolha(seletorOuEl, valor) {
    let ngsel = null;
    if (typeof seletorOuEl === "string") {
      ngsel = document.querySelector(seletorOuEl.replace(/\s+input\s*$/, ""));
    } else if (seletorOuEl && seletorOuEl.closest) {
      ngsel = seletorOuEl.closest("ng-select") || seletorOuEl;
    }
    if (!ngsel) { console.warn("CRATOS/RENAJUD: ng-select não encontrado:", seletorOuEl); return false; }

    // 1) abre
    (ngsel.querySelector(".ng-select-container") || ngsel).click();
    await sleep(350);

    // 2) acha sem digitar
    let opt = acharOpcaoExata(valor);

    // 3) fallback p/ lista grande: digita para filtrar/renderizar
    if (!opt) {
      const el = ngsel.querySelector("input");
      if (el) {
        el.focus();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
          .set.call(el, String(valor == null ? "" : valor));
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
      }
      opt = await esperar(() => acharOpcaoExata(valor), 5000);
    }

    // 4) seleciona (mousedown)
    if (opt) {
      _selecionarOpcao(opt);
      console.log("CRATOS/RENAJUD: opção exata:", (opt.textContent || "").trim());
    } else {
      console.warn("CRATOS/RENAJUD: opção exata não encontrada para '" + valor + "'.");
    }
    return true;
  }

  // ng-select seleciona no mousedown — sequência completa + scroll (lista grande).
  function _selecionarOpcao(opt) {
    const alvo = opt.closest('.ng-option, [role="option"]') || opt;
    try { alvo.scrollIntoView({ block: "center" }); } catch (e) {}
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      const Ctor = (type.startsWith("pointer") && window.PointerEvent) ? PointerEvent : MouseEvent;
      alvo.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, view: window }));
    }
  }

  /* Gancho de teste (jsdom): permite ao harness simular a parte em que o fluxo
     parou (_idxAtual) sem dirigir o SPA inteiro. Não afeta produção. */
  if (typeof window !== "undefined") {
    window.__cratosRenajud = {
      get idxAtual() { return _idxAtual; },
      set idxAtual(v) { _idxAtual = v; },
      prepararBaixa, aguardarResultadoBaixa, concluirBuscaBaixa, alertaNenhumaRestricao,
      fabricarCertidaoNadaARetirar,
    };
  }
})();
