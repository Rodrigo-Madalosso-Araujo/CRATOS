/*
 * teste-situacao.js — 2.0: "Situação do processo" (plano aprovado pelo Rodrigo em 16/11/2026).
 *
 * Uma linha por convênio em uso, montada na hora a partir de: pendência de configuração,
 * aba atual (pronto para juntar / falha), SAB ao vivo e eventos (histórico sem dado de
 * parte + linha do tempo do PJe). Regras vigiadas aqui:
 *  - falha técnica = "não obtido", nunca negativa;
 *  - sem registro = "sem registro do CRATOS", nunca "nada pedido";
 *  - INFOJUD/CCS/PREVJUD: pedido sem resposta posterior = "aguardando";
 *  - a fala do leitor de tela nunca leva CPF, CNPJ ou valores.
 * Dados fictícios.
 *
 * Rodar: node teste-situacao.js   (CRATOS_SRC=<src antigo> para ver reprovar)
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const falhas = [];
const oks = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }
function fim() {
  console.log("\n=== teste-situacao.js ===");
  oks.forEach((d) => console.log("  ok   " + d));
  falhas.forEach((d) => console.log("  FALHA " + d));
  console.log(`\n${oks.length} passaram, ${falhas.length} falharam (${oks.length + falhas.length} asserções)\n`);
  process.exit(falhas.length ? 1 : 0);
}
const ARQ = path.join(SRC, "comum", "situacao.js");
if (!fs.existsSync(ARQ)) { checar(false, "comum/situacao.js não existe nesta versão (Situação do processo)"); fim(); }

const ctx = { console, Date };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(ARQ, "utf8"), ctx);
const S = ctx.CratosSituacao;
const T = (d) => `2026-11-${String(d).padStart(2, "0")}T14:00:00`;
const linha = (r, id) => r.find((l) => l.id === id);

/* 1. Sem nada: "sem registro do CRATOS", nunca "nada pedido". */
{
  const r = S.montar({ convenios: ["SAB", "RENAJUD", "CNIB"] });
  checar(r.length === 3 && r.map((l) => l.id).join() === "SAB,RENAJUD,CNIB", "1 linha por convênio em uso, na ordem dada");
  checar(r.every((l) => l.estado === "semregistro"), "sem nenhuma fonte: todos 'sem registro'");
  checar(r.every((l) => l.rotulo === "sem registro do CRATOS"), "o selo diz 'sem registro do CRATOS'");
  checar(!JSON.stringify(r).match(/nada pedido/i), "nunca afirma 'nada pedido'");
}

/* 2. Prioridades: pendência > pronto > falha > eventos. */
{
  const f = {
    convenios: ["INFOJUD", "RENAJUD", "CCS"],
    pendencias: { INFOJUD: "Falta escolher a vara do e-CAC" },
    sessao: { prontos: { RENAJUD: 2, INFOJUD: 1 }, falhas: { CCS: "O Banco Central não gerou a resposta agora", RENAJUD: "x" } },
    eventos: [{ convenio: "RENAJUD", fase: "inclusao", em: T(10) }],
  };
  const r = S.montar(f);
  checar(linha(r, "INFOJUD").estado === "pendente", "pendência de configuração vem antes de tudo");
  checar(linha(r, "RENAJUD").estado === "pronto" && linha(r, "RENAJUD").n === 2, "pronto para juntar vem antes de falha e de eventos (com a contagem)");
  checar(/2 documentos/.test(linha(r, "RENAJUD").detalhe), "detalhe conta os documentos prontos");
  checar(linha(r, "CCS").estado === "naoobtido" && linha(r, "CCS").rotulo === "não obtido", "falha técnica da aba = 'não obtido'");
  checar(!/negativ|nada consta|nao localiz/i.test(S.falaDe(linha(r, "CCS"))), "'não obtido' nunca soa como resposta negativa");
}

/* 3. Pedido e resposta (convênios diferidos). */
{
  const base = { convenios: ["CCS", "INFOJUD", "PREVJUD"] };
  let r = S.montar(Object.assign({}, base, { eventos: [{ convenio: "CCS", fase: "pedido", em: T(10) }] }));
  checar(linha(r, "CCS").estado === "aguardando" && /Pedido em 10\/11/.test(linha(r, "CCS").detalhe), "CCS: pedido sem resposta = aguardando, com a data do pedido");
  r = S.montar(Object.assign({}, base, { eventos: [{ convenio: "CCS", fase: "pedido", em: T(10) }, { convenio: "CCS", fase: "resposta", em: T(12) }] }));
  checar(linha(r, "CCS").estado === "juntado" && /12\/11/.test(linha(r, "CCS").detalhe), "CCS: resposta depois do pedido = juntado, com a data da resposta");
  r = S.montar(Object.assign({}, base, { eventos: [{ convenio: "CCS", fase: "resposta", em: T(5) }, { convenio: "CCS", fase: "pedido", em: T(12) }] }));
  checar(linha(r, "CCS").estado === "aguardando", "CCS: pedido NOVO depois de resposta antiga = aguardando de novo");
  r = S.montar(Object.assign({}, base, { eventos: [{ convenio: "PREVJUD", fase: "pedido", em: T(3) }, { convenio: "PREVJUD", fase: "resposta", em: T(4) }] }));
  checar(linha(r, "PREVJUD").estado === "juntado", "PREVJUD: pedido + resposta = juntado");
  checar(linha(r, "INFOJUD").estado === "semregistro", "INFOJUD sem evento continua sem registro (não herda de outro convênio)");
}

/* 4. Atos e consultas. */
{
  const r = S.montar({
    convenios: ["RENAJUD", "CNIB", "CENSEC", "SNIPER", "SERASAJUD"],
    eventos: [
      { convenio: "RENAJUD", fase: "inclusao", em: T(2) }, { convenio: "RENAJUD", fase: "baixa", em: T(9) },
      { convenio: "CNIB", fase: "inclusao", em: T(7) },
      { convenio: "CENSEC", fase: "consulta", em: T(8) },
      { convenio: "SNIPER", fase: "indisponivel", em: T(11) },
      { convenio: "serasajud", fase: "inclusao", em: T(1) },
    ],
  });
  checar(linha(r, "RENAJUD").estado === "baixado" && /09\/11/.test(linha(r, "RENAJUD").detalhe), "o evento MAIS RECENTE decide: inclusão e depois baixa = baixado");
  checar(linha(r, "CNIB").estado === "incluido", "inclusão = incluído");
  checar(linha(r, "CENSEC").estado === "consultado", "consulta imediata = consultado");
  checar(linha(r, "SNIPER").estado === "indisponivel" && /certificado/.test(linha(r, "SNIPER").detalhe), "indisponibilidade aparece como tal, com a menção ao certificado");
  checar(linha(r, "SERASAJUD").estado === "incluido" && linha(r, "SERASAJUD").nome === "SerasaJUD", "nome do convênio em qualquer caixa casa e sai com o nome de exibição");
}

/* 5. SAB ao vivo. */
{
  let r = S.montar({ convenios: ["SAB"], sab: { paraJuntar: 2, aguardando: 1 }, eventos: [{ convenio: "SAB", fase: "resposta", em: T(1) }] });
  checar(linha(r, "SAB").estado === "pronto" && linha(r, "SAB").n === 2, "SAB: transferência respondida e não juntada = para juntar (mesmo com resposta antiga nos autos)");
  r = S.montar({ convenios: ["SAB"], sab: { paraJuntar: 0, aguardando: 3 } });
  checar(linha(r, "SAB").estado === "aguardando" && /3 ordens/.test(linha(r, "SAB").detalhe), "SAB: só ordens sem resposta = aguardando o banco");
  r = S.montar({ convenios: ["SAB"], sab: null, eventos: [{ convenio: "SISBAJUD", fase: "resposta", em: T(12) }] });
  checar(linha(r, "SAB").estado === "juntado", "SAB sem consulta ao vivo cai nos eventos; SISBAJUD conta como SAB");
}

/* 6. Linha do tempo do PJe → eventos (anexos do CRATOS). */
{
  const tl = [
    { titulo: "Convênios realizados", tipo: "Certidão", data: T(10), anexos: [
      { titulo: "00000000000000000000_EMPRESA EXEMPLO_00000000000100 RENAJUD inclusao", data: T(10) },
      { titulo: "00000000000000000000_EMPRESA EXEMPLO CCS envio", data: T(10) },
      { titulo: "00000000000000000000_SOCIO EXEMPLO PREVJUD certidao", data: T(10) },
      { titulo: "documento qualquer sem convenio", data: T(10) },
    ] },
    { titulo: "Cancelamento das restrições", tipo: "Certidão", data: T(12), anexos: [
      { titulo: "00000000000000000000_EMPRESA EXEMPLO CNIB Baixa", data: T(12) },
    ] },
    { titulo: "Convênios realizados", tipo: "Certidão", data: T(13), anexos: [
      { titulo: "00000000000000000000_EMPRESA EXEMPLO CCS detalhamento 13-11-2026", data: T(13) },
      { titulo: "00000000000000000000_SOCIO EXEMPLO PREVJUD coleta certidao", data: T(13), ativo: false },
    ] },
    { titulo: "Sistemas indisponíveis", tipo: "Certidão", data: T(14), anexos: [{ titulo: "00000000000000000000 SNIPER indisponibilidade", data: T(14) }] },
    { titulo: "Sisbajud (transferência)", tipo: "Sisbajud (transferência)", data: T(15), anexos: [] },
    { titulo: "Certidão antiga", ativo: false, data: T(1), anexos: [{ titulo: "x RENAJUD", data: T(1) }] },
  ];
  const ev = S.eventosDosAutos(tl);
  const de = (c) => ev.filter((e) => e.convenio === c);
  checar(de("RENAJUD").length === 1 && de("RENAJUD")[0].fase === "inclusao", "anexo em 'Convênios realizados' = inclusão; documento inativo é ignorado");
  checar(de("CNIB").length === 1 && de("CNIB")[0].fase === "baixa", "anexo em 'Cancelamento das restrições' = baixa");
  checar(de("CCS").map((e) => e.fase).join() === "pedido,resposta", "CCS: 'envio' = pedido, 'detalhamento' = resposta");
  checar(de("PREVJUD").length === 1 && de("PREVJUD")[0].fase === "pedido", "PREVJUD: anexo inativo ignorado; 'certidao' sem 'coleta' = pedido");
  checar(de("SNIPER").length === 1 && de("SNIPER")[0].fase === "indisponivel", "'Sistemas indisponíveis' = indisponível");
  checar(de("SAB").length === 1 && de("SAB")[0].fase === "resposta", "documento 'Sisbajud (transferência)' = resposta do SAB");
  checar(ev.length === 7, "anexo sem nome de convênio não vira evento");
  const r = S.montar({ convenios: ["RENAJUD", "CNIB", "CCS", "PREVJUD"], eventos: ev });
  checar(linha(r, "CCS").estado === "juntado" && linha(r, "PREVJUD").estado === "aguardando", "dos autos à linha: CCS juntado, PREVJUD aguardando");
}

/* 7. Fala do leitor de tela: sem CPF, CNPJ ou valores. */
{
  const r = S.montar({
    convenios: ["SAB", "CCS", "RENAJUD"],
    sab: { paraJuntar: 2 },
    sessao: { falhas: { CCS: "O Banco Central não gerou a resposta agora" } },
    eventos: [{ convenio: "RENAJUD", fase: "inclusao", em: T(10) }],
  });
  const falas = r.map(S.falaDe);
  checar(falas[0] === "SAB (SISBAJUD): 2 para juntar. 2 transferências respondidas, ainda não juntadas.", "fala do SAB: nome, situação com número, detalhe");
  checar(falas.every((t) => !/\d{3}\.\d{3}\.\d{3}-\d{2}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|R\$|\d{11,}/.test(t)), "nenhuma fala leva CPF, CNPJ, valor ou número longo");
  checar(falas.every((t) => /^[^:]+: [^.]+\. .+\.$/.test(t)), "toda fala segue 'Convênio: situação. Detalhe.'");
}

/* 8. Datas: dd/mm no fuso local; data inválida não quebra. */
{
  checar(S.dm("2026-11-05T10:00:00") === "05/11", "dd/mm com zero à esquerda");
  checar(S.dm("lixo") === "", "data inválida vira vazio, sem exceção");
  const r = S.montar({ convenios: ["CNIB"], eventos: [{ convenio: "CNIB", fase: "inclusao", em: "lixo" }] });
  checar(linha(r, "CNIB").estado === "semregistro", "evento com data inválida é descartado (não inventa data)");
}

fim();
