/*
 * comum/grafo-sniper.js — o RELATÓRIO do SNIPER desenhado (1.9.3, 10/11/2026): o grafo de
 * vínculos e, desde o mesmo dia, o relatório inteiro em blocos (ver "RELATÓRIO EM BLOCOS").
 *
 * Pedido do Rodrigo: cada grafo da aba "Grafo" do SNIPER numa página exclusiva do
 * relatório, e uma ficha por TERCEIRO vinculado (os "Detalhes do objeto" da impressão
 * do próprio SNIPER), tudo dentro do mesmo PDF, sigiloso como o resto do relatório.
 *
 * De onde vêm os dados (HAR do Rodrigo, 10/11 — só a estrutura foi lida):
 *   GET /v2/investigacao/{id}/partes/      → [{ id, uuid, selecionada }]
 *   GET /v2/grafo/node/{uuid}              → { id, group, label, properties, graph: { nodes, edges } }
 *        O que a tela desenha é exatamente isto: o nó de cada PARTE e os vizinhos DIRETOS
 *        dele (graph.nodes) com as ligações (graph.edges: { id, from, to, label, name,
 *        properties }). Os vizinhos já vêm com todos os detalhes e os rótulos prontos.
 *   GET /v2/grafo/node/{uuid}/relationships?depth=1… → { uuid: nó-com-graph, … }
 *        O levantamento maior (vizinhos dos vizinhos). Só serve para saber se um nó tem
 *        relações FORA do desenho (o "*" da impressão do SNIPER, e o tom claro da legenda).
 *
 * Decisões do Rodrigo (10/11): sem máscara (a pesquisa é autorizada pelo juízo e o
 * relatório é juntado em sigilo); só os TERCEIROS ganham ficha (as partes já estão no
 * relatório); relações com "*" ficam de fora; a ficha leva a data de entrada na
 * sociedade; legenda oficial do SNIPER (entidade / indivíduo / candidatura, tom escuro =
 * todas as relações já expandidas). O grafo é REDESENHADO pelo CRATOS (vetor no PDF),
 * em camadas: sócios em cima, empresas embaixo, setas descendo — e o rodapé diz isso.
 *
 * Duas metades, sem DOM e sem rede (testáveis no Node):
 *   montar(entrada)      → modelo { ok, grafos[], … }  (content script, a partir das respostas)
 *   paginas(modelo, ctx) → [content stream PDF, …]     (fundo, dentro do gerarPDFTexto)
 */
(function () {
  "use strict";
  if (globalThis.CratosGrafoSniper) return;

  /* ═══════════════════════════ MODELO ═══════════════════════════ */
  const GRUPO = (g) => (g === "company" ? "entidade" : g === "person" ? "individuo" : "candidatura");
  const ROTULO_GRUPO = { entidade: "Entidade", individuo: "Indivíduo", candidatura: "Candidatura" };
  const texto = (v) => {
    if (v == null) return "";
    if (typeof v === "string") return v.trim();
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    if (Array.isArray(v)) return v.map(texto).filter(Boolean).join("; ");
    if (typeof v === "object") return Object.keys(v).map((k) => `${k}: ${texto(v[k])}`).join("; ");
    return String(v);
  };
  const digitos = (s) => String(s || "").replace(/\D/g, "");
  function formatarDoc(d) {
    const x = digitos(d);
    if (x.length === 11) return x.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
    if (x.length === 14) return x.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
    return String(d || "");
  }
  /* CPF/CNPJ do nó, pelos rótulos que o SNIPER usa ("CPF", "CNPJ"). */
  function docDoNo(props) {
    const k = Object.keys(props || {}).find((x) => /^(cpf|cnpj)$/i.test(x.trim()));
    return k ? { tipo: k.trim().toUpperCase(), valor: formatarDoc(props[k]) } : null;
  }

  /*
   * entrada = {
   *   partes: [uuid, …]                      — as partes da investigação, na ordem do SNIPER
   *   nos:    { uuid: resposta de /grafo/node/{uuid} }      (obrigatório para cada parte)
   *   rel:    { uuid: resposta de /grafo/node/{uuid}/relationships }   (opcional)
   *   meta:   { processo, investigacao, consultaEm }
   * }
   * Sem a resposta de alguma parte → { ok: false, faltam: n }: o relatório diz que o grafo
   * NÃO PÔDE SER OBTIDO (nunca "sem vínculos").
   */
  function montar(entrada) {
    const e = entrada || {};
    const partes = (e.partes || []).map(String).filter(Boolean);
    const nos = e.nos || {};
    const rel = e.rel || {};
    if (!partes.length) return { ok: false, faltam: 0, motivo: "o SNIPER não informou as partes do grafo" };
    const faltam = partes.filter((u) => !nos[u] || typeof nos[u] !== "object" || !nos[u].graph);
    if (faltam.length) return { ok: false, faltam: faltam.length, motivo: `o SNIPER não carregou o grafo de ${faltam.length} parte(s)` };

    const ehParte = new Set(partes);
    const dados = new Map();            // id → { id, grupo, rotulo, props: [[k, v]] }
    const guardar = (n) => {
      if (!n || !n.id || dados.has(n.id)) return;
      const props = Object.keys(n.properties || {}).map((k) => [String(k), texto(n.properties[k])]).filter(([, v]) => v !== "");
      dados.set(String(n.id), {
        id: String(n.id), grupo: GRUPO(n.group), rotulo: texto(n.label) || "(sem nome)",
        props, doc: docDoNo(n.properties),
      });
    };
    const arestas = new Map();          // id → { id, de, para, rotulo, data, tipo }
    for (const u of partes) {
      const n = nos[u];
      guardar(Object.assign({}, n, { id: n.id || u }));
      for (const v of (n.graph.nodes || [])) guardar(v);
      for (const a of (n.graph.edges || [])) {
        if (!a || !a.from || !a.to) continue;
        const id = String(a.id || `${a.from}|${a.to}|${a.label}`);
        if (arestas.has(id)) continue;
        const p = a.properties || {};
        arestas.set(id, {
          id, de: String(a.from), para: String(a.to), rotulo: texto(a.label) || texto(a.name) || "vínculo",
          data: texto(p["Data de entrada na sociedade"]), tipo: texto(p["Tipo de sócio"]),
        });
      }
    }
    /* só ligações entre nós que estão no desenho */
    for (const [id, a] of Array.from(arestas)) if (!dados.has(a.de) || !dados.has(a.para)) arestas.delete(id);

    /* Expandido (tom escuro da legenda): parte, ou nó cujas relações conhecidas (pelo
       /relationships) estão todas no desenho. Sem o /relationships: claro (não dá para afirmar). */
    const conhecidas = new Map();       // id → Set(ids das ligações que o banco conhece)
    for (const mapa of Object.values(rel)) {
      if (!mapa || typeof mapa !== "object") continue;
      for (const n of Object.values(mapa)) {
        if (!n || !n.graph) continue;
        for (const a of (n.graph.edges || [])) {
          const id = String(a.id || `${a.from}|${a.to}|${a.label}`);
          for (const ponta of [String(a.from), String(a.to)]) {
            if (!conhecidas.has(ponta)) conhecidas.set(ponta, new Set());
            conhecidas.get(ponta).add(id);
          }
        }
      }
    }
    for (const d of dados.values()) {
      d.parte = ehParte.has(d.id);
      const k = conhecidas.get(d.id);
      d.expandido = d.parte || (!!k && k.size > 0 && Array.from(k).every((id) => arestas.has(id)));
    }

    /* componentes (cada um é um grafo da tela) */
    const pai = new Map(Array.from(dados.keys()).map((k) => [k, k]));
    const raiz = (x) => { while (pai.get(x) !== x) { pai.set(x, pai.get(pai.get(x))); x = pai.get(x); } return x; };
    for (const a of arestas.values()) { const r1 = raiz(a.de), r2 = raiz(a.para); if (r1 !== r2) pai.set(r1, r2); }
    const grupos = new Map();
    for (const id of dados.keys()) { const r = raiz(id); if (!grupos.has(r)) grupos.set(r, []); grupos.get(r).push(id); }
    /* ordem: pela primeira parte (ordem do SNIPER) de cada componente */
    const primeiraParte = (ids) => { const i = partes.findIndex((p) => ids.indexOf(p) >= 0); return i < 0 ? 1e9 : i; };
    const todos = Array.from(grupos.values()).sort((a, b) => primeiraParte(a) - primeiraParte(b));
    /* Parte sem nenhuma ligação não vira página (seria um círculo sozinho): o texto do
       relatório diz que o SNIPER não lhe apresentou vínculos. */
    const temLigacao = new Set();
    for (const a of arestas.values()) { temLigacao.add(a.de); temLigacao.add(a.para); }
    const comps = todos.filter((ids) => ids.some((i) => temLigacao.has(i)));
    const semVinculos = todos.filter((ids) => !ids.some((i) => temLigacao.has(i)))
      .map((ids) => ids.filter((i) => dados.get(i).parte)).reduce((x, y) => x.concat(y), [])
      .sort((a, b) => partes.indexOf(a) - partes.indexOf(b)).map((i) => dados.get(i).rotulo);

    const grafos = comps.map((ids, gi) => {
      const set = new Set(ids);
      const ars = Array.from(arestas.values()).filter((a) => set.has(a.de));
      const lay = dispor(ids.map((i) => dados.get(i)), ars, partes);
      const ordem = lay.ordem;   // ids na ordem de leitura do desenho
      const terceiros = ordem.filter((i) => !dados.get(i).parte).map((i) => {
        const d = dados.get(i);
        const nome = (id) => dados.get(id).rotulo;
        const rels = (lista, campo) => lista.map((a) => ({
          nome: nome(a[campo]), parte: dados.get(a[campo]).parte, relacao: a.rotulo, data: a.data,
        }));
        return {
          id: i, rotulo: d.rotulo, grupo: d.grupo, doc: d.doc, props: d.props, expandido: d.expandido,
          entrada: rels(ars.filter((a) => a.para === i), "de"),
          saida: rels(ars.filter((a) => a.de === i), "para"),
        };
      });
      return {
        numero: gi + 1,
        nos: ordem.map((i) => Object.assign({}, dados.get(i), lay.pos[i])),
        arestas: ars.map((a) => ({ de: a.de, para: a.para, rotulo: a.rotulo })),
        largura: lay.largura, altura: lay.altura,
        partes: ids.filter((i) => dados.get(i).parte).sort((a, b) => partes.indexOf(a) - partes.indexOf(b)).map((i) => dados.get(i).rotulo),
        terceiros,
      };
    });
    const totalTerceiros = grafos.reduce((s, g) => s + g.terceiros.length, 0);
    return { ok: true, grafos, totalTerceiros, totalArestas: arestas.size, semVinculos, meta: e.meta || {} };
  }

  /* ═══════════════════════════ DISPOSIÇÃO EM CAMADAS ═══════════════════════════
     Camada = o caminho mais longo a partir de quem não recebe seta (os sócios em cima,
     as empresas embaixo; empresa sócia de empresa desce mais uma). Dentro da camada,
     as partes primeiro e depois pela média da posição de quem aponta para o nó
     (baricentro), o que deixa as setas mais curtas e retas. Camada larga quebra em
     linhas de no máximo COLS nós. Unidades abstratas: coluna 100, linha 112. */
  const COLS = 5, COL = 100, LIN = 112;
  function dispor(lista, ars, ordemPartes) {
    const ids = lista.map((d) => d.id);
    const porId = new Map(lista.map((d) => [d.id, d]));
    const pred = new Map(ids.map((i) => [i, []]));
    for (const a of ars) if (pred.has(a.para) && porId.has(a.de)) pred.get(a.para).push(a.de);
    const camada = new Map();
    const visitando = new Set();
    const nivel = (i) => {
      if (camada.has(i)) return camada.get(i);
      if (visitando.has(i)) return 0;               // ciclo: corta aqui
      visitando.add(i);
      const ps = pred.get(i) || [];
      const v = ps.length ? 1 + Math.max(...ps.map(nivel)) : 0;
      visitando.delete(i);
      camada.set(i, v);
      return v;
    };
    ids.forEach(nivel);
    const nCamadas = Math.max(0, ...camada.values()) + 1;
    const rankParte = (i) => { const k = ordemPartes.indexOf(i); return k < 0 ? 1e6 : k; };
    const porNome = (a, b) => porId.get(a).rotulo.localeCompare(porId.get(b).rotulo, "pt-BR");
    const xIdx = new Map();
    const linhas = [];
    for (let c = 0; c < nCamadas; c++) {
      const nodos = ids.filter((i) => camada.get(i) === c);
      const bary = (i) => {
        const ps = (pred.get(i) || []).filter((p) => xIdx.has(p));
        return ps.length ? ps.reduce((s, p) => s + xIdx.get(p), 0) / ps.length : 1e5;
      };
      nodos.sort((a, b) => (c === 0 ? (rankParte(a) - rankParte(b)) || porNome(a, b) : (bary(a) - bary(b)) || (rankParte(a) - rankParte(b)) || porNome(a, b)));
      for (let k = 0; k < nodos.length; k += COLS) {
        const linha = nodos.slice(k, k + COLS);
        linha.forEach((i, j) => xIdx.set(i, j - (linha.length - 1) / 2));
        linhas.push(linha);
      }
    }
    const largura = Math.max(1, ...linhas.map((l) => l.length)) * COL;
    const pos = {};
    linhas.forEach((linha, r) => linha.forEach((i, j) => {
      pos[i] = { x: largura / 2 + (j - (linha.length - 1) / 2) * COL, y: r * LIN + 40, camada: camada.get(i) };
    }));
    return { pos, largura, altura: linhas.length * LIN, ordem: [].concat(...linhas) };
  }

  /* ═══════════════════════════ PDF (vetor) ═══════════════════════════
     ctx = { W, WB }: larguras Helvetica / Helvetica-Bold (WinAnsi, códigos 32..255) do fundo.
     Fontes /F1 (Helvetica) e /F2 (Helvetica-Bold), as mesmas do gerarPDFTexto. */
  const COR = {
    entidade: { claro: [0.18, 0.77, 0.69], escuro: [0.0, 0.41, 0.36] },
    individuo: { claro: [0.46, 0.49, 0.56], escuro: [0.24, 0.27, 0.32] },
    candidatura: { claro: [1.0, 0.55, 0.42], escuro: [0.91, 0.33, 0.24] },
  };
  const AZUL = [0.122, 0.227, 0.373], TINTA = [0.11, 0.11, 0.13], CINZA = [0.38, 0.38, 0.42], LINHA = [0.29, 0.43, 0.59];
  const rg = (c) => `${c.map((x) => x.toFixed(3)).join(" ")} rg\n`;
  const RG = (c) => `${c.map((x) => x.toFixed(3)).join(" ")} RG\n`;
  const f2 = (n) => (Math.round(n * 100) / 100).toString();

  /* Texto → bytes WinAnsi (o PDF é Latin-1 byte a byte). Tipografia comum mapeada para
     os códigos 0x80–0x9F do WinAnsi; o resto fora do Latin-1 vira "?". */
  const WIN = { "—": 0x97, "–": 0x96, "“": 0x93, "”": 0x94, "‘": 0x91, "’": 0x92, "•": 0x95, "…": 0x85, "€": 0x80 };
  function win(s) {
    let o = "";
    for (const ch of String(s == null ? "" : s).replace(/→/g, "->").replace(/[\r\n\t]+/g, " ")) {
      const c = ch.charCodeAt(0);
      if (WIN[ch]) o += String.fromCharCode(WIN[ch]);
      else if (c >= 0x20 && c <= 0xFF) o += ch;
      else o += "?";
    }
    return o;
  }
  const esc = (s) => win(s).replace(/[()\\]/g, "\\$&");
  function medir(ctx, s, pt, negrito) {
    const tab = negrito ? ctx.WB : ctx.W;
    const w = win(s);
    let soma = 0;
    for (let i = 0; i < w.length; i++) { const c = w.charCodeAt(i); soma += (c >= 32 && c <= 255 && tab) ? (tab[c - 32] || 556) : 556; }
    return (soma * pt) / 1000;
  }
  function quebrar(ctx, s, larg, pt, negrito, maxLinhas) {
    const palavras = String(s == null ? "" : s).replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
    const out = [];
    let atual = "";
    for (let p of palavras) {
      while (medir(ctx, p, pt, negrito) > larg && p.length > 1) {       // palavra maior que a linha
        let k = p.length - 1;
        while (k > 1 && medir(ctx, p.slice(0, k), pt, negrito) > larg) k--;
        if (atual) { out.push(atual); atual = ""; }
        out.push(p.slice(0, k)); p = p.slice(k);
      }
      const t = atual ? atual + " " + p : p;
      if (medir(ctx, t, pt, negrito) <= larg) atual = t; else { if (atual) out.push(atual); atual = p; }
    }
    if (atual) out.push(atual);
    if (!out.length) out.push("");
    if (maxLinhas && out.length > maxLinhas) {
      const cortadas = out.slice(0, maxLinhas);
      let u = cortadas[maxLinhas - 1] + "…";
      while (medir(ctx, u, pt, negrito) > larg && u.length > 2) u = u.slice(0, -2) + "…";
      cortadas[maxLinhas - 1] = u;
      return cortadas;
    }
    return out;
  }
  const txt = (x, y, pt, negrito, s, cor) =>
    `BT\n${rg(cor || TINTA)}/${negrito ? "F2" : "F1"} ${f2(pt)} Tf\n1 0 0 1 ${f2(x)} ${f2(y)} Tm\n(${esc(s)}) Tj\nET\n`;
  const txtCentro = (ctx, cx, y, pt, negrito, s, cor) => txt(cx - medir(ctx, s, pt, negrito) / 2, y, pt, negrito, s, cor);
  const txtDireita = (ctx, x, y, pt, negrito, s, cor) => txt(x - medir(ctx, s, pt, negrito), y, pt, negrito, s, cor);
  const K = 0.5523;
  function circulo(cx, cy, r) {
    const k = r * K;
    return `${f2(cx + r)} ${f2(cy)} m\n` +
      `${f2(cx + r)} ${f2(cy + k)} ${f2(cx + k)} ${f2(cy + r)} ${f2(cx)} ${f2(cy + r)} c\n` +
      `${f2(cx - k)} ${f2(cy + r)} ${f2(cx - r)} ${f2(cy + k)} ${f2(cx - r)} ${f2(cy)} c\n` +
      `${f2(cx - r)} ${f2(cy - k)} ${f2(cx - k)} ${f2(cy - r)} ${f2(cx)} ${f2(cy - r)} c\n` +
      `${f2(cx + k)} ${f2(cy - r)} ${f2(cx + r)} ${f2(cy - k)} ${f2(cx + r)} ${f2(cy)} c\n`;
  }
  function retArred(x, y, w, h, r) {
    const k = r * K;
    return `${f2(x + r)} ${f2(y)} m\n${f2(x + w - r)} ${f2(y)} l\n` +
      `${f2(x + w - r + k)} ${f2(y)} ${f2(x + w)} ${f2(y + r - k)} ${f2(x + w)} ${f2(y + r)} c\n` +
      `${f2(x + w)} ${f2(y + h - r)} l\n` +
      `${f2(x + w)} ${f2(y + h - r + k)} ${f2(x + w - r + k)} ${f2(y + h)} ${f2(x + w - r)} ${f2(y + h)} c\n` +
      `${f2(x + r)} ${f2(y + h)} l\n` +
      `${f2(x + r - k)} ${f2(y + h)} ${f2(x)} ${f2(y + h - r + k)} ${f2(x)} ${f2(y + h - r)} c\n` +
      `${f2(x)} ${f2(y + r)} l\n` +
      `${f2(x)} ${f2(y + r - k)} ${f2(x + r - k)} ${f2(y)} ${f2(x + r)} ${f2(y)} c\nh\n`;
  }
  /* Ícones brancos dentro do círculo (pessoa, prédio, cartão de candidatura). */
  function icone(grupo, cx, cy, r) {
    let s = "1 1 1 rg\n1 1 1 RG\n";
    if (grupo === "individuo") {
      s += circulo(cx, cy + r * 0.2, r * 0.26) + "f\n";
      s += `${f2(cx - r * 0.48)} ${f2(cy - r * 0.52)} m\n${f2(cx - r * 0.48)} ${f2(cy - r * 0.02)} ${f2(cx + r * 0.48)} ${f2(cy - r * 0.02)} ${f2(cx + r * 0.48)} ${f2(cy - r * 0.52)} c\nh\nf\n`;
    } else if (grupo === "entidade") {
      const w = r * 0.62, h = r * 0.96, x = cx - w / 2, y = cy - h / 2;
      s += `${f2(r * 0.09)} w\n${f2(x)} ${f2(y)} ${f2(w)} ${f2(h)} re\nS\n`;
      for (let a = 0; a < 3; a++) for (let b = 0; b < 2; b++) {
        s += `${f2(x + w * (0.2 + b * 0.38))} ${f2(y + h * (0.62 - a * 0.24))} ${f2(w * 0.22)} ${f2(h * 0.12)} re\nf\n`;
      }
    } else {
      const w = r * 1.0, h = r * 0.7, x = cx - w / 2, y = cy - h / 2;
      s += `${f2(r * 0.09)} w\n${f2(x)} ${f2(y)} ${f2(w)} ${f2(h)} re\nS\n`;
      s += circulo(x + w * 0.27, y + h * 0.58, h * 0.16) + "f\n";
      s += `${f2(x + w * 0.5)} ${f2(y + h * 0.6)} ${f2(w * 0.38)} ${f2(h * 0.1)} re\nf\n${f2(x + w * 0.5)} ${f2(y + h * 0.36)} ${f2(w * 0.38)} ${f2(h * 0.1)} re\nf\n`;
    }
    return s;
  }

  const PAG = { L: 595, A: 842, MX: 50 };
  const UTIL = PAG.L - 2 * PAG.MX;
  const dataHora = (iso) => {
    const d = iso ? new Date(iso) : null;
    if (!d || isNaN(d)) return "";
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} às ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  function cabecalho(ctx, titulo, meta) {
    const dir = [meta.processo ? `Processo ${meta.processo}` : "", meta.investigacao ? `SNIPER nº ${meta.investigacao}` : ""].filter(Boolean).join(" · ");
    /* título e procedência na mesma linha: o título encolhe até caber (nunca se sobrepõem) */
    const livre = UTIL - (dir ? medir(ctx, dir, 8, false) + 14 : 0);
    let pt = 14;
    while (pt > 9 && medir(ctx, titulo, pt, true) > livre) pt -= 0.5;
    let s = txt(PAG.MX, 800, pt, true, titulo, AZUL);
    if (dir) s += txtDireita(ctx, PAG.L - PAG.MX, 802, 8, false, dir, CINZA);
    s += `${RG(AZUL)}1.4 w\n${PAG.MX} 792 m\n${PAG.L - PAG.MX} 792 l\nS\n`;
    return s;
  }
  function paragrafo(ctx, x, y, larg, pt, s, cor, negrito, entre) {
    let out = "";
    for (const l of quebrar(ctx, s, larg, pt, negrito)) { out += txt(x, y, pt, !!negrito, l, cor); y -= (entre || pt * 1.35); }
    return { s: out, y };
  }

  function paginaGrafo(ctx, g, total, meta) {
    let s = cabecalho(ctx, `Grafo de vínculos — ${g.numero} de ${total}`, meta);
    const nt = g.terceiros.length;
    let p = paragrafo(ctx, PAG.MX, 776, UTIL, 9,
      `Parte${g.partes.length === 1 ? "" : "s"} investigada${g.partes.length === 1 ? "" : "s"}: ${g.partes.join("; ")} · ` +
      `${nt} terceiro${nt === 1 ? "" : "s"} vinculado${nt === 1 ? "" : "s"}`, CINZA);
    s += p.s;
    /* área do desenho */
    const topo = p.y - 6, base = 150;
    const altArea = topo - base;
    const esc0 = Math.min(1.6, UTIL / g.largura, (altArea - 10) / g.altura);
    const ox = PAG.MX + (UTIL - g.largura * esc0) / 2;
    const oy = topo - Math.max(0, (altArea - g.altura * esc0) / 2.4);      // desenho centrado (um pouco acima)
    const P = (n) => ({ x: ox + n.x * esc0, y: oy - n.y * esc0 });
    s += `0.98 0.984 0.988 rg\n0.84 0.86 0.89 RG\n0.8 w\n` + retArred(PAG.MX, base, UTIL, altArea, 6) + "B\n";
    const r = 15 * Math.max(0.6, Math.min(1, esc0));
    const porId = new Map(g.nos.map((n) => [n.id, n]));
    const ptNome = Math.max(5.5, 7.5 * Math.min(1, esc0)), ptDoc = Math.max(5, 6.3 * Math.min(1, esc0));
    const largRot = Math.max(60, 96 * esc0);
    /* rótulos de cada nó (medidos antes, para a seta sair DEBAIXO do nome e não riscá-lo) */
    const rotulos = new Map(g.nos.map((n) => {
      const c = P(n);
      const linhas = quebrar(ctx, n.rotulo, largRot, ptNome, true, 2);
      const yNome = c.y - r - (n.parte ? 12 : 9.5);
      const yDoc = yNome - linhas.length * ptNome * 1.2;
      return [n.id, { c, linhas, yNome, yDoc, fundo: yDoc - ptDoc * 0.6 }];
    }));
    /* setas */
    const pilulas = [];
    for (const a of g.arestas) {
      const RA = rotulos.get(a.de), RB = rotulos.get(a.para);
      const A = RA.c, B = RB.c;
      const anel = (n) => (n.parte ? 3.2 + 1.1 : 0);
      const desce = RA.fundo - 4 > B.y + r + anel(porId.get(a.para)) + 6;
      let ini, fim, ux, uy;
      if (desce) {
        ini = { x: A.x, y: RA.fundo - 3 };
        const dx = B.x - ini.x, dy = B.y - ini.y, d = Math.hypot(dx, dy) || 1;
        ux = dx / d; uy = dy / d;
        const rr = r + anel(porId.get(a.para)) + 2;
        fim = { x: B.x - ux * rr, y: B.y - uy * rr };
      } else {                                     // mesma linha / ciclo: de borda a borda
        const dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy) || 1;
        ux = dx / d; uy = dy / d;
        ini = { x: A.x + ux * (r + anel(porId.get(a.de)) + 2), y: A.y + uy * (r + anel(porId.get(a.de)) + 2) };
        fim = { x: B.x - ux * (r + anel(porId.get(a.para)) + 2), y: B.y - uy * (r + anel(porId.get(a.para)) + 2) };
      }
      const ponta = 6.5 * Math.max(0.7, Math.min(1, esc0));
      const corpo = { x: fim.x - ux * ponta, y: fim.y - uy * ponta };
      s += `${RG(LINHA)}0.9 w\n${f2(ini.x)} ${f2(ini.y)} m\n${f2(corpo.x)} ${f2(corpo.y)} l\nS\n`;
      const px = -uy * ponta * 0.45, py = ux * ponta * 0.45;
      s += `${rg(LINHA)}${f2(fim.x)} ${f2(fim.y)} m\n${f2(corpo.x + px)} ${f2(corpo.y + py)} l\n${f2(corpo.x - px)} ${f2(corpo.y - py)} l\nh\nf\n`;
      pilulas.push({ x: ini.x + (corpo.x - ini.x) * 0.5, y: ini.y + (corpo.y - ini.y) * 0.5, t: a.rotulo });
    }
    /* nós */
    for (const n of g.nos) {
      const R = rotulos.get(n.id), c = R.c;
      const cor = (COR[n.grupo] || COR.candidatura)[n.expandido ? "escuro" : "claro"];
      if (n.parte) s += `${RG(AZUL)}2.2 w\n` + circulo(c.x, c.y, r + 3.2) + "S\n";
      s += rg(cor) + circulo(c.x, c.y, r) + "f\n" + icone(n.grupo, c.x, c.y, r);
      let y = R.yNome;
      for (const l of R.linhas) { s += txtCentro(ctx, c.x, y, ptNome, true, l, TINTA); y -= ptNome * 1.2; }
      const linhaDoc = (n.parte ? "parte" : "terceiro") + (n.doc ? ` · ${n.doc.tipo} ${n.doc.valor}` : "");
      s += txtCentro(ctx, c.x, R.yDoc, ptDoc, false, linhaDoc, CINZA);
    }
    /* rótulos das setas, por cima */
    const ptPil = Math.max(5, 6.3 * Math.min(1, esc0));
    for (const pl of pilulas) {
      const w = medir(ctx, pl.t, ptPil, false) + 8, h = ptPil + 4.5;
      s += `1 1 1 rg\n${RG([0.78, 0.83, 0.88])}0.6 w\n` + retArred(pl.x - w / 2, pl.y - h / 2, w, h, h / 2) + "B\n";
      s += txtCentro(ctx, pl.x, pl.y - ptPil * 0.35, ptPil, false, pl.t, [0.18, 0.29, 0.43]);
    }
    /* legenda oficial + nota de procedência */
    let ly = 132;
    s += txt(PAG.MX, ly, 7.5, true, "Legenda (a do SNIPER):", TINTA);
    let lx = PAG.MX + 92;
    for (const gk of ["entidade", "individuo", "candidatura"]) {
      s += rg(COR[gk].claro) + circulo(lx, ly + 2.6, 4) + "f\n" + rg(COR[gk].escuro) + circulo(lx + 10, ly + 2.6, 4) + "f\n";
      s += txt(lx + 17, ly, 7.5, false, ROTULO_GRUPO[gk], TINTA);
      lx += 30 + medir(ctx, ROTULO_GRUPO[gk], 7.5, false);
    }
    s += `${RG(AZUL)}1.6 w\n` + circulo(lx + 4, ly + 2.6, 5) + "S\n" + txt(lx + 13, ly, 7.5, false, "parte investigada", TINTA);
    ly -= 11;
    s += paragrafo(ctx, PAG.MX, ly, UTIL, 7.2, "Tom claro: o nó tem relações que o SNIPER não expandiu no grafo; tom escuro: todas as relações já " +
      "expandidas. A seta sai de quem tem o vínculo (sócio -> empresa).", CINZA, false, 9).s;
    const nota = `Grafo redesenhado pelo CRATOS a partir dos vínculos devolvidos pelo SNIPER` +
      (meta.investigacao ? ` (investigação nº ${meta.investigacao}` + (meta.consultaEm ? `, consulta em ${dataHora(meta.consultaEm)})` : ")") : "") +
      `. Vínculos que o SNIPER não expandiu no grafo (marcados com * na impressão dele) não constam.` +
      (nt ? " A ficha de cada terceiro vinculado segue nas páginas seguintes." : "");
    s += `${RG([0.84, 0.86, 0.89])}0.6 w\n${PAG.MX} 104 m\n${PAG.L - PAG.MX} 104 l\nS\n`;
    s += paragrafo(ctx, PAG.MX, 92, UTIL, 7.5, nota, CINZA).s;
    return s;
  }

  /* Ficha do terceiro: um "escritor" que pagina sozinho (ficha longa continua na seguinte). */
  function fichas(ctx, g, meta) {
    const out = [];
    for (const t of g.terceiros) {
      let s = "", y = 0, pag = 0;
      const novaPagina = () => {
        if (s) out.push(s);
        pag++;
        s = cabecalho(ctx, `Terceiro vinculado — grafo ${g.numero}${pag > 1 ? " (cont.)" : ""}`, meta);
        y = 772;
      };
      const precisa = (h) => { if (y - h < 60) novaPagina(); };
      novaPagina();
      for (const l of quebrar(ctx, t.rotulo, UTIL, 12, true)) { s += txt(PAG.MX, y, 12, true, l, TINTA); y -= 15; }
      s += txt(PAG.MX, y, 8.5, false, `${ROTULO_GRUPO[t.grupo]}${t.doc ? ` · ${t.doc.tipo} ${t.doc.valor}` : ""} · aparece no grafo ${g.numero}`, CINZA);
      y -= 16;
      const secao = (titulo) => {
        precisa(30);
        s += `0.933 0.945 0.961 rg\n${PAG.MX} ${f2(y - 5)} ${UTIL} 16 re\nf\n` + txt(PAG.MX + 6, y, 9.5, true, titulo, TINTA);
        y -= 20;
      };
      secao("Detalhes do objeto");
      const XK = PAG.MX + 6, LK = 168, XV = PAG.MX + 182, LV = UTIL - 188;
      for (const [k, v] of t.props) {
        const lk = quebrar(ctx, k, LK, 8.8, true), lv = quebrar(ctx, v, LV, 8.8, false);
        const n = Math.max(lk.length, lv.length);
        precisa(n * 11.2 + 3);
        for (let i = 0; i < n; i++) {
          if (lk[i]) s += txt(XK, y - i * 11.2, 8.8, true, lk[i], [0.2, 0.2, 0.22]);
          if (lv[i]) s += txt(XV, y - i * 11.2, 8.8, false, lv[i], TINTA);
        }
        y -= n * 11.2 + 3.5;
      }
      if (!t.props.length) { s += txt(XK, y, 8.8, false, "(o SNIPER não apresentou detalhes para este nó)", CINZA); y -= 14; }
      y -= 6;
      const tabela = (titulo, rels, rotOrigem) => {
        secao(titulo);
        const C = [{ x: PAG.MX + 6, w: 250, t: rotOrigem }, { x: PAG.MX + 262, w: 128, t: "Relação" }, { x: PAG.MX + 396, w: 93, t: "Data de entrada" }];
        precisa(30);
        s += `${rg(AZUL)}${PAG.MX} ${f2(y - 4)} ${UTIL} 14 re\nf\n`;
        for (const c of C) s += txt(c.x, y, 8.5, true, c.t, [1, 1, 1]);
        y -= 16;
        if (!rels.length) { s += txt(PAG.MX + 6, y, 8.8, false, "Nenhuma no grafo exibido.", CINZA); y -= 14; return; }
        for (const r of rels) {
          const cols = [quebrar(ctx, r.nome + (r.parte ? " (parte)" : ""), C[0].w, 8.8, false), quebrar(ctx, r.relacao, C[1].w, 8.8, false), quebrar(ctx, r.data || "—", C[2].w, 8.8, false)];
          const n = Math.max(...cols.map((c) => c.length));
          precisa(n * 11.2 + 6);
          cols.forEach((linhas, k) => linhas.forEach((l, i) => { s += txt(C[k].x, y - i * 11.2, 8.8, false, l, TINTA); }));
          y -= n * 11.2 + 2;
          s += `${RG([0.89, 0.9, 0.92])}0.5 w\n${PAG.MX} ${f2(y + 6)} m\n${PAG.L - PAG.MX} ${f2(y + 6)} l\nS\n`;
          y -= 4;
        }
      };
      tabela("Relações de entrada", t.entrada, "Origem");
      if (t.saida.length) { y -= 6; tabela("Relações de saída", t.saida, "Destino"); }
      y -= 8;
      precisa(40);
      s += paragrafo(ctx, PAG.MX, y, UTIL, 7.8, "Ficha reproduzida dos “Detalhes do objeto” que o SNIPER exibe para este nó do grafo (a mesma informação da impressão do próprio SNIPER). Relações que o SNIPER marca como não expandidas (*) não constam.", CINZA).s;
      out.push(s);
    }
    return out;
  }

  /* Todas as páginas do grafo, na ordem: grafo 1, fichas do grafo 1, grafo 2, fichas do grafo 2… */
  function paginas(modelo, ctx) {
    if (!modelo || !modelo.ok || !Array.isArray(modelo.grafos) || !modelo.grafos.length) return [];
    const c = ctx || {};
    const meta = modelo.meta || {};
    const out = [];
    for (const g of modelo.grafos) {
      out.push(paginaGrafo(c, g, modelo.grafos.length, meta));
      out.push(...fichas(c, g, meta));
    }
    return out;
  }

  /* ═══════════════════════════ RELATÓRIO EM BLOCOS (1.9.3) ═══════════════════════════
     Pedido do Rodrigo (10/11): o relatório do SNIPER inteiro no padrão visual do grafo
     (faixas azuis, tabelas com linhas realçadas, selo por fonte). SÓ o relatório do
     SNIPER: as certidões de todos os convênios continuam como estão.
     O content script manda BLOCOS (dados com tipo), nunca operadores de PDF:
       { t: "secao", texto, selo?: { texto, tom } }    faixa azul de seção
       { t: "sub", texto, nota? }                       subtítulo (nome da parte, registro)
       { t: "kv", pares: [[campo, valor], …] }          grade campo–valor
       { t: "tabela", titulo?, colunas: [{ titulo, peso }], linhas: [[célula, …], …] }
            célula = texto | { texto, tom }  (tom = selo colorido)
       { t: "par", texto, tom? }                        parágrafo (tom: "nota" | "alerta")
       { t: "espaco" }
     tom: "ok" | "vazio" | "erro" | "andamento".
     Cada página leva o cabeçalho e, no fim (`rodape`), "página k de N" — contando
     também as páginas do grafo, que vêm depois. */
  const TOM = {
    ok: { fundo: [0.86, 0.96, 0.89], tinta: [0.08, 0.40, 0.20] },
    vazio: { fundo: [0.92, 0.93, 0.95], tinta: [0.30, 0.33, 0.38] },
    erro: { fundo: [0.99, 0.89, 0.89], tinta: [0.66, 0.11, 0.11] },
    andamento: { fundo: [1.0, 0.95, 0.80], tinta: [0.57, 0.36, 0.02] },
  };
  const ZEBRA = [0.957, 0.965, 0.98];
  const CAP = (v, n) => String(v == null ? "" : v).slice(0, n);
  function selo(ctx, x, yBase, t, tom, pt) {
    const c = TOM[tom] || TOM.vazio;
    const w = medir(ctx, t, pt, true) + 10, h = pt + 5;
    return { w, s: rg(c.fundo) + retArred(x, yBase - 3, w, h, h / 2) + "f\n" + txt(x + 5, yBase, pt, true, t, c.tinta) };
  }
  function relatorio(blocos, meta, ctx) {
    if (!Array.isArray(blocos) || !blocos.length) return [];
    const m = meta || {};
    const titulo = CAP(m.titulo || "Relatório de investigação patrimonial — SNIPER (CNJ)", 90);
    const out = [];
    let s = "", y = 0;
    const nova = () => { if (s) out.push(s); s = cabecalho(ctx, titulo, m); y = 770; };
    const precisa = (h) => { if (y - h < 62) nova(); };
    nova();
    let primeiraSecao = true;
    for (const b of blocos.slice(0, 4000)) {
      if (!b || typeof b !== "object") continue;
      if (b.t === "espaco") { y -= 8; continue; }
      if (b.t === "secao") {
        if (!primeiraSecao) y -= 10;
        primeiraSecao = false;
        precisa(48);
        s += `${rg(AZUL)}${PAG.MX} ${f2(y - 6)} ${UTIL} 20 re\nf\n` + txt(PAG.MX + 8, y, 10.5, true, CAP(b.texto, 90), [1, 1, 1]);
        if (b.selo && b.selo.texto) {
          const sl = selo(ctx, 0, 0, CAP(b.selo.texto, 40), b.selo.tom, 8);
          const sx = PAG.L - PAG.MX - 6 - sl.w;
          s += `1 1 1 rg\n` + retArred(sx - 1, y - 4.5, sl.w + 2, 8 + 7, 7.5) + "f\n" + selo(ctx, sx, y - 0.5, CAP(b.selo.texto, 40), b.selo.tom, 8).s;
        }
        y -= 26;
        continue;
      }
      if (b.t === "sub") {
        precisa(90);                       // subtítulo não fica sozinho no pé da página
        const linhas = quebrar(ctx, CAP(b.texto, 300), UTIL, 10.5, true);
        for (const l of linhas) { s += txt(PAG.MX, y, 10.5, true, l, AZUL); y -= 13; }
        if (b.nota) { s += txt(PAG.MX, y, 8, false, CAP(b.nota, 200), CINZA); y -= 11; }
        s += `${RG([0.80, 0.85, 0.91])}0.6 w\n${PAG.MX} ${f2(y + 4)} m\n${PAG.L - PAG.MX} ${f2(y + 4)} l\nS\n`;
        y -= 8;
        continue;
      }
      if (b.t === "par") {
        const cor = b.tom === "alerta" ? TOM.erro.tinta : b.tom === "nota" ? CINZA : TINTA;
        const pt = b.tom === "nota" ? 8.3 : 9.3;
        for (const l of quebrar(ctx, CAP(b.texto, 4000), UTIL, pt, false)) { precisa(pt * 1.4); s += txt(PAG.MX, y, pt, false, l, cor); y -= pt * 1.38; }
        y -= 4;
        continue;
      }
      if (b.t === "kv") {
        const pares = (Array.isArray(b.pares) ? b.pares : []).slice(0, 300);
        const XK = PAG.MX + 6, LK = 150, XV = PAG.MX + 164, LV = UTIL - 170;
        pares.forEach(([k, v], i) => {
          const lk = quebrar(ctx, CAP(k, 120), LK, 8.6, true), lv = quebrar(ctx, CAP(v, 2000), LV, 8.6, false);
          const n = Math.max(lk.length, lv.length);
          const h = n * 11 + 4;
          precisa(h + 2);
          if (i % 2 === 0) s += `${rg(ZEBRA)}${PAG.MX} ${f2(y - h + 9)} ${UTIL} ${f2(h)} re\nf\n`;
          for (let j = 0; j < n; j++) {
            if (lk[j]) s += txt(XK, y - j * 11, 8.6, true, lk[j], [0.22, 0.25, 0.30]);
            if (lv[j]) s += txt(XV, y - j * 11, 8.6, false, lv[j], TINTA);
          }
          y -= h;
        });
        y -= 6;
        continue;
      }
      if (b.t === "tabela") {
        const cols = (Array.isArray(b.colunas) ? b.colunas : []).slice(0, 8);
        if (!cols.length) continue;
        const pesoT = cols.reduce((a, c) => a + (Number(c.peso) > 0 ? Number(c.peso) : 1), 0);
        let x = PAG.MX + 6;
        const C = cols.map((c) => { const w = (UTIL - 12) * ((Number(c.peso) > 0 ? Number(c.peso) : 1) / pesoT); const o = { x, w: w - 6, t: CAP(c.titulo, 40) }; x += w; return o; });
        const pt = cols.length > 4 ? 7.6 : 8.4, lh = pt * 1.3;
        const cabecalhoTabela = () => {
          s += `${rg(AZUL)}${PAG.MX} ${f2(y - 4.5)} ${UTIL} 15 re\nf\n`;
          for (const c of C) s += txt(c.x, y, pt, true, quebrar(ctx, c.t, c.w, pt, true, 1)[0], [1, 1, 1]);
          y -= 17;
        };
        precisa(b.titulo ? 62 : 46);       // legenda + cabeçalho + 1ª linha juntos
        if (b.titulo) { s += txt(PAG.MX, y, 9.3, true, CAP(b.titulo, 160), TINTA); y -= 14; }
        cabecalhoTabela();
        const linhas = (Array.isArray(b.linhas) ? b.linhas : []).slice(0, 2000);
        linhas.forEach((ln, i) => {
          const cel = C.map((c, k) => {
            const v = Array.isArray(ln) ? ln[k] : "";
            if (v && typeof v === "object") return { selo: true, texto: CAP(v.texto, 40), tom: v.tom };
            return { linhas: quebrar(ctx, CAP(v, 1500), c.w, pt, false) };
          });
          const n = Math.max(1, ...cel.map((c) => (c.selo ? 1 : c.linhas.length)));
          const h = n * lh + 5;
          if (y - h < 62) { nova(); cabecalhoTabela(); }
          if (i % 2 === 1) s += `${rg(ZEBRA)}${PAG.MX} ${f2(y - h + pt + 2)} ${UTIL} ${f2(h)} re\nf\n`;
          cel.forEach((c, k) => {
            if (c.selo) { s += selo(ctx, C[k].x, y, c.texto, c.tom, pt - 0.6).s; return; }
            c.linhas.forEach((l, j) => { s += txt(C[k].x, y - j * lh, pt, false, l, TINTA); });
          });
          y -= h;
        });
        if (!linhas.length) { s += txt(PAG.MX + 6, y, 8.6, false, "Nenhum.", CINZA); y -= 14; }
        s += `${RG([0.80, 0.85, 0.91])}0.6 w\n${PAG.MX} ${f2(y + lh - 1)} m\n${PAG.L - PAG.MX} ${f2(y + lh - 1)} l\nS\n`;
        y -= 8;
        continue;
      }
    }
    out.push(s);
    return out;
  }
  /* Rodapé em TODAS as páginas do relatório (texto + grafo): procedência e "página k de N". */
  function rodape(streams, meta, ctx) {
    const m = meta || {};
    const n = streams.length;
    const esq = `Gerado pelo CRATOS a partir dos dados exibidos pelo SNIPER` + (m.investigacao ? ` · investigação nº ${CAP(m.investigacao, 20)}` : "") +
      (m.consultaEm ? ` · consulta em ${dataHora(m.consultaEm)}` : "");
    return streams.map((st, i) => st +
      `${RG([0.80, 0.85, 0.91])}0.6 w\n${PAG.MX} 44 m\n${PAG.L - PAG.MX} 44 l\nS\n` +
      txt(PAG.MX, 32, 7.2, false, esq, CINZA) +
      txtDireita(ctx, PAG.L - PAG.MX, 32, 7.2, true, `página ${i + 1} de ${n}`, CINZA));
  }

  globalThis.CratosGrafoSniper = { montar, paginas, relatorio, rodape, dispor, formatarDoc, win, COLS };
  if (typeof module !== "undefined" && module.exports) module.exports = globalThis.CratosGrafoSniper;
})();
