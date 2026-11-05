/*
 * primeiros/primeiros.js — página "Primeiros passos" (1.9.2, pedido do Rodrigo de 23/10).
 *
 * Uma LISTA DE VERIFICAÇÃO (não um tour com balões, que quebra a cada mudança de tela):
 * cada passo mostra se está pronto, pendente ou é opcional, e deixa configurar ali
 * mesmo o essencial. Abre sozinha só na 1ª instalação (background, onInstalled
 * "install"); depois, pelo botão nas Preferências. Nada abre sistema externo sem clique.
 *
 * Grava no MESMO cratos:config das Preferências, mesclando (não apaga o resto).
 */
(async function () {
  "use strict";
  const html = CratosHTML.html;
  const alvo = document.getElementById("passos");

  /* Pasta: cada convênio guarda a sua; aqui uma escolha vale para todos. */
  const PASTAS = { infojud: "pastaDownload", censec: "pasta", serasajud: "pasta", ccs: "pasta", sniper: "pasta", prevjud: "pasta" };

  let catalogo = [];
  try { catalogo = ((await browser.runtime.sendMessage({ tipo: "catalogo" })) || {}).modulos || []; } catch (e) { catalogo = []; }
  const esp = (mod, campo) => { const m = catalogo.find((x) => x.nome === mod); return (m && m.config && m.config[campo]) || {}; };
  let cfg = (await Store.get(CHAVES.config)) || {};
  let varas = null, listasRenajud = null;
  try { varas = await Store.get("infojud_varas"); } catch (e) { /* nada */ }
  try { listasRenajud = await Store.get("renajud_listas"); } catch (e) { /* nada */ }
  let basePje = null;
  try { basePje = await Store.get(CHAVES.trt); } catch (e) { /* nada */ }
  /* 1.9.2 — órgãos do tribunal EFETIVO (escolhido; senão o do endereço do PJe; senão o da
     última lista lida): a lista lida no uso, se for desse tribunal e mais nova; senão a embutida. */
  function orgaosDe(tribunalCfg) {
    const O = typeof CratosOrgaosRenajud !== "undefined" ? CratosOrgaosRenajud : null;
    const l = listasRenajud, lidaId = l && l.tribunal && l.tribunal.id;
    const id = tribunalCfg ? (O ? O.idDoNome(tribunalCfg) : "") : ((O && O.idDoHost(basePje)) || lidaId || "");
    if (l && Array.isArray(l.orgaos) && l.orgaos.length && lidaId === id && (!O || Number(l.emOrgaos) >= Date.parse(O.geradoEm))) return { id, lista: l.orgaos };
    return { id, lista: O && id ? O.orgaosDe(id) : [] };
  }
  const selOrgao = (tribunalCfg, atual) => {
    const r = orgaosDe(tribunalCfg);
    if (!r.lista.length) return html`<select id="pp-orgao" disabled><option value="">— escolha o tribunal acima (ou abra um processo no PJe) —</option></select>`;
    return html`<select id="pp-orgao"><option value="">— em branco: perguntar na primeira inclusão —</option>${r.lista.map((o) =>
      html`<option value="${o}" ${o === atual ? "selected" : ""}>${o}</option>`)}</select>`;
  };

  const val = (mod, campo) => {
    const v = cfg[mod] && cfg[mod][campo];
    return v !== undefined && v !== null ? v : esp(mod, campo).padrao;
  };
  const dataBR = (ms) => { try { return new Date(Number(ms)).toLocaleDateString("pt-BR"); } catch (e) { return "?"; } };
  const chip = (st) => html`<span class="chip ${st}">${st === "pronto" ? "pronto" : st === "pendente" ? "pendente" : "opcional"}</span>`;
  const opcoesVara = () => (varas && Array.isArray(varas.opcoes) && varas.opcoes.length) ? varas.opcoes : (esp("infojud", "vara").opcoes || []);
  const origemVara = () => (varas && varas.opcoes && varas.opcoes.length)
    ? `Lista lida do seu e-CAC em ${dataBR(varas.em)} (${varas.opcoes.length} varas).`
    : "Lista padrão (TRT18). Clique em \"Ler as varas do meu e-CAC\" para trazer a lista do seu e-CAC (você entra com o certificado; a aba fecha sozinha).";
  const selVara = (atual) => html`<select id="pp-vara"><option value="">— selecione —</option>${opcoesVara().map((o) => {
    const v = typeof o === "object" ? o.valor : o, r = typeof o === "object" ? o.rotulo : o;
    return html`<option value="${v}" ${String(v) === String(atual) ? "selected" : ""}>${r}</option>`; })}</select>`;

  function estado() {
    return {
      infojud: val("infojud", "vara") ? "pronto" : "pendente",
      renajud: (val("renajud", "tipoRestricao") || []).length ? "pronto" : "pendente",
    };
  }

  function render() {
    const st = estado();
    const tribunais = esp("renajud", "tribunal").opcoes || [];
    const tribAtual = val("renajud", "tribunal") || "";
    const tipos = esp("renajud", "tipoRestricao").opcoes || [];
    const tiposAtual = val("renajud", "tipoRestricao") || [];
    const orgao = val("renajud", "orgao") || "", magR = val("renajud", "magistrado") || "";
    const visib = esp("juntada", "visibilidadePartes").opcoes || ["Polo ativo", "Polo passivo"];
    const visAtual = val("juntada", "visibilidadePartes") || [];
    const autoJ = val("juntada", "automatica") || "sim";
    const pasta = val("infojud", "pastaDownload") || "CRATOS";
    CratosHTML.definir(alvo, html`
      <section class="passo" id="pp-tribunal">
        <h2>1. Tribunal ${chip("pronto")}</h2>
        <div class="campo"><label>Tribunal (usado no RENAJUD)</label>
          <select id="pp-trib"><option value="">Automático — pelo endereço do PJe</option>${tribunais.map((t) =>
            html`<option value="${t}" ${t === tribAtual ? "selected" : ""}>${t}</option>`)}</select>
          <div class="nota">No automático, o CRATOS lê o tribunal do endereço do PJe (ex.: pje.trt18.jus.br → 18ª Região).</div></div>
      </section>

      <section class="passo" id="pp-infojud">
        <h2>2. INFOJUD (e-CAC) ${chip(st.infojud)}</h2>
        <div class="campo"><label>Vara (a que assina a solicitação no e-CAC)</label>${selVara(val("infojud", "vara"))}
          <div class="nota" id="pp-vara-origem">${origemVara()}</div>
          <button id="pp-ler-varas" style="margin-top:6px">Ler as varas do meu e-CAC</button></div>
        <div class="campo"><label>Tipo de processo (e-CAC)</label><input type="text" id="pp-tipoproc" value="${val("infojud", "tipoProcesso") || ""}"></div>
        <div class="campo"><label>Justificativa (e-CAC)</label><input type="text" id="pp-justif" value="${val("infojud", "justificativa") || ""}"></div>
        <div class="campo"><label>Magistrado (opcional — nome no e-CAC)</label><input type="text" id="pp-mag-infojud" value="${val("infojud", "magistrado") || ""}">
          <div class="nota">Só preencha se você tiver delegação de <b>mais de um magistrado</b> no INFOJUD: escreva o nome exatamente como
            aparece no e-CAC. Com um só, deixe em branco.</div></div>
      </section>

      <section class="passo" id="pp-renajud">
        <h2>3. RENAJUD ${chip(st.renajud)}</h2>
        <div class="campo"><label>Tipo(s) de restrição na inclusão</label>${tipos.map((t) =>
          html`<label class="op"><input type="checkbox" class="pp-tipo" value="${t}" ${tiposAtual.includes(t) ? "checked" : ""}> ${t}</label>`)}</div>
        <div class="campo"><label>Órgão / Unidade</label><span id="pp-orgao-caixa">${selOrgao(tribAtual, orgao)}</span>
          <div class="nota">A lista é a do RENAJUD para o seu tribunal. Se deixar em branco, na primeira inclusão o CRATOS para no
            campo "Órgão" do RENAJUD, você escolhe, e ele guarda.</div></div>
        <div class="campo"><label>Magistrado (RENAJUD)</label>
          <div>${magR ? html`✓ ${magR}` : html`<span style="color:#facc15">Será perguntado na primeira inclusão</span>`}</div></div>
      </section>

      <section class="passo" id="pp-cnib">
        <h2>4. CNIB ${chip("opcional")}</h2>
        <div class="campo"><label>Vara esperada no CNIB</label><input type="text" id="pp-cnib-in" value="${val("cnib", "orgaoEsperado") || ""}">
          <div class="nota">Em branco, o CRATOS só informa em que vara o CNIB está logado. Preenchida, ele para se o CNIB estiver em outra.</div></div>
      </section>

      <section class="passo" id="pp-pasta">
        <h2>5. Downloads ${chip("pronto")}</h2>
        <div class="campo"><label>Subpasta (dentro da pasta de downloads do Firefox), para todos os convênios</label>
          <input type="text" id="pp-pasta-in" value="${pasta}"></div>
      </section>

      <section class="passo" id="pp-juntada">
        <h2>6. Juntada da certidão ${chip("pronto")}</h2>
        <div class="campo"><label>Ao terminar os convênios</label>
          <label class="op"><input type="radio" name="pp-auto" value="sim" ${autoJ === "sim" ? "checked" : ""}> Criar a minuta da certidão</label>
          <label class="op"><input type="radio" name="pp-auto" value="nao" ${autoJ !== "sim" ? "checked" : ""}> Não criar sozinho (uso o botão do painel)</label></div>
        <div class="campo"><label>Dar visibilidade da certidão às partes</label>${visib.map((v) =>
          html`<label class="op"><input type="checkbox" class="pp-vis" value="${v}" ${visAtual.includes(v) ? "checked" : ""}> ${v}</label>`)}
          <div class="nota">O CRATOS cria a minuta e PARA: conferir e assinar é sempre seu.</div></div>
      </section>`);
    document.getElementById("pp-ler-varas").onclick = () => browser.runtime.sendMessage({ tipo: "infojud_ler_varas" }).catch(() => {});
    /* trocar o tribunal troca a lista de órgãos */
    document.getElementById("pp-trib").onchange = (ev) => {
      const caixa = document.getElementById("pp-orgao-caixa");
      const atual = (document.getElementById("pp-orgao") || {}).value || "";
      CratosHTML.definir(caixa, selOrgao(ev.target.value, atual));
    };
  }

  async function salvar() {
    const q = (id) => document.getElementById(id);
    const marcados = (cls) => Array.from(document.querySelectorAll("." + cls)).filter((x) => x.checked).map((x) => x.value);
    const atual = (await Store.get(CHAVES.config)) || {};
    const mesclar = (mod, campos) => { atual[mod] = Object.assign({}, atual[mod] || {}, campos); };
    const pasta = (q("pp-pasta-in").value || "").trim() || "CRATOS";
    mesclar("infojud", { vara: q("pp-vara").value, tipoProcesso: q("pp-tipoproc").value, justificativa: q("pp-justif").value,
      magistrado: q("pp-mag-infojud").value.trim() });
    const org = q("pp-orgao");
    mesclar("renajud", Object.assign({ tribunal: q("pp-trib").value, tipoRestricao: marcados("pp-tipo") },
      org && !org.disabled ? { orgao: org.value } : {}));
    mesclar("cnib", { orgaoEsperado: q("pp-cnib-in").value.trim() });
    for (const [mod, chave] of Object.entries(PASTAS)) mesclar(mod, { [chave]: pasta });
    const auto = document.querySelector('input[name="pp-auto"]:checked');
    mesclar("juntada", { automatica: auto ? auto.value : "sim", visibilidadePartes: marcados("pp-vis") });
    await Store.set(CHAVES.config, atual);
    cfg = atual;
    render();
    q("pp-salvo").textContent = "✓ Salvo. Pode fechar esta aba (ou voltar aqui pelas Preferências).";
  }

  render();
  document.getElementById("pp-salvar").onclick = () => salvar().catch((e) => { document.getElementById("pp-salvo").textContent = "Não consegui salvar: " + e.message; });
  document.getElementById("pp-preferencias").onclick = () => { try { browser.runtime.openOptionsPage(); } catch (e) { /* nada */ } };

  /* A lista de varas chega enquanto esta página está aberta: troca as opções sem perder a escolha. */
  try {
    browser.storage.onChanged.addListener((mud) => {
      const k = mud["cratos:infojud_varas"];
      if (!k || !k.newValue) return;
      varas = k.newValue;
      const sel = document.getElementById("pp-vara");
      if (!sel) return;
      const escolhida = sel.value;
      const tmp = document.createElement("div");
      CratosHTML.definir(tmp, selVara(escolhida));
      sel.replaceWith(tmp.firstElementChild);
      const o = document.getElementById("pp-vara-origem");
      if (o) o.textContent = origemVara();
    });
  } catch (e) { /* nada */ }

  if (typeof module !== "undefined") module.exports = {};
})();
