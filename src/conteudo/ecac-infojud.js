/*
 * ecac-infojud.js — automação INFOJUD dentro do eCAC. Roda em cav.receita.fazenda.gov.br.
 *
 * PORTADO do content.js da extensão InfoJOB v2.2.5 (aprovada e em produção no Chrome).
 * Regra deste port: NÃO alterar comportamento já validado. Mudam só:
 *   - chrome.*  -> browser.*
 *   - leitura/escrita de estado passa pelo Store (namespace cratos:) do CRATOS
 *   - a máquina de LOTE some (CRATOS é processo único, uma parte por vez)
 *
 * Os helpers de manipulação de DOM abaixo são JS puro (sem chrome.*) e portam
 * IDÊNTICOS ao original — nenhuma mudança de lógica.
 *
 * ====== PEDAÇO 2a: helpers de baixo nível + incluirPedido. ======
 */

if (window.__cratosEcacAtivo) {
  console.debug("CRATOS/INFOJUD: já ativo neste frame, ignorando reinjeção.");
} else {
  window.__cratosEcacAtivo = true;
  console.log("CRATOS/INFOJUD: content script injetado em", window.location.href, "| frame topo?", window.top === window.self);
  iniciarEcacInfojud();
}

function iniciarEcacInfojud() {

const INFOJUD_REG_BASE = "https://cav.receita.fazenda.gov.br/Servicos/ATSDR/Decjuiz/solicitacao.asp";
const CAIXA_POSTAL_URL = "https://cav.receita.fazenda.gov.br/ecac/Aplicacao.aspx?id=00006";
/* A porta do serviço (a casca do eCAC). O link profundo para `solicitacao.asp`
   parou de valer em 21/08 — a Receita redireciona para cá. `id=5032` é do eCAC
   FEDERAL, igual para todo tribunal: não é débito de nacionalização. */
const ECAC_ENTRADA_URL =
  "https://cav.receita.fazenda.gov.br/ecac/Aplicacao.aspx?id=5032&origem=menu";

/* ═══ ANOMALIAS DA EXECUÇÃO (21/08) ═══════════════════════════════════════
 * Tudo que sair do trilho durante um registro é anotado aqui — e é esta lista
 * que decide, no fim, se a aba pode ser fechada. Foi o que faltou no dia em que
 * o eCAC errou o combobox de anos: a extensão seguiu, terminou, fechou a aba e
 * levou junto a única evidência do que tinha acontecido.
 * A lista é zerada quando o background cria uma fila nova. */
async function anotarAnomalia(texto) {
  console.warn("CRATOS/INFOJUD: anomalia —", texto);
  try {
    const atuais = (await Store.get("ecac_anomalias")) || [];
    atuais.push({ em: Date.now(), texto: String(texto || "") });
    await Store.set("ecac_anomalias", atuais.slice(-30));
  } catch (e) { /* anotar é best-effort; nunca derruba o registro */ }
  /* Mesmo funil de sempre: o que vira aviso também alimenta o relatório. */
  try { CratosRelatorio.registrar("infojud", texto); } catch (e) {}
}

/* ═══ O ALERTA DO eCAC ═════════════════════════════════════════════════════
 * O `window.alert = ...` que morava aqui (herdado do InfoJOB) NÃO interceptava
 * nada: content script no Firefox enxerga a página por Xray, então a atribuição
 * ficava só do nosso lado e a página seguia chamando o alert nativo. Prova de
 * campo em 21/08 — o diálogo apareceu e o Rodrigo teve de clicar em OK. E a
 * mensagem `iframe_alert` que ele disparava não tinha handler nenhum no
 * background: o texto ia para o vazio.
 * Agora quem captura é o grampo no CONTEXTO DA PÁGINA (conteudo/ecac-grampo.js),
 * pelo mesmo caminho do censec-api.js. Ele NÃO engole o alerta: o diálogo
 * continua aparecendo — quem decide diante de um aviso da Receita é o usuário —
 * e nós ficamos com o texto. */
function injetarGrampoEcac() {
  try {
    const s = document.createElement("script");
    s.src = browser.runtime.getURL("conteudo/ecac-grampo.js");
    s.async = false;
    (document.head || document.documentElement).appendChild(s);
    s.onload = () => s.remove();
  } catch (e) {
    console.error("CRATOS/INFOJUD: falha ao injetar o grampo de alerta:", e);
  }
}
injetarGrampoEcac();

window.addEventListener("cratos:ecac:alerta", (ev) => {
  let dados = null;
  try { dados = JSON.parse(ev.detail); } catch (e) { dados = { texto: "(alerta ilegível)" }; }
  anotarAnomalia('o eCAC exibiu um alerta: "' + (dados.texto || "").slice(0, 300) + '"');
});

/*
 * Leitura da caixa postal SAME-ORIGIN. Como este content script roda em
 * *.receita.fazenda.gov.br, o fetch daqui leva o cookie de sessão naturalmente
 * (resolve o 403 que o background recebe por ser cross-origin). O background
 * pede "cp_fetch_mensagens" e este script devolve o JSON cru.
 */
/*
 * Leitura da caixa postal. A API do www3.cav exige um JWT no header Authorization
 * (o cookie sozinho dá 403). O app Angular guarda esse token no sessionStorage do
 * host www3.cav, na chave "tokenJWT". Como sessionStorage é isolado por host, este
 * fetch só funciona quando o content script roda numa aba de www3.cav/caixapostal/.
 * A extensão apenas reusa a credencial de sessão que o usuário logado já possui.
 */
browser.runtime.onMessage.addListener((msg) => {
  if (msg && msg.tipo === "cp_ping") {
    return Promise.resolve({ ok: true, host: location.host });
  }
  if (msg && msg.tipo === "cp_fetch_mensagens") {
    let token = null;
    try { token = sessionStorage.getItem("tokenJWT"); } catch (e) {}
    if (!token) {
      return Promise.resolve({ ok: false, erro: "sem_token", host: location.host });
    }
    const url = "https://www3.cav.receita.fazenda.gov.br/caixapostal/api/mensagens" +
                `?pagina=${msg.pagina || 0}&tamanho=${msg.tamanho || 50}&campoOrdenacao=dataEnvio&direcao=desc`;
    return fetch(url, {
      headers: { Accept: "application/json", Authorization: "Bearer " + token },
      credentials: "include",
    })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error("status " + r.status)))
      .then((json) => ({ ok: true, json }))
      .catch((e) => ({ ok: false, erro: String(e.message || e) }));
  }
});


/* ── helpers de baixo nível — IDÊNTICOS ao InfoJOB original ────────────── */

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/* Dois primeiros nomes (ignora abreviações com ponto). Usado para nomear PDFs. */
function doisPrimeirosNomes(nomeCompleto) {
  const tokens = (nomeCompleto || "").trim().split(/\s+/).filter((t) => !t.includes("."));
  return tokens.slice(0, 2).join(" ");
}

let contextoAtualColeta = { numProcesso: "", nomeAbrev: "", pasta: "CRATOS" };

/* Nome do arquivo para o fallback <a download> (mesmo padrão do background). */
function _montarNomeArquivo(ctx, tipoLabel, ni) {
  const limpar = (s) => String(s || "").replace(/[\/\\:*?"<>|]/g, "").trim();
  const proc = String((ctx && ctx.numProcesso) || ni || "").replace(/\D/g, "");
  const nome = limpar((ctx && ctx.nomeAbrev) || "");
  const tipo = limpar(tipoLabel);
  // <a download> não cria subpasta de forma confiável; prefixa no nome do arquivo.
  return `${proc}_${nome} ${tipo}.pdf`.replace(/\s+/g, " ");
}

function digitarTexto(input, texto) {
  input.focus();
  input.value = texto;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.blur();
}


/* ═══════════════════════════════════════════════════════════════════════════
 * SELEÇÃO DA VARA — três armadilhas do HTML real do eCAC (02/09)
 * ═══════════════════════════════════════════════════════════════════════════
 *  1. O `option value` vem PREENCHIDO COM ESPAÇOS à direita:
 *        <option value="001                 ">
 *     Comparar com `===` contra "001" nunca casa. Comparamos por trim.
 *  2. O texto visível tem espaços de sobra no meio:
 *        "001                  - 1ª Vara do Trabalho de Goiânia            "
 *     Casar por texto exige normalizar o branco — `includes` cru falha.
 *  3. ⛔ QUEM PREENCHE O CAMPO `nomevara` É O `onchange` DA PÁGINA:
 *        options[...].text.split(' - ')[1]
 *     Setar `.value` sem disparar `change` deixa o `nomevara` VAZIO e a
 *     solicitação sai sem a vara. Por isso o evento é obrigatório aqui.
 *
 * Aceita config nova (código "001") e a antiga (nome colado à mão), porque
 * quem já tinha a Preferência preenchida não pode ver o pedido sair sem vara
 * depois de uma atualização.
 */
function selecionarVara(select, valor) {
  const alvo = String(valor || "").trim();
  if (!alvo) return false;
  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();

  let escolhida = null;
  /* 1º: código exato (o formato novo). Sem `includes`: "011" não pode casar
     com outra opção por acaso. */
  for (const opt of select.options) {
    if (String(opt.value).trim() === alvo) { escolhida = opt; break; }
  }
  /* 2º: config antiga, com o nome colado. Normaliza o branco dos dois lados. */
  if (!escolhida) {
    const a = norm(alvo);
    for (const opt of select.options) {
      if (!opt.value.trim()) continue;               // pula o "Selecione"
      if (norm(opt.text) === a) { escolhida = opt; break; }
    }
  }
  /* 3º: contém — último recurso, e SÓ se casar uma única opção. Casar várias e
     escolher a primeira foi o que fazia "Vara do Trabalho de Goiânia" virar a
     1ª sem ninguém saber. */
  if (!escolhida) {
    const a = norm(alvo);
    const candidatas = Array.from(select.options)
      .filter((o) => o.value.trim() && norm(o.text).includes(a));
    if (candidatas.length === 1) escolhida = candidatas[0];
    else if (candidatas.length > 1) {
      CratosFaixa.alertar("infojud", 'a vara configurada ("' + alvo + '") casa com ' +
        candidatas.length + " varas da lista do eCAC. Escolhi nenhuma: abra as " +
        "Preferências do CRATOS e selecione a vara na lista.");
      return false;
    }
  }

  if (!escolhida) {
    /* Antes isto era um console.warn: o pedido seguia sem vara, calado. */
    CratosFaixa.alertar("infojud", 'não achei a vara "' + alvo + '" na lista do eCAC. ' +
      "A solicitação vai sair SEM vara se você enviar assim — configure nas " +
      "Preferências do CRATOS.");
    return false;
  }

  select.value = escolhida.value;
  /* ⛔ O `change` não é enfeite: é ele que preenche o `nomevara` do eCAC. */
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function selecionarOpcaoTexto(select, texto) {
  const t = texto.toLowerCase();
  for (const opt of select.options) {
    if (opt.text.toLowerCase().includes(t) || opt.value.toLowerCase().includes(t)) {
      select.value = opt.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
  }
  console.warn("CRATOS/INFOJUD: opção não encontrada em", select.name, ":", texto);
  return false;
}

/* O eCAC informa o estouro do limite numa célula `td.Erro`. O número (10) vem
   do SERVIDOR, então não se crava: detecta-se a mensagem. */
function limiteExcedidoNaTela() {
  const norm = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ").trim().toLowerCase();
  return Array.from(document.querySelectorAll("td.Erro, td[class*='rro'], .Erro"))
    .some((td) => /quantidade de pedidos por solicitacao excedida/.test(norm(td.textContent)));
}

function contarPedidosNaTabela() {
  return document.querySelectorAll("td.azulDireita, td.brancoDireita").length;
}

function pedidoJaIncluso(tipo, ano, dataIni) {
  const normalizar = (s) => s.toLowerCase().replace(/[\s\/\.\-]/g, "");
  const tipoNorm = normalizar(tipo).substring(0, 4);

  for (const tr of document.querySelectorAll("table tr")) {
    const tds = tr.querySelectorAll("td");
    if (tds.length < 4) continue;
    const tipoNaTabela = normalizar(tds[2]?.textContent || "");
    const anoNaTabela = (tds[3]?.textContent || "").trim();
    const bate = tipoNaTabela.startsWith(tipoNorm) || tipoNorm.startsWith(tipoNaTabela.substring(0, 4));
    if (bate) {
      if (dataIni) {
        if (anoNaTabela.includes(dataIni)) return true;
      } else if (!ano || anoNaTabela.includes(String(ano))) return true;
    }
  }
  return false;
}

async function clicarEnviar() {
  const btn = Array.from(document.querySelectorAll("input,button"))
    .find((b) => (b.value || b.textContent || "").trim() === "Enviar");
  if (!btn) {
    return CratosFaixa.parar("infojud",
      "não achei o botão 'Enviar' desta tela do eCAC. Se ele estiver aí, envie " +
      "à mão; o pedido já está preenchido.");
  }
  btn.click();
}

function mesAnoCorrente() {
  const now = new Date();
  return String(now.getMonth() + 1).padStart(2, "0") + "/" + now.getFullYear();
}

/* ── incluirPedido — o coração da inclusão. Fiel ao original ───────────── */

async function incluirPedido(ni, tipo, opcoes) {
  /* ═══ PRIMEIRO OLHA A TABELA, DEPOIS MEXE NA TELA (recon de 21/08) ═══
   * Cada "Incluir Pedido" é um POST que RECARREGA a página — 7 submits para 6
   * pedidos, no recon. Ou seja: o content script reinicia a cada inclusão e
   * refaz a passada inteira, encontrando os pedidos anteriores já na tabela.
   * Esta consulta morava lá embaixo, DEPOIS de já ter selecionado tipo e ano —
   * então cada pedido já incluído era reselecionado só para ser descartado em
   * seguida. É exatamente a "revisão dos itens lançados" que o Rodrigo via
   * desde o começo, e que sobreviveu às duas otimizações da 1.0.5: elas
   * economizavam DENTRO de uma passada, e o problema estava ENTRE as passadas.
   * A tabela é a fonte da verdade e não depende de nada do formulário. */
  if (pedidoJaIncluso(tipo, opcoes.ano, opcoes.dataIni)) {
    console.log("CRATOS/INFOJUD: já está na tabela, não mexo na tela:", tipo, opcoes.dataIni || opcoes.ano || "");
    return { ok: true, jaEstava: true };
  }

  console.log("CRATOS/INFOJUD: incluindo", tipo, opcoes.ano || opcoes.dataIni || "");

  const inputNI = document.querySelector('input[name="novocpfcnpj"]');
  const selectTipo = document.querySelector('select[name="novotipo"]');
  const inputIni = document.querySelector('input[name="novaDataInicio"]');
  const inputFim = document.querySelector('input[name="novaDataFim"]');

  if (!inputNI || !selectTipo) {
    CratosFaixa.parar("infojud",
      "a tela de pedido do eCAC não trouxe os campos de CPF/CNPJ e tipo de " +
      "declaração. Se a sua sessão caiu, entre de novo e execute outra vez.");
    return { ok: false, tipo, semFormulario: true };
  }

  /* O formulário do eCAC NÃO limpa depois de "Incluir Pedido" (print do Rodrigo,
     21/08): CPF/CNPJ, tipo e ano ficam como estavam. Então só mexemos no que
     realmente mudou — cada campo reescrito à toa custa uma ida ao servidor e um
     dropdown reconstruído. */
  const soDigitos = (x) => String(x || "").replace(/\D/g, "");
  if (soDigitos(inputNI.value) !== soDigitos(ni)) {
    inputNI.value = "";
    digitarTexto(inputNI, ni);
    await sleep(300);
  }

  /* O TIPO SE DECIDE PELA TELA, NÃO POR VARIÁVEL NOSSA.
     A 1.0.5 passava um `tipoJaSelecionado` calculado a partir do pedido
     ANTERIOR DA LISTA. Com a consulta à tabela lá em cima, isso viraria
     armadilha: pedido pulado não mexe no formulário, e a variável passaria a
     mentir sobre o que está selecionado — dois pedidos seguidos do mesmo tipo,
     o primeiro pulado, e o segundo iria com o tipo que estivesse na tela.
     Mesma regra do NI, dois blocos acima: pergunta à tela e só mexe se estiver
     diferente. Uma fonte da verdade, e ela é a página. */
  const rotuloAtual = (selectTipo.options[selectTipo.selectedIndex] || {}).text || "";
  if (!rotuloAtual.toLowerCase().includes(String(tipo).toLowerCase())) {
    selecionarOpcaoTexto(selectTipo, tipo);
    await sleep(800);
  }

  if (opcoes.ano) {
    const jaEsta = () => {
      const s = document.querySelector('select[name="novoano"]');
      if (!s || s.disabled) return false;
      const op = s.options[s.selectedIndex];
      return !!op && op.text.trim() === String(opcoes.ano);
    };
    let selecionou = jaEsta();   // o ano sobrevive à inclusão anterior
    for (let t = 0; !selecionou && t < 20; t++) {
      const s = document.querySelector('select[name="novoano"]');
      if (s && !s.disabled &&
          Array.from(s.options).some((o) => o.text.trim() === String(opcoes.ano))) {
        selecionou = selecionarOpcaoTexto(s, String(opcoes.ano));
        if (selecionou) break;
      }
      await sleep(300);   // espera DEPOIS de tentar, não antes
    }
    /* ⛔ PARADA DURA (21/08). Antes daqui saía um `console.warn` e o código
       seguia para o clique — com o combobox de anos quebrado, isso mandaria
       pedido com o ano do pedido ANTERIOR (que sobrevive à inclusão) ou sem ano
       nenhum, e logo depois viria o Enviar. Solicitação registrada errada na
       Receita é pior que solicitação não registrada: a errada parece certa. */
    if (!selecionou) {
      await anotarAnomalia(
        `o eCAC não ofereceu o ano ${opcoes.ano} para ${tipo}. Nada foi incluído ` +
        `para este pedido e NADA foi enviado.`);
      return { ok: false, tipo, ano: opcoes.ano };
    }
    await sleep(200);
  }

  if (opcoes.dataIni && inputIni) {
    inputIni.focus(); inputIni.value = opcoes.dataIni;
    inputIni.dispatchEvent(new Event("input", { bubbles: true }));
    inputIni.dispatchEvent(new Event("change", { bubbles: true }));
    inputIni.blur(); await sleep(200);
  }
  if (opcoes.dataFim && inputFim) {
    inputFim.focus(); inputFim.value = opcoes.dataFim;
    inputFim.dispatchEvent(new Event("input", { bubbles: true }));
    inputFim.dispatchEvent(new Event("change", { bubbles: true }));
    inputFim.blur(); await sleep(200);
  }

  if (tipo === "eFinanceira") {
    await sleep(400);
    const sConta = document.querySelector('select[name="novoTipoConta"]');
    const sRelacao = document.querySelector('select[name="novoTipoRelacao"]');
    const sCambio = document.querySelector('select[name="novoInfoCambio"]');
    const sExtrato = document.querySelector('select[name="novoTipoExtrato"]');
    const iDataIni = document.querySelector('input[name="novaDataInicio"]');
    const iDataFim = document.querySelector('input[name="novaDataFim"]');
    if (sConta && opcoes.conta) selecionarOpcaoTexto(sConta, opcoes.conta);
    if (sRelacao && opcoes.relacao) selecionarOpcaoTexto(sRelacao, opcoes.relacao);
    if (sCambio && opcoes.cambio) selecionarOpcaoTexto(sCambio, opcoes.cambio);
    if (sExtrato && opcoes.extrato) selecionarOpcaoTexto(sExtrato, opcoes.extrato);
    if (iDataIni && opcoes.dataIni) {
      iDataIni.focus(); iDataIni.value = opcoes.dataIni;
      iDataIni.dispatchEvent(new Event("input", { bubbles: true }));
      iDataIni.dispatchEvent(new Event("change", { bubbles: true }));
      iDataIni.blur();
    }
    if (iDataFim && opcoes.dataFim) {
      iDataFim.focus(); iDataFim.value = opcoes.dataFim;
      iDataFim.dispatchEvent(new Event("input", { bubbles: true }));
      iDataFim.dispatchEvent(new Event("change", { bubbles: true }));
      iDataFim.blur();
    }
    await sleep(300);
  }

  /* (A consulta a `pedidoJaIncluso` que ficava aqui subiu para o topo da função.
     Nada entre um ponto e outro mexe na tabela — o único que mexe é o clique
     abaixo —, então repetir a pergunta seria só uma segunda cópia da mesma
     decisão. Uma responsabilidade, um lugar.) */
  const linhasAntes = contarPedidosNaTabela();

  const btns = Array.from(document.querySelectorAll("input,button"))
    .filter((b) => (b.value || b.textContent || "").trim().includes("Incluir Pedido"));
  if (btns.length === 0) {
    CratosFaixa.parar("infojud",
      "não achei o botão 'Incluir Pedido' na tela do eCAC. Confira a tela: se " +
      "ele estiver aí, siga à mão a partir deste ponto.");
    return { ok: false, tipo, semBotao: true };
  }

  btns[btns.length - 1].click();

  let incluido = false;
  for (let t = 0; t < 15; t++) {
    await sleep(500);
    if (contarPedidosNaTabela() > linhasAntes) { incluido = true; break; }
  }
  if (!incluido) {
    /* Não é parada dura: o pedido pode ter entrado sem a tabela crescer (o eCAC
       responde "Pedido já existente." nesse caso). Mas fica anotado — e anomalia
       anotada é aba que não fecha. */
    await anotarAnomalia(
      `o pedido ${tipo} ${opcoes.ano || opcoes.dataIni || ""} não apareceu na ` +
      `tabela depois do clique em "Incluir Pedido".`);
    return { ok: true, naoConfirmado: true, tipo };
  }
  return { ok: true };
}

/*
 * ====== PEDAÇO 2b: orquestração de registro. ======
 * gerarListaPedidos adaptado à config do CRATOS (5 tipos escolhidos, não os 10
 * do InfoJOB completo). lerAnosDoDropdown, incluirComAnos, incluirEFinanceira e
 * preencherCabecalho portados fiéis — muda só a ORIGEM do número do processo
 * (vem da captura do PJe) e os nomes de log.
 */

/* ═══════════════════════════════════════════════════════════════════════════
 * DESCOBERTA DE ANOS SEM FOLHEAR O MENU (21/08)
 *
 * O que o Rodrigo via: antes de incluir qualquer pedido, o CRATOS percorria a
 * lista de tipos SÓ para descobrir quais anos existiam — selecionando cada um
 * no dropdown de verdade e esperando o eCAC repovoar os anos. Era a extensão
 * folheando o menu na frente dele.
 *
 * O recon de 21/08 mostrou de onde os anos vêm:
 *   GET ArquiteturaNova/Ajax/ExerciciosTipoDeclaracaoAjax.asp?tipo=N&ano=-1
 *     → <select id="novoano">…<option value="2026">2026</option>…</select>
 *
 * Então buscamos isso direto, same-origin, dentro do frame — todos os tipos em
 * PARALELO. Zero cliques, zero espera de repovoamento.
 *
 * A GARANTIA NÃO MUDOU: os anos continuam sendo os que o eCAC realmente oferece
 * para aquele tipo, porque a FONTE é a mesma. Deixamos de perguntar pela
 * interface, não de perguntar.
 *
 * O número do tipo sai do próprio `<option value>` — nada é cravado.
 * ═══════════════════════════════════════════════════════════════════════════ */
const AJAX_ANOS = "ArquiteturaNova/Ajax/ExerciciosTipoDeclaracaoAjax.asp";

function valorDoTipo(rotulo) {
  const sel = document.querySelector('select[name="novotipo"]');
  if (!sel) return null;
  const alvo = String(rotulo || "").toLowerCase();
  for (const o of sel.options) {
    if (o.text.toLowerCase().includes(alvo)) return o.value;
  }
  return null;
}

/* A cara da página de erro do eCAC (produção, 21/08): o serviço devolve, com
   status 200 ou 500, a tela do app de AUTENTICAÇÃO — "Ocorreu um erro interno na
   aplicação" com link para /autenticacao/Login. Isso não é "o endpoint não
   existe", é "a sessão/o servidor caiu", e as duas coisas pedem respostas
   diferentes: da primeira dá para se recuperar pelo dropdown, da segunda não. */
function ehPaginaDeErroEcac(html) {
  const t = String(html || "");
  return /autenticacao\/Login/i.test(t) ||
         /Ocorreu um erro interno na aplica/i.test(t) ||
         /id="barra-brasil"/i.test(t) && /class="error"/i.test(t);
}

async function anosPorAjax(tipo, qtd) {
  const valor = valorDoTipo(tipo);
  if (!valor || valor === "-1") return null;   // null = "não sei", cai no dropdown
  try {
    const url = new URL(AJAX_ANOS, location.href);
    url.searchParams.set("tipo", valor);
    url.searchParams.set("ano", "-1");
    const r = await fetch(url.href, { credentials: "same-origin" });
    const html = await r.text();
    if (ehPaginaDeErroEcac(html)) {
      await anotarAnomalia(
        `ao pedir os anos de ${tipo}, o e-CAC respondeu com a página de erro do ` +
        `login (status ${r.status}) em vez da lista. Isso costuma ser sessão ` +
        `caída ou instabilidade da Receita.`);
      return null;                             // ainda tenta o dropdown — mas agora com rastro
    }
    if (!r.ok) {
      await anotarAnomalia(`a consulta de anos de ${tipo} voltou com status ${r.status}.`);
      return null;
    }
    /* Parse sem tocar no documento: DOMParser não executa script nem mexe na
       página que está aberta. */
    const doc = new DOMParser().parseFromString(html, "text/html");
    const anos = Array.from(doc.querySelectorAll("option"))
      .map((o) => (o.textContent || "").trim())
      .filter((t) => /^\d{4}$/.test(t));
    if (!anos.length) return [];               // [] = o eCAC não oferece ano nenhum
    return anos.slice(0, qtd);
  } catch (e) {
    console.warn("CRATOS/INFOJUD: AJAX de anos falhou para", tipo, "—", e.message);
    return null;                               // cai no caminho antigo
  }
}

async function lerAnosDoDropdown(tipo, qtd) {
  const selectTipo = document.querySelector('select[name="novotipo"]');
  if (!selectTipo) { console.warn("CRATOS/INFOJUD: select tipo não encontrado para", tipo); return []; }
  selecionarOpcaoTexto(selectTipo, tipo);
  await sleep(800);
  for (let t = 0; t < 20; t++) {
    await sleep(500);
    const s = document.querySelector('select[name="novoano"]');
    if (!s) continue;
    const opts = Array.from(s.options);
    if (opts.some((o) => /carregando|loading/i.test(o.text))) continue;
    const anos = opts.filter((o) => /^\d{4}$/.test(o.text.trim())).map((o) => o.text.trim());
    if (anos.length > 0) return anos.slice(0, qtd);
    if (opts.length <= 1) {
      console.warn("CRATOS/INFOJUD: tipo sem anos disponíveis no eCAC:", tipo);
      return [];
    }
  }
  console.warn("CRATOS/INFOJUD: timeout ao carregar anos para", tipo);
  return [];
}

/*
 * Monta a lista plana de pedidos a partir da config do módulo CRATOS.
 * cfg é o objeto de config do infojud (dirpf/doi/ditr/dimob/decred com {ativo, anos}).
 * Aplica-se tanto a CPF quanto a CNPJ; os tipos escolhidos valem para ambos os NIs
 * que o INFOJUD aceita nesta versão simplificada. A distinção fina CPF/CNPJ do
 * InfoJOB original (DIPJ, ECF, CPMF só para PJ) fica de fora nesta seleção enxuta —
 * se um tribunal precisar, entra como novo campo de config, sem tocar no motor.
 */
/*
 * Monta a lista de pedidos respeitando a aplicabilidade de cada tipo por NI
 * (regra do eCAC, fiel ao InfoJOB):
 *   Só CPF:  DIRPF
 *   Só CNPJ: DIPJ/PJ SIMPL, ECF, CPMF
 *   Ambos:   DITR, DOI, DECRED, DIMOB, Info. Cadastrais, eFinanceira
 */
async function gerarListaPedidos(pedidoParte, cfgCompleto) {
  const ni = pedidoParte.ni;
  const ehCPF = pedidoParte.tipo === "CPF";
  // config independente por NI: usa o grupo cpf ou cnpj
  const cfg = (ehCPF ? cfgCompleto?.cpf : cfgCompleto?.cnpj) || {};
  const lista = [];
  const anoAtual = new Date().getFullYear();

  async function addAnos(tipoEcac, qtd) {
    /* Tenta pelo AJAX (sem mexer na tela). `null` significa "não consegui
       perguntar" — aí, e só aí, voltamos a dirigir o dropdown. Um array vazio é
       resposta legítima: o eCAC não tem ano para esse tipo. */
    let anos = await anosPorAjax(tipoEcac, qtd);
    if (anos === null) {
      console.log("CRATOS/INFOJUD: AJAX indisponível para", tipoEcac, "— usando o dropdown.");
      anos = await lerAnosDoDropdown(tipoEcac, qtd);
    }
    if (anos.length === 0) console.warn("CRATOS/INFOJUD: nenhum ano disponível para", tipoEcac);
    for (const ano of anos) lista.push({ tipo: tipoEcac, opcoes: { ano }, ni });
  }

  // O grupo já contém só os tipos aplicáveis àquele NI (cpf tem dirpf; cnpj tem dipj/ecf/cpmf).
  // Ainda assim mantemos a checagem de NI como salvaguarda.
  if (ehCPF && cfg.dirpf?.ativo) await addAnos("DIRPF", parseInt(cfg.dirpf.anos) || 3);
  if (!ehCPF && cfg.dipj?.ativo) await addAnos("DIPJ/PJ SIMPL", parseInt(cfg.dipj.anos) || 2);
  if (!ehCPF && cfg.ecf?.ativo)  await addAnos("ECF (Substitui IRPJ)", parseInt(cfg.ecf.anos) || 2);
  if (!ehCPF && cfg.cpmf?.ativo) lista.push({ tipo: "CPMF", opcoes: { dataIni: "01/1997", dataFim: "12/2007" }, ni });

  // Comuns aos dois NIs
  if (cfg.doi?.ativo)     lista.push({ tipo: "DOI", opcoes: { dataIni: "01/1980", dataFim: mesAnoCorrente() }, ni });
  if (cfg.ditr?.ativo)    await addAnos("DITR", parseInt(cfg.ditr.anos) || 2);
  if (cfg.dimob?.ativo)   await addAnos("DIMOB", parseInt(cfg.dimob.anos) || 2);
  if (cfg.decred?.ativo)  await addAnos("DECRED", parseInt(cfg.decred.anos) || 2);
  if (cfg.infocad?.ativo) lista.push({ tipo: "Info. Cadastrais", opcoes: {}, ni });
  if (cfg.efin?.ativo) {
    const qtd = parseInt(cfg.efin.anos) || 1;
    for (let i = 1; i <= qtd; i++) {
      const ano = anoAtual - i;
      lista.push({ tipo: "eFinanceira", opcoes: { dataIni: "01/" + ano, dataFim: "12/" + ano }, ni });
    }
  }

  return lista;
}

/* ═══ SÓ TROCA O QUE MUDOU ═══
 * O print do Rodrigo (21/08) provou que, depois de "Incluir Pedido", o
 * formulário FICA PREENCHIDO — CPF/CNPJ, tipo e ano, todos como estavam. E o
 * próprio eCAC barra repetição com "Pedido já existente."
 *
 * Até a 1.0.4 a fila reselecionava o tipo em TODO pedido (`tipoJaSelecionado`
 * existia no `incluirPedido` e nunca era usado). Para DIRPF 2026/2025/2024 isso
 * significava escolher DIRPF três vezes, e cada escolha manda o eCAC reconstruir
 * o dropdown de anos do zero — para depois esperar os anos aparecerem de novo.
 * Só o ANO precisava mudar.
 *
 * A 1.0.5 resolveu isso comparando com o pedido ANTERIOR DA LISTA. Funcionava,
 * mas era a pergunta errada: o recon de 21/08 mostrou que cada inclusão é um
 * POST que RECARREGA a página, então esta função quase nunca chega ao segundo
 * pedido — ela recomeça do zero a cada volta, e a variável de passada não sabe
 * de nada disso. Quem sabe é a TELA. Desde a 1.0.7 quem decide é o próprio
 * `incluirPedido`, lendo a tabela e o `<select>`; esta função só percorre a
 * lista e para no primeiro pedido que não deu certo. */
async function incluirPedidosDaFila(lista) {
  const feitos = [];
  for (const pedido of lista) {
    const r = await incluirPedido(pedido.ni, pedido.tipo, pedido.opcoes);
    /* Um pedido que não deu certo INTERROMPE a fila. Seguir em frente
       significaria enviar uma solicitação incompleta sem ninguém saber — e o
       Enviar vem logo depois desta função. */
    if (r && r.ok === false) return { ok: false, falhou: r, feitos: feitos.length };
    feitos.push(pedido);
  }
  return { ok: true, feitos: feitos.length };
}

/*
 * preencherCabecalho — portado do InfoJOB. Única mudança: o número do processo
 * vem de pedidoParte.processo (origem: captura do PJe). Vara, tipo, justificativa
 * e magistrado vêm da config (texto livre — cada tribunal cola sua string).
 */
async function preencherCabecalho(pedidoParte, cfg) {
  console.log("CRATOS/INFOJUD: preenchendo cabeçalho para", pedidoParte.nomeAbrev);
  await sleep(800);

  const inputProcesso = document.querySelector('input[name="processo"]');
  const selectTipo = document.querySelector('select[name="tipos de processo"]');
  const selectVara = document.querySelector('select[name="nomevara"], select[name="siglavara"]');
  const selectMagistrado = document.querySelector('select[name="cpfmagistrado"]');
  const textarea = document.querySelector("textarea");

  if (inputProcesso) { digitarTexto(inputProcesso, String(pedidoParte.processo).replace(/\D/g, "")); await sleep(300); }
  if (selectTipo && cfg.tipoProcesso) { selecionarOpcaoTexto(selectTipo, cfg.tipoProcesso); await sleep(300); }
  if (selectVara && cfg.vara) { selecionarVara(selectVara, cfg.vara); await sleep(300); }
  if (textarea && cfg.justificativa) {
    textarea.value = cfg.justificativa;
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
  }

  if (selectMagistrado && cfg.magistrado) {
    const nomeMag = cfg.magistrado.trim().toUpperCase();
    const opcoes = Array.from(selectMagistrado.options);
    const match = opcoes.find((o) => o.text.trim().toUpperCase().includes(nomeMag));
    if (match) {
      selectMagistrado.value = match.value;
      selectMagistrado.dispatchEvent(new Event("change", { bubbles: true }));
      await sleep(300);
      console.log("CRATOS/INFOJUD: magistrado selecionado:", match.text.trim());
    } else {
      console.warn("CRATOS/INFOJUD: magistrado não encontrado no dropdown:", nomeMag);
    }
  }

  console.log("CRATOS/INFOJUD: cabeçalho preenchido");
}

/* Captura do nome oficial do contribuinte no eCAC — fiel ao original.
   Usado para nomear a parte pelo nome que a Receita reconhece. */
function extrairNomeEcac() {
  try {
    const linhas = document.querySelectorAll("tr");
    for (const tr of linhas) {
      const inputNome = tr.querySelector('input[name="nome"]');
      if (inputNome && inputNome.value.trim().length > 2) return inputNome.value.trim();
    }
    const tds = document.querySelectorAll("td.brancoEsquerda");
    for (const td of tds) {
      const txt = td.textContent.trim();
      if (!txt || txt.length < 4) continue;
      if (/[/:]/.test(txt)) continue;
      if (/^\d+$/.test(txt)) continue;
      if (/^[\d.\-/]+$/.test(txt)) continue;
      return txt;
    }
  } catch (e) {
    console.warn("CRATOS/INFOJUD: não foi possível extrair nome do eCAC:", e.message);
  }
  return null;
}

/*
 * ====== PEDAÇO 2c: ponto de entrada do registro (SEM lote, SEM coleta). ======
 * Ao carregar na tela de solicitação do eCAC, pede a fila ao background e registra
 * as partes uma a uma. Processo único, sem a máquina de lote do InfoJOB original.
 * Ao terminar o registro de cada parte, clica Enviar e trata a página de confirmação.
 */

async function iniciarRegistroEcac() {
  const url = window.location.href;

  // Chave global liga/desliga: desligado, o INFOJUD não age no eCAC.
  try { if (!(await Store.ligada())) { console.log("CRATOS/INFOJUD: extensão desligada."); return; } } catch (e) {}

  // Página de confirmação do eCAC (uma solicitação por parte foi enviada).
  // NÃO dependemos do botão "Voltar" — o destino dele é incerto (pode cair no menu
  // do DECJUIZ e não em solicitacao.asp, matando o loop na 2ª parte). Em vez disso,
  // consultamos a fila: se ainda há parte a registrar, navegamos por GET explícito
  // para uma solicitacao.asp NOVA (prova de que funciona: abrirEcacERegistrar abre
  // exatamente essa URL por GET). idx já foi incrementado antes do Enviar.
  if (url.includes("msgsolicitacao.asp")) {
    await sleep(1200);
    const respConf = await browser.runtime.sendMessage({ tipo: "ecac_pronto" }).catch(() => null);
    const f = respConf && respConf.fila;
    if (f && f.partes && f.idx < f.partes.length) {
      const prox = f.partes[f.idx];
      console.log(`CRATOS/INFOJUD: confirmação recebida — próxima parte [${f.idx + 1}/${f.partes.length}] ${prox?.nomeAbrev || ""} (${prox?.tipo || "?"}). Abrindo nova solicitação...`);
      window.location.href = INFOJUD_REG_BASE;   // GET fresco, independe do "Voltar"
    } else if (f && f.partes && f.idx >= f.partes.length) {
      console.log("CRATOS/INFOJUD: confirmação recebida — todas as partes registradas. Fim do registro.");
      await finalizarRegistro();
    } else {
      // Sem fila do CRATOS nesta aba (ex.: visita manual ao eCAC) — não age.
      console.debug("CRATOS/INFOJUD: msgsolicitacao.asp sem fila do CRATOS, ignorando.");
    }
    return;
  }

  /* ═══ MENU DO SERVIÇO: a porta de entrada nova ═══
   * O eCAC serve o DECJUIZ dentro de um iframe, e o primeiro que carrega é o
   * MENU (`principal.asp`), não a tela de registro. Um clique em "Registrar
   * Solicitação" leva ao `solicitacao.asp` — e daí o fluxo de sempre assume.
   *
   * Ancorado no ELEMENTO, não na URL: é a lição do CENSEC. Se um dia a Receita
   * mudar a rota outra vez, o link continua sendo o link. */
  if (/Decjuiz\/principal\.asp/i.test(url)) {
    (async () => {
      let fila = null;
      try { fila = await Store.get("ecac_fila"); } catch (e) {}
      if (!fila || !fila.partes || fila.idx >= fila.partes.length) return;  // não é nosso
      if (window.__cratosEntrouMenu) return;
      /* Reusa o `aguardarElemento` que já existe aqui — com um seletor amplo e
         filtro por texto, porque o link não tem id nem classe própria. */
      const achar = () => Array.from(document.querySelectorAll("a")).find((a) =>
        /registrar\s+solicita/i.test((a.textContent || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")));
      const link = await new Promise((resolve) => {
        const t0 = Date.now();
        const bate = () => {
          const el = achar();
          if (el) return resolve(el);
          if (Date.now() - t0 > 8000) return resolve(null);   // o menu já está carregado: 8s basta e avisa antes
          setTimeout(bate, 300);
        };
        bate();
      });
      if (!link) {
        return CratosFaixa.parar("infojud",
          "cheguei no menu do INFOJUD mas não achei o link 'Registrar Solicitação'. " +
          "Entre por ele à mão e execute de novo.");
      }
      window.__cratosEntrouMenu = true;
      console.log("CRATOS/INFOJUD: menu do DECJUIZ — entrando por 'Registrar Solicitação'.");
      await Store.set("ecac_progresso", { em: Date.now(), onde: "menu" });
      link.click();
    })();
    return;
  }

  if (!url.includes("solicitacao.asp")) {
    /* ═══ NÃO É A TELA DE REGISTRO ═══
     * Sair calado aqui é CERTO como comportamento (a extensão não deve agir em
     * página aleatória da Receita) e ERRADO como experiência: o painel fica em
     * "Executando… — INFOJUD" para sempre.
     *
     * Foi o que aconteceu em produção (Rodrigo, 20/08): o CRATOS abriu
     * `solicitacao.asp`, a Receita REDIRECIONOU para o portal do eCAC — porque a
     * sessão gov.br não estava ativa — e ninguém disse nada. Abrir o site à mão
     * também não resolvia: o portal não é `solicitacao.asp`, então o content
     * script continuava (corretamente) parado.
     *
     * Agora: se existe fila do CRATOS e a gente NÃO chegou na tela de registro,
     * isso é uma falha e tem de aparecer. Só no frame de topo, e só depois de
     * uma reconferida — durante a navegação a URL passa por páginas
     * intermediárias, e avisar cedo demais seria alarme falso. */
    /* ⚠️ ALARME FALSO CORRIGIDO (21/08). Este ramo roda no frame de TOPO — e o
       topo do eCAC é `Aplicacao.aspx` PARA SEMPRE, porque o serviço mora num
       IFRAME. A versão anterior via "não é solicitacao.asp", esperava 3s e
       gritava "o eCAC não abriu a tela do INFOJUD" enquanto, do lado de dentro,
       tudo estava funcionando. O Rodrigo viu a faixa vermelha com o registro
       correndo normalmente atrás dela.
       Agora o topo NÃO julga pela própria URL: ele espera o FRAME dizer que
       chegou (`ecac_progresso`). Só reclama se, passado o tempo, nenhum frame
       nosso deu sinal de vida — que é a única situação em que há mesmo falha. */
    if (window.top === window.self && !window.__cratosAvisouEcac) {
      (async () => {
        let fila = null;
        try { fila = await Store.get("ecac_fila"); } catch (e) {}
        if (!fila || !fila.partes || fila.idx >= fila.partes.length) return;
        const nascimento = Date.parse(fila.criadoEm || "") || 0;

        /* ═══ ENTRAR SOZINHO DEPOIS DO LOGIN (pedido do Rodrigo, 02/09) ═══
         * O caso real: o CRATOS abre o serviço, a Receita joga para o login do
         * gov.br, o usuário se autentica — e cai no PORTAL do eCAC, não no
         * INFOJUD. Até aqui a extensão só avisava "entre à mão".
         * Agora ela entra: navega uma vez para a casca do serviço
         * (`Aplicacao.aspx?id=5032`), e o ramo do MENU faz o resto, clicando em
         * "Registrar Solicitação" — o caminho que o recon de 21/08 mapeou.
         *
         * Três travas, porque navegar sozinho é o tipo de coisa que vira laço:
         *  1. UMA VEZ por execução (chave de sessão carimbada com o nascimento
         *     da fila) — mesma receita da recarga única do CENSEC;
         *  2. só no host da Receita. Se ainda estamos no gov.br, o usuário está
         *     no meio do login e navegar seria atropelá-lo;
         *  3. só se nenhum frame nosso já tiver dado sinal de vida, e nunca
         *     estando já na casca do serviço (senão recarrega em círculo). */
        const marca = "cratos_ecac_entrou_" + nascimento;
        const naReceita = /(^|\.)cav\.receita\.fazenda\.gov\.br$/.test(location.hostname);
        const jaNaCasca = /Aplicacao\.aspx/i.test(location.href) && /id=5032/i.test(location.href);
        if (naReceita && !jaNaCasca && !sessionStorage.getItem(marca)) {
          await new Promise((r) => setTimeout(r, 3000));   // deixa a navegação assentar
          let prog0 = null;
          try { prog0 = await Store.get("ecac_progresso"); } catch (e) {}
          if (!(prog0 && prog0.em >= nascimento) && !location.href.includes("solicitacao.asp")) {
            sessionStorage.setItem(marca, "1");
            CratosFaixa.dizer("infojud", "entrando no serviço do INFOJUD…");
            console.log("CRATOS/INFOJUD: caí em", location.pathname,
              "— navegando sozinho para a casca do serviço.");
            location.assign(ECAC_ENTRADA_URL);
            return;   // a página vai embora; o content script renasce lá
          }
        }

        await new Promise((r) => setTimeout(r, 20000));
        if (window.__cratosAvisouEcac) return;
        let prog = null;
        try { prog = await Store.get("ecac_progresso"); } catch (e) {}
        if (prog && prog.em >= nascimento) return;   // o frame chegou: nada a reclamar
        if (location.href.includes("solicitacao.asp")) return;
        window.__cratosAvisouEcac = true;
        CratosFaixa.parar("infojud",
          "o eCAC não abriu a tela de solicitação do INFOJUD — caí em " +
          location.hostname + location.pathname + " e tentei entrar no serviço " +
          "sozinho, sem sucesso. Confira se a sua sessão do gov.br está ativa nesta " +
          "aba; se estiver, entre à mão (Menu > Registrar Solicitação) e execute de novo.");
      })();
    }
    return;
  }

  // all_frames injeta no topo E no frame. Só age o contexto que realmente tem
  // o formulário de registro (o campo de cabeçalho "processo"). O outro sai calado,
  // evitando dupla execução e preenchimento fantasma.
  if (!document.querySelector('input[name="processo"]') &&
      !document.querySelector('input[name="novocpfcnpj"]')) {
    console.debug("CRATOS/INFOJUD: contexto sem formulário de registro, ignorando.");
    return;
  }

  const resp = await browser.runtime.sendMessage({ tipo: "ecac_pronto" }).catch((e) => {
    console.warn("CRATOS/INFOJUD: erro ao pedir fila:", e && e.message);
    return null;
  });
  const fila = resp && resp.fila;
  console.log("CRATOS/INFOJUD: fila recebida?", fila ? `sim (${fila.partes?.length} parte(s), idx ${fila.idx})` : "não/vazia");
  try { await Store.set("ecac_progresso", { em: Date.now(), onde: "registro" }); } catch (e) {}
  if (!fila || !fila.partes || fila.idx >= fila.partes.length) {
    if (fila && fila.idx >= fila.partes.length) {
      console.log("CRATOS/INFOJUD: registro concluído para todas as partes.");
      await finalizarRegistro();
    }
    return;
  }

  const parte = fila.partes[fila.idx];
  const total = fila.partes.length;
  console.log(`CRATOS/INFOJUD: registrando [${fila.idx + 1}/${total}] ${parte.nomeAbrev} (${parte.ni})`);

  // Valida NI antes de enviar (fiel ao original).
  const niLen = (parte.ni || "").replace(/\D/g, "").length;
  if ((parte.tipo === "CPF" && niLen !== 11) || (parte.tipo === "CNPJ" && niLen !== 14)) {
    console.warn("CRATOS/INFOJUD: NI inválido, pulando:", parte.ni);
    await avancarParte(fila);
    window.location.href = INFOJUD_REG_BASE;   // GET fresco → próxima parte
    return;
  }

  try {
    /* ═══════════════════════════════════════════════════════════════════════
     * LOTES DE 10 — o eCAC recusa mais que isso por solicitação
     * ═══════════════════════════════════════════════════════════════════════
     * `Quantidade de pedidos por solicitação excedida. (max. 10 pedidos)` — a
     * mensagem vem do SERVIDOR (`td.Erro`), não de constante de JS: em 03/09 o
     * `js/constantes.js` do eCAC só trazia os códigos de tipo. Até a 1.1.4 o
     * CRATOS mandava a lista inteira e **os pedidos do 11º em diante se perdiam
     * em silêncio** — o InfoJOB já fatiava, e essa era a funcionalidade que
     * faltava aqui.
     *
     * ⛔ A LISTA É CONGELADA NO STORAGE, não regerada a cada lote. Foi o que o
     * InfoJOB fez e eu não tinha pensado: `gerarListaPedidos` depende do AJAX de
     * anos do eCAC, que pode responder diferente (ou falhar e cair no dropdown)
     * na volta. Regerando, o lote 2 poderia ser de OUTRA lista — pedido perdido
     * ou duplicado, e ninguém veria. Gera-se uma vez, guarda-se, e fatia-se.
     */
    const LOTE_MAX = 10;
    let lista = fila.lotePedidos || null;
    let offset = fila.loteOffset || 0;

    await preencherCabecalho(parte, fila.config);
    if (!lista) {
      lista = await gerarListaPedidos(parte, fila.config);
      offset = 0;
      console.log("CRATOS/INFOJUD: total de pedidos para esta parte:", lista.length);
    } else {
      console.log("CRATOS/INFOJUD: retomando a lista congelada —", lista.length,
        "pedido(s), a partir do", offset + 1);
    }

    // Guarda anti-tabela-vazia: se esta parte não tem nenhum tipo ativo na config
    // (ex.: grupo CNPJ com tudo desligado, que é o padrão), NÃO clicamos Enviar —
    // o eCAC dispararia "inclua ao menos um pedido" num alert, a página NÃO
    // navegaria e o loop travaria antes do CNPJ, esperando um Enviar que nunca
    // aconteceu. Em vez disso, avançamos o índice e vamos para a próxima parte.
    // (O comentário antigo dizia que o alert "seria engolido pelo nosso
    //  window.alert". Não era: aquele override nunca funcionou — ver o bloco do
    //  grampo lá em cima. A guarda continua necessária pelo motivo acima.)
    if (lista.length === 0) {
      console.warn(`CRATOS/INFOJUD: parte ${parte.nomeAbrev} (${parte.tipo}) sem tipos ativos na config — pulando sem Enviar. Configure o grupo ${parte.tipo} nas Preferências se quiser consultá-la.`);
      await avancarParte(fila);          // idx++ sem registrar (não entra em "registradas")
      await sleep(300);
      window.location.href = INFOJUD_REG_BASE;   // GET fresco → próxima parte
      return;
    }

    const loteAtual = lista.slice(offset, offset + LOTE_MAX);
    const proximoOffset = offset + loteAtual.length;
    const temMaisLotes = proximoOffset < lista.length;
    if (lista.length > LOTE_MAX) {
      console.log("CRATOS/INFOJUD: lote " + (Math.floor(offset / LOTE_MAX) + 1) +
        " — pedidos " + (offset + 1) + " a " + proximoOffset + " de " + lista.length);
    }

    const resultado = await incluirPedidosDaFila(loteAtual);

    /* ⛔ NÃO ENVIA PELA METADE. Se algum pedido não pôde ser incluído do jeito
       pedido, a solicitação desta parte NÃO é enviada e a fila NÃO avança: o
       usuário decide se completa à mão (os pedidos que entraram estão na tela)
       ou se executa de novo depois. Aba fica aberta — ver finalizarRegistro. */
    if (resultado && resultado.ok === false) {
      const f = resultado.falhou || {};
      CratosFaixa.parar("infojud",
        `parei antes de enviar a solicitação de ${parte.nomeAbrev || parte.ni}: ` +
        (f.ano
          ? `o eCAC não ofereceu o ano ${f.ano} para ${f.tipo}.`
          : `não consegui incluir o pedido de ${f.tipo || "um dos tipos"}.`) +
        ` ${resultado.feitos} pedido(s) já estão na tela e NADA foi enviado. ` +
        `Confira a sessão do e-CAC: se estiver de pé, complete à mão e clique ` +
        `em Enviar, ou execute o INFOJUD outra vez.`,
        { cauda: "Nada foi enviado à Receita." });
      return;
    }

    /* ⛔ REDE DE SEGURANÇA: se o eCAC reclamou do limite mesmo depois de
       fatiarmos, a nossa premissa sobre o número está errada. NÃO enviamos: uma
       solicitação a menos é recuperável; uma solicitação registrada faltando
       pedido parece certa e ninguém confere. */
    if (limiteExcedidoNaTela()) {
      CratosFaixa.parar("infojud",
        "o e-CAC recusou a quantidade de pedidos desta solicitação, mesmo eu " +
        "enviando de " + LOTE_MAX + " em " + LOTE_MAX + ". O limite deve ter " +
        "mudado. NADA foi enviado: confira a tela e me avise, que eu ajusto.",
        { cauda: "Nada foi enviado à Receita." });
      return;
    }

    // Captura nome oficial do eCAC (só no primeiro lote; depois já está salvo).
    if (offset === 0) {
      const nomeEcac = extrairNomeEcac();
      if (nomeEcac) { parte.nomeEcac = nomeEcac; console.log("CRATOS/INFOJUD: nome eCAC:", nomeEcac); }
    }

    if (temMaisLotes) {
      /* NÃO avança a parte: ainda é a mesma pessoa. Guarda a lista congelada e o
         offset; depois do Enviar, o ramo de confirmação abre uma solicitação
         nova e cai aqui de novo, retomando de onde parou. */
      await Store.set("ecac_fila", Object.assign({}, fila, {
        lotePedidos: lista, loteOffset: proximoOffset,
      }));
      console.log("CRATOS/INFOJUD: enviando o lote; próximo offset:", proximoOffset);
    } else {
      await avancarParte(fila, parte);   // zera lotePedidos/loteOffset lá dentro
    }
    await clicarEnviar();
    // Após Enviar → msgsolicitacao.asp; lá o ramo de confirmação consulta a fila e,
    // havendo próxima parte, navega por GET para uma nova solicitacao.asp (sem Voltar).
  } catch (e) {
    console.error("CRATOS/INFOJUD: erro no registro:", e.message);
    await avancarParte(fila);
    await sleep(1000);
    await iniciarRegistroEcac();
  }
}

async function avancarParte(fila, parteRegistrada) {
  /* Zera o lote junto com o índice: parte nova, lista nova. Deixar sobrar a
     lista congelada da parte anterior faria a próxima pessoa receber os pedidos
     de outra — o pior erro possível neste módulo. */
  const novo = Object.assign({}, fila, {
    idx: fila.idx + 1, lotePedidos: null, loteOffset: 0,
  });
  if (parteRegistrada) {
    novo.registradas = (fila.registradas || []);
    novo.registradas.push({ processo: parteRegistrada.processo, ni: parteRegistrada.ni,
                            nome: parteRegistrada.nomeEcac || parteRegistrada.nome });
  }
  await Store.set("ecac_fila", novo);
}

/*
 * Fim do registro de TODAS as partes: pede ao background para fechar esta aba do
 * eCAC. Espera um instante para a página de confirmação ("solicitação registrada
 * com sucesso") ficar visível antes de fechar. O background usa sender.tab.id e
 * limpa a ecac_fila. A colheita é um passo à parte (abre a própria aba do caixa
 * postal), então fechar aqui não atrapalha.
 */
/*
 * ⚠️ A ABA SÓ FECHA EM EXECUÇÃO LIMPA (21/08).
 * Em produção o eCAC errou o combobox de anos, gritou num alert, o Rodrigo
 * clicou OK, a extensão terminou e FECHOU a aba — levando junto o recon, que era
 * a única evidência do que tinha acontecido. Fechar a aba é conveniência; a
 * evidência não é. Havendo qualquer anomalia anotada, a aba fica aberta com a
 * lista do que houve, e quem fecha é o usuário.
 */
async function finalizarRegistro() {
  await sleep(1800);

  /* Número do processo para o pulso — lido da fila ANTES de ela ser limpa. O
     INFOJUD não produz certidão na hora (a resposta vem na caixa postal, depois),
     então o pulso de conclusão NÃO nasce no background como nos outros; nasce
     aqui, quando a última solicitação foi registrada. Sem ele, o painel fica no
     botão manual — foi o que o Rodrigo viu: registrou e não avançou sozinho. */
  let numProcesso = "";
  try {
    const fila = await Store.get("ecac_fila");
    numProcesso = (fila && fila.partes && fila.partes[0] && fila.partes[0].processo) || "";
  } catch (e) {}
  const emitir = (ok, motivo) => {
    if (!numProcesso) return;
    return Store.set("orq_conv_feito", {
      convenio: "INFOJUD", numProcesso, operacao: "consulta",
      feitos: ok ? 1 : 0, esperados: 1, ok, motivo: motivo || null, em: Date.now(),
    }).catch(() => {});
  };

  let anomalias = [];
  try { anomalias = (await Store.get("ecac_anomalias")) || []; } catch (e) {}

  if (anomalias.length) {
    console.warn("CRATOS/INFOJUD: execução terminou com", anomalias.length, "anomalia(s) — aba mantida aberta.");
    CratosFaixa.alertar("infojud",
      `terminei o registro, mas houve ${anomalias.length} ocorrência(s) no ` +
      `caminho:\n· ` + anomalias.map((a) => a.texto).join("\n· ") +
      `\n\nDeixei esta aba ABERTA de propósito, para você conferir a solicitação ` +
      `na tela (e salvar o recon, se estiver com ele ligado). Feche quando quiser.`);
    /* INFOJUD é CONSULTA: no painel isto SEGUE e sinaliza (não trava a fila). A
       aba fica aberta para conferência; a fila do PJe não precisa esperar. */
    await emitir(false, anomalias.length + " ocorrência(s) no registro — confira a aba do eCAC");
    try { await Store.set("ecac_fila", null); } catch (e) {}
    return;
  }

  /* Registro limpo: o painel avança sozinho. A colheita das respostas continua
     sendo um passo à parte, no fim da fila — isto marca só que o REGISTRO acabou. */
  await emitir(true, "solicitações registradas");
  console.log("CRATOS/INFOJUD: solicitando fechamento da aba de registro.");
  try {
    await browser.runtime.sendMessage({ tipo: "ecac_fechar_aba" });
  } catch (e) {
    console.warn("CRATOS/INFOJUD: falha ao pedir fechamento da aba:", e && e.message);
  }
}

/* ── COLETA (Passo 2A): fechar modal + ler itens da tela de resultado ──────
 * Portado do InfoJOB (fecharModalSeExistir, aguardarElemento, leitura da tabela
 * resultadoSolicitacao). O download de cada item (Passo 2B) entra depois, quando
 * soubermos como o PDF se comporta no Firefox (varia por tipo/consta).
 */


/* ═══════════════════════════════════════════════════════════════════════════
 * O AVISO DE ENCERRAMENTO DO e-CAC (03/09/2026)
 * ═══════════════════════════════════════════════════════════════════════════
 * A Receita passou a abrir, logo depois do login, um diálogo jQuery UI:
 *   <div id="dialog-mensagem-encerramento-ecac">
 *     "Em breve, o acesso ao e-CAC será desativado. Os serviços digitais da
 *      Receita Federal passarão a ser acessados exclusivamente pelo portal
 *      Serviços da Receita Federal."
 *     [Continuar no e-CAC por enquanto]  [Acessar o portal Serviços da RF]
 *
 * Ele é MODAL: enquanto está aberto, a extensão não consegue seguir. Então
 * clicamos em "Continuar no e-CAC por enquanto".
 *
 * ⛔ E SÓ NESSE BOTÃO. O outro leva para um portal novo, onde o CRATOS não sabe
 * trabalhar — clicar nele seria a extensão levar o usuário para longe do que
 * ele pediu. Por isso o casamento é por TEXTO ("continuar no e-cac"), nunca por
 * posição ("o primeiro botão do diálogo"): se a Receita inverter a ordem, a
 * versão por posição clicaria exatamente no que não pode.
 *
 * >>> ⚠️ ISTO É UM PRAZO, NÃO SÓ UM POPUP. O INFOJUD do CRATOS inteiro vive
 *     dentro do e-CAC. "Em breve será desativado" significa que este módulo tem
 *     data para parar de funcionar, e a migração para o portal novo é trabalho
 *     de recon do zero. Anotado nas notas como risco datado.
 */
async function fecharAvisoEncerramentoEcac() {
  const norm = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ").trim().toLowerCase();
  const achar = () => Array.from(document.querySelectorAll(
    ".ui-dialog-buttonpane button, .ui-dialog button, button"))
    .find((b) => norm(b.textContent).includes("continuar no e-cac"));

  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    const btn = achar();
    if (btn) {
      btn.click();
      console.log("CRATOS/INFOJUD: aviso de encerramento do e-CAC dispensado.");
      await sleep(400);
      return true;
    }
    await sleep(500);
  }
  return false;
}

// Fecha o popup "Bem-vindo ao novo Caixa Postal" (tutorial) e modais afins.
// Chamado tanto na lista de mensagens quanto na tela de resultado.
async function fecharModalSeExistir() {
  const seletores = [
    'a[href*="pular"]',                         // "Pular Tutorial" (link)
    'button[aria-label="Fechar modal"]',
    'button[aria-label="Fechar"]',
    'button.br-button.circle.small',
    '[class*="modal"] button[class*="close"]',
  ];
  // tenta também por texto "Pular Tutorial"
  const porTexto = Array.from(document.querySelectorAll("a, button"))
    .find((el) => /pular tutorial/i.test(el.textContent || ""));
  if (porTexto) { porTexto.click(); await sleep(600); return true; }

  for (const sel of seletores) {
    const btn = document.querySelector(sel);
    if (btn) { btn.click(); await sleep(600); return true; }
  }
  return false;
}

function aguardarElemento(seletor, timeout) {
  return new Promise((resolve) => {
    const el = document.querySelector(seletor);
    if (el) { resolve(el); return; }
    const obs = new MutationObserver(() => {
      const found = document.querySelector(seletor);
      if (found) { obs.disconnect(); resolve(found); }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { obs.disconnect(); resolve(null); }, timeout || 5000);
  });
}

// Lê a tabela de itens da tela resultadoSolicitacao (tr.azulCentro/brancoCentro).
// Extrai tipo, ano/data, contribuinte e o onclick de cada lupa (obterInformacao(...)).
async function lerItensResultado() {
  await fecharModalSeExistir();
  for (let t = 0; t < 15; t++) {
    if (document.querySelectorAll("tr.azulCentro, tr.brancoCentro").length) break;
    await sleep(500);
  }
  const linhas = document.querySelectorAll("tr.azulCentro, tr.brancoCentro");
  const itens = [];
  let nomeContrib = "", niContrib = "";
  for (const linha of linhas) {
    const cels = linha.querySelectorAll("td");
    if (cels.length < 5) continue;
    const tipo = (cels[2]?.textContent || "").trim().toUpperCase();
    const anoData = (cels[3]?.textContent || "").trim();
    const link = cels[4]?.querySelector("a");
    if (!tipo || !link) continue;
    if (!nomeContrib) {
      nomeContrib = (cels[1]?.textContent || "").trim().replace(/\s+/g, " ");
      niContrib = (cels[0]?.textContent || "").trim();
    }
    itens.push({
      tipo, anoData,
      onclick: link.getAttribute("onclick") || "",
      href: link.getAttribute("href") || "",
    });
  }
  return { itens, nomeContrib, niContrib };
}

// Responde ao background quando estamos na tela de resultado e ele pede os itens.
browser.runtime.onMessage.addListener((msg) => {
  if (msg && msg.tipo === "cp_ler_itens_resultado") {
    return lerItensResultado().then((r) => ({ ok: true, ...r }))
      .catch((e) => ({ ok: false, erro: String(e.message || e) }));
  }
});

/*
 * Submete UM item do resultado (dispara o PDF). Portado do iframe_submeter_item do
 * InfoJOB. O onclick da lupa é obterInformacao('visualizar', numSolic, tipoInfo,
 * indice, nirf, target). Preenchemos o formResultado e submetemos. Com target _self,
 * o PDF vem na própria aba; o background intercepta solicitadorPDFMidas.asp e baixa.
 */
function submeterItemResultado(onclick, forceSelf) {
  const m = (onclick || "").match(/obterInformacao\(([^)]+)\)/);
  if (!m) return { ok: false, erro: "onclick inválido" };
  const params = m[1].split(",").map((p) => p.trim().replace(/^'|'$/g, ""));
  const form = document.getElementById("formResultado");
  if (!form) return { ok: false, erro: "formResultado não encontrado" };

  form.target = forceSelf ? "_self" : (params[5] || "_self");
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set("acao", params[0] || "visualizar");
  set("numSolicitacao", params[1] || "");
  set("tipoInformacao", params[2] || "");
  set("indicePedido", params[3] || "");
  set("nirf", params[4] || "");
  form.submit();
  return { ok: true, target: form.target };
}

/*
 * Tipos ASSÍNCRONOS: aparecem na tela de resultado (têm linha e link) mas o link não
 * tem obterInformacao(...) porque o resultado ainda não ficou pronto na hora. Para
 * esses, "onclick inválido" na verdade significa "ainda não disponibilizado". Lista
 * extensível: se surgir outro convênio assíncrono, basta acrescentar o rótulo (em
 * MAIÚSCULAS, como vem da tabela do eCAC).
 */
const TIPOS_ASSINCRONOS = ["EFINANCEIRA"];
function ehTipoAssincrono(tipo) {
  return TIPOS_ASSINCRONOS.includes(String(tipo || "").toUpperCase());
}

/*
 * Colhe TODOS os itens da tela de resultado, um a um. Informa o contexto (processo,
 * nome, pasta) ao background para nomear os PDFs, depois submete cada item com uma
 * pausa entre eles. O download em si é feito pelo background ao interceptar o PDF.
 *
 * DOI vai por último (sua navegação atrapalha os itens seguintes — como no InfoJOB).
 * Distingue PENDENTES (assíncronos ainda não disponíveis) de FALHAS (erro real).
 */
async function colherTodosItens(contexto) {
  const { itens, nomeContrib, niContrib } = await lerItensResultado();
  if (!itens.length) return { ok: false, erro: "nenhum item na tela de resultado" };

  const nomeAbrev = doisPrimeirosNomes(nomeContrib || contexto.nomeAbrev || "RESP");
  contextoAtualColeta = {
    numProcesso: contexto.numProcesso || "",
    nomeAbrev,
    pasta: contexto.pasta || "CRATOS",
  };
  await browser.runtime.sendMessage({
    tipo: "armar_contexto",
    numProcesso: contexto.numProcesso || "",
    nomeAbrev,
    pasta: contexto.pasta || "CRATOS",
  });

  const ordenados = [
    ...itens.filter((i) => i.tipo !== "DOI"),
    ...itens.filter((i) => i.tipo === "DOI"),
  ];

  let colhidos = 0, falhas = [], pendentes = [];
  for (const item of ordenados) {
    console.log("CRATOS/coleta: colhendo item", item.tipo, item.anoData, "onclick:", item.onclick);
    const r = await colherUmItem(item, niContrib);
    console.log("CRATOS/coleta: resultado do item", item.tipo, "->", JSON.stringify(r));
    if (r.ok) colhidos++;
    else if (r.assincrono) pendentes.push(item.tipo + (item.anoData ? " " + item.anoData : ""));
    else falhas.push(item.tipo + ": " + r.erro);
    await sleep(1500);
  }
  return { ok: true, total: ordenados.length, colhidos, falhas, pendentes };
}

/*
 * Colhe UM item replicando o POST que obterInformacao() faz: preenche os mesmos
 * campos do formResultado e faz fetch(action, {method:'POST', body}) same-origin.
 * O servidor responde com o PDF (uso-único, um consumo). Convertemos em base64 e
 * mandamos ao background baixar com nome CRATOS/. Se vier HTML (não consta),
 * sinalizamos para o tratamento à parte (fase DITR).
 */
async function colherUmItem(item, niContrib) {
  const m = (item.onclick || "").match(/obterInformacao\(([^)]+)\)/);
  if (!m) {
    // Sem obterInformacao. Dois casos:
    //  (a) PRONTO por download direto: o item tem um href de arquivo (eFinanceira = .zip;
    //      eventualmente ECF/DIPJ diretos = .pdf). Baixa via fetch(href) -> background.
    //  (b) assíncrono ainda NÃO disponível (sem href usável): pendente.
    const href = _hrefReal(item.href);
    if (href) return await colherDownloadDireto(item, niContrib, href);
    return ehTipoAssincrono(item.tipo)
      ? { ok: false, assincrono: true, erro: "ainda não disponibilizado" }
      : { ok: false, erro: "sem link (onclick/href) para " + (item.tipo || "?") };
  }
  const params = m[1].split(",").map((p) => p.trim().replace(/^'|'$/g, ""));
  // params: [acao, numSolicitacao, tipoInformacao, indicePedido, nirf, target]
  const [acao, numSolic, tipoInfo, indice, nirf] = params;

  const form = document.getElementById("formResultado");
  if (!form) return { ok: false, erro: "formResultado não encontrado" };

  const actionAttr = form.getAttribute("action") || "";
  // action pode ser relativo (ex.: "visualizardeclaracao.asp") — resolve contra a página
  const action = actionAttr ? new URL(actionAttr, location.href).href : location.href;
  const method = (form.getAttribute("method") || "POST").toUpperCase();

  // Monta os pares campo=valor iterando os elementos do form manualmente
  // (evita FormData.entries(), que não é iterável de forma confiável aqui).
  const pares = new URLSearchParams();
  for (const el of form.elements) {
    if (!el.name) continue;
    if ((el.type === "checkbox" || el.type === "radio") && !el.checked) continue;
    pares.set(el.name, el.value);
  }
  // sobrescreve os 5 campos que obterInformacao seta
  pares.set("acao", acao || "visualizar");
  pares.set("numSolicitacao", numSolic || "");
  pares.set("tipoInformacao", tipoInfo || "");
  pares.set("indicePedido", indice || "");
  pares.set("nirf", nirf || "");

  const ni = (niContrib || "").replace(/\D/g, "");
  const tipo = (item.tipo || "").toUpperCase();
  const exercicio = (item.anoData || "").replace(/[^\d]/g, "").slice(-4);
  const tipoLabel = tipo + (exercicio ? " " + exercicio : "");

  try {
    const opt = { method, credentials: "include" };
    let url = action;
    if (method === "POST") {
      opt.body = pares;
      opt.headers = { "Content-Type": "application/x-www-form-urlencoded" };
    } else {
      url = action + "?" + pares.toString();
    }
    let resp = await fetch(url, opt);
    if (!resp.ok) return { ok: false, erro: "POST status " + resp.status };

    let ct = resp.headers.get("content-type") || "";
    let buf = await resp.arrayBuffer();

    // Tipos que SEMPRE geram PDF real (nunca certidão fabricada):
    //   DIRPF, DOI, DIMOB, DECRED, DIPJ, ECF. Se vier HTML, é uma página que
    //   aponta para o PDF (ex.: DOI abre em _blank) — seguimos o link.
    // Tipos que podem ser CERTIDÃO (resultado em página): DITR, Info. Cadastrais.
    const tipoUP = (item.tipo || "").toUpperCase();
    const ehSemprePdf = /DIRPF|DOI|DIMOB|DECRED|DIPJ|ECF/.test(tipoUP);
    const podeCertidao = /DITR|CADASTR|INFO/.test(tipoUP);

    if (!/pdf/i.test(ct)) {
      const txt = new TextDecoder("latin1").decode(buf);

      // Caso especial DOI: retorna um <form id="formDOI"> com auto-submit (POST) para
      // outro host (servicos.receita.../doi/Infojud/Declaracoes.asp), campo "Parametros".
      const formDoi = _extrairFormDoi(txt);
      if (formDoi) {
        const resp2 = await fetch(formDoi.action, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(formDoi.campos),
        });
        ct = resp2.headers.get("content-type") || "";
        buf = await resp2.arrayBuffer();
        if (!/pdf/i.test(ct)) {
          // o segundo POST pode ainda devolver HTML com link — tenta achar
          const txt2 = new TextDecoder("latin1").decode(buf);
          const url3 = _acharLinkPdf(txt2, formDoi.action);
          if (url3) {
            const resp3 = await fetch(url3, { credentials: "include" });
            ct = resp3.headers.get("content-type") || "";
            buf = await resp3.arrayBuffer();
          }
        }
      } else {
        // fluxo normal: procura link de PDF (solicitadorPDFMidas, .pdf, etc.)
        const urlPdf = _acharLinkPdf(txt, action);
        if (urlPdf) {
          resp = await fetch(urlPdf, { credentials: "include" });
          ct = resp.headers.get("content-type") || "";
          buf = await resp.arrayBuffer();
        } else if (podeCertidao && !ehSemprePdf) {
          return await fabricarCertidao(item, niContrib, txt, tipoLabel);
        } else {
          console.log("CRATOS/coleta: PDF não encontrado para", tipoUP,
                      "| trecho HTML:", txt.replace(/\s+/g, " ").slice(0, 600));
          return { ok: false, erro: "pdf_nao_encontrado (" + tipoUP + ")" };
        }
      }
    }

    if (!/pdf/i.test(ct)) {
      const txt2 = new TextDecoder("latin1").decode(buf);
      if (podeCertidao && !ehSemprePdf) {
        return await fabricarCertidao(item, niContrib, txt2, tipoLabel);
      }
      return { ok: false, erro: "sem_pdf (" + ct + ")" };
    }

    // Download pelo background via downloads.download: respeita subpasta CRATOS/
    // e NÃO abre o PDF em aba (ao contrário do <a download> no content script).
    // O background trata o falso-erro do blob URL (baixa mas rejeita a Promise).
    const base64 = _bytesToB64(new Uint8Array(buf));
    const r = await browser.runtime.sendMessage({ tipo: "baixar_pdf_base64", base64, tipoLabel, ni });
    return (r && r.ok) ? { ok: true, arquivo: r.filename } : { ok: false, erro: (r && r.erro) || "falha no download" };
  } catch (e) {
    return { ok: false, erro: String(e.message || e) };
  }
}

/* href "real" (ignora vazio, "#", "javascript:"); resolve relativo contra a página. */
function _hrefReal(href) {
  const h = String(href || "").trim();
  if (!h || h === "#" || /^javascript:/i.test(h)) return null;
  try { return new URL(h, location.href).href; } catch (e) { return null; }
}

/*
 * Download DIRETO por href (portado do ramo eFinanceira do InfoJOB). eFinanceira sai
 * como .zip (rótulo "eFinanceira"); outros downloads diretos como .pdf. Faz fetch do
 * href e, se vier página HTML intermediária (como o DOI faz no PDF), persegue o link
 * real e baixa. Entrega os bytes ao background com a extensão certa.
 */
async function colherDownloadDireto(item, niContrib, href) {
  const ni = (niContrib || "").replace(/\D/g, "");
  const tipoUP = (item.tipo || "").toUpperCase();
  const exercicio = (item.anoData || "").replace(/[^\d]/g, "").slice(-4);
  const ehEfin = tipoUP === "EFINANCEIRA" || ehTipoAssincrono(tipoUP);
  const rotulo = ehEfin ? "eFinanceira" : tipoUP;              // usuário quer "eFinanceira" minúsculo
  const tipoLabel = rotulo + (exercicio ? " " + exercicio : "");
  const ext = ehEfin ? "zip" : "pdf";
  try {
    let resp = await fetch(href, { credentials: "include" });
    if (!resp.ok) return { ok: false, erro: "download status " + resp.status };
    let buf = await resp.arrayBuffer();

    // NÃO confiar no Content-Type do eCAC (ele manda "html" em cima de binário). Decidir
    // pelos BYTES: "PK" = ZIP, "%PDF" = PDF -> é o arquivo, baixa direto. Só é página
    // intermediária de verdade se os bytes começarem com HTML ("<").
    let tipoArq = _magicArquivo(buf);
    if (tipoArq === "html") {
      const txt = new TextDecoder("latin1").decode(new Uint8Array(buf));
      const url2 = _acharLinkDownload(txt, href);
      if (!url2) {
        console.log("CRATOS/coleta: download direto veio HTML sem link (" + tipoUP + "):",
          txt.replace(/\s+/g, " ").slice(0, 600));
        return { ok: false, erro: "download " + tipoUP + ": HTML sem link" };
      }
      resp = await fetch(url2, { credentials: "include" });
      if (!resp.ok) return { ok: false, erro: "download2 status " + resp.status };
      buf = await resp.arrayBuffer();
      tipoArq = _magicArquivo(buf);
    }

    if (tipoArq === "html") {   // ainda HTML após seguir o link: não é arquivo
      return { ok: false, erro: "download " + tipoUP + ": conteúdo não é arquivo" };
    }

    const base64 = _bytesToB64(new Uint8Array(buf));
    const r = await browser.runtime.sendMessage({ tipo: "baixar_pdf_base64", base64, tipoLabel, ni, ext });
    return (r && r.ok) ? { ok: true, arquivo: r.filename } : { ok: false, erro: (r && r.erro) || "falha no download" };
  } catch (e) {
    return { ok: false, erro: String(e.message || e) };
  }
}

/* Identifica o arquivo pelos primeiros bytes (assinatura), ignorando Content-Type:
   "PK" -> zip, "%PDF" -> pdf, "<" (após espaços) -> html; senão "outro". */
function _magicArquivo(buf) {
  const u = new Uint8Array(buf);
  if (u.length >= 2 && u[0] === 0x50 && u[1] === 0x4b) return "zip";                       // PK
  if (u.length >= 4 && u[0] === 0x25 && u[1] === 0x50 && u[2] === 0x44 && u[3] === 0x46) return "pdf"; // %PDF
  const head = new TextDecoder("latin1").decode(u.subarray(0, 64)).replace(/^\s+/, "").toLowerCase();
  if (head.startsWith("<")) return "html";
  return "outro";
}

/* Procura, num HTML intermediário, o link do arquivo (zip primeiro, depois genérico). */
function _acharLinkDownload(html, base) {
  const padroes = [
    /[^"'\s(]+\.zip[^"'\s)]*/i,
    /(?:window\.open|location\.href\s*=|href\s*=)\s*['"]([^'"]+)['"]/i,
  ];
  for (const re of padroes) {
    const mm = html.match(re);
    if (mm) {
      const u = (mm[1] || mm[0]).replace(/&amp;/g, "&");
      try { return new URL(u, base).href; } catch (e) {}
    }
  }
  return null;
}

/* Extrai o <form id="formDOI"> de auto-submit que o DOI retorna:
   action (outro host) + todos os campos hidden (ex.: Parametros). */
function _extrairFormDoi(html) {
  const mForm = html.match(/<form[^>]*\bid=["']?formDOI["']?[^>]*>([\s\S]*?)<\/form>/i);
  if (!mForm) return null;
  const mAction = mForm[0].match(/action=["']([^"']+)["']/i);
  if (!mAction) return null;
  const action = mAction[1].replace(/&amp;/g, "&");
  const campos = {};
  const re = /<input[^>]*name=["']([^"']+)["'][^>]*value=["']([^"']*)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(mForm[1])) !== null) campos[m[1]] = m[2];
  return { action, campos };
}

/* Procura no HTML um link para o PDF do resultado, em vários formatos:
   solicitadorPDFMidas.asp, *.pdf, window.open('...'), location.href='...'. */
function _acharLinkPdf(html, base) {
  const padroes = [
    /[^"'\s(]*solicitadorPDFMidas\.asp[^"'\s)]*/i,
    /(?:window\.open|location\.href\s*=|href\s*=)\s*['"]([^'"]*\.(?:pdf|asp)[^'"]*)['"]/i,
    /[^"'\s(]+\.pdf[^"'\s)]*/i,
  ];
  for (const re of padroes) {
    const m = html.match(re);
    if (m) {
      const bruto = (m[1] || m[0]).replace(/&amp;/g, "&").trim();
      // ignora falsos positivos óbvios
      if (/\.(css|js|png|gif|jpg)/i.test(bruto)) continue;
      try { return new URL(bruto, base).href; } catch (e) { continue; }
    }
  }
  return null;
}

function _bytesToB64(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/*
 * Fabrica a certidão-texto para tipos que não geram PDF (DITR, Info. Cadastrais, DIPJ):
 * lê o texto da página de resultado, detecta consta/não-consta, monta as linhas
 * (fiel ao InfoJOB) e pede ao background para gerar o PDF e baixar em CRATOS/.
 */
async function fabricarCertidao(item, niContrib, textoPagina, tipoLabel) {
  const tipo = (item.tipo || "").toUpperCase();
  const exercicio = (item.anoData || "").trim();
  const ni = niContrib || "";
  const rotuloNi = ni.replace(/\D/g, "").length === 14 ? "CNPJ" : "CPF";
  const data = new Date().toLocaleDateString("pt-BR");
  const negativo = /n[ãa]o\s+consta/i.test(textoPagina || "");

  let titulo, linhas;

  if (/INFO/i.test(tipo) || /CADASTR/i.test(tipo)) {
    titulo = "Informacoes Cadastrais";
    linhas = [
      "Data de consulta: " + data,
      rotuloNi + ": " + ni, "",
      "Informacoes Cadastrais coletadas.",
      "Consulte a Caixa Postal para obter documento.",
    ];
  } else if (negativo) {
    if (tipo === "DITR") {
      titulo = "DITR - Nao consta";
      linhas = ["Data de consulta: " + data, rotuloNi + ": " + ni, "",
        "Nao consta DITR " + exercicio + " para o " + rotuloNi + " " + ni + "."];
    } else {
      titulo = tipo + " - Nao consta";
      linhas = ["Data de consulta: " + data, rotuloNi + ": " + ni, "",
        "Nao consta declaracao para os dados informados (" + exercicio + ")."];
    }
  } else {
    if (tipo === "DITR") {
      titulo = "DITR - Constam imoveis declarados";
      linhas = ["Data de consulta: " + data, rotuloNi + ": " + ni, "",
        "Constam imoveis declarados na DITR " + exercicio,
        "para o " + rotuloNi + " " + ni + " informado.",
        "Consulte a Caixa Postal para maiores detalhes."];
    } else {
      titulo = tipo + " - Consta declaracao";
      linhas = ["Data de consulta: " + data, rotuloNi + ": " + ni, "",
        "Consta " + tipo + " " + exercicio,
        "para o " + rotuloNi + " " + ni + " informado.",
        "Consulte a Caixa Postal para maiores detalhes."];
    }
  }

  const filename = _montarCaminhoCertidao(contextoAtualColeta, tipoLabel, ni);
  const r = await browser.runtime.sendMessage({
    tipo: "fabricar_pdf", titulo, linhas, filename,
    convenio: "INFOJUD",
    numProcesso: (contextoAtualColeta && contextoAtualColeta.numProcesso) || null,
    detalhe: tipoLabel || null,
  });
  return (r && r.ok) ? { ok: true, certidao: true } : { ok: false, erro: (r && r.erro) || "falha ao fabricar certidão" };
}

function _montarCaminhoCertidao(ctx, tipoLabel, ni) {
  const limpar = (s) => String(s || "").replace(/[\/\\:*?"<>|]/g, "").trim();
  const pasta = limpar((ctx && ctx.pasta) || "CRATOS") || "CRATOS";
  const proc = String((ctx && ctx.numProcesso) || ni || "").replace(/\D/g, "");
  const nome = limpar((ctx && ctx.nomeAbrev) || "");
  const tipo = limpar(tipoLabel);
  return `${pasta}/${proc}_${nome} ${tipo}.pdf`.replace(/\s+/g, " ");
}

/* ══════════════════════════════════════════════════════════════════════════
 * COLETA AUTOMÁTICA — fila via API + navegação direta (v0.2.32)
 *
 * A caixa postal nova (Angular) não expõe a mesma tabela que o InfoJOB raspava, e
 * descobrimos dois atalhos que tornam a raspagem desnecessária:
 *   1) a API REST que o CRATOS já lê dá, por mensagem, o numSolicitação + se é lida;
 *   2) a tela de resultado abre por URL direta:
 *        cav.receita.../decjuiz/resultadoSolicitacao.asp?numeroSolicitacao={n}
 * Então o background monta a FILA (só INFOJUD + processo casado + NÃO lida, tudo via
 * API — trava tripla) e navega a aba direto para cada resultado. Aqui só resta a fase
 * COLHER: em cada tela de resultado, colhe e avança para a próxima solicitação da fila.
 * Sem raspar lista, sem clicar mensagem — determinístico.
 *
 * NÃO marca como lida (navegar por URL não marca): decisão do usuário. A fila é montada
 * uma vez, então não há reprocessamento no run; entre runs o filtro não-lida protege.
 * ════════════════════════════════════════════════════════════════════════ */

const URL_RESULTADO_BASE =
  "https://cav.receita.fazenda.gov.br/servicos/ATSDR/decjuiz/resultadoSolicitacao.asp?numeroSolicitacao=";
function urlResultado(numSolic) {
  return URL_RESULTADO_BASE + String(numSolic || "").replace(/\D/g, "");
}

/* Ponto de entrada da coleta: só age na tela de resultado (a fila vem pronta do bg). */
async function iniciarColetaEcac() {
  let est = null;
  try { est = await Store.get("coleta_estado"); } catch (e) {}
  if (!est || !est.ativo) return;
  if (location.href.toLowerCase().includes("resultadosolicitacao")) {
    await coletaColherEAvancar(est);
  }
}

/* Na tela de resultado: colhe tudo, soma no estado e navega à próxima da fila. */
async function coletaColherEAvancar(est) {
  const atual = est.fila[est.idx];
  if (est.idx === 0) {
    console.log("CRATOS/coleta: fila com", est.fila.length, "solicitação(ões):", est.fila.join(", "));
  }
  console.log(`CRATOS/coleta: colhendo solicitação [${est.idx + 1}/${est.fila.length}] ${atual}`);
  await sleep(1200);

  const r = await colherTodosItens({ numProcesso: est.numProcesso, pasta: est.pasta, nomeAbrev: "" })
    .catch((e) => ({ ok: false, erro: String(e.message || e) }));
  if (r && r.ok) {
    est.total += r.total || 0;
    est.colhidos += r.colhidos || 0;
    if (r.falhas && r.falhas.length) est.falhas.push(...r.falhas);
    if (r.pendentes && r.pendentes.length) est.pendentes.push(...r.pendentes);
  } else {
    est.falhas.push("solicitação " + (atual || "?") + ": " + ((r && r.erro) || "falha"));
  }

  est.idx += 1;
  if (est.idx < est.fila.length) {
    await Store.set("coleta_estado", est);
    await sleep(700);
    location.href = urlResultado(est.fila[est.idx]);   // próxima tela de resultado
    return;
  }
  console.log("CRATOS/coleta: concluída.", est.fila.length, "solicitação(ões);",
    est.colhidos, "arquivo(s); pendentes:", est.pendentes.length, "falhas:", est.falhas.length);
  est.ativo = false;
  await Store.set("coleta_estado", est);               // background em polling detecta o fim
}


browser.runtime.onMessage.addListener((msg) => {
  if (msg && msg.tipo === "cp_colher_itens") {
    return colherTodosItens(msg.contexto || {})
      .catch((e) => ({ ok: false, erro: String(e.message || e) }));
  }
});

// Se caímos numa página da caixa postal, fecha o tutorial proativamente.
if (/caixapostal|Aplicacao\.aspx/i.test(location.href)) {
  setTimeout(fecharModalSeExistir, 1200);
}

/* Dispara ao carregar a página do eCAC (registro E coleta convivem: cada um
   guarda pela URL/estado e sai calado quando não é seu contexto). */
function _dispararEcac() {
  /* O aviso de encerramento é MODAL e aparece logo depois do login: se ele
     estiver aberto, nada mais anda. Vai primeiro, e só com fila do CRATOS —
     quem entrou no e-CAC por conta própria decide sozinho o que fazer com o
     aviso da Receita. */
  Store.get("ecac_fila").then((f) => {
    if (f && f.partes && f.idx < f.partes.length) fecharAvisoEncerramentoEcac();
  }).catch(() => {});
  setTimeout(iniciarRegistroEcac, 900);
  setTimeout(iniciarColetaEcac, 1100);
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", _dispararEcac);
} else {
  _dispararEcac();
}

/* Gancho de teste (mundo isolado: a página não enxerga). Exposto de propósito,
   para o harness exercitar as funções REAIS — cópia testada é teste de si mesma. */
window.__cratosEcac = { selecionarVara, selecionarOpcaoTexto, fecharAvisoEncerramentoEcac, limiteExcedidoNaTela, finalizarRegistro };

} // fim de iniciarEcacInfojud
