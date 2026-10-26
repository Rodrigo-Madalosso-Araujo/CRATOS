/*
 * teste-infojud-empresas.js — INFOJUD "Recuperar NI – CNPJ" pelo CPF do executado (1.9.0).
 * Páginas FICTÍCIAS no formato do HAR e dos prints de 23/10 (table.Tabela, td.erro,
 * detalhe rótulo:valor). Dados inventados.
 *
 * Trava: só o CPF Responsável vai no pedido (com máscara), com a sessão da página;
 * "Nenhum registro encontrado." = nenhuma empresa; "mais de 50 registros" = refaz pelas
 * 27 UFs (UF que ainda passar de 50 é certificada como tal); detalhe de cada empresa
 * (endereço); ⛔ falha técnica nunca vira negativa; certidão consolidada objetiva;
 * acentos da página (windows-1252) lidos certo; gancho no fluxo do INFOJUD uma vez por
 * execução, com interruptor; solicitações seguem em qualquer caso. Reprova a 1.8.7.
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const NOME = "teste-infojud-empresas.js";
const oks = [], falhas = [];
const checar = (c, d) => (c ? oks : falhas).push(d);
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 20));

if (!fs.existsSync(path.join(SRC, "conteudo", "infojud-empresas.js"))) {
  console.log(`\n=== ${NOME} ===\n  FALHA  a versão em ${SRC} não tem o "Recuperar NI – CNPJ" (conteudo/infojud-empresas.js).\n\n0 passaram — a suíte inteira reprova nesta versão.\n`);
  process.exit(1);
}

/* ── páginas fictícias ── */
const CPF_A = "12345678909", CPF_B = "98765432100", CPF_C = "11144477735";
const fmt = (c) => c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
const casca = (miolo) => `<html><head><title>e-CAC</title></head><body><table width="100%"><tr><td>INFORMAÇÕES AO JUDICIÁRIO</td></tr></table><br>
  <form action="" method="post" name="formRegistrar"><table class="Tabela" align="center" cellspacing="1" cellpadding="1"><tbody>${miolo}</tbody></table></form></body></html>`;
const listaHtml = (empresas, cpf) => casca(`<tr><td colspan="8">INFORMAÇÕES AO JUDICIÁRIO - Recuperar NI - CNPJ</td></tr>
  <tr><td>#</td><td>CNPJ</td><td>Nome Empresarial</td><td>Nome Fantasia</td><td>CPF Responsável</td><td>UF</td><td>Município</td><td>Detalhe</td></tr>
  ${empresas.map((e, i) => `<tr><td>${i + 1}</td><td>${e.cnpj}</td><td>${e.nome}</td><td>${e.fant}</td><td>${fmt(cpf)}</td><td>${e.uf}</td><td>${e.mun}</td>
    <td><a href="detalheNICNPJ.asp?NI=${e.cnpj.replace(/\D/g, "")}" title="Visualizar Solicitação" target=_self><img src="x.gif"></a></td></tr>`).join("")}
  <tr><td colspan="8"><input name="btVoltar" value="Voltar" onclick="window.location.href='recuperaNICNPJs.asp'" type="button"></td></tr>`);
const erroHtml = (t) => casca(`<tr><td>.</td></tr><tr><td>.</td></tr><tr><td class="erro" height="26">${t}</td></tr><tr><td><input type="button" value="Voltar"></td></tr>`);
const detalheHtml = (e) => casca(`<tr><td colspan="2">INFORMAÇÕES AO JUDICIÁRIO - Consulta de Informações Cadastrais</td></tr>
  <tr><td>CNPJ:</td><td>${e.cnpj}</td></tr><tr><td>Nome Empresarial Completo:</td><td>${e.nome} COMPLETO</td></tr>
  <tr><td>Nome Fantasia Completo:</td><td>${e.fant}</td></tr><tr><td>CPF do responsável:</td><td>000.000.000-00</td></tr>
  <tr><td>Logradouro:</td><td>RUA FICTÍCIA DAS FLORES , S/N</td></tr><tr><td>Complemento:</td><td>QD 1 LT 2</td></tr>
  <tr><td>Bairro:</td><td>SETOR EXEMPLO</td></tr><tr><td>Município:</td><td>${e.mun}</td></tr><tr><td>UF:</td><td>${e.uf}</td></tr><tr><td>CEP:</td><td>74000-000</td></tr>`);
const E1 = { cnpj: "11.222.333/0001-81", nome: "COMÉRCIO FICTÍCIO LTDA", fant: "LOJA EXEMPLO", uf: "GO", mun: "GOIÂNIA" };
const E2 = { cnpj: "22.333.444/0001-50", nome: "SERVIÇOS DE TESTE EIRELI", fant: "TESTE", uf: "GO", mun: "ANÁPOLIS" };
const E3 = { cnpj: "33.444.555/0001-19", nome: "EMPRESA DE SÃO PAULO SA", fant: "", uf: "SP", mun: "SÃO PAULO" };
const E4 = { cnpj: "44.555.666/0001-03", nome: "UNICA EMPRESA FICTICIA ME", fant: "UNICA", uf: "GO", mun: "RIO VERDE" };
const E5 = { cnpj: "55.666.777/0001-70", nome: "BAHIA FICTICIA LTDA", fant: "", uf: "BA", mun: "SALVADOR" };
const MAIS50 = "Foram encontrados mais de 50 registros.<br>Favor rever os filtros";
const NENHUM = "Nenhum registro encontrado.";
const BASE = "https://cav.receita.fazenda.gov.br/Servicos/ATSDR/Decjuiz/";
/* COMO É AO VIVO (teste do Rodrigo, 23/10): o POST responde 302 → erro.asp?erro=<frase>, e a
   erro.asp escreve a frase por document.write — a td.erro chega VAZIA para quem lê o HTML. */
const erroVazioHtml = casca(`<tr><td>.</td></tr><tr><td>.</td></tr><tr><td class="erro" height="26"><script>document.write(unescape(location.search))</script></td></tr><tr><td><input type="button" value="Voltar"></td></tr>`);
const redirErro = (msg) => resp(erroVazioHtml, 200, BASE + "erro.asp?erro=" + encodeURIComponent(msg));
/* Uma empresa só: a Receita abre o detalhe direto */
const redirDetalhe = (e) => resp(detalheHtml(e), 200, BASE + "detalheNICNPJ.asp?NI=" + e.cnpj.replace(/\D/g, ""));

/* resposta como o fetch real: bytes em windows-1252 (a página do e-CAC não declara charset) */
const resp = (html, status, url) => {
  const b = Buffer.from(html, "latin1");
  return { ok: (status || 200) < 400, status: status || 200, url: url || null, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
};

function ambiente(rota) {
  const dom = new JSDOM("<!doctype html><body></body>", { url: "https://cav.receita.fazenda.gov.br/Servicos/ATSDR/Decjuiz/solicitacao.asp", runScripts: "outside-only" });
  const w = dom.window;
  w.eval(fs.readFileSync(path.join(SRC, "conteudo", "infojud-empresas.js"), "utf8"));
  const M = w.CratosEmpresasInfojud;
  const chamadas = [], avisosConsole = [];
  w.console.warn = (...a) => avisosConsole.push(a.join(" "));
  M.io.esperar = async () => {};
  M.io.agora = () => Date.parse("2026-10-23T10:30:00-03:00");
  M.io.fetch = async (url, o) => {
    const corpo = o && o.body ? Object.fromEntries(new URLSearchParams(o.body)) : null;
    chamadas.push({ url, o, corpo });
    const r = await rota(url, corpo, chamadas);
    if (r && !r.url) r.url = url;   // sem redirecionamento: o endereço final é o pedido
    return r;
  };
  return { w, M, chamadas, avisosConsole };
}

(async () => {
  /* ── 1. leitura das páginas ────────────────────────────────────────────── */
  {
    const { w, M } = ambiente(() => resp(""));
    void w;
    checar(M.lerLista(listaHtml([E1, E2], CPF_A)).tipo === "empresas" && M.lerLista(listaHtml([E1, E2], CPF_A)).empresas.length === 2,
      "lista: lê as empresas da table.Tabela");
    const e = M.lerLista(listaHtml([E1], CPF_A)).empresas[0];
    checar(e.cnpj === E1.cnpj && e.nomeEmpresarial === E1.nome && e.uf === "GO" && /detalheNICNPJ\.asp\?NI=11222333000181/.test(e.detalhe),
      "lista: CNPJ, nome, UF e link do detalhe de cada linha");
    checar(M.lerLista(erroHtml(NENHUM)).tipo === "nenhuma", "\"Nenhum registro encontrado.\" (td.erro) = nenhuma empresa");
    checar(M.lerLista(erroHtml(MAIS50)).tipo === "excesso", "\"Foram encontrados mais de 50 registros\" = excesso");
    checar(M.lerLista(erroHtml("Sessão expirada. Faça login novamente.")).tipo === "falha" &&
      M.lerLista("<html><body><form id=login><input name=senha></form></body></html>").tipo === "falha",
      "⛔ outra mensagem (sessão expirada) ou tela de login = FALHA, nunca \"nenhuma\"");
    const d = M.lerDetalhe(detalheHtml(E1), E1.cnpj);
    checar(d && d.logradouro === "RUA FICTÍCIA DAS FLORES , S/N" && d.cep === "74000-000" && d.municipio === "GOIÂNIA" && d.uf === "GO",
      "detalhe: endereço completo (logradouro, complemento, bairro, município, UF, CEP)");
    checar(M.lerDetalhe(detalheHtml(E2), E1.cnpj) === null, "⛔ detalhe de OUTRA empresa é recusado");
  }

  /* ── 2. consulta ───────────────────────────────────────────────────────── */
  const rotaPadrao = (url, corpo) => {
    if (/listaNICNPJ\.asp/.test(url)) {
      const cpf = corpo.cpfResponsavel.replace(/\D/g, "");
      if (cpf === CPF_A) return resp(listaHtml([E1, E2], CPF_A));
      if (cpf === CPF_B) return redirErro(NENHUM);
      return resp(erroHtml("Erro inesperado"));
    }
    if (/detalheNICNPJ\.asp\?NI=11222333000181/.test(url)) return resp(detalheHtml(E1));
    if (/detalheNICNPJ\.asp\?NI=22333444000150/.test(url)) return resp("", 500);
    return resp("", 404);
  };
  const PARTES = [
    { tipo: "CPF", ni: CPF_A, nome: "FULANO FICTICIO DA SILVA", processo: "0000001-23.2025.5.18.0008" },
    { tipo: "CPF", ni: CPF_B, nome: "BELTRANA EXEMPLO PEREIRA", processo: "0000001-23.2025.5.18.0008" },
    { tipo: "CNPJ", ni: "11222333000181", nome: "EMPRESA EXECUTADA LTDA", processo: "0000001-23.2025.5.18.0008" },
  ];
  {
    const { M, chamadas } = ambiente(rotaPadrao);
    const res = await M.recuperar(PARTES);
    const posts = chamadas.filter((c) => /listaNICNPJ/.test(c.url));
    checar(posts.length === 2 && posts.every((c) => c.o.method === "POST" && c.o.credentials === "include" &&
      c.url === "https://cav.receita.fazenda.gov.br/Servicos/ATSDR/Decjuiz/listaNICNPJ.asp"),
      "um POST por executado PESSOA FÍSICA, com a sessão da página (PJ fica de fora)");
    checar(posts[0].corpo.cpfResponsavel === "123.456.789-09" && ["cnpj", "nomeEmpresarial", "nomeFantasia", "uf", "codMunSelecionado", "municipio"].every((k) => posts[0].corpo[k] === ""),
      "⛔ só o CPF Responsável vai preenchido (com máscara, como a tela manda)");
    const a = res.resultados[0], b = res.resultados[1];
    checar(a.situacao === "empresas" && a.empresas.length === 2 && a.empresas[0].endereco && a.empresas[0].endereco.cep === "74000-000" && a.empresas[1].endereco === null,
      "empresas encontradas, com o detalhe de cada uma (detalhe que falhou fica sem endereço)");
    checar(b.situacao === "nenhuma", "\"Nenhum registro encontrado.\" → nenhuma empresa");
    checar(res.semCpf.length === 1 && res.semCpf[0] === "EMPRESA EXECUTADA LTDA", "pessoa jurídica: registrada como não consultada");
    checar(a.empresas[0].nomeEmpresarial === "COMÉRCIO FICTÍCIO LTDA" && a.empresas[0].municipio === "GOIÂNIA", "acentos da página (windows-1252) lidos certo");
  }
  {
    /* mais de 50 → por UF */
    const { M, chamadas } = ambiente((url, corpo) => {
      if (/listaNICNPJ\.asp/.test(url)) {
        if (!corpo.uf) return redirErro(MAIS50);
        if (corpo.uf === "GO") return resp(listaHtml([E1, E2], CPF_C));
        if (corpo.uf === "SP") return resp(listaHtml([E3], CPF_C));
        if (corpo.uf === "RJ") return redirErro(MAIS50);
        if (corpo.uf === "BA") return redirDetalhe(E5);
        if (corpo.uf === "MG") return resp("<html>erro</html>", 500);
        return redirErro(NENHUM);
      }
      if (/detalheNICNPJ/.test(url)) { const ni = url.split("NI=")[1]; return resp(detalheHtml([E1, E2, E3].find((e) => e.cnpj.replace(/\D/g, "") === ni))); }
      return resp("", 404);
    });
    const res = await M.recuperar([{ tipo: "CPF", ni: CPF_C, nome: "CICRANO MUITAS EMPRESAS" }]);
    const r = res.resultados[0];
    const ufs = chamadas.filter((c) => /listaNICNPJ/.test(c.url) && c.corpo.uf).map((c) => c.corpo.uf);
    checar(new Set(ufs).size === 27 && chamadas.filter((c) => /listaNICNPJ/.test(c.url) && !c.corpo.uf).length === 1,
      "⛔ \"mais de 50\" → refaz a pesquisa pelas 27 UFs, uma a uma");
    checar(r.porUF && r.situacao === "empresas" && r.empresas.length === 4 && r.empresas.every((e) => e.endereco),
      "junta as empresas de todas as UFs, com o detalhe de cada uma");
    checar(r.empresas.some((e) => e.cnpj === E5.cnpj && e.endereco.municipio === "SALVADOR") && !chamadas.some((c) => /NI=55666777000170/.test(c.url)),
      "UF com UMA empresa: a Receita abre o detalhe direto — aproveitado, sem pedir o detalhe de novo");
    checar(r.ufsExcedidas.join() === "RJ" && r.ufsFalhas.join() === "MG" && ufs.filter((u) => u === "MG").length === 2,
      "UF que ainda passa de 50 e UF que falhou (depois de uma 2ª tentativa) ficam registradas à parte");
    const L = M.linhasCertidao(res, { numProcesso: "0000001-23.2025.5.18.0008" }).join("\n");
    checar(/foi refeita por UF/.test(L) && /Na\(s\) UF\(s\) RJ, a consulta ainda retornou mais de 50 registros/.test(L) && /Na\(s\) UF\(s\) MG, a consulta não pôde ser concluída/.test(L),
      "certidão: diz que foi por UF, e quais UFs passaram de 50 ou falharam");
  }
  {
    /* AO VIVO (23/10): 302 → erro.asp?erro=… com a td.erro VAZIA */
    const CPF_D = "52998224725", CPF_E = "39053344705";
    const { M, chamadas } = ambiente((url, corpo) => {
      if (/listaNICNPJ\.asp/.test(url)) {
        const cpf = corpo.cpfResponsavel.replace(/\D/g, "");
        if (cpf === CPF_B) return redirErro(NENHUM);
        if (cpf === CPF_D) return redirDetalhe(E4);
        if (cpf === CPF_E) return resp(detalheHtml(E4));   // detalhe servido sem redirecionar
      }
      return resp("", 404);
    });
    const res = await M.recuperar([{ tipo: "CPF", ni: CPF_B, nome: "B" }, { tipo: "CPF", ni: CPF_D, nome: "D" }, { tipo: "CPF", ni: CPF_E, nome: "E" }]);
    const [b, d, e] = res.resultados;
    checar(b.situacao === "nenhuma" && /Nenhum registro encontrado/.test(b.mensagem),
      "⛔ AO VIVO: 302 → erro.asp com a célula de erro VAZIA — a frase vem do endereço: \"Nenhum registro encontrado.\" = nenhuma");
    checar((M.lerResposta || (() => ({ tipo: "?", mensagem: "" })))(erroVazioHtml, BASE + "erro.asp?erro=" + encodeURIComponent(MAIS50)).tipo === "excesso",
      "⛔ AO VIVO: \"mais de 50\" pelo endereço do erro.asp = excesso (vai por UF)");
    const desconhecida = (M.lerResposta || (() => ({ tipo: "?", mensagem: "" })))(erroVazioHtml, BASE + "erro.asp?erro=" + encodeURIComponent("Serviço temporariamente indisponível"));
    checar(desconhecida.tipo === "falha" && /o INFOJUD respondeu: Serviço temporariamente indisponível/.test(desconhecida.mensagem) &&
      (M.lerResposta || (() => ({ tipo: "?", mensagem: "" })))(erroVazioHtml, BASE + "erro.asp").tipo === "falha",
      "⛔ erro.asp com outra frase (ou sem frase) = FALHA, nunca negativa");
    checar(d.situacao === "empresas" && d.empresas.length === 1 && d.empresas[0].cnpj === E4.cnpj && d.empresas[0].endereco.cep === "74000-000" &&
      d.empresas[0].nomeEmpresarial === "UNICA EMPRESA FICTICIA ME COMPLETO" && !chamadas.some((c) => /detalheNICNPJ/.test(c.url)),
      "UMA empresa: a resposta já é o detalhe (Rodrigo, 23/10) — empresa com endereço, sem pedir o detalhe de novo");
    checar(e.situacao === "empresas" && e.empresas.length === 1 && e.empresas[0].endereco.municipio === "RIO VERDE",
      "UMA empresa com o detalhe servido sem redirecionamento: reconhecido pelo conteúdo");
  }
  {
    /* falha total */
    const { M, chamadas, avisosConsole } = ambiente(() => resp("<html><body>Erro de sessão</body></html>"));
    const res = await M.recuperar([{ tipo: "CPF", ni: CPF_A, nome: "FULANO" }]);
    checar(avisosConsole.length === 2 && avisosConsole.every((t) => /CRATOS\/INFOJUD empresas: falha em pesquisa — HTTP 200 \| página: listaNICNPJ\.asp/.test(t)) &&
      !avisosConsole.some((t) => /123\.?456\.?789-?09|FULANO/.test(t)),
      "falha: o motivo vai para o console (código e página), sem CPF nem nome");
    const L = M.linhasCertidao(res, { numProcesso: "0000001-23.2025.5.18.0008" }).join("\n");
    checar(res.resultados[0].situacao === "falha" && chamadas.length === 2, "página fora do padrão: uma 2ª tentativa e, persistindo, FALHA");
    checar(/não pôde ser concluída \(o sistema não respondeu como esperado\) e deve ser repetida/.test(L) && !/Não foram localizadas/.test(L),
      "⛔ falha técnica NUNCA vira \"não foram localizadas empresas\"");
  }

  /* ── 3. certidão ───────────────────────────────────────────────────────── */
  {
    const { M } = ambiente(rotaPadrao);
    const res = await M.recuperar(PARTES);
    const L = M.linhasCertidao(res, { numProcesso: "0000001-23.2025.5.18.0008" }).join("\n");
    checar(/funcionalidade "Recuperar NI – CNPJ"/.test(L) && /processo nº 0000001-23\.2025\.5\.18\.0008/.test(L), "certidão: diz a funcionalidade do INFOJUD e o processo");
    checar(/1\) FULANO FICTICIO DA SILVA - CPF 123\.456\.789-09\n {3}Foram localizadas 2 empresa\(s\)/.test(L) &&
      /1\. CNPJ 11\.222\.333\/0001-81 — COMÉRCIO FICTÍCIO LTDA COMPLETO/.test(L) &&
      /Endereço: RUA FICTÍCIA DAS FLORES , S\/N, QD 1 LT 2, SETOR EXEMPLO, GOIÂNIA\/GO, CEP 74000-000/.test(L),
      "certidão: por executado, cada empresa com CNPJ, nome completo e endereço do detalhe");
    checar(/2\. CNPJ 22\.333\.444\/0001-50[\s\S]*Município\/UF: ANÁPOLIS\/GO\. Endereço não obtido nesta consulta\./.test(L),
      "certidão: empresa cujo detalhe falhou entra com o município/UF da lista e \"endereço não obtido\"");
    checar(/2\) BELTRANA EXEMPLO PEREIRA - CPF 987\.654\.321-00\n {3}Não foram localizadas empresas com este CPF como responsável \(o INFOJUD informou: "Nenhum registro encontrado\."\)/.test(L),
      "certidão: \"não foram localizadas\" só quando o INFOJUD DIZ \"Nenhum registro encontrado.\"");
    checar(/não consultadas nesta funcionalidade, por não serem pessoa física: EMPRESA EXECUTADA LTDA/.test(L) &&
      /exibidos pelo INFOJUD, transcritos sem tratamento/.test(L) && /feita pelo CRATOS, a pedido do\(a\) responsável/.test(L),
      "certidão: PJ não consultada, origem dos dados e rastro");
    checar(!/(patrimônio|bens|sócio oculto|fraude|blindagem|grupo econômico)/i.test(L), "⛔ certidão não tira conclusão (só o que a tela mostrou)");
  }

  /* ── 4. no fluxo do INFOJUD ────────────────────────────────────────────── */
  {
    const arq = fs.readFileSync(path.join(SRC, "conteudo", "ecac-infojud.js"), "utf8");
    checar(/if \(fila\.idx === 0 && !fila\.empresas && typeof CratosEmpresasInfojud !== "undefined" &&\s*!\(fila\.config && fila\.config\.cpf && fila\.config\.cpf\.recuperarEmpresas && fila\.config\.cpf\.recuperarEmpresas\.ativo === false\)\) \{\s*await recuperarEmpresasDosExecutados\(fila\);/.test(arq) &&
      arq.indexOf("await recuperarEmpresasDosExecutados(fila)") < arq.indexOf("const parte = fila.partes[fila.idx];"),
      "fluxo: antes da 1ª solicitação, uma vez por execução, respeitando o interruptor");
    const man = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8"));
    const cs = man.content_scripts.find((c) => c.js.includes("conteudo/ecac-infojud.js"));
    checar(cs.js.indexOf("conteudo/infojud-empresas.js") >= 0 && cs.js.indexOf("conteudo/infojud-empresas.js") < cs.js.indexOf("conteudo/ecac-infojud.js"),
      "manifest: infojud-empresas.js antes do ecac-infojud.js");

    /* Preferências (Rodrigo, 23/10): no quadro CPF, abaixo do eFinanceira, texto AO LADO da
       caixa, na redação dele; guardado em config.infojud.cpf. Render de verdade do opcoes.js
       com a config real do módulo. */
    {
      const ROT = "Recuperar NI - Expedir certidão consolidada das empresas em que o executado (pessoa física) é o responsável";
      const dm = new JSDOM(`<!doctype html><body><div id="modulos"></div></body>`, { url: "moz-extension://x/opcoes/opcoes.html", runScripts: "outside-only" });
      const ow = dm.window;
      let modInfo = null, salvo = null;
      ow.Registro = { adicionar: (m) => { modInfo = m; } };
      for (const k of ["log", "warn", "error", "debug"]) ow.console[k] = () => {};
      ow.browser = {
        runtime: { sendMessage: async (m) => (m && m.tipo === "catalogo") ? { modulos: [JSON.parse(JSON.stringify(modInfo))] } : {}, getManifest: () => ({ version: "1.9.0" }) },
        storage: { local: { get: async () => ({}), set: async (o) => { salvo = JSON.parse(JSON.stringify(o)); }, remove: async () => {} }, onChanged: { addListener() {} } },
      };
      ow.eval(fs.readFileSync(path.join(SRC, "comum", "storage.js"), "utf8"));
      ow.eval(fs.readFileSync(path.join(SRC, "modulos", "infojud.js"), "utf8"));
      ow.eval(fs.readFileSync(path.join(SRC, "opcoes", "opcoes.js"), "utf8"));
      await tick(250);
      const gCpf = ow.document.querySelector('.modulo[data-modulo="infojud"] .grupo[data-grupo="cpf"]');
      const gCnpj = ow.document.querySelector('.modulo[data-modulo="infojud"] .grupo[data-grupo="cnpj"]');
      const campos = gCpf ? [...gCpf.querySelectorAll(".campo")] : [];
      const ult = campos[campos.length - 1];
      const penult = campos[campos.length - 2];
      const cb = ult && ult.querySelector('input[type=checkbox][data-chave="recuperarEmpresas"]');
      checar(cb && cb.checked && cb.closest("label").textContent.trim() === ROT && !/Consultar/.test(ult.textContent) && ult.querySelectorAll("label").length === 1 &&
        /eFinanceira · Tipo de extrato/.test(penult.textContent),
        "Preferências: no quadro CPF, logo abaixo do eFinanceira, \"[✓] Recuperar NI - Expedir certidão…\" (texto ao lado, sem título, ligado)");
      const fora = [...ow.document.querySelectorAll('.modulo[data-modulo="infojud"] [data-chave="recuperarEmpresas"]')].filter((el) => !el.closest('.grupo[data-grupo="cpf"]'));
      checar(gCnpj && !fora.length, "Preferências: não aparece no quadro CNPJ nem no bloco geral");
      if (cb) { cb.checked = false; ow.document.getElementById("cx-salvar").click(); await tick(80); }
      const cfgS = salvo && Object.values(salvo)[0];
      checar(cfgS && cfgS.infojud && cfgS.infojud.cpf && cfgS.infojud.cpf.recuperarEmpresas && cfgS.infojud.cpf.recuperarEmpresas.ativo === false &&
        !("recuperarEmpresas" in cfgS.infojud), "Preferências: desmarcar salva em config.infojud.cpf (onde o INFOJUD lê)");
    }

    const montar = (recuperar) => {
      const dom = new JSDOM("<!doctype html><body></body>", { url: "https://cav.receita.fazenda.gov.br/servicos/ATSDR/decjuiz/resultadoSolicitacao.asp?numeroSolicitacao=1", runScripts: "outside-only" });
      const w = dom.window;
      const msgs = [], faixas = [], mem = {}, cortina = [];
      w.CratosFaixa = { parar() {}, alertar() {}, dizer() {}, mostrar: (m, t) => faixas.push(String(t)) };
      w.CratosOverlay = { mostrar: (t) => cortina.push("+" + t), esconder: () => cortina.push("-") };
      w.browser = { storage: { local: { get: async (k) => ({ [k]: mem[k] }), set: async (o) => Object.assign(mem, JSON.parse(JSON.stringify(o))), remove: async () => {} }, onChanged: { addListener() {} } },
        runtime: { sendMessage: async (m) => { msgs.push(m); return { ok: true }; }, onMessage: { addListener() {} }, getURL: (p) => p } };
      for (const k of ["log", "warn", "error", "debug"]) w.console[k] = () => {};
      w.eval(fs.readFileSync(path.join(SRC, "comum", "storage.js"), "utf8"));
      w.eval(fs.readFileSync(path.join(SRC, "conteudo", "infojud-empresas.js"), "utf8"));
      w.CratosEmpresasInfojud.recuperar = recuperar;
      w.eval(fs.readFileSync(path.join(SRC, "conteudo", "ecac-infojud.js"), "utf8"));
      return { w, msgs, faixas, mem, cortina };
    };
    const fila = () => ({ partes: PARTES.map((p) => Object.assign({}, p)), idx: 0, config: { pastaDownload: "CRATOS" } });
    {
      const { w, msgs, mem } = montar(async () => ({ em: "2026-10-23T13:30:00.000Z", semCpf: [], resultados: [
        { nome: "FULANO", cpf: CPF_A, situacao: "nenhuma", empresas: [], porUF: false, ufsExcedidas: [], ufsFalhas: [] },
        { nome: "BELTRANA", cpf: CPF_B, situacao: "falha", empresas: [], porUF: false, ufsExcedidas: [], ufsFalhas: [] }] }));
      await tick();
      const f = fila();
      await w.__cratosEcac.recuperarEmpresasDosExecutados(f);
      const c = msgs.find((m) => m.tipo === "fabricar_pdf");
      checar(c && c.convenio === "INFOJUD" && c.operacao === "consulta" && c.detalhe === "empresas" &&
        c.filename === "CRATOS/00000012320255180008_INFOJUD empresas vinculadas certidao.pdf" && /EMPRESAS EM QUE O EXECUTADO É RESPONSÁVEL/.test(c.titulo),
        "certidão consolidada: convênio INFOJUD (entra na juntada com as demais), nome no padrão CRATOS/");
      checar(mem["cratos:ecac_fila"] && mem["cratos:ecac_fila"].empresas === "feito" && f.empresas === "feito", "marca na fila: não repete nesta execução");
    }
    {
      /* cortina + resumo (Rodrigo, 23/10) */
      const { w, faixas, cortina } = montar(async (partes, aviso) => {
        aviso("lendo o endereço das empresas (1 de 3)…");
        return { em: "2026-10-23T13:30:00.000Z", semCpf: [], resultados: [
          { nome: "FULANO FICTICIO DA SILVA", cpf: CPF_A, situacao: "empresas", empresas: [{}, {}, {}], porUF: false, ufsExcedidas: [], ufsFalhas: [] },
          { nome: "BELTRANA EXEMPLO PEREIRA", cpf: CPF_B, situacao: "nenhuma", empresas: [], porUF: false, ufsExcedidas: [], ufsFalhas: [] }] };
      });
      await tick();
      await w.__cratosEcac.recuperarEmpresasDosExecutados(fila());
      checar(cortina[0] === "+Recuperar NI: pesquisando as empresas dos executados…" && cortina.includes("+Recuperar NI: lendo o endereço das empresas (1 de 3)…") &&
        cortina.includes("+Recuperar NI: gerando a certidão…") && cortina[cortina.length - 1] === "-",
        "cortina na tela durante a pesquisa e a certidão (cada etapa renova), e some ao terminar");
      const ult = faixas[faixas.length - 1];
      checar(/certidão gerada — F\.F\.D\.S\.: 3 empresas; B\.E\.P\.: nenhuma\. As solicitações seguem\./.test(ult) && !/FULANO|BELTRANA|\d{3}\.\d{3}/.test(ult),
        "resumo na faixa ao terminar, só com iniciais (sem nome nem CPF)");
    }
    {
      /* MODO SÓ RECUPERAR NI (a partir do menu) */
      const { w, msgs, faixas, mem, cortina } = montar(async () => ({ em: "2026-10-23T13:30:00.000Z", semCpf: [], resultados: [
        { nome: "FULANO", cpf: CPF_A, situacao: "nenhuma", empresas: [], porUF: false, ufsExcedidas: [], ufsFalhas: [] }] }));
      await tick();
      const cfgSo = { pastaDownload: "CRATOS", cpf: { dirpf: { ativo: false, anos: 2 }, recuperarEmpresas: { ativo: true } }, cnpj: { doi: { ativo: false } } };
      const T = w.__cratosEcac.temPedidos;
      if (!w.__cratosEcac.soRecuperarNi) w.__cratosEcac.soRecuperarNi = async () => {};
      checar(T && !T({ tipo: "CPF" }, cfgSo) && !T({ tipo: "CNPJ" }, cfgSo) && T({ tipo: "CNPJ" }, { cnpj: { doi: { ativo: true } } }) &&
        T({ tipo: "CPF" }, { cpf: { efin: { ativo: true } } }) && !T({ tipo: "CPF" }, {}),
        "temPedidos: só o Recuperar NI marcado = nenhum pedido (mesmas regras do gerarListaPedidos)");
      const f = { partes: [Object.assign({}, PARTES[0])], idx: 0, config: cfgSo, criadoEm: new Date().toISOString() };
      mem["cratos:ecac_fila"] = JSON.parse(JSON.stringify(f));
      await w.__cratosEcac.soRecuperarNi(f);
      const pulso = mem["cratos:orq_conv_feito"], reg = mem["cratos:infojud_registro:00000012320255180008"];
      checar(msgs.some((m) => m.tipo === "fabricar_pdf") && cortina[cortina.length - 1] === "-" &&
        pulso && pulso.convenio === "INFOJUD" && pulso.ok === true && /só Recuperar NI/.test(pulso.motivo) &&
        msgs.some((m) => m.tipo === "ecac_fechar_aba"),
        "só Recuperar NI: certidão, INFOJUD concluído na fila e aba fechada — sem abrir \"Registrar Solicitação\"");
      checar(reg && reg.registradas === 0 && reg.soRecuperar === true, "registro da execução: zero solicitações (o painel não vai à caixa postal)");
      checar(!faixas.some((t) => /As solicitações seguem/.test(t)), "só Recuperar NI: a faixa não promete solicitações");
    }
    {
      const { w, msgs, faixas } = montar(async () => ({ em: "2026-10-23T13:30:00.000Z", semCpf: [], resultados: [
        { nome: "FULANO", cpf: CPF_A, situacao: "falha", empresas: [], porUF: false, ufsExcedidas: [], ufsFalhas: [] }] }));
      await tick();
      await w.__cratosEcac.recuperarEmpresasDosExecutados(fila());
      checar(!msgs.some((m) => m.tipo === "fabricar_pdf") && faixas.some((t) => /não pôde ser concluída para 1 executado\(s\); nenhuma certidão foi gerada\. As solicitações seguem/.test(t)),
        "⛔ falhou para todos: NENHUMA certidão; a faixa avisa e as solicitações seguem");
    }
    {
      let chamou = false;
      const { w, msgs } = montar(async () => { chamou = true; return { resultados: [], semCpf: [] }; });
      await tick();
      const f = { partes: [PARTES[2]], idx: 0, config: {} };
      await w.__cratosEcac.recuperarEmpresasDosExecutados(f);
      checar(!chamou && !msgs.some((m) => m.tipo === "fabricar_pdf") && f.empresas === "feito", "só executado pessoa jurídica: nada a consultar, nada gerado");
    }
  }

  /* ── 5. menu, vigia, fundo e painel (fonte) ────────────────────────────── */
  {
    const ec = fs.readFileSync(path.join(SRC, "conteudo", "ecac-infojud.js"), "utf8");
    const menu = ec.slice(ec.indexOf("if (/Decjuiz\\/principal\\.asp/i.test(url))"), ec.indexOf("if (!url.includes(\"solicitacao.asp\"))"));
    checar(menu.indexOf("temPedidos(p, fila.config)") > 0 && menu.indexOf("await soRecuperarNi(fila)") > 0 &&
      menu.indexOf("await soRecuperarNi(fila)") < menu.indexOf("link.click()"),
      "menu: sem nenhum pedido marcado, roda o Recuperar NI dali e NÃO clica em \"Registrar Solicitação\"");
    const vigia = ec.slice(ec.indexOf("if (!url.includes(\"solicitacao.asp\"))"), ec.indexOf("// all_frames injeta no topo E no frame."));
    checar(menu.indexOf("await souAbaDoRegistro()") > 0 && vigia.indexOf("if (!(await souAbaDoRegistro())) return;") > 0 &&
      vigia.indexOf("if (!(await souAbaDoRegistro())) return;") < vigia.indexOf("location.assign(ECAC_ENTRADA_URL)") &&
      /filaAgora\.idx >= filaAgora\.partes\.length\) return;[\s\S]*CratosFaixa\.parar\("infojud",\s*"o eCAC não abriu/.test(vigia),
      "vigia do e-CAC: só age na aba aberta pelo CRATOS (não navega nem reclama na aba da caixa postal) e reconfere a fila antes de reclamar");
    const bg = fs.readFileSync(path.join(SRC, "background.js"), "utf8");
    checar(/await Store\.set\("ecac_aba", aba\.id\);/.test(bg) && /case "ecac_sou_registro":\s*return souAbaRegistroEcac\(sender\);/.test(bg) &&
      /return \{ sim: tabId != null && id != null && tabId === id \};/.test(bg),
      "fundo: guarda a aba do registro e responde \"é esta?\" pelo id da aba de quem pergunta");
    const pn = fs.readFileSync(path.join(SRC, "conteudo", "painel.js"), "utf8");
    const col = pn.slice(pn.indexOf("async function colheitaAoFimDaFila()"), pn.indexOf("async function colheitaAoFimDaFila()") + 6000);
    checar(/Store\.get\("infojud_registro:" \+ String\(numero\)\.replace/.test(col) && /reg\.registradas === 0 && Number\(reg\.em\) >= orquestraIniciadaEm/.test(col) &&
      col.indexOf("if (semPedido) {") > 0 && col.indexOf("if (semPedido) {") < col.indexOf('tipo: "coletar_achar"') && /orquestraIniciadaEm = Date\.now\(\);/.test(pn),
      "painel: sem solicitação registrada NESTA execução, não vai à caixa postal (e diz por quê)");
  }

  console.log(`\n=== ${NOME} ===`);
  oks.forEach((d) => console.log("  ok   " + d));
  falhas.forEach((d) => console.log("  FALHA " + d));
  console.log(`\n${oks.length} passaram, ${falhas.length} falharam (${oks.length + falhas.length} asserções)\n`);
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.log("FALHA geral: " + e.stack); process.exit(1); });
