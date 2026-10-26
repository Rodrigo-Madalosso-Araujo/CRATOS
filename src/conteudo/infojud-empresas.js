/*
 * conteudo/infojud-empresas.js — INFOJUD: empresas em que o executado é o RESPONSÁVEL
 * ("Recuperar NI – CNPJ", recuperaNICNPJs.asp). Pedido do Rodrigo, 23/10 (1.9.0).
 *
 * Para cada executado PESSOA FÍSICA com CPF, faz as MESMAS chamadas que a tela faz,
 * com a sessão da própria página (HAR de 23/10), sem preencher nada nem mudar de tela:
 *   POST listaNICNPJ.asp   cnpj=&nomeEmpresarial=&nomeFantasia=&cpfResponsavel=<CPF com máscara>
 *                          &uf=&codMunSelecionado=&municipio=
 *   GET  detalheNICNPJ.asp?NI=<CNPJ>   (endereço completo de cada empresa)
 * Respostas (td.erro na table.Tabela):
 *   "Nenhum registro encontrado."                     → nenhuma empresa
 *   "Foram encontrados mais de 50 registros. ..."     → refaz por UF (as 27), decisão do
 *                                                        Rodrigo; UF que ainda passar de 50
 *                                                        é certificada como tal
 *   tabela com linhas (CNPJ, nome, fantasia, CPF resp., UF, município, detalhe) → empresas
 *   qualquer outra coisa (sessão caída, erro, tela nova) → FALHA TÉCNICA: nunca vira
 *   "não foram localizadas" (regra de ferro).
 * Não há paginação (24 empresas vieram numa página só, teste do Rodrigo de 23/10).
 *
 * ⚠ CORREÇÃO DO TESTE AO VIVO (23/10, 1.9.0): as MENSAGENS não vêm na resposta do POST.
 * O listaNICNPJ.asp responde 302 → `erro.asp?erro=Nenhum%20registro%20encontrado.` (ou
 * "Foram encontrados mais de 50…"), e a erro.asp escreve a frase com um script da própria página — a
 * célula td.erro chega VAZIA para quem lê sem rodar script. A frase é lida do ENDEREÇO
 * final (parâmetro `erro`); td.erro preenchida fica como reserva.
 * E com UMA empresa só, a Receita já abre o DETALHE dela (aviso do Rodrigo): a resposta é
 * a página de detalhe (rótulo: valor), que já traz o endereço.
 * Não monta HTML na página. Não guarda nada. Saída: o resultado, para a certidão.
 */
(function () {
  "use strict";
  if (globalThis.CratosEmpresasInfojud) return;

  const BASE = "https://cav.receita.fazenda.gov.br/Servicos/ATSDR/Decjuiz/";
  const UFS = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE",
    "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"];
  const RX_CNPJ = /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/;

  const io = {
    fetch: (u, o) => fetch(u, o),
    esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
    agora: () => Date.now(),
  };
  const PAUSA_MS = 250;   // gentileza com o servidor entre chamadas

  const digitos = (s) => String(s == null ? "" : s).replace(/\D/g, "");
  const formatarCpf = (s) => { const d = digitos(s); return d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") : d; };
  const limpo = (s) => String(s == null ? "" : s).replace(/ /g, " ").replace(/\s+/g, " ").trim();

  async function texto(resp) {
    const buf = await resp.arrayBuffer();
    try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch (e) { return new TextDecoder("windows-1252").decode(buf); }
  }
  function doc(html) { return new DOMParser().parseFromString(html, "text/html"); }

  const RX_NENHUM = /nenhum\s+registro\s+encontrado/i;
  const RX_EXCESSO = /mais\s+de\s+50\s+registros/i;

  /* Classifica uma frase de erro do INFOJUD. */
  function porMensagem(msg) {
    if (RX_NENHUM.test(msg)) return { tipo: "nenhuma", empresas: [], mensagem: msg };
    if (RX_EXCESSO.test(msg)) return { tipo: "excesso", empresas: [], mensagem: msg };
    return null;
  }
  /* A frase que veio no endereço (erro.asp?erro=…). */
  function mensagemDoEndereco(url) {
    try { return limpo(String(new URL(url).searchParams.get("erro") || "").replace(/<br\s*\/?>/gi, " ")); } catch (e) { return ""; }
  }
  /* O texto da primeira td.erro PREENCHIDA (há páginas com td.erro vazia). */
  function mensagemDaPagina(d) {
    for (const td of d.querySelectorAll("td.erro")) { const t = limpo(td.textContent); if (t) return t; }
    return "";
  }

  /* Rótulo: valor da página de detalhe. */
  function camposDetalhe(d) {
    const campos = {};
    for (const tr of d.querySelectorAll("tr")) {
      const tds = Array.from(tr.querySelectorAll("td"));
      if (tds.length < 2) continue;
      const rot = limpo(tds[0].textContent);
      if (/:$/.test(rot)) campos[rot.replace(/:$/, "").toLowerCase()] = limpo(tds[1].textContent);
    }
    return campos;
  }
  function enderecoDe(campos) {
    return {
      logradouro: campos.logradouro || "", complemento: campos.complemento || "", bairro: campos.bairro || "",
      municipio: campos["município"] || campos.municipio || "", uf: campos.uf || "", cep: campos.cep || "",
      nomeEmpresarial: campos["nome empresarial completo"] || "", nomeFantasia: campos["nome fantasia completo"] || "",
    };
  }

  /* Lê a RESPOSTA do POST, onde quer que ela tenha parado (url = endereço final).
     → {tipo: "empresas"|"nenhuma"|"excesso"|"falha", empresas, mensagem} */
  function lerResposta(html, url) {
    const u = String(url || "");
    const d = doc(html);
    if (/erro\.asp/i.test(u)) {
      const msg = mensagemDoEndereco(u) || mensagemDaPagina(d);
      return porMensagem(msg) || { tipo: "falha", empresas: [], mensagem: msg ? "o INFOJUD respondeu: " + msg : "o INFOJUD devolveu a página de erro sem mensagem" };
    }
    /* Uma empresa só: a Receita abre o detalhe direto. */
    const campos = camposDetalhe(d);
    if (/detalheNICNPJ\.asp/i.test(u) || (RX_CNPJ.test(campos.cnpj || "") && ("logradouro" in campos || "cpf do responsável" in campos))) {
      if (!RX_CNPJ.test(campos.cnpj || "")) return { tipo: "falha", empresas: [], mensagem: "o detalhe da empresa não veio como esperado" };
      const end = enderecoDe(campos);
      return { tipo: "empresas", unica: true, mensagem: "", empresas: [{
        cnpj: campos.cnpj, nomeEmpresarial: end.nomeEmpresarial, nomeFantasia: end.nomeFantasia,
        cpfResponsavel: campos["cpf do responsável"] || campos["cpf do responsavel"] || "",
        uf: end.uf, municipio: end.municipio, detalhe: u || null, endereco: end }] };
    }
    return lerLista(html);
  }

  /* Lê a página da lista. → {tipo: "empresas"|"nenhuma"|"excesso"|"falha", empresas, mensagem} */
  function lerLista(html) {
    const d = doc(html);
    const tab = d.querySelector("table.Tabela");
    const msg = mensagemDaPagina(d);
    const erro = !!msg;
    const classificada = erro && porMensagem(msg);
    if (classificada) return classificada;
    if (!tab) return { tipo: "falha", empresas: [], mensagem: msg || "a página do INFOJUD não veio como esperado" };
    const empresas = [];
    for (const tr of tab.querySelectorAll("tr")) {
      const tds = Array.from(tr.querySelectorAll("td"));
      if (tds.length < 7) continue;
      const cnpj = limpo(tds[1].textContent);
      if (!RX_CNPJ.test(cnpj)) continue;
      const a = tr.querySelector('a[href*="detalheNICNPJ"]');
      empresas.push({
        cnpj, nomeEmpresarial: limpo(tds[2].textContent), nomeFantasia: limpo(tds[3].textContent),
        cpfResponsavel: limpo(tds[4].textContent), uf: limpo(tds[5].textContent), municipio: limpo(tds[6].textContent),
        detalhe: a ? a.getAttribute("href") : null,
      });
    }
    if (empresas.length) return { tipo: "empresas", empresas, mensagem: "" };
    if (erro) return { tipo: "falha", empresas: [], mensagem: msg };
    return { tipo: "falha", empresas: [], mensagem: "a lista do INFOJUD não veio como esperado" };
  }

  /* Lê o detalhe (rótulo: valor). Confere que é da empresa pedida. */
  function lerDetalhe(html, cnpj) {
    const campos = camposDetalhe(doc(html));
    if (digitos(campos.cnpj) !== digitos(cnpj)) return null;
    return enderecoDe(campos);
  }

  /* Motivo da falha no console — só ESTRUTURA (código, página, frase da Receita), com
     qualquer sequência de dígitos cortada: nada de CPF/CNPJ no log. */
  function registrarFalha(onde, info) {
    try {
      const corta = (t) => String(t == null ? "" : t).replace(/\d[\d.\-\/]{4,}\d/g, "…");
      console.warn("CRATOS/INFOJUD empresas: falha em " + onde + " —",
        "HTTP " + (info.status == null ? "?" : info.status), "| página:", corta(info.pagina || "?"), "|", corta(info.mensagem || ""));
    } catch (e) { /* nada */ }
  }

  async function pesquisar(cpf, uf) {
    const corpo = new URLSearchParams({ cnpj: "", nomeEmpresarial: "", nomeFantasia: "", cpfResponsavel: formatarCpf(cpf),
      uf: uf || "", codMunSelecionado: "", municipio: "" });
    try {
      const r = await io.fetch(BASE + "listaNICNPJ.asp", { method: "POST", credentials: "include",
        headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: corpo.toString() });
      const final = String(r.url || "");
      let pagina = "?";
      try { pagina = new URL(final).pathname.split("/").pop() || "?"; } catch (e) { /* fica ? */ }
      if (!r.ok) {
        const f = { tipo: "falha", empresas: [], mensagem: `HTTP ${r.status}` };
        registrarFalha("pesquisa" + (uf ? " (" + uf + ")" : ""), { status: r.status, pagina, mensagem: f.mensagem });
        return f;
      }
      const res = lerResposta(await texto(r), final);
      if (res.tipo === "falha") registrarFalha("pesquisa" + (uf ? " (" + uf + ")" : ""), { status: r.status, pagina, mensagem: res.mensagem });
      return res;
    } catch (e) {
      registrarFalha("pesquisa" + (uf ? " (" + uf + ")" : ""), { status: null, pagina: "-", mensagem: "sem resposta (" + (e && e.name || "erro") + ")" });
      return { tipo: "falha", empresas: [], mensagem: "sem resposta do INFOJUD" };
    }
  }

  async function detalhar(emp) {
    const href = emp.detalhe || ("detalheNICNPJ.asp?NI=" + digitos(emp.cnpj));
    try {
      const r = await io.fetch(new URL(href, BASE).href, { credentials: "include" });
      if (!r.ok) return null;
      return lerDetalhe(await texto(r), emp.cnpj);
    } catch (e) { return null; }
  }

  /* Um executado. → {nome, cpf, situacao: "empresas"|"nenhuma"|"falha", empresas, porUF, ufsExcedidas, ufsFalhas, mensagem} */
  async function recuperarUm(parte, aviso) {
    const cpf = digitos(parte.ni || parte.cpf);
    const r = { nome: parte.nome || parte.nomeAbrev || "", cpf, situacao: "falha", empresas: [], porUF: false,
      ufsExcedidas: [], ufsFalhas: [], mensagem: "" };
    let res = await pesquisar(cpf, "");
    if (res.tipo === "falha") { await io.esperar(1500); res = await pesquisar(cpf, ""); }   // uma segunda chance
    if (res.tipo === "falha") { r.mensagem = res.mensagem; return r; }
    if (res.tipo === "nenhuma") { r.situacao = "nenhuma"; r.mensagem = res.mensagem; return r; }
    let lista = res.empresas;
    if (res.tipo === "excesso") {
      r.porUF = true;
      lista = [];
      for (let i = 0; i < UFS.length; i++) {
        const uf = UFS[i];
        if (aviso) aviso(`mais de 50 empresas — consultando por UF (${uf}, ${i + 1} de 27)…`);
        await io.esperar(PAUSA_MS);
        let ru = await pesquisar(cpf, uf);
        if (ru.tipo === "falha") { await io.esperar(1500); ru = await pesquisar(cpf, uf); }
        if (ru.tipo === "empresas") lista.push(...ru.empresas);
        else if (ru.tipo === "excesso") r.ufsExcedidas.push(uf);
        else if (ru.tipo === "falha") r.ufsFalhas.push(uf);
      }
    }
    const vistos = new Set();
    lista = lista.filter((e) => { const k = digitos(e.cnpj); if (vistos.has(k)) return false; vistos.add(k); return true; });
    for (let i = 0; i < lista.length; i++) {
      if (lista[i].endereco) continue;   // uma empresa só: o detalhe já veio na resposta
      if (aviso) aviso(`lendo o endereço das empresas (${i + 1} de ${lista.length})…`);
      await io.esperar(PAUSA_MS);
      lista[i].endereco = await detalhar(lista[i]);
    }
    r.empresas = lista;
    if (lista.length) r.situacao = "empresas";
    else if (r.porUF && !r.ufsExcedidas.length && !r.ufsFalhas.length) r.situacao = "nenhuma";
    else if (r.porUF && r.ufsExcedidas.length && !r.ufsFalhas.length) r.situacao = "empresas";   // só UFs com mais de 50
    else r.mensagem = r.mensagem || "a consulta por UF não pôde ser concluída";
    return r;
  }

  async function recuperar(partes, aviso) {
    const pf = (partes || []).filter((p) => p && p.tipo === "CPF" && digitos(p.ni).length === 11);
    const vistos = new Set();
    const resultados = [];
    for (const p of pf) {
      const d = digitos(p.ni);
      if (vistos.has(d)) continue;
      vistos.add(d);
      resultados.push(await recuperarUm(p, aviso));
    }
    const semCpf = (partes || []).filter((p) => p && p.tipo !== "CPF").map((p) => p.nome || p.nomeAbrev || "");
    return { resultados, semCpf, em: new Date(io.agora()).toISOString() };
  }

  /* Certidão consolidada — relato do que o INFOJUD exibiu, sem conclusão. */
  function linhasCertidao(res, ctx) {
    const p2 = (n) => String(n).padStart(2, "0");
    const d = new Date(res.em);
    const L = ["",
      `Certifico e dou fé que, nesta data (${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}, às ${p2(d.getHours())}:${p2(d.getMinutes())}), ` +
      "consultei no INFOJUD (Receita Federal), na funcionalidade \"Recuperar NI – CNPJ\", as empresas em que consta como " +
      `responsável cada executado abaixo, no processo nº ${ctx.numProcesso}, com o resultado a seguir.`];
    res.resultados.forEach((r, i) => {
      L.push("", `${i + 1}) ${r.nome ? r.nome + " - " : ""}CPF ${formatarCpf(r.cpf)}`);
      if (r.situacao === "falha") {
        L.push("   A consulta não pôde ser concluída (o sistema não respondeu como esperado) e deve ser repetida.");
        return;
      }
      if (r.situacao === "nenhuma") {
        L.push("   Não foram localizadas empresas com este CPF como responsável (o INFOJUD informou: \"Nenhum registro encontrado.\")" +
          (r.porUF ? ", consultadas todas as UFs." : "."));
        return;
      }
      if (r.empresas.length) {
        L.push(`   Foram localizadas ${r.empresas.length} empresa(s) com este CPF como responsável` +
          (r.porUF ? " (a consulta sem filtro retornou mais de 50 registros e foi refeita por UF)" : "") + ":");
      }
      r.empresas.forEach((e, j) => {
        const en = e.endereco;
        L.push(`   ${j + 1}. CNPJ ${e.cnpj} — ${(en && en.nomeEmpresarial) || e.nomeEmpresarial}`);
        const fant = (en && en.nomeFantasia) || e.nomeFantasia;
        if (fant) L.push(`      Nome fantasia: ${fant}`);
        if (e.cpfResponsavel) L.push(`      CPF do responsável: ${e.cpfResponsavel}`);
        if (en) {
          const partes = [en.logradouro, en.complemento, en.bairro].filter(Boolean).join(", ");
          const lugar = [en.municipio || e.municipio, en.uf || e.uf].filter(Boolean).join("/");
          L.push(`      Endereço: ${[partes, lugar].filter(Boolean).join(", ")}${en.cep ? ", CEP " + en.cep : ""}`);
        } else {
          L.push(`      Município/UF: ${[e.municipio, e.uf].filter(Boolean).join("/") || "não informado"}. Endereço não obtido nesta consulta.`);
        }
      });
      if (r.ufsExcedidas.length) {
        L.push(`   Na(s) UF(s) ${r.ufsExcedidas.join(", ")}, a consulta ainda retornou mais de 50 registros, e o INFOJUD não exibe a lista sem filtro adicional.`);
      }
      if (r.ufsFalhas.length) {
        L.push(`   Na(s) UF(s) ${r.ufsFalhas.join(", ")}, a consulta não pôde ser concluída (o sistema não respondeu como esperado).`);
      }
    });
    if ((res.semCpf || []).length) {
      L.push("", "Partes não consultadas nesta funcionalidade, por não serem pessoa física: " + res.semCpf.join("; ") + ".");
    }
    L.push("", "Os dados acima são os exibidos pelo INFOJUD, transcritos sem tratamento.");
    L.push("", "A consulta foi feita pelo CRATOS, a pedido do(a) responsável por este ato.");
    L.push("", "Era o que me cumpria certificar.");
    return L;
  }

  globalThis.CratosEmpresasInfojud = { io, UFS, lerResposta, lerLista, lerDetalhe, recuperar, recuperarUm, linhasCertidao, formatarCpf };
})();
