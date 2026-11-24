/*
 * comum/periodo.js — o PERÍODO das consultas do CENSEC (CEP) e da CANP (1.9.8).
 *
 * Pedido do Rodrigo (23/11/2026): delimitar a consulta por datas. Opções prontas de
 * 10, 5, 3, 2 e 1 ano (contadas até ONTEM, desde a 1.9.9) e o PERSONALIZADO, com início e fim. O padrão
 * fica SÓ nas Preferências do CENSEC.
 *
 * Por que importa além do conforto: a CEP mostra NO MÁXIMO 300 atos por busca ("Mostrando
 * os primeiros 300 registros. Favor refine sua busca"). O período é o que permite refinar
 * — dividir ao meio e buscar cada metade (ver `dividir`).
 *
 * Datas sempre como texto "AAAA-MM-DD", sem fuso: são datas de calendário, não instantes.
 * Puro, sem DOM: roda no painel, no content script do CENSEC e do Signo, e no Node (teste).
 */
(function () {
  if (globalThis.CratosPeriodo) return;

  const OPCOES = [
    { valor: "10a", anos: 10, rotulo: "Últimos 10 anos" },
    { valor: "5a", anos: 5, rotulo: "Últimos 5 anos" },
    { valor: "3a", anos: 3, rotulo: "Últimos 3 anos" },
    { valor: "2a", anos: 2, rotulo: "Últimos 2 anos" },
    { valor: "1a", anos: 1, rotulo: "Último ano" },
  ];
  const PADRAO = "10a";

  const doisDig = (n) => String(n).padStart(2, "0");
  const ymdDe = (d) => `${d.getFullYear()}-${doisDig(d.getMonth() + 1)}-${doisDig(d.getDate())}`;

  /* "AAAA-MM-DD" válido (data que existe no calendário) → Date ao meio-dia local, ou null */
  function paraData(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ""));
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
    return ymdDe(d) === ymd ? d : null;
  }
  const dmy = (ymd) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || "")); return m ? `${m[3]}/${m[2]}/${m[1]}` : ""; };
  const hojeYmd = (agora) => ymdDe((agora && typeof agora.getTime === "function") ? agora : new Date());

  /* 1.9.9 — o CENSEC NÃO aceita a data final igual a hoje ("Digite uma data válida",
     e o "Buscar" não libera): o limite é ONTEM. Achado do Rodrigo em 24/11/2026. */
  function ontemDe(agora) {
    const d = (agora && typeof agora.getTime === "function") ? new Date(agora.getTime()) : new Date();
    const o = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);
    o.setDate(o.getDate() - 1);
    return o;
  }
  const ontemYmd = (agora) => ymdDe(ontemDe(agora));

  /* "N anos até ontem": de (ontem − N anos + 1 dia) a ontem. 29/02 cai em 28/02. */
  function anosAte(anos, agora) {
    const h = ontemDe(agora);
    const ini = new Date(h.getFullYear() - anos, h.getMonth(), h.getDate(), 12, 0, 0);
    if (ini.getMonth() !== h.getMonth()) ini.setDate(0);          // 29/02 → 28/02
    ini.setDate(ini.getDate() + 1);
    return { inicio: ymdDe(ini), fim: ymdDe(h) };
  }

  /* O período escolhido → { inicio, fim, rotulo, valor } ou { erro }.
     escolha: { valor: "10a"|"5a"|…|"personalizado", inicio?, fim? } */
  function resolver(escolha, agora) {
    const e = escolha || {};
    const valor = e.valor || PADRAO;
    const op = OPCOES.find((o) => o.valor === valor);
    if (op) { const p = anosAte(op.anos, agora); return Object.assign(p, { valor, rotulo: op.rotulo }); }
    if (valor !== "personalizado") return { erro: "período desconhecido" };
    const di = paraData(e.inicio), df = paraData(e.fim);
    if (!di || !df) return { erro: "informe as duas datas do período" };
    if (di.getTime() > df.getTime()) return { erro: "a data inicial é depois da final" };
    if (e.fim > ontemYmd(agora)) return { erro: "a data final pode ser no máximo ontem — o CENSEC não aceita o dia de hoje" };
    return { inicio: e.inicio, fim: e.fim, valor, rotulo: `De ${dmy(e.inicio)} a ${dmy(e.fim)}` };
  }

  /* Divide [inicio, fim] em duas metades sem sobreposição: [inicio, meio] e [meio+1, fim].
     Período de um dia só não se divide (null). */
  function dividir(p) {
    const a = paraData(p && p.inicio), b = paraData(p && p.fim);
    if (!a || !b || a.getTime() >= b.getTime()) return null;
    const dias = Math.round((b.getTime() - a.getTime()) / 86400000);
    const meio = new Date(a.getTime()); meio.setDate(meio.getDate() + Math.floor(dias / 2));
    const depois = new Date(meio.getTime()); depois.setDate(depois.getDate() + 1);
    return [{ inicio: p.inicio, fim: ymdDe(meio) }, { inicio: ymdDe(depois), fim: p.fim }];
  }

  /* Texto da certidão: "atos praticados entre 24/11/2016 e 23/11/2026" */
  const frase = (p) => `atos praticados entre ${dmy(p.inicio)} e ${dmy(p.fim)}`;

  /* Junta trechos cobertos (lista de {inicio,fim}) em faixas contínuas, para a certidão
     dizer o que FOI e o que NÃO FOI coberto quando o refinamento não deu conta. */
  function juntarTrechos(trechos) {
    const ord = (trechos || []).filter((t) => paraData(t.inicio) && paraData(t.fim))
      .slice().sort((x, y) => (x.inicio < y.inicio ? -1 : x.inicio > y.inicio ? 1 : 0));
    const out = [];
    for (const t of ord) {
      const ult = out[out.length - 1];
      if (ult) {
        const seg = paraData(ult.fim); seg.setDate(seg.getDate() + 1);
        if (t.inicio <= ymdDe(seg)) { if (t.fim > ult.fim) ult.fim = t.fim; continue; }
      }
      out.push({ inicio: t.inicio, fim: t.fim });
    }
    return out;
  }

  const api = { OPCOES, PADRAO, resolver, dividir, frase, dmy, paraData, juntarTrechos, hojeYmd, ontemYmd };
  globalThis.CratosPeriodo = Object.freeze(api);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
