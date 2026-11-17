/*
 * comum/tema.js — TEMAS DO CRATOS (2.0): grafite e ouro (padrão), claro e alto contraste.
 *
 * As cores são variáveis CSS (--bg, --fg, --ac…) definidas por classe (.t-escuro,
 * .t-claro, .t-hc). O CSS vai como TEXTO, injetado num <style> dentro do shadow DOM do
 * painel e nas páginas da extensão: nada de arquivo exposto à página do PJe
 * (sem web_accessible_resources) e nada buscado fora (as fontes são as do sistema).
 *
 * Contrastes medidos (16/11/2026): AA em todos os pares de texto nos três temas;
 * no alto contraste, nenhum par abaixo de 10:1. Foco: 2 px no escuro e no claro,
 * 3 px amarelo no alto contraste.
 *
 * Tema de contraste do Windows (forced-colors): o Firefox troca as cores pelas do
 * sistema; aqui só garantimos borda em selos e botões (o fundo colorido some) e que
 * nada dependa de cor de fundo.
 *
 * Preferência: "escuro" | "claro" | "alto-contraste" | "sistema" (segue o Firefox:
 * prefers-contrast: more → alto contraste; prefers-color-scheme: light → claro).
 */
(function () {
  "use strict";
  if (globalThis.CratosTema) return;

  const PALETAS = {
    "t-escuro": { bg: "#121419", sf: "#1A1D24", sf2: "#22262F", trk: "#1A1D24", ln: "#262A33", bd: "#2C313B", bd2: "#3A404C",
      fg: "#ECEAE4", fg2: "#A3A7B0", fg3: "#8A8F9A", ac: "#D9A441", onac: "#1A1405", actx: "#F0C46A", acbg: "#3A2D12", acbd: "#5A4418", acsel: "#2A2312",
      oktx: "#7FD3A6", okbg: "#173326", okbd: "#24503A", wttx: "#9CC1EC", wtbg: "#1B2A3E", wtbd: "#2B4262",
      pdtx: "#F7C79A", pdbg: "#3A2614", pdbd: "#5C3D1E", pdic: "#F0A35E",
      ertx: "#F2A0A0", erbg: "#2A1617", erbd: "#7A2E30", ertx2: "#F2C0C0", erfill: "#C93A3F", eron: "#FFFFFF",
      tabsel: "#2C313B", tabseltx: "#ECEAE4", foco: "#D9A441", bw: "1px", fw: "2px" },
    "t-claro": { bg: "#F7F6F2", sf: "#FFFFFF", sf2: "#FFFFFF", trk: "#ECEAE4", ln: "#E7E5DF", bd: "#D6D3CA", bd2: "#B9B5AA",
      fg: "#1B1C1F", fg2: "#555963", fg3: "#666A73", ac: "#D9A441", onac: "#1A1405", actx: "#6E4700", acbg: "#FFF0CC", acbd: "#E2BE6E", acsel: "#FFF6E0",
      oktx: "#1D6B42", okbg: "#E2F4E9", okbd: "#9CD1B2", wttx: "#1E4E86", wtbg: "#E4EEFA", wtbd: "#A7C4E8",
      pdtx: "#7A4100", pdbg: "#FFEEDB", pdbd: "#EDBE88", pdic: "#B5650E",
      ertx: "#9E2A2A", erbg: "#FCECEC", erbd: "#D98C8C", ertx2: "#8A2222", erfill: "#C93A3F", eron: "#FFFFFF",
      tabsel: "#FFFFFF", tabseltx: "#1B1C1F", foco: "#B5650E", bw: "1px", fw: "2px" },
    "t-hc": { bg: "#000000", sf: "#000000", sf2: "#000000", trk: "#000000", ln: "#FFFFFF", bd: "#FFFFFF", bd2: "#FFFFFF",
      fg: "#FFFFFF", fg2: "#FFFFFF", fg3: "#FFFFFF", ac: "#FFD400", onac: "#000000", actx: "#FFD400", acbg: "#000000", acbd: "#FFD400", acsel: "#000000",
      oktx: "#8CFFA0", okbg: "#000000", okbd: "#8CFFA0", wttx: "#66E3FF", wtbg: "#000000", wtbd: "#66E3FF",
      pdtx: "#FFB86B", pdbg: "#000000", pdbd: "#FFB86B", pdic: "#FFB86B",
      ertx: "#FF9A9A", erbg: "#000000", erbd: "#FF9A9A", ertx2: "#FF9A9A", erfill: "#FF9A9A", eron: "#000000",
      tabsel: "#FFD400", tabseltx: "#000000", foco: "#FFD400", bw: "2px", fw: "3px" },
  };
  const PREFS = ["escuro", "claro", "alto-contraste", "sistema"];

  function css() {
    const blocos = Object.entries(PALETAS).map(([cls, p]) =>
      "." + cls + "{" + Object.entries(p).map(([k, v]) => "--" + k + ":" + v).join(";") + "}");
    return blocos.join("\n") + "\n" +
      ":is(.t-escuro,.t-claro,.t-hc){color:var(--fg);background:var(--bg);" +
      "font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}\n" +
      ":is(.t-escuro,.t-claro,.t-hc) :focus-visible{outline:var(--fw) solid var(--foco);outline-offset:2px}\n" +
      ".cx-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}\n" +
      "@media (forced-colors: active){.cx-chip,.cx-btn,.cx-sw{border:1px solid CanvasText!important}" +
      ".cx-ponto{forced-color-adjust:none;background:Highlight!important}}\n" +
      "@media (prefers-reduced-motion: reduce){*{transition:none!important;animation:none!important}}";
  }

  /* `mm` = função (media query) → boolean; injetável para teste. */
  function resolver(pref, mm) {
    const p = PREFS.indexOf(pref) >= 0 ? pref : "escuro";
    if (p === "claro") return "t-claro";
    if (p === "alto-contraste") return "t-hc";
    if (p === "sistema") {
      const m = mm || ((q) => { try { return !!(globalThis.matchMedia && globalThis.matchMedia(q).matches); } catch (e) { return false; } });
      if (m("(prefers-contrast: more)")) return "t-hc";
      if (m("(prefers-color-scheme: light)")) return "t-claro";
    }
    return "t-escuro";
  }

  /* Aplica a classe do tema num elemento-raiz, tirando a anterior. */
  function aplicar(raiz, classe) {
    if (!raiz || !raiz.classList) return;
    for (const c of Object.keys(PALETAS)) raiz.classList.remove(c);
    raiz.classList.add(PALETAS[classe] ? classe : "t-escuro");
  }

  const api = { PALETAS, PREFS, css, resolver, aplicar };
  globalThis.CratosTema = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
