/*
 * conteudo/painel-estilo.js — o CSS do painel, como TEXTO (2.0).
 *
 * Antes era o painel.css, injetado pelo content_scripts na página do PJe. Na 2.0 o
 * painel vive num shadow DOM aberto: o CSS do PJe não entra e o nosso não sai. O
 * texto vai num <style> dentro do shadowRoot, junto com o de comum/tema.js.
 *
 * `:host { all: initial }` corta a herança (fonte, cor, altura de linha, alinhamento)
 * que ainda atravessaria a fronteira vinda do <body> do PJe.
 */
(function () {
  "use strict";
  if (globalThis.CratosPainelEstilo) return;
  globalThis.CratosPainelEstilo = String.raw`
:host { all: initial; }
[hidden] { display: none !important; }

/* ── Botão flutuante ──────────────────────────────────────────────────────────
   Chapa escura de cantos arredondados, sem moldura vermelha (Rodrigo, 19/08). A
   imagem sai do arquivo de 128 e é REDUZIDA (reduzir é sempre nítido). */
cratos-botao {
  position: fixed; right: 18px; bottom: 18px; z-index: 2147483000;
  width: 56px; height: 56px; border-radius: 16px; background: #141414; border: none;
  cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45); transition: transform 0.12s ease;
}
cratos-botao:active { cursor: grabbing; }
cratos-botao:hover { transform: scale(1.06); }
cratos-botao:focus-visible { outline: 3px solid #D9A441; outline-offset: 3px; }
cratos-botao img { width: 46px; height: 46px; pointer-events: none; }
/* Desligado: esmaecido, com o selo de energia (SVG, não glifo de fonte). O botão
   nunca some: é a porta de volta para religar. */
cratos-botao[desligado] { filter: grayscale(1); opacity: 0.5; }
cratos-botao[desligado]::after {
  content: ""; position: absolute; right: -4px; bottom: -4px; width: 18px; height: 18px; border-radius: 50%;
  background: #e11d1d url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23fff' stroke-width='2.4' stroke-linecap='round'%3E%3Cline x1='12' y1='4.5' x2='12' y2='11.5'/%3E%3Cpath d='M7 7a7 7 0 1 0 10 0'/%3E%3C/svg%3E") center / 12px 12px no-repeat;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
}

/* ── Painel ─────────────────────────────────────────────────────────────────── */
cratos-painel {
  position: fixed; right: 18px; bottom: 86px; z-index: 2147483000;
  width: 400px; max-width: calc(100vw - 16px); max-height: min(82vh, 780px); overflow-y: auto;
  border: var(--bw, 1px) solid var(--ln, #262A33); border-radius: 14px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
  font-size: 14px; line-height: 1.45; display: none;
}
cratos-painel[aberto] { display: block; }
cratos-painel *, cratos-painel *::before, cratos-painel *::after { box-sizing: border-box; }
cratos-painel button, cratos-painel input, cratos-painel select { font-family: inherit; font-size: inherit; color: inherit; }
cratos-painel a { color: var(--actx); }
kbd { font: 600 12px/1 system-ui, sans-serif; border: var(--bw) solid var(--bd2); border-radius: 4px; padding: 2px 5px; background: var(--bg); }

.cx-cabecalho {
  display: flex; align-items: center; gap: 6px; padding: 10px 8px 10px 14px;
  border-bottom: var(--bw) solid var(--ln); position: sticky; top: 0; z-index: 3; background: var(--bg);
}
.cx-raio { width: 22px; height: 22px; color: var(--ac); flex: none; }
.cx-titulo { flex: 1; min-width: 0; }
.cx-h1 { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: 0.08em; }
.cx-proc { font-size: 12px; color: var(--fg2); font-variant-numeric: tabular-nums; white-space: nowrap; }
.cx-power {
  display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 10px; border-radius: 999px; flex: none;
  border: var(--bw) solid var(--okbd); background: var(--okbg); color: var(--oktx);
  font-size: 12px; font-weight: 600; line-height: 1; cursor: pointer; user-select: none;
}
.cx-power.cx-off { border-color: var(--erbd); background: var(--erbg); color: var(--ertx); }
.cx-power-ico { width: 14px; height: 14px; display: block; }
.cx-icone {
  position: relative; width: 36px; height: 36px; padding: 0; flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  border: var(--bw) solid transparent; border-radius: 10px; background: transparent; color: var(--fg); cursor: pointer;
}
.cx-icone svg { width: 20px; height: 20px; }
.cx-icone:hover { background: var(--sf); }
.cx-icone:disabled { opacity: 0.35; cursor: default; background: transparent; }
.cx-ponto { position: absolute; top: 5px; right: 5px; width: 8px; height: 8px; border-radius: 50%; background: var(--ac); border: 2px solid var(--bg); }

/* ── Menu "⋯" (abre logo abaixo do cabeçalho, empurrando o conteúdo) ─────────── */
.cx-menu {
  display: flex; flex-direction: column; margin: 8px 10px 0; padding: 6px;
  background: var(--sf2); border: var(--bw) solid var(--bd2); border-radius: 12px;
}
.cx-menu-item {
  display: flex; align-items: center; gap: 10px; width: 100%; min-height: 44px; padding: 0 10px;
  border: none; border-radius: 8px; background: transparent; color: var(--fg); text-align: left; cursor: pointer;
}
.cx-menu-item:hover { background: var(--sf); }
.cx-menu-item[aria-pressed]::after {
  content: ""; margin-left: auto; width: 30px; height: 18px; border-radius: 999px; flex: none;
  background: var(--bd2) radial-gradient(circle at 9px 50%, var(--fg2) 5px, transparent 6px);
}
.cx-menu-item[aria-pressed="true"]::after { background: var(--ac) radial-gradient(circle at 21px 50%, var(--onac) 5px, transparent 6px); }
.cx-menu-area { display: flex; flex-direction: column; gap: 6px; margin: 0 4px 6px; padding: 8px 10px; border-radius: 8px; background: var(--bg); border: var(--bw) solid var(--bd); }
.cx-atalhos { list-style: none; font-size: 13px; }
.cx-atalhos li { padding: 2px 0; }
.cx-rotulo-campo { font-size: 12px; color: var(--fg2); }
.cx-campo { width: 100%; min-height: 36px; padding: 4px 8px; border-radius: 8px; border: var(--bw) solid var(--bd2); background: var(--bg); color: var(--fg); }
.cx-menu .cx-acao { margin-top: 2px; }

/* ── Corpo e abas ──────────────────────────────────────────────────────────── */
.cx-corpo { padding: 8px 12px 14px; }
.cx-abas { display: flex; gap: 4px; padding: 4px; margin: 4px 0 8px; background: var(--trk); border: var(--bw) solid var(--ln); border-radius: 10px; }
.cx-aba { flex: 1; height: 38px; border: none; border-radius: 7px; background: transparent; color: var(--fg2); font-size: 13px; font-weight: 500; cursor: pointer; }
.cx-aba[aria-selected="true"] { background: var(--tabsel); color: var(--tabseltx); font-weight: 600; }
.cx-aba-p:focus { outline: none; }

.cx-h { margin: 12px 4px 6px; font-size: 12px; font-weight: 500; color: var(--fg2); }
.cx-h2 { margin: 0 0 4px; font-size: 14px; font-weight: 600; color: var(--fg); }
.cx-h3 { margin: 0; font-size: 14px; font-weight: 600; }
.cx-det { margin: 2px 0 0; font-size: 13px; color: var(--fg2); }
.cx-dica { margin: -2px 4px 8px; font-size: 12px; color: var(--fg2); }
.cx-vazio { color: var(--fg2); padding: 8px 4px; }
.cx-erro { color: var(--ertx); }
.cx-aviso { margin: 4px 0 10px; padding: 10px 12px; border-radius: 10px; background: var(--pdbg); border: var(--bw) solid var(--pdbd); color: var(--pdtx); font-size: 13px; }
.cx-aviso-perigo { background: var(--erbg); border-color: var(--erbd); color: var(--ertx2); }

.cx-lista { list-style: none; margin: 0; padding: 2px 4px; background: var(--sf); border: var(--bw) solid var(--ln); border-radius: 12px; }
.cx-lista > li + li { border-top: var(--bw) solid var(--ln); }
.cx-item { padding: 12px 8px; }
.cx-parte { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; min-height: 44px; padding: 2px 4px; }
.cx-rot { display: flex; gap: 10px; align-items: center; flex: 1; min-height: 40px; cursor: pointer; }
.cx-rot input { width: 18px; height: 18px; margin: 0; flex: none; accent-color: var(--ac); }
.cx-parte-txt { display: flex; flex-direction: column; }
.cx-nome { font-weight: 500; }
.cx-doc { color: var(--fg2); font-size: 12px; font-variant-numeric: tabular-nums; }
.cx-polo { font-size: 11px; color: var(--fg3); text-transform: uppercase; }
.cx-ord { display: flex; gap: 2px; }
.cx-ord .cx-icone { width: 32px; height: 32px; font-size: 11px; color: var(--fg2); }

/* ── Botões ────────────────────────────────────────────────────────────────── */
.cx-acao {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  width: 100%; min-height: 44px; margin-top: 10px; padding: 8px 14px;
  border: var(--bw) solid transparent; border-radius: 10px; background: var(--ac); color: var(--onac);
  font-weight: 600; line-height: 1.2; text-align: center; cursor: pointer;
}
.cx-acao:hover { filter: brightness(1.08); }
.cx-acao:disabled { opacity: 0.5; cursor: not-allowed; filter: none; }
.cx-sec { background: var(--sf2); color: var(--fg); border-color: var(--bd2); }
.cx-perigo { background: var(--erfill); color: var(--eron); }
.cx-perigo-borda { background: transparent; color: var(--ertx); border-color: var(--erbd); }
.cx-mini { width: auto; min-height: 36px; margin: 0; font-size: 13px; }
.cx-link { padding: 0; border: none; background: none; color: var(--actx); text-decoration: underline; font-size: 12px; cursor: pointer; }

.cx-form-msg { margin-top: 8px; }
.cx-form-msg:empty { display: none; }
.cx-rodape {
  position: sticky; bottom: 0; z-index: 2; display: flex; align-items: center; justify-content: space-between; gap: 10px;
  margin: 12px -12px 0; padding: 12px; background: var(--bg); border-top: var(--bw) solid var(--ln);
}
.cx-rodape .cx-acao { width: auto; margin: 0; }
.cx-resumo { font-size: 12px; color: var(--fg2); }
.cx-dialogo { margin-top: 10px; padding: 12px; border-radius: 10px; background: var(--erbg); border: var(--bw) solid var(--erbd); }
.cx-dialogo .cx-h2, .cx-dialogo .cx-det { color: var(--ertx2); }
.cx-botoes { display: flex; gap: 8px; }
.cx-botoes .cx-acao { flex: 1; }
.cx-fila-topo { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 4px 4px 8px; }
.cx-status { margin-top: 8px; font-size: 13px; }
.cx-status:empty { display: none; }
.cx-cofre { margin-top: 14px; padding: 14px; background: var(--sf); border: var(--bw) solid var(--ln); border-radius: 12px; }
.cx-cartao { margin: 4px 4px 8px; padding: 10px 12px; border-radius: 10px; background: var(--acsel); border: var(--bw) solid var(--acbd); font-size: 13px; }
.cx-cartao .cx-acao { width: auto; }

.cx-desligado { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 24px 12px; text-align: center; }
.cx-desligado .cx-acao { width: auto; }
.cx-power-grande { color: var(--ertx); }
.cx-power-grande .cx-power-ico { width: 48px; height: 48px; margin: 0 auto; }
`;
})();
