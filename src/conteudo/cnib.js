/*
 * conteudo/cnib.js — content script do CNIB 2.0 (indisponibilidade.onr.org.br).
 *
 * ═══ O QUE MUDA EM RELAÇÃO AOS OUTROS CONVÊNIOS ═══
 * O CNIB é BLAZOR SERVER. Três consequências que mandam neste arquivo:
 *
 *  1. Não existe API de negócio — tudo trafega por WebSocket (SignalR). Dirigir
 *     o DOM é o único caminho possível, não é escolha de estilo.
 *  2. O SERVIDOR é dono do estado. Escrever em .value sem os eventos certos faz
 *     o Blazor re-renderizar e APAGAR o que escrevemos. Por isso todo campo é
 *     escrito e depois RELIDO (escrever() confere e repete até 3x). Sem isso o
 *     preenchimento "funciona" e o formulário vai vazio.
 *  3. A conexão CAI (confirmado no recon: overlay visível 2x, HTTP 503,
 *     "No Connection with that ID"). guardaConexao() congela a automação enquanto
 *     o overlay estiver na tela e RETOMA quando voltar — as duas quedas observadas
 *     se recuperaram sozinhas com o estado intacto. Só desiste no fim da linha.
 *
 * ═══ ESCOPO ═══
 * Prepara a ordem até o passo 4 e PARA. "Enviar Indisponibilidade" e a assinatura
 * com certificado são do usuário (a assinatura é UI nativa; nem haveria como).
 *
 * ═══ ARMADILHAS DO CNIB (custaram recon; não "consertar") ═══
 *  - #hasKnownDebit é o rótulo "NÃO" e #hasntKnownDebit é o "SIM". Os ids estão
 *    invertidos em relação ao que aparece na tela. Por isso marcamos por RÓTULO.
 *  - O botão de incluir executado é um <span class="btn-add-person"> sem texto,
 *    só com o ícone bi-plus-circle.
 *  - Depois de incluir, o CNIB NÃO limpa o campo do CPF/CNPJ. Limpar é por nossa
 *    conta — e no Blazor limpar também é evento.
 *  - O wizard tem 5 passos numa URL só e os <a> dos passos não têm classe de
 *    ativo: a detecção é por ELEMENTO-ÂNCORA (ver passoAtual()).
 */

(function iniciarCnib() {
  if (!/indisponibilidade\.onr\.org\.br/.test(location.host)) return;
  console.log("CRATOS/CNIB: content script ativo em", location.pathname);

  const LIMITE_RECONEXAO_MS = 3 * 60 * 1000;   // o próprio CNIB avisa "pode levar alguns minutos"
  const VALIDADE_ESTADO_MS = 30 * 60 * 1000;   // estado velho não dispara automação
  const ROTA_CADASTRO = "/ordem/cadastro";

  const SEL = {
    proc1: "#numberProcess1blazor",
    proc2: "#numberProcess2blazor",
    proc3: "#numberProcess3blazor",
    nomeProcesso: "#InputNomeProcesso",
    valor: "#InputValorDivida",
    cpfcnpj: "#txtCpfCnpjInputPerson",
    addPessoa: ".btn-add-person",
    confirmar: "#btnConfirm",
    prioridadeSim: "#isPriorityOrder",
    prioridadeNao: "#isNotPriorityOrder",
    reconectar: "#btnWaitReconnect",
    orgLogin: "#ddlOrganization",
    perfilLogin: "#ddlProfile",
    // baixa (cancelamento total)
    procBusca: "#txtProcessNumber",
    protocoloBusca: "#txtProtocol",
    pesquisar: "#searchButton",
    confirmarBaixa: "#confirmedButton",
    marcarOrdem: "input.orderCheck, input[name='ckbItem']",
    imprimirBaixa: "#hpkPrintCancellationDetail",
  };

  const ROTA_CANCELAMENTO = "/ordem/cancelamento/total";
  const ROTA_CONFIRMACAO = "/ordem/cancelar/confirmacao";
  const ROTA_DETALHE = "/ordem/cancelar/detalhe";

  /* ═══ JANELA DE IMPRESSÃO (popup) ═══════════════════════════════════════
     O "Imprimir" do comprovante ABRE UM POPUP com a mesma URL — foi o que o
     teste de 17/08 revelou depois que os popups foram liberados no Firefox.
     Consequências, as duas importantes:

     1. O popup é um documento próprio e o content script nasce nele também. Se
        deixarmos a automação rodar aqui, ele reconhece a rota de detalhe e
        clica "Imprimir" DE NOVO — abrindo outro popup, e outro. Foi exatamente
        o que aconteceu: 7 cliques em cascata. Por isso: em popup, NADA de
        automação. Só o título, e sai.
     2. É o título DESTE documento que vira o nome do "Salvar como PDF", e é
        aqui que o afterprint dispara — não na janela principal. Então o popup
        avisa a principal pelo storage quando a impressão termina.
     ══════════════════════════════════════════════════════════════════════ */
  if (window.opener) {
    console.log("CRATOS/CNIB: sou a janela de impressão — não automatizo nada aqui.");

    /* CORRIDA CONTRA O window.print(). O popup pode mandar imprimir assim que
       carrega, e o nome do arquivo é decidido a partir do document.title. Ler o
       título do storage é ASSÍNCRONO — se a impressão começa antes da leitura
       voltar, o Firefox já pegou "CNIB 2.0" e o nome sai errado (foi o que
       sobrou no teste de 17/08).
       Solução: pegar o título SÍNCRONO da janela que nos abriu — ela é do mesmo
       domínio e já está com o nome certo, porque a etapa do comprovante força o
       título dela antes de clicar em Imprimir. E registrar o beforeprint agora,
       não depois do await. O storage continua como reserva. */
    let tituloPdf = "";
    try {
      const doOpener = window.opener.document && window.opener.document.title;
      if (doOpener && /^CRATOS /.test(doOpener)) {
        tituloPdf = doOpener;
        document.title = tituloPdf;
        console.log("CRATOS/CNIB: título herdado da janela principal —", tituloPdf);
      }
    } catch (e) { /* opener fechado ou bloqueado: seguimos pelo storage */ }

    const reforcar = () => { if (tituloPdf && document.title !== tituloPdf) document.title = tituloPdf; };
    window.addEventListener("beforeprint", reforcar);   // registrado JÁ, sem esperar o storage
    const manterCedo = setInterval(reforcar, 100);
    setTimeout(() => clearInterval(manterCedo), 60000);

    Store.get("cnib_titulo_pdf").then((t) => {
      if (!t || !t.titulo) return;
      if (Date.now() - new Date(t.em || 0).getTime() > 10 * 60 * 1000) return;
      tituloPdf = t.titulo;              // confirma/atualiza o que veio do opener
      const forcar = () => { if (document.title !== t.titulo) document.title = t.titulo; };
      forcar();
      window.addEventListener("beforeprint", forcar);
      const manter = setInterval(forcar, 200);
      setTimeout(() => clearInterval(manter), 10 * 60 * 1000);
      window.addEventListener("afterprint", () => {
        clearInterval(manter);
        clearInterval(manterCedo);
        Store.set("cnib_impressao", { em: new Date().toISOString(), url: location.pathname })
          .catch(() => {});
        console.log("CRATOS/CNIB: impressão encerrada — avisei a janela principal.");
      }, { once: true });
      console.log("CRATOS/CNIB: janela de impressão renomeada (título com o nome do arquivo).");
    }).catch(() => {});
    return;   // <<< o popup PARA AQUI. Nada de rotear/automatizar.
  }

  // ── SEMPRE: grava a entidade escolhida no login ───────────────────────────
  // A vara não aparece em nenhuma tela do wizard — só no comprovante, depois de
  // assinada. Este é o único momento em que dá para saber onde a ordem vai cair.
  observarLogin();

  // ── Automação (só com estado ativo e recente) ─────────────────────────────
  Store.get("cnib_estado").then(async (est) => {
    if (!(await Store.ligada())) { console.log("CRATOS/CNIB: extensão desligada."); return; }
    if (!est || !est.ativo) return;
    const idade = Date.now() - new Date(est.abertoEm || 0).getTime();
    if (idade > VALIDADE_ESTADO_MS) {
      console.log("CRATOS/CNIB: estado antigo (%d min) — ignorando.", Math.round(idade / 60000));
      return;
    }
    if (est.operacao !== "inclusao" && est.operacao !== "baixa") return;
    rotear(est).catch((e) => falhar(e));
  }).catch((e) => console.warn("CRATOS/CNIB: erro ao ler estado:", e.message));

  /* Leva a aba até /ordem/cadastro. O CNIB é multi-página de verdade: se o
     usuário ainda não logou, esperamos (sem navegar em cima do login). */
  async function rotear(est) {
    const p = location.pathname;
    if (/^\/(login|home)?\/?$/.test(p) || p.startsWith("/login") || p.startsWith("/home") ||
        p.startsWith("/acesso-negado")) {
      console.log("CRATOS/CNIB: aguardando o login (certificado) para seguir.");
      return;   // ao chegar no dashboard o content script roda de novo
    }
    if (est.operacao === "inclusao") {
      if (p.startsWith(ROTA_CADASTRO)) return fluxoInclusao(est);
      return navegarUmaVez(est, ROTA_CADASTRO);
    }

    /* BAIXA: ao contrário da inclusão (wizard numa página só), aqui cada passo é
       uma PÁGINA NOVA — o content script morre e renasce a cada navegação. Então
       não existe "função longa": é máquina de estado, decidida pela ROTA a cada
       carregamento, com a memória no storage (protocolosFeitos). */
    /* Falha do ASSINADOR do ONR (/PadesSignature/AssinarDigital devolve uma
       exceção .NET de SSL). É servidor deles, não o CRATOS.
       >>> ATENÇÃO, LIÇÃO DE 17/08: essa tela de erro MENTE. No caso real o
       histórico da ordem registrou "Cancelamento total - Concluido" às 14:24:16,
       exatamente o horário do erro. Ou seja: o cancelamento FOI efetivado e a
       resposta é que se perdeu. Por isso NÃO dizemos "não foi registrado" —
       mandamos conferir o Histórico da Ordem antes de qualquer nova tentativa.
       Refazer às cegas é o único jeito de estragar isso. */
    if (p.startsWith("/PadesSignature")) {
      const corpo = norm(textoDaTela());
      const ehErro = corpo.includes("exception") || corpo.includes("ssl connection");
      avisar(ehErro
        ? "o assinador do ONR devolveu ERRO — mas isso NÃO quer dizer que falhou.\n" +
          "Já aconteceu de o cancelamento ser registrado mesmo com esta tela.\n\n" +
          "NÃO refaça direto: volte, pesquise o processo e abra o 'Histórico da\n" +
          "Ordem' (clique no protocolo). Se constar 'Cancelamento total -\n" +
          "Concluido', está feito — só falta o comprovante (Ordem > Segunda via)."
        : "tela do assinador do ONR.", ehErro ? "#ff6b6b" : "#facc15");
      console.warn("CRATOS/CNIB: erro no assinador do ONR — conferir o histórico " +
        "antes de repetir (o cancelamento pode ter sido efetivado assim mesmo).");
      return;
    }

    if (p.startsWith(ROTA_CANCELAMENTO)) return etapaPesquisaBaixa(est);
    if (p.startsWith(ROTA_CONFIRMACAO)) return etapaConfirmacaoBaixa(est);
    if (p.startsWith(ROTA_DETALHE)) return etapaComprovanteBaixa(est);
    return navegarUmaVez(est, ROTA_CANCELAMENTO);
  }

  /* Navega uma única vez por execução, para não entrar em laço se a rota alvo
     devolver para outro lugar (ex.: sessão expirada). */
  function navegarUmaVez(est, rota) {
    const marca = est.abertoEm + "|" + rota;
    if (sessionStorage.getItem("cratos_cnib_navegou") === marca) {
      console.warn("CRATOS/CNIB: já naveguei para", rota, "e não cheguei lá.");
      return;
    }
    sessionStorage.setItem("cratos_cnib_navegou", marca);
    console.log("CRATOS/CNIB: indo para", rota);
    location.assign(rota);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FLUXO DA INCLUSÃO
  // ══════════════════════════════════════════════════════════════════════════
  async function fluxoInclusao(est) {
    const c = est.config || {};

    // ── PASSO 1 — Enviar Processo ───────────────────────────────────────────
    if (!(await esperar(() => passoAtual() === 1, 40000))) {
      return falhar(new Error("a tela de cadastro de ordem do CNIB não abriu em 40 segundos. Se a sua "
        + "sessão caiu, entre de novo, abra o cadastro e execute outra vez."));
    }
    await guardaConexao();
    console.log("CRATOS/CNIB: passo 1 — preenchendo.");
    avisar("preenchendo o passo 1…", "#facc15");

    // Tipo do número: "Padronizado" (é o padrão, mas garantimos)
    marcarPorRotulo("TypeNumberProcess", "Padronizado");
    await sleep(300);

    // Número do processo em 3 campos: NNNNNNN-DD.AAAA | J.TR | OOOO
    const n = est.numeroDigitos;
    const p1 = `${n.slice(0, 7)}-${n.slice(7, 9)}.${n.slice(9, 13)}`;
    const p2 = `${n.slice(13, 14)}.${n.slice(14, 16)}`;
    const p3 = n.slice(16, 20);
    if (!(await escrever(SEL.proc1, p1))) return falhar(new Error("o CNIB não aceitou o número do processo: o primeiro campo não fixou o "
      + "valor. Confira a tela e execute de novo."));
    // O J.TR já vem preenchido pelo perfil; só mexemos se estiver diferente.
    if (digitos(valorDe(SEL.proc2)) !== digitos(p2)) await escrever(SEL.proc2, p2);
    if (!(await escrever(SEL.proc3, p3))) return falhar(new Error("o CNIB não aceitou o número do processo: os quatro últimos dígitos não "
      + "fixaram. Confira a tela e execute de novo."));

    // Nome do Processo (<select> nativo)
    if (!(await selecionarPorTexto(SEL.nomeProcesso, c.nomeProcesso))) {
      console.warn("CRATOS/CNIB: não achei a opção de Nome do Processo:", c.nomeProcesso);
    }
    await sleep(400);

    // Informar valor da dívida? — POR RÓTULO (ids invertidos, ver cabeçalho)
    marcarPorRotulo("KnowValue", c.informarValor ? "Sim" : "Não");
    await sleep(600);
    if (c.informarValor && c.valor) {
      if (!(await escrever(SEL.valor, c.valor, { porDigitos: true }))) {
        console.warn("CRATOS/CNIB: o campo de valor não fixou — confira à mão.");
      }
    }

    // Segredo de justiça: só mexe se soubermos de verdade (null = não sei)
    if (est.segredo === true || est.segredo === false) {
      marcarPorRotulo("SecretJustice", est.segredo ? "Sim" : "Não");
      await sleep(300);
    } else {
      console.log("CRATOS/CNIB: segredo de justiça não veio do PJe — deixando como está.");
    }

    // Executados, um a um
    const resumo = await incluirExecutados(est.executados);
    if (!resumo.ok) return falhar(new Error(resumo.motivo));

    console.log(`CRATOS/CNIB: ${resumo.incluidos} executado(s) na ordem. Confirmando o passo 1.`);
    await guardaConexao();
    // O Confirmar só é renderizado quando o formulário fica válido — esperamos
    // ele aparecer em vez de assumir que já está lá.
    if (!(await esperar(() => document.querySelector(SEL.confirmar), 20000))) {
      return falhar(new Error("o CNIB não habilitou o 'Confirmar' — algum campo " +
        "obrigatório dos dados do processo deve ter ficado vazio. Confira a tela."));
    }
    if (!clicar(SEL.confirmar)) return falhar(new Error("o 'Confirmar' saiu da tela antes que eu clicasse nele. Confira o "
      + "preenchimento do processo e execute de novo."));

    // ── PASSO 2 — Bens → indisponibilidade genérica ─────────────────────────
    if (!(await esperar(() => passoAtual() === 2, 60000))) {
      return falhar(new Error("o CNIB aceitou os dados do processo, mas não abriu a tela de bens em "
        + "1 minuto. Veja se ele devolveu alguma crítica na tela."));
    }
    await guardaConexao();
    const btnGenerica = botaoPorTexto("Continuar para indisponibilidade genérica");
    if (!btnGenerica) return falhar(new Error("não achei o botão 'Continuar para indisponibilidade genérica' na tela "
      + "de bens. Se ele estiver aí, siga à mão a partir deste ponto."));
    console.log("CRATOS/CNIB: passo 2 — seguindo pela genérica.");
    avisar("passo 2 — seguindo pela indisponibilidade genérica…", "#facc15");
    btnGenerica.click();

    // ── PASSO 4 — Ordem → prepara e PARA ────────────────────────────────────
    if (!(await esperar(() => passoAtual() === 4, 60000))) {
      return falhar(new Error("o CNIB não chegou na tela da ordem depois da indisponibilidade genérica. "
        + "Confira a tela e execute de novo."));
    }
    await guardaConexao();
    marcarPorRotulo("priorityOrder", c.priorizarPrenotacao ? "Sim" : "Não");
    await sleep(300);

    console.log("%cCRATOS/CNIB: ordem PREPARADA. Confira e clique 'Enviar Indisponibilidade' " +
      "e assine. Depois volte ao PJe e clique 'Concluí'.", "color:#4ade80;font-weight:bold");
    avisar("ordem PREPARADA. Confira, clique 'Enviar Indisponibilidade' e assine.\n" +
      "Depois volte ao PJe e clique 'Concluí'.", "#4ade80");
    await Store.set("cnib_estado", Object.assign({}, est, { fase: "preparado" }));

    // ── PASSO 5 — comprovante: abre os detalhes e manda imprimir ────────────
    vigiarProtocolo(est);
  }

  /* Laço dos executados. O CNIB não limpa o campo depois de incluir, então
     limpamos nós; e só avançamos quando a linha aparece DE FATO na tabela.
     Também é o ponto de retomada: se a conexão caiu no meio, os que já estão
     na tabela são pulados (comparação por dígitos do documento). */
  async function incluirExecutados(executados) {
    let incluidos = 0;
    for (const ex of executados) {
      await guardaConexao();
      const doc = digitos(ex.cpfcnpj);

      if (docsNaTabela().includes(doc)) {
        console.log("CRATOS/CNIB:", CratosMascara.nome(ex.nome), "já está na lista — pulando.");
        incluidos++;
        continue;
      }

      const antes = docsNaTabela().length;

      // 1) limpar (também é evento no Blazor) e conferir
      if (!(await escrever(SEL.cpfcnpj, ""))) {
        return { ok: false, motivo: "não consegui limpar o campo de CPF/CNPJ" };
      }
      // 2) escrever o documento; se a linha não entrar, tentamos formatado
      let entrou = await tentarIncluir(doc, antes);
      if (!entrou) {
        console.warn("CRATOS/CNIB: não entrou com dígitos puros; tentando formatado.");
        await escrever(SEL.cpfcnpj, "");
        entrou = await tentarIncluir(formatarDoc(doc), antes);
      }
      if (!entrou) {
        return {
          ok: false,
          motivo: `o executado ${ex.nome} (${formatarDoc(doc)}) não entrou na lista — ` +
                  `parei aqui para não montar ordem incompleta`,
        };
      }
      incluidos++;
      console.log("CRATOS/CNIB: incluído", CratosMascara.nome(ex.nome), `(${incluidos}/${executados.length})`);
      await sleep(400);
    }
    return { ok: true, incluidos };
  }

  async function tentarIncluir(texto, antes) {
    if (!(await escrever(SEL.cpfcnpj, texto, { porDigitos: true }))) return false;
    await guardaConexao();
    const btn = document.querySelector(SEL.addPessoa);
    if (!btn) { console.warn("CRATOS/CNIB: .btn-add-person não encontrado."); return false; }
    btn.click();
    // espera a TABELA crescer — nunca sleep fixo
    return !!(await esperar(() => docsNaTabela().length > antes, 20000));
  }

  /* Documentos já listados em "Adicionados por você" (colunas: Nome ou Razão
     Social | CPF ou CNPJ | Ações). */
  function docsNaTabela() {
    for (const t of document.querySelectorAll("table")) {
      const cabecalhos = Array.from(t.querySelectorAll("th")).map((th) => norm(th.textContent));
      if (!cabecalhos.some((h) => h.includes("cpf"))) continue;
      const idx = cabecalhos.findIndex((h) => h.includes("cpf"));
      const out = [];
      for (const tr of t.querySelectorAll("tbody tr")) {
        const tds = tr.querySelectorAll("td");
        if (!tds.length) continue;
        const bruto = tds[idx] ? tds[idx].textContent : tr.textContent;
        const d = digitos(bruto);
        if (d.length === 11 || d.length === 14) out.push(d);
      }
      return out;
    }
    return [];
  }

  /* Passo 5: quando o usuário enviar e assinar, aparece "Ordem Enviada com
     Sucesso". Aí abrimos "Ver Detalhes do Protocolo" e clicamos o Imprimir DO
     PRÓPRIO CNIB — igual ao RENAJUD: o documento oficial é o que os advogados
     conhecem, e iframe próprio no content script dá "operation is insecure". */
  function vigiarProtocolo(est) {
    let feito = false;
    const nomeParte = doisPrimeiros((est.executados[0] || {}).nome);
    const tenta = () => {
      if (feito || passoAtual() !== 5) return;
      feito = true;
      obs.disconnect(); clearInterval(poll);
      (async () => {
        await sleep(300);   // era 800 — settle mínimo do passo 5 (enxugado 03/09)
        const verDetalhes = botaoPorTexto("Ver Detalhes do Protocolo");
        if (verDetalhes) { verDetalhes.click(); await sleep(600); }   // era 1200

        const titulo = `CRATOS ${est.numProcesso}` +
          (nomeParte ? ` ${nomeParte}` : "") + " CNIB Inclusao";
        /* O nome do "Salvar como PDF" sai do document.title — mas o Firefox só o
           lê quando VOCÊ clica em Salvar, e isso pode levar um minuto. O Blazor
           reescreve o título nesse meio-tempo. Por isso seguramos o título por
           MUITO mais tempo (era 6s — curto demais na prática: no teste real o
           usuário levou ~40s na tela de impressão e o nome já tinha voltado a
           "CNIB 2.0"). Soltamos no afterprint ou após 10 min. */
        const forcar = () => { if (document.title !== titulo) document.title = titulo; };
        window.addEventListener("beforeprint", forcar);
        forcar();
        const manter = setInterval(forcar, 250);
        const soltar = () => { clearInterval(manter); window.removeEventListener("afterprint", soltar); };
        window.addEventListener("afterprint", () => setTimeout(soltar, 3000));
        setTimeout(soltar, 10 * 60 * 1000);

        // Guarda o título: se o CNIB abrir uma JANELA separada para imprimir, o
        // content script nasce lá também e usa isto para renomear aquele documento.
        try { await Store.set("cnib_titulo_pdf", { titulo, em: new Date().toISOString() }); } catch (e) {}

        /* ═══ O COMPROVANTE DA INCLUSÃO — recon de 20/08 ═══
         * O "Imprimir" do protocolo NÃO é mais um link: virou
         * `onclick="window.open('/relatorio/detalhe')"`. Sem `href`, o caminho
         * antigo (ler o href e baixar) nunca disparava, e sobrava o teatro do
         * document.title — que só funciona se o usuário fizer "Salvar como PDF"
         * na janela que abriu, à mão, antes de o Blazor reescrever o título.
         *
         * Agora fazemos o que a BAIXA já fazia: fetch same-origin do PDF e os
         * bytes para o background. Sem popup, sem corrida de título, nome nosso,
         * e — de quebra — o comprovante finalmente entra no diário da sessão,
         * de onde sai a certidão consolidada. Antes disto, a inclusão do CNIB era
         * invisível para o diário: ela não produzia download nenhum.
         *
         * O caminho vem do `onclick` quando dá para lê-lo; se não der, usamos o
         * que o recon mostrou. E se o fetch não devolver PDF, caímos no plano B
         * de sempre — clicar e segurar o título —, avisando que o nome virá do
         * servidor. */
        const imprimir = botaoPorTexto("Imprimir");
        const caminhoRelatorio = (() => {
          const onclick = imprimir && (imprimir.getAttribute("onclick") || "");
          const m = /window\.open\(\s*['"]([^'"]+)['"]/.exec(onclick || "");
          return (m && m[1]) || "/relatorio/detalhe";
        })();

        const nomeArquivo = `CRATOS/${digitos(est.numProcesso)}` +
          (nomeParte ? `_${nomeParte}` : "") + " CNIB Inclusao.pdf";

        /* ═══ A ORDEM DAS OPERAÇÕES É O QUE TORNA ISTO CERTEIRO ═══
         * LÊ O MODAL PRIMEIRO. Ler o DOM é local e não depende de rede: depois
         * que o modal está montado, não falha. Só então tentamos o PDF oficial.
         * Com os dois fatos na mão, decidimos:
         *   PDF de verdade  -> salva o OFICIAL (é a melhor prova);
         *   qualquer outra coisa -> fabrica a certidão com o que já foi lido.
         * Nos dois caminhos existe documento, e ele entra no diário. O buraco
         * antigo — fetch falhava calado e a execução terminava sem nada — era o
         * "muito raramente não puxa o documento". */
        const detalhes = await lerDetalhesEstavel();
        if (detalhes && !confereProcesso(detalhes.numProcesso, est.numProcesso)) {
          avisar("o modal de Detalhes mostra o processo " + detalhes.numProcesso +
            ", diferente do processo em execução (" + est.numProcesso + "). " +
            "Não vou certificar: confira a tela.", "#f87171");
          return;
        }

        const baixado = await baixarComprovante(caminhoRelatorio, nomeArquivo);

        if (baixado.ok) {
          avisar("ordem enviada e comprovante salvo como\n" + nomeArquivo +
            "\n\nEle já entra na certidão de convênios.", "#4ade80");
        } else if (detalhes) {
          const feita = await fabricarCertidaoOrdem(detalhes, "inclusao", est);
          if (feita.ok) {
            avisar("ordem enviada. O CNIB não entregou o comprovante em PDF (" +
              baixado.motivo + "), então emiti a CERTIDÃO com os dados da tela de " +
              "Detalhes:\n" + feita.filename + "\n\nEla entra na certidão de convênios. " +
              "A segunda via oficial continua disponível no CNIB.", "#facc15");
          } else {
            avisar("ordem enviada, mas NÃO consegui produzir documento nenhum: o " +
              "comprovante falhou (" + baixado.motivo + ") e a certidão também (" +
              feita.motivo + "). Protocolo " + detalhes.protocolo +
              " — salve a segunda via pela tela do CNIB.", "#f87171");
          }
        } else if (imprimir) {
          console.warn("CRATOS/CNIB: sem comprovante (" + baixado.motivo +
            ") e sem leitura do modal — caindo no 'Imprimir' da tela.");
          imprimir.click();
          avisar("ordem enviada. Não consegui baixar o comprovante nem ler a tela de " +
            "Detalhes, então abri o 'Imprimir' do CNIB: salve por lá.\n\nO nome do " +
            "arquivo vem do servidor, não do CRATOS.", "#facc15");
        } else {
          avisar("ordem enviada, mas não achei o 'Imprimir' nem consegui ler os " +
            "Detalhes da Ordem. Salve a segunda via pela tela do CNIB.", "#f87171");
        }
        await Store.set("cnib_estado", Object.assign({}, est, { ativo: false, fase: "enviado" }));
      })();
    };
    const obs = new MutationObserver(tenta);
    obs.observe(document.body, { childList: true, subtree: true });
    const poll = setInterval(tenta, 700);
    setTimeout(() => { obs.disconnect(); clearInterval(poll); }, 20 * 60 * 1000);
    console.log("CRATOS/CNIB: aguardando o comprovante (passo 5) para imprimir.");
  }


  // ══════════════════════════════════════════════════════════════════════════
  // FLUXO DA BAIXA — cancelamento TOTAL
  //
  // Uma ordem por vez: o CNIB só processa uma por operação, mesmo quando o
  // processo tem várias. O ciclo é
  //   pesquisa -> marca 1 ordem -> Confirmar -> [usuário envia e assina]
  //   -> detalhe: imprime -> afterprint -> "Cancelar Outra Ordem" -> pesquisa...
  // Quem dirige o laço é a DETECÇÃO DA ROTA a cada carregamento, não o nosso
  // clique: se o afterprint não vier, ou se o usuário voltar por conta própria,
  // o ciclo continua igual.
  // ══════════════════════════════════════════════════════════════════════════

  async function etapaPesquisaBaixa(est) {
    if (!(await esperar(() => document.querySelector(SEL.procBusca) &&
                              document.querySelector(SEL.pesquisar), 40000))) {
      return falhar(new Error("a tela de cancelamento total do CNIB não abriu em 40 segundos. Se a sua "
        + "sessão caiu, entre de novo e execute outra vez."));
    }
    await guardaConexao();
    avisar("procurando as ordens deste processo…", "#facc15");

    /* O campo desta tela guarda o número em DÍGITOS (a chamada do CNIB é
       .../GetOrdersToBeTotallyCancelled/00000011120215180008/...), então é por
       aí que começamos. E o "Pesquisar" NASCE DESABILITADO: preencher não basta,
       a validação da página precisa acordar. Escalonamos até ele habilitar —
       clicar num botão cinza não faz nada e é assim que a execução de 17/08
       ficou parada sem erro nenhum. */
    if (!(await escrever(SEL.procBusca, est.numeroDigitos, { porDigitos: true }))) {
      return falhar(new Error("não consegui preencher o nº do processo na busca"));
    }
    let btnPesquisar = await esperarHabilitado(SEL.pesquisar, 5000);
    if (!btnPesquisar) {
      console.warn("CRATOS/CNIB: Pesquisar continua cinza — digitando caractere a caractere.");
      await digitar(SEL.procBusca, est.numeroDigitos);
      btnPesquisar = await esperarHabilitado(SEL.pesquisar, 8000);
    }
    if (!btnPesquisar) {
      await digitar(SEL.procBusca, est.numProcesso);   // última tentativa: formatado
      btnPesquisar = await esperarHabilitado(SEL.pesquisar, 8000);
    }
    if (!btnPesquisar) {
      return falhar(new Error("o botão 'Pesquisar' não habilitou — o CNIB não aceitou o " +
        "número do processo. Confira o campo na tela; nada foi pesquisado."));
    }

    /* A mensagem de "não localizado" fica presa ao campo: se já estava na tela
       antes do clique, ela não prova nada sobre ESTA pesquisa. */
    const naoLocalizadoAntes = processoNaoLocalizado();
    btnPesquisar.click();
    const desfecho = await esperar(() => desfechoPesquisaBaixa(naoLocalizadoAntes), 25000);
    if (desfecho !== "ordens") return concluirPesquisaSemOrdens(est, desfecho, naoLocalizadoAntes);

    const ordens = lerOrdens();

    const feitos = est.protocolosFeitos || [];
    const pendentes = ordens.filter((o) => !feitos.includes(o.protocolo));
    if (!pendentes.length) {
      avisar(`pronto: as ${ordens.length} ordem(ns) deste processo já foram preparadas ` +
             `nesta execução.`, "#4ade80");
      return encerrar(est, "concluido");
    }

    /* Guarda de organização: ordem registrada por OUTRA vara não é marcada
       sozinha. Hoje é caso residual (o vínculo processo→vara resolve), mas o
       resíduo existe e cancelar ordem alheia é grave. */
    const org = (await Store.get("cnib_organizacao")) || null;
    const daVara = org && org.nome
      ? pendentes.filter((o) => !o.organizacao || mesmoOrgao(o.organizacao, org.nome))
      : pendentes;

    if (!daVara.length) {
      avisar(`há ${pendentes.length} ordem(ns) pendente(s), mas nenhuma da vara logada ` +
             `(${org && org.nome}). Não vou marcar por você — confira e faça à mão.`, "#ff6b6b");
      return encerrar(est, "organizacao_divergente");
    }
    if (daVara.length < pendentes.length) {
      console.warn("CRATOS/CNIB: ignorando", pendentes.length - daVara.length,
        "ordem(ns) de outra organização.");
    }

    /* Ordem JÁ CANCELADA volta na lista com o checkbox marcado e TRAVADO
       (confirmado no teste real de 17/08: o histórico mostrava "Cancelamento
       total - Concluido"). Não há o que fazer com ela — e insistir só levava ao
       "Confirmar não habilitou", que soava como defeito e não era. */
    const selecionaveis = daVara.filter((o) => o.check && !o.check.disabled);
    if (!selecionaveis.length) {
      const travadas = daVara.length;
      /* 1.6.2 (Rodrigo, 19/10): "já cancelada" também é "não há restrição ativa" —
         vira certidão, com os protocolos como prova. */
      const certidao = await fabricarCertidaoNadaACancelar(est, daVara.map((o) => o.protocolo));
      avisar(`nada a cancelar: ${travadas === 1 ? "a ordem deste processo já foi cancelada" :
        `as ${travadas} ordens deste processo já foram canceladas`} ` +
        `(o CNIB devolve com a caixa marcada e travada).` +
        (certidao.ok ? `\nCertidão gerada: ${certidao.filename}` : `\nNão consegui gerar a certidão (${certidao.motivo}).`),
        certidao.ok ? "#4ade80" : "#facc15");
      return encerrar(est, feitos.length ? "concluido" : (certidao.ok ? "ja_canceladas" : "ja_canceladas_sem_certidao"));
    }

    const alvo = selecionaveis[0];
    const indice = ordens.length - pendentes.length + 1;

    if (!alvo.check) return falhar(new Error("não consegui marcar a ordem " + alvo.protocolo + " para cancelamento: "
      + "a caixa de seleção dela não está disponível na lista. Se na tela ela "
      + "aparecer marcável, faça este cancelamento à mão."));
    if (!alvo.check.checked) alvo.check.click();
    await sleep(600);
    await guardaConexao();

    const botao = await esperar(() => {
      const b = document.querySelector(SEL.confirmarBaixa);
      return b && !b.disabled ? b : null;
    }, 15000);
    if (!botao) {
      return falhar(new Error("o 'Confirmar' não habilitou depois de marcar a ordem " + alvo.protocolo));
    }

    await Store.set("cnib_estado", Object.assign({}, est, {
      ordemAtual: { protocolo: alvo.protocolo, indice, total: ordens.length },
      totalOrdens: ordens.length,
    }));

    console.log(`CRATOS/CNIB: ordem ${alvo.protocolo} marcada (${indice}/${ordens.length}).`);
    botao.click();
  }

  /* Tela de confirmação: aqui o CRATOS PARA. "Enviar Cancelamento" e a
     assinatura com certificado são do usuário — a assinatura, aliás, é UI
     nativa. Não existe campo de "dados do advogado" neste perfil (o manual do
     TJBA menciona; na Justiça do Trabalho não aparece). */
  async function etapaConfirmacaoBaixa(est) {
    await guardaConexao();
    const a = est.ordemAtual || {};
    const posicao = a.total > 1 ? ` (${a.indice} de ${a.total})` : "";
    avisar(`ordem ${a.protocolo || ""} PREPARADA${posicao}.\n` +
           `Confira, clique 'Enviar Cancelamento' e assine. ` +
           `Depois eu imprimo e sigo para a próxima.`, "#4ade80");
    console.log("CRATOS/CNIB: confirmação da baixa na tela — parei aqui.");
  }

  /* Comprovante do cancelamento. Só chegamos aqui DEPOIS de o usuário enviar e
     assinar — por isso é este o momento de dar a ordem por concluída. */
  async function etapaComprovanteBaixa(est) {
    await guardaConexao();

    const atual = est.ordemAtual || null;
    const feitos = (est.protocolosFeitos || []).slice();
    if (atual && atual.protocolo && feitos.indexOf(atual.protocolo) < 0) {
      feitos.push(atual.protocolo);
    }
    const novo = Object.assign({}, est, { protocolosFeitos: feitos, ordemAtual: null });
    await Store.set("cnib_estado", novo);

    const nomeParte = doisPrimeiros(((est.executados || [])[0] || {}).nome);
    const titulo = `CRATOS ${est.numProcesso}` + (nomeParte ? ` ${nomeParte}` : "") + " CNIB Baixa";
    try { await Store.set("cnib_titulo_pdf", { titulo, em: new Date().toISOString() }); } catch (e) {}

    // Mesmo tratamento do título da inclusão: o Firefox lê o document.title na
    // hora em que VOCÊ salva, então seguramos até o afterprint.
    const forcar = () => { if (document.title !== titulo) document.title = titulo; };
    window.addEventListener("beforeprint", forcar);
    forcar();
    const manter = setInterval(forcar, 250);
    setTimeout(() => clearInterval(manter), 10 * 60 * 1000);

    /* Seguir para a próxima ordem. Pode vir de dois lugares: do afterprint desta
       janela (se a impressão acontecer aqui) ou do aviso que o POPUP grava no
       storage ao terminar. Guardado por uma trava, para acontecer uma vez só. */
    let seguiu = false;
    const seguirParaProxima = (origem) => {
      if (seguiu) return;
      seguiu = true;
      clearInterval(manter);
      if (typeof off === "function") off();
      setTimeout(() => {
        const outra = botaoPorTexto("Cancelar Outra Ordem");
        if (outra) {
          avisar("indo para a próxima ordem…", "#facc15");
          console.log("CRATOS/CNIB: impressão encerrada (" + origem + ") — 'Cancelar Outra Ordem'.");
          outra.click();
        } else {
          avisar("clique em 'Cancelar Outra Ordem' que eu preparo a próxima.", "#facc15");
        }
      }, 900);
    };
    const off = Store.onChange("cnib_impressao", () => seguirParaProxima("popup"));
    window.addEventListener("afterprint", () => seguirParaProxima("afterprint"), { once: true });

    /* UM comprovante por página, mesmo se ela recarregar. */
    if (sessionStorage.getItem("cratos_cnib_impresso") === location.pathname) {
      avisar("comprovante deste cancelamento já foi salvo.\n" +
             "Clique em 'Cancelar Outra Ordem' que eu preparo a próxima.", "#facc15");
      return;
    }

    const btn = await esperar(() => document.querySelector(SEL.imprimirBaixa) ||
                                    botaoPorTexto("Imprimir"), 15000);
    if (!btn) {
      avisar("não achei o 'Imprimir' do comprovante — salve à mão se precisar.", "#facc15");
      return;
    }
    sessionStorage.setItem("cratos_cnib_impresso", location.pathname);

    /* O "Imprimir" NÃO abre diálogo de impressão: é um link para um PDF pronto
       ("/relatorio/cancelamento/detalhe/{hash}") e o Firefox nomeia o arquivo
       pelo hash. Forçar document.title não adianta — isso só governa o
       "Imprimir em PDF", não um download do servidor.
       Então buscamos o PDF aqui (same-origin, com a sessão) e mandamos os bytes
       para o background salvar com o nome do CRATOS. De quebra, sem popup. */
    const nomeArquivo = "CRATOS/" + digitos(est.numProcesso) +
      (nomeParte ? "_" + nomeParte : "") + " CNIB Baixa.pdf";
    const salvo = await baixarComprovante(btn, nomeArquivo);

    if (salvo.ok) {
      avisar("cancelamento concluído — comprovante salvo como\n" + nomeArquivo +
             "\n\nSeguindo para a próxima ordem…", "#4ade80");
      seguirParaProxima("download");
    } else {
      /* Mesmo plano B da inclusão, com o leitor PRÓPRIO desta tela: ela não é o
         modal (sem `.ordem-card`, executados em `<span>`, processo em dígitos).
         HTML real conferido em 02/09. */
      const detalhes = await lerDetalhesEstavel(3, lerDetalhesCancelamento);
      if (detalhes && detalhes.mesmaOrdem === false) {
        /* Os dois protocolos da tela apontam para ordens diferentes. Não é
           impedimento de ato — o cancelamento já aconteceu —, mas a certidão
           ligaria uma coisa à outra sem base. Avisa e emite mesmo assim, com os
           dois protocolos à vista. */
        avisar("atenção: o protocolo do cancelamento (" + detalhes.protocolo +
          ") e o da ordem original (" + detalhes.protocoloOriginal + ") apontam para " +
          "ordens diferentes no CNIB. Confira a tela antes de usar a certidão.", "#facc15");
      }
      const feita = detalhes ? await fabricarCertidaoOrdem(detalhes, "baixa", est) : null;
      if (feita && feita.ok) {
        avisar("cancelamento concluído. O CNIB não entregou o comprovante (" +
               salvo.motivo + "), então emiti a CERTIDÃO com os dados da tela:\n" +
               feita.filename + "\n\nSeguindo para a próxima ordem…", "#facc15");
        seguirParaProxima("download");
      } else {
        console.warn("CRATOS/CNIB: não consegui baixar o comprovante (" + salvo.motivo +
          ") nem ler a tela — caindo para o clique normal.");
        avisar("cancelamento concluído, mas não consegui produzir o comprovante (" +
               salvo.motivo + ").\nAbri o download normal — o nome virá do servidor. " +
               "Confira se o arquivo abre.", "#f87171");
        btn.click();
      }
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
   * DETALHES DA ORDEM — leitura do modal (fonte da certidão de plano B)
   * ═══════════════════════════════════════════════════════════════════════════
   * O modal "Detalhes da Ordem" traz em HTML exatamente o que o comprovante em
   * PDF traz. É daqui que sai a certidão quando o PDF oficial não vier — e o
   * HAR de 02/09 provou que não existe JSON para grampear no CNIB: tudo que é
   * negócio viaja dentro do WebSocket do Blazor.
   *
   * TRÊS ARMADILHAS DESTE HTML. Todas derrubam a leitura ingênua "acha o
   * lblDescricao e pega o próximo lblValorDescricao":
   *  1. "Organização de Origem" NÃO usa `lblValorDescricao` — usa
   *     `lblOrganizacaoOrigemDescricao`. Varrer pela classe do valor perde
   *     exatamente a vara, que é quem identifica a ordem.
   *  2. No cartão do segredo de justiça o VALOR ("Não") tem classe de RÓTULO
   *     (`lblDescricao`) — ali o título do cartão é a pergunta.
   *  3. "Status da Ordem" e "Status da Criação da Ordem" são GÊMEOS: os mesmos
   *     quatro rótulos. Sem escopo por cartão o segundo sobrescreve o primeiro,
   *     em silêncio. Mesma família do `#mat-input-5` do CENSEC.
   * A regra que atravessa as três: **não procurar o valor pela classe dele**, e
   * sim pelo BLOCO `.col-N` que contém o par — rótulo primeiro, valor por
   * último, qualquer que seja a classe.
   */
  const SEL_DETALHE = "div.order-detail-modal-body";

  function _n(s) {
    return String(s == null ? "" : s).replace(/\s+/g, " ").trim()
      .normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }
  function _txt(el) {
    return el ? String(el.textContent || "").replace(/\s+/g, " ").trim() : "";
  }
  function _cartao(raiz, titulo) {
    const alvo = _n(titulo);
    return Array.from(raiz.querySelectorAll(".ordem-card")).find((c) => {
      const t = c.querySelector("label.lblTitulo");
      return t && _n(t.textContent).startsWith(alvo);
    }) || null;
  }
  /* Pega o valor do par pelo BLOCO, não pela classe do valor. `closest` sobe até
     o `.col-N` (o `.col` interno não casa: não tem hífen). */
  function _campo(cartao, rotulo) {
    if (!cartao) return "";
    const alvo = _n(rotulo);
    const rot = Array.from(cartao.querySelectorAll("label.lblDescricao"))
      .find((l) => _n(l.textContent) === alvo);
    if (!rot || !rot.closest) return "";
    const bloco = rot.closest('[class*="col-"]');
    if (!bloco) return "";
    const labels = Array.from(bloco.querySelectorAll("label"));
    return labels.length > 1 ? _txt(labels[labels.length - 1]) : "";
  }
  /* Executados são TABELA, não pares: uma linha de cabeçalhos e depois os
     valores em `.col-4`. Aceita as duas formas possíveis (uma `.row` por
     executado, ou vários executados na mesma `.row`) fatiando de 3 em 3 —
     ⚠ só vimos modal de UM executado; com dois, conferir e apertar isto. */
  function _executados(raiz) {
    const cab = Array.from(raiz.querySelectorAll("label.lblTitulo"))
      .find((l) => _n(l.textContent).startsWith("executado"));
    if (!cab || !cab.closest) return [];
    const out = [];
    let row = cab.closest(".row");
    row = row && row.nextElementSibling;
    for (; row; row = row.nextElementSibling) {
      if (!row.classList || !row.classList.contains("row")) break;
      const vals = Array.from(row.querySelectorAll("label.lblValorDescricao")).map(_txt);
      for (let i = 0; i + 1 < vals.length; i += 3) {
        out.push({ documento: vals[i], nome: vals[i + 1], status: vals[i + 2] || "" });
      }
    }
    return out;
  }

  /* Lê o modal inteiro. Devolve null se ele não estiver montado ou vier pela
     metade — "vazio" e "ainda não chegou" são a mesma coisa aos olhos do
     leitor, e certificar um modal pela metade seria pior que não certificar. */
  function lerDetalhesOrdem(doc) {
    const d = doc || document;
    const raiz = d.querySelector(SEL_DETALHE);
    if (!raiz) return null;
    const cDados = _cartao(raiz, "Dados da Ordem");
    const cStatus = _cartao(raiz, "Status da Ordem");
    const cCriacao = _cartao(raiz, "Status da Criação da Ordem");
    const cSegredo = _cartao(raiz, "Processo tramita sob segredo");
    const segredo = cSegredo
      ? _txt(Array.from(cSegredo.querySelectorAll("label"))
          .filter((l) => !/lblTitulo/.test(l.className))[0])
      : "";
    const dados = {
      numProcesso: _campo(cDados, "Número do Processo"),
      nomeProcesso: _campo(cDados, "Nome do Processo"),
      organizacao: _campo(cDados, "Organização de Origem"),
      status: _campo(cStatus, "Status"),
      aprovadoPor: _campo(cStatus, "Aprovado por"),
      dataAprovacao: _campo(cStatus, "Data de Aprovação"),
      protocolo: _campo(cStatus, "Protocolo"),
      statusCriacao: _campo(cCriacao, "Status"),
      dataCriacao: _campo(cCriacao, "Data de Aprovação"),
      protocoloCriacao: _campo(cCriacao, "Protocolo"),
      segredo,
      executados: _executados(raiz),
    };
    /* Mínimo para valer: protocolo, processo e ao menos um executado. */
    if (!dados.protocolo || !dados.numProcesso || !dados.executados.length) return null;
    return dados;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
   * A TELA DO CANCELAMENTO É OUTRA ESTRUTURA — não dá para reusar o leitor acima
   * ═══════════════════════════════════════════════════════════════════════════
   * (HTML real de 02/09, `/ordem/cancelar/detalhe/{id}/Total`.) Cinco diferenças,
   * e cada uma sozinha quebraria o leitor do modal:
   *  1. a raiz é `div.form-body-v5`, não `.order-detail-modal-body`;
   *  2. **não existe `.ordem-card`**: os blocos são um `label.lblTitulo` seguido
   *     de `.row`s até o próximo `<hr>`. Aqui se lê por SEÇÃO, não por cartão;
   *  3. o cartão se chama "Status da Ordem **de Cancelamento**";
   *  4. o número do processo vem em **DÍGITOS** (`00000022220145180008`), não
   *     mascarado — e "Nome do Processo" traz o nome da parte, não o tipo;
   *  5. os executados **não são tabela**: são `<span><strong>CNPJ: </strong>…`
   *     soltos dentro de um `div.form-group`, um par documento/nome por parte.
   * E não existe "Organização de Origem" nesta tela.
   */
  function _secao(raiz, titulo) {
    const alvo = _n(titulo);
    const tit = Array.from(raiz.querySelectorAll("label.lblTitulo"))
      .find((l) => _n(l.textContent).startsWith(alvo));
    if (!tit || !tit.closest) return [];
    const out = [];
    let el = (tit.closest(".row") || tit.parentElement);
    for (el = el && el.nextElementSibling; el; el = el.nextElementSibling) {
      if (el.tagName === "HR") break;
      if (el.querySelector && el.querySelector("label.lblTitulo")) break;
      out.push(el);
    }
    return out;
  }
  function _campoEm(elementos, rotulo) {
    const alvo = _n(rotulo);
    for (const el of elementos) {
      const rot = Array.from(el.querySelectorAll("label.lblDescricao"))
        .find((l) => _n(l.textContent) === alvo);
      if (!rot) continue;
      const bloco = (rot.closest && rot.closest('[class*="col-"]')) || el;
      const labels = Array.from(bloco.querySelectorAll("label"));
      if (labels.length > 1) return _txt(labels[labels.length - 1]);
    }
    return "";
  }
  /* Pares `<strong>CPF: </strong>valor`: o rótulo é o que vem antes dos dois
     pontos. Documento abre uma parte nova; nome/razão social preenche a atual. */
  function _executadosCancelamento(raiz) {
    const out = [];
    let atual = null;
    for (const sp of Array.from(raiz.querySelectorAll("span"))) {
      const forte = sp.querySelector("strong");
      if (!forte) continue;
      const rot = _n(forte.textContent).replace(/:\s*$/, "").trim();
      const valor = _txt(sp).replace(/^[^:]*:\s*/, "").trim();
      if (rot === "cpf" || rot === "cnpj") {
        atual = { documento: valor, nome: "", status: "" };
        out.push(atual);
      } else if ((rot === "nome" || rot === "razao social") && atual) {
        atual.nome = valor;
      }
    }
    return out;
  }

  function lerDetalhesCancelamento(doc) {
    const d = doc || document;
    const raiz = d.querySelector("div.form-body-v5") ||
                 d.querySelector("div.form-body-container-v5");
    if (!raiz) return null;

    const secCanc = _secao(raiz, "Status da Ordem de Cancelamento");
    if (!secCanc.length) return null;
    const secDados = _secao(raiz, "Dados da Ordem");
    const secCria = _secao(raiz, "Status da Criação da Ordem");
    const secSeg = _secao(raiz, "Processo tramita sob segredo");

    /* Como no modal, aqui o VALOR do segredo tem classe de rótulo. */
    let segredo = "";
    for (const el of secSeg) {
      const l = el.querySelector && el.querySelector("label.lblDescricao");
      if (l) { segredo = _txt(l); break; }
    }

    const dados = {
      numProcesso: _campoEm(secDados, "Número do Processo"),
      nomeProcesso: _campoEm(secDados, "Nome do Processo"),
      status: _campoEm(secCanc, "Status"),
      aprovadoPor: _campoEm(secCanc, "Aprovado por"),
      dataAprovacao: _campoEm(secCanc, "Data de Aprovação"),
      protocolo: _campoEm(secCanc, "Protocolo"),
      /* A ordem ORIGINAL pode ser de outra vara e de outro servidor — no caso de
         02/09 a inclusão era de Quirinópolis, de 2024, e o cancelamento é daqui.
         São fatos diferentes, e a certidão registra os dois. */
      statusCriacao: _campoEm(secCria, "Status"),
      criadoPor: _campoEm(secCria, "Aprovado por"),
      dataCriacao: _campoEm(secCria, "Data de Aprovação"),
      protocoloOriginal: _campoEm(secCria, "Protocolo"),
      segredo,
      aviso: _txt(raiz.querySelector(".text-danger")),
      executados: _executadosCancelamento(raiz),
    };
    if (!dados.protocolo || !dados.numProcesso || !dados.executados.length) return null;
    /* Os dois protocolos têm de apontar para a MESMA ordem. Se não apontarem, a
       tela está mostrando atos de ordens diferentes e a certidão sairia ligando
       coisas que não se ligam. Não bloqueia — a regra vem de três protocolos
       observados, não de documentação — mas avisa. */
    dados.ordem = ordemDoProtocolo(dados.protocolo);
    dados.ordemOriginal = ordemDoProtocolo(dados.protocoloOriginal);
    dados.mesmaOrdem = !dados.ordem || !dados.ordemOriginal ||
                       dados.ordem === dados.ordemOriginal;
    return dados;
  }

  function linhasCertidaoCancelamento(d) {
    const linhas = [
      "",
      "Protocolo do cancelamento: " + d.protocolo,
      "Processo: " + formatarProcesso(d.numProcesso),
      d.status ? "Situação: " + d.status : "",
      d.dataAprovacao ? "Data do cancelamento: " + d.dataAprovacao : "",
      d.aprovadoPor ? "Autorizado por: " + d.aprovadoPor : "",
      "",
      d.ordem ? "Ordem CNIB nº " + d.ordem : "",
      d.protocoloOriginal
        ? "Ordem de indisponibilidade cancelada — protocolo original: " + d.protocoloOriginal
        : "",
      d.dataCriacao ? "Data da ordem original: " + d.dataCriacao : "",
      d.criadoPor ? "Ordem original registrada por: " + d.criadoPor : "",
      d.segredo ? "Processo sob segredo de justiça: " + d.segredo : "",
      "",
      "Cancelamento em relação a:",
      "",
    ].filter((l) => l !== "");
    d.executados.forEach((e, i) => {
      linhas.push((i + 1) + ") " + (e.nome || "(sem nome informado)") + " - " + e.documento);
    });
    linhas.push("");
    linhas.push("Certidão emitida a partir da tela de detalhe do cancelamento do CNIB, " +
      "com os dados que o sistema apresentou nesta data.");
    return linhas;
  }

  /* ═══ ANATOMIA DO PROTOCOLO DO CNIB (explicada pelo Rodrigo, 02/09) ═══
   *     202609.0215.03600000-TA-513
   *     └─AAAAMM─┘ └DDHH┘ └─ordem─┘ └tipo┘ └seq┘
   * Cada ATO gera protocolo próprio — a inclusão um, o cancelamento outro (há
   * também o cancelamento parcial). O que ATRAVESSA a vida da ordem é o miolo:
   * o número da ORDEM. Os dois protocolos da ordem 03600000 o compartilham;
   * mudam a data/hora e o tipo (IA na indisponibilidade, TA no cancelamento
   * total). Por isso, na tela da INCLUSÃO, "Status da Ordem" e "Status da
   * Criação da Ordem" mostram o MESMO protocolo: ainda não houve outro ato.
   * "Status da Ordem" é o ato mais recente; "Status da Criação" é sempre a
   * inclusão.
   * >>> Inferido de três protocolos reais. Se um dia não casar, é aqui. */
  function ordemDoProtocolo(protocolo) {
    const m = /^\d{6}\.\d{4}\.(\d+)-/.exec(String(protocolo || "").trim());
    return m ? m[1] : "";
  }

  function formatarProcesso(n) {
    const x = digitos(n);
    if (x.length !== 20) return String(n || "");
    return x.slice(0, 7) + "-" + x.slice(7, 9) + "." + x.slice(9, 13) + "." +
           x.slice(13, 14) + "." + x.slice(14, 16) + "." + x.slice(16, 20);
  }

  /* Blazor redesenha: lê DUAS vezes e só aceita se as duas baterem. É a mesma
     doutrina do preenchimento ("escrever e RELER"), aplicada à leitura.
     `leitor` é a função da tela: modal da inclusão ou detalhe do cancelamento. */
  async function lerDetalhesEstavel(tentativas, leitor) {
    const ler = leitor || lerDetalhesOrdem;
    let anterior = null;
    for (let i = 0; i < (tentativas || 6); i++) {
      const agora = ler();
      if (agora && anterior && JSON.stringify(agora) === JSON.stringify(anterior)) return agora;
      anterior = agora;
      await sleep(250);   // era 400 — duas leituras iguais seguem sendo a trava; só o intervalo enxugou (03/09)
    }
    return null;
  }

  /* As linhas da certidão de plano B. Uma linha lógica por item: quem quebra
     linha é o gerarPDFTexto, nunca o módulo (lição da 0.3.2). */
  function linhasCertidaoCnib(d, operacao) {
    const ehBaixa = operacao === "baixa";
    const linhas = [
      "",
      "Protocolo: " + d.protocolo,
      /* Na inclusão os dois cartões trazem o mesmo protocolo — "Status da Ordem"
         é o ato mais recente e, recém-criada, o ato mais recente É a criação.
         Se divergirem, a ordem já sofreu outro ato: aí os dois entram, porque
         certificar como inclusão nova o que já foi cancelado seria falso. */
      (d.protocoloCriacao && d.protocoloCriacao !== d.protocolo)
        ? "Protocolo da criação da ordem: " + d.protocoloCriacao : "",
      "Processo: " + d.numProcesso,
      d.nomeProcesso ? "Nome do processo: " + d.nomeProcesso : "",
      "Órgão de origem: " + d.organizacao,
      "Situação da ordem: " + d.status,
      d.aprovadoPor ? "Aprovado por: " + d.aprovadoPor : "",
      d.dataAprovacao ? "Data de aprovação: " + d.dataAprovacao : "",
      d.segredo ? "Processo sob segredo de justiça: " + d.segredo : "",
      "",
      ehBaixa ? "Ordem cancelada em relação a:" : "Ordem de indisponibilidade em relação a:",
      "",
    ].filter((l) => l !== "");
    d.executados.forEach((e, i) => {
      linhas.push((i + 1) + ") " + e.nome + " - " + e.documento +
        (e.status ? " - " + e.status : ""));
    });
    linhas.push("");
    linhas.push("Certidão emitida a partir da tela de Detalhes da Ordem do CNIB, " +
      "com os dados que o sistema apresentou nesta data.");
    return linhas;
  }

  /* Busca o PDF do comprovante e devolve ao background para salvar nomeado.
     Fetch same-origin: o cookie de sessão vai junto, como se fosse o clique. */
  /* `alvo` pode ser um ELEMENTO (o link da baixa, que tem href) ou uma STRING
     com o caminho (a inclusão, cujo botão virou `window.open('/relatorio/detalhe')`
     e não tem href nenhum). Os dois acabam no mesmo lugar: fetch same-origin dos
     bytes e `cnib_salvar_pdf`. */
  async function baixarComprovante(alvo, filename) {
    try {
      const href = typeof alvo === "string"
        ? alvo
        : (alvo && alvo.getAttribute && alvo.getAttribute("href"));
      if (!href || href === "#") return { ok: false, motivo: "o botão não tem link de PDF" };
      const url = new URL(href, location.origin).href;
      const resp = await fetch(url, { credentials: "include" });
      if (!resp.ok) return { ok: false, motivo: "HTTP " + resp.status };
      const buf = await resp.arrayBuffer();
      const ct = resp.headers.get("content-type") || "";
      /* ⚠ A CONFERÊNCIA É POR MAGIC BYTES, NÃO POR TAMANHO NEM POR STATUS.
         A guarda anterior (`byteLength < 1000 && !/pdf/`) deixava passar
         QUALQUER coisa acima de 1 KB: uma página de erro do ONR, com 200 e
         text/html, virava um `.pdf` que não abre — e ninguém descobria até
         tentar juntar nos autos. É o mesmo critério que o INFOJUD já usa para
         distinguir o .zip da eFinanceira. */
      if (!ehPdf(buf)) {
        return { ok: false, motivo: "a resposta não é um PDF (" + (ct || "sem content-type") +
          ", " + buf.byteLength + " bytes)" };
      }
      /* `est` não existe neste escopo — lemos o estado aqui. O número do
         processo vai junto porque é a chave do diário da sessão. */
      let estAgora = {};
      try { estAgora = (await Store.get("cnib_estado")) || {}; } catch (e) {}
      const r = await browser.runtime.sendMessage({
        tipo: "cnib_salvar_pdf", base64: _base64(buf), filename,
        numProcesso: estAgora.numProcesso || null,
        operacao: estAgora.operacao || null,
      });
      if (r && r.ok) {
        console.log("CRATOS/CNIB: comprovante salvo ->", filename);
        return { ok: true };
      }
      return { ok: false, motivo: (r && r.erro) || "o background não salvou" };
    } catch (e) {
      return { ok: false, motivo: String(e.message || e) };
    }
  }

  /* Compara números de processo por DÍGITOS: a tela mostra mascarado, o estado
     guarda como veio. Se um dos dois estiver vazio, não bloqueia — a guarda
     existe para pegar divergência, não para inventar impedimento. */
  function confereProcesso(daTela, doEstado) {
    const a = digitos(daTela || ""), b = digitos(doEstado || "");
    if (!a || !b) return true;
    return a === b;
  }

  /* Fabrica a certidão a partir do modal. Manda numProcesso/convenio/operacao
     junto: sem esses três o `fabricar_pdf` baixa o arquivo mas NÃO registra no
     diário, e o documento fica invisível para a certidão consolidada e para a
     juntada — que é justamente o motivo de ele existir. */
  async function fabricarCertidaoOrdem(detalhes, operacao, est) {
    try {
      const nomeParte = doisPrimeiros((detalhes.executados[0] || {}).nome);
      const sufixo = operacao === "baixa" ? "CNIB Baixa (certidao)" : "CNIB Inclusao (certidao)";
      const filename = "CRATOS/" + digitos(detalhes.numProcesso || (est && est.numProcesso)) +
        (nomeParte ? "_" + nomeParte : "") + " " + sufixo + ".pdf";
      const titulo = operacao === "baixa"
        ? "CERTIDÃO DE CANCELAMENTO DE INDISPONIBILIDADE"
        : "CERTIDÃO DE ORDEM DE INDISPONIBILIDADE";
      const r = await browser.runtime.sendMessage({
        tipo: "fabricar_pdf",
        titulo,
        linhas: operacao === "baixa"
          ? linhasCertidaoCancelamento(detalhes)
          : linhasCertidaoCnib(detalhes, operacao),
        filename,
        numProcesso: (est && est.numProcesso) || detalhes.numProcesso,
        convenio: "CNIB",
        operacao: operacao === "baixa" ? "baixa" : "inclusao",
        detalhe: "protocolo " + detalhes.protocolo,
      });
      if (r && r.ok) return { ok: true, filename };
      return { ok: false, motivo: (r && r.erro) || "o background não gerou o PDF" };
    } catch (e) {
      return { ok: false, motivo: String(e.message || e) };
    }
  }

  /* "%PDF-" nos primeiros bytes. Alguns servidores mandam BOM ou espaços antes;
     por isso procuramos nos primeiros 8, não só na posição 0. */
  function ehPdf(buffer) {
    if (!buffer || !buffer.byteLength || buffer.byteLength < 5) return false;
    const b = new Uint8Array(buffer.slice(0, 12));
    let s = "";
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return s.indexOf("%PDF-") >= 0 && s.indexOf("%PDF-") <= 7;
  }

  /* ArrayBuffer -> base64, em blocos (String.fromCharCode estoura com arquivo
     grande se mandarmos tudo de uma vez). */
  function _base64(buffer) {
    const bytes = new Uint8Array(buffer);
    let bin = "";
    const passo = 0x8000;
    for (let i = 0; i < bytes.length; i += passo) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + passo));
    }
    return btoa(bin);
  }

  /* Linhas de ordem da tabela de resultado. Cada linha traz um "Histórico da
     Ordem" ANINHADO (tabela dentro da célula), então: só valem as linhas que
     tiverem o checkbox .orderCheck, e lemos apenas as células FILHAS DIRETAS. */
  function lerOrdens() {
    const out = [];
    for (const tabela of document.querySelectorAll("table")) {
      const cab = tabela.querySelector("thead tr");
      if (!cab) continue;
      const nomes = Array.from(cab.children).map((th) => norm(th.textContent));
      const iProto = nomes.findIndex((h) => h.includes("protocolo"));
      const iOrg = nomes.findIndex((h) => h.includes("organizacao"));
      if (iProto < 0) continue;

      for (const tr of tabela.querySelectorAll("tr")) {
        const check = tr.querySelector(SEL.marcarOrdem);
        if (!check) continue;
        const tds = Array.from(tr.children);
        const bruto = tds[iProto] ? tds[iProto].textContent : tr.textContent;
        const m = String(bruto).match(/\d{6}\.\d{4}\.\d+-[A-Z]{2}-\d+/);
        out.push({
          protocolo: m ? m[0] : null,
          organizacao: (iOrg >= 0 && tds[iOrg]) ? norm2(tds[iOrg].textContent) : "",
          check,
        });
      }
      if (out.length) return out.filter((o) => o.protocolo);
    }
    return [];
  }

  function mesmoOrgao(a, b) {
    const n = (x) => String(x || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[\u00ba\u00aa\u00b0]/g, "a")
      .replace(/[^a-z0-9 ]/gi, " ").replace(/\s+/g, " ").trim().toLowerCase();
    return n(a) === n(b);
  }

  /* ═══ PESQUISA DA BAIXA SEM ORDENS (1.6.2) ═══
   * Prints do Rodrigo (19/10): quando o processo não tem ordem, o CNIB mostra um
   * popup "Atenção! A ordem de indisponibilidade pesquisada não pertence a esta
   * instituição. Instituição de origem: Não identificada." e, embaixo do campo do
   * processo, "O número de processo informado não foi localizado em nossa base de
   * dados". O que DECIDE é a origem: "Não identificada" = não há ordem; uma
   * instituição COM NOME = há ordem ativa de outro órgão, e certificar "nada a
   * cancelar" seria falso. Regra de ferro: só a mensagem do campo (com o popup, se
   * houver, em "Não identificada") vira certidão; o resto é faixa. */
  function processoNaoLocalizado() {
    return /numero de processo informado nao foi localizado/.test(norm(textoDaTela()));
  }

  /* null = popup ausente; { naoIdentificada, origem } = popup na tela. */
  function popupOutraInstituicao() {
    const bruto = norm2(textoDaTela());
    if (!/nao pertence a esta instituicao/.test(norm(bruto))) return null;
    const m = bruto.match(/Institui[çc][ãa]o de origem:?\s*(.+?)\s*(?:\.\s|\.$|O cancelamento|Fechar|$)/i);
    const origem = m ? m[1].replace(/\.$/, "").trim() : "";
    return { naoIdentificada: !origem || /nao identificad/.test(norm(origem)), origem };
  }

  function desfechoPesquisaBaixa(naoLocalizadoAntes) {
    if (lerOrdens().length) return "ordens";
    if (popupOutraInstituicao()) return "popup";
    if (!naoLocalizadoAntes && processoNaoLocalizado()) return "nao_localizado";
    return null;
  }

  function fecharPopupCnib() {
    const b = Array.from(document.querySelectorAll('button, a, input[type=button], [role="button"]'))
      .find((c) => norm(c.textContent || c.value) === "fechar");
    if (b) { try { b.click(); } catch (e) {} }
    return !!b;
  }

  async function concluirPesquisaSemOrdens(est, desfecho, naoLocalizadoAntes) {
    if (!desfecho) {
      avisar("pesquisei e o CNIB não deu resposta que eu reconheça em 25 segundos (nem ordens, nem " +
        "“não localizado”). NADA foi certificado — confira a tela.", "#ff6b6b");
      return encerrar(est, "sem_resposta");
    }
    await sleep(500);                       // popup e mensagem do campo chegam juntos
    const pop = popupOutraInstituicao();
    if (pop && !pop.naoIdentificada) {
      fecharPopupCnib();
      avisar(`a ordem deste processo pertence a outra instituição (${pop.origem}). O cancelamento tem ` +
        "de ser feito por ela. Não certifiquei nada.", "#facc15");
      return encerrar(est, "outra_instituicao");
    }
    if (pop) fecharPopupCnib();
    const confirmado = await esperar(() => (!naoLocalizadoAntes && processoNaoLocalizado()) ? true : null, 3000);
    if (!confirmado) {
      avisar("o CNIB mostrou um aviso, mas não a mensagem “número de processo não localizado”. " +
        "NADA foi certificado — confira a tela.", "#ff6b6b");
      return encerrar(est, "sem_resposta");
    }
    const certidao = await fabricarCertidaoNadaACancelar(est, null);
    if (!certidao.ok) {
      avisar(`o CNIB não localizou o processo, mas não consegui gerar a certidão (${certidao.motivo}).`, "#facc15");
      return encerrar(est, "nada_a_cancelar_sem_certidao");
    }
    avisar("o CNIB não localizou ordem para este processo — nada a cancelar.\nCertidão gerada: " +
      certidao.filename, "#4ade80");
    return encerrar(est, "nada_a_cancelar");
  }

  /* Certidão de "não há ordem ativa a cancelar". `protocolos` = ordens que o CNIB
     devolveu já canceladas (caixa travada); null = processo não localizado. Vai ao
     diário como baixa/"nada_a_cancelar" — a consolidada separa esses convênios dos
     que cancelaram de fato. */
  async function fabricarCertidaoNadaACancelar(est, protocolos) {
    try {
      const nomeParte = doisPrimeiros(((est.executados || [])[0] || {}).nome);
      const filename = "CRATOS/" + digitos(est.numProcesso) + (nomeParte ? "_" + nomeParte : "") +
        " CNIB Baixa (nada a cancelar).pdf";
      const d = new Date(), p = (n) => String(n).padStart(2, "0");
      const hoje = `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
      const abertura = `Certifico e dou fé que, nesta data (${hoje}), procedi à pesquisa, na Central ` +
        `Nacional de Indisponibilidade de Bens (CNIB), de ordens de indisponibilidade vinculadas ao ` +
        `processo nº ${est.numProcesso}, para fins de cancelamento, e que `;
      const lista = (protocolos || []).filter(Boolean);
      const linhas = lista.length
        ? ["", abertura + (lista.length === 1
            ? "a ordem localizada consta como já cancelada no sistema, não havendo ordem de indisponibilidade ativa a cancelar:"
            : "as ordens localizadas constam como já canceladas no sistema, não havendo ordem de indisponibilidade ativa a cancelar:"),
           ""].concat(lista.map((pr, i) => `${i + 1}) Protocolo ${pr}`))
        : ["", abertura + "o sistema informou: “O número de processo informado não foi localizado em " +
            "nossa base de dados”. Não há, portanto, ordem de indisponibilidade ativa a cancelar."];
      linhas.push("", "Era o que me cumpria certificar.");
      const r = await browser.runtime.sendMessage({
        tipo: "fabricar_pdf",
        titulo: "CERTIDÃO DE PESQUISA NO CNIB — NADA A CANCELAR",
        linhas,
        filename,
        numProcesso: est.numProcesso,
        convenio: "CNIB",
        operacao: "baixa",
        detalhe: "nada_a_cancelar",
      });
      if (r && r.ok) return { ok: true, filename };
      return { ok: false, motivo: (r && r.erro) || "o background não gerou o PDF" };
    } catch (e) {
      return { ok: false, motivo: String(e.message || e) };
    }
  }

  async function encerrar(est, fase) {
    try { await Store.set("cnib_estado", Object.assign({}, est, { ativo: false, fase })); } catch (e) {}
    console.log("CRATOS/CNIB: encerrado —", fase);
    /* Pulso TERMINAL para o painel quando a baixa fecha LIMPA (não há mais ordem
       pendente = tudo cancelado nesta execução). O CNIB baixa tem nº de
       comprovantes desconhecido, então não conta certidões — sem este sinal, o
       painel só conclui pelo botão e a aba não fecha (campo, 03/09). "concluido"
       → ok:true → o painel avança e manda fechar a aba. "sem_resposta" e
       "outra_instituicao" NÃO emitem: a faixa fica e a aba aberta, para o usuário
       conferir. Aborto de verdade sai por `falhar` (ok:false → o painel TRAVA). */
    /* 1.6.2: "nada a cancelar" e "já canceladas" também fecham LIMPO — a certidão
       foi gerada, a fila pode seguir. Sem certidão (falha do PDF) não avança. */
    if ((fase === "concluido" || fase === "nada_a_cancelar" || fase === "ja_canceladas") && est && est.numProcesso) {
      try {
        await Store.set("orq_conv_feito", {
          convenio: "CNIB", numProcesso: est.numProcesso,
          operacao: est.operacao || "baixa", ok: true, em: Date.now(),
        });
      } catch (e) {}
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DETECÇÃO DE PASSO — por elemento-âncora.
  // Nem rota (os 5 passos vivem em /ordem/cadastro) nem classe do wizard
  // (os <a> dos passos não marcam o ativo). Ordem importa: 5 antes de 4.
  // ══════════════════════════════════════════════════════════════════════════
  function passoAtual() {
    if (/ordem enviada com sucesso/.test(norm(textoDaTela()))) return 5;
    if (visivelSel(SEL.prioridadeSim) || visivelSel(SEL.prioridadeNao)) return 4;
    if (botaoPorTexto("Continuar para indisponibilidade genérica")) return 2;
    // NÃO usar #btnConfirm como âncora: o CNIB só o RENDERIZA depois que o
    // formulário tem o mínimo preenchido (nº do processo + 1 executado). Usar
    // o botão aqui fazia o passo 1 nunca ser reconhecido — a tela ficava parada
    // até o timeout, sem preencher nada. Confirmado no recon de 17/08.
    if (visivelSel(SEL.cpfcnpj) && document.querySelector(SEL.proc1)) return 1;
    return 0;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BLAZOR — escrita com verificação, e guarda de reconexão
  // ══════════════════════════════════════════════════════════════════════════

  /* Escreve num campo e CONFERE. O Blazor re-renderiza a partir do estado do
     servidor: se o evento não subir, o valor some sem erro nenhum. Três
     tentativas e então falha explícita — melhor parar do que seguir no escuro.
     opts.porDigitos: compara só os dígitos (campo pode reformatar o que digitamos). */
  async function escrever(seletor, valor, opts) {
    const alvo = String(valor == null ? "" : valor);
    const porDigitos = !!(opts && opts.porDigitos);
    for (let tentativa = 1; tentativa <= 3; tentativa++) {
      await guardaConexao();
      const el = document.querySelector(seletor);
      if (!el) { await sleep(500); continue; }

      el.focus();
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, alvo);
      disparar(el, "input");
      /* keyup: as telas antigas do CNIB (busca do cancelamento) validam no
         teclado, não no input/change — sem isto o "Pesquisar" fica cinza mesmo
         com o campo preenchido. Custa nada e o Blazor ignora. */
      tecla(el, "keydown");
      tecla(el, "keyup");
      disparar(el, "change");
      el.blur();
      await sleep(450);   // ida e volta ao servidor

      const agora = valorDe(seletor);
      const bate = porDigitos
        ? digitos(agora) === digitos(alvo)
        : norm(agora) === norm(alvo);
      if (bate) return true;
      console.warn(`CRATOS/CNIB: ${seletor} não fixou (tentativa ${tentativa}/3). ` +
        `Esperado "${alvo}", está "${agora}".`);
      await sleep(500);
    }
    return false;
  }

  function disparar(el, tipo) {
    el.dispatchEvent(new Event(tipo, { bubbles: true }));
  }

  function tecla(el, tipo, ch) {
    const k = ch || "0";
    try {
      el.dispatchEvent(new KeyboardEvent(tipo, {
        key: k, code: "Digit0", keyCode: 48, which: 48, bubbles: true, cancelable: true,
      }));
    } catch (e) { disparar(el, tipo); }
  }

  /* Digitação caractere a caractere, com eventos de teclado a cada tecla. É o
     escalonamento para quando escrever() preenche mas a validação da página não
     acorda (foi o caso do "Pesquisar" da baixa). Mais lento; só usamos se o
     caminho rápido não habilitar o que precisamos. */
  async function digitar(seletor, texto) {
    const el = document.querySelector(seletor);
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    el.focus();
    setter.call(el, "");
    disparar(el, "input");
    tecla(el, "keyup");
    for (const ch of String(texto == null ? "" : texto)) {
      tecla(el, "keydown", ch);
      setter.call(el, el.value + ch);
      disparar(el, "input");
      tecla(el, "keyup", ch);
      await sleep(20);
    }
    disparar(el, "change");
    el.blur();
    console.log("CRATOS/CNIB: digitei", seletor, "->", el.value);
    return true;
  }

  /* Espera um elemento existir E estar habilitado (o CNIB nasce com botões
     cinza e só os libera quando a validação dele aprova o campo). */
  function esperarHabilitado(seletor, ms) {
    return esperar(() => {
      const el = document.querySelector(seletor);
      return el && !el.disabled && el.getAttribute("disabled") === null ? el : null;
    }, ms || 8000);
  }

  /* Radio/checkbox no Blazor: click() de verdade. Marcar por RÓTULO, nunca por
     id — no CNIB os ids do grupo KnowValue estão invertidos. */
  function marcarPorRotulo(nomeGrupo, rotuloDesejado) {
    const alvo = norm(rotuloDesejado);
    const inputs = document.querySelectorAll(`input[type=radio][name="${nomeGrupo}"]`);
    for (const inp of inputs) {
      if (norm(rotuloDe(inp)) !== alvo) continue;
      if (!inp.checked) inp.click();
      console.log(`CRATOS/CNIB: ${nomeGrupo} = "${rotuloDesejado}" (id real: ${inp.id || "s/id"})`);
      return true;
    }
    console.warn(`CRATOS/CNIB: não achei o rótulo "${rotuloDesejado}" no grupo ${nomeGrupo}.`);
    return false;
  }

  function rotuloDe(el) {
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l && norm(l.textContent)) return l.textContent;
    }
    const dentro = el.closest("label");
    if (dentro && norm(dentro.textContent)) return dentro.textContent;
    const irmao = el.parentElement && el.parentElement.querySelector("label");
    return irmao ? irmao.textContent : "";
  }

  async function selecionarPorTexto(seletor, texto) {
    const el = document.querySelector(seletor);
    if (!el) return false;
    const alvo = norm(texto);
    for (const o of el.options) {
      if (norm(o.textContent) !== alvo) continue;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, o.value);
      disparar(el, "change");
      await sleep(400);
      return true;
    }
    return false;
  }

  function clicar(seletor) {
    const el = document.querySelector(seletor);
    if (!el) return false;
    el.click();
    return true;
  }

  function botaoPorTexto(texto) {
    const alvo = norm(texto);
    const cands = document.querySelectorAll('button, a, input[type=submit], input[type=button], [role="button"]');
    for (const c of cands) {
      const t = norm(c.textContent) || norm(c.value);
      if (t === alvo && visivel(c)) return c;
    }
    for (const c of cands) {
      const t = norm(c.textContent) || norm(c.value);
      if (t.includes(alvo) && visivel(c)) return c;
    }
    return null;
  }

  /* ── Guarda de reconexão ────────────────────────────────────────────────────
     O CNIB tem overlay próprio (não é o components-reconnect-modal padrão do
     Blazor): "Houve falha na conexão com a internet..." + botões Sair e
     Aguardar (#btnWaitReconnect). Nas duas quedas observadas no recon ele
     reconectou sozinho e o estado do wizard sobreviveu — por isso ESPERAMOS.
     Não clicamos em "Aguardar" (é automático) nem em "Sair" (é destrutivo). */
  function reconectando() {
    if (visivelSel(SEL.reconectar)) return true;
    return /estamos tentando reestabelecer|falha na conexao com a internet/.test(
      norm(textoDaTela()));
  }

  async function guardaConexao() {
    if (!reconectando()) return true;
    console.warn("CRATOS/CNIB: conexão caiu — automação CONGELADA, aguardando reconexão.");
    avisar("conexão do CNIB caiu — automação CONGELADA, aguardando reconectar (até 3 min).", "#facc15");
    const t0 = Date.now();
    while (Date.now() - t0 < LIMITE_RECONEXAO_MS) {
      await sleep(1000);
      if (!reconectando()) {
        await sleep(2000);   // deixa o Blazor terminar de re-renderizar
        console.log("CRATOS/CNIB: reconectado — retomando (relendo a tela).");
        avisar("reconectado — retomando de onde parou.", "#facc15");
        return true;
      }
    }
    throw new Error("o CNIB não reconectou em 3 minutos — o que foi preenchido " +
      "provavelmente se perdeu; recarregue a página e execute de novo");
  }

  /* Faixa visível na própria página. O primeiro teste real travou e a única
     pista estava no console — que ninguém deixa aberto. Agora o estado da
     automação aparece na tela. */
  /* Delegação para a faixa compartilhada (comum/faixa.js). Antes cada content
     script tinha a sua cópia; a cópia local ficou sem o rastro do relatório de
     problema, que só existe no funil comum. O id do elemento é o mesmo
     ("cratos-cnib-aviso"), então nada muda na tela nem nos testes. */
  function avisar(texto, cor) { return CratosFaixa.mostrar("cnib", texto, cor); }

  function falhar(e) {
    const msg = (e && e.message) || String(e);
    CratosFaixa.parar("cnib", msg);
    Store.get("cnib_estado").then((est) => {
      if (est) Store.set("cnib_estado", Object.assign({}, est, {
        fase: "erro", erro: String(msg),
      }));
      /* Pulso de DESISTÊNCIA para o painel: CNIB é ATO, então lá isso TRAVA a
         fila (não se atropela ordem/penhora pela metade). O sucesso NÃO passa
         por aqui — vem do comprovante registrado no background. */
      if (est && est.numProcesso) {
        Store.set("orq_conv_feito", {
          convenio: "CNIB", numProcesso: est.numProcesso,
          operacao: est.operacao || null,
          feitos: 0, esperados: (est.executados && est.executados.length) || 1,
          ok: false, motivo: msg, em: Date.now(),
        }).catch(() => {});
      }
    }).catch(() => {});
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LOGIN — registra a entidade escolhida (única chance de saber a vara)
  // ══════════════════════════════════════════════════════════════════════════
  function observarLogin() {
    const registrar = () => {
      const sel = document.querySelector(SEL.orgLogin);
      if (!sel || !sel.value) return;
      const opt = sel.selectedOptions && sel.selectedOptions[0];
      const nome = opt ? norm2(opt.textContent) : "";
      if (!nome || /^entidade$/i.test(nome)) return;
      const perfilSel = document.querySelector(SEL.perfilLogin);
      const perfil = perfilSel && perfilSel.selectedOptions[0]
        ? norm2(perfilSel.selectedOptions[0].textContent) : "";
      Store.set("cnib_organizacao", {
        id: sel.value, nome, perfil, em: new Date().toISOString(),
      }).then(() => console.log("CRATOS/CNIB: entidade registrada —", nome))
        .catch(() => {});
    };
    document.addEventListener("change", (ev) => {
      if (ev.target && ev.target.id === "ddlOrganization") setTimeout(registrar, 100);
    }, true);
    document.addEventListener("click", (ev) => {
      const b = ev.target && ev.target.closest ? ev.target.closest("#btnSelecionar") : null;
      if (b) registrar();
    }, true);
  }

  // ── utilidades ────────────────────────────────────────────────────────────
  function esperar(fn, timeoutMs) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const tick = () => {
        let r = null;
        try { r = fn(); } catch (e) {}
        if (r) return resolve(r);
        if (Date.now() - t0 > (timeoutMs || 20000)) return resolve(null);
        setTimeout(tick, 300);
      };
      tick();
    });
  }
  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
  /* innerText é o certo (só texto renderizado), mas não existe fora do navegador
     — em ambiente de teste caímos para textContent. Nunca é o caminho no Firefox. */
  function textoDaTela() {
    const b = document.body;
    if (!b) return "";
    const t = b.innerText;
    if (typeof t === "string" && t.length) return t;
    return b.textContent || "";
  }

  function norm(s) {
    return String(s == null ? "" : s).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ").trim().toLowerCase();
  }
  function norm2(s) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim(); }
  function digitos(s) { return String(s == null ? "" : s).replace(/\D/g, ""); }
  function valorDe(seletor) {
    const el = document.querySelector(seletor);
    return el ? el.value : "";
  }
  function visivel(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function visivelSel(seletor) { return visivel(document.querySelector(seletor)); }
  function doisPrimeiros(nome) {
    return String(nome || "").trim().split(/\s+/).slice(0, 2).join(" ")
      .replace(/[\/\\:*?"<>|]/g, "");
  }
  function formatarDoc(d) {
    const x = digitos(d);
    if (x.length === 11) return x.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
    if (x.length === 14) return x.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
    return x;
  }

  /* Gancho de teste. Content script roda em MUNDO ISOLADO: a página não enxerga
     isto (é o mesmo motivo por que o `window.alert` do content script nunca
     funcionou no eCAC). Exposto de propósito, para o harness exercitar as
     funções REAIS em vez de uma cópia — cópia testada é teste de si mesmo. */
  window.__cratosCnib = {
    lerDetalhesOrdem, linhasCertidaoCnib, ehPdf, confereProcesso,
    fabricarCertidaoOrdem, _cartao, _campo, _executados,
    lerDetalhesCancelamento, linhasCertidaoCancelamento, formatarProcesso,
    ordemDoProtocolo,
    _secao, _campoEm, _executadosCancelamento,
    processoNaoLocalizado, popupOutraInstituicao, desfechoPesquisaBaixa,
    concluirPesquisaSemOrdens, fabricarCertidaoNadaACancelar, encerrar,
  };
})();
