/*
 * painel.js — roda na página do PJe.
 *
 * Fluxo:
 *  1. Injeta o botão flutuante do CRATOS.
 *  2. Ao clicar: detecta o id/numero do processo na tela, pede ao background para
 *     capturar (carga preguiçosa — só agora, não ao entrar no processo), abre o painel.
 *  3. Renderiza as partes a partir de cratos:processo e escuta mudanças nessa chave.
 *
 * O painel é a UI única: seleção de partes + convênios + confirmação viverão aqui.
 * Nesta base, ele já captura e lista as partes. A seleção/execução entra no próximo passo.
 */

(function () {
  if (window.__cratosInjetado) return;
  window.__cratosInjetado = true;

  /* O de 128: o CSS reduz para 42px (ver a nota em painel-estilo.js).
     ATENÇÃO: todo ícone usado AQUI precisa estar em web_accessible_resources do
     manifest. Content script não carrega arquivo da extensão como <img src> sem
     essa declaração — e a falha é silenciosa: o Firefox só não desenha, sobra o
     alt. Foi o que quebrou o botão na 0.4.3. */
  const iconeUrl = browser.runtime.getURL("icones/cratos-128.png");

  /* 1.5.5: todo HTML do painel é montado com html`` (comum/storage.js): cada
     interpolação é escapada, e só fragmentos html`` entram crus. */
  const html = CratosHTML.html;

  const botao = document.createElement("cratos-botao");
  botao.title = "CRATOS";
  /* 2.0: o botão flutuante é um botão de verdade para o teclado e o leitor de tela. */
  botao.setAttribute("role", "button");
  botao.setAttribute("tabindex", "0");
  botao.setAttribute("aria-label", "CRATOS: abrir o painel");
  botao.setAttribute("aria-expanded", "false");
  CratosHTML.definir(botao, html`<img src="${iconeUrl}" alt="">`);

  /* Ícone de energia em SVG (inline). Antes era o caractere de energia U+23FB, que
     a fonte do sistema pode não ter — aí o Firefox desenhava o "tofu" (quadradinho
     de glifo faltando). SVG não depende de fonte: rende igual em qualquer máquina.
     Usa currentColor, então a cor vem do CSS/estilo do elemento pai (verde ligado,
     vermelho desligado). */
  /* confiavel(): constante do próprio código, sem nenhum dado externo. */
  const SVG_POWER = CratosHTML.confiavel(
    '<svg class="cx-power-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2.2" stroke-linecap="round" aria-hidden="true">' +
    '<line x1="12" y1="3.5" x2="12" y2="12"/>' +
    '<path d="M7 6.6a7 7 0 1 0 10 0"/></svg>');

  /* 2.0: o raio da marca (o mesmo do ícone de 16/32 px) e os três pontos do menu. */
  const SVG_RAIO = CratosHTML.confiavel(
    '<svg class="cx-raio" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linejoin="round" aria-hidden="true"><path d="M13 3L4 14h7l-1 7 9-11h-7l1-7z"/></svg>');
  const SVG_MAIS = CratosHTML.confiavel(
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" ' +
    'aria-hidden="true"><path d="M5 12h.01M12 12h.01M19 12h.01"/></svg>');
  const SVG_FECHAR = CratosHTML.confiavel(
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" ' +
    'aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>');

  const painel = document.createElement("cratos-painel");
  painel.setAttribute("role", "region");
  painel.setAttribute("aria-label", "CRATOS");
  CratosHTML.definir(painel, html`
    <div class="cx-cabecalho">
      ${SVG_RAIO}
      <div class="cx-titulo"><h1 class="cx-h1">CRATOS</h1><div class="cx-proc" id="cx-proc-num"></div></div>
      <button type="button" class="cx-power" aria-pressed="true" title="Ligar/desligar o CRATOS">${SVG_POWER}<span class="cx-power-txt">Ligado</span></button>
      <button type="button" class="cx-icone cx-mais" id="cx-mais" aria-label="Mais opções" aria-expanded="false" aria-controls="cx-menu">${SVG_MAIS}<span class="cx-ponto" id="cx-mais-ponto" hidden></span><span class="cx-sr" id="cx-mais-sr"></span></button>
      <button type="button" class="cx-icone cx-fechar" aria-label="Fechar o painel do CRATOS">${SVG_FECHAR}</button>
    </div>
    <div class="cx-menu" id="cx-menu" role="group" aria-label="Mais opções" hidden></div>
    <div class="cx-sr" id="cx-anuncio" role="status" aria-live="polite" aria-atomic="true"></div>
    <div class="cx-corpo"><div class="cx-vazio">Clique no ícone para capturar o processo.</div></div>
  `);

  /* 2.0: botão e painel moram num shadow DOM ABERTO, pendurado num host próprio.
     O CSS do PJe não alcança nada aqui dentro e o nosso não vaza para a página.
     "Aberto" porque o leitor de tela e os testes precisam enxergar a árvore; o
     isolamento que interessa é o de estilo, não o de acesso.
     O CSS entra como texto (comum/tema.js + conteudo/painel-estilo.js): nenhum
     arquivo da extensão fica exposto à página. */
  const host = document.createElement("cratos-raiz");
  const raiz = host.attachShadow({ mode: "open" });
  const estilo = document.createElement("style");
  estilo.textContent = (globalThis.CratosTema ? CratosTema.css() + "\n" : "") +
    (globalThis.CratosPainelEstilo || "");
  raiz.appendChild(estilo);
  raiz.appendChild(botao);
  raiz.appendChild(painel);
  document.body.appendChild(host);

  const corpo = painel.querySelector(".cx-corpo");
  let partesAtuais = [];
  let processoAtual = null;
  let ligado = true;   // chave liga/desliga da extensão (padrão ligado)
  painel.querySelector(".cx-fechar").onclick = () => fecharPainel();

  /* ── Auto-scroll "grudar no fim inteligente" ──────────────────────────────
     O elemento que ROLA é o próprio <cratos-painel> (overflow-y:auto + max-height),
     não o .cx-corpo. Quando chega conteúdo novo (passo da fila, certidão, aviso),
     o painel rola sozinho pro fim — MAS só se você já estava no fim. Se rolou pra
     cima pra reler algo, ele respeita e não te puxa; ao voltar pro pé, volta a
     grudar. É o comportamento de bons chats/terminais. (Pedido do Rodrigo.) */
  const LIMIAR_FIM = 24;   // px de folga para considerar "está no fim"
  let grudarNoFim = true;
  painel.addEventListener("scroll", () => {
    grudarNoFim = (painel.scrollHeight - painel.scrollTop - painel.clientHeight) <= LIMIAR_FIM;
  });
  const obsRolagem = new MutationObserver(() => {
    if (grudarNoFim) painel.scrollTop = painel.scrollHeight;
  });
  obsRolagem.observe(painel, { childList: true, subtree: true, characterData: true });

  /* ── Liga/desliga da extensão ─────────────────────────────────────────────
     O botão flutuante NUNCA some — desligado, fica esmaecido (com o ícone de
     energia) e é a porta de volta pra religar. Persiste em `extensao_ligada`
     (só `false` desliga). */
  function renderDesligado() {
    definirProcessoNoCabecalho(null);
    renderMenu();
    CratosHTML.definir(corpo, html`<div class="cx-desligado">
      <div class="cx-power-grande">${SVG_POWER}</div>
      <h2 class="cx-h2">O CRATOS está desligado</h2>
      <p class="cx-det">A extensão não vai agir nesta nem nas próximas telas. Suas Preferências continuam guardadas.</p>
      <button type="button" class="cx-acao" id="cx-religar">Ligar o CRATOS</button></div>`);
    const b = corpo.querySelector("#cx-religar");
    if (b) b.onclick = () => alternarLigado();
    cumprirFocoAoAbrir();
  }
  function aplicarEstadoLigado() {
    if (ligado) botao.removeAttribute("desligado");
    else botao.setAttribute("desligado", "");
    const p = painel.querySelector(".cx-power");
    if (p) {
      /* 2.0: botão de alternância de verdade (aria-pressed); a cor vem do tema. */
      p.classList.toggle("cx-off", !ligado);
      p.setAttribute("aria-pressed", String(ligado));
      p.setAttribute("aria-label", "CRATOS ligado");
      p.title = ligado ? "CRATOS ligado — clique para desligar"
                       : "CRATOS desligado — clique para ligar";
      const t = p.querySelector(".cx-power-txt");
      if (t) t.textContent = ligado ? "Ligado" : "Desligado";
    }
    if (painel.hasAttribute("aberto")) {
      if (ligado) mostrarConteudo(); else renderDesligado();
    }
  }
  async function alternarLigado() {
    ligado = !ligado;
    try { await Store.set("extensao_ligada", ligado); } catch (e) {}
    aplicarEstadoLigado();
  }
  painel.querySelector(".cx-power").onclick = (e) => { e.stopPropagation(); alternarLigado(); };
  Store.get("extensao_ligada").then((v) => { ligado = v !== false; aplicarEstadoLigado(); }).catch(() => {});
  Store.onChange("extensao_ligada", (v) => { ligado = v !== false; aplicarEstadoLigado(); });

  /* ═══ 2.0 — CABEÇALHO, TEMA E MENU "⋯" ═══════════════════════════════════════
     O número do processo fica no cabeçalho (some quando não há processo). O tema vem
     da chave `aparencia` ({ tema: "escuro" | "claro" | "alto-contraste" | "sistema" });
     as Preferências (1.99.2) gravam a mesma chave. O menu "⋯" junta o que não é do
     dia a dia: disponibilidade, novidades, alto contraste, atalhos e Preferências. */
  function cnjFmt(n) {
    const d = String(n || "").replace(/\D/g, "");
    if (d.length !== 20) return String(n || "");
    return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16)}`;
  }
  function definirProcessoNoCabecalho(proc) {
    const el = painel.querySelector("#cx-proc-num");
    if (!el) return;
    const num = proc && (proc.numero || proc.id);
    if (!num) { el.textContent = ""; return; }
    CratosHTML.definir(el, html`<span class="cx-sr">Processo </span>${cnjFmt(num)}`);
  }

  let prefTema = "escuro";
  let temaAnterior = "escuro";
  function aplicarTema() {
    if (!globalThis.CratosTema) return;
    CratosTema.aplicar(painel, CratosTema.resolver(prefTema));
    const b = painel.querySelector("#cx-menu-contraste");
    if (b) b.setAttribute("aria-pressed", String(painel.classList.contains("t-hc")));
  }
  function lerAparencia(a) {
    const v = a || {};
    prefTema = (globalThis.CratosTema && CratosTema.PREFS.includes(v.tema)) ? v.tema : "escuro";
    temaAnterior = (globalThis.CratosTema && CratosTema.PREFS.includes(v.temaAnterior)) ? v.temaAnterior : "escuro";
    aplicarTema();
  }
  aplicarTema();
  Store.get("aparencia").then(lerAparencia).catch(() => {});
  try { Store.onChange("aparencia", lerAparencia); } catch (e) { /* nada */ }
  try {
    for (const q of ["(prefers-color-scheme: light)", "(prefers-contrast: more)"]) {
      const m = window.matchMedia && window.matchMedia(q);
      if (m && m.addEventListener) m.addEventListener("change", () => { if (prefTema === "sistema") aplicarTema(); });
    }
  } catch (e) { /* nada */ }
  async function alternarContraste() {
    const hc = painel.classList.contains("t-hc");
    const novo = hc ? (temaAnterior === "alto-contraste" ? "escuro" : temaAnterior) : "alto-contraste";
    const dado = { tema: novo, temaAnterior: hc ? temaAnterior : prefTema };
    lerAparencia(dado);
    try { await Store.set("aparencia", dado); } catch (e) { /* nada */ }
  }

  const menu = painel.querySelector("#cx-menu");
  const botaoMais = painel.querySelector("#cx-mais");
  function abrirMenu() {
    menu.hidden = false;
    botaoMais.setAttribute("aria-expanded", "true");
    const primeiro = menu.querySelector("button, select, a[href]");
    if (primeiro) primeiro.focus();
  }
  function fecharMenu(devolverFoco) {
    if (menu.hidden) return;
    menu.hidden = true;
    botaoMais.setAttribute("aria-expanded", "false");
    if (devolverFoco) botaoMais.focus();
  }
  botaoMais.onclick = (e) => { e.stopPropagation(); if (menu.hidden) abrirMenu(); else fecharMenu(false); };
  menu.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); fecharMenu(true); }
  });
  painel.addEventListener("click", (e) => {
    if (menu.hidden) return;
    const caminho = e.composedPath ? e.composedPath() : [];
    if (caminho.includes(menu) || caminho.includes(botaoMais)) return;
    fecharMenu(false);
  });
  /* O ponto no "⋯" avisa que há algo novo lá dentro (hoje: novidades da versão). */
  function marcarPontoMenu(sim, texto) {
    const pt = painel.querySelector("#cx-mais-ponto"), sr = painel.querySelector("#cx-mais-sr");
    if (pt) pt.hidden = !sim;
    if (sr) sr.textContent = sim ? ", " + (texto || "há novidades") : "";
  }
  function alternarArea(botaoId, areaId) {
    const b = menu.querySelector("#" + botaoId), a = menu.querySelector("#" + areaId);
    if (!b || !a) return;
    b.onclick = () => {
      const abrir = a.hidden;
      a.hidden = !abrir;
      b.setAttribute("aria-expanded", String(abrir));
    };
  }

  function renderMenu() {
    const disp = DISP_IDS.filter(convLigado);
    CratosHTML.definir(menu, html`
      <div id="cx-menu-novidades"></div>
      ${disp.length ? html`<button type="button" class="cx-menu-item" id="cx-menu-disp" aria-expanded="false" aria-controls="cx-menu-disp-area">Verificar disponibilidade de um convênio</button>
      <div class="cx-menu-area" id="cx-menu-disp-area" hidden>
        <label class="cx-rotulo-campo" for="cx-disp-conv">Convênio</label>
        <select id="cx-disp-conv" class="cx-campo">
          ${disp.map((id) => html`<option value="${id}">${(CONVENIOS.find((c) => c.id === id) || { label: id }).label}</option>`)}
        </select>
        <button type="button" class="cx-acao cx-sec" id="cx-disp-verificar">Verificar disponibilidade</button>
        <div class="cx-status" id="cx-disp-status"></div>
      </div>` : ""}
      <button type="button" class="cx-menu-item" id="cx-menu-contraste" aria-pressed="false">Alto contraste</button>
      <button type="button" class="cx-menu-item" id="cx-menu-atalhos" aria-expanded="false" aria-controls="cx-menu-atalhos-area">Atalhos de teclado</button>
      <ul class="cx-menu-area cx-atalhos" id="cx-menu-atalhos-area" hidden>
        <li><kbd>Alt+Shift+C</kbd> abre o CRATOS e põe o foco nele (troque em "Gerenciar atalhos de extensões" do Firefox)</li>
        <li><kbd>←</kbd> <kbd>→</kbd> trocam de aba (com o foco nas abas)</li>
        <li><kbd>Esc</kbd> fecha este menu; de novo, fecha o painel</li>
      </ul>
      <button type="button" class="cx-menu-item" id="cx-menu-pref">Preferências</button>`);
    alternarArea("cx-menu-disp", "cx-menu-disp-area");
    alternarArea("cx-menu-atalhos", "cx-menu-atalhos-area");
    const ligar = (sel, fn) => { const b = menu.querySelector(sel); if (b) b.onclick = fn; };
    ligar("#cx-disp-verificar", verificarDisponibilidade);
    ligar("#cx-menu-contraste", alternarContraste);
    ligar("#cx-menu-pref", () => {
      fecharMenu(false);
      browser.runtime.sendMessage({ tipo: "abrir_preferencias" }).catch(() => {});
    });
    aplicarTema();
  }

  function fecharPainel() {
    fecharMenu(false);
    painel.removeAttribute("aberto");
    botao.setAttribute("aria-expanded", "false");
  }

  /* Dispara a consulta: monta o plano com as partes marcadas e pede ao background
     para abrir o eCAC em aba nova e registrar. (Pedaço 2c — teste de registro.) */
  async function executarConsulta() {
    const marcadas = Array.from(corpo.querySelectorAll(".cx-sel-parte:checked"))
      .map((el) => partesAtuais[parseInt(el.dataset.idx)]);
    const querInfojud = corpo.querySelector("#cx-conv-infojud")?.checked;
    const status = corpo.querySelector("#cx-status");

    if (!marcadas.length) { status.textContent = "Selecione ao menos uma parte."; return; }
    if (!querInfojud) { status.textContent = "Marque um convênio."; return; }

    // pega a config salva do infojud e mapeia as partes para o formato do eCAC
    const cfgTudo = (await Store.get(CHAVES.config)) || {};
    const cfg = cfgTudo.infojud || {};
    const partesMapeadas = marcadas.map((p) => ({
      processo: processoAtual?.numero || "",
      nome: p.nome,
      nomeAbrev: doisPrimeirosNomesPainel(p.nome),
      ni: String(p.cpfcnpj || "").replace(/\D/g, ""),
      tipo: p.tipoPessoa === "juridica" ? "CNPJ" : "CPF",
    }));

    status.textContent = "Abrindo eCAC em nova aba…";
    const r = await browser.runtime.sendMessage({
      tipo: "abrirEcacERegistrar",
      plano: { partes: partesMapeadas, config: cfg },
    });
    status.textContent = r?.ok
      ? `eCAC aberto. Registrando ${r.total} parte(s) — acompanhe na nova aba.`
      : "Falha ao abrir o eCAC.";
  }

  function doisPrimeirosNomesPainel(nome) {
    const t = (nome || "").trim().split(/\s+/).filter((x) => !x.includes("."));
    return t.slice(0, 2).join(" ");
  }

  // Abrir/fechar o painel — mas só em CLIQUE (não quando o gesto foi arraste).
  function alternarPainel() {
    if (painel.hasAttribute("aberto")) { fecharPainel(); return; }
    painel.setAttribute("aberto", "");
    botao.setAttribute("aria-expanded", "true");
    posicionarPainel();
    if (!ligado) { renderDesligado(); return; }
    mostrarConteudo();
  }
  /* 2.0: reabrir (ou religar) no MESMO processo não recaptura — a fila em andamento,
     as coletas e a aba escolhida continuam onde estavam. */
  function mostrarConteudo() {
    const id = detectarIdProcesso();
    if (id && processoAtual && painelDaAba("situacao") && String(processoAtual.id) === String(id)) { cumprirFocoAoAbrir(); return; }
    capturar();
  }

  /* ── Arraste do botão flutuante (mouse e toque) + persistência ──────────────
     Outras extensões ocupam o mesmo canto; o usuário pode reposicionar o botão.
     A posição fica salva em cratos:botao_pos e sobrevive a recarregar/navegar. */
  const POS_KEY = "botao_pos";
  let arrasto = null;

  function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }

  function aplicarPosicaoBotao(left, top) {
    const w = botao.offsetWidth || 56, h = botao.offsetHeight || 56;
    const L = clamp(left, 0, Math.max(0, window.innerWidth - w));
    const T = clamp(top, 0, Math.max(0, window.innerHeight - h));
    botao.style.left = L + "px";
    botao.style.top = T + "px";
    botao.style.right = "auto";
    botao.style.bottom = "auto";
  }

  // Ancora o painel ao botão, mas SEMPRE inteiro na tela (opção B).
  // Mede o tamanho real do painel (após render) e escolhe o lado que couber:
  // tenta abaixo do botão; se não couber, acima; alinha à direita do botão e,
  // se transbordar, à esquerda. No fim, prende tudo à viewport com margem.
  function posicionarPainel() {
    // Garante que o painel esteja medível (visível) antes de medir
    const medir = () => {
      const r = botao.getBoundingClientRect();
      const margem = 8;
      const gap = 10;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const pw = painel.offsetWidth || 360;
      const ph = painel.offsetHeight || 420;

      // ── Vertical: cabe abaixo? senão acima; senão o que tiver mais espaço ──
      const espacoAbaixo = vh - r.bottom - gap;
      const espacoAcima = r.top - gap;
      let top;
      if (ph <= espacoAbaixo) {
        top = r.bottom + gap;                 // abre abaixo
      } else if (ph <= espacoAcima) {
        top = r.top - ph - gap;               // abre acima
      } else {
        // não cabe inteiro em nenhum lado: cola na borda com mais espaço
        top = (espacoAbaixo >= espacoAcima) ? r.bottom + gap : Math.max(margem, r.top - ph - gap);
      }

      // ── Horizontal: alinha borda direita do painel à do botão; se sair pela
      //    esquerda, alinha pela esquerda do botão ──
      let left = r.right - pw;
      if (left < margem) left = r.left;       // tenta alinhar pela esquerda
      // Prende definitivamente na viewport
      left = clamp(left, margem, Math.max(margem, vw - pw - margem));
      top = clamp(top, margem, Math.max(margem, vh - ph - margem));

      painel.style.left = left + "px";
      painel.style.top = top + "px";
      painel.style.right = "auto";
      painel.style.bottom = "auto";
    };
    // Duas passadas: uma imediata (posiciona algo) e outra no próximo frame,
    // quando o conteúdo já renderizou e o tamanho real está disponível.
    medir();
    requestAnimationFrame(medir);
  }

  // Reposiciona automaticamente sempre que o conteúdo do painel mudar de tamanho
  // (troca de tela: modo → lista de convênios → progresso) e ao redimensionar a janela.
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => {
      if (painel.hasAttribute("aberto")) posicionarPainel();
    });
    ro.observe(painel);
  }
  window.addEventListener("resize", () => {
    if (painel.hasAttribute("aberto")) posicionarPainel();
  });

  botao.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!painel.hasAttribute("aberto")) focarAoAbrir = true;
      alternarPainel();
    }
  });
  botao.addEventListener("pointerdown", (e) => {
    const r = botao.getBoundingClientRect();
    arrasto = { x0: e.clientX, y0: e.clientY, offX: e.clientX - r.left, offY: e.clientY - r.top, moveu: false };
    try { botao.setPointerCapture(e.pointerId); } catch (_) {}
  });
  botao.addEventListener("pointermove", (e) => {
    if (!arrasto) return;
    if (!arrasto.moveu && Math.hypot(e.clientX - arrasto.x0, e.clientY - arrasto.y0) < 4) return;
    arrasto.moveu = true;
    aplicarPosicaoBotao(e.clientX - arrasto.offX, e.clientY - arrasto.offY);
    if (painel.hasAttribute("aberto")) posicionarPainel();
  });
  botao.addEventListener("pointerup", async (e) => {
    if (!arrasto) return;
    const moveu = arrasto.moveu;
    try { botao.releasePointerCapture(e.pointerId); } catch (_) {}
    arrasto = null;
    if (moveu) {
      const r = botao.getBoundingClientRect();
      try { await Store.set(POS_KEY, { left: r.left, top: r.top }); } catch (_) {}
    } else {
      alternarPainel();   // foi clique de verdade
    }
  });

  // Restaura a posição salva (se houver) ao injetar.
  (async () => {
    try { const p = await Store.get(POS_KEY); if (p) aplicarPosicaoBotao(p.left, p.top); } catch (_) {}
  })();

  /* 2.0: uma captura por vez — abrir o painel na carga da página e o liga/desliga lido
     do storage chegavam juntos e capturavam duas vezes. */
  let capturaEmCurso = null;
  function capturar() {
    if (!capturaEmCurso) capturaEmCurso = capturarAgora().finally(() => { capturaEmCurso = null; });
    return capturaEmCurso;
  }
  async function capturarAgora() {
    await usoPronto;
    const id = detectarIdProcesso();
    const numero = detectarNumeroProcesso();
    if (!id) {
      renderSemProcesso();      // 1.9.4: aqui mora o lote "Coletar respostas SAB"
      return;
    }
    corpo.innerHTML = `<div class="cx-vazio">Capturando dados do processo…</div>`;

    const base = location.origin; // ex.: https://pje.trt18.jus.br
    const r = await browser.runtime.sendMessage({ tipo: "capturar", base, idProcesso: id, numeroProcesso: numero });

    if (!r || !r.ok) {
      CratosHTML.definir(corpo, html`<div class="cx-erro">Falha na captura: ${r?.erro || "erro desconhecido"}</div>`);
      return;
    }
    renderProcesso(r.processo);
  }

  /* ── ORQUESTRADOR ────────────────────────────────────────────────────────
     Convênios disponíveis. "disponivel" = módulo implementado nesta versão.
     Ordem padrão = ordem canônica; o usuário ajusta com ▲▼ e a ordem é salva. */
  const CONVENIOS = [
    { id: "SAB",      label: "SAB (Bloqueio)",   tipo: "interativo",  ops: ["inclusao","baixa"],  disponivel: true  },
    { id: "INFOJUD",  label: "INFOJUD (eCAC)",   tipo: "automatico",  ops: ["consulta"],           disponivel: true  },
    { id: "RENAJUD",  label: "RENAJUD",           tipo: "interativo",  ops: ["inclusao","baixa"],  disponivel: true  },
    { id: "CNIB",     label: "CNIB (Indisponibilidade)", tipo: "interativo", ops: ["inclusao","baixa"], disponivel: true },
    { id: "CENSEC",   label: "CENSEC (Escrituras/Procurações)", tipo: "interativo", ops: ["consulta"], disponivel: true },
    { id: "SERASAJUD",label: "SerasaJUD (Negativação)", tipo: "interativo", ops: ["inclusao","baixa"], disponivel: true },
    /* CCS (Bacen): consulta — aparece na INCLUSÃO, como CENSEC/INFOJUD. A coleta das
       respostas (dias depois) é o botão "Coletar CCS" da tela inicial. */
    { id: "CCS",      label: "CCS (Bacen — relacionamentos)", tipo: "interativo", ops: ["consulta"], disponivel: true },
    /* SNIPER (CNJ): investigação patrimonial — consulta, na INCLUSÃO. A aba NÃO está no
       HOST_CONVENIO: quem a fecha é o próprio content script, e só no SUCESSO (1.7.2) — em
       falha ela fica aberta para conferência. */
    { id: "SNIPER",   label: "SNIPER (investigação patrimonial)", tipo: "interativo", ops: ["consulta"], disponivel: true },
    /* PREVJUD (CNJ/INSS): Dossiê Previdenciário — consulta, na INCLUSÃO. Os dossiês que não
       ficarem prontos em 15 min são buscados depois pelo botão "Coletar PREVJUD". */
    { id: "PREVJUD",  label: "PREVJUD (Dossiê Previdenciário)", tipo: "interativo", ops: ["consulta"], disponivel: true },
  ];
  const CHAVE_ORDEM = "orquestra_ordem";
  let modoAtual = null;   // "inclusao" | "baixa" — sem persistência (escolha consciente)
  /* Partes marcadas na PRIMEIRA tela, congeladas no clique de INCLUSÃO/BAIXA.
     Precisa ser guardado aqui: renderListaConvenios() troca o innerHTML do painel
     e os checkboxes .cx-sel-parte deixam de existir. Antes a leitura era feita só
     na hora de executar — vinha vazia e caía no fallback "todas as partes", que
     mandava para o convênio gente que o usuário tinha desmarcado. */
  let partesSelecionadas = [];
  let ordemAtual = CONVENIOS.map(c => c.id);
  let orquestraFila = [];
  let orquestraIniciadaEm = 0;
  let orquestraIdx = 0;
  /* Ledger da execução: uma linha por convênio rodado, com o desfecho. É o que o
     relatório de fim de fila lê. Zerado a cada nova execução. */
  let orquestraLedger = [];
  /* 1.9.3 — convênios já devolvidos ao fim da fila nesta execução (um "Refazer" por
     convênio: sem laço). Zerado a cada nova execução. */
  let orquestraRefeitos = new Set();
  /* MARCO IRREVERSÍVEL (1.9.3). Cada convênio grava `orq_marco` no ponto a partir do
     qual o pedido PODE ter chegado ao sistema (o CRATOS clicou em enviar, ou entregou o
     formulário pronto para você confirmar). Ato com marco = "Refazer" BLOQUEADO (decisão
     do Rodrigo, 10/11: nada de ordem em dobro); consulta com marco = Refazer avisa que
     registra outro pedido. Sem marco = nada saiu. */
  const CHAVE_MARCO = "orq_marco";

  /* Chave do PULSO DE CONCLUSÃO. Cada convênio (menos o SAB, que já usa
     `sab_estado`) grava aqui, no ponto onde emite a certidão, um objeto
     { convenio, numProcesso, feitos, esperados, ok, motivo, em }. O painel ouve
     por Store.onChange e avança sozinho quando o pulso diz "completo e limpo".
     Sinal AUSENTE degrada para o botão manual — nunca para pulo indevido. */
  const CHAVE_CONV_FEITO = "orq_conv_feito";
  /* 1.9.0: convênios com verificação de disponibilidade (endereços em modulos/disponibilidade.js) */
  const DISP_IDS = ["INFOJUD", "RENAJUD", "CNIB", "CENSEC", "SERASAJUD", "CCS", "SNIPER", "PREVJUD"];
  const tempos = { vigiaMs: 3 * 60 * 1000 };

  // Carrega ordem salva (se houver)
  Store.get(CHAVE_ORDEM).then(o => { if (Array.isArray(o) && o.length) ordemAtual = o; }).catch(() => {});

  /* 1.9.4 — CONVÊNIOS EM USO (comum/convenios-uso.js): desligado nas Preferências (ou o
     SAB fora dos TRTs em que existe) some da fila, dos botões de coleta, do lote e da
     disponibilidade. A configuração é relida a cada mudança. */
  const USO = globalThis.CratosConveniosUso;
  let cfgUso = {};
  const usoPronto = Store.get(CHAVES.config).then((c) => { cfgUso = c || {}; }).catch(() => {});
  try { Store.onChange(CHAVES.config, (c) => { cfgUso = c || {}; }); } catch (e) { /* nada */ }
  const convLigado = (id) => !USO || USO.ligado(cfgUso, id, location.origin);

  function conveniosOrdenados() {
    return conveniosTodosOrdenados().filter((c) => convLigado(c.id));
  }
  function conveniosTodosOrdenados() {
    return ordemAtual
      .map(id => CONVENIOS.find(c => c.id === id))
      .filter(Boolean)
      .concat(CONVENIOS.filter(c => !ordemAtual.includes(c.id)));
  }

  function renderProcesso(proc) {
    if (!proc || proc.erro) {
      corpo.innerHTML = `<div class="cx-erro">Erro ao capturar.</div>`;
      return;
    }
    const partes = proc.partes || [];
    if (!partes.length) {
      CratosHTML.definir(corpo, html`<div class="cx-vazio">Processo ${proc.numero || proc.id} capturado, mas sem partes reconhecidas.</div>`);
      return;
    }

    const outro = !processoAtual || String(processoAtual.numero || processoAtual.id) !== String(proc.numero || proc.id);
    partesAtuais = partes;
    processoAtual = proc;
    if (outro) {
      /* Processo novo: nada do anterior fica marcado. Polo ATIVO nasce desmarcado (a
         execução mira o EXECUTADO); passivo e polo desconhecido nascem marcados. */
      selPartes = partes.map((p) => !/ativ/i.test(p.polo || ""));
      selConv.inclusao = new Set();
      selConv.baixa = new Set();
      if (!filaRodando) { filaNaAba = null; abaAtual = "situacao"; }
    }
    modoAtual = null;
    registrarAbaDoProcesso(proc.numero);
    renderModoSelecao();
  }

  /* ═══ DADOS SÓ ENQUANTO A ABA ESTIVER ABERTA (1.9.0) ═══════════════════════════
     O fundo apaga os dados do processo quando esta aba fecha (modulos/limpeza.js).
     Se o CRATOS gerou arquivo que ainda não foi juntado, fechar a aba pede
     confirmação (decisão do Rodrigo, 22/10: "o servidor que refaça tudo se der essa
     bobeira. Basta avisar"). */
  let pendenteJuntada = false;
  let offDiario = null;
  async function registrarAbaDoProcesso(numero) {
    const dig = String(numero || "").replace(/\D/g, "");
    if (dig.length !== 20) return;
    try { await browser.runtime.sendMessage({ tipo: "processo_aba", numProcesso: numero }); } catch (e) { /* nada */ }
    if (offDiario) { try { offDiario(); } catch (e) { /* nada */ } }
    const avaliar = (d) => { pendenteJuntada = !!(d && (d.itens || []).some((it) => !it.juntadoEm && !it.substituidoEm)); };
    try { avaliar(await Store.get("diario:" + dig)); } catch (e) { /* nada */ }
    offDiario = Store.onChange("diario:" + dig, avaliar);
  }
  window.addEventListener("beforeunload", (ev) => {
    if (!pendenteJuntada) return;
    ev.preventDefault();
    ev.returnValue = "O CRATOS gerou arquivos deste processo que ainda não foram juntados. Ao fechar a aba, eles se perdem.";
    return ev.returnValue;
  });

  /* ═══ 2.0 — LEITOR DE TELA ═══════════════════════════════════════════════════
     Um só anunciador (role=status, polite) fala o que muda sem o foco ir até lá: o
     passo da fila, o fim dela, a Situação lida. O que ele fala é só convênio,
     situação e passo. NUNCA CPF, CNPJ ou valores: quem está em volta ouve. O filtro
     abaixo é a segunda trava (a primeira é não montar a frase com esses dados). */
  function limparFala(t) {
    return String(t || "")
      .replace(/R\$\s*[\d.,]+/g, "")
      .replace(/\d{3}\.\d{3}\.\d{3}-\d{2}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{11,}/g, "")
      .replace(/[\u2190-\u2BFF\uFE0F]|\uD83C[\uDF00-\uDFFF]|\uD83D[\uDC00-\uDEFF]|\uD83E[\uDD00-\uDEFF]/g, "")
      .replace(/\s+/g, " ").replace(/\s+([.,:;])/g, "$1").trim();
  }
  let timerAnuncio = null;
  let falaPendente = "";
  function anunciar(texto) {
    const el = painel.querySelector("#cx-anuncio");
    const t = limparFala(texto);
    if (!el || !t) return;
    /* Esvazia e escreve depois: a mesma frase duas vezes seguidas também é falada.
       Frases que chegam juntas (início da fila + primeiro passo) vão juntas. */
    falaPendente = falaPendente ? falaPendente + " " + t : t;
    el.textContent = "";
    clearTimeout(timerAnuncio);
    timerAnuncio = setTimeout(() => { el.textContent = falaPendente; falaPendente = ""; }, 60);
  }
  /* O foco só é puxado quando já está no painel (ou quando a pessoa abriu pelo
     teclado): nunca tirar a pessoa do meio do PJe. */
  const focoNoPainel = () => !!raiz.activeElement;
  let focarAoAbrir = false;
  function focarPrimeiro() {
    const alvo = corpo.querySelector('[role="tab"][aria-selected="true"]') ||
      corpo.querySelector("button:not([disabled]), input, select") || painel.querySelector(".cx-power");
    if (alvo) alvo.focus();
  }
  function cumprirFocoAoAbrir() {
    if (!focarAoAbrir) return;
    focarAoAbrir = false;
    focarPrimeiro();
  }
  /* Esc dentro do painel (fora do menu e do diálogo, que tratam o seu) fecha o painel
     e devolve o foco ao botão flutuante. */
  painel.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    e.preventDefault();
    fecharPainel();
    botao.focus();
  });
  /* Atalho Alt+Shift+C (commands do manifesto → fundo → esta aba). */
  function abrirPorAtalho() {
    if (painel.hasAttribute("aberto")) { focarPrimeiro(); return; }
    focarAoAbrir = true;
    alternarPainel();
  }
  browser.runtime.onMessage.addListener((msg) => {
    if (msg && msg.tipo === "cratos_atalho") { abrirPorAtalho(); return Promise.resolve({ ok: true }); }
    return undefined;
  });

  /* ═══ 2.0 — AS QUATRO ABAS ═══════════════════════════════════════════════════
     Situação / Incluir / Baixar / Coletar, no padrão de abas do WAI-ARIA: só a aba
     selecionada entra no Tab; ← → Home End trocam de aba.

     Situação e Coletar são desenhadas uma vez por processo e só escondidas (as
     coletas escrevem no próprio quadro enquanto você olha outra aba). Incluir e
     Baixar são formulários: só o da aba aberta existe na tela (não há dois
     conjuntos de caixas com a mesma classe), e o que você marcou fica guardado
     aqui ao trocar de aba. Quando uma fila começa, o formulário da aba vira a
     linha do tempo da fila (#cx-progresso) e fica assim até "Nova seleção". */
  const ABAS = [
    { id: "situacao", rotulo: "Situação" },
    { id: "incluir", rotulo: "Incluir" },
    { id: "baixar", rotulo: "Baixar" },
    { id: "coletar", rotulo: "Coletar" },
  ];
  let abaAtual = "situacao";
  let filaNaAba = null;     // "inclusao" | "baixa": a aba que mostra uma fila (rodando ou o relatório)
  let filaRodando = false;
  const selConv = { inclusao: new Set(), baixa: new Set() };
  let selPartes = [];       // um booleano por parte (índice de partesAtuais)

  const modoDaAba = (aba) => (aba === "incluir" ? "inclusao" : aba === "baixar" ? "baixa" : null);
  const abaDoModo = (m) => (m === "baixa" ? "baixar" : "incluir");
  const painelDaAba = (aba) => corpo.querySelector("#cx-p-" + aba);
  const NOME_MODO = { inclusao: "inclusão", baixa: "baixa" };

  function montarAbas() {
    if (painelDaAba("situacao")) return;
    CratosHTML.definir(corpo, html`
      <div class="cx-abas" role="tablist" aria-label="Seções do CRATOS">
        ${ABAS.map((a) => html`<button type="button" role="tab" class="cx-aba" id="cx-aba-${a.id}" aria-controls="cx-p-${a.id}" aria-selected="false" tabindex="-1">${a.rotulo}</button>`)}
      </div>
      ${ABAS.map((a) => html`<section class="cx-aba-p" role="tabpanel" id="cx-p-${a.id}" aria-labelledby="cx-aba-${a.id}" tabindex="-1" hidden></section>`)}`);
    corpo.querySelectorAll(".cx-aba").forEach((b, i) => {
      b.onclick = () => irAba(ABAS[i].id);
      b.onkeydown = (e) => {
        const n = ABAS.length;
        const j = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i + n - 1) % n
          : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : null;
        if (j === null) return;
        e.preventDefault();
        irAba(ABAS[j].id, true);
      };
    });
  }

  /* Guarda o que está marcado no formulário aberto antes de ele sair da tela. */
  function guardarSelecao() {
    const m = modoDaAba(abaAtual);
    const p = m && painelDaAba(abaAtual);
    if (!p || filaNaAba === m) return;
    const convs = p.querySelectorAll(".cx-sel-conv");
    if (convs.length) selConv[m] = new Set(Array.from(convs).filter((c) => c.checked).map((c) => c.dataset.id));
    p.querySelectorAll(".cx-sel-parte").forEach((c) => { selPartes[parseInt(c.dataset.idx)] = c.checked; });
  }

  function irAba(aba, focar) {
    montarAbas();
    guardarSelecao();
    abaAtual = ABAS.some((a) => a.id === aba) ? aba : "situacao";
    for (const a of ABAS) {
      const b = corpo.querySelector("#cx-aba-" + a.id), p = painelDaAba(a.id);
      const sel = a.id === abaAtual;
      b.setAttribute("aria-selected", String(sel));
      b.tabIndex = sel ? 0 : -1;
      p.hidden = !sel;
    }
    for (const a of ["incluir", "baixar"]) {
      const m = modoDaAba(a);
      if (filaNaAba === m) continue;              // a fila (ou o relatório dela) fica
      if (a === abaAtual) renderForm(m);
      else CratosHTML.definir(painelDaAba(a), html``);
    }
    /* Aba nova começa do topo; o "grudar no fim" é da linha do tempo da fila. */
    grudarNoFim = filaNaAba === modoDaAba(abaAtual) && filaRodando;
    if (!grudarNoFim) painel.scrollTop = 0;
    if (focar) { const b = corpo.querySelector("#cx-aba-" + abaAtual); if (b) b.focus(); }
  }

  /* Tela do processo: monta as abas, desenha Situação e Coletar e abre na Situação. */
  function renderModoSelecao() {
    renderMenu();
    definirProcessoNoCabecalho(processoAtual);
    if (!painelDaAba("situacao")) { filaNaAba = null; filaRodando = false; }
    montarAbas();
    renderSituacao();
    renderColetar();
    irAba(abaAtual);
    mostrarNovidades();
    cumprirFocoAoAbrir();
  }

  /* ── Situação: uma linha por convênio em uso (comum/situacao.js monta a linha) ──
     Lê sozinha, ao abrir o processo, as quatro fontes: pendências de configuração; o
     diário desta aba (pronto para juntar) e as falhas da fila desta aba; o SAB ao vivo;
     e os eventos (histórico sem dado de parte + linha do tempo do PJe).
     REGRA DE FERRO: fonte que não respondeu nunca vira "nada": o SAB que não leu é
     "não obtido", e a linha do tempo que não leu gera um aviso no topo. */
  let geracaoSit = 0;
  const comPrazo = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("tempo esgotado")), ms))]);
  const CHIP_SIT = {
    pendente: "cx-chip-pd", pronto: "cx-chip-ac", naoobtido: "cx-chip-tracejado", aguardando: "cx-chip-wt",
    juntado: "cx-chip-ok", incluido: "cx-chip-ok", baixado: "cx-chip-ok", consultado: "cx-chip-ok",
    indisponivel: "cx-chip-er", semregistro: "cx-chip-neutro",
  };
  /* Convênios cuja resposta se colhe depois (aba Coletar) — e o SAB. */
  const COLETAVEIS = { INFOJUD: "cx-localizar", CCS: "cx-coletar-ccs", PREVJUD: "cx-coletar-prevjud", SAB: "cx-coletar-sab" };

  async function lerFontesSituacao(proc) {
    const numero = proc.numero || "";
    const dig = String(numero).replace(/\D/g, "");
    const idPJe = proc.idProcesso || proc.id;
    const f = { convenios: conveniosOrdenados().map((c) => c.id), pendencias: {}, sessao: { prontos: {}, falhas: {} }, sab: null, eventos: [] };
    const avisos = [];

    /* 1. pendências de configuração */
    try {
      const cfg = (await Store.get(CHAVES.config)) || {};
      if (convLigado("INFOJUD") && !String((cfg.infojud || {}).vara || "").trim()) f.pendencias.INFOJUD = "Vara do e-CAC não configurada";
    } catch (e) { /* sem config: nada pendente a dizer */ }

    /* 2. esta aba: o diário (o que ainda não foi juntado) e as falhas da fila */
    try {
      const d = await Store.get("diario:" + dig);
      for (const it of ((d && d.itens) || [])) {
        if (it.juntadoEm || it.substituidoEm) continue;
        const c = String(it.convenio || "").toUpperCase();
        if (c) f.sessao.prontos[c] = (f.sessao.prontos[c] || 0) + 1;
      }
    } catch (e) { /* nada */ }
    for (const e of orquestraLedger) {
      if (["erro", "trava", "indisponivel"].includes(e.status)) f.sessao.falhas[e.id] = e.detalhe || "Falhou nesta aba";
      else if (e.status === "ok") delete f.sessao.falhas[e.id];
    }

    /* 3 e 4. eventos e SAB — em paralelo, cada um com prazo */
    const cli = (typeof SAB !== "undefined" && SAB) ? SAB.cliente() : null;
    const pHist = comPrazo(browser.runtime.sendMessage({ tipo: "historico_ler", numProcesso: numero }), 8000)
      .then((r) => { for (const e of ((r && r.eventos) || [])) f.eventos.push(e); })
      .catch(() => avisos.push("Não consegui ler o histórico do CRATOS deste processo."));
    let timeline = null;
    const pAutos = cli && idPJe
      ? comPrazo(cli.timeline(idPJe), 10000)
        .then((t) => { timeline = t; for (const e of CratosSituacao.eventosDosAutos(t)) f.eventos.push(e); })
        .catch(() => avisos.push("Não consegui ler a linha do tempo do PJe agora; o que o CRATOS juntou nos autos pode não aparecer."))
      : Promise.resolve();
    await Promise.all([pHist, pAutos]);

    if (cli && convLigado("SAB")) {
      try {
        f.sab = await comPrazo((async () => {
          if (!timeline) throw new Error("sem a linha do tempo");
          const indice = SAB.indiceJuntados(timeline);
          const p = await cli.processoPorNumero(numero);
          if (!p) return { paraJuntar: 0, aguardando: 0 };
          const lista = await cli.determinacoesDoProcesso(p.id);
          let paraJuntar = 0, aguardando = 0;
          for (const d of lista) {
            if (String(d.situacao || "").toUpperCase() === "MINUTA") continue;
            const ords = await cli.ordens(d.id);
            for (const o of ords) {
              const nos = SAB.situacaoNosAutos(indice, o.numeroProtocolo, o.dataUltimoProtocolo || o.dataProtocolo);
              if (!nos && SAB.ordemJuntavel(o)) paraJuntar++;
              else if (SAB.ehAtiva(d.situacao) && String(o.situacao || "") === "ENVIADA" && !SAB.ordemJuntavel(o)) aguardando++;
            }
          }
          return { paraJuntar, aguardando };
        })(), 15000);
      } catch (e) {
        if (!f.sessao.prontos.SAB) f.sessao.falhas.SAB = "Não consegui ler o SAB agora (falha técnica, não é resposta negativa)";
      }
    }
    return { f, avisos };
  }

  async function renderSituacao() {
    const p = painelDaAba("situacao");
    if (!p) return;
    const proc = processoAtual;
    const minha = ++geracaoSit;
    if (typeof CratosSituacao === "undefined" || !proc) {
      CratosHTML.definir(p, html`<p class="cx-vazio">Situação indisponível nesta tela.</p>`);
      return;
    }
    CratosHTML.definir(p, html`<h2 class="cx-h" id="cx-h-sit">Situação neste processo</h2>
      <p class="cx-vazio" id="cx-sit-lendo" role="status">Lendo os autos, o histórico e o SAB…</p>`);
    let r;
    try { r = await lerFontesSituacao(proc); } catch (e) { r = null; }
    if (minha !== geracaoSit || !painelDaAba("situacao") || processoAtual !== proc) return;   // outra leitura passou na frente
    if (!r) {
      CratosHTML.definir(p, html`<h2 class="cx-h">Situação neste processo</h2><p class="cx-erro">Não consegui montar a situação agora. Use as outras abas normalmente.</p>
        <button type="button" class="cx-acao cx-sec" id="cx-sit-atualizar">Tentar de novo</button>`);
      p.querySelector("#cx-sit-atualizar").onclick = () => renderSituacao();
      return;
    }
    const linhas = CratosSituacao.montar(r.f);
    ultimaSituacao = linhas;
    const acao = (l) => {
      if (l.estado === "pendente") return { rotulo: "Configurar", fn: () => browser.runtime.sendMessage({ tipo: "abrir_primeiros" }).catch(() => {}) };
      if ((l.estado === "pronto" || l.estado === "naoobtido") && COLETAVEIS[l.id]) {
        return { rotulo: l.estado === "pronto" ? (l.id === "SAB" ? "Coletar e juntar" : "Juntar") : "Tentar de novo", fn: () => irParaConvenio(l.id, l.estado === "pronto" && l.id !== "SAB" ? "cx-juntar" : COLETAVEIS[l.id]) };
      }
      if (l.estado === "pronto") return { rotulo: "Juntar", fn: () => irParaConvenio(l.id, "cx-juntar") };
      if (l.estado === "naoobtido") return { rotulo: "Tentar de novo", fn: () => irParaConvenio(l.id, null) };
      return null;
    };
    const itens = linhas.map((l, i) => {
      const a = acao(l);
      return html`<li class="cx-item cx-sit" data-conv-id="${l.id}">
        <div class="cx-sit-topo"><h3 class="cx-h3">${l.nome}<span class="cx-sr">:</span></h3>
          <span class="cx-chip ${CHIP_SIT[l.estado] || "cx-chip-neutro"}">${l.estado === "pronto" && l.n ? String(l.n) + " para juntar" : l.rotulo}</span></div>
        <p class="cx-det">${l.detalhe}</p>
        ${a ? html`<button type="button" class="cx-acao cx-sec cx-mini cx-sit-acao" data-i="${String(i)}">${a.rotulo}<span class="cx-sr"> — ${l.nome}</span></button>` : ""}
      </li>`;
    });
    CratosHTML.definir(p, html`
      ${r.avisos.map((t) => html`<p class="cx-aviso" role="note">${t}</p>`)}
      <div class="cx-fila-topo"><h2 class="cx-h" id="cx-h-sit">Situação neste processo</h2>
        <button type="button" class="cx-acao cx-sec cx-mini" id="cx-sit-atualizar">Atualizar</button></div>
      ${itens.length ? html`<ul class="cx-lista" aria-labelledby="cx-h-sit">${itens}</ul>`
        : html`<p class="cx-vazio">Nenhum convênio ligado. Ligue os que você usa em Preferências → "Convênios em uso".</p>`}
      <p class="cx-nota">"Não obtido" é falha técnica, nunca resposta negativa. "Sem registro do CRATOS" quer dizer que ele não fez nem juntou nada aqui; alguém pode ter feito à mão.</p>`);
    p.querySelector("#cx-sit-atualizar").onclick = () => renderSituacao();
    p.querySelectorAll(".cx-sit-acao").forEach((b) => {
      const a = acao(linhas[Number(b.dataset.i)]);
      b.onclick = () => a && a.fn();
    });
    /* leitor de tela: só o que pede você (nome, situação, detalhe — falaDe nunca leva CPF,
       CNPJ ou valores). */
    if (painel.hasAttribute("aberto") && abaAtual === "situacao") {
      const pedem = linhas.filter((l) => ["pronto", "pendente", "naoobtido"].includes(l.estado));
      anunciar(pedem.length ? "Situação lida. " + pedem.map((l) => CratosSituacao.falaDe(l)).join(" ")
        : "Situação lida. Nada pede você agora.");
    }
    /* ponto na aba Situação: há algo pedindo você (pronto ou configuração pendente) */
    const abaSit = corpo.querySelector("#cx-aba-situacao");
    if (abaSit) {
      const pede = linhas.some((l) => l.estado === "pronto" || l.estado === "pendente");
      let pt = abaSit.querySelector(".cx-ponto-aba");
      if (pede && !pt) {
        CratosHTML.definir(abaSit, html`Situação<span class="cx-ponto-aba" aria-hidden="true"></span><span class="cx-sr">, há pendência</span>`);
      } else if (!pede && pt) {
        abaSit.textContent = "Situação";
      }
    }
  }
  let ultimaSituacao = [];

  /* Da Situação para o lugar de agir: a aba certa, com o foco no botão do convênio. */
  function irParaConvenio(conv, botaoId) {
    if (botaoId) {
      irAba("coletar");
      const b = painelDaAba("coletar") && painelDaAba("coletar").querySelector("#" + botaoId);
      if (b) b.focus();
      return;
    }
    const modo = "inclusao";                  // refazer um pedido/consulta é uma nova inclusão
    selConv[modo].add(conv);
    irAba(abaDoModo(modo));
    const cb = painelDaAba(abaDoModo(modo)).querySelector(`.cx-sel-conv[data-id="${conv}"]`);
    if (cb) cb.focus();
  }

  /* ── Coletar: as respostas que chegam depois, convênio por convênio, e a juntada ── */
  function renderColetar() {
    const p = painelDaAba("coletar");
    if (!p) return;
    const item = (nome, det, botaoId, rotulo, statusId) => html`<li class="cx-item">
        <h3 class="cx-h3">${nome}</h3>
        <p class="cx-det">${det}</p>
        <button type="button" class="cx-acao cx-sec" id="${botaoId}">${rotulo}</button>
        <div class="cx-status" id="${statusId}"></div>
      </li>`;
    const itens = [];
    if (convLigado("INFOJUD")) itens.push(item("INFOJUD", "Respostas na caixa postal do e-CAC.", "cx-localizar", "Coletar INFOJUD", "cx-status"));
    if (convLigado("CCS")) itens.push(item("CCS", "Respostas das instituições ao Banco Central.", "cx-coletar-ccs", "Coletar CCS", "cx-ccs-status"));
    if (convLigado("PREVJUD")) itens.push(item("PREVJUD", "Dossiês que ainda estavam em processamento.", "cx-coletar-prevjud", "Coletar PREVJUD", "cx-prevjud-status"));
    if (convLigado("SAB")) itens.push(item("SAB (SISBAJUD)", "Posição das ordens e transferências.", "cx-coletar-sab", "Coletar SAB", "cx-sab-status"));
    CratosHTML.definir(p, html`
      <h2 class="cx-h">Respostas por convênio</h2>
      ${itens.length ? html`<ul class="cx-lista">${itens}</ul>` : html`<p class="cx-vazio">Nenhum convênio com coleta está ligado.</p>`}
      <section class="cx-cofre" aria-labelledby="cx-h-cofre">
        <h2 class="cx-h2" id="cx-h-cofre">Juntar no PJe</h2>
        <p class="cx-det" id="cx-aviso-aba">Os arquivos do CRATOS ficam disponíveis para juntada só enquanto esta aba do processo estiver aberta.</p>
        <button type="button" class="cx-acao" id="cx-juntar">Juntar certidão dos convênios</button>
        <div class="cx-status" id="cx-juntar-status"></div>
      </section>`);
    const ligar = (sel, fn) => { const b = p.querySelector(sel); if (b) b.onclick = fn; };
    ligar("#cx-localizar", localizarResultado);
    ligar("#cx-coletar-ccs", coletarCcs);
    ligar("#cx-coletar-prevjud", coletarPrevjud);
    ligar("#cx-coletar-sab", coletarSab);
    ligar("#cx-juntar", abrirJuntada);
  }

  /* ═══ 1.9.2 — CONVÊNIO AINDA NÃO CONFIGURADO ═════════════════════════════════
     INFOJUD sem a vara do e-CAC: o pedido sairia sem vara. Avisa na linha do convênio,
     com o link para os Primeiros passos (não bloqueia: a escolha é de quem usa). */
  async function avisarConfigPendente() {
    try {
      const linha = corpo.querySelector('.cx-parte[data-conv-id="INFOJUD"]');
      if (!linha || linha.querySelector(".cx-aviso-config")) return;
      const cfg = ((await Store.get(CHAVES.config)) || {}).infojud || {};
      if (String(cfg.vara || "").trim()) return;
      if (linha.querySelector(".cx-aviso-config")) return;
      const av = document.createElement("div");
      av.className = "cx-aviso-config";
      av.style.cssText = "flex-basis:100%;font-size:11px;color:var(--pdtx);margin:2px 0 0 24px";
      CratosHTML.definir(av, html`⚠ Vara do e-CAC não configurada. <a href="#" class="cx-abrir-primeiros" style="color:var(--pdtx)">Abrir os Primeiros passos</a>`);
      linha.style.flexWrap = "wrap";
      linha.appendChild(av);
      av.querySelector(".cx-abrir-primeiros").onclick = (ev) => {
        ev.preventDefault();
        browser.runtime.sendMessage({ tipo: "abrir_primeiros" }).catch(() => {});
      };
    } catch (e) { /* aviso nunca atrapalha o painel */ }
  }

  /* ═══ NOVIDADES DA VERSÃO (1.9.0) ═══════════════════════════════════════════
     Depois de uma atualização (o background marca `novidades_pendente`), mostra
     UMA vez o que mudou; "Entendi" apaga. Preferência "Novidades da versão" desliga.
     O texto vem de comum/novidades.js (dentro do pacote; nada da rede). */
  async function mostrarNovidades() {
    try {
      if (typeof CratosNovidades === "undefined" || painel.querySelector("#cx-novidades")) return;
      const pend = await Store.get("novidades_pendente");
      if (!pend || !pend.para) return;
      const cfg = (await Store.get(CHAVES.config)) || {};
      const pref = cfg.novidades && cfg.novidades.mostrar;
      if (pref && pref.ativo === false) return;
      const entradas = CratosNovidades.paraMostrar(pend.de, pend.para);
      if (!entradas.length) { await Store.set("novidades_pendente", null); return; }
      const bloco = (e) => html`<div style="margin-top:6px"><div style="color:var(--fg2);font-size:11px">${e.versao} — ${e.data}</div>
        <ul style="margin:4px 0 0 16px;padding:0">${e.itens.map((t) => html`<li style="margin:2px 0">${t}</li>`)}</ul></div>`;
      const card = document.createElement("div");
      card.id = "cx-novidades";
      card.className = "cx-cartao";
      const titulo = entradas.length === 1 ? `Novidades da ${pend.para}` : `Novidades desde a ${pend.de}`;
      CratosHTML.definir(card, html`<h2 class="cx-h2">${titulo}</h2>
        ${entradas.map(bloco)}
        <div id="cx-novidades-hist" style="display:none;border-top:1px solid var(--ln);margin-top:8px;padding-top:4px">
          ${CratosNovidades.VERSOES.filter((e) => !entradas.includes(e)).map(bloco)}</div>
        <div style="display:flex;gap:8px;align-items:center;margin-top:8px">
          <button class="cx-acao" id="cx-novidades-ok" style="font-size:12px;width:auto;padding:4px 14px">Entendi</button>
          <button type="button" class="cx-link" id="cx-novidades-ver" aria-expanded="false" aria-controls="cx-novidades-hist">ver versões anteriores</button>
        </div>`);
      /* 1.9.2 (Rodrigo, 26/10: "está aparecendo dobrado"): a tela inicial é desenhada duas
         vezes seguidas, e as duas chamadas passavam pela checagem do início ANTES de qualquer
         uma inserir o cartão (há leituras do storage no meio). Reconfere aqui, já sem espera. */
      /* 2.0: o cartão mora no menu "⋯", e um ponto no botão avisa que há novidade. */
      const slot = painel.querySelector("#cx-menu-novidades");
      if (!slot || painel.querySelector("#cx-novidades")) return;
      slot.appendChild(card);
      marcarPontoMenu(true, "há novidades");
      card.querySelector("#cx-novidades-ok").onclick = async () => {
        try { await Store.set("novidades_pendente", null); } catch (e) { /* nada */ }
        card.remove();
        marcarPontoMenu(false);
        if (!menu.hidden) { const b = menu.querySelector("button"); if (b) b.focus(); else botaoMais.focus(); }
      };
      card.querySelector("#cx-novidades-ver").onclick = (ev) => {
        ev.preventDefault();
        const h = card.querySelector("#cx-novidades-hist");
        h.style.display = h.style.display === "none" ? "block" : "none";
        card.querySelector("#cx-novidades-ver").setAttribute("aria-expanded", String(h.style.display === "block"));
      };
    } catch (e) { /* novidade nunca atrapalha o painel */ }
  }

  /* ═══ DISPONIBILIDADE DOS CONVÊNIOS (1.9.0) ═══════════════════════════════════
     Certidão de ESTADO, sempre com confirmação humana. A medição é do background
     (modulos/disponibilidade.js): 3 tentativas + PJe como controle. Aqui só se
     mostra o resultado e, se for "indisponível", OFERECE a certidão. */
  async function medirConvenio(id) {
    try { return await browser.runtime.sendMessage({ tipo: "medir_disponibilidade", convenioId: id }); }
    catch (e) { return { ok: false, motivo: String(e.message || e) }; }
  }
  function hmsDe(iso) {
    const d = new Date(iso);
    const p2 = (n) => String(n).padStart(2, "0");
    return isNaN(d.getTime()) ? "" : `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
  }
  async function verificarDisponibilidade() {
    const st = painel.querySelector("#cx-disp-status");
    const id = (painel.querySelector("#cx-disp-conv") || {}).value;
    const conv = CONVENIOS.find((c) => c.id === id) || { id, label: id };
    if (!st || !id) return;
    CratosHTML.definir(st, html`<span style="color:var(--fg2)">Medindo o ${conv.label}… (até 3 tentativas, cerca de 30 segundos)</span>`);
    const m = await medirConvenio(id);
    renderMedicao(st, m, conv, "botao", null);
  }
  /* `antes`: na fila, avança/encerra o convênio ANTES de gerar a certidão (o pulso
     do arquivo não pode ser contado como certidão do convênio). */
  function renderMedicao(el, m, conv, origem, antes) {
    if (!m || !m.ok) {
      CratosHTML.definir(el, html`<span class="cx-erro">Não consegui medir (${(m && (m.motivo || m.erro)) || "erro"}).</span>`);
      return;
    }
    const ts = m.tentativas || [];
    const lista = html`<div style="font-size:11px;color:var(--fg2);margin-top:4px">${ts.map((t) => html`<div>${hmsDe(t.hora)} — ${t.mensagem}</div>`)}</div>`;
    if (m.conclusao === "respondeu") {
      const ult = ts[ts.length - 1] || {};
      CratosHTML.definir(el, html`<div style="color:var(--oktx)">O ${conv.label} respondeu às ${hmsDe(ult.hora)} (${ult.mensagem}). Nada a certificar.</div>${lista}`);
      return;
    }
    if (m.conclusao === "controle_falhou") {
      CratosHTML.definir(el, html`<div style="color:var(--pdtx)">O ${conv.label} não respondeu, mas o PJe também não: pode ser a rede desta unidade. Nada foi certificado.</div>${lista}`);
      return;
    }
    CratosHTML.definir(el, html`<div style="color:var(--ertx)">O ${conv.label} não respondeu em ${ts.length} tentativa(s), entre ${hmsDe(ts[0].hora)} e ${hmsDe(ts[ts.length - 1].hora)}; o PJe respondeu normalmente.</div>${lista}
      <button class="cx-acao cx-disp-gerar" style="font-size:12px;margin-top:6px">Confirmo: o ${conv.label} está indisponível — gerar certidão</button>`);
    const b = el.querySelector(".cx-disp-gerar");
    b.onclick = async () => {
      b.disabled = true;
      if (antes) { try { antes(); } catch (e) { /* nada */ } }
      let r = null;
      try {
        r = await browser.runtime.sendMessage({ tipo: "certidao_indisponibilidade", idMedicao: m.id,
          numProcesso: (processoAtual && processoAtual.numero) || "", origem });
      } catch (e) { r = { ok: false, motivo: String(e.message || e) }; }
      if (r && r.ok) {
        CratosHTML.definir(el, html`<div style="color:var(--pdtx)">Certidão de indisponibilidade gerada (${String(r.filename || "").split("/").pop()}). Ela entra na juntada dos convênios.</div>`);
        if (origem === "fila") atualizarProgresso(conv.id, "⛔ Indisponível — certidão de indisponibilidade gerada", "amarelo");
      } else {
        b.disabled = false;
        CratosHTML.definir(el, html`<span class="cx-erro">Não gerei a certidão (${(r && (r.motivo || r.erro)) || "erro"}).</span>`);
      }
    };
  }
  /* Depois de uma falha/pulo na fila: mede no fundo; se o sistema estiver fora do
     ar, marca "indisponível" e oferece a certidão no relatório final. */
  function verificarDepois(conv) {
    if (!DISP_IDS.includes(conv.id)) return;
    medirConvenio(conv.id).then((m) => {
      if (!m || !m.ok || m.conclusao !== "indisponivel") return;
      const e = orquestraLedger.slice().reverse().find((x) => x.id === conv.id);
      if (!e) return;
      e.indisponivel = true;
      e.medicao = m;
      atualizarProgresso(conv.id, `⛔ Indisponível (medido às ${hmsDe(m.medidoEm)}) — veja o relatório`, "erro");
      const rel = corpo.querySelector("#cx-relatorio");
      if (rel) { rel.remove(); renderRelatorioFinal(); }
    }).catch(() => { /* nada */ });
  }

  /* COLETA DO CCS — dias depois do envio. O background abre a requisição no CCS (direto
     pelo nº guardado, ou procurando pelo processo); a aba do CCS faz o resto e publica
     o desfecho em `ccs_coleta_resultado`. Aqui só mostramos e oferecemos a juntada. */
  async function coletarCcs() {
    const st = corpo.querySelector("#cx-ccs-status");
    const numero = processoAtual?.numero || "";
    if (!st) return;
    if (!numero) { st.textContent = "Sem número de processo capturado."; return; }
    CratosHTML.definir(st, html`<span style="color:var(--fg2)">Abrindo o CCS… (se pedir login, entre; a coleta segue sozinha na aba do CCS)</span>`);
    let r = null;
    try {
      r = await browser.runtime.sendMessage({ tipo: "ccs_coletar", numeroProcesso: numero, partes: partesAtuais || [] });
    } catch (e) { r = { ok: false, erro: String(e.message || e) }; }
    if (!r || !r.ok) {
      CratosHTML.definir(st, html`<span class="cx-erro">Não consegui iniciar a coleta do CCS (${(r && (r.erro || r.motivo)) || "erro"}).</span>`);
      return;
    }
    CratosHTML.definir(st, html`<span style="color:var(--fg2)">${r.direto
      ? `Indo direto à(s) requisição(ões) guardada(s) deste processo (${r.requisicoes})…`
      : "Nenhuma requisição guardada neste navegador — o CCS vai procurar pelo processo (janelas de 30 dias)…"}</span>`);
    const off = Store.onChange("ccs_coleta_resultado", (res) => {
      if (!res || String(res.numProcesso || "").replace(/\D/g, "") !== String(numero).replace(/\D/g, "")) return;
      off();
      const linhas = (res.resultados || []).map((x) => {
        const desc = x.tipo === "pdf" ? `${x.arquivos} PDF(s) de detalhamento + certidão (${x.respondidas} responderam, ${x.pendentes} pendentes)`
          : x.tipo === "estado" ? `certidão de estado (${x.pendentes} sem resposta)`
          : x.tipo === "timeout" ? "o CCS não terminou de gerar o PDF — colete de novo"
          : `nada novo (${x.pendentes} sem resposta)`;
        const cor = x.tipo === "timeout" ? "var(--pdtx)" : "var(--oktx)";
        return html`<div style="color:${cor};margin-top:3px">Requisição ${x.numero}: ${desc}</div>`;
      });
      const temArquivo = (res.resultados || []).some((x) => x.tipo === "pdf" || x.tipo === "estado");
      CratosHTML.definir(st, html`${linhas}${temArquivo
        ? html`<button class="cx-acao" id="cx-ccs-juntar" style="margin-top:8px">Juntar agora</button>` : ""}`);
      const b = st.querySelector("#cx-ccs-juntar");
      if (b) b.onclick = abrirJuntada;
    });
  }

  /* COLETA DO PREVJUD — dossiês que ficaram "em processamento" na solicitação. O
     background abre o Dossiê Previdenciário; a aba do PREVJUD atualiza a lista, abre os
     prontos, junta os PDFs + certidão e publica em `prevjud_coleta_resultado`. */
  async function coletarPrevjud() {
    const st = corpo.querySelector("#cx-prevjud-status");
    const numero = processoAtual?.numero || "";
    if (!st) return;
    if (!numero) { st.textContent = "Sem número de processo capturado."; return; }
    CratosHTML.definir(st, html`<span style="color:var(--fg2)">Abrindo o PREVJUD… (se pedir login, entre; a coleta segue sozinha na aba do PREVJUD)</span>`);
    let r = null;
    try {
      r = await browser.runtime.sendMessage({ tipo: "prevjud_coletar", numeroProcesso: numero,
        partes: (partesAtuais || []).map((p) => ({ nome: p && p.nome, cpfcnpj: p && p.cpfcnpj })) });
    } catch (e) { r = { ok: false, erro: String(e.message || e) }; }
    if (!r || !r.ok) {
      CratosHTML.definir(st, html`<span class="cx-erro">Não iniciei a coleta do PREVJUD (${(r && (r.erro || r.motivo)) || "erro"}).</span>`);
      return;
    }
    CratosHTML.definir(st, r.descobrir
      ? html`<span style="color:var(--fg2)">Procurando no PREVJUD os pedidos deste processo (últimos 7 dias)…</span>`
      : html`<span style="color:var(--fg2)">Buscando ${r.pedidos} dossiê(s) em processamento deste processo…</span>`);
    const off = Store.onChange("prevjud_coleta_resultado", (res) => {
      if (!res || String(res.numProcesso || "").replace(/\D/g, "") !== String(numero).replace(/\D/g, "")) return;
      off();
      if (res.erro) { CratosHTML.definir(st, html`<span class="cx-erro">${res.erro}</span>`); return; }
      const rotuloTipo = (x) => x.tipo === "pdf" ? `${x.arquivos} PDF(s) + certidão`
        : x.tipo === "antigo" ? "pedido mais recente tem mais de 7 dias — não juntado"
          : x.tipo === "ja" ? "o pedido mais recente já foi juntado pelo CRATOS"
            : "ainda em processamento";
      const linhas = (res.resultados || []).map((x) => html`<div style="color:${x.tipo === "pdf" ? "var(--oktx)" : "var(--pdtx)"};margin-top:3px">${x.nome || "CPF"}: ${rotuloTipo(x)}</div>`);
      const temArquivo = (res.resultados || []).some((x) => x.tipo === "pdf");
      const aviso = res.aviso ? html`<div style="color:var(--pdtx)">${res.aviso}</div>` : "";
      CratosHTML.definir(st, html`${aviso}${linhas}${temArquivo ? html`<button class="cx-acao" id="cx-prevjud-juntar" style="margin-top:8px">Juntar agora</button>` : ""}`);
      const b = st.querySelector("#cx-prevjud-juntar");
      if (b) b.onclick = abrirJuntada;
    });
  }

  /* ═══ 1.9.4 — SAB: RESPOSTAS DAS ORDENS DO SISBAJUD (comum/sab-leitura.js) ═══════
     Tudo pela API de LEITURA do SAB, na mesma origem do PJe, com a sessão do
     navegador. Nenhuma transição do SAB é chamada; a juntada é a de sempre
     (`juntarCertidao`): o CRATOS cria a minuta e anexa, e quem assina é a pessoa. */
  const SAB = globalThis.CratosSabLeitura;
  const PASTA_SAB = "CRATOS";

  async function cfgSab() {
    try { return ((await Store.get(CHAVES.config)) || {}).sab || {}; } catch (e) { return {}; }
  }
  const ativoToggle = (v) => !!(v && (v.ativo === true || v === true));
  const ATIVIDADE_REALIZADA_PADRAO = "SISBAJUD - verificar garantia do juízo";

  /* Lê o que já está nos autos. Sem isso não dá para garantir que não vamos juntar
     duas vezes o mesmo relatório — então a falha PARA a coleta (não "segue às cegas"). */
  async function indiceDosAutos(cli, idPJe) {
    return SAB.indiceJuntados(await cli.timeline(idPJe));
  }

  /* Uma determinação → certidão consolidada (PDF desenhado) + relatórios das ordens
     com transferência que ainda não estão nos autos. Devolve o resumo para o painel.
     `grupo` decide a certidão no PJe: por determinação (no processo) ou por lote. */
  async function coletarDeterminacaoSab(cli, idDet, numero, indice, op) {
    const [det, sits, ordens] = await Promise.all([
      cli.determinacao(idDet),
      cli.situacoes(idDet).catch(() => []),
      cli.ordens(idDet),
    ]);
    const m = SAB.modelo(det, sits, ordens);
    const anexos = {};
    const pdfs = [];
    let n = 0;
    const filtro = op.soProtocolos ? new Set(op.soProtocolos) : null;
    for (const l of m.ordens) {
      if (!l.comTransferencia) continue;
      const nos = SAB.situacaoNosAutos(indice, l.protocolo, l.dataBruta);
      if (nos && nos.ja) { anexos[l.protocolo] = nos; continue; }
      if (filtro && !filtro.has(l.protocolo)) continue;           // lote: só as do dia
      if (!l.juntavel) continue;            // 1.9.4: respondida, ou transferência enviada (desdobramento)
      if (nos && nos.possivel) { anexos[l.protocolo] = nos; continue; }
      try {
        const base64 = await cli.pdfOrdem(l.id);
        anexos[l.protocolo] = { n: ++n };
        pdfs.push({ protocolo: l.protocolo, base64 });
      } catch (e) {
        anexos[l.protocolo] = { falhou: true, motivo: String(e.message || e) };
      }
    }
    const resumo = {
      id: m.id, realizada: m.realizada, remanescente: m.remanescente,
      anexados: pdfs.map((p) => p.protocolo),
      ja: Object.keys(anexos).filter((p) => anexos[p].ja),
      conferir: Object.keys(anexos).filter((p) => anexos[p].possivel),
      falharam: Object.keys(anexos).filter((p) => anexos[p].falhou),
      arquivos: 0,
    };
    const rot = { grupo: op.grupo, rotuloGrupo: op.rotuloGrupo };
    if (op.comCertidao) {
      const des = SAB.certidaoBlocos(m, { numProcesso: numero, anexos, agora: new Date() });
      const r = await browser.runtime.sendMessage(Object.assign({
        tipo: "fabricar_pdf", titulo: des.meta.titulo, linhas: des.linhas,
        desenho: { blocos: des.blocos, meta: des.meta },
        filename: SAB.nomeCertidao(numero, m.id, PASTA_SAB), numProcesso: numero,
        convenio: "SAB", operacao: op.operacao, detalhe: "certidao",
      }, rot));
      if (!r || !r.ok) throw new Error(`não gerei a certidão da determinação nº ${m.id} (${(r && r.erro) || "erro"})`);
      resumo.arquivos++;
    }
    for (const p of pdfs) {
      const r = await browser.runtime.sendMessage(Object.assign({
        tipo: "sab_registrar_pdf", base64: p.base64, filename: SAB.nomeDetalhamento(numero, p.protocolo, PASTA_SAB),
        numProcesso: numero, operacao: op.operacao, detalhe: "detalhamento",
      }, rot));
      if (r && r.ok) resumo.arquivos++;
      else { resumo.anexados.splice(resumo.anexados.indexOf(p.protocolo), 1); resumo.falharam.push(p.protocolo); }
    }
    return resumo;
  }

  /* O diário grava em fila no fundo: espera a certidão do grupo aparecer com todos os
     arquivos registrados (no máximo ~6 s) antes de juntar. */
  async function certidaoDoGrupo(numero, familia, grupo, arquivosEsperados) {
    for (let i = 0; i < 20; i++) {
      let r = null;
      try { r = await browser.runtime.sendMessage({ tipo: "diario_ler", numProcesso: numero }); } catch (e) {}
      const c = ((r && r.certidoes) || []).find((x) => x.tipo === familia && String(x.grupo) === String(grupo));
      if (c && c.arquivos.length >= arquivosEsperados) return c;
      await new Promise((res) => setTimeout(res, 300));
    }
    return null;
  }

  const listaBrSab = (itens) => itens.map((t, i) => html`${i ? html`<br>` : ""}• ${t}`);
  function frasesResumoSab(r) {
    const partes = [];
    partes.push(`${r.anexados.length} relatório(s) de transferência novo(s)`);
    if (r.ja.length) partes.push(`${r.ja.length} já nos autos`);
    if (r.conferir.length) partes.push(`${r.conferir.length} a conferir (possível duplicidade)`);
    if (r.falharam.length) partes.push(`${r.falharam.length} não obtido(s): colete de novo`);
    return partes.join("; ");
  }

  /* ── "Coletar SAB", no processo ─────────────────────────────────────────────── */
  async function coletarSab() {
    const st = corpo.querySelector("#cx-sab-status");
    const numero = processoAtual?.numero || "";
    const idProcesso = processoAtual?.idProcesso || processoAtual?.id;
    if (!st) return;
    if (!numero || !idProcesso) { st.textContent = "Sem processo capturado."; return; }
    const dizer = (frag) => CratosHTML.definir(st, frag);
    dizer(html`<span style="color:var(--fg2)">Consultando o SAB…</span>`);
    const cli = SAB.cliente();
    let lista, indice;
    try {
      const proc = await cli.processoPorNumero(numero);
      if (!proc) { dizer(html`<span style="color:var(--pdtx)">Este processo não está no SAB.</span>`); return; }
      lista = await cli.determinacoesDoProcesso(proc.id);
      indice = await indiceDosAutos(cli, idProcesso);
    } catch (e) {
      dizer(html`<span class="cx-erro">Não consegui ler o SAB ou os autos (${String(e.message || e)}). Nada foi gerado; tente de novo.</span>`);
      return;
    }
    /* Transferências ainda não juntadas, por determinação — decide o que nasce marcado. */
    const novas = {};
    for (const d of lista) {
      if (String(d.situacao || "").toUpperCase() === "MINUTA") continue;
      try {
        const ords = await cli.ordens(d.id, "COM_TRANSFERENCIAS");
        novas[d.id] = ords.filter((o) => {
          const nos = SAB.situacaoNosAutos(indice, o.numeroProtocolo, o.dataUltimoProtocolo || o.dataProtocolo);
          return !nos && SAB.ordemJuntavel(o);
        }).length;
      } catch (e) { novas[d.id] = 0; }
    }
    const cands = SAB.candidatasColeta(lista, novas);
    if (!cands.length) { dizer(html`<span style="color:var(--pdtx)">Nenhuma determinação deste processo no SAB (minutas não contam).</span>`); return; }
    if (cands.length === 1) { await executarColetaSab(cli, [cands[0].id], numero, indice); return; }

    dizer(html`<div style="color:var(--fg);margin-bottom:6px">Este processo tem ${cands.length} determinações no SAB. Marque as que quer certificar (uma certidão para cada):</div>
      ${cands.map((c) => html`<label style="display:flex;gap:6px;margin:4px 0;cursor:pointer;color:var(--fg)">
        <input type="checkbox" class="cx-sab-det" value="${String(c.id)}"${c.marcada ? " checked" : ""}>
        <span>Determinação nº ${String(c.id)} — ${c.rotulo}${c.desde ? ` (${c.desde.dmy})` : ""}${c.novas ? html` — <b style="color:var(--oktx)">${String(c.novas)} transferência(s) nova(s)</b>` : ""}</span></label>`)}
      <button class="cx-acao" id="cx-sab-ir" style="margin-top:8px">Coletar as marcadas</button>`);
    st.querySelector("#cx-sab-ir").onclick = () => {
      const ids = Array.from(st.querySelectorAll(".cx-sab-det:checked")).map((el) => el.value);
      if (!ids.length) { st.querySelector("#cx-sab-ir").textContent = "Marque ao menos uma"; return; }
      executarColetaSab(cli, ids, numero, indice);
    };
  }

  async function executarColetaSab(cli, ids, numero, indice) {
    const st = corpo.querySelector("#cx-sab-status");
    const dizer = (frag) => CratosHTML.definir(st, frag);
    const linhas = [];
    let gerou = false;
    const cfg = await cfgSab();
    const idProcesso = processoAtual?.idProcesso || processoAtual?.id;
    for (const id of ids) {
      dizer(html`${linhas}<div style="color:var(--fg2)">Determinação nº ${String(id)}: lendo as ordens e baixando os relatórios…</div>`);
      try {
        const r = await coletarDeterminacaoSab(cli, id, numero, indice, {
          comCertidao: true, operacao: "respostas_sab", grupo: String(id), rotuloGrupo: `determinação nº ${id}`,
        });
        gerou = true;
        linhas.push(html`<div style="color:var(--oktx);margin-top:3px">Determinação nº ${String(id)}: certidão consolidada + ${frasesResumoSab(r)}.</div>`);
        if (r.realizada) {
          linhas.push(html`<div style="color:var(--pdtx);margin-top:3px">⚠ Determinação nº ${String(id)}: ${SAB.ALERTA_REALIZADA}</div>`);
          if (ativoToggle(cfg.gigsObrigacaoRealizada) && idProcesso) {
            const nome = String(cfg.gigsObrigacaoRealizadaAtividade || ATIVIDADE_REALIZADA_PADRAO);
            try { await criarAtividadeGigs(Number(idProcesso), nome); linhas.push(html`<div style="color:var(--oktx)">✓ Atividade "${nome}" lançada no GIGS.</div>`); }
            catch (e) { linhas.push(html`<div style="color:var(--pdtx)">Não lancei a atividade no GIGS (${String(e.message || e)}).</div>`); }
          }
        }
      } catch (e) {
        linhas.push(html`<div class="cx-erro" style="margin-top:3px">Determinação nº ${String(id)}: ${String(e.message || e)} — nada gerado para ela.</div>`);
      }
    }
    dizer(html`${linhas}${gerou ? html`<div style="color:var(--fg2);margin-top:6px">Uma certidão por determinação. O PJe segura um rascunho por vez: assine (ou descarte) uma antes de criar a próxima.</div>
      <button class="cx-acao" id="cx-sab-juntar" style="margin-top:8px">Juntar agora</button>` : ""}`);
    const b = st.querySelector("#cx-sab-juntar");
    if (b) b.onclick = abrirJuntada;
  }

  /* ── BAIXA: com duas ou mais determinações ativas, a pessoa escolhe UMA ─────────── */
  async function escolherDeterminacaoBaixa() {
    const prog = corpo.querySelector("#cx-progresso");
    let ativas = [];
    try {
      const cli = SAB.cliente();
      const proc = await cli.processoPorNumero(processoAtual?.numero || "");
      if (proc) ativas = (await cli.determinacoesDoProcesso(proc.id)).filter((d) => SAB.ehAtiva(d.situacao));
    } catch (e) { return { seguir: true }; }        // o módulo confere de novo e avisa
    if (ativas.length < 2) return { seguir: true }; // nenhuma → o módulo diz "não há"; uma → ela
    return new Promise((resolve) => {
      CratosHTML.definir(prog, html`<div style="color:var(--pdtx);margin-bottom:6px">Há ${String(ativas.length)} determinações ATIVAS no SAB para este processo. Escolha qual interromper:</div>
        ${ativas.map((d) => html`<label style="display:flex;gap:6px;margin:4px 0;cursor:pointer;color:var(--fg)">
          <input type="radio" name="cx-sab-baixa" value="${String(d.id)}">
          <span>Determinação nº ${String(d.id)} — ${SAB.rotuloSit(d.situacao).texto}${(() => { const x = SAB.dataLocal(d.ultimaSituacao && d.ultimaSituacao.ocorridoEm); return x ? ` desde ${x.dmy}` : ""; })()}</span></label>`)}
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="cx-acao" id="cx-sab-baixa-ok" disabled>Interromper a escolhida</button>
          <button class="cx-acao cx-sec" id="cx-sab-baixa-pular">Não interromper (pular o SAB)</button>
        </div>`);
      const ok = prog.querySelector("#cx-sab-baixa-ok");
      prog.querySelectorAll('input[name="cx-sab-baixa"]').forEach((r) => { r.onchange = () => { ok.disabled = false; }; });
      ok.onclick = () => {
        const sel = prog.querySelector('input[name="cx-sab-baixa"]:checked');
        if (sel) resolve({ id: sel.value });
      };
      prog.querySelector("#cx-sab-baixa-pular").onclick = () => resolve({ pular: true });
    });
  }

  /* ── LOTE: "Coletar respostas SAB" (telas sem processo, como o Meu painel) ─────── */
  function renderSemProcesso() {
    renderMenu();
    definirProcessoNoCabecalho(null);
    processoAtual = null;
    CratosHTML.definir(corpo, html`
      <div class="cx-vazio">Nenhum processo aberto nesta tela. Para os convênios, abra um processo em DETALHES.</div>
      ${convLigado("SAB") ? html`<div style="border-top:1px solid var(--ln);margin-top:10px;padding-top:10px">
        <button class="cx-acao cx-sec" id="cx-lote-sab" style="font-size:12px">
          Coletar respostas SAB (transferências do dia)
        </button>
        <div id="cx-lote-sab-area" style="margin-top:8px;font-size:12px"></div>
      </div>` : ""}`);
    const bl = corpo.querySelector("#cx-lote-sab");
    if (bl) bl.onclick = abrirLoteSab;
    cumprirFocoAoAbrir();
  }

  async function abrirLoteSab() {
    const area = corpo.querySelector("#cx-lote-sab-area");
    const cfg = await cfgSab();
    const modal = cfg.loteModalidade === "certidao" ? "certidao" : "resposta";
    const dia = SAB.diaUtilAnterior(new Date());
    CratosHTML.definir(area, html`<div style="border:1px solid var(--bd);border-radius:6px;padding:8px;color:var(--fg)">
      <label style="display:block;margin-bottom:6px">Dia das transferências:
        <input type="date" id="cx-lote-dia" value="${dia}" style="background:var(--bg);color:var(--fg);border:1px solid var(--bd);padding:2px 4px"></label>
      <div style="margin:6px 0 2px">Juntar nos processos:</div>
      <label style="display:block;cursor:pointer"><input type="radio" name="cx-lote-modo" value="resposta"${modal === "resposta" ? " checked" : ""}>
        só a resposta (documento "Sisbajud (transferência)" com os relatórios)</label>
      <label style="display:block;cursor:pointer"><input type="radio" name="cx-lote-modo" value="certidao"${modal === "certidao" ? " checked" : ""}>
        certidão consolidada + respostas</label>
      <label style="display:block;margin-top:6px;cursor:pointer"><input type="checkbox" id="cx-lote-gigs"${ativoToggle(cfg.gigsObrigacaoRealizada) ? " checked" : ""}>
        lançar atividade no GIGS quando a obrigação estiver realizada</label>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="cx-acao" id="cx-lote-ir">Buscar e juntar</button>
        <button class="cx-acao cx-sec" id="cx-lote-cancelar">Cancelar</button>
      </div>
      <div style="color:var(--fg2);margin-top:6px">Os documentos ficam como minuta em cada processo; quem assina é você (há uma assinatura assistida no fim).</div>
    </div>`);
    area.querySelector("#cx-lote-cancelar").onclick = () => { area.textContent = ""; };
    area.querySelector("#cx-lote-ir").onclick = () => {
      const ymd = area.querySelector("#cx-lote-dia").value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return;
      const modo = (area.querySelector('input[name="cx-lote-modo"]:checked') || {}).value === "certidao" ? "certidao" : "resposta";
      executarLoteSab(ymd, modo, area.querySelector("#cx-lote-gigs").checked, cfg);
    };
  }

  async function emParalelo(itens, n, fn) {
    let i = 0;
    const trab = Array.from({ length: Math.min(n, itens.length) }, async () => {
      while (i < itens.length) { const k = i++; await fn(itens[k], k); }
    });
    await Promise.all(trab);
  }

  async function executarLoteSab(ymd, modo, comGigs, cfg) {
    const area = corpo.querySelector("#cx-lote-sab-area");
    const dizer = (frag) => CratosHTML.definir(area, frag);
    const diaBr = ymd.split("-").reverse().join("/");
    const cli = SAB.cliente();
    /* 1) As determinações do órgão; cada uma, as ordens COM transferência do dia. */
    dizer(html`<div style="color:var(--fg2)">Lendo as determinações no SAB…</div>`);
    let dets;
    try { dets = await cli.todasDeterminacoes(); }
    catch (e) { dizer(html`<span class="cx-erro">Não consegui ler o SAB (${String(e.message || e)}). Nada foi feito.</span>`); return; }
    const encerrada = /FINALIZ|INTERROMP|CANCEL/;
    const alvo = dets.filter((d) => {
      const s = String(d.situacao || "").toUpperCase();
      if (s === "MINUTA") return false;
      /* Encerrada ANTES do dia não tem ordem protocolada no dia. */
      const fim = SAB.dataLocal(d.ultimaSituacao && d.ultimaSituacao.ocorridoEm);
      return !(encerrada.test(s) && fim && fim.ymd < ymd);
    });
    const achadas = [];
    const falhasLeitura = [];
    let lidas = 0;
    await emParalelo(alvo, 4, async (d) => {
      try {
        const ords = await cli.ordens(d.id, "COM_TRANSFERENCIAS");
        for (const o of SAB.ordensDoDia(ords, ymd)) achadas.push({ det: d, ordem: o });
      } catch (e) { falhasLeitura.push(d.id); }
      lidas++;
      if (lidas % 20 === 0) dizer(html`<div style="color:var(--fg2)">Lendo as ordens… ${String(lidas)} de ${String(alvo.length)} determinações</div>`);
    });
    const grupos = SAB.agruparPorProcesso(achadas);
    const rel = [];
    const assinar = [];
    const familia = modo === "certidao" ? "sab_respostas" : "sab_transferencia";
    const operacao = modo === "certidao" ? "respostas_sab" : "transferencia_sab";
    const grupo = `lote-${ymd}`;
    const cfgGigs = String(cfg.gigsObrigacaoRealizadaAtividade || ATIVIDADE_REALIZADA_PADRAO);

    /* 2) Processo a processo, em sequência (o PJe segura um rascunho por processo). */
    for (let gi = 0; gi < grupos.length; gi++) {
      const g = grupos[gi];
      const linha = { numero: g.numero, idPJe: g.idPJe, juntados: [], obtidos: [], aguardando: [], ja: [], conferir: [], falhas: [], alertas: [], gigs: null };
      rel.push(linha);
      dizer(html`<div style="color:var(--fg2)">Processo ${String(gi + 1)} de ${String(grupos.length)}: ${SAB.numeroCnj(g.numero)}…</div>`);
      try {
        if (!g.idPJe) throw new Error("o SAB não informou o id do processo no PJe");
        /* Os arquivos do lote ficam presos a ESTA aba: fechou, a limpeza (1.9.0) apaga. */
        try { await browser.runtime.sendMessage({ tipo: "processo_aba", numProcesso: g.numero }); } catch (e) { /* nada */ }
        /* 1.9.4 (Rodrigo, 13/11): a transferência ENVIADA também se junta — é nela que a
           vara intima a parte. Fica de fora só o que ainda não saiu (NAO_ENVIADA) e o
           bloqueio sem resposta. */
        const resp = g.itens.filter((it) => SAB.ordemJuntavel(it.ordem));
        linha.aguardando = g.itens.filter((it) => !SAB.ordemJuntavel(it.ordem)).map((it) => String(it.ordem.numeroProtocolo));
        if (!resp.length) continue;
        const r0 = await fetch(`${location.origin}${API}/processos/id/${g.idPJe}/documentos/minuta/A/metadados`, { headers: { Accept: "application/json" } });
        if (r0.status !== 204) throw new Error("há documento em rascunho no processo: pulado (conclua ou descarte o rascunho e rode de novo)");
        const indice = await indiceDosAutos(cli, g.idPJe);
        const porDet = new Map();
        for (const it of resp) {
          const k = String(it.det.id);
          if (!porDet.has(k)) porDet.set(k, []);
          porDet.get(k).push(String(it.ordem.numeroProtocolo));
        }
        let arquivos = 0;
        for (const [idDet, protocolos] of porDet) {
          const r = await coletarDeterminacaoSab(cli, idDet, g.numero, indice, {
            comCertidao: modo === "certidao", operacao, grupo, soProtocolos: protocolos,
          });
          arquivos += r.arquivos;
          linha.obtidos.push(...r.anexados);     // 1.9.6: "juntado" só depois que a minuta existir
          linha.ja.push(...r.ja.filter((p) => protocolos.includes(p)));
          linha.conferir.push(...r.conferir);
          linha.falhas.push(...r.falharam.map((p) => `relatório da ordem ${p} não obtido`));
          if (r.realizada) linha.alertas.push(`determinação nº ${idDet}: obrigação realizada (remanescente R$ 0,00) — verificar garantia do juízo`);
        }
        /* Só a certidão, sem relatório novo, não vale uma minuta no lote. */
        if (!linha.obtidos.length) {
          if (arquivos) { try { await browser.runtime.sendMessage({ tipo: "diario_marcar_juntado", numProcesso: g.numero, familia, grupo }); } catch (e) {} }
          continue;
        }
        const cert = await certidaoDoGrupo(g.numero, familia, grupo, arquivos);
        if (!cert) throw new Error("os arquivos não chegaram ao diário a tempo; rode de novo");
        const jr = await juntarCertidao(Number(g.idPJe), cert, g.numero);
        await browser.runtime.sendMessage({ tipo: "diario_marcar_juntado", numProcesso: g.numero, familia, grupo });
        const an = (jr && jr.anexos) || { anexados: [], falharam: [] };
        try { await browser.runtime.sendMessage({ tipo: "cofre_remover", numProcesso: g.numero, nomes: an.anexados }); } catch (e) {}
        for (const f of an.falharam || []) linha.falhas.push(`não anexei ${f.nome} (${f.motivo})`);
        linha.minuta = jr.idMinuta;
        linha.juntados = linha.obtidos.slice();
        assinar.push({ numero: g.numero, idPJe: Number(g.idPJe), idMinuta: jr.idMinuta });
        if (comGigs && linha.alertas.length) {
          try { await criarAtividadeGigs(Number(g.idPJe), cfgGigs); linha.gigs = "lançada"; }
          catch (e) { linha.gigs = `não lançada (${String(e.message || e)})`; }
        }
      } catch (e) {
        linha.falhas.push(String(e.message || e));
      }
    }
    try { await Store.set("sab_lote_ultimo", { dia: ymd, modo, em: Date.now(), assinar }); } catch (e) {}
    renderRelatorioLoteSab(diaBr, rel, assinar, falhasLeitura, grupos.length);
  }

  function renderRelatorioLoteSab(diaBr, rel, assinar, falhasLeitura, total) {
    const area = corpo.querySelector("#cx-lote-sab-area");
    const juntou = rel.filter((l) => l.minuta);
    const cartao = (l) => html`<div style="border:1px solid var(--ln);border-radius:6px;padding:6px;margin:4px 0">
      <div style="color:var(--fg);font-weight:600">${SAB.numeroCnj(l.numero)}</div>
      ${l.juntados.length ? html`<div style="color:var(--oktx)">✓ juntado (minuta): ${l.juntados.join(", ")}</div>` : ""}
      ${!l.minuta && l.obtidos.length ? html`<div style="color:var(--pdtx)">NÃO juntado (veja o motivo abaixo; rode de novo depois de resolver): ${l.obtidos.join(", ")}</div>` : ""}
      ${l.ja.length ? html`<div style="color:var(--fg2)">já nos autos: ${l.ja.join(", ")}</div>` : ""}
      ${l.aguardando.length ? html`<div style="color:var(--fg2)">ainda não enviada ao banco ou sem resposta (não juntado): ${l.aguardando.join(", ")}</div>` : ""}
      ${l.conferir.length ? html`<div style="color:var(--pdtx)">possível duplicidade, conferir (não juntado): ${l.conferir.join(", ")}</div>` : ""}
      ${l.alertas.map((a) => html`<div style="color:var(--pdtx)">⚠ ${a}</div>`)}
      ${l.gigs ? html`<div style="color:${l.gigs === "lançada" ? "var(--oktx)" : "var(--pdtx)"}">GIGS: atividade ${l.gigs}</div>` : ""}
      ${l.falhas.length ? html`<div class="cx-erro">${listaBrSab(l.falhas)}</div>` : ""}
    </div>`;
    CratosHTML.definir(area, html`
      <div style="color:var(--fg);font-weight:600">Respostas SAB de ${diaBr}: ${String(total)} processo(s) com transferência; ${String(juntou.length)} com juntada.</div>
      ${falhasLeitura.length ? html`<div class="cx-erro">Não consegui ler as ordens de ${String(falhasLeitura.length)} determinação(ões) (nº ${falhasLeitura.join(", ")}). Elas NÃO foram verificadas: rode de novo.</div>` : ""}
      ${!total ? html`<div style="color:var(--fg2)">Nenhuma ordem com transferência nesse dia.</div>` : ""}
      ${rel.map(cartao)}
      ${assinar.length ? html`<button class="cx-acao" id="cx-lote-assinar" style="margin-top:8px">Assinar em sequência (${String(assinar.length)})</button>
        <div style="color:var(--fg2);margin-top:4px">Abre cada minuta numa janela do CRATOS; quando você assinar, segue para a próxima. O CRATOS não assina.</div>` : ""}
      <div id="cx-lote-assinatura" style="margin-top:8px"></div>`);
    const b = area.querySelector("#cx-lote-assinar");
    if (b) b.onclick = () => assinaturaAssistida(assinar);
  }

  /* ASSINATURA ASSISTIDA: abre a minuta de cada processo numa janela nomeada e espera
     a assinatura aparecer na timeline (o documento com `idSignatario`). Quem assina é
     a pessoa, na tela do PJe; aqui só se navega. "Pular" e "Parar" a qualquer tempo. */
  async function assinaturaAssistida(fila) {
    const caixa = corpo.querySelector("#cx-lote-assinatura");
    const cli = SAB.cliente();
    let parar = false, pular = false;
    const feitos = [];
    for (let i = 0; i < fila.length && !parar; i++) {
      const f = fila[i];
      pular = false;
      window.open(`${location.origin}/pjekz/processo/${f.idPJe}/documento/anexar`, "cratos-assinatura");
      CratosHTML.definir(caixa, html`<div style="color:var(--fg)">Assinatura ${String(i + 1)} de ${String(fila.length)}: ${SAB.numeroCnj(f.numero)} — confira e assine na janela aberta.</div>
        <div style="display:flex;gap:8px;margin-top:6px">
          <button class="cx-acao cx-sec" id="cx-ass-pular">Pular</button>
          <button class="cx-acao cx-sec" id="cx-ass-parar">Parar</button>
        </div>`);
      caixa.querySelector("#cx-ass-pular").onclick = () => { pular = true; };
      caixa.querySelector("#cx-ass-parar").onclick = () => { parar = true; };
      let assinado = false;
      while (!assinado && !pular && !parar) {
        await new Promise((r) => setTimeout(r, 4000));
        try {
          const t = await cli.timeline(f.idPJe);
          const docs = Array.isArray(t) ? t : (t && t.resultado) || [];
          assinado = docs.some((d) => d && Number(d.id) === Number(f.idMinuta) && d.idSignatario);
        } catch (e) { /* tenta de novo no próximo ciclo */ }
      }
      feitos.push(`${SAB.numeroCnj(f.numero)}: ${assinado ? "assinado" : pular ? "pulado" : "parado"}`);
    }
    CratosHTML.definir(caixa, html`<div style="color:var(--fg)">Assinatura assistida encerrada.</div><div style="color:var(--fg2)">${listaBrSab(feitos)}</div>`);
  }

  function lerPartesMarcadas(raizForm) {
    return Array.from((raizForm || corpo).querySelectorAll(".cx-sel-parte:checked"))
      .map((el) => partesAtuais[parseInt(el.dataset.idx)])
      .filter(Boolean);
  }

  /* Compatível com o gancho antigo (setModo + renderListaConvenios): abre a aba do modo. */
  function renderListaConvenios() {
    const m = modoAtual === "baixa" ? "baixa" : "inclusao";
    montarAbas();
    if (abaAtual !== abaDoModo(m)) irAba(abaDoModo(m));
    else renderForm(m);
  }

  /* Formulário de Incluir / Baixar: convênios (com a ordem) e partes, e o "Executar". */
  function renderForm(modo) {
    const p = painelDaAba(abaDoModo(modo));
    if (!p || filaNaAba === modo) return;
    if (filaRodando && filaNaAba) {
      CratosHTML.definir(p, html`<p class="cx-aviso">Há uma fila de ${NOME_MODO[filaNaAba]} em andamento na aba ${filaNaAba === "baixa" ? "Baixar" : "Incluir"}. Espere ela terminar.</p>`);
      return;
    }
    modoAtual = modo;
    const lista = conveniosOrdenados().filter((c) => modo === "inclusao" ? true : c.ops.includes("baixa"));
    const sel = selConv[modo];
    const hc = "cx-h-conv-" + modo, hp = "cx-h-partes-" + modo;
    const itens = lista.map((c, i) => html`
      <li class="cx-parte cx-conv" data-conv-id="${c.id}">
        <label class="cx-rot">
          <input type="checkbox" class="cx-sel-conv" data-id="${c.id}"${sel.has(c.id) ? " checked" : ""}${c.disponivel ? "" : " disabled"}>
          <span>${c.label}${c.disponivel ? "" : " (em breve)"}</span>
        </label>
        <span class="cx-ord">
          <button type="button" class="cx-icone cx-ord-up" data-idx="${i}" aria-label="Mover ${c.label} para cima"${i === 0 ? " disabled" : ""}>▲</button>
          <button type="button" class="cx-icone cx-ord-down" data-idx="${i}" aria-label="Mover ${c.label} para baixo"${i === lista.length - 1 ? " disabled" : ""}>▼</button>
        </span>
      </li>`);
    const partes = partesAtuais.map((pt, i) => html`
      <li class="cx-parte">
        <label class="cx-rot">
          <input type="checkbox" class="cx-sel-parte" data-idx="${i}"${selPartes[i] ? " checked" : ""}>
          <span class="cx-parte-txt"><span class="cx-nome">${pt.nome || "(sem nome)"}</span>
          <span class="cx-doc">${formatarDoc(pt.cpfcnpj)}</span></span>
        </label>
        <span class="cx-polo">${pt.polo || ""}</span>
      </li>`);

    CratosHTML.definir(p, html`
      ${modo === "baixa" ? html`<p class="cx-aviso cx-aviso-perigo">A baixa retira restrições. Você confirma cada uma na aba do convênio.</p>` : ""}
      <h2 class="cx-h" id="${hc}">Convênios, na ordem em que vão rodar</h2>
      <p class="cx-dica">Os automáticos rodam primeiro. Os botões ▲ ▼ mudam a ordem.</p>
      ${itens.length ? html`<ul class="cx-lista" aria-labelledby="${hc}">${itens}</ul>`
        : html`<p class="cx-vazio">Nenhum convênio ${modo === "inclusao" ? "" : "com baixa "}ligado. Ligue os que você usa em Preferências → "Convênios em uso".</p>`}
      ${partes.length ? html`<h2 class="cx-h" id="${hp}">Partes</h2>
      <ul class="cx-lista" aria-labelledby="${hp}">${partes}</ul>` : ""}
      <div class="cx-form-msg" id="cx-form-msg" role="alert"></div>
      <div class="cx-rodape">
        <span class="cx-resumo" id="cx-resumo"></span>
        <button type="button" class="cx-acao${modo === "baixa" ? " cx-perigo-borda" : ""}" id="cx-executar-selecionados">${modo === "baixa" ? "Executar baixa" : "Executar inclusão"}</button>
      </div>
      <div id="cx-confirmar"></div>`);

    const resumo = () => {
      const nc = p.querySelectorAll(".cx-sel-conv:checked").length;
      const np = p.querySelectorAll(".cx-sel-parte").length ? p.querySelectorAll(".cx-sel-parte:checked").length : partesSelecionadas.length;
      const r = p.querySelector("#cx-resumo");
      if (r) r.textContent = `${nc} ${nc === 1 ? "convênio" : "convênios"} · ${np} ${np === 1 ? "parte" : "partes"}`;
    };
    p.onchange = resumo;
    resumo();
    p.querySelector("#cx-executar-selecionados").onclick = () =>
      (modo === "baixa" ? pedirConfirmacaoBaixa() : executarSelecionados());
    wireAvisoMaisPjeRenajud();   // aviso do MaisPJE ao marcar o RENAJUD
    avisarConfigPendente();      // 1.9.2: INFOJUD sem vara → link para os Primeiros passos

    /* Troca com o VIZINHO VISÍVEL (no modo baixa, ou com convênio desligado, o vizinho na
       ordem global pode estar escondido — a troca não aparecia). O foco volta para o
       mesmo botão do convênio que andou, para quem usa teclado não se perder. */
    const trocarOrdem = (a, b, classe) => {
      guardarSelecao();
      ordemAtual = conveniosTodosOrdenados().map((c) => c.id);
      const i = ordemAtual.indexOf(a), k = ordemAtual.indexOf(b);
      if (i < 0 || k < 0) return;
      [ordemAtual[i], ordemAtual[k]] = [ordemAtual[k], ordemAtual[i]];
      Store.set(CHAVE_ORDEM, ordemAtual).catch(() => {});
      renderForm(modo);
      const alvo = p.querySelector(`.cx-conv[data-conv-id="${a}"] .${classe}`);
      if (alvo && !alvo.disabled) alvo.focus();
      else { const outro = p.querySelector(`.cx-conv[data-conv-id="${a}"] .cx-ord button:not([disabled])`); if (outro) outro.focus(); }
    };
    p.querySelectorAll(".cx-ord-up").forEach((btn) => {
      btn.onclick = () => {
        const idx = parseInt(btn.dataset.idx);
        if (idx > 0) trocarOrdem(lista[idx].id, lista[idx - 1].id, "cx-ord-up");
      };
    });
    p.querySelectorAll(".cx-ord-down").forEach((btn) => {
      btn.onclick = () => {
        const idx = parseInt(btn.dataset.idx);
        if (idx < lista.length - 1) trocarOrdem(lista[idx].id, lista[idx + 1].id, "cx-ord-down");
      };
    });
  }

  function msgForm(texto) {
    const el = corpo.querySelector("#cx-form-msg") || corpo.querySelector("#cx-progresso");
    if (el) CratosHTML.definir(el, html`<span class="cx-erro">${texto}</span>`);
  }

  /* Baixa: diálogo de confirmação antes de a fila andar. O foco vai para "Voltar"
     (a opção segura); Esc fecha e devolve o foco ao "Executar baixa". */
  function pedirConfirmacaoBaixa() {
    const p = painelDaAba("baixar");
    if (!p) return;
    const marcados = Array.from(p.querySelectorAll(".cx-sel-conv:checked")).map((el) => el.dataset.id);
    if (!marcados.length) { msgForm("Selecione ao menos um convênio."); return; }
    const nomes = marcados.map((id) => (CONVENIOS.find((c) => c.id === id) || { label: id }).label);
    const area = p.querySelector("#cx-confirmar");
    const exec = p.querySelector("#cx-executar-selecionados");
    CratosHTML.definir(area, html`<div class="cx-dialogo" role="alertdialog" aria-modal="false" aria-labelledby="cx-conf-t" aria-describedby="cx-conf-d">
        <h2 class="cx-h2" id="cx-conf-t">Baixar em ${String(marcados.length)} ${marcados.length === 1 ? "convênio" : "convênios"}?</h2>
        <p class="cx-det" id="cx-conf-d">${nomes.join(", ")}.</p>
        <div class="cx-botoes">
          <button type="button" class="cx-acao cx-sec" id="cx-conf-voltar">Voltar</button>
          <button type="button" class="cx-acao cx-perigo" id="cx-conf-ok">Confirmar baixa</button>
        </div>
      </div>`);
    exec.disabled = true;
    const fechar = () => { CratosHTML.definir(area, html``); exec.disabled = false; exec.focus(); };
    area.querySelector("#cx-conf-voltar").onclick = fechar;
    area.querySelector("#cx-conf-ok").onclick = () => { CratosHTML.definir(area, html``); exec.disabled = false; executarSelecionados(); };
    area.querySelector(".cx-dialogo").addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); fechar(); }
    });
    area.querySelector("#cx-conf-voltar").focus();
  }

  /* A aba da fila vira a linha do tempo. "Nova seleção" aparece quando ela termina. */
  function mostrarFila(modo) {
    if (filaNaAba && filaNaAba !== modo) {
      const velho = painelDaAba(abaDoModo(filaNaAba));
      if (velho) CratosHTML.definir(velho, html``);
    }
    filaNaAba = modo;
    filaRodando = true;
    grudarNoFim = true;
    const p = painelDaAba(abaDoModo(modo));
    if (!p) return;
    CratosHTML.definir(p, html`<div class="cx-fila-topo">
        <h2 class="cx-h2" id="cx-fila-titulo">${modo === "baixa" ? "Baixando restrições" : "Incluindo restrições"}</h2>
        <button type="button" class="cx-acao cx-sec cx-mini" id="cx-nova-selecao" hidden>Nova seleção</button>
      </div>
      <div id="cx-progresso" aria-labelledby="cx-fila-titulo"></div>`);
    p.querySelector("#cx-nova-selecao").onclick = () => {
      filaNaAba = null;
      filaRodando = false;
      renderForm(modo);
      const b = corpo.querySelector("#cx-aba-" + abaDoModo(modo));
      if (b) b.focus();
    };
  }
  function filaTerminou() {
    filaRodando = false;
    const b = corpo.querySelector("#cx-nova-selecao");
    if (b) b.hidden = false;
  }

  /* Executa os convênios selecionados na ordem: automáticos primeiro, interativos depois */
  async function executarSelecionados() {
    if (filaRodando) { msgForm("Já há uma fila em andamento. Espere ela terminar."); return; }
    /* 2.0: lê o formulário da aba do modo (só ele existe na tela). */
    const form = painelDaAba(abaDoModo(modoAtual)) || corpo;
    const marcados = Array.from(form.querySelectorAll(".cx-sel-conv:checked"))
      .map(el => el.dataset.id);
    if (!marcados.length) {
      msgForm("Selecione ao menos um convênio.");
      return;
    }

    const lista = conveniosOrdenados().filter(c => marcados.includes(c.id));
    // Automáticos primeiro, depois interativos — dentro de cada grupo mantém a ordem de marcação
    const fila = [
      ...lista.filter(c => c.tipo === "automatico"),
      ...lista.filter(c => c.tipo === "interativo"),
    ];

    /* 2.0: as partes estão no mesmo formulário. Sem caixas de parte (processo sem
       partes reconhecidas, ou o gancho de teste), vale a seleção já guardada. */
    const temCaixasParte = form.querySelectorAll(".cx-sel-parte").length > 0;
    const partesM = temCaixasParte ? lerPartesMarcadas(form) : partesSelecionadas;
    if (!partesM.length) {
      msgForm("Selecione ao menos uma parte.");
      return;
    }
    partesSelecionadas = partesM;
    if (temCaixasParte) guardarSelecao();
    selConv[modoAtual === "baixa" ? "baixa" : "inclusao"] = new Set(marcados);
    /* A aba vira a linha do tempo da fila; a escolha do SAB (baixa) também mora nela. */
    if (form !== corpo) mostrarFila(modoAtual === "baixa" ? "baixa" : "inclusao");

    const ctx = {
      idProcesso: processoAtual?.id,
      numeroProcesso: processoAtual?.numero,
      base: location.origin,
      partes: partesM,
      xsrfToken: document.cookie.split(";")
        .map(c => c.trim())
        .find(c => c.toLowerCase().startsWith("xsrf-token="))
        ?.split("=").slice(1).join("=") || "",
    };

    /* 1.9.4 — BAIXA do SAB com duas ou mais determinações ativas: a pessoa escolhe
       UMA antes de a fila andar (nada pré-marcado). "Pular" tira o SAB da fila. */
    if (modoAtual === "baixa" && fila.some((c) => c.id === "SAB")) {
      const esc = await escolherDeterminacaoBaixa();
      if (esc.pular) fila.splice(fila.findIndex((c) => c.id === "SAB"), 1);
      else if (esc.id) ctx.sabIdDeterminacao = esc.id;
      if (!fila.length) {
        corpo.querySelector("#cx-progresso").innerHTML = `<span class="cx-erro">Nada a executar.</span>`;
        filaTerminou();
        return;
      }
    }

    orquestraFila = fila;
    orquestraIniciadaEm = Date.now();   // 1.9.0: só vale registro do INFOJUD desta execução
    orquestraIdx = 0;
    orquestraLedger = [];
    orquestraRefeitos = new Set();
    renderProgresso();
    anunciar(`Fila de ${NOME_MODO[modoAtual === "baixa" ? "baixa" : "inclusao"]} iniciada, ${fila.length} ${fila.length === 1 ? "convênio" : "convênios"}.`);
    await rodarProximoConvenio(ctx);
  }

  /* Quantos artefatos cada convênio produz — a cardinalidade, LIDA do código de
     cada content script, nunca chutada (chutar aqui é o bug "baixou 1 de 3,
     parece pronto"). O módulo pode sobrepor mandando `esperados` na resposta de
     `aguardando`; na falta, cai neste padrão. */
  function esperadosDoConvenio(conv, r) {
    const doModulo = Number(r && r.esperados);
    if (doModulo > 0) return doModulo;
    /* SEM padrão 1. O módulo é quem sabe quantas certidões vêm (= nº de
       executados) — chutar 1 aqui foi o bug de campo do RENAJUD (avançou depois
       da 1ª de 2). Módulo que não informa (ex.: CNIB baixa, nº de protocolos só
       conhecido na tela) → null → o painel conclui pelo BOTÃO. */
    return null;
  }

  async function rodarProximoConvenio(ctx) {
    if (orquestraIdx >= orquestraFila.length) {
      renderRelatorioFinal();
      await colheitaAoFimDaFila();
      await juntadaAoFimDaFila();
      return;
    }
    const conv = orquestraFila[orquestraIdx];
    atualizarProgresso(conv.id, orquestraRefeitos.has(conv.id) ? "🔄 Refazendo (2ª tentativa)…" : "🔄 Executando…", "cinza");

    /* Convênio de consulta pura (INFOJUD, CENSEC) não tem "inclusao"/"baixa":
       aparece na lista da INCLUSÃO por conveniência, mas a operação que vai no
       fio é a que ele realmente sabe fazer. Antes mandávamos modoAtual cru e o
       módulo tinha que adivinhar. */
    const operacao = conv.ops.includes(modoAtual) ? modoAtual : conv.ops[0];

    // Marco temporal: só aceitamos pulsos de conclusão emitidos DEPOIS daqui.
    // Sem isso, um pulso velho (mesmo convênio, execução anterior) atropelaria.
    const iniciadoEm = Date.now();

    const r = await browser.runtime.sendMessage({
      tipo: "orquestra_executar",
      convenioId: conv.id,
      operacao,
      ctx,
    });

    if (!r || !r.ok) {
      atualizarProgresso(conv.id, "⚠ " + (r?.motivo || "erro"), "erro");
      orquestraLedger.push({ id: conv.id, label: conv.label, status: "erro",
        detalhe: (r && r.motivo) || "erro ao iniciar" });
      orquestraIdx++;
      await rodarProximoConvenio(ctx);
      return;
    }

    if (r.aguardando) {
      // Convênio interativo: espera o PULSO de conclusão (ou o botão manual).
      atualizarProgresso(conv.id, "⏸ Aguardando conclusão…", "amarelo");
      renderBotaoConcluiu(ctx, conv, {
        operacao,
        esperados: esperadosDoConvenio(conv, r),
        iniciadoEm,
      });
      return;
    }

    // Automático concluído
    atualizarProgresso(conv.id, "✓ Concluído", "verde");
    orquestraLedger.push({ id: conv.id, label: conv.label, status: "ok", detalhe: "(automático)" });
    orquestraIdx++;
    await rodarProximoConvenio(ctx);
  }

  function renderBotaoConcluiu(ctx, conv, opts) {
    opts = opts || {};
    const operacao = opts.operacao || (conv.ops && conv.ops[0]) || "consulta";
    // esperados = nº de certidões a aguardar. null/0 = desconhecido → só botão.
    const esperados = Number(opts.esperados) > 0 ? Number(opts.esperados) : null;
    const iniciadoEm = Number(opts.iniciadoEm) || 0;
    const ehAto = operacao === "inclusao" || operacao === "baixa";
    /* Conjunto de NOMES de arquivo já chegados — contamos DISTINTOS para um
       reenvio do mesmo PDF não somar duas vezes e "completar" cedo. */
    const chegaram = new Set();

    const prog = corpo.querySelector("#cx-progresso");
    if (!prog) return;
    let area = corpo.querySelector("#cx-concluir-area");
    if (!area) {
      area = document.createElement("div");
      area.id = "cx-concluir-area";
      area.style.marginTop = "10px";
      prog.parentNode.insertBefore(area, prog.nextSibling);
    }
    area.innerHTML = "";
    const aviso = document.createElement("div");
    aviso.style.cssText = "font-size:11px;color:var(--pdtx);margin-bottom:6px";
    aviso.textContent = esperados
      ? `Conclua o ${conv.label} no sistema. O CRATOS espera ${esperados} ` +
        `certidão(ões) e segue sozinho quando chegarem — ou clique abaixo.`
      : `Conclua o ${conv.label} no sistema (conferir, salvar, autorizar) e ` +
        `clique abaixo para seguir.`;
    area.appendChild(aviso);

    let finalizado = false;      // trava o AVANÇO (impede idx++ em dobro)
    let vigia = null;            // 1.9.0: sem resposta por um tempo → mede a disponibilidade
    let ledgerFeito = false;     // uma linha de ledger por convênio
    const anotar = (status, detalhe) => {
      if (ledgerFeito) return;
      ledgerFeito = true;
      orquestraLedger.push({ id: conv.id, label: conv.label, status, detalhe: detalhe || "" });
    };

    // Avança a fila. gerarCertidao=true quando foi conclusão MANUAL (a automática
    // já gerou a certidão no content script do SAB).
    const finalizar = async (gerarCertidao, sufixo, ledgerStatus, ledgerDetalhe) => {
      if (finalizado) return;
      finalizado = true;
      if (vigia) clearTimeout(vigia);
      if (off) off();
      anotar(ledgerStatus || "ok", ledgerDetalhe || sufixo || "");
      area.innerHTML = `<div style="font-size:12px;color:var(--fg2)">Seguindo…</div>`;
      if (gerarCertidao && conv.id === "SAB" && modoAtual === "inclusao") {
        const nomeAbrev = (ctx.partes && ctx.partes[0])
          ? doisPrimeirosNomesPainel(ctx.partes[0].nome) : "PARTE";
        await browser.runtime.sendMessage({
          tipo: "sab_certidao", numProcesso: ctx.numeroProcesso, nomeAbrev, dataFormatada: null,
        }).catch((e) => console.warn("CRATOS: falha ao gerar certidão", e));
      }
      area.remove();
      atualizarProgresso(conv.id, "✓ Concluído" + (sufixo || ""), "verde");
      // Trava mútua: zera o estado para o polling da aba do SAB parar (evita 2ª certidão).
      if (gerarCertidao) { try { await Store.set("sab_estado", null); } catch (e) {} }
      /* MESMO gatilho que avança a fila fecha a aba do convênio concluído
         (CNIB/RENAJUD/CENSEC/SerasaJUD). Fire-and-forget: se a aba não existir,
         o background ignora. Só no caminho de conclusão — o `travar` (ato
         incompleto) NÃO passa por aqui, então a aba fica aberta para conferência. */
      try { await browser.runtime.sendMessage({ tipo: "orq_fechar_aba", convenioId: conv.id }); } catch (e) {}
      orquestraIdx++;
      await rodarProximoConvenio(ctx);
    };

    /* ATO incompleto (ex.: CNIB abortou com 2 de 3 executados): NÃO se atropela
       penhora pela metade. Sinaliza em vermelho, marca o ledger e DEIXA O BOTÃO
       — o humano confere e decide seguir na mão. */
    const travar = (p) => {
      if (finalizado) return;
      if (vigia) clearTimeout(vigia);
      if (off) off();
      verificarDepois(conv);
      const esp = Number(p.esperados) > 0 ? Number(p.esperados) : (esperados || "?");
      anotar("trava", `${p.feitos || 0} de ${esp}` + (p.motivo ? " — " + p.motivo : ""));
      atualizarProgresso(conv.id, "⛔ Parou — confira antes de seguir", "erro");
      const m = document.createElement("div");
      m.style.cssText = "font-size:11px;color:var(--ertx);margin:6px 0";
      m.textContent = `${conv.label}: saíram ${p.feitos || 0} de ${esp}. ` +
        `Confira no sistema antes de seguir. O botão abaixo continua a fila quando você decidir.`;
      area.insertBefore(m, area.firstChild.nextSibling);
    };

    /* Resolve um pulso de `orq_conv_feito`. Dois formatos:
       · CHEGADA de artefato  → { ok:true, arquivo } — CONTAMOS até bater `esperados`;
       · TERMINAL do convênio → { ok } sem arquivo (ex.: INFOJUD finalizarRegistro,
         CNIB falhar) — ok:true conclui; ok:false é incompleto (fork). */
    const resolverPulso = (p) => {
      if (!p) return;
      if (String(p.convenio || "").toUpperCase() !== String(conv.id).toUpperCase()) return;
      const mesmoProc = String(p.numProcesso || "").replace(/\D/g, "") ===
        String(ctx.numeroProcesso || "").replace(/\D/g, "");
      if (!mesmoProc) return;
      if (iniciadoEm && Number(p.em) && Number(p.em) < iniciadoEm) return;   // pulso velho

      // TERMINAL de FALHA: o convênio declarou que não completou.
      if (p.ok === false) {
        if (ehAto) { travar(p); return; }
        // CONSULTA incompleta: segue e sinaliza — a fila não trava.
        const feitos = Number(p.feitos) || 0;
        const alvo = Number(p.esperados) > 0 ? Number(p.esperados) : (esperados || 1);
        finalizar(false, ` (${feitos} de ${alvo} — confira)`, "conferir",
          `${feitos} de ${alvo}` + (p.motivo ? " — " + p.motivo : ""));
        verificarDepois(conv);
        return;
      }

      // CHEGADA de artefato: conta distintos até `esperados`.
      if (p.arquivo) {
        chegaram.add(String(p.arquivo));
        if (esperados && chegaram.size >= esperados) {
          finalizar(false, esperados > 1 ? ` (${esperados} certidões)` : " (auto)",
            "ok", esperados > 1 ? `${esperados} certidões (auto)` : "(auto)");
        } else if (esperados) {
          atualizarProgresso(conv.id, `⏳ ${chegaram.size} de ${esperados} certidões…`, "amarelo");
        }
        // esperados desconhecido → contamos mas não avançamos: conclui pelo botão.
        return;
      }

      // TERMINAL de SUCESSO sem arquivo (ex.: INFOJUD: registro concluído).
      finalizar(false, " (auto)", "ok", "(auto)");
    };

    // Auto-conclusão. SAB tem o caminho próprio (zera sab_estado ao AUTORIZAR);
    // os demais interativos ouvem os pulsos de `orq_conv_feito`.
    const off = (conv.id === "SAB")
      ? Store.onChange("sab_estado", (novo) => {
          if (novo === null || novo === undefined) finalizar(false, " (auto)", "ok", "(auto)");
        })
      : Store.onChange(CHAVE_CONV_FEITO, (novo) => resolverPulso(novo));

    // Catch-up: um pulso pode ter chegado entre o dispatch e este listener.
    if (conv.id !== "SAB") {
      Store.get(CHAVE_CONV_FEITO).then((p) => resolverPulso(p)).catch(() => {});
    }

    // Botão manual (reserva) — sempre presente.
    const btn = document.createElement("button");
    btn.className = "cx-acao";
    btn.style.fontSize = "13px";
    btn.textContent = `✓ Concluí o ${conv.label} — próximo`;
    btn.onclick = () => finalizar(true, "", ledgerFeito ? undefined : "ok", "(manual)");
    area.appendChild(btn);

    /* PULAR — escape honesto para quando o convênio não vai terminar sozinho
       (ex.: RENAJUD faz um executado por vez; a 2ª parte é manual). Avança a fila
       e SINALIZA no relatório ("pulado"), diferente do "Concluí" (que marca ok).
       Nada some em silêncio. */
    const btnPular = document.createElement("button");
    btnPular.className = "cx-acao cx-sec";
    btnPular.style.cssText = "font-size:12px;margin-top:6px";
    btnPular.textContent = `⏭ Pular ${conv.label} — próximo da fila`;
    btnPular.onclick = () => {
      const quanto = esperados ? ` (${chegaram.size} de ${esperados})` : "";
      finalizar(false, " (pulado)", "conferir", "pulado pelo usuário" + quanto);
      verificarDepois(conv);
    };
    area.appendChild(btnPular);

    /* REFAZER (1.9.3, pedido do Rodrigo, 10/11): devolve o convênio ao FIM da fila, uma
       vez. Ato que já passou do marco irreversível não refaz (botão desabilitado, com o
       motivo); consulta refaz, avisando se já registrou um pedido. */
    if (!orquestraRefeitos.has(conv.id)) {
      const btnRefazer = document.createElement("button");
      btnRefazer.className = "cx-acao cx-refazer";
      btnRefazer.style.cssText = "font-size:12px;margin-top:6px";
      btnRefazer.classList.add("cx-sec");
      btnRefazer.textContent = `↻ Refazer ${conv.label} — no fim da fila`;
      const notaRefazer = document.createElement("div");
      notaRefazer.className = "cx-refazer-nota";
      notaRefazer.style.cssText = "font-size:11px;color:var(--fg2);margin:3px 0 0";
      let marcoAtual = null;
      const avaliarMarco = (m) => {
        const vale = m && String(m.convenio || "").toUpperCase() === String(conv.id).toUpperCase() &&
          Number(m.em) >= iniciadoEm;
        marcoAtual = vale ? m : null;
        if (marcoAtual && ehAto) {
          btnRefazer.disabled = true;
          /* (2.0: o visual de desabilitado vem do CSS de .cx-acao:disabled) */
          notaRefazer.style.color = "var(--ertx)";
          notaRefazer.textContent = `Refazer bloqueado: ${marcoAtual.oque || "o pedido foi preparado"} — ele pode ter chegado ao ` +
            `${conv.label}. Confira lá; se não chegou, use Pular e rode o ${conv.label} de novo depois.`;
        } else if (marcoAtual) {
          btnRefazer.disabled = false;
          notaRefazer.style.color = "var(--pdtx)";
          notaRefazer.textContent = `Atenção: ${marcoAtual.oque || "o pedido já foi feito"}. Refazer registra outro pedido no ${conv.label}.`;
        } else {
          btnRefazer.disabled = false;
          notaRefazer.textContent = "";
        }
      };
      const offMarco = Store.onChange(CHAVE_MARCO, (novo) => { if (!finalizado) avaliarMarco(novo); });
      Store.get(CHAVE_MARCO).then((m) => avaliarMarco(m)).catch(() => {});
      btnRefazer.onclick = async () => {
        avaliarMarco(await Store.get(CHAVE_MARCO).catch(() => null));   // a palavra final é do marco AGORA
        if (btnRefazer.disabled || finalizado) return;
        finalizado = true;
        if (vigia) clearTimeout(vigia);
        if (off) off();
        offMarco();
        anotar("refazer", "1ª tentativa não concluída — refeita no fim da fila" + (marcoAtual ? ` (${marcoAtual.oque || "pedido já feito"})` : ""));
        area.remove();
        atualizarProgresso(conv.id, "↻ Vai ser refeito no fim da fila", "amarelo");
        try {
          await browser.runtime.sendMessage({ tipo: "orq_refazer", convenioId: conv.id, numProcesso: ctx.numeroProcesso, desde: iniciadoEm });
        } catch (e) { /* o fundo limpa o que der; a fila segue */ }
        orquestraRefeitos.add(conv.id);
        orquestraFila.push(conv);
        orquestraIdx++;
        await rodarProximoConvenio(ctx);
      };
      area.appendChild(btnRefazer);
      area.appendChild(notaRefazer);
    }

    /* VIGIA (1.9.0): convênio sem resposta por um tempo (ex.: a aba abriu numa página
       de erro e o content script nunca achou a tela) → mede. Indisponível → marca e
       oferece a certidão aqui mesmo; a confirmação encerra o convênio e segue a fila. */
    if (DISP_IDS.includes(conv.id)) {
      vigia = setTimeout(async () => {
        if (finalizado) return;
        atualizarProgresso(conv.id, "⏸ Sem resposta — verificando se o sistema está no ar…", "amarelo");
        const m = await medirConvenio(conv.id);
        if (finalizado) return;
        if (!m || !m.ok || m.conclusao !== "indisponivel") {
          atualizarProgresso(conv.id, "⏸ Aguardando conclusão…", "amarelo");
          return;
        }
        atualizarProgresso(conv.id, `⛔ Indisponível (medido às ${hmsDe(m.medidoEm)})`, "erro");
        const caixa = document.createElement("div");
        caixa.className = "cx-disp-fila";
        caixa.style.cssText = "font-size:12px;margin:6px 0";
        area.insertBefore(caixa, area.firstChild);
        renderMedicao(caixa, m, conv, "fila", () => {
          finalizar(false, " (indisponível)", "indisponivel",
            "sistema indisponível — certidão de indisponibilidade gerada; repita a diligência mais tarde (sugestão: GIGS de prazo)");
        });
      }, tempos.vigiaMs);
    }
  }

  /* Relatório de fim de fila. Substitui o "✓ Todos concluídos" por um placar que
     não dá para não ver — porque quem disparou hands-off não está na tela. */
  function renderRelatorioFinal() {
    const prog = corpo.querySelector("#cx-progresso");
    if (!prog) return;
    /* 1.9.3 — a tentativa devolvida ao fim da fila ("refazer") é rastro, não convênio:
       aparece em cinza e não conta no placar (quem conta é a 2ª tentativa). */
    const valem = orquestraLedger.filter((e) => e.status !== "refazer");
    const refeitos = orquestraLedger.filter((e) => e.status === "refazer");
    const total = valem.length;
    const okN = valem.filter((e) => e.status === "ok").length;
    const precisa = valem.filter((e) => e.status !== "ok");
    const div = document.createElement("div");
    div.id = "cx-relatorio";
    div.style.cssText = "margin-top:10px;padding-top:8px;border-top:1px solid var(--ln);font-size:12px";
    const itensPrecisa = precisa.map((e, i) => {
      const vermelho = e.status === "erro" || e.status === "trava";
      if (e.status === "indisponivel") {
        return html`<div style="color:var(--pdtx);margin-top:3px">⛔ ${e.label} — ${e.detalhe}</div>`;
      }
      const disp = e.indisponivel && e.medicao
        ? html`<div style="color:var(--ertx);margin:2px 0 0 14px">⛔ o sistema estava indisponível (medido às ${hmsDe(e.medicao.medidoEm)})</div><div data-disp="${i}" style="margin-left:14px"></div>`
        : "";
      return html`<div style="color:${vermelho ? "var(--ertx)" : "var(--pdtx)"};margin-top:3px">⚠ ${e.label} — ${e.detalhe || e.status}</div>${disp}`;
    });
    const corTopo = precisa.length ? "var(--pdtx)" : "var(--oktx)";
    const quemPrecisa = precisa.length ? `, ${precisa.length} precisa(m) de você` : "";
    const itensRefeitos = refeitos.map((e) => html`<div style="color:var(--fg2);margin-top:3px">↻ ${e.label} — ${e.detalhe}</div>`);
    CratosHTML.definir(div, html`<div style="font-weight:700;color:${corTopo}">${total} convênio(s): ${okN} concluído(s)${quemPrecisa}</div>${itensPrecisa}${itensRefeitos}`);
    prog.appendChild(div);
    filaTerminou();
    anunciar(`Fila concluída: ${okN} de ${total} ${total === 1 ? "convênio concluído" : "convênios concluídos"}` +
      (precisa.length ? `, ${precisa.length} ${precisa.length === 1 ? "precisa" : "precisam"} de você.` : "."));
    div.tabIndex = -1;
    if (focoNoPainel()) div.focus();
    precisa.forEach((e, i) => {
      const alvo = div.querySelector(`[data-disp="${i}"]`);
      if (alvo) renderMedicao(alvo, e.medicao, CONVENIOS.find((c) => c.id === e.id) || { id: e.id, label: e.label }, "fila", null);
    });
  }


  /* ═══════════════════════════════════════════════════════════════════════════
   * COLHEITA DO INFOJUD AO FIM DA FILA
   * ═══════════════════════════════════════════════════════════════════════════
   * ⚠ A RECEITA NÃO RESPONDE NA HORA. O retorno cai na caixa postal minutos ou
   * horas depois — a eFinanceira é assíncrona por natureza. Então, na maioria
   * das execuções, esta verificação vai dizer "ainda não respondeu", e isso é o
   * comportamento CERTO, não uma falha. A frase foi escrita para isso: quem lê
   * precisa entender que o pedido foi registrado e que o resultado vem depois.
   *
   * Não precisa de aba aberta: o `lerCaixaPostalViaAba` do background abre uma
   * em segundo plano, lê o JWT do sessionStorage e fecha. O que ele NÃO faz é
   * criar sessão — se a do gov.br caiu, volta `sem_sessao_receita`.
   *
   * Preferência `colheitaAutomatica` (INFOJUD): "colher" (padrão) | "verificar"
   * | "nao".
   */
  /* ⚠ O id do catálogo é MAIÚSCULO ("INFOJUD"). Na 1.1.0 eu comparei com
     "infojud" minúsculo e a colheita saía calada na primeira linha, SEMPRE — e
     o teste passou, porque procurava a string no arquivo em vez de exercitar o
     comportamento. Confirmou a minha grafia errada.
     Agora a comparação é insensível a caixa E existe uma asserção que cobra que
     o id procurado exista no catálogo CONVENIOS. */
  const ID_INFOJUD = "INFOJUD";
  function filaTemInfojud(fila) {
    return (fila || []).some((c) =>
      String(c && c.id || "").toUpperCase() === ID_INFOJUD);
  }

  async function colheitaAoFimDaFila() {
    if (!filaTemInfojud(orquestraFila)) return;

    let modo = "colher";
    try {
      const cfg = ((await Store.get(CHAVES.config)) || {}).infojud || {};
      if (cfg.colheitaAutomatica) modo = cfg.colheitaAutomatica;
    } catch (e) {}
    if (modo === "nao") return;

    const numero = (processoAtual && processoAtual.numero) || "";
    if (!numero) return;

    /* 1.9.0 (Rodrigo, 23/10): nenhuma solicitação registrada NESTA execução (só Recuperar
       NI, ou nenhum tipo marcado) → não há resposta a buscar na caixa postal. O registro
       vem do finalizarRegistro do e-CAC; sem registro desta execução, colhe como sempre. */
    let reg = null;
    try { reg = await Store.get("infojud_registro:" + String(numero).replace(/\D/g, "")); } catch (e) {}
    const semPedido = !!(reg && reg.registradas === 0 && Number(reg.em) >= orquestraIniciadaEm);

    const prog = corpo.querySelector("#cx-progresso");
    if (!prog) return;
    if (semPedido) {
      const aviso = document.createElement("div");
      aviso.id = "cx-colheita-auto";
      aviso.style.cssText = "font-size:12px;margin-top:8px;padding-top:8px;border-top:1px solid var(--ln);color:var(--fg2)";
      aviso.textContent = reg.soRecuperar
        ? "INFOJUD: só o Recuperar NI foi feito (a resposta é na hora) — não há solicitação para buscar na caixa postal."
        : "INFOJUD: nenhuma solicitação foi registrada nesta execução (nenhum tipo marcado) — não há resposta a buscar na caixa postal.";
      prog.appendChild(aviso);
      return;
    }
    const caixa = document.createElement("div");
    caixa.id = "cx-colheita-auto";
    caixa.style.cssText = "font-size:12px;margin-top:8px;padding-top:8px;border-top:1px solid var(--ln)";
    prog.appendChild(caixa);
    /* 1.5.5: `dizer` recebe fragmento html``; texto solto entraria escapado. */
    const dizer = (frag) => CratosHTML.definir(caixa, frag);
    const btnRecolher = html`<button class="cx-acao" id="cx-recolher" style="margin-top:6px">Verificar de novo</button>`;

    dizer(html`<span style="color:var(--fg2)">Verificando a caixa postal do eCAC… (a aba abre fria e pode levar até um minuto)</span>`);
    let r = null;
    try {
      r = await browser.runtime.sendMessage({ tipo: "coletar_achar", numeroProcesso: numero });
    } catch (e) {
      r = { ok: false, erro: String(e.message || e) };
    }

    if (!r || !r.ok) {
      /* Cada motivo tem uma frase própria. "Ainda não respondeu" não é erro e
         não pode aparecer em vermelho — o pedido FOI registrado. */
      if (r && (r.motivo === "nao_encontrada" || r.motivo === "sem_mensagem_nao_lida")) {
        dizer(html`<div style="color:var(--fg2)">A Receita ainda não respondeu ao INFOJUD deste processo — o retorno costuma levar de minutos a horas.</div>${btnRecolher}`);
      } else if (r && (r.motivo === "caixa_nao_carregou" || r.motivo === "caixa_sem_token" ||
                       r.motivo === "sem_sessao_receita")) {
        /* Estes três são o MESMO conserto do ponto de vista de quem usa: a aba da
           caixa postal está aberta e precisa de você. A distinção entre eles
           existe no log, não na frase — o que importa dizer é o que fazer. */
        const detalhe = r.motivo === "caixa_sem_token"
          ? "ela abriu, mas não liberou a credencial de sessão — normalmente é login pendente."
          : r.motivo === "caixa_nao_carregou"
            ? "ela não terminou de carregar a tempo."
            : "a sessão do gov.br não está ativa.";
        const oQueFazer = r.abaAberta ? " Deixei a aba aberta para você — se ela pedir login, entre."
                                      : " Abra a Caixa Postal do eCAC logada.";
        dizer(html`<div style="color:var(--pdtx)">Não consegui ler a caixa postal: ${detalhe}${oQueFazer} Depois clique abaixo.</div>${btnRecolher}`);
      } else {
        dizer(html`<div style="color:var(--pdtx)">Não consegui verificar a caixa postal (${(r && (r.erro || r.motivo)) || "erro"}).</div>${btnRecolher}`);
      }
      const b = caixa.querySelector("#cx-recolher");
      if (b) b.onclick = () => { caixa.remove(); colheitaAoFimDaFila(); };
      return;
    }

    const s0 = r.solicitacao;
    const naoLidas = (typeof r.naoLidas === "number") ? r.naoLidas : (s0.lida ? 0 : 1);
    const casadas = r.totalCasadas > 1 ? ` (${r.totalCasadas} solicitações, ${naoLidas} não lida(s))` : "";
    const resumo = html`<div style="color:var(--oktx)">✓ Resposta do INFOJUD encontrada — solicitação ${s0.numSolicitacao}, de ${s0.dataEnvio}.${casadas}</div>`;

    if (modo !== "colher") {
      dizer(html`${resumo}<button class="cx-acao" id="cx-colher-auto" style="margin-top:6px">Colher tudo (automático)</button>`);
      const b = caixa.querySelector("#cx-colher-auto");
      if (b) b.onclick = async () => {
        b.disabled = true;
        dizer(html`${resumo}<span style="color:var(--fg2)">Colhendo… (não feche a aba que abrir)</span>`);
        dizer(html`${resumo}${await _colher(numero)}`);
      };
      return;
    }

    dizer(html`${resumo}<span style="color:var(--fg2)">Colhendo as respostas… (não feche a aba que abrir)</span>`);
    dizer(html`${resumo}${await _colher(numero)}`);
  }

  /* Devolve fragmento html`` (não string): quem chama encaixa com ${}. */
  async function _colher(numero) {
    let r = null;
    try {
      r = await browser.runtime.sendMessage({
        tipo: "coletar_tudo", numeroProcesso: numero, pasta: "CRATOS",
      });
    } catch (e) { r = { ok: false, erro: String(e.message || e) }; }
    if (!r || !r.ok) {
      return html`<div style="color:var(--pdtx)">Achei a resposta, mas não consegui colher (${(r && (r.erro || r.motivo)) || "erro"}). Use o botão "Coletar INFOJUD (resultados na caixa postal)" no pé do painel.</div>`;
    }
    const n = (r.baixados != null) ? r.baixados : (r.total != null ? r.total : null);
    const qtd = n != null ? ` (${n} arquivo(s))` : "";
    return html`<div style="color:var(--oktx)">✓ Respostas do INFOJUD colhidas${qtd} e salvas na pasta CRATOS.</div>`;
  }


  /* ═══════════════════════════════════════════════════════════════════════════
   * JUNTADA AO FIM DA FILA — a decisão de 20/08, implementada em 02/09
   * ═══════════════════════════════════════════════════════════════════════════
   * Estava escrito no plano desde o começo ("gatilho automático ao fim do
   * convênio, com Preferência para desligar") e nunca tinha sido ligado: a
   * juntada só existia no botão. O Rodrigo notou na primeira execução da 1.1.0.
   *
   * ⚠ O QUE ISTO FAZ DE VERDADE: cria a minuta NOS AUTOS. Ela nasce rascunho
   * não assinado, e o CRATOS não assina nem encosta no botão de assinar — mas é
   * documento que passa a existir. Por isso: a Preferência existe, o painel diz
   * o que fez, e o `juntarCertidao` recusa se já houver rascunho aberto (não se
   * escreve por cima do trabalho de ninguém).
   *
   * ⚠ UMA POR VEZ: o PJe segura UM rascunho por processo. Se a sessão produziu
   * duas famílias (convênios realizados E cancelamento de restrições), só a
   * primeira pode ser criada agora; a segunda fica como botão, com a explicação.
   * Criar as duas em sequência daria erro na segunda — e um erro que a gente
   * sabia que ia acontecer é pior que um botão.
   */
  async function juntadaAoFimDaFila() {
    const numero = (processoAtual && processoAtual.numero) || "";
    const idProcesso = (processoAtual && (processoAtual.idProcesso || processoAtual.id)) || null;
    if (!numero || !idProcesso) return;

    let modo = "sim";
    try {
      const cfg = ((await Store.get(CHAVES.config)) || {}).juntada || {};
      if (cfg.automatica) modo = cfg.automatica;
    } catch (e) {}

    let r = null;
    try {
      r = await browser.runtime.sendMessage({ tipo: "diario_ler", numProcesso: numero });
    } catch (e) { return; }
    const certidoes = (r && r.certidoes) || [];
    if (!certidoes.length) return;   // nada a certificar: silêncio é a resposta certa

    const prog = corpo.querySelector("#cx-progresso");
    if (!prog) return;
    const caixa = document.createElement("div");
    caixa.id = "cx-juntada-auto";
    caixa.style.cssText = "font-size:12px;margin-top:8px;padding-top:8px;border-top:1px solid var(--ln)";
    prog.appendChild(caixa);
    /* O status da juntada é escrito por `acaoJuntar`. 2.0: a aba Coletar também tem um
       #cx-juntar-status (fica na tela o tempo todo), então este bloco usa um id próprio
       e passa o elemento para `acaoJuntar`. */
    const render = (cabecalho) => {
      const cartoes = certidoes.map((c, i) =>
          html`<div style="border:1px solid var(--ln);border-radius:6px;padding:8px;margin:6px 0">
             <div style="color:var(--fg);font-weight:600">${c.titulo}</div>
             <div style="color:var(--fg2);font-size:12px;margin:4px 0">${c.convenios.join(", ")}
               — ${c.arquivos.length} arquivo(s)</div>
             <button class="cx-acao" data-cert-auto="${i}">Criar no processo</button>
           </div>`);
      CratosHTML.definir(caixa, html`${cabecalho}${cartoes}<div class="cx-vazio" id="cx-juntar-status-fila" style="margin-top:6px"></div>`);
      caixa.querySelectorAll("[data-cert-auto]").forEach((b) => {
        b.onclick = () => acaoJuntar(certidoes[Number(b.dataset.certAuto)],
          Number(idProcesso), numero, caixa.querySelector("#cx-juntar-status-fila"));
      });
    };

    if (modo !== "sim") {
      render(html`<div style="color:var(--pdtx)">Pronto para certificar nos autos (${certidoes.length}):</div>`);
      /* 2.0: fim da fila → o foco vai para o primeiro "Criar no processo" (se a pessoa
         está no painel) e o leitor de tela diz o que há para juntar. */
      anunciar(`Pronto para certificar nos autos: ${certidoes.length} ${certidoes.length === 1 ? "certidão" : "certidões"}. Botão Criar no processo.`);
      const b0 = caixa.querySelector("[data-cert-auto]");
      if (b0 && focoNoPainel()) b0.focus();
      return;
    }

    render(html`<div style="color:var(--fg2)">Criando a certidão no processo…</div>`);
    await acaoJuntar(certidoes[0], Number(idProcesso), numero, caixa.querySelector("#cx-juntar-status-fila"));
    if (certidoes.length > 1) {
      const extra = document.createElement("div");
      extra.style.cssText = "color:var(--pdtx);margin-top:8px";
      extra.textContent = "Há mais de uma certidão a fazer neste processo, e o PJe " +
        "segura um rascunho por vez. Assine ou descarte a que acabei de criar e use o " +
        "botão acima para a próxima.";
      caixa.appendChild(extra);
    }
  }

  function renderProgresso() {
    const prog = corpo.querySelector("#cx-progresso");
    if (!prog) return;
    CratosHTML.definir(prog, html`${orquestraFila.map(c =>
      html`<div id="cx-prog-${c.id}" style="font-size:12px;padding:2px 0;color:var(--fg2)">
        ⏳ ${c.label}
      </div>`
    )}`);
  }

  function atualizarProgresso(id, texto, cor) {
    const prog = corpo.querySelector("#cx-progresso");
    if (!prog) return;
    if (!id) {
      // Mensagem global
      const div = document.createElement("div");
      div.style.cssText = "font-size:12px;padding:4px 0;color:var(--oktx);font-weight:700";
      div.textContent = texto;
      prog.appendChild(div);
      anunciar(texto);
      return;
    }
    const el = prog.querySelector(`#cx-prog-${id}`);
    if (!el) return;
    { const c = CONVENIOS.find((x) => x.id === id); anunciar(`${c ? c.label.replace(/\s*\(.*$/, "") : id}: ${texto}`); }
    const cores = { verde: "var(--oktx)", amarelo: "var(--pdtx)", erro: "var(--ertx)", cinza: "var(--fg2)" };
    el.style.color = cores[cor] || "var(--fg2)";
    // reescreve com o nome do convênio (textContent: não precisa de escape)
    const conv = CONVENIOS.find(c => c.id === id);
    el.textContent = conv ? `${texto} — ${conv.label}` : texto;
  }

  /* PASSO 1 da coleta: pede ao background para achar a solicitação INFOJUD deste
     processo na caixa postal (com trava de número). Só reporta — não baixa. */
  async function localizarResultado() {
    const status = corpo.querySelector("#cx-status");
    const numero = processoAtual?.numero || "";
    if (!numero) { status.textContent = "Sem número de processo capturado."; return; }
    status.textContent = "Consultando a caixa postal…";
    const r = await browser.runtime.sendMessage({ tipo: "coletar_achar", numeroProcesso: numero });
    if (!r || !r.ok) {
      const motivos = {
        nao_encontrada: "Nenhuma solicitação INFOJUD encontrada para este processo.",
        sem_mensagem_nao_lida: "Não há resposta não lida para este processo.",
        numero_processo_invalido: "Número de processo inválido.",
        sem_sessao_receita: "Abra a Caixa Postal do eCAC numa aba (logado) e tente de novo.",
      };
      CratosHTML.definir(status, html`<span class="cx-erro">${motivos[r?.motivo] || ("Falha: " + (r?.erro || "erro"))}</span>`);
      return;
    }
    const s = r.solicitacao;
    const naoLidas = (typeof r.naoLidas === "number") ? r.naoLidas : (s.lida ? 0 : 1);
    /* 1.5.5: nº da solicitação, processo e data vêm da caixa postal da Receita
       e entravam crus no HTML. */
    CratosHTML.definir(status, html`
      <div style="color:var(--oktx)">✓ Solicitação localizada (trava de processo OK)</div>
      <div style="color:var(--fg2);margin-top:4px">
        Nº solicitação: ${s.numSolicitacao}<br>
        Processo: ${s.numProcesso}<br>
        Enviada em: ${s.dataEnvio} ${s.lida ? "(lida)" : "(não lida)"}<br>
        ${r.totalCasadas > 1 ? html`<b>${r.totalCasadas} solicitações</b> deste processo (${naoLidas} não lida(s))` : ""}
      </div>
      <button class="cx-acao" id="cx-colher" style="margin-top:8px">Colher tudo (automático)</button>
      <button class="cx-acao" id="cx-colher-efin" style="margin-top:8px">Baixar só o e-Financeira</button>
      <div class="cx-vazio" id="cx-colher-status" style="margin-top:6px"></div>`);

    corpo.querySelector("#cx-colher").onclick = () => colherTudo(false);
    corpo.querySelector("#cx-colher-efin").onclick = () => colherTudo(true);
  }

  /* Coleta AUTOMÁTICA: o background dirige a caixa postal, varre todas as mensagens
     não lidas que casam o processo (trava tripla), abre cada resultado e colhe. */
  async function colherTudo(soEfin) {
    const st = corpo.querySelector("#cx-colher-status");
    const numero = processoAtual?.numero || "";
    if (!numero) { st.textContent = "Sem número de processo capturado."; return; }
    CratosHTML.definir(st, html`<span style="color:var(--fg2)">Colhendo ${soEfin ? "o e-Financeira" : "automaticamente"} na caixa postal… (não feche a aba que abrir)</span>`);
    const r = await browser.runtime.sendMessage({
      tipo: "coletar_tudo",
      numeroProcesso: numero,
      pasta: "CRATOS",
      soEfin: !!soEfin,
    });
    if (!r || !r.ok) {
      const motivos = {
        nao_encontrada: "Nenhuma solicitação INFOJUD encontrada para este processo.",
        numero_processo_invalido: "Número de processo inválido.",
        sem_sessao_receita: "Abra a Caixa Postal do eCAC numa aba (logado) e tente de novo.",
      };
      CratosHTML.definir(st, html`<span class="cx-erro">${motivos[r?.motivo] || ("falha ao colher: " + (r?.erro || "erro"))}</span>`);
      return;
    }
    if (r.filaVazia) {
      CratosHTML.definir(st, html`<span style="color:var(--pdtx)">Nenhuma resposta não lida ainda para este processo${r.totalCasadas ? ` (há ${r.totalCasadas} já lida(s))` : ""}. Tente novamente em instantes.</span>`);
      return;
    }
    const pendTxt = (r.pendentes && r.pendentes.length)
      ? html`<div style="color:var(--pdtx);margin-top:4px">Pendentes (colher depois): ${r.pendentes.join(" | ")}</div>` : "";
    const falhasTxt = (r.falhas && r.falhas.length)
      ? html`<div style="color:var(--ertx);margin-top:4px">Falhas: ${r.falhas.join(" | ")}</div>` : "";
    const cab = r.timeout
      ? html`<span style="color:var(--pdtx)">⏱ Tempo esgotado — ${r.colhidos}/${r.total} colhidos em ${r.mensagens} solicitação(ões).</span>`
      : html`<span style="color:var(--oktx)">✓ ${r.colhidos}/${r.total} itens colhidos em ${r.mensagens} solicitação(ões).</span>`;
    CratosHTML.definir(st, html`${cab}${pendTxt}${falhasTxt}`);
  }

  /* ---- detecção do processo na tela (heurística, a refinar no teste real) ---- */

  function detectarIdProcesso() {
    // 1) tenta na URL: .../detalhe/... ?idProcesso=NNN  ou  /id/NNN
    const u = new URL(location.href);
    const q = u.searchParams.get("idProcesso") || u.searchParams.get("id");
    if (q && /^\d+$/.test(q)) return q;
    const m = location.href.match(/\/(?:id|processo)\/(\d+)/i);
    if (m) return m[1];
    return null;
  }

  function detectarNumeroProcesso() {
    const m = document.body.textContent.match(/\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/);
    return m ? m[0] : null;
  }

  /* ---- utilidades de exibição ---- */

  function formatarDoc(d) {
    d = String(d || "");
    if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
    if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
    return d || "(sem documento)";
  }

  /* (1.5.5) O antigo escapar() saiu: todo HTML do painel passa por html``
     (comum/storage.js), que escapa sozinho. */

  /* Mantém o painel sincronizado se o processo for recapturado noutro lugar. */
  Store.onChange(CHAVES.processo, (novo) => {
    if (painel.hasAttribute("aberto") && novo && !novo.erro) renderProcesso(novo);
  });

  /*
   * O background NÃO pode fazer POST mutante no PJe: sai com Origin:moz-extension://
   * e o PJe recusa por CORS/papel (ARQ-516). Então operações que exigem POST na página
   * (ex.: lançar movimento) são delegadas ao content script, que roda com a origem
   * legítima https://pje.trt18.jus.br. O background pede via runtime.sendMessage.
   */
  browser.runtime.onMessage.addListener((msg) => {
    if (msg && msg.tipo === "pje_lancar_movimento") {
      return lancarMovimentoNaPagina(msg.idProcesso, msg.idMovimento)
        .then(async (r) => { await Store.set("sab_movimento_resultado", { ok: true, em: Date.now() }); return r; })
        .catch(async (e) => {
          const res = { ok: false, status: e.status, erro: String(e.message || e), em: Date.now() };
          await Store.set("sab_movimento_resultado", res);
          return res;
        });
    }
    if (msg && msg.tipo === "pje_marcar_processo") {
      return marcarProcessoNaPagina(msg)
        .then(async (r) => { await Store.set("pje_marcacao_resultado", Object.assign({ em: Date.now() }, r)); return r; })
        .catch(async (e) => {
          const res = { ok: false, erro: String(e.message || e), em: Date.now() };
          await Store.set("pje_marcacao_resultado", res);
          return res;
        });
    }
    // não é minha mensagem: retorna undefined SÍNCRONO
  });

  /* ═══ CHIP (etiqueta) E ATIVIDADE DO GIGS ═══
   * Duas escritas no PJe, ambas same-origin, ambas pela mesma porta do
   * movimento. Cada uma é INDEPENDENTE: se o chip falhar, a atividade ainda
   * tenta — são marcações de controle, não um ato só.
   *
   * NADA É CRAVADO POR ID. Os dois catálogos são lidos e casados por NOME,
   * porque id de etiqueta e de tipo de atividade é configuração de tribunal:
   * cravar aqui seria plantar o mesmo débito de nacionalização que estamos
   * pagando no RENAJUD.
   */
  async function marcarProcessoNaPagina(msg) {
    const idProcesso = Number(msg.idProcesso);
    const out = { ok: true, etiqueta: null, gigs: null };

    if (msg.etiqueta) {
      try { out.etiqueta = await aplicarEtiqueta(idProcesso, msg.etiqueta); }
      catch (e) { out.etiqueta = { ok: false, erro: String(e.message || e) }; }
    }
    if (msg.gigs) {
      try { out.gigs = await criarAtividadeGigs(idProcesso, msg.gigs); }
      catch (e) { out.gigs = { ok: false, erro: String(e.message || e) }; }
    }
    out.ok = !(out.etiqueta && out.etiqueta.ok === false) && !(out.gigs && out.gigs.ok === false);
    return out;
  }

  async function aplicarEtiqueta(idProcesso, nome) {
    const manuais = await getPje("/pje-etiquetas-api/api/etiquetas/manuais");
    const achado = (manuais || []).find(
      (e) => e.etiqueta && norm(e.etiqueta.nome) === norm(nome));
    if (!achado) throw new Error(`não achei o chip "${nome}" na lista de etiquetas manuais desta vara`);

    /* ⚠️ ARMADILHA: `idsEtiquetas` quer o id da INSTÂNCIA (o `id` de fora), não
       o `etiqueta.id` de dentro. No recon de 20/08 a mesma etiqueta era
       instância 150 e etiqueta 126 — os dois plausíveis, um deles errado. Pôr o
       126 aplicaria outro chip (ou nenhum) sem erro nenhum na tela. */
    await postPje("/pje-etiquetas-api/api/etiquetas",
      { idsProcesso: [idProcesso], idsEtiquetas: [achado.id] });
    return { ok: true, nome: achado.etiqueta.nome, idInstancia: achado.id };
  }

  async function criarAtividadeGigs(idProcesso, descricao) {
    const tipos = await getPje("/pje-gigs-api/api/tiposatividades");
    const tipo = (tipos || []).find((t) => norm(t.descricao) === norm(descricao));
    if (!tipo) throw new Error(`não achei a atividade "${descricao}" no GIGS desta vara`);
    /* idProcesso vai como STRING aqui — é como o próprio GIGS manda. */
    await postPje("/pje-gigs-api/api/atividade",
      { tipoAtividade: tipo, idProcesso: String(idProcesso) });
    return { ok: true, descricao: tipo.descricao, idTipo: tipo.id };
  }

  function norm(s) {
    return String(s == null ? "" : s).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ").trim().toLowerCase();
  }

  function xsrfDoCookie() {
    return document.cookie.split(";").map((c) => c.trim())
      .find((c) => c.toLowerCase().startsWith("xsrf-token="))
      ?.split("=").slice(1).join("=") || "";
  }

  async function getPje(caminho) {
    const r = await fetch(caminho.startsWith("http") ? caminho : location.origin + caminho,
      { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(`${r.status} ao ler ${caminho}`);
    return r.json();
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * JUNTADA DA CERTIDÃO DE CONVÊNIOS
   *
   * A receita saiu do recon de 20/08 (processos 397344 e 437342). Toda a
   * sequência é API JSON, e o anexo iria em `conteudoBase64` — mas NÓS NÃO
   * ANEXAMOS: decisão do Rodrigo, quem escolhe os arquivos na pasta CRATOS é
   * ele, na própria tela do PJe. O CRATOS cria a MINUTA com o texto e diz quais
   * arquivos anexar.
   *
   * ⛔ E NUNCA CLICA EM ASSINAR — nem para "abrir o diálogo". Se o usuário já
   * assinou algo na sessão, o PJe assina DIRETO, sem confirmação (o
   * `podeotp` do recon devolveu `modoPersistidoHabilitado:true`). Aqui não
   * existe a barreira que o CNIB e o SerasaJUD têm; parar "no diálogo" seria
   * parar depois do ato.
   *
   * A MINUTA NASCE NOS AUTOS na chamada de `metadados`. Por isso conferimos
   * tudo ANTES: se já houver rascunho aberto, não atropelamos.
   * ═══════════════════════════════════════════════════════════════════════ */
  const API = "/pje-comum-api/api";

  async function juntarCertidao(idProcesso, certidao, numProcesso) {
    /* 1) Não atropelar rascunho de outra pessoa (ou meu, de uma tentativa que
          ficou pela metade). 204 = campo livre. */
    const r0 = await fetch(`${location.origin}${API}/processos/id/${idProcesso}/documentos/minuta/A/metadados`,
      { headers: { Accept: "application/json" } });
    if (r0.status !== 204) {
      throw new Error("já existe um documento em rascunho neste processo. " +
        "Conclua ou descarte esse rascunho antes — não vou escrever por cima dele.");
    }

    /* 2) Tipo "Certidão" pelo NOME, nunca pelo id: 57/7323 é do TRT18 hoje. */
    /* 1.9.6 — ATENÇÃO: `/tiposdocumentoprocesso/processo/{id}` devolve os tipos dos
       documentos que JÁ EXISTEM no processo (é o filtro da timeline), não os que podem ser
       juntados. Processo sem nenhum "Sisbajud (transferência)" não trazia o tipo (bug de
       campo, 13/11: 21 tipos num processo, 31 noutro). Primeiro essa lista; o que faltar,
       no catálogo inteiro (`/dominio/tiposdocumentoprocesso`, só os ativos) — o mesmo que
       a tela de anexar oferece. Sempre pelo NOME. */
    let tipos = (await getPje(`${API}/dominio/tiposdocumentoprocesso/processo/${idProcesso}`)) || [];
    let catalogoTipos = null;
    const acharTipo = async (nome) => {
      let t = tipos.find((x) => norm(x.nomeTipoProcessoDocumento) === norm(nome));
      if (t) return t;
      if (!catalogoTipos) {
        try { catalogoTipos = (await getPje(`${API}/dominio/tiposdocumentoprocesso`)) || []; } catch (e) { catalogoTipos = []; }
      }
      t = catalogoTipos.find((x) => x && x.ativo !== false && norm(x.nomeTipoProcessoDocumento) === norm(nome));
      if (t) tipos = tipos.concat([t]);
      return t || null;
    };
    /* 1.9.4: a família pode pedir outro tipo de documento principal (lote do SAB, "só a
       resposta" → "Sisbajud (transferência)"). */
    const nomeTipo = certidao.tipoDocumento || "Certidão";
    const tipoCert = await acharTipo(nomeTipo);
    if (!tipoCert) throw new Error(`não achei o tipo de documento "${nomeTipo}" no PJe`);
    if (certidao.tipoAnexo) await acharTipo(certidao.tipoAnexo);   // anexarPdfs procura em `tipos`
    else await acharTipo("Documento Diverso");

    /* 3) O esqueleto vem do servidor — inclusive os ids dos tópicos. Nada de
          cravar 140/141: noutro tribunal a estrutura é outra. */
    const tpl = await (await postPje(
      `${API}/processos/id/${idProcesso}/documentos/minuta/A/template?idEstruturaDocumento=62`, undefined)).json();
    const topicos = (tpl && tpl.topicos) || [];
    const principal = topicos.find((t) => !t.somenteLeitura) || topicos[0];
    if (!principal) throw new Error("o PJe não devolveu os tópicos do documento");
    principal.conteudo = certidao.html;

    /* 4) Cria a minuta. Daqui em diante existe documento nos autos. */
    const meta = await (await postPje(`${API}/processos/id/${idProcesso}/documentos/minuta/A/metadados`, {
      responder: true,
      estruturaDocumento: { id: 62, titulo: "Anexar Documentos", padraoFuncionalidade: true },
      numComentariosNaoLidos: 0,
      tipoArquivo: "HTML",
      tipo: tipoCert.nomeTipoProcessoDocumento,
      anexos: [],
      titulo: certidao.titulo,
      idTipo: tipoCert.id,
    })).json();
    if (!meta || !meta.id) throw new Error("o PJe não devolveu o id da minuta");

    /* 5) Visibilidade, como a tela faz. */
    try {
      await postPje(`${API}/processos/id/${idProcesso}/documentos/${meta.id}/sigilo/${meta.id}` +
        `/visibilidadesigilo?apenasPessoaComParteENaoParte=true`,
        [{ terceiro: false, visibilidade: false, idPessoa: meta.idPessoaInclusao, idDocumento: meta.id }]);
    } catch (e) { console.warn("CRATOS/juntada: visibilidade falhou (segue):", e.message); }

    /* 6) Grava o texto. `version` e `md5` são controle de concorrência: vão os
          da última resposta, sempre. */
    await postPje(`${API}/processos/id/${idProcesso}/documentos/minuta/${meta.id}`, {
      topicos,
      version: meta.version,
      minutaTipoFuncionalidade: tpl.minutaTipoFuncionalidade,
      id: meta.id,
      md5: meta.md5,
    }, "PUT");

    /* 7) ANEXOS. Só os PDFs que o CRATOS produziu NESTA sessão do navegador e
          que ainda estão no cofre em memória do background. Se o cofre estiver
          vazio (navegador reiniciado, extensão recarregada, arquivos de outro
          dia), não há o que anexar e a tela volta a listar os nomes para o
          usuário escolher — que era o comportamento até a 1.0.7.
          ⛔ Continua valendo o de sempre: NADA aqui chega perto de assinar. */
    const anexos = await anexarPdfs(idProcesso, meta, certidao, numProcesso, tipos);

    /* 8) VISIBILIDADE ÀS PARTES (1.2.5). Os documentos nascem sigilosos; sem
          este passo as partes não enxergam a certidão. Damos visibilidade aos
          polos configurados, na MINUTA + em cada anexo — antes de assinar, como
          o passo 5 já fazia com o incluidor. Falha aqui NÃO derruba a juntada:
          a minuta existe, e a visibilidade pode ser dada à mão. */
    let visibilidade = null;
    try {
      const cfg = ((await Store.get(CHAVES.config)) || {}).juntada || {};
      const polos = polosDaConfig(cfg);
      if (polos.ativo || polos.passivo) {
        const docIds = [meta.id].concat(anexos.idsAnexos || []);
        visibilidade = await definirVisibilidadePartes(idProcesso, docIds, polos);
      }
    } catch (e) {
      console.warn("CRATOS/juntada: visibilidade às partes falhou (segue):", e.message);
      visibilidade = { ok: false, erro: String(e.message || e) };
    }

    return { ok: true, idMinuta: meta.id, anexos, visibilidade };
  }

  /* Lê a Preferência de visibilidade. Sem nada salvo, o padrão é AMBOS os polos
     (o módulo declara os dois marcados) — para não silenciar a certidão por falta
     de configuração. Vazio explícito ([]) = não mexe na visibilidade das partes. */
  function polosDaConfig(cfg) {
    const arr = Array.isArray(cfg.visibilidadePartes)
      ? cfg.visibilidadePartes
      : ["Polo ativo", "Polo passivo"];
    return {
      ativo: arr.indexOf("Polo ativo") >= 0,
      passivo: arr.indexOf("Polo passivo") >= 0,
    };
  }

  /* Dá visibilidade=true às partes dos polos pedidos, para TODOS os documentos
     (minuta + anexos), num POST só — o formato exato do PJe (HAR 03/09):
       POST documentos/0/sigilo/0/visibilidadesigilo?apenasPessoaComParteENaoParte=false
       body: [{terceiro,visibilidade,idPessoa,idDocumento}, …]  → 204
     A lista de partes (idPessoa + polo) vem do GET de visibilidadesigilo. */
  async function definirVisibilidadePartes(idProcesso, docIds, polos) {
    if (!docIds.length) return { ok: true, pulou: "sem documentos" };
    const base = docIds[0];
    const lista = await getPje(`${API}/processos/id/${idProcesso}/documentos/${base}` +
      `/sigilo/${base}/visibilidadesigilo/?apenasComPartePrincipal=true` +
      `&apenasComParteOutro=false&apenasNaoParteTerceiro=false&pagina=1&tamanhoPagina=200`);
    const partes = (lista && lista.resultado) || [];
    const quer = (polo) => {
      const up = String(polo || "").toUpperCase();
      return (up === "ATIVO" && polos.ativo) || (up === "PASSIVO" && polos.passivo);
    };
    const pessoas = [];
    for (const p of partes) {
      if (quer(p.polo) && pessoas.indexOf(p.idPessoa) < 0) pessoas.push(p.idPessoa);
    }
    if (!pessoas.length) return { ok: true, pulou: "nenhuma parte no(s) polo(s) escolhido(s)" };

    const corpoVis = [];
    for (const idDoc of docIds) {
      for (const idPessoa of pessoas) {
        corpoVis.push({ terceiro: false, visibilidade: true, idPessoa, idDocumento: idDoc });
      }
    }
    await postPje(`${API}/processos/id/${idProcesso}/documentos/0/sigilo/0` +
      `/visibilidadesigilo?apenasPessoaComParteENaoParte=false&armazenarHistorico=true`, corpoVis);
    return { ok: true, pessoas: pessoas.length, docs: docIds.length };
  }

  /* Anexa em `conteudoBase64` (não é multipart — confirmado em três capturas).
     Um POST por arquivo, `numeroOrdem` de 1 a N, e a visibilidade logo depois,
     como a tela faz. Falha de um anexo NÃO derruba a minuta: ela já existe nos
     autos, e o usuário pode anexar o que faltou à mão. */
  async function anexarPdfs(idProcesso, meta, certidao, numProcesso, tipos) {
    const resultado = { anexados: [], idsAnexos: [], falharam: [], semBytes: [] };
    let cofre = [];
    try {
      const r = await browser.runtime.sendMessage({
        tipo: "cofre_pegar", numProcesso,
      });
      cofre = (r && r.arquivos) || [];
    } catch (e) { return resultado; }
    if (!cofre.length) return resultado;

    /* Só os arquivos DESTA certidão: comprovante de cancelamento não vai anexo
       à certidão de inclusão. A lista da família manda. */
    const daFamilia = (certidao.arquivos || []);
    const escolhidos = cofre.filter((a) => daFamilia.indexOf(a.nome) >= 0);
    resultado.semBytes = daFamilia.filter((n) => !cofre.some((a) => a.nome === n));
    if (!escolhidos.length) return resultado;

    /* Teto de upload do PJe — perguntado, não suposto. Estourar aqui devolve
       erro do servidor no meio da leva; melhor não mandar e dizer qual arquivo. */
    let tetoMb = 10;
    try {
      const p = await getPje(`${API}/parametros/PARAMETRO_TAMANHO_MAXIMO_ARQUIVO_PDF`);
      const v = parseInt((p && p.valorVariavel) || "", 10);
      if (v > 0) tetoMb = v;
    } catch (e) { /* fica o padrão */ }
    const teto = tetoMb * 1024 * 1024;

    /* Tipo do anexo pelo NOME, como o da certidão. 115/"80" é o que o TRT18
       devolve hoje; cravar seria abrir de novo o débito de nacionalização que
       estamos pagando. Se o catálogo não trouxer, cai no observado e AVISA. */
    const nomeTipoAnexo = certidao.tipoAnexo || "Documento Diverso";
    const tipoAnexo = (tipos || []).find((t) => norm(t.nomeTipoProcessoDocumento) === norm(nomeTipoAnexo)) ||
      (tipos || []).find((t) => norm(t.nomeTipoProcessoDocumento) === "documento diverso");
    if (!tipoAnexo) {
      console.warn('CRATOS/juntada: não achei o tipo "Documento Diverso" no catálogo ' +
        "deste processo — usando os valores observados no TRT18 (115/80).");
    }
    const idTipoAnexo = (tipoAnexo && tipoAnexo.id) || 115;
    const codTipoAnexo = (tipoAnexo && (tipoAnexo.codigoDocumento || tipoAnexo.codigoTipoDocumento)) || "80";

    let ordem = 0;
    for (const a of escolhidos) {
      if (a.bytes > teto) {
        resultado.falharam.push({ nome: a.nome, motivo: `passa do limite de ${tetoMb} MB do PJe` });
        continue;
      }
      ordem++;
      try {
        const doc = await (await postPje(`${API}/processos/id/${idProcesso}/documentos/`, {
          nomeArquivo: a.nome,
          tamanho: a.bytes,
          /* A "Descrição" do documento no PJe tem limite RÍGIDO de 100 caracteres
             (erro ARQ-043). Nomes de parte longos (ex.: "FULANO - EMPRESA X - ME")
             estouravam. Capamos aqui — garantia final, seja qual for o convênio.
             O nome do ARQUIVO no disco segue inteiro; só a descrição é cortada. */
          titulo: a.nome.replace(/\.pdf$/i, "").slice(0, 100).trim(),
          idDocumentoPrincipal: meta.id,
          idProcesso: Number(idProcesso),
          numeroOrdem: ordem,
          tipo: (tipoAnexo && tipoAnexo.nomeTipoProcessoDocumento) || "Documento Diverso",
          sigiloso: true,
          idTipo: idTipoAnexo,
          codigoTipoDocumento: String(codTipoAnexo),
          mimeType: "application/pdf",
          conteudoBase64: a.base64,
        })).json();
        if (!doc || !doc.id) throw new Error("o PJe não devolveu o id do anexo");
        try {
          await postPje(`${API}/processos/id/${idProcesso}/documentos/${doc.id}/sigilo/${doc.id}` +
            `/visibilidadesigilo?apenasPessoaComParteENaoParte=true`,
            [{ terceiro: false, visibilidade: false, idPessoa: meta.idPessoaInclusao, idDocumento: doc.id }]);
        } catch (e) { console.warn("CRATOS/juntada: visibilidade do anexo falhou (segue):", e.message); }
        resultado.anexados.push(a.nome);
        resultado.idsAnexos.push(doc.id);   // para a visibilidade às partes, no fim
      } catch (e) {
        ordem--;   // o número de ordem é dos que ENTRARAM
        resultado.falharam.push({ nome: a.nome, motivo: String(e.message || e) });
      }
    }
    return resultado;
  }

  /* Chamada pelo botão do painel. Uma família por vez: o PJe segura um rascunho
     de cada vez, e cada certidão é um ato. */
  async function acaoJuntar(certidao, idProcesso, numProcesso, alvo) {
    const st = alvo || corpo.querySelector("#cx-juntar-status");
    const dizer = (frag) => CratosHTML.definir(st, frag);
    dizer(html`<span style="color:var(--fg2)">Criando a certidão no processo…</span>`);
    try {
      const r = await juntarCertidao(idProcesso, certidao, numProcesso);
      /* `familia`, e não `tipo`: o literal já usa `tipo` para o NOME da mensagem,
         e a chave repetida silenciosamente sobrescrevia a primeira — a mensagem
         virava {tipo:"realizados"} e nunca chegava ao diário. Pego pelo teste. */
      await browser.runtime.sendMessage({
        tipo: "diario_marcar_juntado", numProcesso, familia: certidao.tipo, grupo: certidao.grupo,
      });
      const an = (r && r.anexos) || { anexados: [], falharam: [], semBytes: [] };
      /* Só sobra trabalho manual para o que NÃO foi anexado. A lista precisa
         sobreviver à navegação até a tela de anexar — por isso vai ao storage. */
      const faltando = (certidao.arquivos || []).filter((n) => an.anexados.indexOf(n) < 0);
      if (faltando.length) {
        await Store.set("juntada_pendente", {
          numProcesso, titulo: certidao.titulo, arquivos: faltando, em: Date.now(),
        });
      } else {
        await Store.set("juntada_pendente", null);
        /* 1.9.4: só os arquivos DESTA certidão saem do cofre — a outra certidão do
           mesmo processo (outra determinação do SAB, a baixa depois da inclusão)
           ainda precisa dos seus. Antes era `cofre_limpar` do processo inteiro. */
        try { await browser.runtime.sendMessage({ tipo: "cofre_remover", numProcesso, nomes: an.anexados }); } catch (e) {}
      }

      /* 1.5.5: lista de fragmentos html`` em vez de string concatenada. */
      const listaBr = (itens) => itens.map((t, i) => html`${i ? html`<br>` : ""}• ${t}`);
      const partesMsg = [html`<div style="color:var(--oktx)">✓ "${certidao.titulo}" criada como minuta no processo.</div>`];
      if (an.anexados.length) {
        partesMsg.push(html`<div style="color:var(--oktx);margin-top:6px">✓ ${an.anexados.length} documento(s) anexado(s) pelo CRATOS:<br>${listaBr(an.anexados)}</div>`);
      }
      const vis = r && r.visibilidade;
      if (vis && vis.ok && vis.pessoas) {
        partesMsg.push(html`<div style="color:var(--oktx);margin-top:6px">✓ visibilidade dada a ${vis.pessoas} parte(s) em ${vis.docs} documento(s).</div>`);
      } else if (vis && vis.ok === false) {
        partesMsg.push(html`<div style="color:var(--pdtx);margin-top:6px">Não consegui dar visibilidade às partes (${vis.erro || "erro"}) — dê à mão na tela do documento.</div>`);
      }
      if (an.falharam.length) {
        partesMsg.push(html`<div style="color:var(--pdtx);margin-top:6px">Não consegui anexar:<br>${listaBr(an.falharam.map((f) => f.nome + " — " + f.motivo))}</div>`);
      }
      if (faltando.length) {
        /* "semBytes" quase sempre quer dizer: o arquivo é de outra sessão do
           navegador. Não é erro, e a frase diz isso em vez de acusar falha. */
        const comoAnexar = an.anexados.length ? "Falta anexar à mão" : "Anexe da pasta CRATOS";
        partesMsg.push(html`<div style="color:var(--fg2);margin-top:6px">${comoAnexar} (arquivo de outra sessão do navegador, fora do alcance da extensão):<br>${listaBr(faltando)}</div>`);
      }
      partesMsg.push(html`<div style="color:var(--pdtx);margin-top:6px">Falta você conferir e assinar — o CRATOS não assina.</div><button class="cx-acao" id="cx-abrir-anexar" style="margin-top:8px">Abrir o documento no processo</button>`);
      dizer(html`${partesMsg}`);
      const b = corpo.querySelector("#cx-abrir-anexar");
      if (b) b.onclick = () => {
        /* Nova aba: assim o processo em que você está (a fila, o painel) NÃO se
           perde ao ir conferir/assinar a certidão. `noopener` por higiene. */
        window.open(`${location.origin}/pjekz/processo/${idProcesso}/documento/anexar`,
          "_blank", "noopener");
      };
    } catch (e) {
      dizer(html`<span class="cx-erro">${String(e.message || e)}</span>`);
    }
  }

  /* Botão do painel: lê o diário e oferece o que ainda não foi juntado. */
  async function abrirJuntada() {
    const st = corpo.querySelector("#cx-juntar-status");
    const numero = processoAtual?.numero || "";
    const idProcesso = processoAtual?.idProcesso || processoAtual?.id;
    if (!numero || !idProcesso) { st.textContent = "Sem processo capturado."; return; }
    st.innerHTML = `<span style="color:var(--fg2)">Lendo o que foi feito neste processo…</span>`;

    const r = await browser.runtime.sendMessage({ tipo: "diario_ler", numProcesso: numero });
    const certidoes = (r && r.certidoes) || [];
    if (!certidoes.length) {
      st.innerHTML = `<span style="color:var(--pdtx)">Nada a certificar neste processo — ou tudo que rodou já foi juntado.</span>`;
      return;
    }
    CratosHTML.definir(st, html`${certidoes.map((c, i) =>
      html`<div style="border:1px solid var(--ln);border-radius:6px;padding:8px;margin-bottom:6px">
         <div style="color:var(--fg);font-weight:600">${c.titulo}</div>
         <div style="color:var(--fg2);font-size:12px;margin:4px 0">${c.convenios.join(", ")}
           — ${c.arquivos.length} arquivo(s) para anexar</div>
         <button class="cx-acao" data-cert="${i}">Criar no processo</button>
       </div>`)}`);
    st.querySelectorAll("[data-cert]").forEach((b) => {
      b.onclick = () => acaoJuntar(certidoes[Number(b.dataset.cert)], Number(idProcesso), numero);
    });
  }

  async function postPje(caminho, corpo, metodo) {
    const r = await fetch(caminho.startsWith("http") ? caminho : location.origin + caminho, {
      method: metodo || "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-XSRF-TOKEN": decodeURIComponent(xsrfDoCookie()),
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new Error(`${r.status} em ${caminho}${t ? " — " + t.slice(0, 160) : ""}`);
    }
    return r;
  }

  async function lancarMovimentoNaPagina(idProcesso, idMovimento) {
    const xsrf = document.cookie.split(";")
      .map((c) => c.trim())
      .find((c) => c.toLowerCase().startsWith("xsrf-token="))
      ?.split("=").slice(1).join("=") || "";
    const url = location.origin + "/pje-comum-api/api/lancadormovimentos/lote";
    const corpoReq = {
      assinar: false,
      movimentos: [{ id: Number(idMovimento) }],
      processos: [Number(idProcesso)],
    };
    console.log("CRATOS/painel: POST movimento — corpo:", JSON.stringify(corpoReq));
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-XSRF-TOKEN": decodeURIComponent(xsrf),
      },
      body: JSON.stringify(corpoReq),
    });
    if (!resp.ok) {
      const corpo = await resp.text().catch(() => "");
      console.warn("CRATOS/painel: falha ao lançar movimento", resp.status, "| resposta:", corpo.slice(0, 500));
      const e = new Error(`${resp.status} ao lançar movimento`);
      e.status = resp.status;
      e.corpoResposta = corpo.slice(0, 300);
      throw e;
    }
    console.log("CRATOS/painel: movimento", idMovimento, "lançado (same-origin).");
    return { ok: true };
  }

  /* ═══ A LEMBRANÇA SOBREVIVE À NAVEGAÇÃO ═══
   * A lista de arquivos a anexar é mostrada no painel, mas o usuário vai
   * NAVEGAR até a tela de anexar — e aí o painel se reconstrói do zero e a
   * lista teria sumido justamente na hora de usá-la. Por isso ela fica no
   * storage e reaparece como faixa quando ele chega na tela certa. */
  (async function lembrarJuntadaPendente() {
    try {
      if (!/\/documento\/anexar/.test(location.pathname)) return;
      if (!(await Store.ligada())) return;   // extensão desligada: sem lembrete
      const p = await Store.get("juntada_pendente");
      if (!p || !p.arquivos || !p.arquivos.length) return;
      CratosFaixa.mostrar("juntada",
        `"${p.titulo}" está aqui como minuta.\n\nAnexe estes arquivos, da pasta CRATOS:\n` +
        p.arquivos.map((a) => "  • " + a).join("\n") +
        `\n\nDepois confira e assine — o CRATOS não assina por você.`, "var(--pdtx)");
      await Store.set("juntada_pendente", null);   // um lembrete, não um alarme
    } catch (e) { /* lembrete é melhor-esforço */ }
  })();

  /* ═══════════════════════════════════════════════════════════════════════════
   * AVISO PREVENTIVO DO MaisPJE
   * ═══════════════════════════════════════════════════════════════════════════
   * O MaisPJE interfere no CRATOS quando os dois dirigem a mesma tela (o RENAJUD
   * é o caso conhecido — vira conflito, HTTP 400). O `renajud.js` já cede sozinho
   * quando o detecta; aqui o painel avisa ANTES, na tela do processo, pra você
   * não gastar uma execução até descobrir lá. Warn-and-allow: avisa e deixa
   * seguir. O Firefox não deixa consultar outra extensão, então a detecção é pelo
   * RASTRO no DOM — marcadores confirmados (MaisPJE 2.20.4): a tag própria
   * <menumaispje>/<maispjetooltip> e ids começando com "maisPje". */
  function maisPjePresente() {
    return !!(
      document.querySelector("menumaispje") ||
      document.querySelector("maispjetooltip") ||
      document.querySelector('[id^="maisPje"]') ||
      document.querySelector('[id^="maisPJe"]')
    );
  }

  /* Aviso ao marcar o RENAJUD (inclusão ou baixa): é o convênio que de fato
     conflita com o MaisPJE. Só uma LINHA inline âmbar ao lado do checkbox — a
     faixa flutuante foi removida (feedback dos usuários: reaparecia a cada tela e
     cansava; a inline é contextual e basta). Só se o MaisPJE estiver ativo;
     desmarcou, a linha some. Warn-and-allow. */
  function mostrarAvisoRenajudInline(row) {
    const nx = row.nextElementSibling;
    if (nx && nx.classList && nx.classList.contains("cx-maispje-inline")) return;
    const linha = document.createElement("div");
    linha.className = "cx-maispje-inline";
    linha.style.cssText = "font-size:11px;color:var(--pdtx);margin:-2px 0 4px 26px;line-height:1.35";
    linha.textContent = "⚠ MaisPJE ativo pode conflitar no RENAJUD — desabilite-o antes de rodar.";
    row.parentNode.insertBefore(linha, row.nextSibling);
  }
  function removerAvisoRenajudInline(row) {
    const nx = row.nextElementSibling;
    if (nx && nx.classList && nx.classList.contains("cx-maispje-inline")) nx.remove();
  }
  function wireAvisoMaisPjeRenajud() {
    const row = corpo.querySelector('.cx-parte[data-conv-id="RENAJUD"]');
    if (!row) return;
    const cb = row.querySelector("input.cx-sel-conv");
    if (!cb) return;
    const sync = () => {
      if (cb.checked && maisPjePresente()) mostrarAvisoRenajudInline(row);
      else removerAvisoRenajudInline(row);
    };
    cb.addEventListener("change", sync);
    sync();   // reflete o estado inicial (checkbox pode já vir marcado ao reabrir a tela)
  }

  /* Gancho de teste (mundo isolado: a página não enxerga). Expõe as funções
     REAIS da juntada para o harness — testar uma cópia é testar a cópia. */
  window.__cratosJuntada = { juntarCertidao, anexarPdfs, filaTemInfojud, ID_INFOJUD,
    definirVisibilidadePartes, polosDaConfig };

  /* Gancho do ENCADEAMENTO: o harness monta uma fila, roda, e dispara os pulsos
     de conclusão via Store.set — exercitando o orquestrador REAL, não uma cópia. */
  window.__cratosPainel = {
    host, raiz, anunciar, abrirPorAtalho,
    // 2.0 — abas e menu
    irAba, get abaAtual() { return abaAtual; }, get filaNaAba() { return filaNaAba; },
    get filaRodando() { return filaRodando; }, renderSituacao, renderColetar, renderMenu,
    abrirMenu, fecharMenu, alternarContraste, pedirConfirmacaoBaixa, alternarPainel, fecharPainel,
    rodarProximoConvenio,
    renderBotaoConcluiu,
    renderRelatorioFinal,
    renderProgresso,
    renderProcesso,
    esperadosDoConvenio,
    corpo,
    CHAVE_CONV_FEITO,
    get fila() { return orquestraFila; }, set fila(v) { orquestraFila = v; },
    get idx() { return orquestraIdx; }, set idx(v) { orquestraIdx = v; },
    get ledger() { return orquestraLedger; }, set ledger(v) { orquestraLedger = v; },
    get refeitos() { return orquestraRefeitos; }, set refeitos(v) { orquestraRefeitos = v; },
    CHAVE_MARCO,
    setModo(m) { modoAtual = m; },
    setProcesso(p) { processoAtual = p; },
    maisPjePresente,
    wireAvisoMaisPjeRenajud,
    // liga/desliga
    alternarLigado,
    aplicarEstadoLigado,
    renderDesligado,
    botao,
    get ligado() { return ligado; }, set ligado(v) { ligado = v; },
    // 1.9.0
    mostrarNovidades, avisarConfigPendente, renderListaConvenios,
    verificarDisponibilidade,
    renderMedicao,
    renderModoSelecao,
    setPartes(p) { partesAtuais = p; },
    get pendenteJuntada() { return pendenteJuntada; },
    tempos,
    // 1.9.4 — SAB
    coletarSab, executarColetaSab, escolherDeterminacaoBaixa, renderSemProcesso, abrirLoteSab,
    executarLoteSab, assinaturaAssistida, executarSelecionados,
    setPartesSelecionadas(p) { partesSelecionadas = p; },
    convLigado, usoPronto, get ordem() { return ordemAtual.slice(); },
  };

})();
