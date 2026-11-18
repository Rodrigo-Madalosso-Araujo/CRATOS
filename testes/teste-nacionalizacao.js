/*
 * teste-nacionalizacao.js — o CRATOS fora do TRT18 (1.9.7). Dados FICTÍCIOS.
 *
 * Relato do Rodrigo (18/11/2026): logado no PJe do TRT19, o CRATOS não apareceu. O
 * console mostrou que a API do PJe do TRT19 responde igual à do TRT18 — o que barrava
 * era o manifest, preso a pje.trt18.jus.br, e três endereços fixos no código (a abertura
 * do SAB, duas vezes, e o controle da verificação de disponibilidade). E as partes do
 * TRT19 vêm em ATIVO / PASSIVO / TERCEIROS — e "TERCEIROS" (plural) não era conhecido:
 * os 35 terceiros de um processo sumiam do painel sem aviso.
 *
 * O que se trava aqui:
 *  1. manifest: os 24 TRTs, um por um (nada de *.jus.br), no PJe e no /sab/*; nenhuma
 *     outra permissão muda; nenhum "trt18" sobrando fora do id da extensão.
 *  2. CratosConveniosUso.basePje: só https://pje.trtN.jus.br, N de 1 a 24.
 *  3. partes: TERCEIROS entra; chave desconhecida usa o `polo` da parte; sem polo
 *     nenhum → "indefinido" (entra, nunca some); lista que não é de partes é pulada.
 *  4. painel no TRT19: terceiros e polo indefinido nascem DESMARCADOS; aviso de polo.
 *  5. SAB: abre no PJe do processo (TRT19), nunca no TRT18; sem PJe → erro claro.
 *  6. disponibilidade: o controle é o PJe da aba de quem pediu; sem ele, não certifica.
 *
 * Reprova a 1.9.6. Rodar: node teste-nacionalizacao.js
 * Versão antiga: CRATOS_SRC=<pasta do src> node teste-nacionalizacao.js
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const NOME = "teste-nacionalizacao";
const oks = [], falhas = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 20));
const ler = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");

(async () => {
  /* ── 1. manifest ─────────────────────────────────────────────────────────── */
  {
    const man = JSON.parse(ler("manifest.json"));
    const pje = Array.from({ length: 24 }, (_, i) => `https://pje.trt${i + 1}.jus.br/*`);
    const sab = Array.from({ length: 24 }, (_, i) => `https://pje.trt${i + 1}.jus.br/sab/*`);
    const perms = man.permissions || [];
    checar(pje.every((h) => perms.includes(h)), "manifest: permissão no PJe dos 24 TRTs");
    checar(!perms.some((h) => /\*\.jus\.br|\*\.trt\d+\.jus\.br|pje\.trt\*/.test(h)),
      "⛔ manifest: nada de curinga amplo (*.jus.br) — os 24 TRTs listados um por um");
    const outras = perms.filter((h) => !/^https:\/\/pje\.trt\d{1,2}\.jus\.br\/\*$/.test(h)).sort();
    checar(JSON.stringify(outras) === JSON.stringify([
      "downloads", "https://*.censec.org.br/*", "https://*.receita.fazenda.gov.br/*", "https://indisponibilidade.onr.org.br/*",
      "https://previdenciario.pdpj.jus.br/*", "https://renajud.pdpj.jus.br/*", "https://serasa-judicial.serasaexperian.com.br/*",
      "https://sniper.pdpj.jus.br/*", "https://www3.bcb.gov.br/*", "storage", "tabs"].sort()),
      "manifest: as demais permissões ficam exatamente como estavam (nenhuma nova)");
    const csPainel = (man.content_scripts || []).find((c) => (c.js || []).includes("conteudo/painel.js")) || {};
    const csSab = (man.content_scripts || []).find((c) => (c.js || []).includes("conteudo/sab.js")) || {};
    checar(pje.every((h) => (csPainel.matches || []).includes(h)) && (csPainel.matches || []).length === 24,
      "⛔ manifest: o painel entra no PJe dos 24 TRTs (no TRT19 ele não aparecia)");
    checar(sab.every((h) => (csSab.matches || []).includes(h)) && (csSab.matches || []).length === 24,
      "manifest: o script do SAB entra no /sab/ dos 24 TRTs (se o tribunal não tem SAB, não faz nada)");
    const semId = JSON.stringify(Object.assign({}, man, { browser_specific_settings: null }))
      .replace(/"https:\/\/pje\.trt\d{1,2}\.jus\.br\/(sab\/)?\*"/g, '""');
    checar(!/trt18/i.test(semId), "manifest: nenhum \"trt18\" sobrando fora das listas dos 24 TRTs (e do id da extensão)");
  }

  /* ── 2. basePje ──────────────────────────────────────────────────────────── */
  const usoArq = path.join(SRC, "comum", "convenios-uso.js");
  const ctxUso = { console, URL };
  vm.createContext(ctxUso);
  vm.runInContext(fs.readFileSync(usoArq, "utf8"), ctxUso);
  const U = ctxUso.CratosConveniosUso || {};
  {
    const b = typeof U.basePje === "function" ? U.basePje : () => "(sem basePje)";
    checar(b("https://pje.trt19.jus.br/pjekz/processo/232117/detalhe") === "https://pje.trt19.jus.br" &&
      b("https://pje.trt3.jus.br/sab/determinacoes/1") === "https://pje.trt3.jus.br" &&
      b("https://PJE.TRT24.JUS.BR/x") === "https://pje.trt24.jus.br", "basePje: a origem do PJe do TRT, de qualquer endereço dele");
    checar([null, "", "lixo", "http://pje.trt19.jus.br/", "https://pje.trt25.jus.br/", "https://pje.trt0.jus.br/",
      "https://pje.trt019.jus.br/", "https://pje.trt19.jus.br:8443/", "https://pje.trt19.jus.br.exemplo.com/",
      "https://x.pje.trt19.jus.br/", "https://user@pje.trt19.jus.br/", "https://pje.tjgo.jus.br/"].every((x) => b(x) === null),
      "⛔ basePje: recusa http, porta, usuário, TRT fora de 1–24, zero à esquerda, domínio parecido e outro tribunal");
  }

  /* ── 3. partes ───────────────────────────────────────────────────────────── */
  {
    const c = { console };
    vm.createContext(c);
    vm.runInContext(ler("comum/api-pje.js") + "\nglobalThis.__n = normalizarPartes;", c);
    const pessoa = (i, polo, extra) => Object.assign({ id: i, polo, nome: `PESSOA FICTICIA ${i}`, documento: String(10000000000 + i),
      tipoDocumento: "CPF", tipoPessoa: "F", idPessoa: 900 + i, representantes: [{ nome: "ADVOGADO FICTICIO" }] }, extra || {});
    /* a estrutura do TRT19 (lida no console em 18/11): 1 ativo, 5 passivos, 35 terceiros */
    const bruto = {
      ATIVO: [pessoa(1, "ativo")],
      PASSIVO: Array.from({ length: 5 }, (_, i) => pessoa(10 + i, "passivo", { tipoPessoa: "J", tipoDocumento: "CNPJ", documento: String(11222333000100 + i) })),
      TERCEIROS: Array.from({ length: 35 }, (_, i) => pessoa(100 + i, "outros")),
    };
    const ps = c.__n(bruto);
    const n = (polo) => ps.filter((p) => p.polo === polo).length;
    checar(ps.length === 41 && n("ativo") === 1 && n("passivo") === 5 && n("terceiro") === 35,
      "⛔ TRT19: ATIVO/PASSIVO/TERCEIROS → 41 partes, os 35 terceiros incluídos (antes sumiam)");
    checar(ps.every((p) => !/ADVOGADO/.test(p.nome)) && ps.filter((p) => p.polo === "passivo").every((p) => p.tipoPessoa === "juridica" && p.cpfcnpj.length === 14),
      "partes: campos do TRT19 lidos como no TRT18 (documento, tipoPessoa); advogados de fora");
    const outro = c.__n({ POLO_X: [pessoa(1, "passivo")], OUTRA_COISA: [pessoa(2, "ESTRANHO")], contagem: 3, legenda: ["a", "b"] });
    checar(outro.length === 2 && outro[0].polo === "passivo" && outro[1].polo === "indefinido",
      "⛔ chave desconhecida: vale o polo da própria parte; sem polo reconhecível → \"indefinido\" (entra, não some)");
    const plana = c.__n([pessoa(1, "ativo"), pessoa(2, "passivo"), pessoa(3, "outros")]);
    checar(plana.map((p) => p.polo).join() === "ativo,passivo,terceiro", "lista plana: o polo vem de cada parte");
    checar(c.__n({ TERCEIRO: [pessoa(1, "")], OUTROS: [pessoa(2, "")] }).every((p) => p.polo === "terceiro") &&
      c.__n({ ATIVO: [pessoa(1, "passivo")] })[0].polo === "ativo",
      "chaves de sempre continuam valendo (e mandam sobre o polo da parte)");
  }

  /* ── 4. painel no TRT19 ──────────────────────────────────────────────────── */
  {
    const { montarPainel } = require("./harness-painel.js");
    const a = montarPainel(SRC, { url: "https://pje.trt19.jus.br/pjekz/processo/232117/detalhe" });
    const P = a.P;
    P.renderProcesso({
      numero: "0000001-23.2026.5.19.0001", id: 232117,
      partes: [
        { nome: "AUTOR FICTICIO", cpfcnpj: "12312312387", polo: "ativo" },
        { nome: "EMPRESA FICTICIA LTDA", cpfcnpj: "11222333000181", polo: "passivo" },
        { nome: "TERCEIRO FICTICIO UM", cpfcnpj: "45645645609", polo: "terceiro" },
        { nome: "TERCEIRO FICTICIO DOIS", cpfcnpj: "78978978901", polo: "terceiro" },
        { nome: "PARTE SEM POLO FICTICIA", cpfcnpj: "32132132100", polo: "indefinido" },
      ],
    });
    await tick();
    const cbs = Array.from(a.d.querySelectorAll(".cx-sel-parte"));
    checar(cbs.length === 5, "painel (TRT19): uma caixa por parte, terceiros e polo indefinido incluídos");
    checar(cbs.length === 5 && !cbs[0].checked && cbs[1].checked && !cbs[2].checked && !cbs[3].checked && !cbs[4].checked,
      "⛔ painel: só o passivo nasce marcado — terceiros e polo não identificado nascem DESMARCADOS (35 terceiros não vão de saída aos convênios)");
    const aviso = a.d.querySelector(".cx-aviso-polo");
    checar(aviso && /1 parte\(s\) com polo não identificado/.test(aviso.textContent) && /polo não identificado/.test(a.d.body.textContent),
      "painel: aviso de parte com polo não identificado");
  }

  /* ── 5. SAB no PJe do processo ───────────────────────────────────────────── */
  {
    const bg = ler("background.js");
    const ini = bg.indexOf("function _basePjeDe(");
    const fimOrdem = bg.indexOf("\n}\n", bg.indexOf("async function abrirOrdemSab(")) + 3;
    const iniDet = bg.indexOf("async function abrirDeterminacaoSab(");
    const fimDet = bg.indexOf("\n}\n", iniDet) + 3;
    const montar = (guardada) => {
      const r = { criadas: [], consultas: [], estado: null };
      const Store = { get: async (k) => (k === "trt" ? guardada : null), set: async (k, v) => { if (k === "sab_estado") r.estado = v; } };
      const browser = { tabs: {
        query: async (q) => { r.consultas.push(q.url); return []; },
        create: async (o) => { r.criadas.push(o.url); return { id: 1 }; },
        update: async () => ({}),
      } };
      const corpo = (ini >= 0 ? bg.slice(ini, fimOrdem) : bg.slice(bg.indexOf("async function abrirOrdemSab("), fimOrdem)) + bg.slice(iniDet, fimDet);
      r.fn = new Function("Store", "CHAVES", "browser", "globalThis",
        corpo + "\nreturn { abrirOrdemSab, abrirDeterminacaoSab };")(Store, { trt: "trt" }, browser, { CratosConveniosUso: U });
      return r;
    };
    const r = montar(null);
    await r.fn.abrirOrdemSab({ idSab: 77, numProcesso: "0000001-23.2026.5.19.0001", base: "https://pje.trt19.jus.br" }).catch((e) => (r.erro = e));
    checar(r.criadas[0] === "https://pje.trt19.jus.br/sab/determinacoes/nova/processo/77" && r.consultas[0] === "https://pje.trt19.jus.br/sab/*",
      "⛔ SAB (inclusão): abre no PJe do processo (TRT19), não no do TRT18");
    const r2 = montar(null);
    await r2.fn.abrirDeterminacaoSab({ idDeterminacao: 5, numProcesso: "x", base: "https://pje.trt3.jus.br" }).catch((e) => (r2.erro = e));
    checar(r2.criadas[0] === "https://pje.trt3.jus.br/sab/determinacoes/5" && r2.consultas[0] === "https://pje.trt3.jus.br/sab/*",
      "⛔ SAB (baixa): abre a determinação no PJe do processo (TRT3)");
    const r3 = montar("https://pje.trt10.jus.br");
    await r3.fn.abrirOrdemSab({ idSab: 9, numProcesso: "x" }).catch((e) => (r3.erro = e));
    checar(r3.criadas[0] === "https://pje.trt10.jus.br/sab/determinacoes/nova/processo/9", "SAB sem base na mensagem: vale o PJe guardado na captura (TRT10)");
    const r4 = montar(null);
    let erro4 = null;
    await r4.fn.abrirOrdemSab({ idSab: 9, numProcesso: "x", base: "https://exemplo.com" }).catch((e) => (erro4 = e));
    checar(erro4 && /não identifiquei o PJe/.test(erro4.message) && !r4.criadas.length && !r4.estado,
      "⛔ SAB sem PJe identificado: erro claro, nenhuma aba aberta e nenhum estado semeado (nunca cai no TRT18)");
    const sabMod = ler("modulos/sab.js");
    checar((sabMod.match(/base: ctx\.base/g) || []).length === 2, "módulo SAB: passa o PJe do processo (ctx.base) nas duas aberturas");
    checar(/case "sab_abrir_ordem":[\s\S]{0,200}base: sender && sender\.tab \? sender\.tab\.url/.test(bg),
      "rota sab_abrir_ordem: o PJe é o da aba que pediu (o navegador informa), não o que vier na mensagem");
    const resto = bg.replace(/cratos@trt18/g, "");
    checar(!/pje\.trt18\.jus\.br\/(sab|pjekz)/.test(resto) && !/"https:\/\/pje\.trt18/.test(resto), "background: nenhum endereço do TRT18 fixo no código");
  }

  /* ── 6. disponibilidade: controle no PJe da aba ──────────────────────────── */
  {
    const c = { console, URL, setTimeout, clearTimeout, AbortController };
    vm.createContext(c);
    vm.runInContext(ler("modulos/disponibilidade.js") + "\nglobalThis.__M = ModuloDisponibilidade;", c);
    const M = c.__M;
    const urls = [];
    M.io = { agora: () => Date.parse("2026-11-18T10:00:00-03:00"), esperar: async () => {},
      fetch: async (u) => { urls.push(u); if (/renajud/.test(u)) throw new TypeError("NetworkError"); return { status: 200, statusText: "OK", type: "basic" }; } };
    const m = await M.medir("RENAJUD", "https://pje.trt19.jus.br");
    checar(urls[urls.length - 1] === "https://pje.trt19.jus.br/pjekz/" && m.conclusao === "indisponivel",
      "⛔ disponibilidade: a verificação de controle bate no PJe da aba (TRT19)");
    urls.length = 0;
    const m2 = await M.medir("RENAJUD");
    checar(!urls.some((u) => /pje\.trt/.test(u)) && m2.conclusao === "controle_falhou",
      "⛔ disponibilidade sem PJe identificado: não sonda o TRT18; conclui \"controle_falhou\" e não certifica");
    const bg = ler("background.js");
    checar(/case "medir_disponibilidade":[\s\S]{0,250}ModuloDisponibilidade\.medir\(msg\.convenioId, _basePjeDe\(sender && sender\.tab \? sender\.tab\.url : null\)\)/.test(bg),
      "rota medir_disponibilidade: passa o PJe da aba que pediu");
  }

  console.log(`\n=== ${NOME} ===`);
  oks.forEach((d) => console.log("  ok   " + d));
  falhas.forEach((d) => console.log("  FALHA " + d));
  console.log(`\n${oks.length} passaram, ${falhas.length} falharam (${oks.length + falhas.length} asserções)\n`);
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.log("FALHA geral: " + e.stack); process.exit(1); });
