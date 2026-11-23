/*
 * conteudo/signo.js — content script do Signo (www.signo.org.br), para a CANP (1.9.8).
 *
 * Quem pede é o content script do CENSEC: depois da CEP, grava "canp_estado" (partes e
 * período) e pede ao fundo que abra o Signo em #/interno/consultas-internas. Aqui:
 *   1. se não houver login, a cortina NÃO entra: a faixa pede o login, o CRATOS abre a
 *      janela "Acesso via Certificado Digital" e, havendo UM certificado só, deixa-o
 *      escolhido. O "Entrar" e o PIN são da pessoa — o CRATOS nunca clica em "Entrar";
 *   2. com login, consulta cada parte pela API do próprio Signo (conteudo/signo-api.js,
 *      no contexto da página, com o token do app), central 8, no período da CEP;
 *   3. grava os resultados em "canp_estado" (fase "concluido") e devolve o foco ao CENSEC,
 *      que fabrica as certidões — com o bloco de São Paulo.
 * Falha em uma parte não derruba as outras: a parte sai com o motivo, e a certidão diz
 * que São Paulo não foi consultado para ela. Nada é escrito no Signo.
 */
(function iniciarSigno() {
  if (location.hostname !== "www.signo.org.br") return;

  const VALIDADE_MS = 30 * 60 * 1000;
  const ESPERA_LOGIN_MS = 10 * 60 * 1000;
  const ESPERA_CONSULTA_MS = 90 * 1000;
  const LIMITE = 300;
  const EV_PEDIDO = "cratos:signo:consultar";
  const EV_RESPOSTA = "cratos:signo:resultado";
  const EV_ESTADO = "cratos:signo:estado";
  const EV_ESTADO_RESP = "cratos:signo:estado:resposta";
  const ROTA = "#/interno/consultas-internas";

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const avisar = (t, cor) => { try { return CratosFaixa.mostrar("canp", t, cor); } catch (e) { return null; } };
  const cortina = (t) => { try { CratosOverlay.mostrar("CANP: " + t); } catch (e) { /* segue */ } };
  const semCortina = () => { try { CratosOverlay.esconder(); } catch (e) { /* segue */ } };
  const norm = (s) => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

  (function injetar() {
    try {
      const s = document.createElement("script");
      s.src = browser.runtime.getURL("conteudo/signo-api.js");
      s.async = false;
      (document.head || document.documentElement).appendChild(s);
      s.onload = () => s.remove();
    } catch (e) { console.error("CRATOS/CANP: falha ao injetar o grampo:", e); }
  })();

  /* ── conversa com o grampo ── */
  let seq = 0;
  const pendentes = new Map();
  window.addEventListener(EV_RESPOSTA, (ev) => {
    let d = null;
    try { d = JSON.parse(ev.detail); } catch (e) { return; }
    const r = pendentes.get(d && d.reqId);
    if (r) { pendentes.delete(d.reqId); r(d); }
  });
  function consultar(doc, periodo) {
    return new Promise((resolve) => {
      const reqId = "c" + (++seq) + "_" + Date.now();
      pendentes.set(reqId, resolve);
      window.dispatchEvent(new CustomEvent(EV_PEDIDO, {
        detail: JSON.stringify({ reqId, doc, inicio: periodo.inicio, fim: periodo.fim, limite: LIMITE }),
      }));
      setTimeout(() => { if (pendentes.has(reqId)) { pendentes.delete(reqId); resolve({ ok: false, motivo: "o Signo não respondeu a tempo" }); } }, ESPERA_CONSULTA_MS);
    });
  }
  function logado() {
    return new Promise((resolve) => {
      const h = (ev) => { window.removeEventListener(EV_ESTADO_RESP, h); try { resolve(!!JSON.parse(ev.detail).logado); } catch (e) { resolve(false); } };
      window.addEventListener(EV_ESTADO_RESP, h);
      window.dispatchEvent(new CustomEvent(EV_ESTADO));
      setTimeout(() => { window.removeEventListener(EV_ESTADO_RESP, h); resolve(false); }, 1500);
    });
  }

  /* ── login: abrir a janela do certificado e deixar o ÚNICO certificado escolhido ──
     Estrutura lida em 23/11: botão "Ou acesse via certificado digital" (app-button) →
     modal "Acesso via Certificado Digital" com um app-dropdown ("Certificados
     Encontrados"); aberto, a lista tem uma linha por certificado ("NOME:… (CPF: …)").
     Escolhido, o "Entrar" habilita. O CRATOS para aí. */
  function botaoPorTexto(trecho) {
    const alvo = norm(trecho);
    return Array.from(document.querySelectorAll("button")).find((b) => norm(b.textContent).indexOf(alvo) >= 0) || null;
  }
  async function preparaCertificado() {
    if (!document.querySelector("app-dropdown")) {
      const b = botaoPorTexto("acesse via certificado digital");
      if (!b) return false;
      b.click();
      for (let i = 0; i < 20 && !document.querySelector("app-dropdown"); i++) await sleep(250);
    }
    const dd = document.querySelector("app-dropdown");
    if (!dd) return false;
    if (dd.querySelector(".dropdown.filled, .selected")) return true;          // já escolhido
    const abre = dd.querySelector(".dropdown");
    if (abre) abre.click();
    let opcoes = [];
    for (let i = 0; i < 20; i++) {
      await sleep(250);
      opcoes = Array.from(document.querySelectorAll(".options *"))
        .filter((el) => !el.children.length && /CPF:\s*\d/.test(el.textContent || ""));
      if (opcoes.length) break;
    }
    if (opcoes.length !== 1) return false;                                  // nenhum ou vários: a escolha é da pessoa
    opcoes[0].click();
    return true;
  }

  async function trabalhar(est) {
    const t0 = Date.now();
    let tentouCert = false;
    while (!(await logado())) {
      if (Date.now() - t0 > ESPERA_LOGIN_MS) {
        await gravar(est, { fase: "erro", erro: "o login no Signo não foi concluído em 10 minutos" });
        avisar("o login no Signo não foi concluído. A CANP ficou de fora — as certidões do CENSEC dizem isso.", "#facc15");
        return;
      }
      semCortina();
      avisar("entre no Signo com o seu certificado digital: escolha o certificado e clique em ENTRAR (e o PIN, se pedir). Eu sigo sozinho.", "#facc15");
      if (!tentouCert && /login/i.test(location.hash)) {
        tentouCert = true;
        try { await preparaCertificado(); } catch (e) { /* a pessoa escolhe */ }
      }
      await sleep(1500);
    }
    if (location.hash.indexOf(ROTA) !== 0) location.hash = ROTA;

    const partes = est.partes || [];
    const resultados = {};
    for (let i = 0; i < partes.length; i++) {
      const p = partes[i];
      cortina(`parte ${i + 1} de ${partes.length} — consultando os atos de São Paulo…`);
      avisar(`CANP: consultando ${i + 1} de ${partes.length}: ${p.nome}`, "#facc15");
      const r = await consultar(p.doc, est.periodo);
      resultados[p.doc] = r.ok
        ? { ok: true, total: r.total, atos: r.atos || [] }
        : { ok: false, motivo: r.motivo || "erro no Signo" };
      await gravar(est, { fase: "andando", resultados });
    }
    await gravar(est, { fase: "concluido", resultados });
    semCortina();
    const falhas = Object.values(resultados).filter((r) => !r.ok).length;
    avisar(`CANP concluída: ${partes.length - falhas} de ${partes.length} parte(s). Fechando o Signo e voltando ao CENSEC para gerar as certidões.`,
      falhas ? "#facc15" : "#4ade80");
    try { await browser.runtime.sendMessage({ tipo: "canp_voltar" }); } catch (e) { /* segue */ }
  }

  async function gravar(est, mudanca) {
    const atual = (await Store.get("canp_estado")) || {};
    if (atual.pedidoEm !== est.pedidoEm) return;          // outro pedido tomou o lugar: não escreve por cima
    await Store.set("canp_estado", Object.assign({}, atual, mudanca));
  }

  /* Um pedido por vez, cada pedido uma vez só. A aba do Signo pode já estar aberta: aí
     o fundo só troca o endereço (mesmo documento, sem recarregar) — por isso também se
     escuta o storage, e não só o carregamento da página. */
  const atendidos = new Set();
  let ocupado = false;
  async function talvezComecar() {
    if (ocupado) return;
    const est = await Store.get("canp_estado");
    if (!(await Store.ligada())) return;
    if (!est || !est.ativo || est.fase !== "aguardando" || atendidos.has(est.pedidoEm)) return;
    if (Date.now() - new Date(est.pedidoEm || 0).getTime() > VALIDADE_MS) return;
    if (!est.periodo || !Array.isArray(est.partes) || !est.partes.length) return;
    atendidos.add(est.pedidoEm);
    ocupado = true;
    try {
      await trabalhar(est);
    } catch (e) {
      semCortina();
      try { await gravar(est, { fase: "erro", erro: String((e && e.message) || e) }); } catch (x) { /* segue */ }
      avisar("a CANP falhou: " + String((e && e.message) || e), "#facc15");
    } finally { ocupado = false; }
  }
  talvezComecar().catch(() => { /* nada */ });
  try {
    browser.storage.onChanged.addListener((mud) => {
      if (Object.keys(mud || {}).some((k) => /canp_estado$/.test(k))) talvezComecar().catch(() => { /* nada */ });
    });
  } catch (e) { /* sem storage.onChanged: fica o do carregamento */ }

  try { window.__cratosSigno = { preparaCertificado, consultar, trabalhar, talvezComecar }; } catch (e) { /* teste */ }
})();
