/*
 * teste-certidao-partes.js — "em face de quem" na certidão principal (1.9.7). Dados FICTÍCIOS.
 *
 * Pedido do Rodrigo (18/11/2026): incluir na certidão principal dos convênios o nome e o
 * CPF/CNPJ de quem a diligência foi feita. Forma escolhida por ele:
 *   · todos os convênios com as MESMAS partes → uma vez, na abertura;
 *   · partes diferentes → em cada linha da relação.
 *
 * O que se trava aqui:
 *  1. montarCertidoes: as duas formas, nas famílias "realizados" e "cancelamento" (com o
 *     "nada a cancelar"); item sem partes (anterior à 1.9.7) sai como sempre saiu; CPF e
 *     CNPJ formatados; nome escapado; as demais famílias não mudam; título não muda.
 *  2. Diário: o despacho guarda quem foi mandado a cada convênio, com o corte do módulo
 *     (RENAJUD/CNIB: passivo; PREVJUD: só CPF; demais: quem tem documento); o arquivo
 *     registrado depois leva essas partes — só dentro da janela do despacho; partes
 *     informadas pelo próprio convênio (SNIPER) mandam.
 *  3. Fundo: orquestraExecutar registra o despacho antes de chamar o módulo; o
 *     fabricar_pdf repassa as partes ao diário.
 *
 * Reprova a 1.9.6. Rodar: node teste-certidao-partes.js
 * Versão antiga: CRATOS_SRC=<pasta do src> node teste-certidao-partes.js
 */
const fs = require("fs");
const path = require("path");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const NOME = "teste-certidao-partes";
const oks = [], falhas = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }

const bg = fs.readFileSync(path.join(SRC, "background.js"), "utf8");
const A = { nome: "FULANO FICTICIO DE TAL", doc: "12345678909" };
const B = { nome: "EMPRESA FICTICIA LTDA", doc: "11222333000181" };
const C = { nome: "BELTRANA <b>FICTICIA</b>", doc: "98765432100" };

(async () => {
  /* ── 1. a certidão ───────────────────────────────────────────────────────── */
  {
    const ini = bg.indexOf("const _P_CORPO");
    const iFn = bg.indexOf("function montarCertidoes(");
    const fim = bg.indexOf("\n}\n", iFn) + 3;
    const montar = new Function(bg.slice(ini, fim) + "\nreturn montarCertidoes;")();
    const txt = (itens) => montar({ itens }).map((c) => c.html.replace(/<\/p>/g, "\n").replace(/<[^>]+>/g, "")).join("\n---\n");

    const iguais = txt([
      { convenio: "RENAJUD", operacao: "inclusao", arquivo: "a.pdf", partes: [A, B] },
      { convenio: "CENSEC", operacao: "consulta", arquivo: "b.pdf", partes: [B, A] },
    ]);
    checar(/que foram realizados, em face de FULANO FICTICIO DE TAL \(CPF 123\.456\.789-09\) e EMPRESA FICTICIA LTDA \(CNPJ 11\.222\.333\/0001-81\), os seguintes convênios:\n1 - RENAJUD;\n2 - CENSEC\./.test(iguais),
      "⛔ mesmas partes em todos os convênios: \"em face de …\" uma vez, na abertura; a relação fica como sempre");

    const diferentes = txt([
      { convenio: "RENAJUD", operacao: "inclusao", arquivo: "a.pdf", partes: [A] },
      { convenio: "CENSEC", operacao: "consulta", arquivo: "b.pdf", partes: [A, B] },
      { convenio: "CENSEC", operacao: "consulta", arquivo: "c.pdf", partes: [B] },
    ]);
    checar(/que foram realizados os seguintes convênios:\n1 - RENAJUD, em face de FULANO FICTICIO DE TAL \(CPF 123\.456\.789-09\);\n2 - CENSEC, em face de FULANO FICTICIO DE TAL \(CPF 123\.456\.789-09\) e EMPRESA FICTICIA LTDA \(CNPJ 11\.222\.333\/0001-81\)\./.test(diferentes),
      "⛔ partes diferentes: cada linha leva as suas (união dos arquivos do convênio, sem repetir)");

    const tres = txt([{ convenio: "CCS", operacao: "consulta", arquivo: "a.pdf", partes: [A, B, C] }]);
    checar(/em face de FULANO FICTICIO DE TAL \(CPF 123\.456\.789-09\), EMPRESA FICTICIA LTDA \(CNPJ 11\.222\.333\/0001-81\) e BELTRANA &lt;b&gt;FICTICIA&lt;\/b&gt; \(CPF 987\.654\.321-00\)/.test(tres),
      "três partes: \"A, B e C\"; o nome vai escapado (nada de HTML vindo do PJe na minuta)");

    const legado = txt([{ convenio: "CENSEC", operacao: "consulta", arquivo: "e.pdf" }, { convenio: "SAB", operacao: "inclusao", arquivo: "f.pdf" }]);
    checar(/que foram realizados os seguintes convênios:\n1 - CENSEC;\n2 - SAB\./.test(legado) && !/em face/.test(legado),
      "item sem partes (de antes da 1.9.7): a certidão sai exatamente como antes");

    const misto = txt([
      { convenio: "RENAJUD", operacao: "inclusao", arquivo: "a.pdf", partes: [A] },
      { convenio: "SAB", operacao: "inclusao", arquivo: "b.pdf" },
    ]);
    checar(/que foram realizados os seguintes convênios:\n1 - RENAJUD, em face de FULANO FICTICIO DE TAL \(CPF 123\.456\.789-09\);\n2 - SAB\./.test(misto),
      "⛔ um convênio com partes e outro sem: por linha, e a linha sem partes não inventa ninguém");

    const baixa = txt([
      { convenio: "SAB", operacao: "baixa", arquivo: "a.pdf", partes: [B] },
      { convenio: "RENAJUD", operacao: "baixa", detalhe: "nada_a_cancelar", arquivo: "b.pdf", partes: [B] },
    ]);
    checar(/procedi ao cancelamento das restrições, em face de EMPRESA FICTICIA LTDA \(CNPJ 11\.222\.333\/0001-81\), nos seguintes convênios:\n1 - SAB\.\nCERTIFICO, ainda, que não foram localizadas restrições ativas a cancelar nos seguintes convênios:\n1 - RENAJUD\./.test(baixa),
      "⛔ cancelamento (com \"nada a cancelar\"), mesmas partes: na abertura, sem repetir no \"ainda\"");

    const soNada = txt([{ convenio: "CNIB", operacao: "baixa", detalhe: "nada_a_cancelar", arquivo: "a.pdf", partes: [A] }]);
    checar(/não foram localizadas restrições ativas a cancelar, em face de FULANO FICTICIO DE TAL \(CPF 123\.456\.789-09\), nos seguintes convênios:\n1 - CNIB\./.test(soNada),
      "cancelamento só com \"nada a cancelar\": as partes na frase própria");

    const baixaDif = txt([
      { convenio: "SAB", operacao: "baixa", arquivo: "a.pdf", partes: [B] },
      { convenio: "CNIB", operacao: "baixa", arquivo: "b.pdf", partes: [A] },
    ]);
    checar(/procedi ao cancelamento das restrições nos seguintes convênios:\n1 - SAB, em face de EMPRESA FICTICIA LTDA \(CNPJ 11\.222\.333\/0001-81\);\n2 - CNIB, em face de FULANO FICTICIO DE TAL \(CPF 123\.456\.789-09\)\./.test(baixaDif),
      "cancelamento com partes diferentes: por linha");

    const sab = montar({ itens: [{ convenio: "SAB", operacao: "respostas_sab", detalhe: "certidao", arquivo: "x.pdf", grupo: "1", rotuloGrupo: "determinação nº 1", partes: [A] }] });
    checar(sab.length === 1 && !/em face/.test(sab[0].html), "as demais famílias (respostas do SAB, indisponibilidade…) não mudam");
    const r = montar({ itens: [{ convenio: "RENAJUD", operacao: "inclusao", arquivo: "a.pdf", partes: [A] }] })[0] || {};
    checar(r.titulo === "Convênios realizados" && /^<p[^>]*>CERTIDÃO<\/p>/.test(r.html) && /Era o que me cumpria certificar\./.test(r.html),
      "título e moldura da certidão não mudam (a Situação da 2.0 a reconhece pelo título)");
  }

  /* ── 2. o diário ─────────────────────────────────────────────────────────── */
  {
    const ini = bg.indexOf("function _partesLimpas(");
    const iD = bg.indexOf("const Diario = {");
    const fim = bg.indexOf("\n};\n", iD) + 4;
    let D = null, despacho = null;
    if (ini >= 0 && iD > ini) {
      const mem = {};
      const Store = { get: async (k) => (mem[k] === undefined ? null : JSON.parse(JSON.stringify(mem[k]))), set: async (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); } };
      const r = new Function("Store", "_FAMILIAS", "console", bg.slice(ini, fim) + "\nreturn { Diario, partesDoDespacho };")(Store, [], { log() {}, warn() {} });
      D = r.Diario; despacho = r.partesDoDespacho; D._mem = mem;
    }
    const NUM = "0000001-23.2026.5.18.0008";
    const ps = [
      { nome: "AUTOR FICTICIO", cpfcnpj: "321.321.321-00", polo: "ativo" },
      { nome: A.nome, cpfcnpj: "123.456.789-09", polo: "passivo" },
      { nome: B.nome, cpfcnpj: "11222333000181", polo: "passivo" },
      { nome: "TERCEIRO FICTICIO", cpfcnpj: "45645645609", polo: "terceiro" },
      { nome: "SEM DOCUMENTO FICTICIO", cpfcnpj: "", polo: "passivo" },
      { nome: A.nome, cpfcnpj: "12345678909", polo: "passivo" },
    ];
    if (!D) {
      checar(false, "diário: guarda as partes de cada despacho");
      checar(false, "diário: o corte de partes de cada convênio");
      checar(false, "diário: arquivo registrado depois do despacho leva as partes");
      checar(false, "diário: fora da janela do despacho, arquivo sem partes");
      checar(false, "diário: partes informadas pelo convênio mandam");
    } else {
      const docs = (l) => l.map((p) => p.doc).join(",");
      checar(docs(despacho("RENAJUD", ps)) === "12345678909,11222333000181" && docs(despacho("CNIB", ps)) === "12345678909,11222333000181" &&
        docs(despacho("PREVJUD", ps)) === "32132132100,12345678909,45645645609" &&
        docs(despacho("CENSEC", ps)) === "32132132100,12345678909,11222333000181,45645645609",
        "⛔ diário: o corte de partes de cada convênio (RENAJUD/CNIB: passivo; PREVJUD: só CPF; demais: com documento; sem repetir; sem documento fica de fora)");
      await D.registrarDespacho(NUM, "RENAJUD", "inclusao", despacho("RENAJUD", ps));
      await D.registrar(NUM, { convenio: "RENAJUD", operacao: "inclusao", arquivo: "r1.pdf" });
      const di = D._mem["diario:00000012320265180008"];
      checar(di && di.despachos && di.despachos.RENAJUD && di.despachos.RENAJUD.partes.length === 2, "diário: guarda as partes de cada despacho");
      checar(di && di.itens[0] && docs(di.itens[0].partes || []) === "12345678909,11222333000181" && di.itens[0].partes[0].nome === A.nome,
        "⛔ diário: arquivo registrado depois do despacho leva as partes (nome e documento)");
      await D.registrar(NUM, { convenio: "CENSEC", operacao: "consulta", arquivo: "c1.pdf" });
      const d2 = D._mem["diario:00000012320265180008"];
      checar(!d2.itens[1].partes, "diário: convênio sem despacho registrado → arquivo sem partes (nada de palpite)");
      d2.despachos.RENAJUD.em = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
      D._mem["diario:00000012320265180008"] = d2;
      await D.registrar(NUM, { convenio: "RENAJUD", operacao: "inclusao", arquivo: "r2.pdf" });
      checar(!D._mem["diario:00000012320265180008"].itens[2].partes, "⛔ diário: fora da janela do despacho (6 h), arquivo sem partes");
      await D.registrar(NUM, { convenio: "SNIPER", operacao: "consulta", arquivo: "s.pdf", partes: [{ nome: B.nome, doc: "11.222.333/0001-81" }, { nome: "<x>", doc: "1" }] });
      const it = D._mem["diario:00000012320265180008"].itens[3];
      checar(it.partes && it.partes.length === 2 && it.partes[0].doc === "11222333000181" && it.partes[1].doc === "",
        "diário: partes informadas pelo convênio (SNIPER: quem ele de fato investigou) mandam; documento inválido não vai");
    }
  }

  /* ── 3. o fundo ──────────────────────────────────────────────────────────── */
  {
    const orq = bg.slice(bg.indexOf("async function orquestraExecutar("), bg.indexOf("switch (convenioId)", bg.indexOf("async function orquestraExecutar(")));
    checar(/Diario\.registrarDespacho\(ctx\.numeroProcesso, convenioId, operacao, partesDoDespacho\(convenioId, ctx\.partes\)\)/.test(orq) && /catch/.test(orq),
      "fundo: cada despacho de convênio registra as partes ANTES de chamar o módulo (e uma falha ali não impede o convênio)");
    const fab = bg.slice(bg.indexOf('msg.tipo === "fabricar_pdf"'), bg.indexOf("function paginasExtras("));
    checar(/partes: msg\.partes/.test(fab), "fundo: o fabricar_pdf repassa ao diário as partes que o convênio informar");
  }

  console.log(`\n=== ${NOME} ===`);
  oks.forEach((d) => console.log("  ok   " + d));
  falhas.forEach((d) => console.log("  FALHA " + d));
  console.log(`\n${oks.length} passaram, ${falhas.length} falharam (${oks.length + falhas.length} asserções)\n`);
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.log("FALHA geral: " + e.stack); process.exit(1); });
