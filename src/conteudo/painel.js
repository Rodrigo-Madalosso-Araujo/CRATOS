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

  /* O de 128: o CSS reduz para 42px (ver a nota em painel.css).
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
  CratosHTML.definir(botao, html`<img src="${iconeUrl}" alt="CRATOS">`);

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

  const painel = document.createElement("cratos-painel");
  CratosHTML.definir(painel, html`
    <div class="cx-cabecalho"><span>CRATOS</span><span class="cx-power" role="button" tabindex="0" title="Ligar/desligar o CRATOS">${SVG_POWER}<span class="cx-power-txt">Ligado</span></span><span class="cx-fechar" style="cursor:pointer">✕</span></div>
    <div class="cx-corpo"><div class="cx-vazio">Clique no ícone para capturar o processo.</div></div>
  `);

  document.body.appendChild(botao);
  document.body.appendChild(painel);

  const corpo = painel.querySelector(".cx-corpo");
  let partesAtuais = [];
  let processoAtual = null;
  let ligado = true;   // chave liga/desliga da extensão (padrão ligado)
  painel.querySelector(".cx-fechar").onclick = () => painel.removeAttribute("aberto");

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
    CratosHTML.definir(corpo, html`<div class="cx-vazio" style="text-align:center;padding:8px 4px">
      <div class="cx-power-grande" style="margin-bottom:6px;color:#e11d1d">${SVG_POWER}</div>
      <b>CRATOS desligado</b><br>
      <span style="color:#9a9a9a;font-size:12px">A extensão não vai agir nesta nem nas próximas
      telas. Clique no botão de energia no topo do painel para ligar.</span></div>`);
  }
  function aplicarEstadoLigado() {
    if (ligado) botao.removeAttribute("desligado");
    else botao.setAttribute("desligado", "");
    const p = painel.querySelector(".cx-power");
    if (p) {
      p.style.color = ligado ? "#4ade80" : "#e11d1d";
      p.title = ligado ? "CRATOS ligado — clique para desligar"
                       : "CRATOS desligado — clique para ligar";
      const t = p.querySelector(".cx-power-txt");
      if (t) t.textContent = ligado ? "Ligado" : "Desligado";
    }
    if (painel.hasAttribute("aberto")) {
      if (ligado) capturar(); else renderDesligado();
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
    if (painel.hasAttribute("aberto")) { painel.removeAttribute("aberto"); return; }
    painel.setAttribute("aberto", "");
    posicionarPainel();
    if (ligado) capturar(); else renderDesligado();
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

  async function capturar() {
    const id = detectarIdProcesso();
    const numero = detectarNumeroProcesso();
    if (!id) {
      corpo.innerHTML = `<div class="cx-erro">Não encontrei o id do processo nesta tela. Abra um processo em DETALHES.</div>`;
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
  let orquestraIdx = 0;
  /* Ledger da execução: uma linha por convênio rodado, com o desfecho. É o que o
     relatório de fim de fila lê. Zerado a cada nova execução. */
  let orquestraLedger = [];

  /* Chave do PULSO DE CONCLUSÃO. Cada convênio (menos o SAB, que já usa
     `sab_estado`) grava aqui, no ponto onde emite a certidão, um objeto
     { convenio, numProcesso, feitos, esperados, ok, motivo, em }. O painel ouve
     por Store.onChange e avança sozinho quando o pulso diz "completo e limpo".
     Sinal AUSENTE degrada para o botão manual — nunca para pulo indevido. */
  const CHAVE_CONV_FEITO = "orq_conv_feito";

  // Carrega ordem salva (se houver)
  Store.get(CHAVE_ORDEM).then(o => { if (Array.isArray(o) && o.length) ordemAtual = o; }).catch(() => {});

  function conveniosOrdenados() {
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

    partesAtuais = partes;
    processoAtual = proc;
    modoAtual = null;
    renderModoSelecao();
  }

  /* Tela inicial: dois botões INCLUSÃO / BAIXA em destaque */
  function renderModoSelecao() {
    const partes = partesAtuais;
    /* Polo ATIVO desmarcado por padrão: a execução dos convênios mira o
       EXECUTADO (polo passivo). Marcar o exequente por engano mandaria o credor
       para as pesquisas. Passivo (e polo desconhecido) nascem marcados. */
    /* 1.5.5: polo e documento vêm do PJe e entravam crus no HTML. */
    const linhas = partes.map((p, i) => html`
      <div class="cx-parte">
        <label style="display:flex;gap:8px;flex:1;cursor:pointer">
          <input type="checkbox" class="cx-sel-parte" data-idx="${i}"${/ativ/i.test(p.polo || "") ? "" : " checked"}>
          <div style="flex:1">
            <div class="cx-nome">${p.nome || "(sem nome)"}</div>
            <div class="cx-doc">${formatarDoc(p.cpfcnpj)}</div>
          </div>
        </label>
        <div class="cx-polo">${p.polo || ""}</div>
      </div>`);

    CratosHTML.definir(corpo, html`
      <div style="color:#9a9a9a;margin-bottom:8px;font-size:12px">
        Processo ${processoAtual.numero || String(processoAtual.id)}
      </div>
      ${linhas}
      <div style="display:flex;gap:8px;margin-top:14px">
        <button class="cx-acao" id="cx-modo-inclusao" style="flex:1;font-size:13px">
          ➕ INCLUSÃO
        </button>
        <button class="cx-acao" id="cx-modo-baixa"
          style="flex:1;font-size:13px;background:#1a1a1a;border:1px solid #e11d1d;color:#e8e8e8">
          ➖ BAIXA
        </button>
      </div>
      <div style="border-top:1px solid #333;margin-top:12px;padding-top:10px">
        <button class="cx-acao" id="cx-localizar"
          style="background:#1a1a1a;border:1px solid #e11d1d;color:#e8e8e8;font-size:12px">
          Localizar resultado na caixa postal
        </button>
        <div class="cx-vazio" id="cx-status" style="margin-top:8px"></div>
      </div>
      <div style="border-top:1px solid #333;margin-top:10px;padding-top:10px">
        <button class="cx-acao" id="cx-coletar-ccs"
          style="background:#1a1a1a;border:1px solid #e11d1d;color:#e8e8e8;font-size:12px">
          Coletar CCS (respostas das instituições)
        </button>
        <div class="cx-vazio" id="cx-ccs-status" style="margin-top:8px"></div>
      </div>
      <div style="border-top:1px solid #333;margin-top:10px;padding-top:10px">
        <button class="cx-acao" id="cx-juntar"
          style="background:#1a1a1a;border:1px solid #e11d1d;color:#e8e8e8;font-size:12px">
          Juntar certidão dos convênios
        </button>
        <div class="cx-vazio" id="cx-juntar-status" style="margin-top:8px"></div>
      </div>
    `);

    const irPara = (modo) => {
      const marcadas = lerPartesMarcadas();
      if (!marcadas.length) {
        corpo.querySelector("#cx-status").innerHTML =
          `<span class="cx-erro">Selecione ao menos uma parte.</span>`;
        return;
      }
      partesSelecionadas = marcadas;
      modoAtual = modo;
      renderListaConvenios();
    };
    corpo.querySelector("#cx-modo-inclusao").onclick = () => irPara("inclusao");
    corpo.querySelector("#cx-modo-baixa").onclick    = () => irPara("baixa");
    corpo.querySelector("#cx-localizar").onclick = localizarResultado;
    corpo.querySelector("#cx-coletar-ccs").onclick = coletarCcs;
    corpo.querySelector("#cx-juntar").onclick = abrirJuntada;
  }

  /* COLETA DO CCS — dias depois do envio. O background abre a requisição no CCS (direto
     pelo nº guardado, ou procurando pelo processo); a aba do CCS faz o resto e publica
     o desfecho em `ccs_coleta_resultado`. Aqui só mostramos e oferecemos a juntada. */
  async function coletarCcs() {
    const st = corpo.querySelector("#cx-ccs-status");
    const numero = processoAtual?.numero || "";
    if (!st) return;
    if (!numero) { st.textContent = "Sem número de processo capturado."; return; }
    CratosHTML.definir(st, html`<span style="color:#9a9a9a">Abrindo o CCS… (se pedir login, entre; a coleta segue sozinha na aba do CCS)</span>`);
    let r = null;
    try {
      r = await browser.runtime.sendMessage({ tipo: "ccs_coletar", numeroProcesso: numero, partes: partesAtuais || [] });
    } catch (e) { r = { ok: false, erro: String(e.message || e) }; }
    if (!r || !r.ok) {
      CratosHTML.definir(st, html`<span class="cx-erro">Não consegui iniciar a coleta do CCS (${(r && (r.erro || r.motivo)) || "erro"}).</span>`);
      return;
    }
    CratosHTML.definir(st, html`<span style="color:#9a9a9a">${r.direto
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
        const cor = x.tipo === "timeout" ? "#facc15" : "#4ade80";
        return html`<div style="color:${cor};margin-top:3px">Requisição ${x.numero}: ${desc}</div>`;
      });
      const temArquivo = (res.resultados || []).some((x) => x.tipo === "pdf" || x.tipo === "estado");
      CratosHTML.definir(st, html`${linhas}${temArquivo
        ? html`<button class="cx-acao" id="cx-ccs-juntar" style="margin-top:8px">Juntar agora</button>` : ""}`);
      const b = st.querySelector("#cx-ccs-juntar");
      if (b) b.onclick = abrirJuntada;
    });
  }

  function lerPartesMarcadas() {
    return Array.from(corpo.querySelectorAll(".cx-sel-parte:checked"))
      .map((el) => partesAtuais[parseInt(el.dataset.idx)])
      .filter(Boolean);
  }

  /* Lista de convênios filtrada pelo modo, com checkbox + ▲▼ */
  function renderListaConvenios() {
    const lista = conveniosOrdenados().filter(c =>
      modoAtual === "inclusao" ? true : c.ops.includes("baixa")
    );
    const titulo = modoAtual === "inclusao" ? "➕ INCLUSÃO" : "➖ BAIXA";

    const itens = lista.map((c, i) => {
      const dis = c.disponivel ? "" : "opacity:0.4;pointer-events:none";
      const tag = c.disponivel ? "" : html` <small style="color:#666">(em breve)</small>`;
      return html`
        <div class="cx-parte" data-conv-id="${c.id}" style="align-items:center;padding:4px 0">
          <label style="display:flex;gap:8px;flex:1;cursor:pointer;${dis}">
            <input type="checkbox" class="cx-sel-conv" data-id="${c.id}"
              ${c.disponivel ? "" : "disabled"}>
            <span style="font-size:13px">${c.label}${tag}</span>
          </label>
          <div style="display:flex;flex-direction:column;gap:2px">
            <button class="cx-ord-up" data-idx="${i}" title="Mover para cima"
              style="background:none;border:none;color:#9a9a9a;cursor:pointer;font-size:10px;padding:0 4px"
              ${i === 0 ? "disabled" : ""}>▲</button>
            <button class="cx-ord-down" data-idx="${i}" title="Mover para baixo"
              style="background:none;border:none;color:#9a9a9a;cursor:pointer;font-size:10px;padding:0 4px"
              ${i === lista.length - 1 ? "disabled" : ""}>▼</button>
          </div>
        </div>`;
    });

    CratosHTML.definir(corpo, html`
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <button id="cx-voltar-modo"
          style="background:none;border:none;color:#9a9a9a;cursor:pointer;font-size:18px;padding:0">‹</button>
        <span style="font-weight:700;font-size:13px">${titulo}</span>
      </div>
      <div style="color:#9a9a9a;font-size:11px;margin-bottom:8px">
        Selecione os convênios e ajuste a ordem (▲▼). Automáticos rodam primeiro.
      </div>
      <div style="font-size:11px;color:#e8e8e8;background:#1a1a1a;border-left:3px solid #e11d1d;
                  padding:6px 8px;margin-bottom:10px;border-radius:4px">
        <b>${partesSelecionadas.length} parte(s):</b>
        ${partesSelecionadas.map((p) => p.nome).join(" · ")}
      </div>
      ${itens}
      <button class="cx-acao" id="cx-executar-selecionados" style="margin-top:12px">
        Executar selecionados
      </button>
      <div id="cx-progresso" style="margin-top:8px"></div>
    `);

    corpo.querySelector("#cx-voltar-modo").onclick = renderModoSelecao;
    corpo.querySelector("#cx-executar-selecionados").onclick = executarSelecionados;
    wireAvisoMaisPjeRenajud();   // aviso do MaisPJE ao marcar o RENAJUD

    // Botões de reordenação
    corpo.querySelectorAll(".cx-ord-up").forEach(btn => {
      btn.onclick = () => {
        const idx = parseInt(btn.dataset.idx);
        const id = lista[idx].id;
        const posGlobal = ordemAtual.indexOf(id);
        if (posGlobal > 0) {
          [ordemAtual[posGlobal - 1], ordemAtual[posGlobal]] =
            [ordemAtual[posGlobal], ordemAtual[posGlobal - 1]];
          Store.set(CHAVE_ORDEM, ordemAtual).catch(() => {});
          renderListaConvenios();
        }
      };
    });
    corpo.querySelectorAll(".cx-ord-down").forEach(btn => {
      btn.onclick = () => {
        const idx = parseInt(btn.dataset.idx);
        const id = lista[idx].id;
        const posGlobal = ordemAtual.indexOf(id);
        if (posGlobal < ordemAtual.length - 1) {
          [ordemAtual[posGlobal], ordemAtual[posGlobal + 1]] =
            [ordemAtual[posGlobal + 1], ordemAtual[posGlobal]];
          Store.set(CHAVE_ORDEM, ordemAtual).catch(() => {});
          renderListaConvenios();
        }
      };
    });
  }

  /* Executa os convênios selecionados na ordem: automáticos primeiro, interativos depois */
  async function executarSelecionados() {
    const marcados = Array.from(corpo.querySelectorAll(".cx-sel-conv:checked"))
      .map(el => el.dataset.id);
    if (!marcados.length) {
      corpo.querySelector("#cx-progresso").innerHTML =
        `<span class="cx-erro">Selecione ao menos um convênio.</span>`;
      return;
    }

    const lista = conveniosOrdenados().filter(c => marcados.includes(c.id));
    // Automáticos primeiro, depois interativos — dentro de cada grupo mantém a ordem de marcação
    const fila = [
      ...lista.filter(c => c.tipo === "automatico"),
      ...lista.filter(c => c.tipo === "interativo"),
    ];

    // Usa a seleção CONGELADA na tela anterior. Nada de reler o DOM aqui: os
    // checkboxes não existem mais nesta tela.
    const partesM = partesSelecionadas;
    if (!partesM.length) {
      corpo.querySelector("#cx-progresso").innerHTML =
        `<span class="cx-erro">Nenhuma parte selecionada — volte e marque ao menos uma.</span>`;
      return;
    }

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

    orquestraFila = fila;
    orquestraIdx = 0;
    orquestraLedger = [];
    renderProgresso();
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
    atualizarProgresso(conv.id, "🔄 Executando…", "cinza");

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
    aviso.style.cssText = "font-size:11px;color:#facc15;margin-bottom:6px";
    aviso.textContent = esperados
      ? `Conclua o ${conv.label} no sistema. O CRATOS espera ${esperados} ` +
        `certidão(ões) e segue sozinho quando chegarem — ou clique abaixo.`
      : `Conclua o ${conv.label} no sistema (conferir, salvar, autorizar) e ` +
        `clique abaixo para seguir.`;
    area.appendChild(aviso);

    let finalizado = false;      // trava o AVANÇO (impede idx++ em dobro)
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
      if (off) off();
      anotar(ledgerStatus || "ok", ledgerDetalhe || sufixo || "");
      area.innerHTML = `<div style="font-size:12px;color:#9a9a9a">Seguindo…</div>`;
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
      if (off) off();
      const esp = Number(p.esperados) > 0 ? Number(p.esperados) : (esperados || "?");
      anotar("trava", `${p.feitos || 0} de ${esp}` + (p.motivo ? " — " + p.motivo : ""));
      atualizarProgresso(conv.id, "⛔ Parou — confira antes de seguir", "erro");
      const m = document.createElement("div");
      m.style.cssText = "font-size:11px;color:#ff6b6b;margin:6px 0";
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
    btnPular.className = "cx-acao";
    btnPular.style.cssText = "font-size:12px;margin-top:6px;background:#1a1a1a;" +
      "border:1px solid #6b7280;color:#cbd5e1";
    btnPular.textContent = `⏭ Pular ${conv.label} — próximo da fila`;
    btnPular.onclick = () => {
      const quanto = esperados ? ` (${chegaram.size} de ${esperados})` : "";
      finalizar(false, " (pulado)", "conferir", "pulado pelo usuário" + quanto);
    };
    area.appendChild(btnPular);
  }

  /* Relatório de fim de fila. Substitui o "✓ Todos concluídos" por um placar que
     não dá para não ver — porque quem disparou hands-off não está na tela. */
  function renderRelatorioFinal() {
    const prog = corpo.querySelector("#cx-progresso");
    if (!prog) return;
    const total = orquestraLedger.length;
    const okN = orquestraLedger.filter((e) => e.status === "ok").length;
    const precisa = orquestraLedger.filter((e) => e.status !== "ok");
    const div = document.createElement("div");
    div.id = "cx-relatorio";
    div.style.cssText = "margin-top:10px;padding-top:8px;border-top:1px solid #333;font-size:12px";
    const itensPrecisa = precisa.map((e) => {
      const vermelho = e.status === "erro" || e.status === "trava";
      return html`<div style="color:${vermelho ? "#ff6b6b" : "#facc15"};margin-top:3px">⚠ ${e.label} — ${e.detalhe || e.status}</div>`;
    });
    const corTopo = precisa.length ? "#facc15" : "#4ade80";
    const quemPrecisa = precisa.length ? `, ${precisa.length} precisa(m) de você` : "";
    CratosHTML.definir(div, html`<div style="font-weight:700;color:${corTopo}">${total} convênio(s): ${okN} concluído(s)${quemPrecisa}</div>${itensPrecisa}`);
    prog.appendChild(div);
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

    const prog = corpo.querySelector("#cx-progresso");
    if (!prog) return;
    const caixa = document.createElement("div");
    caixa.id = "cx-colheita-auto";
    caixa.style.cssText = "font-size:12px;margin-top:8px;padding-top:8px;border-top:1px solid #333";
    prog.appendChild(caixa);
    /* 1.5.5: `dizer` recebe fragmento html``; texto solto entraria escapado. */
    const dizer = (frag) => CratosHTML.definir(caixa, frag);
    const btnRecolher = html`<button class="cx-acao" id="cx-recolher" style="margin-top:6px">Verificar de novo</button>`;

    dizer(html`<span style="color:#9a9a9a">Verificando a caixa postal do eCAC… (a aba abre fria e pode levar até um minuto)</span>`);
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
        dizer(html`<div style="color:#9a9a9a">A Receita ainda não respondeu ao INFOJUD deste processo — o retorno costuma levar de minutos a horas.</div>${btnRecolher}`);
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
        dizer(html`<div style="color:#facc15">Não consegui ler a caixa postal: ${detalhe}${oQueFazer} Depois clique abaixo.</div>${btnRecolher}`);
      } else {
        dizer(html`<div style="color:#facc15">Não consegui verificar a caixa postal (${(r && (r.erro || r.motivo)) || "erro"}).</div>${btnRecolher}`);
      }
      const b = caixa.querySelector("#cx-recolher");
      if (b) b.onclick = () => { caixa.remove(); colheitaAoFimDaFila(); };
      return;
    }

    const s0 = r.solicitacao;
    const naoLidas = (typeof r.naoLidas === "number") ? r.naoLidas : (s0.lida ? 0 : 1);
    const casadas = r.totalCasadas > 1 ? ` (${r.totalCasadas} solicitações, ${naoLidas} não lida(s))` : "";
    const resumo = html`<div style="color:#4ade80">✓ Resposta do INFOJUD encontrada — solicitação ${s0.numSolicitacao}, de ${s0.dataEnvio}.${casadas}</div>`;

    if (modo !== "colher") {
      dizer(html`${resumo}<button class="cx-acao" id="cx-colher-auto" style="margin-top:6px">Colher tudo (automático)</button>`);
      const b = caixa.querySelector("#cx-colher-auto");
      if (b) b.onclick = async () => {
        b.disabled = true;
        dizer(html`${resumo}<span style="color:#9a9a9a">Colhendo… (não feche a aba que abrir)</span>`);
        dizer(html`${resumo}${await _colher(numero)}`);
      };
      return;
    }

    dizer(html`${resumo}<span style="color:#9a9a9a">Colhendo as respostas… (não feche a aba que abrir)</span>`);
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
      return html`<div style="color:#facc15">Achei a resposta, mas não consegui colher (${(r && (r.erro || r.motivo)) || "erro"}). Use o botão "Localizar resultado na caixa postal" no pé do painel.</div>`;
    }
    const n = (r.baixados != null) ? r.baixados : (r.total != null ? r.total : null);
    const qtd = n != null ? ` (${n} arquivo(s))` : "";
    return html`<div style="color:#4ade80">✓ Respostas do INFOJUD colhidas${qtd} e salvas na pasta CRATOS.</div>`;
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
    caixa.style.cssText = "font-size:12px;margin-top:8px;padding-top:8px;border-top:1px solid #333";
    prog.appendChild(caixa);
    /* O status da juntada é escrito por `acaoJuntar`, que procura
       `#cx-juntar-status` — então o bloco cria esse id aqui também, em vez de
       duplicar a lógica de mensagem. */
    const render = (cabecalho) => {
      const cartoes = certidoes.map((c, i) =>
          html`<div style="border:1px solid #333;border-radius:6px;padding:8px;margin:6px 0">
             <div style="color:#e8e8e8;font-weight:600">${c.titulo}</div>
             <div style="color:#9a9a9a;font-size:12px;margin:4px 0">${c.convenios.join(", ")}
               — ${c.arquivos.length} arquivo(s)</div>
             <button class="cx-acao" data-cert-auto="${i}">Criar no processo</button>
           </div>`);
      CratosHTML.definir(caixa, html`${cabecalho}${cartoes}<div class="cx-vazio" id="cx-juntar-status" style="margin-top:6px"></div>`);
      caixa.querySelectorAll("[data-cert-auto]").forEach((b) => {
        b.onclick = () => acaoJuntar(certidoes[Number(b.dataset.certAuto)],
          Number(idProcesso), numero);
      });
    };

    if (modo !== "sim") {
      render(html`<div style="color:#facc15">Pronto para certificar nos autos (${certidoes.length}):</div>`);
      return;
    }

    render(html`<div style="color:#9a9a9a">Criando a certidão no processo…</div>`);
    await acaoJuntar(certidoes[0], Number(idProcesso), numero);
    if (certidoes.length > 1) {
      const extra = document.createElement("div");
      extra.style.cssText = "color:#facc15;margin-top:8px";
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
      html`<div id="cx-prog-${c.id}" style="font-size:12px;padding:2px 0;color:#9a9a9a">
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
      div.style.cssText = "font-size:12px;padding:4px 0;color:#4ade80;font-weight:700";
      div.textContent = texto;
      prog.appendChild(div);
      return;
    }
    const el = prog.querySelector(`#cx-prog-${id}`);
    if (!el) return;
    const cores = { verde: "#4ade80", amarelo: "#facc15", erro: "#ff6b6b", cinza: "#9a9a9a" };
    el.style.color = cores[cor] || "#9a9a9a";
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
      <div style="color:#4ade80">✓ Solicitação localizada (trava de processo OK)</div>
      <div style="color:#9a9a9a;margin-top:4px">
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
    CratosHTML.definir(st, html`<span style="color:#9a9a9a">Colhendo ${soEfin ? "o e-Financeira" : "automaticamente"} na caixa postal… (não feche a aba que abrir)</span>`);
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
      CratosHTML.definir(st, html`<span style="color:#facc15">Nenhuma resposta não lida ainda para este processo${r.totalCasadas ? ` (há ${r.totalCasadas} já lida(s))` : ""}. Tente novamente em instantes.</span>`);
      return;
    }
    const pendTxt = (r.pendentes && r.pendentes.length)
      ? html`<div style="color:#facc15;margin-top:4px">Pendentes (colher depois): ${r.pendentes.join(" | ")}</div>` : "";
    const falhasTxt = (r.falhas && r.falhas.length)
      ? html`<div style="color:#ff6b6b;margin-top:4px">Falhas: ${r.falhas.join(" | ")}</div>` : "";
    const cab = r.timeout
      ? html`<span style="color:#facc15">⏱ Tempo esgotado — ${r.colhidos}/${r.total} colhidos em ${r.mensagens} solicitação(ões).</span>`
      : html`<span style="color:#4ade80">✓ ${r.colhidos}/${r.total} itens colhidos em ${r.mensagens} solicitação(ões).</span>`;
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
    const tipos = await getPje(`${API}/dominio/tiposdocumentoprocesso/processo/${idProcesso}`);
    const tipoCert = (tipos || []).find(
      (t) => norm(t.nomeTipoProcessoDocumento) === "certidao");
    if (!tipoCert) throw new Error('não achei o tipo de documento "Certidão" neste processo');

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
    const tipoAnexo = (tipos || []).find((t) => norm(t.nomeTipoProcessoDocumento) === "documento diverso");
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
          tipo: "Documento Diverso",
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
  async function acaoJuntar(certidao, idProcesso, numProcesso) {
    const st = corpo.querySelector("#cx-juntar-status");
    const dizer = (frag) => CratosHTML.definir(st, frag);
    dizer(html`<span style="color:#9a9a9a">Criando a certidão no processo…</span>`);
    try {
      const r = await juntarCertidao(idProcesso, certidao, numProcesso);
      /* `familia`, e não `tipo`: o literal já usa `tipo` para o NOME da mensagem,
         e a chave repetida silenciosamente sobrescrevia a primeira — a mensagem
         virava {tipo:"realizados"} e nunca chegava ao diário. Pego pelo teste. */
      await browser.runtime.sendMessage({
        tipo: "diario_marcar_juntado", numProcesso, familia: certidao.tipo,
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
        try { await browser.runtime.sendMessage({ tipo: "cofre_limpar", numProcesso }); } catch (e) {}
      }

      /* 1.5.5: lista de fragmentos html`` em vez de string concatenada. */
      const listaBr = (itens) => itens.map((t, i) => html`${i ? html`<br>` : ""}• ${t}`);
      const partesMsg = [html`<div style="color:#4ade80">✓ "${certidao.titulo}" criada como minuta no processo.</div>`];
      if (an.anexados.length) {
        partesMsg.push(html`<div style="color:#4ade80;margin-top:6px">✓ ${an.anexados.length} documento(s) anexado(s) pelo CRATOS:<br>${listaBr(an.anexados)}</div>`);
      }
      const vis = r && r.visibilidade;
      if (vis && vis.ok && vis.pessoas) {
        partesMsg.push(html`<div style="color:#4ade80;margin-top:6px">✓ visibilidade dada a ${vis.pessoas} parte(s) em ${vis.docs} documento(s).</div>`);
      } else if (vis && vis.ok === false) {
        partesMsg.push(html`<div style="color:#facc15;margin-top:6px">Não consegui dar visibilidade às partes (${vis.erro || "erro"}) — dê à mão na tela do documento.</div>`);
      }
      if (an.falharam.length) {
        partesMsg.push(html`<div style="color:#facc15;margin-top:6px">Não consegui anexar:<br>${listaBr(an.falharam.map((f) => f.nome + " — " + f.motivo))}</div>`);
      }
      if (faltando.length) {
        /* "semBytes" quase sempre quer dizer: o arquivo é de outra sessão do
           navegador. Não é erro, e a frase diz isso em vez de acusar falha. */
        const comoAnexar = an.anexados.length ? "Falta anexar à mão" : "Anexe da pasta CRATOS";
        partesMsg.push(html`<div style="color:#9a9a9a;margin-top:6px">${comoAnexar} (arquivo de outra sessão do navegador, fora do alcance da extensão):<br>${listaBr(faltando)}</div>`);
      }
      partesMsg.push(html`<div style="color:#facc15;margin-top:6px">Falta você conferir e assinar — o CRATOS não assina.</div><button class="cx-acao" id="cx-abrir-anexar" style="margin-top:8px">Abrir o documento no processo</button>`);
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
    st.innerHTML = `<span style="color:#9a9a9a">Lendo o que foi feito neste processo…</span>`;

    const r = await browser.runtime.sendMessage({ tipo: "diario_ler", numProcesso: numero });
    const certidoes = (r && r.certidoes) || [];
    if (!certidoes.length) {
      st.innerHTML = `<span style="color:#facc15">Nada a certificar neste processo — ou tudo que rodou já foi juntado.</span>`;
      return;
    }
    CratosHTML.definir(st, html`${certidoes.map((c, i) =>
      html`<div style="border:1px solid #333;border-radius:6px;padding:8px;margin-bottom:6px">
         <div style="color:#e8e8e8;font-weight:600">${c.titulo}</div>
         <div style="color:#9a9a9a;font-size:12px;margin:4px 0">${c.convenios.join(", ")}
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
        `\n\nDepois confira e assine — o CRATOS não assina por você.`, "#facc15");
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
    linha.style.cssText = "font-size:11px;color:#facc15;margin:-2px 0 4px 26px;line-height:1.35";
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
  };

})();
