/*
 * opcoes.js — tela de configurações do CRATOS.
 * Renderiza a partir do schema de cada módulo e PERSISTE em cratos:config.
 *
 * Tipos de controle suportados:
 *   toggle       -> { ativo: bool }                 (checkbox "consultar?")
 *   toggle_anos  -> { ativo: bool, anos: number }   (checkbox + seletor de anos)
 *   numero       -> number
 *   texto        -> string
 *   multiselect  -> string[]
 *   escolha      -> string (radio)
 *   select       -> string (dropdown compacto, opções fixas, com padrão)
 *   lista        -> string (select)
 *   aviso        -> NÃO é campo: só texto de orientação. Não entra no config
 *                   salvo (não tem data-tipo, então o salvar() nem o vê).
 */

(async function () {
  /* 1.5.5: todo HTML desta tela é montado com html`` (comum/storage.js): cada
     interpolação é escapada; só fragmentos html`` entram crus. Os AVISOS dos
     módulos têm <b>/<i> de propósito — passam por marcacaoLimitada(), que só
     deixa essas tags simples, sem atributo. */
  const html = CratosHTML.html;
  const alvo = document.getElementById("modulos");
  const { modulos } = await browser.runtime.sendMessage({ tipo: "catalogo" });
  const configSalva = (await Store.get(CHAVES.config)) || {};

  if (!modulos || !modulos.length) {
    alvo.innerHTML = `<p class="nota">Nenhum módulo de convênio registrado ainda.</p>`;
    renderSobre();
    return;
  }

  /* 1.9.2 — listas lidas das telas (varas do e-CAC, órgãos do RENAJUD) e o botão dos
     Primeiros passos, no topo. */
  const listas = {};
  try { listas.infojud_varas = await Store.get("infojud_varas"); } catch (e) { /* nada */ }
  try { listas.renajud_listas = await Store.get("renajud_listas"); } catch (e) { /* nada */ }
  try { listas.trt = await Store.get(CHAVES.trt); } catch (e) { /* nada */ }
  {
    const topo = document.createElement("div");
    topo.className = "campo";
    topo.id = "cx-topo-primeiros";
    CratosHTML.definir(topo, html`<button id="cx-primeiros" style="padding:7px 14px;background:#1a1a1a;color:#e8e8e8;border:1px solid #e11d1d;border-radius:7px;cursor:pointer">Abrir os Primeiros passos</button>
      <span class="nota">configuração guiada do essencial (vara do e-CAC, RENAJUD, pasta, juntada)</span>`);
    alvo.appendChild(topo);
    topo.querySelector("#cx-primeiros").onclick = () => browser.runtime.sendMessage({ tipo: "abrir_primeiros" }).catch(() => {});
  }
  const dataBR = (ms) => { try { return new Date(Number(ms)).toLocaleDateString("pt-BR"); } catch (e) { return "?"; } };
  /* Troca as opções de um campo "lista" pela lista lida da tela, quando houver. */
  let cfgModAtual = null;
  function listaDinamica(esp) {
    if (esp.listaDinamica === "infojud_varas") {
      const l = listas.infojud_varas;
      if (l && Array.isArray(l.opcoes) && l.opcoes.length) {
        return { esp: Object.assign({}, esp, { opcoes: l.opcoes }), origem: `Lista lida do seu e-CAC em ${dataBR(l.em)} (${l.opcoes.length} varas).`, lida: true };
      }
      return { esp, origem: "Lista padrão (TRT18). Use o botão para ler a lista do seu e-CAC.", lida: false };
    }
    if (esp.listaDinamica === "renajud_orgaos") {
      const r = orgaosDoTribunal(cfgModAtual && cfgModAtual.tribunal);
      return { esp: Object.assign({}, esp, { opcoes: r.opcoes }), origem: r.origem, lida: r.opcoes.length > 0 };
    }
    return null;
  }
  /* 1.9.2 — órgãos do RENAJUD do tribunal EFETIVO: o escolhido nas Preferências; no
     "Automático", o do endereço do PJe que o CRATOS guardou; sem os dois, o da última lista
     lida. Fonte: a lista lida no uso (se for desse tribunal e mais nova) ou a embutida. */
  function orgaosDoTribunal(tribunalCfg) {
    const O = typeof CratosOrgaosRenajud !== "undefined" ? CratosOrgaosRenajud : null;
    const l = listas.renajud_listas;
    const lidaId = l && l.tribunal && l.tribunal.id;
    let id = "";
    if (tribunalCfg) id = O ? O.idDoNome(tribunalCfg) : "";
    else id = (O && O.idDoHost(listas.trt)) || lidaId || "";
    const lidaVale = l && Array.isArray(l.orgaos) && l.orgaos.length && lidaId === id &&
      (!O || Number(l.emOrgaos) >= Date.parse(O.geradoEm));
    if (lidaVale) return { id, opcoes: l.orgaos, origem: `Lista lida do RENAJUD em ${dataBR(l.emOrgaos)} (${id}, ${l.orgaos.length} órgãos).` };
    const emb = O && id ? O.orgaosDe(id) : [];
    if (emb.length) return { id, opcoes: emb, origem: `Lista do RENAJUD para ${id} (${emb.length} órgãos, coletada em ${O.geradoEm.split("-").reverse().join("/")}). Ela se atualiza sozinha a cada inclusão pelo CRATOS.` };
    return { id, opcoes: [], origem: "Escolha o tribunal acima, ou abra um processo no PJe uma vez (o CRATOS descobre o tribunal pelo endereço)." };
  }

  for (const mod of modulos) {
    const div = document.createElement("div");
    div.className = "modulo";
    div.dataset.modulo = mod.nome;
    CratosHTML.definir(div, html`<h2>${mod.rotulo}</h2>`);
    const cfgMod = configSalva[mod.nome] || {};

    for (let [chave, esp] of Object.entries(mod.config || {})) {
      if (chave === "_grupos") {
        /* Grupos (INFOJUD: cpf | cnpj) vão LADO A LADO, numa faixa .grupos —
           as duas listas são espelhadas, e empilhadas obrigavam a rolar a tela
           para comparar CPF com CNPJ. O estilo mora no opcoes.html; aqui só
           montamos a estrutura. Os data-grupo continuam idênticos, então
           salvar() não muda nada. */
        const faixa = document.createElement("div");
        faixa.className = "grupos";
        for (const [nomeGrupo, grupo] of Object.entries(esp)) {
          const sub = document.createElement("div");
          sub.className = "grupo";
          sub.dataset.grupo = nomeGrupo;
          CratosHTML.definir(sub, html`<h3>${grupo.rotulo}</h3>`);
          const cfgGrupo = (cfgMod[nomeGrupo]) || {};
          for (const [ck, cesp] of Object.entries(grupo.campos)) {
            const campo = document.createElement("div");
            campo.className = "campo";
            const valor = cfgGrupo[ck] ?? cesp.padrao;
            if (cesp.tipo === "toggle" && cesp.rotuloAoLado) {
              /* 1.9.0 — opção que é uma frase (Recuperar NI): texto ao lado da caixa,
                 sem título em cima nem "Consultar". */
              CratosHTML.definir(campo, renderControle(ck, cesp, valor, { rotuloNoCheckbox: true }));
            } else {
              CratosHTML.definir(campo, html`<label>${cesp.rotulo || ck}</label>${renderControle(ck, cesp, valor)}`);
            }
            sub.appendChild(campo);
          }
          faixa.appendChild(sub);
        }
        div.appendChild(faixa);
        continue;
      }
      // aviso: bloco de orientação, sem rótulo e sem valor
      if (esp.tipo === "aviso") {
        const nota = document.createElement("div");
        nota.className = "campo";
        CratosHTML.definir(nota, renderAviso(esp));
        div.appendChild(nota);
        continue;
      }
      // campos soltos (vara, tipoProcesso, etc.)
      const campo = document.createElement("div");
      campo.className = "campo";
      const valor = cfgMod[chave] ?? esp.padrao;
      /* 1.9.2 — lista lida da tela + nota explicativa do campo */
      cfgModAtual = cfgMod;
      const din = esp.listaDinamica ? listaDinamica(esp) : null;
      if (din) esp = din.esp;
      if (esp.tipo === "toggle") {
        /* Toggle solto (SAB, CENSEC): o rótulo é a própria frase da opção — ele
           vira o texto AO LADO do checkbox, sem duplicar num <label> acima. Antes,
           o checkbox mostrava um "Consultar" fixo e o rótulo aparecia por cima:
           "Aplicar o chip..." em cima, "Consultar" do lado. */
        CratosHTML.definir(campo, renderControle(chave, esp, valor, { rotuloNoCheckbox: true }));
      } else {
        CratosHTML.definir(campo, html`<label>${esp.rotulo || chave}</label>${renderControle(chave, esp, valor)}`);
      }
      if (din) {
        const n = document.createElement("div");
        n.className = "nota cx-origem-lista";
        n.dataset.lista = esp.listaDinamica;
        const salvoFora = valor && din.lida && !_resolverValorLista(valor, esp.opcoes || []);
        CratosHTML.definir(n, html`${din.origem}${salvoFora ? html` <span style="color:#f87171">A escolha salva ("${valor}") não está nesta lista: escolha de novo.</span>` : ""}`);
        campo.appendChild(n);
        if (esp.listaDinamica === "renajud_orgaos") {
          /* trocar o tribunal troca a lista de órgãos na hora */
          const selTrib = div.querySelector('select[data-chave="tribunal"]');
          const selOrg = campo.querySelector('select[data-chave="orgao"]');
          if (selTrib && selOrg) selTrib.addEventListener("change", () => {
            const r = orgaosDoTribunal(selTrib.value);
            const atual = selOrg.value;
            CratosHTML.definir(selOrg, html`<option value="">\u2014 selecione \u2014</option>${r.opcoes.map((o) =>
              html`<option value="${o}" ${o === atual ? "selected" : ""}>${o}</option>`)}`);
            n.textContent = r.origem;
          });
          /* "Perguntar de novo na próxima inclusão": limpa órgão e magistrado (quem mudou de lotação) */
          const b = document.createElement("button");
          b.id = "cx-renajud-reaprender";
          b.textContent = "Perguntar de novo na próxima inclusão";
          b.style.cssText = "margin-top:6px;padding:5px 12px;background:#1a1a1a;color:#e8e8e8;border:1px solid #444;border-radius:6px;cursor:pointer";
          b.onclick = async () => {
            try {
              const cfgT = (await Store.get(CHAVES.config)) || {};
              cfgT.renajud = Object.assign({}, cfgT.renajud || {}, { orgao: "", magistrado: "" });
              await Store.set(CHAVES.config, cfgT);
            } catch (e) { /* nada */ }
            if (selOrg) selOrg.value = "";
            const mag = div.querySelector('input[data-chave="magistrado"]');
            if (mag) mag.value = "";
            n.textContent = "Na próxima inclusão, o CRATOS pergunta o órgão e o magistrado e guarda.";
          };
          campo.appendChild(b);
        }
        if (esp.listaDinamica === "infojud_varas") {
          const b = document.createElement("button");
          b.id = "cx-ler-varas";
          b.textContent = "Ler as varas do meu e-CAC";
          b.style.cssText = "margin-top:6px;padding:5px 12px;background:#1a1a1a;color:#e8e8e8;border:1px solid #444;border-radius:6px;cursor:pointer";
          b.onclick = () => browser.runtime.sendMessage({ tipo: "infojud_ler_varas" }).catch(() => {});
          campo.appendChild(b);
        }
      }
      if (esp.nota) {
        const n = document.createElement("div");
        n.className = "nota";
        n.textContent = esp.nota;
        campo.appendChild(n);
      }
      div.appendChild(campo);
    }
    alvo.appendChild(div);
  }

  const barra = document.createElement("div");
  barra.style.cssText = "margin-top:20px;display:flex;gap:12px;align-items:center";
  barra.innerHTML = `
    <button id="cx-salvar" style="padding:9px 18px;background:#e11d1d;color:#fff;border:none;border-radius:7px;font-weight:600;cursor:pointer">Salvar configurações</button>
    <span id="cx-salvo" style="color:#4ade80;font-size:13px"></span>`;
  alvo.appendChild(barra);
  document.getElementById("cx-salvar").onclick = salvar;

  /* 1.9.2 — a lista de varas chega enquanto as Preferências estão abertas (botão "Ler as
     varas do meu e-CAC"): troca as opções do menu SEM perder o que já foi escolhido aqui. */
  try {
    browser.storage.onChanged.addListener((mud) => {
      const k = mud["cratos:infojud_varas"];
      if (!k || !k.newValue || !Array.isArray(k.newValue.opcoes)) return;
      listas.infojud_varas = k.newValue;
      const sel = document.querySelector('.modulo[data-modulo="infojud"] select[data-chave="vara"]');
      if (!sel) return;
      const atual = sel.value;
      const opts = [html`<option value="">\u2014 selecione \u2014</option>`].concat(k.newValue.opcoes.map((o) =>
        html`<option value="${o.valor}" ${o.valor === atual ? "selected" : ""}>${o.rotulo}</option>`));
      CratosHTML.definir(sel, html`${opts}`);
      const n = document.querySelector('.cx-origem-lista[data-lista="infojud_varas"]');
      if (n) n.textContent = `Lista lida do seu e-CAC em ${dataBR(k.newValue.em)} (${k.newValue.opcoes.length} varas).` +
        (atual && !k.newValue.opcoes.some((o) => o.valor === atual) ? " A escolha salva não está nesta lista: escolha de novo." : "");
    });
  } catch (e) { /* nada */ }
  renderSobre();

  /* ═══ CARTÃO "SOBRE O CRATOS" ═══
   * Fecha a tela de Preferências dizendo, em uma olhada, o que esta coisa é e
   * o que ela faz com os dados de quem a usa.
   *
   * A versão sai do MANIFESTO, nunca de uma string escrita à mão: cartão que
   * anuncia versão errada é pior do que cartão nenhum, e é exatamente o tipo de
   * linha que se esquece de atualizar.
   *
   * O texto de privacidade é o do CRATOS, não o do InfoJOB. Aqui o estado de
   * cada convênio (cnib_estado, censec_estado, serasajud_estado…) é
   * SOBRESCRITO a cada operação, não apagado ao fim — dizer "removido
   * automaticamente ao concluir" seria mentira confortável. */
  function renderSobre() {
    let caixa = document.getElementById("sobre");
    if (!caixa) {
      caixa = document.createElement("div");
      caixa.id = "sobre";
      document.body.appendChild(caixa);
    }

    let versao = "—";
    try { versao = browser.runtime.getManifest().version; } catch (e) {}

    const pessoas = [
      { iniciais: "RM", texto: "Rodrigo Madalosso Araujo — TRT 18ª Região" },
    ];

    const linhas = [
      ["Nome", "CRATOS — Central de Recursos para Automação de Tarefas e Operações Sistêmicas"],
      ["Versão", versao],
      ["Compatibilidade", "Firefox 140 ou superior"],
      ["Desenvolvimento", pessoas.map((p) =>
        html`<div class="pessoa"><span class="iniciais">${p.iniciais}</span><span>${p.texto}</span></div>`)],
      ["Convênios", "INFOJUD (eCAC), SAB/BacenJud, RENAJUD, CNIB, CENSEC (CEP), SerasaJUD, CCS (Bacen), SNIPER e PREVJUD."],
      ["Escopo", html`O CRATOS <b>prepara</b>. Confirmar, assinar e enviar é sempre ato seu — em todos os convênios, sem exceção.`],
      ["Uso", "Exclusivo para servidores do Poder Judiciário, dentro dos sistemas em que você " +
        "já está autenticado. Dados protegidos pela LGPD."],
      ["Privacidade", "🔒 Tudo acontece no seu navegador. Os dados de cada processo ficam no " +
        "armazenamento local do Firefox SÓ enquanto a aba do processo estiver aberta: ao fechá-la, " +
        "são apagados, e o que sobrar é apagado quando o Firefox abre. Nada é enviado para servidor " +
        "do CRATOS — ele não tem servidor, nem telemetria. As requisições são as mesmas que você " +
        "faria à mão, nos sistemas oficiais."],
      ["Atualizações", html`Automáticas, pelo próprio Firefox: ele consulta, cerca de uma vez por dia, a lista de
        versões publicada no repositório do CRATOS no GitHub e baixa a versão nova assinada. Nessa consulta
        não vai nenhum dado de processo. O botão abaixo consulta essa mesma lista na hora.
        <div style="margin-top:8px"><button class="botao-novidades" id="procurar-atualizacao" type="button">Procurar atualização</button></div>
        <div id="atualizacao-status" style="margin-top:6px;color:#b0b0b0">Instalar uma versão nova reinicia o CRATOS: use quando não houver convênio rodando.</div>`],
      ["Novidades", typeof CratosNovidades !== "undefined"
        ? html`<button class="botao-novidades" id="ver-novidades" type="button">Ver novidades das versões</button>` : "—"],
    ];

    const dl = linhas.map(([rotulo, valor]) =>
      html`<div class="linha"><dt>${rotulo}</dt><dd>${valor}</dd></div>`);
    CratosHTML.definir(caixa, html`<div class="sobre">
         <header><img src="../icones/cratos-48.png" alt="">Sobre o CRATOS</header>
         <dl>${dl}  </dl>
       </div>`);
    const bn = caixa.querySelector("#ver-novidades");
    if (bn) bn.onclick = abrirNovidades;
    const bu = caixa.querySelector("#procurar-atualizacao");
    if (bu) bu.onclick = procurarAtualizacao;
  }

  /* 1.9.2 (Rodrigo, 26/10): "um botãozinho nas configurações para o usuário checar se tem
     novas atualizações". O fundo pede ao Firefox a mesma consulta que ele faz sozinho. */
  async function procurarAtualizacao() {
    const st = document.getElementById("atualizacao-status");
    const bu = document.getElementById("procurar-atualizacao");
    const dizer = (t, cor) => { if (st) { st.textContent = t; st.style.color = cor || "#b0b0b0"; } };
    if (bu) bu.disabled = true;
    dizer("Consultando a lista de versões…");
    let r = null;
    try { r = await browser.runtime.sendMessage({ tipo: "verificar_atualizacao" }); } catch (e) { r = null; }
    if (bu) bu.disabled = false;
    if (!r || !r.ok) return dizer("Não consegui consultar agora. Tente mais tarde.", "#facc15");
    if (r.status === "no_update") return dizer(`Você está na versão mais recente (${r.atual}).`, "#4ade80");
    if (r.status === "update_available") {
      if (!r.link) return dizer(`Versão ${r.versao} disponível. Ela chega sozinha pela atualização automática do Firefox.`, "#4ade80");
      CratosHTML.definir(st, html`<span style="color:#4ade80">Versão ${r.versao} disponível (você está na ${r.atual}).</span>
        <button class="botao-novidades" id="instalar-atualizacao" type="button" style="margin-left:8px">Instalar agora</button>
        <div style="color:#b0b0b0;margin-top:4px">O Firefox pergunta se você quer instalar e atualiza por cima, sem perder as Preferências.</div>`);
      const bi = document.getElementById("instalar-atualizacao");
      if (bi) bi.onclick = () => browser.runtime.sendMessage({ tipo: "instalar_atualizacao", link: r.link }).catch(() => {});
      return;
    }
    return dizer("Não consegui consultar agora. Tente mais tarde.", "#facc15");
  }

  /* 1.9.0: histórico das novidades numa janela (o mesmo texto do cartão do painel) */
  function abrirNovidades() {
    if (document.getElementById("janela-novidades") || typeof CratosNovidades === "undefined") return;
    const j = document.createElement("div");
    j.id = "janela-novidades";
    const blocos = CratosNovidades.VERSOES.map((e) =>
      html`<h3>${e.versao} — ${e.data}</h3><ul>${e.itens.map((t) => html`<li>${t}</li>`)}</ul>`);
    CratosHTML.definir(j, html`<div class="caixa" role="dialog" aria-label="Novidades das versões">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <strong>Novidades das versões</strong>
          <button class="botao-novidades" id="fechar-novidades" type="button">Fechar</button>
        </div>${blocos}</div>`);
    document.body.appendChild(j);
    const fechar = () => j.remove();
    j.querySelector("#fechar-novidades").onclick = fechar;
    j.onclick = (ev) => { if (ev.target === j) fechar(); };
  }

  function anosOptions(sel) {
    const out = [];
    for (let n = 1; n <= 5; n++) out.push(html`<option value="${n}" ${n === sel ? "selected" : ""}>${n}</option>`);
    return out;
  }

  /* Bloco de orientação. Aceita esp.texto (string) ou esp.itens (string[]).
     esp.nivel: "atencao" (padrão, âmbar) | "info" (cinza) | "risco" (vermelho). */
  function renderAviso(esp) {
    const cores = { atencao: "#facc15", info: "#9a9a9a", risco: "#e11d1d" };
    const cor = cores[esp.nivel] || cores.atencao;
    const itens = Array.isArray(esp.itens) ? esp.itens : null;
    const marc = CratosHTML.marcacaoLimitada;
    const corpo = itens
      ? html`<ul style='margin:6px 0 0;padding-left:18px'>${itens.map((i) => html`<li style="margin:3px 0">${marc(i)}</li>`)}</ul>`
      : html`<div style="margin-top:4px">${marc(esp.texto || "")}</div>`;
    return html`<div style="border-left:4px solid ${cor};background:#1a1a1a;border-radius:6px;
                 padding:10px 12px;margin:6px 0;color:#e8e8e8;font-size:13px;line-height:1.5">
              ${esp.rotulo ? html`<b style="color:${cor}">${esp.rotulo}</b>` : ""}
              ${corpo}
            </div>`;
  }

  function renderControle(chave, esp, valor, opts) {
    if (esp.tipo === "aviso") return renderAviso(esp);
    if (esp.tipo === "toggle") {
      const ativo = !!(valor && valor.ativo);
      /* Texto ao lado do checkbox. Padrão "Consultar": no INFOJUD o rótulo do
         campo ("DOI", "Informações Cadastrais") aparece ACIMA e "Consultar"
         descreve a ação. Em campos soltos (SAB, CENSEC) o chamador pede
         rotuloNoCheckbox: aí o próprio rótulo vira o texto, sem repetir acima. */
      const texto = (opts && opts.rotuloNoCheckbox) ? (esp.rotulo || chave) : "Consultar";
      return html`<label style="display:flex;gap:8px;align-items:center;color:#e8e8e8">
        <input type="checkbox" data-chave="${chave}" data-tipo="toggle" ${ativo ? "checked" : ""}> ${texto}</label>`;
    }
    if (esp.tipo === "toggle_anos") {
      const ativo = !!(valor && valor.ativo);
      const anos = (valor && valor.anos) || 3;
      return html`<div style="display:flex;gap:14px;align-items:center;color:#e8e8e8" data-chave="${chave}" data-tipo="toggle_anos">
        <label style="display:flex;gap:8px;align-items:center">
          <input type="checkbox" class="cx-ativo" ${ativo ? "checked" : ""}> Consultar</label>
        <label style="display:flex;gap:6px;align-items:center;color:#b0b0b0">
          anos: <select class="cx-anos">${anosOptions(anos)}</select></label>
      </div>`;
    }
    if (esp.tipo === "numero") {
      return html`<input type="number" min="${esp.min ?? ""}" max="${esp.max ?? ""}" value="${valor}" data-chave="${chave}" data-tipo="numero">`;
    }
    if (esp.tipo === "multiselect") {
      return html`${esp.opcoes.map((o) =>
        html`<label style="display:inline-flex;gap:6px;margin-right:12px;color:#e8e8e8">
           <input type="checkbox" value="${o}" ${(valor || []).includes(o) ? "checked" : ""} data-chave="${chave}" data-tipo="multiselect"> ${o}
         </label>`)}`;
    }
    if (esp.tipo === "escolha") {
      const atual = valor ?? esp.padrao;
      const radios = esp.opcoes.map((o) =>
          html`<label style="display:inline-flex;gap:6px;align-items:center;cursor:pointer">
             <input type="radio" name="rad_${chave}" value="${o.valor}" ${atual === o.valor ? "checked" : ""}> ${o.rotulo}
           </label>`);
      return html`<div data-chave="${chave}" data-tipo="escolha" style="display:flex;gap:16px;flex-wrap:wrap;color:#e8e8e8">${radios}</div>`;
    }
    if (esp.tipo === "select") {
      /* Dropdown compacto de opções fixas, com padrão (sem "— selecione —" nem
         migração): usado pelas opções finas do eFinanceira. O VALOR guardado é o
         próprio texto da opção, porque o incluirPedido casa por texto na tela do
         eCAC. Aceita string[] ou {valor, rotulo}. */
      const atual = valor ?? esp.padrao ?? "";
      const opc = (esp.opcoes || []).map((o) => {
        const v = (o && typeof o === "object") ? o.valor : o;
        const r = (o && typeof o === "object") ? o.rotulo : o;
        return html`<option value="${v}" ${String(atual) === String(v) ? "selected" : ""}>${r}</option>`;
      });
      return html`<select data-chave="${chave}" data-tipo="select" style="width:100%;max-width:320px">${opc}</select>`;
    }
    if (esp.tipo === "lista") {
      const bruto = valor ?? esp.padrao ?? "";
      /* ═══ MIGRAÇÃO SILENCIOSA DO VALOR ANTIGO ═══
         A vara do eCAC era texto livre; agora é lista, e o que se guarda é o
         CÓDIGO. Quem já tinha configurado tem no storage o NOME colado à mão —
         que não casa com nenhum código, e o menu nasceria em "— selecione —".
         Isso não é só feio: se a pessoa salvar sem tocar no menu, a vara antiga
         vira VAZIO e o pedido sai sem vara. Então reconhecemos o valor antigo
         aqui e já deixamos a opção certa marcada; no próximo salvar ele vira
         código sozinho, sem ninguém saber que houve migração. */
      const atual = _resolverValorLista(bruto, esp.opcoes || []);
      /* `opcoes` aceita string (valor = rótulo, como sempre) OU
         {valor, rotulo} — que é o que a lista de varas do eCAC precisa: o que
         se GUARDA é o código ("001"), o que se MOSTRA é o nome. Guardar o nome
         seria guardar algo que a Receita reescreve (duas varas já vêm em CAIXA
         ALTA) e que no `option value` vem com espaços à direita. */
      const opts = [html`<option value="">${esp.rotuloVazio || "\u2014 selecione \u2014"}</option>`].concat(
        (esp.opcoes || []).map((o) => {
          const v = (o && typeof o === "object") ? o.valor : o;
          const r = (o && typeof o === "object") ? o.rotulo : o;
          return html`<option value="${v}" ${atual === v ? "selected" : ""}>${r}</option>`;
        }));
      return html`<select data-chave="${chave}" data-tipo="lista" style="width:100%;max-width:420px">${opts}</select>`;
    }
    return html`<input type="text" value="${valor}" data-chave="${chave}" data-tipo="texto" style="width:100%;max-width:420px">`;
  }

  async function salvar() {
    const config = {};
    for (const divMod of document.querySelectorAll(".modulo")) {
      const nome = divMod.dataset.modulo;
      config[nome] = {};

      // 1) grupos (cpf/cnpj) → config[nome][grupo][campo]
      for (const grupoEl of divMod.querySelectorAll(".grupo")) {
        const g = grupoEl.dataset.grupo;
        config[nome][g] = {};
        for (const el of grupoEl.querySelectorAll('[data-tipo="toggle"]')) {
          config[nome][g][el.dataset.chave] = { ativo: el.checked };
        }
        for (const grp of grupoEl.querySelectorAll('[data-tipo="toggle_anos"]')) {
          config[nome][g][grp.dataset.chave] = {
            ativo: grp.querySelector(".cx-ativo").checked,
            anos: parseInt(grp.querySelector(".cx-anos").value) || 1,
          };
        }
        for (const el of grupoEl.querySelectorAll('[data-tipo="select"]')) {
          config[nome][g][el.dataset.chave] = el.value;
        }
      }

      // 2) campos soltos (fora de .grupo): vara, tipoProcesso, pasta, etc.
      for (const el of divMod.querySelectorAll('[data-tipo="texto"]')) {
        if (el.closest(".grupo")) continue;
        config[nome][el.dataset.chave] = el.value;
      }
      for (const el of divMod.querySelectorAll('[data-tipo="numero"]')) {
        if (el.closest(".grupo")) continue;
        config[nome][el.dataset.chave] = parseInt(el.value) || 0;
      }
      for (const el of divMod.querySelectorAll('[data-tipo="toggle"]')) {
        if (el.closest(".grupo")) continue;
        config[nome][el.dataset.chave] = { ativo: el.checked };
      }
      for (const grp of divMod.querySelectorAll('[data-tipo="toggle_anos"]')) {
        if (grp.closest(".grupo")) continue;
        config[nome][grp.dataset.chave] = {
          ativo: grp.querySelector(".cx-ativo").checked,
          anos: parseInt(grp.querySelector(".cx-anos").value) || 1,
        };
      }
      for (const el of divMod.querySelectorAll('[data-tipo="escolha"]')) {
        if (el.closest(".grupo")) continue;
        const marcado = el.querySelector("input[type=radio]:checked");
        config[nome][el.dataset.chave] = marcado ? marcado.value : null;
      }
      for (const el of divMod.querySelectorAll('[data-tipo="lista"]')) {
        if (el.closest(".grupo")) continue;
        config[nome][el.dataset.chave] = el.value;
      }
      for (const el of divMod.querySelectorAll('[data-tipo="select"]')) {
        if (el.closest(".grupo")) continue;
        config[nome][el.dataset.chave] = el.value;
      }
      // multiselect: junta os checkboxes de mesma chave num array.
      for (const el of divMod.querySelectorAll('[data-tipo="multiselect"]')) {
        if (el.closest(".grupo")) continue;
        const ch = el.dataset.chave;
        if (!Array.isArray(config[nome][ch])) config[nome][ch] = [];
        if (el.checked) config[nome][ch].push(el.value);
      }
    }
    await Store.set(CHAVES.config, config);
    const aviso = document.getElementById("cx-salvo");
    aviso.textContent = "\u2713 salvo";
    setTimeout(() => (aviso.textContent = ""), 2000);
  }


  /* Resolve um valor guardado contra a lista de opções, em degraus — do mais
     estrito ao mais frouxo, e o último só vale se casar UMA. Frouxidão que casa
     várias é o que fazia "Vara do Trabalho de Goiânia" virar a 1ª Vara. */
  function _resolverValorLista(bruto, opcoes) {
    const b = String(bruto || "");
    if (!b) return "";
    const par = (o) => (o && typeof o === "object") ? o : { valor: o, rotulo: o };
    const norm = (x) => String(x || "").replace(/\s+/g, " ").trim().toLowerCase();
    const lista = opcoes.map(par);

    // 1) já é o valor (código)
    if (lista.some((o) => String(o.valor) === b)) return b;
    const alvo = norm(b);
    // 2) o NOME exato — o que vem depois do travessão no rótulo
    for (const o of lista) {
      const nome = String(o.rotulo).split("—").slice(1).join("—");
      if (nome && norm(nome) === alvo) return o.valor;
    }
    // 3) o rótulo inteiro exato (quem colou "001 - 1ª Vara…")
    for (const o of lista) if (norm(o.rotulo) === alvo) return o.valor;
    // 4) contém, e SÓ se casar uma única opção
    const cand = lista.filter((o) => norm(o.rotulo).includes(alvo));
    return cand.length === 1 ? cand[0].valor : "";
  }

  /* (1.5.5) escapeAttr() saiu: só escapava aspas. html`` escapa tudo. */
})();
