/*
 * conteudo/serasajud.js — content script do SerasaJUD.
 *
 * ═══ O QUE ESTE CONVÊNIO TEM DE PARTICULAR ═══
 *  - Angular + Material, mas com `formControlName` no DOM (nome, documento,
 *    valor, dataDivida, vlrAcao, autor, reu). Seletor estável de graça — o
 *    oposto do CENSEC. A exceção é o número do processo, sem formControlName na
 *    tela de cadastro: ancoramos em `app-nro-processo-input`.
 *  - INCLUSÃO e BAIXA são formulários DIFERENTES, não o mesmo com outro botão:
 *      inclusão → Verificar · titulares · vlrAcao/autor/reu (texto)
 *      baixa    → (sem Verificar) · titulares · credores (com valor e DATA) ·
 *                 Autor e Réu em mat-select
 *
 * ═══ ARMADILHAS (todas vistas nos recons de 19/08) ═══
 *  1. Campo do processo é MASCARADO e formatado (0000000-00.0000.0.00.0000).
 *     Vai por evento de paste real, receita do RENAJUD.
 *  2. "Verificar" e "Adicionar" NASCEM CINZA. Nunca clicar sem checar disabled.
 *  3. Diálogos "Entendi" bloqueiam o caminho em dois pontos — e NÃO podem ser
 *     confundidos com o de confirmação, que é o nosso ponto de parada.
 *  4. A "Data da Dívida" é um datepicker (readOnly): tentamos o setter nativo e,
 *     se não fixar, navegamos o calendário — cujos meses vêm em INGLÊS.
 *  5. O BOTÃO DE ENVIAR TEM O MESMO TEXTO DA ABA ("Baixar Dívida" é os dois).
 *     Procurar por texto sem escopo clica na aba — ou envia sem querer.
 *  6. A tabela de titulares tem uma primeira linha vazia na leitura.
 *
 * ═══ ONDE PARAMOS ═══
 * No diálogo "Confirmar inclusão/baixa da dívida?". Temos o POST da ordem
 * capturado no recon e ainda assim não o chamamos: ato de constrição se envia
 * com o usuário olhando.
 */

(function iniciarSerasajud() {
  if (!/serasa-judicial\.serasaexperian\.com\.br$/.test(location.hostname)) return;
  console.log("CRATOS/SERASAJUD: content script ativo em", location.pathname);

  const ROTA_CADASTRO = "/cadastrar-ordem";
  const VALIDADE_ESTADO_MS = 30 * 60 * 1000;
  const LIMITE_VIGIA_MS = 10 * 60 * 1000;

  const SEL = {
    processo: "app-nro-processo-input input",
    titularNome: 'app-lista-titulares input[formcontrolname="nome"]',
    titularDoc: 'app-lista-titulares input[formcontrolname="documento"]',
    valorAcao: 'input[formcontrolname="vlrAcao"]',
    autorTexto: 'input[formcontrolname="autor"]',
    reuTexto: 'input[formcontrolname="reu"]',
    credorValor: 'input[formcontrolname="valor"]',
    credorData: 'input[formcontrolname="dataDivida"]',
    credorContrato: 'input[formcontrolname="numeroContrato"]',
    dialogo: "mat-dialog-container, .mat-mdc-dialog-container",
    carregando: "mat-progress-bar, app-loader .loading",
  };

  injetarGrampo();

  /* Fila de UMA resposta: a confirmação da ordem, vinda do grampo. */
  let aguardandoOrdem = null;
  window.addEventListener("cratos:serasajud:ordem", (ev) => {
    let dados = null;
    try { dados = JSON.parse(ev.detail); } catch (e) { dados = { ok: false, erro: "resposta ilegível" }; }
    console.log("CRATOS/SERASAJUD: POST da ordem observado (status " + (dados && dados.status) + ").");
    if (aguardandoOrdem) { const r = aguardandoOrdem; aguardandoOrdem = null; r(dados); }
  });

  let aguardandoLista = null;
  window.addEventListener("cratos:serasajud:lista", (ev) => {
    let dados = null;
    try { dados = JSON.parse(ev.detail); } catch (e) { return; }
    if (aguardandoLista) { const r = aguardandoLista; aguardandoLista = null; r(dados); }
  });

  function injetarGrampo() {
    try {
      const s = document.createElement("script");
      s.src = browser.runtime.getURL("conteudo/serasajud-api.js");
      s.async = false;
      (document.head || document.documentElement).appendChild(s);
      s.onload = () => s.remove();
    } catch (e) {
      console.error("CRATOS/SERASAJUD: falha ao injetar o grampo:", e);
    }
  }

  Store.get("serasajud_estado").then(async (est) => {
    if (!(await Store.ligada())) { console.log("CRATOS/SERASAJUD: extensão desligada."); return; }
    if (!est || !est.ativo) return;
    const idade = Date.now() - new Date(est.abertoEm || 0).getTime();
    if (idade > VALIDADE_ESTADO_MS) {
      console.log("CRATOS/SERASAJUD: estado antigo — ignorando.");
      return;
    }
    vigiar(est).catch((e) => falhar(e));
  }).catch((e) => console.warn("CRATOS/SERASAJUD: erro ao ler estado:", e.message));

  /* ═══ O VIGIA ═══
   * Mesma lição que o CENSEC cobrou caro: em SPA, NÃO decida pela URL num
   * instante só. O gatilho é o campo do processo estar montado na tela. */
  async function vigiar(est) {
    const t0 = Date.now();
    let ultimo = "";
    const dizer = (t, c) => { if (t !== ultimo) { ultimo = t; avisar(t, c || "#facc15"); } };

    while (Date.now() - t0 < LIMITE_VIGIA_MS) {
      if (location.pathname.includes(ROTA_CADASTRO) && document.querySelector(SEL.processo)) {
        return fluxo(est);
      }
      /* ═══ NÃO SE CHEGA EM /cadastrar-ordem POR URL ═══
       * Recon de 19/08, minuto a minuto:
       *     16:51:59  /cadastrar-ordem
       *     16:52:03  /?token=<UUID>&userId=…     <- giro de autenticação
       *     16:52:04  /cadastrar-ordem
       *     16:52:09  /?token=…                   <- de novo
       *     16:52:11  /ordem                      <- e assenta AQUI
       * Pedir a rota profunda por URL dispara um vaivém de token que termina
       * sempre na home. A versão anterior navegava por `location.assign`, era
       * devolvida para /ordem e ficava dez minutos esperando uma tela que nunca
       * viria. O caminho é o mesmo do usuário: CLICAR em "Cadastrar Ordem", que
       * é navegação interna do Angular e não passa pela autenticação de novo. */
      const botaoCadastrar = botaoCadastrarOrdem();
      if (botaoCadastrar) {
        dizer("abrindo Cadastrar Ordem…");
        botaoCadastrar.click();
        await sleep(1200);
        continue;                       // sem reload: o vigia segue vivo e vê o formulário
      }

      if (location.pathname === "/" || /login|token=/i.test(location.href)) {
        dizer("aguardando seu login no SerasaJUD. Assim que a tela abrir, eu sigo sozinho.");
      } else if (!location.pathname.includes(ROTA_CADASTRO)) {
        dizer("esperando a tela inicial do SerasaJUD…");
      } else {
        dizer("abrindo o SerasaJUD — esperando o formulário montar…");
      }
      await sleep(500);
    }
    falhar(new Error("dez minutos sem a tela de cadastro aparecer. Sessão caiu, ou o login não foi concluído."));
  }

  // ══════════════════════════════════════════════════════════════════════════
  async function fluxo(est) {
    const ehBaixa = est.operacao === "baixa";
    avisar(`preparando ${ehBaixa ? "a BAIXA" : "a INCLUSÃO"} — ${est.titulares.length} executado(s).`, "#facc15");

    /* Aviso vermelho ANTES de tocar em qualquer campo: parte do polo ativo entre
       os titulares é negativação de quem deveria receber. Não bloqueia — a
       marcação é do usuário —, mas não passa calado. */
    if ((est.ativosMarcados || []).length) {
      avisar("ATENÇÃO: você marcou parte(s) do polo ATIVO como devedor(es):\n" +
        est.ativosMarcados.map((n) => `· ${n}`).join("\n") +
        "\n\nNegativação é constrição. Confira antes de confirmar.", "#ff6b6b");
      await sleep(4000);
    }

    /* Nome que teve símbolo removido: mostrar ANTES, com o de-para. Você é quem
       confirma a ordem, e tem de saber que o nome não vai idêntico ao do PJe. */
    if ((est.nomesAlterados || []).length) {
      avisar("nomes ajustados para o SerasaJUD aceitar (símbolo especial trava o campo):\n" +
        est.nomesAlterados.map((n) => `· ${n.de}\n  → ${n.para}`).join("\n"), "#facc15");
      await sleep(3500);
    }

    if (!(await escolherAba(ehBaixa ? "Baixar Dívida" : "Incluir Dívida"))) {
      return falhar(new Error(`não achei a aba "${ehBaixa ? "Baixar" : "Incluir"} Dívida" na tela do ` +
        `SerasaJUD. Confira o contador de sessão no alto da tela: se expirou, ` +
        `entre de novo e execute outra vez.`));
    }

    if (!(await preencherProcesso(est))) return;
    if (ehBaixa) { if (!(await fluxoBaixa(est))) return; }
    else { if (!(await fluxoInclusao(est))) return; }

    // ── Envio: PARAMOS no diálogo ──────────────────────────────────────────
    const rotulo = ehBaixa ? "Baixar Dívida" : "Incluir Dívida";
    const enviar = await esperarHabilitado(() => botaoAzul(rotulo), 10000);
    if (!enviar) return falhar(new Error(`o botão "${rotulo}" não habilitou — algum campo obrigatório ficou vazio`));
    enviar.click();

    const dlg = await esperar(() => dialogoCom(/confirmar (inclus|baix)/i), 10000);
    if (!dlg) {
      return falhar(new Error("cliquei em enviar e o diálogo de confirmação não apareceu. Confira a tela antes de repetir."));
    }

    await Store.set("serasajud_estado", Object.assign({}, est, { ativo: false, fase: "aguardando_confirmacao" }));
    avisar(`ordem montada. Confira na tela e clique em CONFIRMAR — esse passo é seu.\n\n` +
      `· ${est.titulares.length} executado(s) na tabela\n· valor ${est.valor}` +
      (ehBaixa ? `\n· data da dívida ${est.dataLiquidacao}` : ""), "#4ade80");

    /* A CERTIDÃO SÓ EXISTE SE O ATO EXISTIU.
       Continuamos escutando: se você confirmar, o site faz o POST e o grampo nos
       entrega o corpo enviado e a resposta. Só com 201 é que a certidão sai — e
       ela é montada a partir do que FOI ENVIADO, não do que pretendíamos enviar.
       Se você cancelar, nada é gerado e o vigia morre no tempo limite. */
    if ((est.config || {}).gerarCertidao === false) return;
    aguardarConfirmacaoEcertificar(est, ehBaixa);
  }

  const ESPERA_CONFIRMACAO_MS = 15 * 60 * 1000;

  async function aguardarConfirmacaoEcertificar(est, ehBaixa) {
    const promessa = new Promise((resolve) => { aguardandoOrdem = resolve; });
    const dados = await Promise.race([promessa, sleep(ESPERA_CONFIRMACAO_MS).then(() => null)]);
    aguardandoOrdem = null;

    if (!dados) {
      console.log("CRATOS/SERASAJUD: ninguém confirmou em 15 min — nenhuma certidão emitida.");
      return;
    }
    if (!dados.ok) {
      avisar(`o SerasaJUD recusou a ordem (HTTP ${dados.status}). Nenhuma certidão foi emitida.`, "#ff6b6b");
      return;
    }

    let enviado = {}, resposta = {};
    try { enviado = JSON.parse(dados.enviado || "{}"); } catch (e) {}
    try { resposta = JSON.parse(dados.corpo || "{}"); } catch (e) {}

    /* Com o ato consumado, vamos LER o número oficial. O POST devolve só o id
       interno do banco (um ObjectId); o número que se cita num despacho —
       1138436/2026 — vive na listagem do órgão. Navegação interna, só leitura. */
    const ordem = await buscarOrdemNaListagem(resposta.id);
    await fabricarCertidao(est, ehBaixa, enviado, resposta, ordem);
  }

  const ESPERA_LISTA_MS = 30 * 1000;

  async function buscarOrdemNaListagem(id) {
    if (!id) return null;
    avisar("ordem confirmada. Buscando o número oficial na listagem…", "#facc15");

    const link = linkOrdensCadastradas();
    if (!link) {
      console.warn("CRATOS/SERASAJUD: não achei o link de Ordens Cadastradas.");
      return null;
    }
    link.click();

    /* A listagem pode ser chamada mais de uma vez (o recon mostrou duas), e o
       "Entendi" dela aparece no meio. Rearmamos a escuta a cada volta em vez de
       apostar numa única resposta. */
    const t0 = Date.now();
    while (Date.now() - t0 < ESPERA_LISTA_MS) {
      const promessa = new Promise((resolve) => { aguardandoLista = resolve; });
      const dados = await Promise.race([promessa, sleep(2000).then(() => null)]);
      aguardandoLista = null;
      await fecharAvisoEntendi();
      if (!dados) continue;

      let lista = {};
      try { lista = JSON.parse(dados.corpo || "{}"); } catch (e) { continue; }
      const achada = (lista.content || []).find((o) => o && o.id === id);
      if (achada) {
        console.log("CRATOS/SERASAJUD: ordem", achada.numeroOrdem + "/" + achada.anoOrdem,
          "| status", achada.status);
        return achada;
      }
    }
    console.warn("CRATOS/SERASAJUD: não achei a ordem na listagem em 30s — certidão sai sem o número.");
    return null;
  }

  function linkOrdensCadastradas() {
    for (const b of document.querySelectorAll("button, a")) {
      if (norm(b.textContent) === "ordens cadastradas" && visivel(b)) return b;
    }
    return null;
  }

  /* Os rótulos que o SerasaJUD usa, em português de gente. Status desconhecido
     sai como veio — melhor mostrar o código cru do que traduzir por adivinhação. */
  const STATUS = {
    AGUARDANDO_ENVIO: "Aguardando Envio",
    EM_ATENDIMENTO: "Em Atendimento",
    FINALIZADO: "Finalizado",
    CANCELADO: "Cancelado",
  };

  /* Certidão montada sobre o CORPO ENVIADO — a verdade do que o Serasa recebeu. */
  async function fabricarCertidao(est, ehBaixa, enviado, resposta, ordem) {
    const cfg = est.config || {};
    const pasta = String(cfg.pasta || "CRATOS").replace(/[\\:*?"<>|]/g, "").trim() || "CRATOS";
    const proc = digitos(est.numProcesso);
    const tipo = ehBaixa ? "Baixa" : "Inclusao";
    /* Preferimos o objeto que o SISTEMA devolve na listagem: ele é mais rico
       (número oficial, status, órgão, cadastrador) e é a versão do Serasa, não a
       nossa. Sem ele, caímos no corpo que foi enviado — que ainda é a verdade do
       que o servidor recebeu, só sem o número. */
    const fonte = ordem || enviado;
    const titulares = Array.isArray(fonte.titulares) ? fonte.titulares : [];
    const dados = fonte.dadosOrdem || {};
    const credores = Array.isArray(dados.credores) ? dados.credores : [];
    const primeiro = titulares[0] || { nome: (est.titulares[0] || {}).nome || "" };
    const filename = `${pasta}/${proc}_${doisPrimeiros(primeiro.nome)} SERASAJUD ${tipo}.pdf`;

    const valorNum = dados.valorAnotacao != null ? dados.valorAnotacao
      : (credores[0] && credores[0].valor != null ? credores[0].valor : null);
    const valorTxt = valorNum != null
      ? valorNum.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
      : est.valor;

    const numeroOficial = ordem && ordem.numeroOrdem
      ? `${ordem.numeroOrdem}/${ordem.anoOrdem || new Date().getFullYear()}`
      : null;
    const statusTxt = ordem && ordem.status ? (STATUS[ordem.status] || ordem.status) : null;

    const cab = `Certifico e dou fé que, nesta data (${dataBR()}), foi expedido ofício eletrônico ao ` +
      `SerasaJUD, no processo nº ${est.numProcesso}, para ${ehBaixa ? "BAIXA" : "INCLUSÃO"} de dívida` +
      (numeroOficial ? `, registrado sob a ordem nº ${numeroOficial}` : "") +
      `, nos seguintes termos:`;

    const linhas = ["", cab, ""];
    if (numeroOficial) linhas.push(`Ordem nº: ${numeroOficial}`);
    if (statusTxt) linhas.push(`Status no sistema, no momento desta certidão: ${statusTxt}`);
    linhas.push(`Tipo da ordem: ${ehBaixa ? "Baixa de Dívida" : "Inclusão de Dívida"}`);
    if (ordem && ordem.orgao && ordem.orgao.nome) linhas.push(`Órgão: ${ordem.orgao.nome.replace(/\s+/g, " ")}`);
    linhas.push(`Prazo de atendimento: ${prazoEmDias(fonte.horasSla || (est.config || {}).horasSla)}`);
    if (dados.nomeAutor) linhas.push(`Autor: ${dados.nomeAutor}`);
    if (dados.nomeReu) linhas.push(`Réu: ${dados.nomeReu}`);
    if (valorTxt && !ehBaixa) linhas.push(`Valor: ${valorTxt}`);

    linhas.push("", `Devedores (${titulares.length}):`);
    titulares.forEach((t, i) => {
      linhas.push(`${i + 1}) ${t.nome} - CPF/CNPJ ${formatarDoc(t.documento)}` +
        (t.principal ? " (principal)" : ""));
    });

    /* Na BAIXA o ofício tem um bloco de Credores próprio, com valor e data da
       dívida por credor. A certidão espelha essa organização em vez de espalhar
       os campos soltos — quem confere lado a lado com a tela acha na mesma ordem. */
    if (ehBaixa && credores.length) {
      linhas.push("", `Credores (${credores.length}):`);
      credores.forEach((c, i) => {
        linhas.push(`${i + 1}) ${c.nome} - CPF/CNPJ ${formatarDoc(c.documento)}`);
        const det = [];
        if (c.valor != null) det.push(`valor ${c.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`);
        if (c.dataDivida) det.push(`data da dívida ${dataDoIso(c.dataDivida)}`);
        if (c.numeroContrato) det.push(`contrato ${c.numeroContrato}`);
        if (det.length) linhas.push(`     ${det.join(" · ")}`);
      });
    }

    linhas.push("", "Era o que me cumpria certificar.", "", "");
    /* Carimbo verificável: o que o servidor devolveu. Serve para conferência de
       quem ler os autos e para o dia em que a redação do status divergir da tela. */
    if (ordem && ordem.cadastrador && ordem.cadastrador.nome) {
      linhas.push(`Cadastrado por: ${ordem.cadastrador.nome}`);
    }
    linhas.push(`Registro interno no sistema: ${resposta.id || "(não informado)"}`);
    if (resposta.message) linhas.push(`Confirmação do servidor: ${resposta.message}`);
    /* STI, 21/08: sem "Emitido pelo sistema CRATOS" enquanto não homologar. */

    await browser.runtime.sendMessage({
      tipo: "fabricar_pdf",
      convenio: "SERASAJUD",
      numProcesso: est.numProcesso,
      operacao: ehBaixa ? "baixa" : "inclusao",
      titulo: ehBaixa ? "CERTIDÃO DE BAIXA NO SERASAJUD" : "CERTIDÃO DE INCLUSÃO NO SERASAJUD",
      linhas,
      filename,
    }).catch(() => { /* Promise rejeita no FF mesmo baixando; presunção de sucesso */ });

    console.log("CRATOS/SERASAJUD: certidão gerada ->", filename);
    avisar(`ordem ${numeroOficial ? "nº " + numeroOficial + " " : ""}confirmada` +
      (statusTxt ? ` (${statusTxt})` : "") + `.\nCertidão gerada: ${filename}`, "#4ade80");
    await Store.set("serasajud_estado", Object.assign({}, est, {
      ativo: false, fase: "concluido", idOrdem: resposta.id || null,
      numeroOrdem: numeroOficial, statusOrdem: statusTxt, certidao: filename,
    }));
  }

  // ── Passos comuns ─────────────────────────────────────────────────────────
  async function preencherProcesso(est) {
    const campo = await esperar(() => document.querySelector(SEL.processo), 15000);
    if (!campo) { falhar(new Error("a tela de cadastro de ordem do SerasaJUD não carregou o campo do "
      + "número do processo em 15 segundos. Confira o contador de sessão no "
      + "alto da tela: se expirou, entre de novo.")); return false; }

    colarComMascara(campo, formatarProcesso(est.numeroDigitos));
    await sleep(600);
    if (digitos(campo.value).length !== 20) {
      falhar(new Error(`o número do processo não fixou no campo (está "${campo.value}")`));
      return false;
    }

    /* "Verificar" só existe na aba de INCLUSÃO. Na baixa o /validar dispara
       sozinho e o formulário já nasce inteiro. */
    const verificar = botaoPorTexto("Verificar");
    if (verificar) {
      const pronto = await esperarHabilitado(() => botaoPorTexto("Verificar"), 10000);
      if (!pronto) { falhar(new Error('o botão "Verificar" não habilitou')); return false; }
      pronto.click();
      await esperarSumir(SEL.carregando, 15000);
      await sleep(800);
    }
    return true;
  }

  async function marcarSla(horas) {
    const radio = document.querySelector(`input[type="radio"][value="${horas}"]`);
    if (!radio) {
      /* Preferência que não pôde ser aplicada é o pior tipo de silêncio: a
         ordem segue com OUTRO prazo e a pessoa confirma achando que valeu o
         dela. Não para o fluxo — mas não passa calado. */
      return CratosFaixa.alertar("serasajud",
        `não achei a opção de prazo de ${horas} horas nesta tela. A ordem ficou ` +
        `com o prazo que o SerasaJUD já traz — confira antes de confirmar.`);
    }
    if (radio.checked) return;
    radio.click();
    await sleep(300);
  }

  /* Titulares: um por vez, CONFERINDO a tabela crescer. Executado que não entra
     é restrição que não existe — este é o ponto em que não se pode confiar. */
  async function adicionarTitulares(est) {
    for (let i = 0; i < est.titulares.length; i++) {
      const t = est.titulares[i];
      const antes = linhasTitulares().length;
      avisar(`adicionando executado ${i + 1} de ${est.titulares.length}: ${t.nome}`, "#facc15");

      if (!(await escrever(() => document.querySelector(SEL.titularNome), t.nome, { nome: true }))) {
        falhar(new Error(`não consegui escrever o nome de ${t.nome}`)); return false;
      }
      if (!colarComMascara(document.querySelector(SEL.titularDoc), t.cpfcnpj)) {
        falhar(new Error(`não consegui escrever o CPF/CNPJ de ${t.nome}`)); return false;
      }
      await sleep(400);

      const add = await esperarHabilitado(() => botaoAdicionarDe(SEL.titularNome), 8000);
      if (!add) { falhar(new Error(`o "Adicionar" não habilitou para ${t.nome}`)); return false; }
      add.click();

      await fecharAvisoEntendi();

      const cresceu = await esperar(() => linhasTitulares().length > antes, 8000);
      if (!cresceu) {
        falhar(new Error(`${t.nome} NÃO entrou na tabela de devedores. ` +
          `Executado que falta é restrição que não existe — parei aqui.`));
        return false;
      }
      await sleep(300);
    }

    const naTabela = linhasTitulares().length;
    if (naTabela !== est.titulares.length) {
      falhar(new Error(`a tabela ficou com ${naTabela} devedor(es) e eu esperava ${est.titulares.length}.`));
      return false;
    }
    return true;
  }

  // ── INCLUSÃO ──────────────────────────────────────────────────────────────
  async function fluxoInclusao(est) {
    await marcarSla(est.config.horasSla);
    if (!(await adicionarTitulares(est))) return false;

    if (!(await escrever(() => document.querySelector(SEL.valorAcao), est.valor, { mascarado: true }))) {
      falhar(new Error("não consegui escrever o valor da dívida no campo — o SerasaJUD não fixou "
        + "o que digitei. Confira a tela.")); return false;
    }
    if (!(await escrever(() => document.querySelector(SEL.autorTexto), est.credor.nome.slice(0, 55), { nome: true }))) {
      falhar(new Error("não consegui escrever o nome do autor no campo — o SerasaJUD não fixou o "
        + "que digitei. Confira a tela.")); return false;
    }
    if (!(await escrever(() => document.querySelector(SEL.reuTexto), nomesEmSequencia(est.titulares, 55), { nome: true }))) {
      falhar(new Error("não consegui escrever o nome do réu no campo — o SerasaJUD não fixou o "
        + "que digitei. Confira a tela.")); return false;
    }
    return true;
  }

  // ── BAIXA ─────────────────────────────────────────────────────────────────
  async function fluxoBaixa(est) {
    await marcarSla(est.config.horasSla);
    if (!(await adicionarTitulares(est))) return false;

    // credor: nome, valor, data da dívida, documento
    const nomeCredor = () => {
      const todos = Array.from(document.querySelectorAll('input[formcontrolname="nome"]'));
      return todos.find((el) => !el.closest("app-lista-titulares")) || null;
    };
    const docCredor = () => {
      const todos = Array.from(document.querySelectorAll('input[formcontrolname="documento"]'));
      return todos.find((el) => !el.closest("app-lista-titulares")) || null;
    };

    if (!(await escrever(nomeCredor, est.credor.nome, { nome: true }))) {
      falhar(new Error("não consegui escrever o nome do credor no campo — o SerasaJUD não fixou "
        + "o que digitei. Confira a tela.")); return false;
    }
    if (!(await escrever(() => document.querySelector(SEL.credorValor), est.valor, { mascarado: true }))) {
      falhar(new Error("não consegui escrever o valor no campo do credor — o SerasaJUD não fixou "
        + "o que digitei. Confira a tela.")); return false;
    }
    if (!(await preencherData(est.dataLiquidacao))) {
      falhar(new Error(`não consegui pôr a data da dívida (${est.dataLiquidacao}) no calendário`));
      return false;
    }
    if (est.credor.cpfcnpj) colarComMascara(docCredor(), est.credor.cpfcnpj);
    await sleep(400);

    const add = await esperarHabilitado(() => botaoAdicionarDe(SEL.credorValor), 8000);
    if (!add) { falhar(new Error('o "Adicionar" do credor não habilitou')); return false; }
    const antes = linhasCredores().length;
    add.click();
    await fecharAvisoEntendi();
    if (!(await esperar(() => linhasCredores().length > antes, 8000))) {
      falhar(new Error("cliquei em 'Adicionar' e o credor não entrou na tabela. Sem credor na "
        + "tabela a ordem não fecha — confira a tela.")); return false;
    }

    // Autor e Réu são mat-select alimentados pelas tabelas
    if (!(await escolherNoSelect(0, est.credor.nome))) {
      falhar(new Error(`não consegui escolher "${est.credor.nome}" na lista de Autor. Escolha na ` +
        `tela e siga a partir daí.`)); return false;
    }
    if (!(await escolherNoSelect(1, est.titulares[0].nome))) {
      falhar(new Error(`não consegui escolher "${est.titulares[0].nome}" na lista de Réu. Escolha ` +
        `na tela e siga a partir daí.`)); return false;
    }
    return true;
  }

  /* ═══ A DATA DA DÍVIDA ═══
   * O campo é readOnly e vive num mat-datepicker. Tentamos primeiro o setter
   * nativo com evento `input` (o MatDatepickerInput escuta input, e readOnly não
   * impede o evento). Se não fixar, navegamos o calendário — que é
   * determinístico, mas cujos meses vêm em INGLÊS mesmo com a tela em português. */
  const MESES_EN = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

  /* ⛔ A VERIFICAÇÃO HONESTA (campo 11/09): o campo é readOnly e o Angular só
     aceita a data no MODELO se ela vier do jeito certo (o calendário). O setter
     nativo escreve o `.value` visível, mas o modelo ignora — o campo fica
     `ng-invalid`/`aria-invalid="true"` e o credor entra SEM data (a página, que
     exige a data, é enganada pelo value). Então sucesso = data no `.value` E o
     campo VÁLIDO no modelo. Conferir só o `.value` foi o bug: era auto-realizável. */
  /* ⛔ NÃO contar dígitos. Quando o modelo ACEITA a data, o campo reformata para
     o padrão en-US SEM zero à esquerda ("5/31/2026" = 7 dígitos). Contar 8
     reprovava uma data perfeita (campo 11/09). O que importa é: o campo tem uma
     data (dia/mês/ano) E está VÁLIDO no modelo (aria-invalid="false"/não
     ng-invalid). O aria-invalid é o sinal do modelo; o .value sozinho mente
     (o setter escreve nele mesmo sem o Angular aceitar). */
  function dataNoModelo() {
    const el = document.querySelector(SEL.credorData);
    if (!el) return false;
    if (!/\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{4}/.test(el.value || "")) return false;
    if (el.getAttribute("aria-invalid") === "true") return false;
    if (el.classList && el.classList.contains("ng-invalid")) return false;
    return true;
  }

  async function preencherData(dataBR) {
    const [dd, mm, aaaa] = String(dataBR || "").split("/");
    if (!dd || !mm || !aaaa) return false;

    // 1) Atalho: setter nativo, e ESPERA o modelo assentar. O Material reformata e
    //    marca válido de forma assíncrona — conferir uma vez cedo dava falso
    //    negativo. Sucesso = dataNoModelo(), nunca o .value.
    const campo = document.querySelector(SEL.credorData);
    if (campo && !campo.disabled) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(campo, `${dd}/${mm}/${aaaa}`);
      campo.dispatchEvent(new InputEvent("input", { bubbles: true }));
      campo.dispatchEvent(new Event("change", { bubbles: true }));
      campo.dispatchEvent(new Event("blur", { bubbles: true }));
      if (await esperar(() => (dataNoModelo() ? true : null), 3000)) {
        console.log("CRATOS/SERASAJUD: data aceita pelo campo (modelo válido).");
        return true;
      }
      console.log("CRATOS/SERASAJUD: setter nativo não entrou no modelo — indo pelo calendário.");
    }

    // 2) Reserva: o calendário. Clicar o dia é como o usuário faz — crava a data
    //    no modelo. (meses em INGLÊS; célula = .mat-calendar-body-cell.)
    const toggle = document.querySelector("mat-datepicker-toggle button");
    if (!toggle) return false;
    toggle.click();

    // botão de período no cabeçalho -> visão multi-ano
    const periodo = await esperar(() => document.querySelector(".mat-calendar-period-button, button.mat-calendar-period-button"), 5000);
    if (!periodo) return false;
    periodo.click();

    if (!(await clicarNaCelula(String(parseInt(aaaa, 10))))) return false;
    if (!(await clicarNaCelula(MESES_EN[parseInt(mm, 10) - 1]))) return false;
    if (!(await clicarNaCelula(String(parseInt(dd, 10))))) return false;

    // honesto: espera o modelo assentar e confere a validade, não o formato
    return !!(await esperar(() => (dataNoModelo() ? true : null), 3000));
  }

  async function clicarNaCelula(texto) {
    const alvo = await esperar(() => {
      for (const c of document.querySelectorAll(".mat-calendar-body-cell")) {
        const t = (c.textContent || "").trim().toUpperCase();
        if (t === String(texto).toUpperCase() && !c.classList.contains("mat-calendar-body-disabled")) return c;
      }
      return null;
    }, 5000);
    if (!alvo) { console.warn("CRATOS/SERASAJUD: célula do calendário não achada:", texto); return false; }
    alvo.click();
    await sleep(400);
    return true;
  }

  /* mat-select: abrir, esperar o painel, escolher a opção pelo texto.
     Índice 0 = Autor, 1 = Réu (a ordem em que aparecem na tela). */
  async function escolherNoSelect(indice, textoOpcao) {
    const selects = document.querySelectorAll("mat-select");
    const sel = selects[indice];
    if (!sel) return false;
    sel.click();
    const opcao = await esperar(() => {
      for (const o of document.querySelectorAll("mat-option")) {
        if (norm(o.textContent) === norm(textoOpcao)) return o;
      }
      return null;
    }, 5000);
    if (!opcao) { fecharOverlay(); return false; }
    opcao.click();
    await sleep(400);
    return true;
  }

  function fecharOverlay() {
    const back = document.querySelector(".cdk-overlay-backdrop");
    if (back) back.click();
  }

  // ── Diálogos ──────────────────────────────────────────────────────────────
  /* "Entendi" é aviso e some com um clique. O de confirmação NÃO se toca — é
     onde paramos. Por isso o filtro é pelo texto do botão, não pela presença de
     diálogo. */
  async function fecharAvisoEntendi() {
    const btn = await esperar(() => {
      for (const d of document.querySelectorAll(SEL.dialogo)) {
        for (const b of d.querySelectorAll("button")) {
          if (norm(b.textContent) === "entendi") return b;
        }
      }
      return null;
    }, 3000);
    if (!btn) return false;
    btn.click();
    await sleep(500);
    return true;
  }

  function dialogoCom(regex) {
    for (const d of document.querySelectorAll(SEL.dialogo)) {
      if (regex.test(d.textContent || "")) return d;
    }
    return null;
  }

  // ── Seletores que dependem de escopo ──────────────────────────────────────
  /* ARMADILHA: "Baixar Dívida" é o texto da ABA e do BOTÃO DE ENVIO. Procurar
     por texto sem escopo clicaria na aba. O de envio é `button.btn.btn-azul`. */
  function botaoAzul(texto) {
    for (const b of document.querySelectorAll("button.btn-azul, button.btn.btn-azul")) {
      if (norm(b.textContent) === norm(texto) && visivel(b)) return b;
    }
    return null;
  }

  async function escolherAba(texto) {
    const aba = await esperar(() => {
      for (const t of document.querySelectorAll('.mdc-tab, [role="tab"]')) {
        if (norm(t.textContent) === norm(texto)) return t;
      }
      return null;
    }, 10000);
    if (!aba) return false;
    if (aba.getAttribute("aria-selected") !== "true") { aba.click(); await sleep(800); }
    return true;
  }

  /* O "Adicionar" certo é o MAIS PRÓXIMO do campo. Na baixa existem dois, com o
     mesmo texto: um dos titulares, outro dos credores. Subimos a árvore a partir
     do campo e paramos no primeiro ancestral que contenha um "Adicionar" — assim
     não dependemos de saber o nome do componente que envolve cada bloco.
     (Antes havia uma lista de componentes conhecidos e, quando nenhum casava, a
     busca caía no `document` inteiro e devolvia o botão do OUTRO bloco.) */
  function botaoAdicionarDe(seletorCampo) {
    const campo = typeof seletorCampo === "function" ? seletorCampo() : document.querySelector(seletorCampo);
    if (!campo) return null;
    let no = campo.parentElement;
    for (let i = 0; i < 8 && no; i++) {
      for (const b of no.querySelectorAll("button")) {
        if (norm(b.textContent) === "adicionar" && visivel(b)) return b;
      }
      no = no.parentElement;
    }
    return null;
  }

  /* O botão da home. O texto vem com a ligadura do ícone junto
     ("add_circle Cadastrar Ordem"), então casamos por CONTÉM e não por igual.
     Cuidado para não confundir com "Ordens Cadastradas", que é outra tela. */
  function botaoCadastrarOrdem() {
    if (location.pathname.includes(ROTA_CADASTRO)) return null;
    for (const b of document.querySelectorAll("button, a")) {
      const t = norm(b.textContent);
      if (t.includes("cadastrar ordem") && !t.includes("ordens cadastradas") && visivel(b)) return b;
    }
    return null;
  }

  function botaoPorTexto(texto) {
    for (const b of document.querySelectorAll("button")) {
      if (norm(b.textContent) === norm(texto) && visivel(b)) return b;
    }
    return null;
  }

  function linhasTitulares() { return linhasDeTabelaCom(["nome", "documento", "acoes"]); }
  function linhasCredores() { return linhasDeTabelaCom(["nome", "valor", "data da divida"]); }

  /* Lê as linhas de uma mat-table identificada pelos cabeçalhos. Descarta as
     linhas sem conteúdo — o recon mostra uma primeira linha vazia na leitura. */
  function linhasDeTabelaCom(cabecalhos) {
    for (const tab of document.querySelectorAll("table, mat-table, .mat-mdc-table")) {
      const cabs = Array.from(tab.querySelectorAll("th, mat-header-cell")).map((c) => norm(c.textContent));
      if (!cabecalhos.every((h) => cabs.some((c) => c.includes(h)))) continue;
      return Array.from(tab.querySelectorAll("tbody tr, mat-row"))
        .filter((tr) => (tr.textContent || "").trim().length > 0);
    }
    return [];
  }

  // ── Preenchimento ─────────────────────────────────────────────────────────
  async function escrever(achar, valor, opts) {
    const alvo = String(valor == null ? "" : valor);
    for (let t = 1; t <= 3; t++) {
      const el = achar();
      if (!el) { await sleep(400); continue; }
      if (opts && opts.mascarado) {
        colarComMascara(el, alvo);
      } else {
        el.focus();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, alvo);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        tecla(el, "keydown"); tecla(el, "keyup");
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.blur();
      }
      await sleep(350);
      const agora = (achar() || {}).value || "";
      /* Em campo de NOME, comparamos só letras e dígitos: o próprio SerasaJUD
         pode comer um ponto ou um hífen na hora de aceitar, e isso não é erro.
         A comparação continua sendo de IGUALDADE, não de prefixo — nome
         truncado pelo maxlength ainda reprova, como tem de ser. */
      const bate = opts && opts.mascarado
        ? digitos(agora) === digitos(alvo)
        : opts && opts.nome
          ? soAlfanum(agora) === soAlfanum(alvo)
          : norm(agora) === norm(alvo.slice(0, 55));
      if (bate) return true;
      console.warn(`CRATOS/SERASAJUD: campo não fixou (${t}/3). Esperado "${alvo}", está "${agora}".`);
    }
    return false;
  }

  /* Campo com máscara Angular só aceita PASTE de verdade — mesma receita que o
     RENAJUD e o SAB nos ensinaram. */
  function colarComMascara(el, valor) {
    if (!el) return false;
    const v = String(valor == null ? "" : valor).trim();
    el.focus();
    try { el.select(); } catch (e) {}
    try {
      const dt = new DataTransfer();
      dt.setData("text/plain", v);
      const ev = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt });
      const aceitou = !el.dispatchEvent(ev);
      if (!aceitou || !el.value) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(el, v);
        el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste", data: v }));
      }
    } catch (e) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
    return true;
  }

  function tecla(el, tipo) {
    try {
      el.dispatchEvent(new KeyboardEvent(tipo, { key: "0", keyCode: 48, which: 48, bubbles: true, cancelable: true }));
    } catch (e) { el.dispatchEvent(new Event(tipo, { bubbles: true })); }
  }

  // ── Utilidades ────────────────────────────────────────────────────────────
  function esperarHabilitado(acharFn, ms) {
    return esperar(() => {
      const el = acharFn();
      return el && !el.disabled && el.getAttribute("disabled") === null ? el : null;
    }, ms || 8000);
  }

  function esperar(fn, timeoutMs) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const tick = () => {
        let r = null;
        try { r = fn(); } catch (e) {}
        if (r) return resolve(r);
        if (Date.now() - t0 > (timeoutMs || 20000)) return resolve(null);
        setTimeout(tick, 200);
      };
      tick();
    });
  }

  async function esperarSumir(seletor, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < (ms || 15000)) {
      if (!Array.from(document.querySelectorAll(seletor)).some(visivel)) return true;
      await sleep(200);
    }
    return false;
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
  function digitos(s) { return String(s == null ? "" : s).replace(/\D/g, ""); }
  /* só letras e dígitos, sem acento e em minúsculas — para comparar nome escrito
     com nome aceito, ignorando pontuação que o site possa ter comido. */
  function soAlfanum(s) {
    return String(s == null ? "" : s).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  }
  function norm(s) {
    return String(s == null ? "" : s).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ").trim().toLowerCase();
  }
  function visivel(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function formatarDoc(d) {
    const x = digitos(d);
    if (x.length === 11) return x.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
    if (x.length === 14) return x.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
    return x || "(sem documento)";
  }
  function prazoEmDias(horas) {
    const h = parseInt(horas, 10);
    if (!h) return "(não informado)";
    const d = Math.round(h / 24);
    return d === 1 ? "1 dia" : `${d} dias`;
  }
  function dataDoIso(iso) {
    const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || "");
  }
  function dataBR() {
    const d = new Date(), p = (n) => String(n).padStart(2, "0");
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
  }
  function dataHoraBR() {
    const d = new Date(), p = (n) => String(n).padStart(2, "0");
    return `${dataBR()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function doisPrimeiros(nome) {
    return String(nome || "").trim().split(/\s+/).slice(0, 2).join(" ")
      .replace(/[\/\\:*?"<>|]/g, "");
  }

  function formatarProcesso(d) {
    const x = digitos(d);
    return x.length === 20
      ? `${x.slice(0, 7)}-${x.slice(7, 9)}.${x.slice(9, 13)}.${x.slice(13, 14)}.${x.slice(14, 16)}.${x.slice(16)}`
      : x;
  }
  /* Nomes em sequência até caber no limite — o campo Réu tem 55 caracteres e
     truncar no meio de um nome é pior que listar menos nomes. */
  function nomesEmSequencia(partes, max) {
    let saida = "";
    for (const p of partes) {
      const proximo = saida ? `${saida}, ${p.nome}` : p.nome;
      if (proximo.length > max) break;
      saida = proximo;
    }
    return saida || String((partes[0] || {}).nome || "").slice(0, max);
  }

  /* Delegação para comum/faixa.js — mesmo id de elemento de antes
     ("cratos-serasajud-aviso"); o que se ganha é o rastro do relatório. */
  function avisar(texto, cor) { return CratosFaixa.mostrar("serasajud", texto, cor); }

  function falhar(e) {
    const msg = (e && e.message) || String(e);
    CratosFaixa.parar("serasajud", msg);
    Store.get("serasajud_estado").then((est) => {
      if (est) Store.set("serasajud_estado", Object.assign({}, est, { fase: "erro", erro: msg }));
    }).catch(() => {});
  }

  /* Gancho de teste (jsdom): expõe o preenchimento da data para o harness, sem
     dirigir o fluxo inteiro. Não afeta produção. */
  if (typeof window !== "undefined") {
    window.__cratosSerasajud = { preencherData, dataNoModelo };
  }
})();
