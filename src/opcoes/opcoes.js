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

  for (const mod of modulos) {
    const div = document.createElement("div");
    div.className = "modulo";
    div.dataset.modulo = mod.nome;
    CratosHTML.definir(div, html`<h2>${mod.rotulo}</h2>`);
    const cfgMod = configSalva[mod.nome] || {};

    for (const [chave, esp] of Object.entries(mod.config || {})) {
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
            CratosHTML.definir(campo, html`<label>${cesp.rotulo || ck}</label>${renderControle(ck, cesp, valor)}`);
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
      if (esp.tipo === "toggle") {
        /* Toggle solto (SAB, CENSEC): o rótulo é a própria frase da opção — ele
           vira o texto AO LADO do checkbox, sem duplicar num <label> acima. Antes,
           o checkbox mostrava um "Consultar" fixo e o rótulo aparecia por cima:
           "Aplicar o chip..." em cima, "Consultar" do lado. */
        CratosHTML.definir(campo, renderControle(chave, esp, valor, { rotuloNoCheckbox: true }));
      } else {
        CratosHTML.definir(campo, html`<label>${esp.rotulo || chave}</label>${renderControle(chave, esp, valor)}`);
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
      ["Compatibilidade", "Firefox 115 ou superior"],
      ["Desenvolvimento", pessoas.map((p) =>
        html`<div class="pessoa"><span class="iniciais">${p.iniciais}</span><span>${p.texto}</span></div>`)],
      ["Convênios", "INFOJUD (eCAC), SAB/BacenJud, RENAJUD, CNIB, CENSEC (CEP) e SerasaJUD."],
      ["Escopo", html`O CRATOS <b>prepara</b>. Confirmar, assinar e enviar é sempre ato seu — em todos os convênios, sem exceção.`],
      ["Uso", "Exclusivo para servidores do Poder Judiciário, dentro dos sistemas em que você " +
        "já está autenticado. Dados protegidos pela LGPD."],
      ["Privacidade", "🔒 Tudo acontece no seu navegador. Os dados do processo ficam no " +
        "armazenamento local do Firefox e são sobrescritos a cada nova operação; nada é enviado " +
        "para servidor do CRATOS — ele não tem servidor, nem telemetria. As requisições são as " +
        "mesmas que você faria à mão, nos sistemas oficiais."],
    ];

    const dl = linhas.map(([rotulo, valor]) =>
      html`<div class="linha"><dt>${rotulo}</dt><dd>${valor}</dd></div>`);
    CratosHTML.definir(caixa, html`<div class="sobre">
         <header><img src="../icones/cratos-48.png" alt="">Sobre o CRATOS</header>
         <dl>${dl}  </dl>
       </div>`);
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
      const opts = [html`<option value="">\u2014 selecione \u2014</option>`].concat(
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
