/*
 * comum/faixa.js — a faixa que fala com quem está na tela.
 *
 * Por que existe: até a 0.7.1, RENAJUD e INFOJUD desistiam CALADOS
 * (`console.warn(...); return;`) e o SAB tinha quatro pontos assim. Quem estava
 * olhando via uma tela parada e não sabia se ainda processava ou se tinha
 * morrido — e o console ninguém abre no meio de um ato.
 *
 * Três níveis, e a diferença entre eles é o que a pessoa precisa FAZER:
 *   parar()   vermelho — a automação desistiu; diz se algo já tinha sido enviado
 *   alertar() âmbar    — seguiu, mas com uma ressalva que muda a conferência
 *   dizer()   verde    — só progresso
 *
 * O CNIB, o SerasaJUD e o CENSEC ainda têm cópias locais desta faixa, de antes
 * dela existir. Não mexi neles nesta leva porque estão cobertos por teste e a
 * migração não muda nada para o usuário — mas é dívida anotada: quando o
 * próximo deles for tocado, ele passa a usar este arquivo.
 */
/* Guard de idempotência + exposição em globalThis, como o storage.js: uma
   página que casa dois content_scripts injeta este arquivo duas vezes, e
   `const` no topo estouraria com "redeclaration". */
if (typeof globalThis.CratosFaixa === "undefined") {

const CratosFaixa = {
  _id(modulo) { return "cratos-" + String(modulo || "geral").toLowerCase() + "-aviso"; },

  mostrar(modulo, texto, cor) {
    try {
      const id = this._id(modulo);
      let faixa = document.getElementById(id);
      if (!faixa) {
        faixa = document.createElement("div");
        faixa.id = id;
        /* bottom:64px para não cobrir o emblema do recon nem os balões de
           suporte que esses sites põem no canto direito. Clique fecha. */
        faixa.style.cssText = "position:fixed;left:12px;bottom:64px;z-index:2147483646;" +
          "max-width:440px;padding:10px 12px;border-radius:8px;background:#111;color:#e8e8e8;" +
          "font:13px/1.45 system-ui,sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.45);" +
          "border-left:4px solid #e11d1d;white-space:pre-wrap;cursor:pointer";
        faixa.title = "clique para fechar";
        faixa.addEventListener("click", () => faixa.remove());
        (document.body || document.documentElement).appendChild(faixa);
      }
      faixa.style.borderLeftColor = cor || "#e11d1d";
      faixa.textContent = "CRATOS — " + texto;
      /* A faixa é o funil por onde passa TUDO que o usuário vê. Registrar aqui
         dá o rastro de graça, sem instrumentar fluxo nenhum. */
      try { CratosRelatorio.registrar(modulo, texto, cor === "#ff6b6b" ? "parou"
        : cor === "#facc15" ? "ressalva" : "ok"); } catch (e) {}
      return faixa;
    } catch (e) {
      /* página ainda sem body: o console já registrou */
      return null;
    }
  },

  /* Desistiu. `opts.enviado` muda a orientação, e essa distinção é a parte
     importante: o que não foi enviado se refaz; o que já foi, não. */
  parar(modulo, msg, opts) {
    const o = opts || {};
    /* Se um overlay de "aguarde" estiver no ar, tira-o: uma parada exige que a
       pessoa VEJA a faixa e possa clicar no botão de relatório. */
    try { if (globalThis.CratosOverlay) globalThis.CratosOverlay.esconder(); } catch (e) {}
    console.error("%cCRATOS/" + String(modulo).toUpperCase() + ": PAREI — " + msg,
      "color:#ff6b6b;font-weight:bold");
    /* `opts.cauda` existe porque "Nada foi enviado" é FALSO em consulta: no
       CENSEC as partes já pesquisadas foram pesquisadas mesmo. Cada convênio
       diz a verdade dele. */
    const cauda = o.cauda || (o.enviado
      ? "O ato JÁ tinha sido enviado — confira a situação dele na tela antes de repetir."
      : "Nada foi enviado. Confira a tela e execute de novo.");
    const faixa = this.mostrar(modulo, "PAREI: " + msg + "\n\n" + cauda, "#ff6b6b");
    this._botaoRelatorio(faixa, modulo, msg);
  },

  /* O botão nasce COLADO na falha, e não numa tela de ajuda em outro lugar:
     é neste instante que o estado da operação ainda está gravado. Cinco minutos
     depois, a próxima execução sobrescreve tudo. */
  _botaoRelatorio(faixa, modulo, msg) {
    try {
      if (!faixa || faixa.querySelector(".cratos-btn-relato")) return;
      const b = document.createElement("button");
      b.className = "cratos-btn-relato";
      b.textContent = "Gerar relatório do problema";
      b.style.cssText = "margin-top:10px;padding:6px 12px;background:#2a2a2a;color:#e8e8e8;" +
        "border:1px solid #444;border-radius:6px;font:12px system-ui,sans-serif;cursor:pointer";
      b.addEventListener("click", (ev) => {
        ev.stopPropagation();   // o clique na faixa fecha a faixa
        try { CratosRelatorio.abrirPainel(modulo, msg); } catch (e) { console.error(e); }
      });
      faixa.appendChild(b);
    } catch (e) { /* faixa é melhor-esforço */ }
  },

  /* Seguiu, mas com ressalva. Serve para o caso mais traiçoeiro de todos: uma
     preferência que não pôde ser aplicada. Sem isto, ela é ignorada em silêncio
     e a pessoa confirma achando que valeu. */
  alertar(modulo, msg) {
    console.warn("CRATOS/" + String(modulo).toUpperCase() + ": " + msg);
    /* 2.0: ressalva é com a pessoa — ela precisa ver e poder agir: a cortina sai. */
    try { if (globalThis.CratosOverlay) globalThis.CratosOverlay.esconder(); } catch (e) {}
    this.mostrar(modulo, msg, "#facc15");
  },

  dizer(modulo, msg) { this.mostrar(modulo, msg, "#4ade80"); },
};

globalThis.CratosFaixa = CratosFaixa;

}

/*
 * CratosOverlay — a CORTINA: "pare tudo, estou trabalhando", no centro da tela.
 *
 * Diferente da faixa (que informa no cantinho), a cortina COBRE a tela enquanto o
 * CRATOS mexe sozinho na página de um convênio, para a pessoa não clicar no meio.
 * Fica ABAIXO da faixa no empilhamento, e o parar() da faixa tira a cortina.
 *
 * 2.0 — INERTE PARA A PESSOA, NÃO PARA O CRATOS. A página por baixo some para o
 * leitor de tela (aria-hidden), o Tab fica preso no botão da cortina e clique e
 * teclado de verdade (isTrusted) não chegam à página. NÃO usamos o atributo `inert`:
 * ele também barra o focus() que o próprio CRATOS usa para preencher campos (o
 * RENAJUD e o CNIB precisam dele), e a automação quebraria.
 *
 * SAÍDA GARANTIDA (a cortina altera página de terceiros):
 *   - botão "Liberar a página" (e Esc): tira a cortina e ela não volta nesta etapa;
 *   - some sozinha em 3 min sem renovação;
 *   - some ao sair da página (pagehide) — nada fica escondido se a página voltar;
 *   - `durante(texto, fn)` tira a cortina no fim, dê certo ou errado;
 *   - tudo o que foi escondido é devolvido exatamente como estava.
 * Ela cobre só o que o CRATOS faz sozinho: na passagem para a pessoa (conferir,
 * confirmar, aceitar termo) quem chama tira a cortina antes de avisar.
 */
if (typeof globalThis.CratosOverlay === "undefined") {

const CratosOverlay = {
  _id: "cratos-overlay-aguarde",
  _timer: null,
  _escondidos: [],
  _liberado: false,
  _teclas: null,
  _saida: null,
  /* Evento da PESSOA (teclado/mouse de verdade) × evento do próprio CRATOS (sintético).
     Função à parte para o teste poder simular a pessoa (no jsdom, todo evento é sintético). */
  _daPessoa(e) { return e.isTrusted !== false; },

  /* Irmãos do <body> que continuam à vista do leitor de tela: a própria cortina, as
     faixas do CRATOS (paradas precisam ser lidas) e o painel do CRATOS. */
  _manterVisivel(el) {
    const id = (el && el.id) || "";
    return id === this._id || /^cratos-.*-aviso$/.test(id) || (el && el.tagName === "CRATOS-RAIZ");
  },

  mostrar(texto) {
    try {
      if (this._liberado) return null;     // a pessoa liberou a página nesta etapa
      clearTimeout(this._timer);
      let ov = document.getElementById(this._id);
      if (!ov) {
        if (!document.getElementById("cratos-ov-style")) {
          const st = document.createElement("style");
          st.id = "cratos-ov-style";
          st.textContent = "@keyframes cratosSpin{to{transform:rotate(360deg)}}" +
            "@media (prefers-reduced-motion: reduce){#cratos-overlay-aguarde .cratos-ov-spin{animation:none!important}}" +
            "#cratos-ov-liberar:focus-visible{outline:3px solid #D9A441;outline-offset:2px}" +
            "@media (forced-colors: active){#cratos-overlay-aguarde .cratos-ov-card{border:2px solid CanvasText}}";
          (document.head || document.documentElement).appendChild(st);
        }
        ov = document.createElement("div");
        ov.id = this._id;
        ov.style.cssText = "position:fixed;inset:0;z-index:2147483640;display:flex;" +
          "align-items:center;justify-content:center;background:rgba(0,0,0,.55);cursor:progress";
        const card = document.createElement("div");
        card.className = "cratos-ov-card";
        card.setAttribute("role", "alertdialog");
        card.setAttribute("aria-modal", "true");
        card.setAttribute("aria-labelledby", "cratos-ov-titulo");
        card.setAttribute("aria-describedby", "cratos-ov-txt");
        card.style.cssText = "min-width:260px;max-width:min(440px,86vw);padding:22px 26px;border-radius:12px;cursor:default;" +
          "background:#121419;color:#ECEAE4;font:15px/1.5 system-ui,sans-serif;text-align:center;" +
          "box-shadow:0 6px 30px rgba(0,0,0,.6);border-top:4px solid #D9A441";
        const spin = document.createElement("div");
        spin.className = "cratos-ov-spin";
        spin.setAttribute("aria-hidden", "true");
        spin.style.cssText = "width:34px;height:34px;margin:0 auto 14px;border-radius:50%;" +
          "border:4px solid #3A404C;border-top-color:#D9A441;animation:cratosSpin .9s linear infinite";
        const tit = document.createElement("div");
        tit.id = "cratos-ov-titulo";
        tit.style.cssText = "font-weight:600;margin-bottom:4px";
        tit.textContent = "O CRATOS está trabalhando nesta página";
        const txt = document.createElement("div");
        txt.id = "cratos-ov-txt";
        txt.className = "cratos-ov-txt";
        txt.setAttribute("role", "status");
        txt.setAttribute("aria-live", "polite");
        const bt = document.createElement("button");
        bt.type = "button";
        bt.id = "cratos-ov-liberar";
        bt.textContent = "Liberar a página";
        bt.style.cssText = "margin-top:16px;min-height:40px;padding:8px 16px;border-radius:8px;cursor:pointer;" +
          "border:1px solid #3A404C;background:#22262F;color:#ECEAE4;font:600 14px system-ui,sans-serif";
        const nota = document.createElement("div");
        nota.style.cssText = "margin-top:8px;font-size:12px;color:#A3A7B0";
        nota.textContent = "Liberar tira esta cortina. Mexer na página agora pode atrapalhar o que o CRATOS está fazendo.";
        bt.addEventListener("click", (e) => { e.stopPropagation(); this.liberar(); });
        card.appendChild(spin); card.appendChild(tit); card.appendChild(txt); card.appendChild(bt); card.appendChild(nota);
        ov.appendChild(card);
        /* Clique de verdade fora do cartão não chega à página. */
        const engole = (e) => { if (this._daPessoa(e) && !card.contains(e.target)) { e.stopPropagation(); e.preventDefault(); } };
        ov.addEventListener("click", engole, true);
        ov.addEventListener("mousedown", engole, true);
        (document.body || document.documentElement).appendChild(ov);

        /* A página some para o leitor de tela (só o que estava visível; o resto fica). */
        this._escondidos = [];
        for (const el of Array.from((document.body || document.documentElement).children)) {
          if (this._manterVisivel(el) || el.getAttribute("aria-hidden") === "true") continue;
          el.setAttribute("aria-hidden", "true");
          this._escondidos.push(el);
        }
        /* Teclado de verdade: Tab fica no botão; Esc libera; o resto não chega à página.
           Eventos sintéticos (isTrusted=false) são do próprio CRATOS: passam. */
        this._teclas = (e) => {
          if (!this._daPessoa(e) || !document.getElementById(this._id)) return;
          if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this.liberar(); return; }
          if (e.key === "Tab") { e.preventDefault(); e.stopPropagation(); bt.focus(); return; }
          if (e.target === bt && (e.key === "Enter" || e.key === " ")) return;
          e.preventDefault(); e.stopPropagation();
        };
        document.addEventListener("keydown", this._teclas, true);
        this._saida = () => this.esconder();
        window.addEventListener("pagehide", this._saida);
      }
      ov.querySelector(".cratos-ov-txt").textContent = "CRATOS — " + (texto || "Aguarde…");
      /* Rede de segurança: se algo travar, a cortina não fica presa para sempre. */
      this._timer = setTimeout(() => this.esconder(), 180000);
      return ov;
    } catch (e) { return null; }
  },

  /* A pessoa pediu a página de volta: sai e não volta até a etapa terminar. */
  liberar() {
    this._liberado = true;
    this._remover();
    try { console.warn("CRATOS: cortina liberada pela pessoa; a automação segue, sem cobrir a tela."); } catch (e) {}
  },

  /* Fim da etapa (ou parada): sai, e a próxima etapa pode cobrir de novo. */
  esconder() {
    this._liberado = false;
    this._remover();
  },

  _remover() {
    try {
      clearTimeout(this._timer);
      const ov = document.getElementById(this._id);
      if (ov) ov.remove();
      for (const el of this._escondidos) { try { el.removeAttribute("aria-hidden"); } catch (e) {} }
      this._escondidos = [];
      if (this._teclas) document.removeEventListener("keydown", this._teclas, true);
      if (this._saida) window.removeEventListener("pagehide", this._saida);
      this._teclas = null; this._saida = null;
    } catch (e) {}
  },

  /* Cobre enquanto `fn` roda e tira no fim — dê certo ou errado. */
  async durante(texto, fn) {
    this.mostrar(texto);
    try { return await fn(); } finally { this.esconder(); }
  },
};

globalThis.CratosOverlay = CratosOverlay;

}

if (typeof module !== "undefined") { module.exports = { CratosFaixa: globalThis.CratosFaixa, CratosOverlay: globalThis.CratosOverlay }; }
