/*
 * conteudo/signo-api.js — GRAMPO DA CANP, roda no CONTEXTO DA PÁGINA do Signo (1.9.8).
 *
 * O Signo (www.signo.org.br, do CNB-SP) é onde fica a CANP — Central de Atos Notariais
 * Paulista. A tela "Relatórios → Consultar Atos" (#/interno/consultas-internas) chama
 *   GET https://backend.signo.org.br/api/ato/consultas-internas/listar-atos
 *       ?size=10&uf=35&buscaExata=1&centrais=8&cpf=<doc>
 *       &periodoAto=<ISO início>&periodoAto=<ISO fim>&dataInicial=AAAA-MM-DD&dataFinal=AAAA-MM-DD
 * com o token do usuário no cabeçalho Authorization (JWT de 1 h, renovado pelo app) e
 * "Front: SignoFront". A resposta é paginada (content, totalElements, totalPages, last).
 * (HARs do Rodrigo, 23/11/2026 — só a estrutura foi lida.)
 *
 * O token vive no app, não em cookie: por isso a consulta sai DAQUI, do contexto da
 * página, com o token que o próprio app usa — capturado quando o app o envia, ou lido do
 * armazenamento da sessão. O token nunca sai deste contexto: não vai para o content
 * script, nem para o storage da extensão.
 *
 * READ-ONLY: só o GET de listar atos — o mesmo dado que a tela mostra. Nada é alterado.
 * Central 8 = escrituras e procurações (o equivalente à CEP). Decisão do Rodrigo, 23/11.
 */
(function () {
  "use strict";
  if (window.__cratosSignoGrampo) return;
  window.__cratosSignoGrampo = true;

  const BACKEND = "https://backend.signo.org.br";
  const EV_PEDIDO = "cratos:signo:consultar";
  const EV_RESPOSTA = "cratos:signo:resultado";
  const EV_ESTADO = "cratos:signo:estado";
  const EV_ESTADO_RESP = "cratos:signo:estado:resposta";
  const MAX_PAGINAS = 40;

  let tokenVisto = null;

  /* ── captura: o token que o app manda ao backend ── */
  const abrir = XMLHttpRequest.prototype.open;
  const cabecalho = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (metodo, url) {
    this.__cratosUrl = String(url || "");
    return abrir.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (nome, valor) {
    try {
      if (String(nome).toLowerCase() === "authorization" && (this.__cratosUrl || "").indexOf(BACKEND) === 0) tokenVisto = String(valor || "");
    } catch (e) { /* segue */ }
    return cabecalho.apply(this, arguments);
  };

  function expDe(t) {
    try {
      const jwt = String(t || "").replace(/^Bearer\s+/i, "");
      const p = jwt.split(".");
      if (p.length !== 3) return 0;
      const b = p[1].replace(/-/g, "+").replace(/_/g, "/");
      const c = JSON.parse(atob(b + "===".slice((b.length + 3) % 4)));
      return Number(c.exp) || 0;
    } catch (e) { return 0; }
  }
  const valido = (t) => expDe(t) * 1000 > Date.now() + 60000;

  /* Sem token capturado (o app ainda não chamou nada desde que entramos): procura um JWT
     válido no armazenamento da sessão do próprio app. Escolhe o que vence por último. */
  function tokenGuardado() {
    let melhor = null, expMelhor = 0;
    const olhar = (v) => {
      if (typeof v !== "string") return;
      const m = v.match(/(?:Bearer\s+)?eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || [];
      for (const t of m) { const e = expDe(t); if (e > expMelhor) { expMelhor = e; melhor = t; } }
    };
    for (const st of [window.sessionStorage, window.localStorage]) {
      try { for (let i = 0; i < st.length; i++) olhar(st.getItem(st.key(i))); } catch (e) { /* segue */ }
    }
    return melhor && valido(melhor) ? melhor : null;
  }
  const token = () => (tokenVisto && valido(tokenVisto) ? tokenVisto : tokenGuardado());

  function responder(ev, payload) {
    try { window.dispatchEvent(new CustomEvent(ev, { detail: JSON.stringify(payload) })); } catch (e) { /* timeout do outro lado */ }
  }

  window.addEventListener(EV_ESTADO, () => responder(EV_ESTADO_RESP, { logado: !!token() }));

  const iso = (ymd) => `${ymd}T03:00:00.000Z`;   // meia-noite em Brasília, como a tela envia

  async function pagina(t, p, numero, tamanho) {
    const q = new URLSearchParams();
    q.append("size", String(tamanho));
    q.append("page", String(numero));
    q.append("uf", "35");
    q.append("buscaExata", "1");
    q.append("periodoAto", iso(p.inicio));
    q.append("periodoAto", iso(p.fim));
    q.append("centrais", "8");
    q.append("cpf", p.doc);
    q.append("dataInicial", p.inicio);
    q.append("dataFinal", p.fim);
    const r = await fetch(`${BACKEND}/api/ato/consultas-internas/listar-atos?${q.toString()}`, {
      headers: { Accept: "application/json", Authorization: t, Front: "SignoFront" },
    });
    if (!r.ok) { const e = new Error("o Signo respondeu HTTP " + r.status); e.status = r.status; throw e; }
    return r.json();
  }

  const enxuto = (a) => ({
    idAto: a.idAto, nomeTipoAto: a.nomeTipoAto, dataAto: a.dataAto, central: a.central,
    livroInicial: a.livroInicial, livroComplemento: a.livroComplemento,
    folhaInicial: a.folhaInicial, folhaComplemento: a.folhaComplemento,
    nome: a.nome, cpf: a.cpf, nomeCartorio: a.nomeCartorio, numeroCns: a.numeroCns, uf: a.uf, municipio: a.municipio,
  });

  window.addEventListener(EV_PEDIDO, async (ev) => {
    let p = null;
    try { p = JSON.parse(ev.detail); } catch (e) { return; }
    const reqId = p && p.reqId;
    const doc = String((p && p.doc) || "").replace(/\D/g, "");
    if (!reqId || !(doc.length === 11 || doc.length === 14) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(p.inicio || "") || !/^\d{4}-\d{2}-\d{2}$/.test(p.fim || "")) {
      return responder(EV_RESPOSTA, { reqId, ok: false, motivo: "pedido inválido" });
    }
    const t = token();
    if (!t) return responder(EV_RESPOSTA, { reqId, ok: false, motivo: "sem login no Signo" });
    const limite = Math.max(1, Math.min(Number(p.limite) || 300, 300));
    try {
      /* Pede o limite de uma vez; se o servidor devolver páginas menores, segue página a
         página até o limite ou o fim. O total vem do servidor (totalElements). */
      let j = await pagina(t, { doc, inicio: p.inicio, fim: p.fim }, 0, limite);
      const total = Number(j.totalElements);
      if (!Number.isFinite(total)) throw new Error("resposta do Signo sem total");
      let atos = Array.isArray(j.content) ? j.content.slice() : [];
      const tamanho = Number(j.size) || atos.length || limite;
      let num = 0;
      while (atos.length < limite && atos.length < total && !j.last && num < MAX_PAGINAS) {
        num++;
        j = await pagina(t, { doc, inicio: p.inicio, fim: p.fim }, num, tamanho);
        const lote = Array.isArray(j.content) ? j.content : [];
        if (!lote.length) break;
        atos = atos.concat(lote);
      }
      responder(EV_RESPOSTA, { reqId, ok: true, total, atos: atos.slice(0, limite).map(enxuto), tamanhoPagina: tamanho, paginas: num + 1 });
    } catch (e) {
      responder(EV_RESPOSTA, { reqId, ok: false, status: e.status || null, motivo: String((e && e.message) || e) });
    }
  });

  console.log("CRATOS/CANP: grampo do Signo ativo.");
})();
