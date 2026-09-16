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
    this.mostrar(modulo, msg, "#facc15");
  },

  dizer(modulo, msg) { this.mostrar(modulo, msg, "#4ade80"); },
};

globalThis.CratosFaixa = CratosFaixa;

}

if (typeof module !== "undefined") { module.exports = { CratosFaixa: globalThis.CratosFaixa }; }
