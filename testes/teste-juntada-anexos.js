/*
 * teste-juntada-anexos.js — o cofre em memória e o anexo automático na juntada.
 *
 * A decisão de desenho que esta suíte protege: os bytes dos PDFs ficam EM
 * MEMÓRIA no background persistente (MV2), do convênio até a juntada. Não vão
 * para `storage.local` — isso exigiria `unlimitedStorage`, que aparece na caixa
 * de instalação, e tornaria falso o cartão "Sobre" ("dados sobrescritos a cada
 * nova operação").
 *
 * O que se trava aqui:
 *  1. ⛔ NENHUMA chamada de rede da juntada toca assinatura. Aqui não existe
 *     diálogo de confirmação: se o usuário já assinou algo na sessão, o clique
 *     ASSINA. É a asserção mais importante do projeto.
 *  2. Cofre vazio (navegador reiniciado) NÃO é erro: a juntada acontece e a
 *     tela volta a listar os nomes, como até a 1.0.7. Degradação, não falha.
 *  3. Cada certidão anexa só os SEUS arquivos — comprovante de cancelamento não
 *     vai anexo à certidão de inclusão.
 *  4. `numeroOrdem` é 1..N dos que ENTRARAM, sem buraco quando um falha.
 *  5. Falha de um anexo não derruba a minuta (que já existe nos autos).
 *  6. O tipo do anexo sai do catálogo POR NOME; 115/"80" só como último recurso.
 *  7. O teto de upload é PERGUNTADO ao PJe, não suposto.
 *
 * Rodar: node teste-juntada-anexos.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const falhas = [];
const oks = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }

const b64 = (n) => Buffer.from("x".repeat(n)).toString("base64");

/* ────────────────────────────────────────────────────────────────────────────
   1. O COFRE (background)
   ──────────────────────────────────────────────────────────────────────────── */
function cofreDoBackground() {
  const src = fs.readFileSync(path.join(SRC, "background.js"), "utf8");
  /* Recorta só o bloco do Cofre: subir o background inteiro num jsdom traria
     alarms, browserAction e listeners que não têm nada a ver com isto. O corte
     é por marcador do próprio arquivo — se alguém renomear o objeto, o teste
     QUEBRA ALTO em vez de medir outra coisa em silêncio. */
  const ini = src.indexOf("const Cofre = {");
  const fim = src.indexOf("globalThis.__cratosCofre = Cofre;");
  if (ini < 0 || fim < 0) return null;
  const trecho = src.slice(ini, fim);
  const mod = {};
  new Function("module", trecho + "\nmodule.Cofre = Cofre;")(mod);
  return mod.Cofre;
}
{
  const Cofre = cofreDoBackground();
  if (!Cofre) {
    console.log("\n=== teste-juntada-anexos.js ===");
    console.log("  FALHA  a versão em " + SRC + " não tem o Cofre. Nela a juntada cria a " +
      "minuta e PARA: os PDFs ficam por conta do usuário, porque os bytes não " +
      "sobrevivem ao download. É o que esta suíte existe para travar.");
    console.log("\n0 passaram — a suíte inteira reprova nesta versão.\n");
    process.exit(1);
  }

  Cofre.guardar("0000001-23.2025.5.18.0008", "CRATOS/00000012320255180008_EMPRESA EXEMPLO CNIB Inclusao.pdf", b64(100));
  const lista = Cofre.listar("00000012320255180008");
  checar(lista.length === 1, "o cofre guarda o arquivo");
  checar(lista[0].nome === "00000012320255180008_EMPRESA EXEMPLO CNIB Inclusao.pdf",
    "guarda só o NOME do arquivo, sem a pasta");
  checar(Cofre.listar("0000001-23.2025.5.18.0008").length === 1,
    "a chave é por DÍGITOS: mascarado e cru são o mesmo processo");
  checar(!("base64" in lista[0]),
    "listar() NÃO devolve os bytes — quem quer bytes chama pegar()");
  checar(Cofre.pegar("00000012320255180008")[0].base64.length > 0, "pegar() devolve os bytes");

  /* Camada 2 (04/09): a dedupe do Cofre passou a ser por CONTEÚDO EXATO.
     Mesmo nome + MESMO conteúdo = retry → não duplica (fica 1). */
  Cofre.guardar("00000012320255180008", "CRATOS/00000012320255180008_EMPRESA EXEMPLO CNIB Inclusao.pdf", b64(100));
  checar(Cofre.listar("00000012320255180008").length === 1,
    "mesmo nome + MESMO conteúdo (retry do mesmo ato) não duplica");
  /* Mesmo nome + conteúdo DIFERENTE = outro documento → mantém os dois. */
  Cofre.guardar("00000012320255180008", "CRATOS/00000012320255180008_EMPRESA EXEMPLO CNIB Inclusao.pdf", b64(200));
  checar(Cofre.listar("00000012320255180008").length === 2,
    "mesmo nome + conteúdo DIFERENTE = mantém os dois (nunca descarta em silêncio)");

  Cofre.guardar("999", "a.pdf", b64(6 * 1024 * 1024));
  Cofre.guardar("999", "b.pdf", b64(6 * 1024 * 1024));
  const l999 = Cofre.listar("999");
  checar(l999.length === 1 && l999[0].nome === "b.pdf",
    "estourou o teto do processo: descarta o MAIS ANTIGO (guardar demais e falhar no POST é pior)");

  Cofre.limpar("00000012320255180008");
  checar(Cofre.listar("00000012320255180008").length === 0, "limpar() esvazia o processo");
  checar(Cofre.listar("outro") .length === 0 && Cofre.listar("999").length === 1,
    "limpar() não encosta nos outros processos");
}

/* ────────────────────────────────────────────────────────────────────────────
   2. O ANEXO (painel)
   ──────────────────────────────────────────────────────────────────────────── */
function montarPainel(cofre, tipos) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>",
    { url: "https://pje.trt18.jus.br/pjekz/processo/123", runScripts: "outside-only" });
  const w = dom.window;
  const chamadas = [];
  const mem = {};
  w.browser = {
    storage: {
      local: {
        get: async (k) => ({ [k]: mem[k] }),
        set: async (o) => Object.assign(mem, o),
        remove: async () => {},
      },
      onChanged: { addListener: () => {} },
    },
    runtime: {
      sendMessage: async (m) => {
        chamadas.push({ msg: m });
        if (m.tipo === "cofre_pegar") return { ok: true, arquivos: cofre };
        return { ok: true };
      },
      onMessage: { addListener: () => {} },
      getURL: (p) => "moz-extension://x/" + p,
    },
  };
  const rede = [];
  w.fetch = async (url, init) => {
    const metodo = (init && init.method) || "GET";
    let corpo = null;
    try { corpo = init && init.body ? JSON.parse(init.body) : null; } catch (e) {}
    rede.push({ url: String(url), metodo, corpo });
    if (/PARAMETRO_TAMANHO_MAXIMO_ARQUIVO_PDF/.test(url)) {
      return { ok: true, status: 200, json: async () => ({ valorVariavel: "10" }) };
    }
    if (/\/documentos\/$/.test(String(url).split("?")[0]) && metodo === "POST") {
      if (corpo && /FALHA/.test(corpo.nomeArquivo || "")) {
        return { ok: false, status: 500, json: async () => ({}), text: async () => "erro" };
      }
      return { ok: true, status: 200, json: async () => ({ id: 900 + rede.length, idBin: 1, md5: "x" }) };
    }
    // GET da lista de partes para a visibilidade (partes principais)
    if (/visibilidadesigilo\/\?/.test(String(url)) && metodo === "GET") {
      return { ok: true, status: 200, json: async () => ({
        pagina: 1, totalRegistros: (w.__partesVis || []).length,
        resultado: w.__partesVis || [],
      }) };
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
  };
  w.console.log = () => {}; w.console.warn = () => {}; w.console.error = () => {};
  w.eval(fs.readFileSync(path.join(SRC, "comum", "storage.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(SRC, "comum", "relatorio.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(SRC, "comum", "faixa.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(SRC, "conteudo", "painel.js"), "utf8"));
  return { w, rede, chamadas, tipos };
}

const TIPOS = [
  { id: 57, nomeTipoProcessoDocumento: "Certidão", codigoDocumento: "7323" },
  { id: 115, nomeTipoProcessoDocumento: "Documento Diverso", codigoDocumento: "80" },
];
const CERT = {
  titulo: "Convênios realizados", tipo: "realizados", html: "<p>x</p>",
  arquivos: ["a CNIB Inclusao.pdf", "b RENAJUD Inclusao.pdf"],
};

(async () => {
  /* 2a. caminho feliz */
  {
    const cofre = [
      { nome: "a CNIB Inclusao.pdf", base64: b64(100), bytes: 100 },
      { nome: "b RENAJUD Inclusao.pdf", base64: b64(120), bytes: 120 },
      { nome: "z CNIB Baixa.pdf", base64: b64(90), bytes: 90 },   // outra família
    ];
    const { w, rede } = montarPainel(cofre);
    const api = w.__cratosJuntada;
    checar(!!api, "o gancho __cratosJuntada existe");
    const r = await api.anexarPdfs("123", { id: 555, idPessoaInclusao: 77 }, CERT, "00000012320255180008", TIPOS);

    const posts = rede.filter((x) => x.metodo === "POST" && /\/documentos\/$/.test(x.url.split("?")[0]));
    checar(posts.length === 2, "anexa os 2 arquivos da família");
    checar(r.anexados.length === 2, "informa os 2 como anexados");
    checar(!posts.some((p) => /CNIB Baixa/.test(p.corpo.nomeArquivo)),
      "NÃO anexa o comprovante de cancelamento à certidão de inclusão (cada família com os seus)");
    checar(posts.every((p) => typeof p.corpo.conteudoBase64 === "string" && p.corpo.conteudoBase64.length > 0),
      "o PDF vai em conteudoBase64 — não é multipart");
    checar(posts.map((p) => p.corpo.numeroOrdem).join(",") === "1,2", "numeroOrdem 1..N");
    checar(posts.every((p) => p.corpo.idDocumentoPrincipal === 555),
      "todo anexo aponta para a minuta como documento principal");
    checar(posts.every((p) => p.corpo.sigiloso === true), "anexo nasce sigiloso, como a tela faz");
    checar(posts.every((p) => p.corpo.idTipo === 115 && p.corpo.codigoTipoDocumento === "80"),
      "o tipo do anexo veio do catálogo (Documento Diverso)");
    checar(rede.some((x) => /visibilidadesigilo/.test(x.url) && /\/documentos\/9\d\d\//.test(x.url)),
      "cada anexo recebe a visibilidade logo depois");
    checar(rede.some((x) => /PARAMETRO_TAMANHO_MAXIMO_ARQUIVO_PDF/.test(x.url)),
      "o teto de upload é PERGUNTADO ao PJe, não suposto");

    /* ⛔ A asserção mais importante do projeto. */
    const suspeitas = rede.filter((x) => /assin|signature|podeotp|token|certificad/i.test(x.url));
    checar(suspeitas.length === 0,
      "⛔ NENHUMA chamada toca assinatura — aqui não há diálogo: o clique assinaria de verdade");
    checar(!rede.some((x) => x.corpo && JSON.stringify(x.corpo).match(/"assinar"\s*:\s*true/i)),
      "⛔ nenhum corpo manda assinar:true");
  }

  /* 2b. cofre vazio — degradação honesta */
  {
    const { w, rede } = montarPainel([]);
    const r = await w.__cratosJuntada.anexarPdfs("123", { id: 555, idPessoaInclusao: 77 }, CERT, "000", TIPOS);
    checar(r.anexados.length === 0, "cofre vazio: não anexa nada");
    checar(!rede.some((x) => /\/documentos\/$/.test(x.url.split("?")[0]) && x.metodo === "POST"),
      "cofre vazio: não faz POST nenhum de anexo");
    checar(Array.isArray(r.falharam) && r.falharam.length === 0,
      "cofre vazio NÃO é falha — é o comportamento de até a 1.0.7, que continua valendo");
  }

  /* 2c. um anexo falha: não derruba os outros nem a minuta */
  {
    const cofre = [
      { nome: "a CNIB Inclusao.pdf", base64: b64(100), bytes: 100 },
      { nome: "FALHA RENAJUD Inclusao.pdf", base64: b64(100), bytes: 100 },
    ];
    const cert = Object.assign({}, CERT, { arquivos: ["a CNIB Inclusao.pdf", "FALHA RENAJUD Inclusao.pdf"] });
    const { w, rede } = montarPainel(cofre);
    const r = await w.__cratosJuntada.anexarPdfs("123", { id: 555, idPessoaInclusao: 77 }, cert, "000", TIPOS);
    checar(r.anexados.length === 1 && r.falharam.length === 1,
      "um anexo falha, o outro entra");
    checar(r.falharam[0].nome === "FALHA RENAJUD Inclusao.pdf" && !!r.falharam[0].motivo,
      "a falha é NOMEADA com o motivo (não some no console)");
    const posts = rede.filter((x) => x.metodo === "POST" && /\/documentos\/$/.test(x.url.split("?")[0]));
    checar(posts[0].corpo.numeroOrdem === 1, "o que entrou ficou com numeroOrdem 1");
  }

  /* 2d. arquivo maior que o teto */
  {
    const cofre = [{ nome: "a CNIB Inclusao.pdf", base64: "x", bytes: 50 * 1024 * 1024 }];
    const cert = Object.assign({}, CERT, { arquivos: ["a CNIB Inclusao.pdf"] });
    const { w, rede } = montarPainel(cofre);
    const r = await w.__cratosJuntada.anexarPdfs("123", { id: 555, idPessoaInclusao: 77 }, cert, "000", TIPOS);
    checar(r.anexados.length === 0 && r.falharam.length === 1,
      "arquivo acima do teto não é enviado");
    checar(/limite de 10 MB/.test(r.falharam[0].motivo),
      "a mensagem diz o limite REAL que o PJe informou, não um número inventado");
    checar(!rede.some((x) => x.metodo === "POST" && /\/documentos\/$/.test(x.url.split("?")[0])),
      "não tenta e falha no servidor: nem manda");
  }

  /* 2d-bis. DESCRIÇÃO ≤ 100 caracteres (erro ARQ-043, campo 04/09).
     Nome de parte longo estourava o limite do PJe e o anexo falhava com 400. */
  {
    const longo = "00000045620255180008_1E_MARIANA EXEMPLO GONCALVES - ESCOLA MODELO ENCANTADA - ME RENAJUD Consulta Negativa.pdf";
    checar(longo.replace(/\.pdf$/i, "").length > 100, "(pré-condição do teste: o nome cru passa de 100)");
    const cofre = [{ nome: longo, base64: b64(80), bytes: 80 }];
    const cert = Object.assign({}, CERT, { titulo: "Convênios realizados", tipo: "realizados", arquivos: [longo] });
    const { w, rede } = montarPainel(cofre);
    const r = await w.__cratosJuntada.anexarPdfs("123", { id: 555, idPessoaInclusao: 77 }, cert, "000", TIPOS);
    const post = rede.find((x) => x.metodo === "POST" && /\/documentos\/$/.test(x.url.split("?")[0]));
    checar(r.anexados.length === 1, "anexa mesmo com nome longo");
    checar(post && post.corpo.titulo.length <= 100,
      "⛔ a DESCRIÇÃO enviada ao PJe é capada em 100 caracteres (não estoura o ARQ-043)");
    checar(post && post.corpo.nomeArquivo === longo,
      "o nome do ARQUIVO segue inteiro — só a descrição é cortada");
  }

  /* 2e. catálogo sem "Documento Diverso" — cai no observado, mas não quebra */
  {
    const cofre = [{ nome: "a CNIB Inclusao.pdf", base64: b64(50), bytes: 50 }];
    const cert = Object.assign({}, CERT, { arquivos: ["a CNIB Inclusao.pdf"] });
    const { w, rede } = montarPainel(cofre);
    const r = await w.__cratosJuntada.anexarPdfs("123", { id: 555, idPessoaInclusao: 77 }, cert, "000",
      [{ id: 57, nomeTipoProcessoDocumento: "Certidão" }]);
    const post = rede.find((x) => x.metodo === "POST" && /\/documentos\/$/.test(x.url.split("?")[0]));
    checar(r.anexados.length === 1, "sem o tipo no catálogo, ainda assim anexa");
    checar(post.corpo.idTipo === 115 && post.corpo.codigoTipoDocumento === "80",
      "cai nos valores observados no TRT18 como ÚLTIMO recurso");
  }

  /* ─────────────────────────────────────────────────────────────────────────
     VISIBILIDADE ÀS PARTES (1.2.5) — o pedido do Rodrigo, HAR de 03/09.
     Documentos nascem sigilosos; sem isto as partes não veem a certidão.
     ───────────────────────────────────────────────────────────────────────── */
  const PARTES = [
    { idPessoa: 579621, nome: "PARTE ATIVA EXEMPLO", polo: "ATIVO", visibilidade: false },
    { idPessoa: 1176209, nome: "PARTE PASSIVA UM", polo: "PASSIVO", visibilidade: false },
    { idPessoa: 331029, nome: "PARTE PASSIVA DOIS", polo: "PASSIVO", visibilidade: false },
  ];

  /* polosDaConfig: o padrão e os limites da leitura da Preferência. */
  {
    const { w } = montarPainel([]);
    const P = w.__cratosJuntada;
    checar(!!P.definirVisibilidadePartes && !!P.polosDaConfig,
      "o gancho expõe definirVisibilidadePartes e polosDaConfig");
    const semCfg = P.polosDaConfig({});
    checar(semCfg.ativo === true && semCfg.passivo === true,
      "⛔ sem Preferência salva, o padrão é AMBOS os polos (não silencia a certidão)");
    const vazio = P.polosDaConfig({ visibilidadePartes: [] });
    checar(vazio.ativo === false && vazio.passivo === false,
      "vazio explícito ([]) = não dá visibilidade a ninguém");
    const soPassivo = P.polosDaConfig({ visibilidadePartes: ["Polo passivo"] });
    checar(soPassivo.ativo === false && soPassivo.passivo === true, "só passivo é respeitado");
  }

  /* Ambos os polos: todas as partes × todos os documentos, visibilidade:true. */
  {
    const { w, rede } = montarPainel([]);
    w.__partesVis = PARTES;
    const r = await w.__cratosJuntada.definirVisibilidadePartes("123", [555, 900, 901],
      { ativo: true, passivo: true });
    const post = rede.find((x) => x.metodo === "POST" && /visibilidadesigilo\?/.test(x.url));
    checar(!!post, "faz o POST de visibilidade");
    checar(/apenasPessoaComParteENaoParte=false/.test(post.url) && /armazenarHistorico=true/.test(post.url),
      "⛔ no endpoint das PARTES (apenasPessoaComParteENaoParte=false), como o PJe faz");
    checar(/\/documentos\/0\/sigilo\/0\//.test(post.url), "documentos/0/sigilo/0 (ids vão no corpo)");
    checar(post.corpo.length === 9, "⛔ 3 partes × 3 documentos = 9 itens");
    checar(post.corpo.every((x) => x.visibilidade === true && x.terceiro === false),
      "todos com visibilidade:true, terceiro:false");
    const docs = Array.from(new Set(post.corpo.map((x) => x.idDocumento))).sort();
    checar(docs.join(",") === "555,900,901", "⛔ cobre a MINUTA (555) e os anexos (900,901)");
    checar(r && r.ok && r.pessoas === 3 && r.docs === 3, "devolve o resumo certo (3 partes, 3 docs)");
  }

  /* Só passivo: filtra pelo polo. */
  {
    const { w, rede } = montarPainel([]);
    w.__partesVis = PARTES;
    await w.__cratosJuntada.definirVisibilidadePartes("123", [555], { ativo: false, passivo: true });
    const post = rede.find((x) => x.metodo === "POST" && /visibilidadesigilo\?/.test(x.url));
    const pes = Array.from(new Set(post.corpo.map((x) => x.idPessoa))).sort((a, b) => a - b);
    checar(pes.join(",") === "331029,1176209",
      "⛔ só os PASSIVOS entram — o ativo (579621) fica de fora");
  }

  /* Nenhuma parte no polo pedido → não faz POST (não inventa). */
  {
    const { w, rede } = montarPainel([]);
    w.__partesVis = [{ idPessoa: 579621, polo: "ATIVO" }];
    const r = await w.__cratosJuntada.definirVisibilidadePartes("123", [555], { ativo: false, passivo: true });
    const post = rede.find((x) => x.metodo === "POST" && /visibilidadesigilo\?/.test(x.url));
    checar(!post && r.pulou, "sem parte no polo escolhido, não faz POST nem quebra");
  }

  /* Fiação: juntarCertidao chama a visibilidade com minuta + anexos. */
  {
    const src = fs.readFileSync(path.join(SRC, "conteudo", "painel.js"), "utf8");
    checar(/definirVisibilidadePartes\(idProcesso, docIds, polos\)/.test(src) &&
           /\[meta\.id\]\.concat\(anexos\.idsAnexos/.test(src),
      "⛔ juntarCertidao dá visibilidade à MINUTA + anexos (não só aos anexos)");
    checar(/idsAnexos: \[\]/.test(src) && /resultado\.idsAnexos\.push\(doc\.id\)/.test(src),
      "anexarPdfs devolve os ids dos anexos para a visibilidade");
  }

  /* ─────────────────────────────────────────────────────────────────────────
     NOME DE ARQUIVO ÚNICO POR DOCUMENTO — o bug do WAGNER (CPF + CNPJ), 03/09.
     Duas partes homônimas de documentos diferentes geravam o MESMO nome; o Cofre
     guarda por nome e sobrescrevia uma certidão pela outra (perda na juntada),
     e o painel travava em "1 de 2".
     ───────────────────────────────────────────────────────────────────────── */
  {
    const Cofre = cofreDoBackground();
    /* CAMADA 2 — a rede de segurança do Cofre, por CONTEÚDO EXATO (não por
       tamanho, que colide entre PDFs diferentes). */
    // retry: mesmo nome, MESMO conteúdo → fica 1 (troca a versão)
    Cofre.guardar("111", "X.pdf", b64(100));
    const nRetry = Cofre.guardar("111", "X.pdf", b64(100));
    checar(Cofre.listar("111").length === 1 && nRetry === "X.pdf",
      "mesmo nome + MESMO conteúdo = retry: fica 1");
    Cofre.limpar("111");
    // documentos DIFERENTES, mesmo nome → mantém os DOIS (renomeia o 2º)
    const nA = Cofre.guardar("111", "Y.pdf", b64(100));
    const nB = Cofre.guardar("111", "Y.pdf", b64(120));   // conteúdo diferente
    checar(Cofre.listar("111").length === 2,
      "⛔ mesmo nome + conteúdo DIFERENTE = dois documentos: NUNCA descarta em silêncio");
    checar(nA === "Y.pdf" && nB === "Y (2).pdf",
      "⛔ o 2º é renomeado (Y (2).pdf) e `guardar` DEVOLVE o nome usado — p/ o diário casar");
    Cofre.limpar("111");

    // nomes únicos na FONTE (as três correções de nome)
    const cen = fs.readFileSync(path.join(SRC, "conteudo", "censec.js"), "utf8");
    checar(/\$\{ordem\}E_/.test(cen) && /_\$\{ne\}\$\{nomeArq\} CENSEC CEP\.pdf/.test(cen),
      "⛔ CENSEC: ordinal da parte (1E, 2E…) no nome do arquivo");
    const ren = fs.readFileSync(path.join(SRC, "conteudo", "renajud.js"), "utf8");
    checar(/_rotuloExec\(est,/.test(ren),
      "⛔ RENAJUD: ordinal da executada no nome (folha e negativa)");
    // a negativa usa dois nomes (não o nome inteiro) — encurta o arquivo/descrição
    const neg = ren.slice(ren.indexOf("function fabricarCertidaoNegativa"),
      ren.indexOf("function fabricarCertidaoNegativa") + 500);
    checar(/nomeArq = _primeirosDois\(/.test(neg),
      "⛔ RENAJUD negativa: dois primeiros nomes no arquivo (não o nome inteiro)");
    const bg = fs.readFileSync(path.join(SRC, "background.js"), "utf8");
    checar(/function montarNomePdf\(pasta, numProcesso, nomeAbrev, tipoLabel, ext, ni\)/.test(bg) &&
           /idParte = doc \?/.test(bg),
      "⛔ INFOJUD: o documento (NI) entra no nome do arquivo da colheita");
    // e montarNomePdf de fato inclui o NI
    const ini = bg.indexOf("function montarNomePdf");
    const fim = bg.indexOf("\n}", ini) + 2;   // até a chave de fechamento da função
    const mnp = new Function(bg.slice(ini, fim) + "\nreturn montarNomePdf;")();
    checar(mnp("CRATOS", "00000078920255180008", "SALAO EXEMPLO", "DITR 2026", "pdf", "11.222.333/0001-81")
      .indexOf("11222333000181") >= 0,
      "⛔ montarNomePdf põe o NI no nome (duas SALAO EXEMPLO não colidem)");
  }

  console.log("\n=== teste-juntada-anexos.js ===");
  oks.forEach((d) => console.log("  ok   " + d));
  falhas.forEach((d) => console.log("  FALHA " + d));
  console.log(`\n${oks.length} passaram, ${falhas.length} falharam ` +
    `(${oks.length + falhas.length} asserções)\n`);
  process.exit(falhas.length ? 1 : 0);
})();
