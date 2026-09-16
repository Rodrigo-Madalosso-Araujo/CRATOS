/*
 * conteudo/sab.js — content script do módulo SAB.
 *
 * Roda em: pje.trt18.jus.br/sab/*
 * Duas responsabilidades:
 *   A) PASSO 2 (só em /determinacoes/nova/processo/{idSab}): popup de confirmação
 *      do valor (PJe-Calc) e preenchimento do campo "Valor da obrigação".
 *   B) PASSO 3 (qualquer /determinacoes/): aplica os padrões pré-configurados pelo
 *      usuário (repetição, conta salário, conta única) — quando ele chega no passo 3
 *      manualmente. Não navega sozinho; só ajusta os controles quando aparecem.
 */

(function iniciarSab() {
  // Roda em qualquer tela de determinação (nova OU já salva no passo 3).
  if (!/\/sab\/determinacoes\//.test(location.pathname)) return;

  console.log("CRATOS/SAB: content script ativo em", location.pathname);

  /* Chave global liga/desliga: desligado, o SAB não age (sem padrões do passo 3,
     sem o botão "marcar partes", sem auto-conclusão). */
  let _cratosLigado = true;
  Store.ligada().then((v) => { _cratosLigado = v; }).catch(() => {});

  const ehMinutaNova = /\/sab\/determinacoes\/nova\/processo\/\d+/.test(location.pathname);
  let padroesAplicados = false;

  // (A) Preenchimento do valor — só na minuta nova, com estado ativo do CRATOS.
  if (ehMinutaNova) {
    Store.get("sab_estado").then(async (est) => {
      if (!(await Store.ligada())) return;   // extensão desligada
      if (!est || !est.ativo) {
        console.debug("CRATOS/SAB: sem estado ativo, ignorando preenchimento de valor.");
        return;
      }
      aguardarPasso2EPreencherValor(est);
    }).catch((e) => console.warn("CRATOS/SAB: erro ao ler estado:", e.message));
  }

  // (B) Padrões do passo 3 — observador contínuo (Angular navega sem recarregar).
  const obsPasso3 = new MutationObserver(() => {
    if (!_cratosLigado) return;   // extensão desligada: nenhum ajudante
    tentarAplicarPadroesPasso3();
    verificarAutoConclusao();   // também pega a navegação SPA para /determinacoes/{id}
    injetarBotaoMarcarPartes(); // passo 1: botão "Marcar todas as partes" (ajudante)
  });
  obsPasso3.observe(document.body, { childList: true, subtree: true });
  // Chamadas iniciais só depois de saber se está ligado (evita o botão piscar
  // antes da leitura assíncrona da chave).
  Store.ligada().then((lig) => {
    _cratosLigado = lig;
    if (lig) { tentarAplicarPadroesPasso3(); injetarBotaoMarcarPartes(); }
  }).catch(() => { tentarAplicarPadroesPasso3(); injetarBotaoMarcarPartes(); });

  // (C) Auto-conclusão — se a ordem já existe (/determinacoes/{id}), faz polling do
  // estado até sair de MINUTA (= foi autorizada). Aí gera a certidão, sinaliza o
  // orquestrador e fecha a aba. O botão "Concluí" no painel continua como backup.
  verificarAutoConclusao();

  function verificarAutoConclusao() {
    const m = location.pathname.match(/\/sab\/determinacoes\/(\d+)/);
    if (m) iniciarAutoConclusao(m[1]);
  }

  async function iniciarAutoConclusao(idDeterminacao) {
    // Evita rodar duas vezes para a mesma determinação (navegações do Angular).
    if (window.__cratosSabPolling === idDeterminacao) return;
    if (!(await Store.ligada())) return;   // extensão desligada
    window.__cratosSabPolling = idDeterminacao;

    // Só auto-conclui se esta ordem foi aberta pelo CRATOS (evita agir em ordens
    // que o usuário abriu manualmente para revisar).
    let est = null;
    try { est = await Store.get("sab_estado"); } catch (e) {}
    if (!est || !est.ativo) {
      console.debug("CRATOS/SAB: auto-conclusão inativa (sem estado do CRATOS).");
      return;
    }

    // BAIXA: em vez de esperar sair de MINUTA (inclusão), automatiza a interrupção.
    if (est.operacao === "baixa") {
      executarBaixaAutomatica(idDeterminacao, est);
      return;
    }

    console.log("CRATOS/SAB: monitorando conclusão da determinação", idDeterminacao);
    const base = location.origin;
    const t0 = Date.now();
    const TIMEOUT_MS = 10 * 60 * 1000;   // 10 min
    const INTERVALO = 3000;

    const timer = setInterval(async () => {
      if (Date.now() - t0 > TIMEOUT_MS) {
        clearInterval(timer);
        console.log("CRATOS/SAB: timeout do monitoramento — use o botão Concluí se necessário.");
        return;
      }
      // Se o estado foi zerado (concluído manualmente pelo painel), para de monitorar.
      let estAgora = null;
      try { estAgora = await Store.get("sab_estado"); } catch (e) {}
      if (!estAgora || !estAgora.ativo) { clearInterval(timer); return; }
      try {
        const resp = await fetch(`${base}/sab-api/api/determinacoes/${idDeterminacao}`,
          { headers: { Accept: "application/json" } });
        if (!resp.ok) return;
        const det = await resp.json();
        const situacao = String(det.situacao || "").toUpperCase();
        if (situacao && situacao !== "MINUTA") {
          clearInterval(timer);
          console.log("CRATOS/SAB: determinação", idDeterminacao, "->", situacao, "(concluída).");
          await concluirSab(est, det);
        }
      } catch (e) { /* silencioso — tenta de novo no próximo tick */ }
    }, INTERVALO);
  }

  async function concluirSab(est, det) {
    // 1) gera a certidão
    try {
      await browser.runtime.sendMessage({
        tipo: "sab_certidao",
        operacao: est.operacao || "inclusao",
        numProcesso: (det.processo && det.processo.numero) || est.numProcesso || "",
        nomeAbrev: _abrev((det.exequente && det.exequente.nome) || ""),
        dataFormatada: null,
        /* Só chega aqui se o valor confirmado FOI o atualizado (ver a checagem
           em aguardarPasso2EPreencherValor). A certidão não afirma o que não
           aconteceu. */
        atualizacao: est.atualizacao || null,
      });
      console.log("CRATOS/SAB: certidão solicitada.");
    } catch (e) {
      console.warn("CRATOS/SAB: falha ao solicitar certidão:", e.message);
      // A determinação FOI enviada; só a certidão falhou. Isso não pode passar
      // calado: quem confia na certidão para juntar no processo precisa saber.
      CratosFaixa.alertar("sab", "a determinação foi enviada, mas a certidão NÃO foi gerada. "
        + "Junte o comprovante do próprio SAB, ou gere a certidão de novo.", "#facc15");
    }
    // 2) sinaliza o orquestrador que o SAB concluiu (para seguir a fila)
    try {
      await browser.runtime.sendMessage({ tipo: "sab_concluido_auto" });
    } catch (e) {}
    // 3) limpa o estado e fecha a aba após ~2s (para ver o "Autorizada")
    try { await Store.set("sab_estado", null); } catch (e) {}
    setTimeout(() => {
      browser.runtime.sendMessage({ tipo: "sab_fechar_aba" }).catch(() => {});
    }, 2000);
  }

  // ── BAIXA automática ──────────────────────────────────────────────────────
  // Clica Interromper -> preenche justificativa fixa -> Confirma -> monitora a
  // situação mudar -> gera certidão de baixa e fecha a aba. Só age em determinação
  // aberta pelo CRATOS com operacao "baixa" (trava via sab_estado).
  async function executarBaixaAutomatica(idDeterminacao, est) {
    const base = location.origin;
    console.log("CRATOS/SAB baixa: iniciando interrupção automática de", idDeterminacao);

    // Baseline da situação (não dependemos de saber a string "interrompida").
    let situacaoInicial = "";
    try {
      const r = await fetch(`${base}/sab-api/api/determinacoes/${idDeterminacao}`,
        { headers: { Accept: "application/json" } });
      if (r.ok) situacaoInicial = String((await r.json()).situacao || "").toUpperCase();
    } catch (e) { /* segue */ }

    // 1) Botão "Interromper" (mat-fab flutuante).
    const btn = await _esperarElemento(
      () => _acharPorTexto(["Interromper"], "sab-botoes-fluxo-determinacao button, button"), 15000);
    if (!btn) {
      return CratosFaixa.parar("sab", "não achei o botão 'Interromper' na tela da determinação. "
        + "Se ele estiver aí, interrompa à mão — a baixa é este clique.");
    }
    btn.click();

    // 2) Justificativa no popup + Confirmar.
    const escopoPopup = "mat-dialog-container, .cdk-overlay-container, .mat-dialog-container";
    const ta = await _esperarElemento(
      () => document.querySelector("textarea.dialogo-textarea") ||
            document.querySelector(`${escopoPopup} textarea`), 10000);
    if (!ta) {
      return CratosFaixa.parar("sab", "cliquei em 'Interromper' e a caixa de justificativa não "
        + "abriu. Confira a tela: se ela estiver aberta, preencha e confirme à mão.");
    }
    _setValorReativo(ta, est.justificativa || "Determinação judicial");

    const btnConfirmar = await _esperarElemento(
      () => _acharPorTexto(["Confirmar"], escopoPopup), 8000);
    if (!btnConfirmar) {
      return CratosFaixa.parar("sab", "preenchi a justificativa mas não achei o 'Confirmar' do "
        + "pop-up. A interrupção NÃO foi confirmada — confirme à mão.");
    }
    btnConfirmar.click();
    console.log("CRATOS/SAB baixa: interrupção confirmada; aguardando mudança de situação.");

    // 3) Monitora a situação mudar em relação ao baseline -> conclui.
    const t0 = Date.now();
    const TIMEOUT_MS = 90 * 1000;
    const timer = setInterval(async () => {
      if (Date.now() - t0 > TIMEOUT_MS) {
        clearInterval(timer);
        return CratosFaixa.parar("sab", "confirmei a interrupção, mas o SAB não mudou a situação da "
          + "determinação em 90 segundos. Confira a situação dela na tela — pode "
          + "ter dado certo e demorado.", { enviado: true });
      }
      let estAgora = null;
      try { estAgora = await Store.get("sab_estado"); } catch (e) {}
      if (!estAgora || !estAgora.ativo) { clearInterval(timer); return; }
      try {
        const r = await fetch(`${base}/sab-api/api/determinacoes/${idDeterminacao}`,
          { headers: { Accept: "application/json" } });
        if (!r.ok) return;
        const det = await r.json();
        const s = String(det.situacao || "").toUpperCase();
        if (s && s !== situacaoInicial) {
          clearInterval(timer);
          console.log("CRATOS/SAB baixa: situação", situacaoInicial, "->", s, "(baixada).");
          await concluirSab(est, det);
        }
      } catch (e) { /* tenta de novo */ }
    }, 2000);
  }

  /* Espera um seletor/predicado retornar um elemento (Angular renderiza async). */
  function _esperarElemento(fn, timeoutMs) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const tick = () => {
        let el = null;
        try { el = fn(); } catch (e) {}
        if (el) return resolve(el);
        if (Date.now() - t0 > timeoutMs) return resolve(null);
        setTimeout(tick, 200);
      };
      tick();
    });
  }

  /* Acha um botão/link clicável cujo texto casa (dentro de um escopo). */
  function _acharPorTexto(textos, escopoSel) {
    const alvos = textos.map((t) => t.trim().toLowerCase());
    const raizes = escopoSel ? document.querySelectorAll(escopoSel) : [document];
    for (const raiz of raizes) {
      const cands = raiz.querySelectorAll("button, a, .mat-button-wrapper, [role='button']");
      for (const c of cands) {
        const txt = (c.textContent || "").trim().toLowerCase();
        if (alvos.includes(txt)) {
          // sobe até o elemento clicável (button/a) se casou no wrapper interno.
          return c.closest("button, a, [role='button']") || c;
        }
      }
    }
    return null;
  }

  /* Seta valor em campo reativo (Angular): setter nativo + input/change.
     Justificativa é textarea sem máscara — dispensa o truque de paste do valor. */
  function _setValorReativo(el, valor) {
    const proto = el.tagName === "TEXTAREA"
      ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    el.focus();
    setter.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.blur();
  }

  function _abrev(nome) {
    return String(nome || "").trim().split(/\s+/).slice(0, 2).join(" ") || "PARTE";
  }

  /*
   * Detecta o passo 3 (radio "Repetição Contínua" + tabela de executados com toggles)
   * e aplica os padrões salvos em config.sab. Aplica UMA vez por carga. Só clica no
   * que precisa mudar (clicar num controle já correto o inverteria).
   */
  async function tentarAplicarPadroesPasso3() {
    if (padroesAplicados) return;
    const toggles = document.querySelectorAll("mat-slide-toggle");
    const temRepeticao = Array.from(
      document.querySelectorAll("legend, .mat-radio-label-content, label")
    ).some((e) => /repeti/i.test(e.textContent || ""));
    if (!temRepeticao || toggles.length === 0) return;   // ainda não é o passo 3

    let cfg;
    try {
      const tudo = (await Store.get(CHAVES.config)) || {};
      cfg = tudo.sab || null;
    } catch (e) { cfg = null; }

    // Opt-in: só age se o usuário configurou padrões do SAB nas Preferências.
    // Sem config, não toca em nada (respeita o padrão do próprio SAB).
    if (!cfg || (cfg.repeticao == null && cfg.contaSalario == null && cfg.contaUnica == null)) {
      padroesAplicados = true;  // não tenta de novo nesta carga
      return;
    }

    const repeticao = cfg.repeticao || "teimosinhas";
    const contaSalario = cfg.contaSalario || "nao";
    const contaUnica = cfg.contaUnica || "sim";

    aplicarRepeticao(repeticao);
    aplicarTogglesExecutados(contaSalario === "sim", contaUnica === "sim");

    padroesAplicados = true;
    console.log("CRATOS/SAB: padrões do passo 3 aplicados:", { repeticao, contaSalario, contaUnica });
  }

  /* Marca o radio de Repetição Contínua conforme a escolha, se ainda não estiver. */
  function aplicarRepeticao(valor) {
    const alvo = valor === "automacao" ? /autom/i : /teimosinha/i;
    for (const rb of document.querySelectorAll("mat-radio-button")) {
      if (!alvo.test(rb.textContent || "")) continue;
      const input = rb.querySelector('input[type="radio"]');
      const marcado = rb.classList.contains("mat-radio-checked") ||
        (input && input.getAttribute("aria-checked") === "true");
      if (!marcado) (rb.querySelector("label") || rb).click();
      return;
    }
  }

  /* Para cada linha de executado: toggles[0]=conta salário, toggles[1]=conta única. */
  function aplicarTogglesExecutados(querSalario, querUnica) {
    const porLinha = new Map();
    for (const t of document.querySelectorAll("mat-slide-toggle")) {
      const tr = t.closest("tr");
      if (!tr) continue;
      if (!porLinha.has(tr)) porLinha.set(tr, []);
      porLinha.get(tr).push(t);
    }
    for (const [, toggles] of porLinha) {
      if (toggles.length < 2) continue;
      ajustarToggle(toggles[0], querSalario);   // Bloquear conta salário?
      ajustarToggle(toggles[1], querUnica);     // Utilizar conta única?
    }
  }

  function ajustarToggle(toggle, querLigado) {
    const input = toggle.querySelector('input[role="switch"], input[type="checkbox"]');
    const ligado = !!(input && input.getAttribute("aria-checked") === "true");
    if (ligado !== querLigado) (toggle.querySelector("label") || toggle).click();
  }

  /*
   * Aguarda o wizard avançar para o passo 2 ("Inclua as obrigações").
   * Detectado quando aparece o input do valor da obrigação na página.
   * Usa MutationObserver + timeout de segurança.
   */
  async function aguardarPasso2EPreencherValor(est) {
    console.log("CRATOS/SAB: aguardando passo 2 do wizard...");
    const input = await esperarInputValor(60000);
    if (!input) {
      return CratosFaixa.parar("sab", "a tela de obrigações do SAB não abriu em 1 minuto, então "
        + "não cheguei a preencher o valor. Confira a tela e execute de novo.");
    }
    console.log("CRATOS/SAB: passo 2 detectado, abrindo popup de confirmação.");
    const atualizacao = await atualizarValorParaHoje(est);
    const valorConfirmado = await mostrarPopupConfirmacao(est.calc, atualizacao);
    if (valorConfirmado === null) {
      console.log("CRATOS/SAB: usuário pulou o preenchimento do valor.");
      return;
    }
    colarValorFormatado(input, valorConfirmado);
    console.log("CRATOS/SAB: valor colado (formatado):", valorConfirmado);

    /* A certidão só pode afirmar "valor atualizado até hoje" se o valor que
       FOI para a ordem é mesmo o atualizado. O popup deixa editar — e se o
       usuário mudou o número, a frase viraria mentira num documento assinado.
       Compara por dígitos e só então guarda para a certidão. */
    const soNum = (s) => String(s || "").replace(/\D/g, "");
    if (atualizacao && atualizacao.ok &&
        soNum(valorConfirmado) === soNum(atualizacao.formatado)) {
      try {
        await Store.set("sab_estado", Object.assign({}, est, { atualizacao }));
      } catch (e) { /* certidão sai sem a linha; melhor que travar o fluxo */ }
    }
  }

  /*
   * Aguarda o input "Valor da obrigação" aparecer no DOM.
   * O SAB é Angular — os elementos surgem após navegação entre steps.
   */
  function esperarInputValor(maxMs) {
    return new Promise((resolve) => {
      // Tenta imediatamente
      const ja = _acharInputValor();
      if (ja) { resolve(ja); return; }

      const fim = Date.now() + maxMs;
      const obs = new MutationObserver(() => {
        const el = _acharInputValor();
        if (el) { obs.disconnect(); resolve(el); return; }
        if (Date.now() > fim) { obs.disconnect(); resolve(null); }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { obs.disconnect(); resolve(_acharInputValor()); }, maxMs);
    });
  }

  /*
   * Encontra o input do "Valor da obrigação" no wizard.
   * O SAB usa Angular Material — o campo tem placeholder "Valor da obrigação"
   * ou label com esse texto.
   */
  function _acharInputValor() {
    // Tenta por placeholder direto
    const porPlaceholder = document.querySelector(
      'input[placeholder*="alor"], input[placeholder*="brigação"]'
    );
    if (porPlaceholder) return porPlaceholder;

    // Tenta por label "Valor da obrigação" → input irmão/próximo
    const labels = document.querySelectorAll("label, mat-label, .mat-form-field-label");
    for (const label of labels) {
      if (/valor.*obriga/i.test(label.textContent)) {
        const field = label.closest("mat-form-field") || label.parentElement;
        const inp = field && field.querySelector("input");
        if (inp) return inp;
      }
    }
    return null;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
   * ATUALIZAÇÃO DO VALOR PARA HOJE
   * ═══════════════════════════════════════════════════════════════════════════
   * O valor do PJe-Calc está congelado na `dataLiquidacao` do cálculo — no caso
   * real de 02/09, um cálculo de 13/08: vinte dias de defasagem indo para uma
   * ordem de bloqueio.
   *
   * A tela de cálculo do PJe resolve isso pedindo ao servidor o FATOR do período
   * e multiplicando no navegador:
   *     POST /pje-comum-api/api/calculos/taxasatualizacao
   *          ?dataInicial=<dataLiquidacao>&dataFinal=<hoje>
   *     -> "1.0109"    (o corpo da resposta é só o número)
   * Confirmado no HAR de 02/09. **O índice é do PJe; nós só multiplicamos.**
   * O valor atualizado não existe em endpoint nenhum — a própria tela faz a
   * conta no cliente. Fazer igual é reproduzir o PJe, não calcular por conta.
   *
   * POR QUE AQUI E NÃO NO `api-pje.js`: aquele arquivo roda no BACKGROUND, e
   * POST de lá sai com `Origin: moz-extension://` — a armadilha ARQ-516 que o
   * SAB já pagou. Este content script está no mesmo host da API, então a
   * chamada é same-origin e leva o `X-XSRF-TOKEN` do cookie, como o movimento
   * 11382 já faz. (O HAR confirma que o header é obrigatório.)
   *
   * ⚠ SALVAGUARDA: fator que não veio NÃO vira valor atualizado. Devolve o
   * original com a data dele e um aviso — preferência que não pôde ser aplicada
   * e ninguém viu é a categoria traiçoeira que a faixa âmbar existe para cobrir.
   */
  async function atualizarValorParaHoje(est) {
    const calc = est && est.calc;
    if (!calc || !calc.total) return null;

    /* A config do SAB vive em `config.sab` no storage — o mesmo lugar de onde os
       padrões do passo 3 saem. Não vem no `sab_estado`. */
    let cfg = {};
    try { cfg = ((await Store.get(CHAVES.config)) || {}).sab || {}; } catch (e) {}
    if (cfg.atualizarValor === "nao") return null;      // padrão: LIGADO

    if (!calc.dataLiquidacaoISO) {
      return { ok: false, motivo: "o cálculo não informa a data de liquidação" };
    }
    const dataInicial = String(calc.dataLiquidacaoISO).slice(0, 10);
    const hoje = new Date();
    const dataFinal = hoje.getFullYear() + "-" +
      String(hoje.getMonth() + 1).padStart(2, "0") + "-" +
      String(hoje.getDate()).padStart(2, "0");
    if (dataInicial >= dataFinal) {
      return { ok: false, motivo: "o cálculo já está atualizado até hoje", semDefasagem: true };
    }

    try {
      const fator = await buscarFatorAtualizacao(dataInicial, dataFinal);
      if (!(fator > 0)) return { ok: false, motivo: "o PJe não devolveu um fator utilizável" };
      /* Arredondamento para 2 casas, MEIO PARA CIMA — é o que o PJe faz
         (conferido com o Rodrigo: 20.895,00 × 1,0109 = 21.122,7555 → 21.122,76).
         `Math.round` já é meio-para-cima em positivos; o `+Number.EPSILON`
         evita o caso clássico do binário (1.005 que "desce"). */
      const bruto = calc.total * fator;
      const atualizado = Math.round((bruto + Number.EPSILON) * 100) / 100;
      return {
        ok: true, fator, atualizado, original: calc.total,
        dataInicial, dataFinal,
        formatado: _moeda(atualizado),
        originalFormatado: _moeda(calc.total),
        dataFinalBR: dataFinal.split("-").reverse().join("/"),
        dataInicialBR: dataInicial.split("-").reverse().join("/"),
      };
    } catch (e) {
      return { ok: false, motivo: String(e.message || e) };
    }
  }

  async function buscarFatorAtualizacao(dataInicial, dataFinal) {
    const url = location.origin + "/pje-comum-api/api/calculos/taxasatualizacao" +
      `?dataInicial=${dataInicial}&dataFinal=${dataFinal}`;
    /* O corpo que a tela do PJe manda é um objeto HttpHeaders do Angular
       serializado por engano — os parâmetros vão todos na query string. Mandamos
       o mesmo formato de propósito: é o que se sabe que o servidor aceita. */
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/plain, */*",
        "X-XSRF-TOKEN": decodeURIComponent(_xsrfDoCookie()),
      },
      body: JSON.stringify({ headers: { normalizedNames: {}, lazyUpdate: null } }),
    });
    if (!r.ok) throw new Error("HTTP " + r.status + " ao pedir o fator de atualização");
    const txt = (await r.text()).trim();
    const n = Number(txt);
    if (!isFinite(n)) throw new Error("resposta inesperada do PJe: " + txt.slice(0, 40));
    return n;
  }

  function _xsrfDoCookie() {
    const c = document.cookie.split(";").map((x) => x.trim())
      .find((x) => x.toLowerCase().startsWith("xsrf-token="));
    return c ? c.split("=").slice(1).join("=") : "";
  }
  function _moeda(v) {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
  }

  /*
   * Popup de confirmação do valor — injetado no DOM do SAB.
   * Mostra o valor do PJe-Calc (editável) e aguarda Confirmar ou Pular.
   * Retorna o valor confirmado (string formatada) ou null se pulou.
   */
  function mostrarPopupConfirmacao(calc, atualizacao) {
    return new Promise((resolve) => {
      // Remove popup anterior se existir
      document.getElementById("cratos-sab-popup")?.remove();

      /* Se a atualização deu certo, o campo já nasce com o valor de HOJE — é
         o que vai para a ordem. O original continua visível: quem confirma tem
         de ver de onde o número veio. */
      const usarAtualizado = !!(atualizacao && atualizacao.ok);
      const valorInicial = usarAtualizado
        ? atualizacao.formatado.replace("R$\u00a0", "").trim()
        : (calc ? calc.valorFormatado.replace("R$\u00a0", "").trim() : "");
      const dataLabel = calc ? ` (cálculo de ${calc.dataFormatada})` : "";

      /* O aviso. Verde quando atualizou, âmbar quando NÃO deu — e aí ele diz de
         que data é o valor que está no campo. Silêncio aqui seria o pior caso:
         a pessoa confirmaria um valor velho achando que era o de hoje. */
      let avisoHtml = "";
      if (usarAtualizado) {
        avisoHtml = `<div style="font-size:12px;color:#4ade80;margin-bottom:14px;
            border-left:3px solid #4ade80;padding-left:8px;line-height:1.5">
            <b>Valores atualizados para hoje (${_escHtml(atualizacao.dataFinalBR)}).</b><br>
            <span style="color:#9a9a9a">Cálculo de ${_escHtml(atualizacao.dataInicialBR)}:
            ${_escHtml(atualizacao.originalFormatado)} · fator do PJe
            ${_escHtml(String(atualizacao.fator))}</span></div>`;
      } else if (atualizacao && atualizacao.semDefasagem) {
        avisoHtml = `<div style="font-size:12px;color:#9a9a9a;margin-bottom:14px;
            border-left:3px solid #555;padding-left:8px">
            O cálculo já está atualizado até hoje — nada a corrigir.</div>`;
      } else if (atualizacao) {
        avisoHtml = `<div style="font-size:12px;color:#facc15;margin-bottom:14px;
            border-left:3px solid #facc15;padding-left:8px;line-height:1.5">
            <b>NÃO consegui atualizar o valor para hoje</b>
            (${_escHtml(atualizacao.motivo)}).<br>
            <span style="color:#9a9a9a">O campo está com o valor do cálculo de
            ${_escHtml(calc ? calc.dataFormatada : "?")}, sem atualização.</span></div>`;
      }

      const overlay = document.createElement("div");
      overlay.id = "cratos-sab-popup";
      overlay.style.cssText = `
        position: fixed; inset: 0; z-index: 2147483600;
        background: rgba(0,0,0,0.65);
        display: flex; align-items: center; justify-content: center;
      `;

      overlay.innerHTML = `
        <div style="
          background: #1a1a1a; border: 2px solid #e11d1d; border-radius: 10px;
          padding: 28px 32px; min-width: 360px; max-width: 480px;
          color: #f0f0f0; font-family: sans-serif; box-shadow: 0 8px 32px rgba(0,0,0,0.7);
        ">
          <div style="font-weight:700; font-size:15px; margin-bottom:6px; color:#e11d1d;">
            CRATOS — SAB
          </div>
          <div style="font-size:13px; color:#9a9a9a; margin-bottom:16px;">
            Valor do último cálculo${dataLabel}.<br>
            Confirme ou edite antes de preencher.
          </div>
          ${avisoHtml}
          <label style="display:block; font-size:12px; color:#9a9a9a; margin-bottom:4px;">
            Valor da obrigação (R$)
          </label>
          <input id="cratos-sab-valor"
            style="
              width: 100%; box-sizing: border-box;
              background: #2a2a2a; border: 1px solid #555; border-radius:6px;
              color: #fff; font-size: 16px; padding: 8px 12px; margin-bottom: 18px;
            "
            value="${_escHtml(valorInicial)}"
            placeholder="Ex.: 28.000,00"
          />
          <div style="display:flex; gap:10px; justify-content:flex-end;">
            <button id="cratos-sab-pular" style="
              background: transparent; border: 1px solid #555; border-radius:6px;
              color: #9a9a9a; padding: 8px 20px; cursor:pointer; font-size:13px;
            ">Pular</button>
            <button id="cratos-sab-confirmar" style="
              background: #e11d1d; border: none; border-radius:6px;
              color: #fff; padding: 8px 20px; cursor:pointer; font-size:13px; font-weight:700;
            ">Confirmar</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      // Foca no input e seleciona tudo para facilitar edição
      const inputValor = overlay.querySelector("#cratos-sab-valor");
      setTimeout(() => { inputValor.focus(); inputValor.select(); }, 80);

      overlay.querySelector("#cratos-sab-confirmar").onclick = () => {
        const v = inputValor.value.trim();
        overlay.remove();
        resolve(v || null);
      };

      overlay.querySelector("#cratos-sab-pular").onclick = () => {
        overlay.remove();
        resolve(null);
      };

      // Enter confirma, Escape pula
      inputValor.addEventListener("keydown", (e) => {
        if (e.key === "Enter") overlay.querySelector("#cratos-sab-confirmar").click();
        if (e.key === "Escape") overlay.querySelector("#cratos-sab-pular").click();
      });
    });
  }

  /*
   * Simula um COLAR REAL (Ctrl+V) — o Angular do SAB ignora .value setado por
   * script, mas reage ao evento 'paste' com dados no clipboardData (foi o que
   * funcionou quando o usuário colou na mão). Foca, seleciona tudo e dispara o
   * paste com o valor formatado "R$ 41.520,51".
   */
  function colarValorFormatado(el, valor) {
    let v = String(valor).trim();
    if (!/^R\$/i.test(v)) v = "R$ " + v;

    el.focus();
    el.select();

    // Monta o DataTransfer com o texto a colar
    const dt = new DataTransfer();
    dt.setData("text/plain", v);
    const pasteEvent = new ClipboardEvent("paste", {
      bubbles: true, cancelable: true, clipboardData: dt,
    });

    const aceitou = !el.dispatchEvent(pasteEvent); // se preventDefault, o handler tratou
    // Fallback: se o paste não foi tratado, seta o valor e dispara input
    if (!aceitou || !el.value) {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, "value"
      ).set;
      setter.call(el, v);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste", data: v }));
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
    console.log("CRATOS/SAB: valor final no campo:", el.value);
  }

  function _sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function _escHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;").replace(/"/g, "&quot;")
      .replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }


  /* ═══════════════════════════════════════════════════════════════════════════
   * BOTÃO "MARCAR TODAS AS PARTES" (passo 1 do wizard de bloqueio)
   * ═══════════════════════════════════════════════════════════════════════════
   * Tela "Seleção de Participantes": uma tabela `name="Tabela de Partes"` com um
   * mat-checkbox por parte. Ajudante de tela — marca autor e réu de uma vez, em
   * vez de clicar um por um. O próprio SAB só aceita 1 credor (marca um, ignora o
   * segundo), então marcamos todos e a página cuida da regra.
   *
   * ⚠ mat-checkbox (Angular Material): NÃO setar `input.checked` (não entra no
   * modelo — a lição do SerasaJUD). Clicar no `label.mat-checkbox-layout`, que o
   * Material processa e efetiva. Só clica no que NÃO está marcado (clicar inverte)
   * e pula os desabilitados. É só seleção — não avança nem envia.
   */
  function marcarTodasAsPartes() {
    const tabela = document.querySelector('table[name="Tabela de Partes"]');
    if (!tabela) return 0;
    let n = 0;
    for (const cb of tabela.querySelectorAll("mat-checkbox")) {
      if (cb.classList.contains("mat-checkbox-disabled")) continue;
      if (cb.classList.contains("mat-checkbox-checked")) continue;
      const alvo = cb.querySelector("label.mat-checkbox-layout") || cb.querySelector("label") || cb;
      alvo.click();
      n++;
    }
    return n;
  }

  function injetarBotaoMarcarPartes() {
    if (!_cratosLigado) return;   // extensão desligada
    const tabela = document.querySelector('table[name="Tabela de Partes"]');
    if (!tabela || !tabela.querySelector("mat-checkbox")) return;   // não é a tela de partes
    if (document.getElementById("cratos-sab-marcar-partes")) return; // já injetado

    const wrap = document.createElement("div");
    wrap.style.cssText = "margin: 8px 0 4px; text-align: right;";
    const btn = document.createElement("button");
    btn.id = "cratos-sab-marcar-partes";
    btn.type = "button";
    btn.textContent = "Marcar todas as partes (CRATOS)";
    btn.style.cssText = [
      "background:#0a6b8a", "color:#fff", "border:none", "border-radius:6px",
      "padding:8px 16px", "font-size:13px", "font-weight:600", "cursor:pointer",
      "font-family:sans-serif", "box-shadow:0 1px 3px rgba(0,0,0,.2)",
    ].join(";");
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      const n = marcarTodasAsPartes();
      if (typeof CratosFaixa !== "undefined" && CratosFaixa.mostrar) {
        CratosFaixa.mostrar("sab", n > 0
          ? `Marquei ${n} parte(s). Confira a seleção (o SAB permite só 1 credor) e siga para "Inclua as obrigações".`
          : "As partes já estavam marcadas — confira a seleção e siga.", "#4ade80");
      }
    });
    wrap.appendChild(btn);

    const anchor = tabela.closest("div.t-container-class") || tabela;
    if (anchor.parentNode) anchor.parentNode.insertBefore(wrap, anchor);
  }

  /* Gancho de teste (mundo isolado: a página não enxerga). */
  window.__cratosSab = {
    atualizarValorParaHoje, buscarFatorAtualizacao,
    marcarTodasAsPartes, injetarBotaoMarcarPartes,
  };

})();
