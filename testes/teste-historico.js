/*
 * teste-historico.js — 2.0: histórico do processo SEM DADO DE PARTE (Rodrigo, 16/11/2026).
 *
 * "O que o CRATOS não deve gravar é dados das partes. O restante, para orientação, não fere
 * LGPD." O histórico guarda só convênio, fase e data; sobrevive ao fechamento da aba; é
 * apagado 6 meses depois do último evento. Vigia também a fase de cada registro do diário
 * (faseDoRegistro) e a fiação no fundo. Dados fictícios.
 *
 * Rodar: node teste-historico.js   (CRATOS_SRC=<src antigo> para ver reprovar)
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const falhas = [];
const oks = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }
function fim() {
  console.log("\n=== teste-historico.js ===");
  oks.forEach((d) => console.log("  ok   " + d));
  falhas.forEach((d) => console.log("  FALHA " + d));
  console.log(`\n${oks.length} passaram, ${falhas.length} falharam (${oks.length + falhas.length} asserções)\n`);
  process.exit(falhas.length ? 1 : 0);
}
const ARQ_H = path.join(SRC, "modulos", "historico.js");
const ARQ_S = path.join(SRC, "comum", "situacao.js");
if (!fs.existsSync(ARQ_H) || !fs.existsSync(ARQ_S)) { checar(false, "modulos/historico.js ou comum/situacao.js não existe nesta versão"); fim(); }

/* storage falso, com a mesma semântica do browser.storage.local */
function novoArmazem(inicial) {
  const dados = Object.assign({}, inicial || {});
  return {
    dados,
    async get(k) {
      if (k == null) return JSON.parse(JSON.stringify(dados));
      const ks = Array.isArray(k) ? k : [k];
      const o = {};
      for (const x of ks) if (x in dados) o[x] = JSON.parse(JSON.stringify(dados[x]));
      return o;
    },
    async set(o) { for (const [k, v] of Object.entries(o)) dados[k] = JSON.parse(JSON.stringify(v)); },
    async remove(ks) { for (const k of [].concat(ks)) delete dados[k]; },
  };
}
function carregar(arm) {
  const ctx = { console, Date, Promise, browser: { storage: { local: arm } } };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(ARQ_S, "utf8"), ctx);
  vm.runInContext(fs.readFileSync(ARQ_H, "utf8"), ctx);
  const lim = path.join(SRC, "modulos", "limpeza.js");
  if (fs.existsSync(lim)) vm.runInContext(fs.readFileSync(lim, "utf8") + "\nglobalThis.Limpeza = Limpeza;", ctx);
  return ctx;
}
const P = "00012345620255180008";            // processo fictício
const K = "cratos:historico:" + P;
const DIA = 24 * 3600 * 1000;

(async () => {
  /* 1. Grava só convênio, fase e data. */
  {
    const arm = novoArmazem();
    const ctx = carregar(arm);
    const H = ctx.CratosHistorico;
    await H.registrar("0001234-56.2025.5.18.0008", "renajud", "inclusao", "2026-11-10T14:00:00Z");
    await H.registrar(P, "SISBAJUD", "resposta", "2026-11-12T14:00:00Z");
    const h = arm.dados[K];
    checar(h && h.eventos.length === 2, "registra pelo número mascarado ou só dígitos, na mesma chave");
    checar(h.eventos.every((e) => Object.keys(e).sort().join() === "convenio,em,fase"), "cada evento tem SÓ convenio, fase e em");
    checar(h.eventos[0].convenio === "RENAJUD" && h.eventos[1].convenio === "SAB", "convênio normalizado (caixa alta; SISBAJUD conta como SAB)");
    await H.registrar(P, "RENAJUD", "inclusao", null, { nome: "FULANO EXEMPLO", cpf: "000.000.000-00" });
    checar(!JSON.stringify(arm.dados).match(/FULANO|000\.000/), "argumento extra com dado de parte não entra no armazenamento");
    const antes = arm.dados[K].eventos.length;
    await H.registrar(P, "INVENTADO", "inclusao");
    await H.registrar(P, "CNIB", "fase-inventada");
    await H.registrar("123", "CNIB", "inclusao");
    await H.registrar(P, "CNIB", "inclusao", "lixo");
    checar(arm.dados[K].eventos.length === antes, "convênio, fase, processo ou data inválidos: nada é gravado");
    const lidos = await H.ler(P);
    checar(lidos.length === antes && lidos.every((e) => e.origem === "historico"), "ler devolve os eventos marcados como do histórico");
  }

  /* 2. Teto de 200 eventos. */
  {
    const arm = novoArmazem();
    const H = carregar(arm).CratosHistorico;
    for (let i = 0; i < 205; i++) await H.registrar(P, "CENSEC", "consulta", Date.UTC(2026, 0, 1) + i * 1000);
    const ev = arm.dados[K].eventos;
    checar(ev.length === 200, "no máximo 200 eventos por processo");
    checar(ev[0].em === new Date(Date.UTC(2026, 0, 1) + 5000).toISOString(), "saem os mais antigos primeiro");
  }

  /* 3. Prazo de 6 meses. */
  {
    const agora = Date.now();
    const velho = { atualizadoEm: new Date(agora - 200 * DIA).toISOString(), eventos: [{ convenio: "CNIB", fase: "inclusao", em: new Date(agora - 200 * DIA).toISOString() }] };
    const novo = { atualizadoEm: new Date(agora - 30 * DIA).toISOString(), eventos: [{ convenio: "CNIB", fase: "baixa", em: new Date(agora - 30 * DIA).toISOString() }] };
    const arm = novoArmazem({ "cratos:historico:11111111111111111111": velho, "cratos:historico:22222222222222222222": novo, "cratos:config": { x: 1 } });
    const H = carregar(arm).CratosHistorico;
    checar((await H.ler("11111111111111111111")).length === 0, "histórico com mais de 6 meses não é lido");
    const fora = await H.purgar();
    checar(fora.length === 1 && !("cratos:historico:11111111111111111111" in arm.dados), "purgar apaga o processo sem evento há mais de 6 meses");
    checar("cratos:historico:22222222222222222222" in arm.dados && "cratos:config" in arm.dados, "purgar mantém o recente e não toca em outras chaves");
    checar(H.PRAZO_MS >= 180 * DIA && H.PRAZO_MS <= 184 * DIA, "prazo de cerca de 6 meses");
  }

  /* 4. Sobrevive à limpeza da aba e à do Firefox; o diário (com dado de parte) não. */
  {
    const arm = novoArmazem({
      [K]: { atualizadoEm: new Date().toISOString(), eventos: [{ convenio: "CNIB", fase: "inclusao", em: new Date().toISOString() }] },
      ["cratos:diario:" + P]: { numProcesso: P, itens: [{ convenio: "CNIB", arquivo: "x_FULANO CNIB.pdf" }] },
    });
    const ctx = carregar(arm);
    checar(!!ctx.Limpeza, "limpeza.js carregada");
    await ctx.Limpeza.apagarProcesso(P);
    checar(K in arm.dados, "fechar a aba NÃO apaga o histórico");
    checar(!(("cratos:diario:" + P) in arm.dados), "fechar a aba continua apagando o diário (que tem dado de parte)");
    arm.dados["cratos:diario:" + P] = { x: 1 };
    await ctx.Limpeza.aoIniciar();
    checar(K in arm.dados && !(("cratos:diario:" + P) in arm.dados), "abrir o Firefox: histórico fica, diário sai");
  }

  /* 5. Fase de cada registro do diário. */
  {
    const S = carregar(novoArmazem()).CratosSituacao;
    const f = (reg, arq) => S.faseDoRegistro(reg, arq);
    checar(f({ convenio: "RENAJUD", operacao: "baixa" }) === "baixa" && f({ convenio: "CNIB", operacao: "cancelamento" }) === "baixa", "baixa e cancelamento = baixa");
    checar(f({ convenio: "SNIPER", operacao: "indisponibilidade" }) === "indisponivel", "indisponibilidade");
    checar(f({ convenio: "SAB", operacao: "respostas_sab" }) === "resposta" && f({ convenio: "SAB", operacao: "transferencia_sab" }) === "resposta", "respostas e transferência do SAB = resposta");
    checar(f({ convenio: "SAB", operacao: "inclusao" }) === "inclusao" && f({ convenio: "RENAJUD" }) === "inclusao", "inclusão (e convênio de ato sem operação)");
    checar(f({ convenio: "CCS", operacao: "consulta" }, "x_EMPRESA CCS envio.pdf") === "pedido", "CCS envio = pedido");
    checar(f({ convenio: "CCS", operacao: "consulta", detalhe: "detalhamento" }, "x CCS detalhamento.pdf") === "resposta", "CCS detalhamento = resposta");
    checar(f({ convenio: "PREVJUD", operacao: "consulta", detalhe: "certidao" }, "x PREVJUD certidao.pdf") === "pedido", "PREVJUD certidão do pedido = pedido");
    checar(f({ convenio: "PREVJUD", operacao: "consulta", detalhe: "certidao" }, "x PREVJUD coleta certidao.pdf") === "resposta", "PREVJUD coleta = resposta");
    checar(f({ convenio: "INFOJUD", detalhe: "DIRPF 2025" }) === "resposta" && f({ convenio: "INFOJUD", operacao: "consulta", detalhe: "empresas" }) === "consulta", "INFOJUD: arquivo da caixa postal = resposta; empresas = consulta");
    checar(f({ convenio: "CENSEC" }) === "consulta" && f({ convenio: "SNIPER", operacao: "consulta" }) === "consulta", "CENSEC e SNIPER = consulta");
    checar(f({ convenio: "?" }) === null && f({}) === null, "convênio desconhecido: sem fase (não inventa)");
    checar(f({ convenio: "CNIB", fase: "baixa", operacao: "inclusao" }) === "baixa", "fase explícita vence");
  }

  /* 6. Fiação. */
  {
    const bg = fs.readFileSync(path.join(SRC, "background.js"), "utf8");
    const man = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8"));
    const sc = man.background.scripts;
    checar(sc.indexOf("comum/situacao.js") >= 0 && sc.indexOf("modulos/historico.js") >= 0 && sc.indexOf("modulos/historico.js") < sc.indexOf("background.js"), "manifesto carrega situacao.js e historico.js antes do background.js");
    checar(/faseDoRegistro\(registro, nomeFinal\)/.test(bg) && /CratosHistorico\.registrar\(registro\.numProcesso, registro\.convenio, fase\)/.test(bg), "todo arquivo baixado registra a fase no histórico (só convênio e fase)");
    checar(/case "historico_ler"/.test(bg) && /case "historico_registrar"/.test(bg), "mensagens historico_ler e historico_registrar");
    checar(/CratosHistorico\.purgar\(\)/.test(bg), "o prazo é aplicado ao abrir o Firefox");
    const inf = fs.readFileSync(path.join(SRC, "conteudo", "ecac-infojud.js"), "utf8");
    checar(/historico_registrar", numProcesso, convenio: "INFOJUD", fase: "pedido"/.test(inf), "INFOJUD: o pedido registrado vira evento 'pedido'");
  }
  fim();
})().catch((e) => { checar(false, "exceção: " + e.message); fim(); });
