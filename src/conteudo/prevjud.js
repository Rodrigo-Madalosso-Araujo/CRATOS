/*
 * conteudo/prevjud.js — content script do PREVJUD (previdenciario.pdpj.jus.br), Dossiê
 * Previdenciário.
 *
 * ═══ COMO ANDA ═══
 *   1. injeta o grampo de LEITURA (conteudo/prevjud-api.js);
 *   2. vai ao /dossie-previdenciario e espera o formulário (o login é seu);
 *   3. digita o nº do processo e, para cada executado pessoa física, o CPF → SOLICITAR
 *      (um protocolo por CPF; a resposta é ligada ao CPF pelo próprio pedido, e o que não
 *      responder a tempo é achado pela lista de pedidos);
 *   4. espera até 15 min, clicando em atualizar a cada 30 s, até cada pedido ficar
 *      FINALIZADO;
 *   5. para cada pronto: "Visualizar" → a página busca o dossiê e os PDFs oficiais
 *      (pdfBase64); o CRATOS salva os PDFs dos documentos ligados nas Preferências;
 *   6. certidão (por CPF e documento) + pulso terminal ao painel; fecha a aba.
 *   O que não ficar pronto vai na certidão como "em processamento" e fica registrado
 *   para o "Coletar PREVJUD" (modo coleta: os passos 4–6 de novo). Sem pedido anotado, a
 *   coleta procura na lista do PREVJUD pelo nº do processo: por CPF, o pedido mais recente
 *   já pronto dos últimos 7 dias (1.8.1).
 *
 * ═══ REGRAS QUE NÃO SE DOBRAM ═══
 *  - SÓ o Dossiê Previdenciário. `clicarSeguro` recusa dossiê médico, processo
 *    administrativo, penhora, implantação, intimação, bloqueio, restrição. Em tela fora
 *    do escopo, o CRATOS não age.
 *  - "Sem resposta positiva" só quando o PREVJUD/INSS DIZ que não há (404 ou mensagem
 *    do INSS no dossiê). Documento que não chegou sem explicação = "não disponibilizado
 *    nesta consulta" — NUNCA negativa (regra de ferro).
 *  - Nada do JSON do dossiê vai para a certidão (LGPD): só pedido, protocolo, situação
 *    e documentos. Os PDFs vão como vieram.
 *  - HTML: este script não monta HTML (faixa por textContent).
 */
(function iniciarPrevjud() {
  if (!/(^|\.)previdenciario\.pdpj\.jus\.br$/i.test(location.hostname)) return;
  console.log("CRATOS/PREVJUD: content script ativo em", location.pathname);

  const VALIDADE_MS = 60 * 60 * 1000;
  const ESPERA_FORM_MS = 10 * 60 * 1000;
  const ESPERA_SOLICITAR_MS = 90 * 1000;         // o PREVJUD vai à Dataprev (21/10: >30 s)
  const ESPERA_BOTAO_MS = 2 * 60 * 1000;
  const ESPERA_LISTA_MS = 20 * 1000;
  const FOLGA_RELOGIO_MS = 5 * 60 * 1000;
  const PRAZO_COLETA_MS = 7 * 24 * 60 * 60 * 1000;  // decisão do Rodrigo, 21/10
  const ESPERA_TOTAL_MS = 15 * 60 * 1000;      // decisão do Rodrigo, 21/10
  const ESPERA_COLETA_MS = 90 * 1000;
  const INTERVALO_ATUALIZAR_MS = 30 * 1000;
  const ESPERA_VISUALIZAR_MS = 40 * 1000;
  const QUIETO_MS = 1500;                        // silêncio depois que TUDO terminou (pedido em sequência)
  const MIN_DOCS_MS = 1000;
  const ESPERA_SEM_INICIO_MS = 8000;             // nenhum documento começou: espera isto antes de desistir
  const ESPERA_DOCS_MS = 60 * 1000;              // teto por pessoa
  const TENTATIVAS_DOSSIE = 3;                   // o PREVJUD responde 503 de vez em quando (recon 22/10)
  const PAUSA_REABRIR_MS = 3000;
  const PAUSA_ANTES_DE_FECHAR_MS = 2500;
  const PASSO_MS = 500;
  const AVISO_CORTINA = "O CRATOS está pedindo o Dossiê Previdenciário no PREVJUD. Aguarde — não feche nem clique nesta aba.";

  /* Espelho de modulos/prevjud.js (content script não importa módulo). */
  const DOCS = [
    { chave: "beneficios", rotulo: "Declaração de Benefícios", rx: /^beneficios$/i, secao: "beneficios" },
    { chave: "carta", rotulo: "Carta de Concessão", rx: /^carta-concessao/i, secao: "cartaConcessao" },
    { chave: "cadastrais", rotulo: "Dados Cadastrais", rx: /^dados-cadastrais/i, secao: "consultaFiliadoTO" },
    { chave: "quadro", rotulo: "Quadro Resumo", rx: /^quadro/i, secao: null },
    { chave: "extrato", rotulo: "Extrato CNIS", rx: /^extrato/i, secao: "extratoPrevidenciario" },
    { chave: "historico", rotulo: "Histórico de Créditos", rx: /^hist/i, secao: "historicoCreditos" },
  ];
  const NAO_DOC = /^(obterDossie|statusDossie|solicitarDossie|pesquisarPedidosDossie)$/i;

  const PAGINA = location.origin + "/dossie-previdenciario";
  const TELA_PROIBIDA = /\/(dossie-medico|pap|penhora-judicial|consulta-beneficio)(\/|$)/i;
  const PROIBIDO = /m[eé]dic|penhor|implanta|intima[cç]|processo\s+administrativo|\bpap\b|consulta\s+por\s+n|bloque|bloqu|restri|constri/i;
  const PRONTO = /FINALIZ|CONCLU|DISPONIV/i;
  const ERRO = /ERRO|FALHA|REJEIT|CANCEL|INVALID/i;
  /* 1.9.0 (ao vivo, 26/10): "ERROR_AO_RECEBER_PEDIDO_PDPJ" no protocolo EM USO é passageiro —
     o PREVJUD refaz o pedido sozinho em segundos. Enquanto isso, o pedido está "REFAZENDO"
     (que não casa com ERRO nem com PRONTO: segue em aberto). Nunca certifica erro por isso. */
  const TRANSITORIO = /ERROR_AO_RECEBER_PEDIDO/i;
  const REFAZENDO = "REFAZENDO";
  const RAPIDO_MS = 5 * 1000;      // a espera curta que o Rodrigo sugeriu (3 a 5 s)
  const RAPIDAS_MAX = 3;           // até 3 conferências rápidas antes da espera normal

  const io = {
    clicar: (el) => el.click(),
    navegar: (u) => location.assign(u),
    agora: () => Date.now(),
    esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
    fecharAba: () => browser.runtime.sendMessage({ tipo: "prevjud_fechar_aba" }).catch(() => {}),
  };

  /* ── escuta (1.9.0: só com tarefa ativa; canal interno no modo Firefox) ────────
     Sem tarefa do CRATOS: desliga a escuta (apaga a memória dela) e não guarda nada.
     Com tarefa: assina o canal interno de prevjud-cedo.js (a página não lê nem forja)
     ou, sem o recurso do Firefox, põe o grampo de página (reserva, por evento). */
  const capturas = [];
  const vistos = new Set();   // nº da escuta: a resposta reenviada da memória não duplica
  const iniciados = [];       // início de cada pedido (1.8.6): sabe-se quando TODOS terminaram
  function aoResponder(detail) {
    try {
      const d = JSON.parse(detail);
      if (d.n != null) { if (vistos.has(d.n)) return; vistos.add(d.n); }
      let json = null;
      try { json = d.corpo ? JSON.parse(d.corpo) : null; } catch (e) { /* não era JSON */ }
      let enviado = null;
      try { enviado = d.enviado ? JSON.parse(d.enviado) : null; } catch (e) { /* idem */ }
      capturas.push({ metodo: d.metodo, url: String(d.url || ""), status: d.status, json, enviado, k: d.k == null ? null : d.k });
    } catch (e) { /* malformado */ }
  }
  function aoIniciar(detail) {
    try { const d = JSON.parse(detail); if (d && d.k != null) iniciados.push({ k: d.k, url: String(d.url || "") }); } catch (e) { /* nada */ }
  }
  const domResposta = (ev) => aoResponder(ev.detail);
  const domInicio = (ev) => aoIniciar(ev.detail);
  function emAndamento(desdeInicio, desdeCaptura) {
    const fim = new Set(capturas.slice(desdeCaptura).map((c) => c.k).filter((k) => k != null));
    return iniciados.slice(desdeInicio).filter((x) => !fim.has(x.k));
  }
  function ligarEscuta() {
    const canal = window.__cratosPrevjudEscuta;
    if (canal && typeof canal.assinar === "function" && canal.assinar(aoResponder, aoIniciar)) {
      console.log("CRATOS/PREVJUD: escuta ativa desde o início");
      return "firefox";
    }
    window.addEventListener("cratos:prevjud:api", domResposta);
    window.addEventListener("cratos:prevjud:inicio", domInicio);
    if (document.documentElement.getAttribute("data-cratos-prevjud") !== "escutando") {
      try {
        const s = document.createElement("script");
        s.src = browser.runtime.getURL("conteudo/prevjud-api.js");
        s.async = false;
        (document.head || document.documentElement).appendChild(s);
        s.onload = () => s.remove();
      } catch (e) { console.error("CRATOS/PREVJUD: falha ao injetar o grampo:", e); }
    }
    console.log("CRATOS/PREVJUD: escuta pelo grampo de página (reserva)");
    try { window.dispatchEvent(new CustomEvent("cratos:prevjud:reenviar")); } catch (e) { /* nada */ }
    return "pagina";
  }
  function desligarEscuta() {
    const canal = window.__cratosPrevjudEscuta;
    try { if (canal && typeof canal.desligar === "function") canal.desligar(); } catch (e) { /* nada */ }
    window.removeEventListener("cratos:prevjud:api", domResposta);
    window.removeEventListener("cratos:prevjud:inicio", domInicio);
    capturas.length = 0;
    iniciados.length = 0;
    vistos.clear();
  }

  Store.get("prevjud_estado").then(async (est) => {
    const fresco = est && est.ativo && (io.agora() - new Date(est.abertoEm || 0).getTime()) <= VALIDADE_MS;
    if (!(await Store.ligada()) || !fresco) {
      if (est && est.ativo && !fresco) console.log("CRATOS/PREVJUD: estado antigo — ignorando.");
      desligarEscuta();
      return;
    }
    ligarEscuta();
    await processar(est);
  }).catch((e) => falhar(null, e));

  /* ═══ FLUXO ═══ */
  async function processar(est) {
    try {
      /* Fora da tela do dossiê (dashboard, raiz depois do login, ou tela proibida):
         vai ao dossiê — com teto, para não girar. */
      if (TELA_PROIBIDA.test(location.pathname) || !/^\/dossie-previdenciario/i.test(location.pathname)) {
        const idas = (est.idas || 0) + 1;
        if (idas > 3) throw new Error("o PREVJUD não abriu o Dossiê Previdenciário depois de 3 tentativas.");
        await salvar(est, { idas });
        avisar("abrindo o Dossiê Previdenciário…");
        io.navegar(PAGINA);
        return;
      }
      avisar("aguardando o formulário do Dossiê Previdenciário (se pedir login, entre; eu sigo sozinho)…");
      const pronto = await aguardar(() => campo("solicitacaoProcesso") && campo("solicitacaoCpf"), ESPERA_FORM_MS);
      if (!pronto) throw new Error("o formulário do Dossiê Previdenciário (CPF / Nº do Processo) não apareceu.");
      cortina();

      if (est.modo === "solicitar" && !["aguardando", "lendo"].includes(est.fase)) {
        await solicitarTodos(est);
      }
      if (est.modo === "coleta" && est.descobrir) {
        await descobrirPedidos(est);
        if (!est.pedidos.length) { await coletaSemPedido(est); return; }
      }
      const pedidosOk = (est.pedidos || []).filter((p) => p.protocolo || p.semProtocolo);
      if (!pedidosOk.length) {
        throw new Error("nenhum pedido de dossiê foi registrado no PREVJUD" +
          ((est.pedidos || []).some((p) => p.erro) ? ` (${est.pedidos.map((p) => p.erro).filter(Boolean)[0]})` : "") + ".");
      }
      await salvar(est, { fase: "aguardando" });

      avisar(`aguardando o INSS processar ${pedidosOk.length} dossiê(s) (até ${est.modo === "coleta" ? "1,5" : "15"} min)…`);
      await aguardarProntos(est, est.modo === "coleta" ? ESPERA_COLETA_MS : ESPERA_TOTAL_MS);

      await salvar(est, { fase: "lendo" });
      for (const p of est.pedidos) {
        if (!p.protocolo || !PRONTO.test(p.status || "")) continue;
        cortina();
        avisar(`abrindo o dossiê de ${p.nome || formatarCpf(p.cpf)}…`);
        let lido = await lerDossie(p);
        /* o PREVJUD às vezes responde 503 a um documento e entrega na reabertura (recon de
           22/10): reabre o MESMO dossiê, até 3 vezes, juntando o melhor de cada tentativa */
        for (let t = 2; lido && t <= TENTATIVAS_DOSSIE && precisaReabrir(lido); t++) {
          avisar(`o PREVJUD falhou em documento(s) de ${p.nome || formatarCpf(p.cpf)}; reabrindo o dossiê (tentativa ${t} de ${TENTATIVAS_DOSSIE})…`);
          await io.esperar(PAUSA_REABRIR_MS);
          const outro = await lerDossie(p);
          if (outro) lido = { dossie: outro.dossie || lido.dossie, docs: mesclarDocs(lido.docs.concat(outro.docs)), inacabados: outro.inacabados };
        }
        p.lido = !!lido;
        p.resultados = lido ? avaliarDocumentos(lido, est.config) : null;
        if (lido) {
          for (const r of p.resultados.filter((x) => x.situacao === "obtido")) {
            await browser.runtime.sendMessage({
              tipo: "prevjud_pdf", base64: r.base64, numProcesso: est.numProcesso,
              nomeAbrev: doisPrimeiros(p.nome), cpf: p.cpf, pasta: pasta(est),
              rotulo: "PREVJUD " + r.rotulo, detalhe: r.chave,
            }).catch(() => {});
            delete r.base64;
          }
        }
      }
      await salvar(est, { pedidos: est.pedidos });
      await atualizarRegistro(est);

      const lidos = est.pedidos.filter((p) => p.lido);
      const pendentes = est.pedidos.filter((p) => (p.protocolo && !p.lido && !ERRO.test(p.status || "")) || (!p.protocolo && p.semProtocolo));
      if (est.modo === "coleta" && !lidos.length) {
        tirarCortina();
        await salvar(est, { ativo: false, fase: "coleta_sem_novidade" });
        await Store.set("prevjud_coleta_resultado", { numProcesso: est.numProcesso, em: io.agora(),
          resultados: est.pedidos.map((p) => ({ cpf: p.cpf, nome: p.nome, protocolo: p.protocolo, tipo: "pendente", status: p.status || null }))
            .concat(extrasColeta(est)) });
        avisar(`os ${pendentes.length} dossiê(s) continuam em processamento no PREVJUD. Tente coletar mais tarde.`);
        desligarEscuta();
        return;
      }

      const nomeCert = `${pasta(est)}/${est.numeroDigitos}_${doisPrimeiros((est.docs[0] || {}).nome) || "parte"} PREVJUD ${est.modo === "coleta" ? "coleta certidao" : "certidao"}.pdf`.replace(/\s+/g, " ");
      await browser.runtime.sendMessage({
        tipo: "fabricar_pdf", convenio: "PREVJUD", numProcesso: est.numProcesso, operacao: "consulta",
        detalhe: "certidao", titulo: "CERTIDÃO — DOSSIÊ PREVIDENCIÁRIO (PREVJUD/INSS)",
        linhas: montarCertidao(est), filename: nomeCert,
      }).catch(() => {});
      await salvar(est, { ativo: false, fase: "concluido" });
      if (est.modo === "coleta") {
        await Store.set("prevjud_coleta_resultado", { numProcesso: est.numProcesso, em: io.agora(),
          resultados: est.pedidos.map((p) => ({ cpf: p.cpf, nome: p.nome, protocolo: p.protocolo,
            tipo: p.lido ? "pdf" : "pendente", arquivos: (p.resultados || []).filter((r) => r.situacao === "obtido").length }))
            .concat(extrasColeta(est)) });
      } else {
        try {
          await Store.set("orq_conv_feito", { convenio: "PREVJUD", numProcesso: est.numProcesso, operacao: "consulta",
            ok: true, em: io.agora() });
        } catch (e) { /* nada */ }
      }
      tirarCortina();
      const indisp = est.pedidos.some((p) => (p.resultados || []).some((r) => r.situacao === "indisponivel"));
      const semProt = est.pedidos.filter((p) => !p.protocolo && p.semProtocolo).length;
      let txt = `${lidos.length} dossiê(s) juntado(s)` + (pendentes.length ? `; ${pendentes.length} ainda em processamento` +
        (semProt ? ` (${semProt} sem protocolo confirmado)` : "") + ` (use "Coletar PREVJUD" no painel mais tarde)` : "") + ".";
      if (indisp) txt += " Atenção: algum documento não foi disponibilizado pelo PREVJUD nesta consulta — confira a certidão.";
      txt += " Esta aba vai fechar sozinha.";
      CratosFaixa.mostrar("prevjud", txt, pendentes.length || indisp ? "#facc15" : "#4ade80");
      await io.esperar(PAUSA_ANTES_DE_FECHAR_MS);
      desligarEscuta();
      io.fecharAba();
    } catch (e) {
      falhar(est, e);
    }
  }

  /* ── solicitação ────────────────────────────────────────────────────────── */
  /* Cada resposta do SOLICITAR é ligada ao CPF pelo PRÓPRIO pedido (corpo enviado, ou o
     `parametro` da resposta) — nunca pela ordem de chegada: o PREVJUD pode demorar mais
     que a espera (vai à Dataprev), e a resposta atrasada de um CPF chega enquanto o
     CRATOS já pede o seguinte (teste ao vivo de 21/10). O que não responder a tempo
     fica "sem protocolo" e é achado depois pela LISTA de pedidos (resolverProtocolos). */
  async function solicitarTodos(est) {
    /* Retomada (a aba recarregou no meio): aproveita os pedidos já feitos e NÃO repete o
       do CPF que estava "em voo" — ele pode ter sido registrado; a lista o acha. */
    const retomada = est.fase === "solicitando";
    const emVoo = retomada ? est.emVoo || null : null;
    est.pedidos = retomada ? (est.pedidos || []).filter((p) => p.protocolo || p.incerto) : [];
    await salvar(est, { fase: "solicitando", emVoo: null, pedidos: est.pedidos });
    const proc = formatarProcesso(est.numeroDigitos);
    const inicio = capturas.length;
    for (const d of est.docs) {
      if (est.pedidos.some((p) => p.cpf === d.cpf)) continue;
      if (emVoo === d.cpf) {
        est.pedidos.push({ cpf: d.cpf, nome: d.nome, incerto: true, semProtocolo: true, clicadoEm: est.emVooEm || null,
          erro: "a página recarregou durante a solicitação; o pedido não foi repetido" });
        await salvar(est, { pedidos: est.pedidos });
        continue;
      }
      const cProc = campo("solicitacaoProcesso");
      if (digitos(cProc.value) !== est.numeroDigitos) {
        if (!(await preencher(cProc, proc, 20))) throw new Error("o campo Nº do Processo do PREVJUD não aceitou o número.");
      }
      avisar(`solicitando o dossiê de ${d.nome || formatarCpf(d.cpf)}…`);
      const cCpf = campo("solicitacaoCpf");
      if (!(await preencher(cCpf, formatarCpf(d.cpf), 11))) {
        est.pedidos.push({ cpf: d.cpf, nome: d.nome, erro: "o campo CPF não aceitou o número" });
        continue;
      }
      const btn = await aguardar(() => { const b = botaoPorTexto(/^\s*solicitar\s*$/i); return b && !b.disabled ? b : null; }, ESPERA_BOTAO_MS);
      if (!btn) { est.pedidos.push({ cpf: d.cpf, nome: d.nome, erro: "o botão SOLICITAR não habilitou" }); continue; }
      const antes = capturas.length;
      const clicadoEm = io.agora();
      await salvar(est, { emVoo: d.cpf, emVooEm: clicadoEm });
      clicarSeguro(btn);
      const r = await aguardar(() => conferirSolicitacoes(est, inicio) || respostaDoCpf(d.cpf, antes, est), ESPERA_SOLICITAR_MS);
      if (r && r.trava) throw new Error(r.trava);
      const p = { cpf: d.cpf, nome: d.nome, clicadoEm };
      if (r) aplicarResposta(p, r);
      else Object.assign(p, { incerto: true, semProtocolo: true, erro: "o PREVJUD não devolveu o protocolo a tempo" });
      est.pedidos.push(p);
      await salvar(est, { pedidos: est.pedidos, emVoo: null });
      await atualizarRegistro(est);
    }
    await salvar(est, { pedidos: est.pedidos, emVoo: null });
  }
  const ehSolicitar = (c) => c.metodo === "POST" && /\/solicitarDossie\//i.test(c.url);
  function respostaDe(c) { return Array.isArray(c.json) ? c.json[0] : c.json; }
  function cpfDaSolicitacao(c) {
    const env = Array.isArray(c.enviado) ? c.enviado[0] : c.enviado;
    const r = respostaDe(c);
    return digitos((env && env.cpf) || (r && r.parametro) || "");
  }
  /* resposta do SOLICITAR deste CPF, a partir de `desde`, com protocolo ainda não usado */
  function respostaDoCpf(cpf, desde, est) {
    const usados = new Set((est.pedidos || []).filter((p) => p.protocolo).map((p) => p.protocolo));
    return capturas.slice(desde).find((c) => {
      if (!ehSolicitar(c) || cpfDaSolicitacao(c) !== cpf) return false;
      const r = respostaDe(c);
      return !(c.status >= 200 && c.status < 300) || !(r && r.protocolo && usados.has(String(r.protocolo)));
    }) || null;
  }
  /* ⛔ pedido registrado com CPF que não é de nenhum executado, ou com outro processo */
  function conferirSolicitacoes(est, desde) {
    const meus = new Set((est.docs || []).map((d) => d.cpf));
    for (const c of capturas.slice(desde)) {
      if (!ehSolicitar(c)) continue;
      const env = Array.isArray(c.enviado) ? c.enviado[0] : c.enviado;
      const cpf = cpfDaSolicitacao(c);
      const procEnv = digitos(env && env.numeroProcesso);
      if ((cpf && !meus.has(cpf)) || (procEnv && est.numeroDigitos.indexOf(procEnv) !== 0)) {
        return { trava: "o PREVJUD registrou o pedido com CPF ou processo diferente do pretendido. Confira a lista de pedidos; não certifico." };
      }
    }
    return null;
  }
  function aplicarResposta(p, c) {
    if (!(c.status >= 200 && c.status < 300)) {
      Object.assign(p, { incerto: false, semProtocolo: false, erro: `o PREVJUD recusou a solicitação (HTTP ${c.status}${mensagem(c.json)})` });
      return;
    }
    const r = respostaDe(c);
    if (!r || !r.protocolo) { Object.assign(p, { incerto: false, semProtocolo: false, erro: "o PREVJUD não informou o protocolo" }); return; }
    adotar(p, String(r.protocolo), r.statusDossie || null, r.dataSolicitacao || new Date(io.agora()).toISOString());
  }
  function adotar(p, protocolo, status, solicitadoEm) {
    Object.assign(p, { protocolo, status: status || p.status || null, solicitadoEm: solicitadoEm || p.solicitadoEm || null,
      incerto: false, semProtocolo: false });
    delete p.erro;
  }

  /* ── lista de pedidos (pesquisarPedidosDossie) ──────────────────────────── */
  function capturouLista() { return capturas.some((c) => /pesquisarPedidosDossie/i.test(c.url) && c.json); }
  /* Um GRUPO por pedido da tela (recon de 21/10, 16h38): cada item de `content` traz o
     CPF, o processo, `dataCriacao`, `dataEntregaResposta` (preenchida = "CONCLUÍDO" na
     tela) e o protocolo EM USO em `protocoloDossieAtivo`; o array `protocolos` traz os
     demais protocolos do mesmo pedido (outra situação). Status de `protocolos[]` não
     decide nada — só o ativo e a entrega. */
  function gruposDaLista() {
    const porChave = new Map();
    for (const c of capturas) {
      if (!/pesquisarPedidosDossie/i.test(c.url) || !c.json) continue;
      const content = Array.isArray(c.json.content) ? c.json.content : (Array.isArray(c.json) ? c.json : []);
      let ordem = 0;   // ordem da tela (data decrescente): desempata pedidos no mesmo instante
      for (const it of content) {
        if (!it || typeof it !== "object") continue;
        const ativo = it.protocoloDossieAtivo && it.protocoloDossieAtivo.protocolo ? it.protocoloDossieAtivo : null;
        const outros = (Array.isArray(it.protocolos) ? it.protocolos : []).filter((x) => x && x.protocolo);
        const todos = [ativo].concat(outros).filter(Boolean).map((x) => String(x.protocolo));
        if (!todos.length && it.protocolo) todos.push(String(it.protocolo));
        if (!todos.length) continue;
        const g = {
          ordem: ordem++,
          cpf: digitos(it.cpf || (ativo && ativo.parametro) || it.parametro),
          proc: digitos(it.numeroProcesso),
          protocolo: todos[0],                                  // o ativo, quando houver
          protocolos: Array.from(new Set(todos)),
          statusAtivo: (ativo && (ativo.statusDossie || ativo.status)) || it.statusDossie || null,
          entregue: quandoDe(it.dataEntregaResposta) != null,
          quando: quandoDe(it.dataCriacao || (ativo && ativo.creation) || it.dataSolicitacao),
        };
        porChave.set(g.protocolos.slice().sort().join("|"), g);   // a captura mais nova vence
      }
    }
    return Array.from(porChave.values());
  }
  function grupoDe(protocolo) {
    if (!protocolo) return null;
    const gs = gruposDaLista().filter((g) => g.protocolos.includes(protocolo));
    return gs.length ? gs[gs.length - 1] : null;
  }
  function grupoPronto(g) { return !!g && (g.entregue || PRONTO.test(g.statusAtivo || "")); }
  function protocolosDoPedido(p) {
    const g = grupoDe(p.protocolo);
    return Array.from(new Set([p.protocolo].concat(g ? g.protocolos : []).filter(Boolean)));
  }
  function mesmoProcesso(proc, numeroDigitos) {
    return proc.length >= 16 && numeroDigitos.indexOf(proc) === 0;
  }
  /* data do PREVJUD → ms (ISO, ISO sem fuso = hora local, dd/mm/aaaa hh:mm, [a,m,d,h,mi], epoch) */
  function quandoDe(v) {
    if (v == null || v === "") return null;
    if (typeof v === "number") return v > 1e11 ? v : v * 1000;
    if (Array.isArray(v) && v.length >= 3) return new Date(v[0], v[1] - 1, v[2], v[3] || 0, v[4] || 0, v[5] || 0).getTime();
    const t = String(v).trim();
    const br = t.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T,]+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (br) return new Date(+br[3], +br[2] - 1, +br[1], +(br[4] || 0), +(br[5] || 0), +(br[6] || 0)).getTime();
    const ms = Date.parse(t);
    return isNaN(ms) ? null : ms;
  }
  /* Pedidos sem protocolo: a resposta atrasada do SOLICITAR, ou a lista (mesmo CPF e
     processo, feito a partir do clique — com folga de relógio). Sem data, não adota. */
  function resolverProtocolos(est) {
    let mudou = false;
    for (const p of est.pedidos || []) {
      if (p.protocolo || !p.semProtocolo) continue;
      const c = respostaDoCpf(p.cpf, 0, est);
      if (c && c.status >= 200 && c.status < 300 && (respostaDe(c) || {}).protocolo) { aplicarResposta(p, c); mudou = true; continue; }
      if (!p.clicadoEm) continue;
      const usados = new Set([].concat(...est.pedidos.filter((x) => x.protocolo).map((x) => protocolosDoPedido(x))));
      const cand = gruposDaLista()
        .filter((g) => g.cpf === p.cpf && mesmoProcesso(g.proc, est.numeroDigitos) && !g.protocolos.some((x) => usados.has(x)) &&
          g.quando != null && g.quando >= p.clicadoEm - FOLGA_RELOGIO_MS)
        .sort((a, b) => (b.quando - a.quando) || (a.ordem - b.ordem))[0];
      if (cand) { adotar(p, cand.protocolo, cand.statusAtivo, new Date(cand.quando).toISOString()); mudou = true; }
    }
    return mudou;
  }

  /* ── coleta sem pedido anotado: procura pelo nº do processo (Rodrigo, 21/10) ──
     Por CPF, só pedidos dos últimos 7 dias; entre eles, o mais recente já PRONTO; se
     nenhum estiver pronto, o mais recente (e espera por ele). Fora do prazo: avisa e
     não junta. Protocolo já juntado pelo CRATOS neste navegador: não junta de novo. */
  async function descobrirPedidos(est) {
    avisar("procurando no PREVJUD os pedidos deste processo (últimos 7 dias)…");
    if (!(await aguardar(capturouLista, ESPERA_LISTA_MS))) {
      const b = botaoAplicar();
      if (b) { try { clicarSeguro(b); } catch (e) { /* nada */ } await aguardar(capturouLista, ESPERA_LISTA_MS); }
    }
    const reg = (await Store.get("prevjud_req:" + est.numeroDigitos)) || [];
    /* 1.8.7 (Rodrigo): SEM o freio de "já juntado" — quem clica em Coletar quer juntar.
       Só se registra que é nova juntada, para a certidão dizer. */
    const anteriores = reg.filter((r) => r && r.encerrado && r.protocolo);
    const limite = io.agora() - PRAZO_COLETA_MS;
    const nomes = est.nomes || {};
    const porCpf = new Map();
    for (const x of gruposDaLista()) {
      if (x.cpf.length !== 11 || !mesmoProcesso(x.proc, est.numeroDigitos)) continue;
      if (!porCpf.has(x.cpf)) porCpf.set(x.cpf, []);
      porCpf.get(x.cpf).push(x);
    }
    const pedidos = [], foraDoPrazo = [], jaJuntados = [];   // jaJuntados: não se usa mais (1.8.7)
    for (const [cpf, itens] of porCpf) {
      const nome = nomes[cpf] || "";
      const noPrazo = itens.filter((x) => x.quando != null && x.quando >= limite).sort((a, b) => (b.quando - a.quando) || (a.ordem - b.ordem));
      if (!noPrazo.length) {
        const ult = itens.filter((x) => x.quando != null).sort((a, b) => (b.quando - a.quando) || (a.ordem - b.ordem))[0];
        foraDoPrazo.push({ cpf, nome, quando: ult ? ult.quando : null });
        continue;
      }
      const escolhido = noPrazo.find((x) => grupoPronto(x)) || noPrazo[0];
      const antes = anteriores.find((r) => escolhido.protocolos.includes(r.protocolo));
      pedidos.push({ cpf, nome, protocolo: escolhido.protocolo,
        status: grupoPronto(escolhido) ? "CONCLUIDO" : (TRANSITORIO.test(escolhido.statusAtivo || "") ? REFAZENDO : escolhido.statusAtivo),
        solicitadoEm: new Date(escolhido.quando).toISOString(), jaJuntadoEm: antes ? (antes.juntadoEm || "antes") : null });
    }
    await salvar(est, { pedidos, docs: pedidos.map((x) => ({ nome: x.nome, cpf: x.cpf })), foraDoPrazo, jaJuntados,
      descobrir: false, listaVista: capturouLista() });
  }

  /* ── espera ─────────────────────────────────────────────────────────────── */
  function statusAtual(protocolo) {
    let st = null;
    for (const c of capturas) {
      const j = c.json;
      if (!j) continue;
      const lista = [];
      if (Array.isArray(j)) lista.push(...j);
      else lista.push(j);
      if (j && j.cabecalho) lista.push({ protocolo: j.cabecalho.protocolo, statusDossie: j.cabecalho.status });
      for (const x of lista) {
        if (x && String(x.protocolo || "") === protocolo && (x.statusDossie || x.status)) st = String(x.statusDossie || x.status);
      }
    }
    /* a lista (o que a tela mostra) manda: entregue = CONCLUÍDO */
    /* ⛔ 1.8.7 (ao vivo, 22/10): o protocolo devolvido no SOLICITAR pode falhar
       ("ERROR_AO_RECEBER_PEDIDO_PDPJ") e o PREVJUD refaz SOZINHO com outro protocolo, que
       vira o ativo do pedido e conclui. Erro de um protocolo NÃO encerra o pedido: só o
       do protocolo EM USO, visto na lista. Sem o pedido na lista ainda, erro = aguardar. */
    const g = grupoDe(protocolo);
    if (g) {
      if (grupoPronto(g)) return "CONCLUIDO";
      if (st && PRONTO.test(st) && !(g.statusAtivo && ERRO.test(g.statusAtivo))) return st;
      if (g.statusAtivo && TRANSITORIO.test(g.statusAtivo)) return REFAZENDO;
      return g.statusAtivo || "EM_PROCESSAMENTO";
    }
    if (st && ERRO.test(st)) return "AGUARDANDO_LISTA";
    return st;
  }
  /* o pedido passa a ser acompanhado pelo protocolo EM USO (o ativo da lista) */
  function seguirAtivo(p) {
    const g = grupoDe(p.protocolo);
    if (g && g.protocolo && g.protocolo !== p.protocolo) {
      p.protocolosAnteriores = Array.from(new Set((p.protocolosAnteriores || []).concat(p.protocolo)));
      p.protocolo = g.protocolo;
      return true;
    }
    return false;
  }
  async function aguardarProntos(est, limiteMs) {
    const ciclos = Math.max(1, Math.ceil(limiteMs / INTERVALO_ATUALIZAR_MS)) + RAPIDAS_MAX;
    let rapidas = 0;
    for (let i = 0; i <= ciclos; i++) {
      let mudou = resolverProtocolos(est);
      for (const p of est.pedidos) if (p.protocolo && seguirAtivo(p)) mudou = true;
      if (mudou) { await salvar(est, { pedidos: est.pedidos }); await atualizarRegistro(est); }
      for (const p of est.pedidos) if (p.protocolo) p.status = statusAtual(p.protocolo) || p.status;
      const abertos = est.pedidos.filter((p) => (p.protocolo && !PRONTO.test(p.status || "") && !ERRO.test(p.status || "")) ||
        (!p.protocolo && p.semProtocolo));
      if (!abertos.length || i === ciclos) break;
      cortina();
      /* PREVJUD refazendo o pedido: espera curta (5 s) e confere de novo, até 3 vezes,
         antes de cair na espera normal de 30 s. */
      if (rapidas < RAPIDAS_MAX && est.pedidos.some((p) => p.status === REFAZENDO)) {
        rapidas++;
        avisar(`o PREVJUD está refazendo o pedido — conferindo de novo em 5 segundos (${rapidas} de ${RAPIDAS_MAX})…`);
        await io.esperar(RAPIDO_MS);
        const bR = botaoAplicar();
        const nR = capturas.length;
        if (bR) { try { clicarSeguro(bR); } catch (e) { /* nada */ } }
        await aguardar(() => capturas.length > nR, RAPIDO_MS);
        continue;
      }
      const b = botaoAplicar();
      const n = capturas.length;
      if (b) { try { clicarSeguro(b); } catch (e) { /* nada */ } }
      await aguardar(() => capturas.length > n && statusDiferente(est), INTERVALO_ATUALIZAR_MS);
    }
    resolverProtocolos(est);
    for (const p of est.pedidos) if (p.protocolo) seguirAtivo(p);
    for (const p of est.pedidos) if (p.protocolo) p.status = statusAtual(p.protocolo) || p.status;
    await salvar(est, { pedidos: est.pedidos });
  }
  function statusDiferente(est) {
    return est.pedidos.some((p) => (p.protocolo && PRONTO.test(statusAtual(p.protocolo) || "")) || (!p.protocolo && p.semProtocolo &&
      (respostaDoCpf(p.cpf, 0, est) || gruposDaLista().some((x) => x.cpf === p.cpf))));
  }

  /* ── leitura do dossiê ("Visualizar") ───────────────────────────────────── */
  async function lerDossie(p) {
    const linhas = linhasDaTabela();
    const aceitos = protocolosDoPedido(p);   // o Visualizar pode abrir por qualquer protocolo do pedido
    const comProtocolo = linhas.filter((l) => aceitos.some((x) => (l.textContent || "").indexOf(x) >= 0));
    const candidatas = comProtocolo.length ? comProtocolo
      : linhas.filter((l) => digitos(l.textContent).indexOf(p.cpf) >= 0);
    for (const linha of candidatas) {
      const vis = Array.from(linha.querySelectorAll("button")).find((b) => /visualiz|visibility/i.test(textoDe(b)));
      if (!vis) continue;
      const ini = capturas.length;
      const iIni = iniciados.length;
      try { clicarSeguro(vis); } catch (e) { continue; }
      const dossie = await aguardar(() => capturas.slice(ini).find((c) => /\/obterDossie\//i.test(c.url)) || null, ESPERA_VISUALIZAR_MS);
      if (!dossie) { fecharDialogo(); continue; }
      const aberto = aceitos.find((x) => dossie.url.indexOf(x) >= 0);
      if (!aberto) { fecharDialogo(); await io.esperar(400); continue; }
      /* espera os PDFs: fecha quando TODO pedido que começou terminou de chegar (+ um
         silêncio curto, para pedido em sequência); teto de 60 s. Sem nenhum início visto
         (escuta antiga), espera 8 s de silêncio. */
      const minP = Math.ceil(MIN_DOCS_MS / PASSO_MS), quietoP = Math.ceil(QUIETO_MS / PASSO_MS);
      const semInicioP = Math.ceil(ESPERA_SEM_INICIO_MS / PASSO_MS), maxP = Math.ceil(ESPERA_DOCS_MS / PASSO_MS);
      let ultimo = capturas.length, quietos = 0;
      for (let passo = 1; passo <= maxP; passo++) {
        await io.esperar(PASSO_MS);
        if (capturas.length !== ultimo) { ultimo = capturas.length; quietos = 0; } else quietos++;
        const docsIniciados = iniciados.slice(iIni).some((x) => trechoDoc(x.url, aberto));
        const andando = emAndamento(iIni, ini).length;
        if (andando === 0 && quietos >= quietoP && passo >= (docsIniciados ? minP : semInicioP)) break;
      }
      const inacabados = emAndamento(iIni, ini).filter((x) => trechoDoc(x.url, aberto)).length;
      const docs = capturas.slice(ini).filter((c) => c.metodo === "GET" && trechoDoc(c.url, aberto));
      fecharDialogo();
      return { dossie: dossie.json, docs, inacabados };
    }
    return null;
  }
  /* falha do SERVIDOR (5xx) ou de rede (0) num documento, ou documento que não terminou */
  function precisaReabrir(lido) {
    return (lido.inacabados || 0) > 0 || mesclarDocs(lido.docs).some((c) => c.status === 0 || c.status >= 500);
  }
  /* um por documento: PDF obtido > "não há" do INSS (404/mensagem) > falha; empate → o mais novo */
  function mesclarDocs(lista) {
    const nota = (c) => (c.status >= 200 && c.status < 300 && c.json && c.json.pdfBase64) ? 3
      : (c.status === 404 || negativaTexto(c.json)) ? 2 : 1;
    const por = new Map();
    for (const c of lista) {
      const m = String(c.url).match(/\/dossiePrevidenciario\/[^/]+\/([^/?#]+)\//i);
      const chave = m ? m[1].toLowerCase() : c.url;
      const atual = por.get(chave);
      if (!atual || nota(c) >= nota(atual)) por.set(chave, c);
    }
    return Array.from(por.values());
  }
  function trechoDoc(url, protocolo) {
    const m = String(url).match(/\/dossiePrevidenciario\/[^/]+\/([^/?#]+)\/([^/?#]+)/i);
    if (!m || m[2] !== protocolo || NAO_DOC.test(m[1])) return null;
    return m[1];
  }

  /* Por documento ligado: obtido | negativa | indisponivel | desligado. */
  function avaliarDocumentos(lido, config) {
    const cfg = config || { documentos: {}, outros: true };
    const ligados = cfg.documentos || {};
    const caps = lido.docs.map((c) => ({ c, trecho: (String(c.url).match(/\/dossiePrevidenciario\/[^/]+\/([^/?#]+)\//i) || [])[1] || "" }));
    const usados = new Set();
    const res = [];
    for (const d of DOCS) {
      const meus = caps.filter((x) => d.rx.test(x.trecho));
      meus.forEach((x) => usados.add(x));
      if (ligados[d.chave] === false) { res.push({ chave: d.chave, rotulo: d.rotulo, situacao: "desligado" }); continue; }
      const comPdf = meus.filter((x) => x.c.status >= 200 && x.c.status < 300 && x.c.json && x.c.json.pdfBase64);
      if (comPdf.length) {
        for (const x of comPdf) {
          res.push({ chave: d.chave, rotulo: d.rotulo + (/dependente/i.test(x.trecho) ? " (dependentes)" : ""),
            situacao: "obtido", base64: String(x.c.json.pdfBase64) });
        }
        continue;
      }
      const neg = meus.find((x) => x.c.status === 404 || negativaTexto(x.c.json));
      if (neg) { res.push({ chave: d.chave, rotulo: d.rotulo, situacao: "negativa", mensagem: mensagemLimpa(neg.c.json) }); continue; }
      const sec = d.secao && lido.dossie && lido.dossie.dossiePrevidenciario ? lido.dossie.dossiePrevidenciario[d.secao] : null;
      const msgSec = sec ? mensagemSecao(sec.mensagemTO) : null;
      if (msgSec) { res.push({ chave: d.chave, rotulo: d.rotulo, situacao: "negativa", mensagem: msgSec }); continue; }
      res.push({ chave: d.chave, rotulo: d.rotulo, situacao: "indisponivel" });
    }
    /* outros documentos (endpoint novo com PDF) */
    for (const x of caps) {
      if (usados.has(x) || !(x.c.json && x.c.json.pdfBase64)) continue;
      const rot = x.trecho.replace(/[-_]+/g, " ").replace(/^./, (s) => s.toUpperCase());
      res.push({ chave: "outros", rotulo: rot, situacao: cfg.outros === false ? "desligado" : "obtido",
        base64: cfg.outros === false ? undefined : String(x.c.json.pdfBase64) });
    }
    return res;
  }
  function negativaTexto(j) {
    if (!j || typeof j !== "object") return false;
    const t = [j.result, j.errorMessage, j.mensagem, j.message].filter(Boolean).join(" ");
    return /n[aã]o\s+(foi\s+)?(encontrad|exist|h[aá]|consta|localizad)|inexist|not\s*found/i.test(t) || Number(j.httpCode) === 404;
  }
  function mensagemSecao(m) {
    const lista = Array.isArray(m) ? m : (m ? [m] : []);
    for (const x of lista) {
      if (!x || typeof x !== "object") continue;
      if (negativaTexto(x)) return mensagemLimpa(x);
    }
    return null;
  }
  function mensagemLimpa(j) {
    if (!j || typeof j !== "object") return "";
    const t = String(j.result || j.errorMessage || j.mensagem || j.message || "").replace(/\s+/g, " ").trim();
    /* sem CPF/NIT na certidão */
    return t.replace(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g, "[CPF]").replace(/\d{6,}/g, "[nº]").slice(0, 200);
  }
  function mensagem(j) {
    const t = mensagemLimpa(j);
    return t ? ` — "${t}"` : "";
  }

  /* ── certidão ───────────────────────────────────────────────────────────── */
  function montarCertidao(est) {
    const agora = new Date(io.agora());
    const L = ["",
      `Certifico e dou fé que, nesta data (${dataBR(agora)}, às ${hm(agora)}), ` +
      (est.modo === "coleta"
        ? "consultei no PREVJUD (Serviço de Informação e Automação Previdenciária — CNJ/INSS) os pedidos de Dossiê " +
          `Previdenciário do processo nº ${est.numProcesso}` +
          (est.listaVista ? " (para cada CPF, o pedido mais recente dos últimos 7 dias)" : " ainda em processamento") +
          ", com o resultado abaixo."
        : "solicitei, pelo PREVJUD (Serviço de Informação e Automação Previdenciária — CNJ/INSS), o Dossiê " +
          `Previdenciário das pessoas abaixo, no processo nº ${est.numProcesso}, com o resultado a seguir.`),
    ];
    (est.pedidos || []).forEach((p, i) => {
      L.push("", `${i + 1}) ${p.nome ? p.nome + " - " : ""}CPF ${formatarCpf(p.cpf)}`);
      if (!p.protocolo && p.incerto) {
        L.push(`   Situação: não confirmada (${p.erro || "sem resposta do PREVJUD"}). O pedido não foi repetido, para não ` +
          "duplicá-lo. Deve-se conferir na lista de pedidos do PREVJUD se ele foi registrado.");
        return;
      }
      if (!p.protocolo) {
        L.push(`   Não foi possível registrar o pedido no PREVJUD nesta oportunidade${p.erro ? ` (${p.erro})` : ""}.`);
        return;
      }
      L.push(`   Protocolo: ${p.protocolo}` + (p.solicitadoEm ? ` — solicitado em ${dataHoraDe(p.solicitadoEm)}` : ""));
      if (p.jaJuntadoEm && p.lido) {
        L.push("   Nova juntada: este dossiê já havia sido obtido pelo CRATOS" +
          (p.jaJuntadoEm !== "antes" ? ` em ${dataHoraDe(p.jaJuntadoEm).replace(" ", ", às ")}` : " anteriormente") + ".");
      }
      if (ERRO.test(p.status || "")) { L.push(`   Situação: o PREVJUD informou "${p.status}"; o dossiê não foi disponibilizado.`); return; }
      if (!p.lido && p.status === REFAZENDO) {
        L.push("   Situação: em processamento — o PREVJUD informou erro ao receber o pedido (\"ERROR_AO_RECEBER_PEDIDO_PDPJ\") e ainda " +
          "não o havia refeito no momento desta certidão. O dossiê será juntado quando disponível (botão \"Coletar PREVJUD\").");
        return;
      }
      if (!p.lido) {
        L.push("   Situação: em processamento no momento desta certidão. O dossiê será juntado quando disponível.");
        return;
      }
      L.push("   Situação: dossiê finalizado. Documentos:");
      for (const r of p.resultados || []) {
        const t = r.situacao === "obtido" ? "obtido e anexado."
          : r.situacao === "negativa" ? `não houve resposta positiva${r.mensagem ? ` (o INSS informou: "${r.mensagem}")` : ""}.`
            : r.situacao === "desligado" ? "não solicitado, por configuração do(a) usuário(a)."
              : "o PREVJUD não disponibilizou este documento nesta consulta.";
        L.push(`   - ${r.rotulo}: ${t}`);
      }
    });
    for (const x of est.foraDoPrazo || []) {
      L.push("", `CPF ${formatarCpf(x.cpf)}${x.nome ? ` (${x.nome})` : ""}: o pedido mais recente no PREVJUD` +
        (x.quando ? ` é de ${dataHoraDe(new Date(x.quando).toISOString())},` : "") + " anterior aos últimos 7 dias; não foi juntado.");
    }
    if ((est.semCpf || []).length) {
      L.push("", "Partes não consultadas, por não serem pessoa física com CPF (o Dossiê Previdenciário é por CPF): " +
        est.semCpf.map((x) => x.nome).join("; ") + ".");
    }
    if ((est.pedidos || []).some((p) => (p.resultados || []).some((r) => r.situacao === "obtido"))) {
      L.push("", "Os documentos anexados são os PDFs emitidos pelo próprio PREVJUD/INSS, juntados como recebidos.");
    }
    L.push("", `${est.modo === "coleta" ? "A consulta" : "A solicitação"} foi feita pelo CRATOS, a pedido do(a) responsável por este ato.`);
    L.push("", "Era o que me cumpria certificar.");
    return L;
  }

  function extrasColeta(est) {
    return (est.foraDoPrazo || []).map((x) => ({ cpf: x.cpf, nome: x.nome, tipo: "antigo", quando: x.quando }))
      .concat((est.jaJuntados || []).map((x) => ({ cpf: x.cpf, nome: x.nome, protocolo: x.protocolo, tipo: "ja" })));
  }
  async function coletaSemPedido(est) {
    tirarCortina();
    const aviso = !est.listaVista
      ? "não consegui ler a lista de pedidos do PREVJUD."
      : (est.foraDoPrazo || []).length || (est.jaJuntados || []).length
        ? "nenhum pedido novo deste processo nos últimos 7 dias para juntar."
        : "não há pedidos de Dossiê Previdenciário deste processo no PREVJUD.";
    await salvar(est, { ativo: false, fase: "coleta_sem_pedido" });
    await Store.set("prevjud_coleta_resultado", { numProcesso: est.numProcesso, em: io.agora(), aviso, resultados: extrasColeta(est) });
    avisar("Coleta: " + aviso + " Nenhuma certidão foi gerada.");
    desligarEscuta();
  }

  /* ── registro para a coleta ─────────────────────────────────────────────── */
  async function atualizarRegistro(est) {
    const chave = "prevjud_req:" + est.numeroDigitos;
    const reg = (await Store.get(chave)) || [];
    for (const p of est.pedidos || []) {
      if (!p.protocolo) continue;
      /* um item por PEDIDO: o protocolo pode ter mudado para o ativo (seguirAtivo) */
      const meus = new Set(protocolosDoPedido(p).concat(p.protocolosAnteriores || []));
      const i = reg.findIndex((r) => r && meus.has(r.protocolo));
      /* ⛔ 1.8.7: encerrado SÓ quando os PDFs foram juntados — nunca por erro */
      const item = { cpf: p.cpf, nome: p.nome, protocolo: p.protocolo, solicitadoEm: p.solicitadoEm,
        status: p.status || null, encerrado: !!p.lido };
      if (p.lido) item.juntadoEm = (i >= 0 && reg[i].juntadoEm && !p.jaJuntadoEm) ? reg[i].juntadoEm : new Date(io.agora()).toISOString();
      if (i >= 0) reg[i] = Object.assign(reg[i], item); else reg.push(item);
    }
    await Store.set(chave, reg);
  }

  /* ═══ TELA ═══ */
  function campo(id) {
    return document.getElementById(id) || document.querySelector(`input[formcontrolname="${id}"], input[name="${id}"]`);
  }
  function botaoPorTexto(rx) {
    return Array.from(document.querySelectorAll("button")).find((b) => rx.test(b.textContent || "")) || null;
  }
  function linhasDaTabela() {
    return Array.from(document.querySelectorAll("mat-table tr, table tr, mat-row, tr[mat-row], [role=row]"))
      .filter((l) => l.querySelector("td, mat-cell, [role=cell]"));
  }
  /* Quem refaz a busca da lista é o APLICAR do filtro (ao vivo, 21/10: as linhas só têm
     Visualizar e download). Botão de atualizar na linha, se um dia existir. Nunca outro
     botão da linha (o de download baixaria o arquivo pelo navegador). */
  function botaoAplicar() {
    const ap = botaoPorTexto(/^\s*aplicar\s*$/i);
    if (ap && !ap.disabled) return ap;
    for (const l of linhasDaTabela()) {
      const b = Array.from(l.querySelectorAll("button")).find((x) => /atualiz|refresh|sync|autorenew/i.test(textoDe(x)) &&
        !/visualiz|visibility|baixar|download/i.test(textoDe(x)));
      if (b) return b;
    }
    return null;
  }
  function fecharDialogo() {
    const b = botaoPorTexto(/^\s*fechar\s*$/i);
    if (b) { try { clicarSeguro(b); } catch (e) { /* nada */ } }
  }
  function textoDe(el) {
    if (!el) return "";
    return [el.textContent, el.getAttribute && el.getAttribute("aria-label"), el.getAttribute && el.getAttribute("title"),
      el.getAttribute && el.getAttribute("mattooltip"), el.getAttribute && el.getAttribute("ng-reflect-message")]
      .filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }
  function clicarSeguro(el) {
    if (!el) throw new Error("elemento ausente para clicar.");
    const alvo = el.closest ? (el.closest("button, a, [role=button]") || el) : el;
    const t = textoDe(alvo) + " " + String((alvo.getAttribute && alvo.getAttribute("href")) || "");
    if (PROIBIDO.test(t)) {
      throw new Error("TRAVA: o CRATOS só opera o Dossiê Previdenciário no PREVJUD (recusou \"" + t.slice(0, 60) + "\").");
    }
    if (TELA_PROIBIDA.test(location.pathname)) throw new Error("TRAVA: tela fora do escopo do CRATOS no PREVJUD.");
    io.clicar(el);
  }

  /* Campo com máscara: digitar (o que funcionou no SNIPER), colar, só dígitos. */
  async function preencher(el, valor, nDigitos) {
    for (const modo of ["digitar", "colar", "digitar_digitos"]) {
      try { await tentar(el, valor, modo); } catch (e) { /* próxima */ }
      await io.esperar(200);
      if (digitos(el.value).length === nDigitos && digitos(el.value) === digitos(valor)) return true;
    }
    return false;
  }
  function definirValor(el, v) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v); }
  function teclar(el, tipo, ch) { try { el.dispatchEvent(new KeyboardEvent(tipo, { bubbles: true, cancelable: true, key: ch })); } catch (e) { /* nada */ } }
  async function tentar(el, valor, modo) {
    el.focus();
    try { el.select(); } catch (e) { /* nada */ }
    if (el.value) {
      teclar(el, "keydown", "Backspace");
      definirValor(el, "");
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
    }
    if (modo === "colar") {
      let tratado = false;
      try {
        const dt = new DataTransfer();
        dt.setData("text/plain", valor);
        tratado = !el.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt }));
      } catch (e) { /* sem ClipboardEvent */ }
      if (!tratado || digitos(el.value) !== digitos(valor)) {
        definirValor(el, valor);
        el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste", data: valor }));
      }
    } else {
      const texto = modo === "digitar_digitos" ? digitos(valor) : valor;
      for (const ch of texto) {
        teclar(el, "keydown", ch);
        definirValor(el, el.value + ch);
        el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: ch }));
        teclar(el, "keyup", ch);
        await io.esperar(15);
      }
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  /* ═══ ESTADO, FAIXA, UTILITÁRIOS ═══ */
  async function aguardar(cond, ms) {
    const passos = Math.max(1, Math.ceil(ms / PASSO_MS));
    for (let i = 0; i <= passos; i++) {
      let r = null;
      try { r = cond(); } catch (e) { r = null; }
      if (r) return r;
      if (i < passos) await io.esperar(PASSO_MS);
    }
    return null;
  }
  async function salvar(est, patch) {
    const novo = Object.assign({}, est, patch, { abertoEm: new Date(io.agora()).toISOString() });
    Object.assign(est, novo);
    await Store.set("prevjud_estado", novo);
    return novo;
  }
  function falhar(est, e) {
    const msg = String((e && e.message) || e);
    desligarEscuta();
    tirarCortina();
    CratosFaixa.parar("prevjud", msg + " Nenhuma certidão foi gerada.");
    if (est) {
      Store.set("prevjud_estado", Object.assign({}, est, { ativo: false, fase: "erro", erro: msg })).catch(() => {});
      if (est.modo !== "coleta") {
        Store.set("orq_conv_feito", { convenio: "PREVJUD", numProcesso: est.numProcesso, operacao: "consulta",
          ok: false, feitos: 0, motivo: msg, em: io.agora() }).catch(() => {});
      } else {
        Store.set("prevjud_coleta_resultado", { numProcesso: est.numProcesso, em: io.agora(), erro: msg }).catch(() => {});
      }
    }
  }
  function avisar(t) { return CratosFaixa.mostrar("prevjud", t, "#facc15"); }
  function cortina() { try { if (typeof CratosOverlay !== "undefined") CratosOverlay.mostrar(AVISO_CORTINA); } catch (e) { /* nada */ } }
  function tirarCortina() { try { if (typeof CratosOverlay !== "undefined") CratosOverlay.esconder(); } catch (e) { /* nada */ } }

  function digitos(s) { return String(s == null ? "" : s).replace(/\D/g, ""); }
  function formatarProcesso(d) {
    const x = digitos(d);
    return x.length === 20 ? x.replace(/(\d{7})(\d{2})(\d{4})(\d)(\d{2})(\d{4})/, "$1-$2.$3.$4.$5.$6") : x;
  }
  function formatarCpf(d) {
    const x = digitos(d);
    return x.length === 11 ? x.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") : x;
  }
  function doisPrimeiros(nome) {
    return String(nome || "").trim().split(/\s+/).slice(0, 2).join(" ").replace(/[/\\:*?"<>|]/g, "");
  }
  function pasta(est) {
    return String(((est.config || {}).pasta) || "CRATOS").replace(/[\\:*?"<>|]/g, "").trim() || "CRATOS";
  }
  const p2 = (n) => String(n).padStart(2, "0");
  function dataBR(d) { return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`; }
  function hm(d) { return `${p2(d.getHours())}:${p2(d.getMinutes())}`; }
  function dataHoraDe(iso) {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? String(iso) : `${dataBR(d)} ${hm(d)}`;
  }

  if (typeof window !== "undefined") {
    window.__cratosPrevjud = { io, processar, capturas, avaliarDocumentos, montarCertidao, clicarSeguro, statusAtual, quandoDe, gruposDaLista };
  }
})();
