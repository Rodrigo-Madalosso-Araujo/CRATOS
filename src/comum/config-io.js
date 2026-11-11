/*
 * comum/config-io.js — EXPORTAR e IMPORTAR as Preferências do CRATOS (1.9.3, 10/11/2026).
 *
 * Pedido do Rodrigo: backup / troca de computador do próprio servidor, podendo
 * compartilhar com a unidade. E "engessar" o arquivo: não aceitar outros parâmetros,
 * com limite de caracteres.
 *
 * O ARQUIVO leva só as Preferências (a chave `config`), com o valor EFETIVO de cada
 * opção (o salvo ou, na falta, o padrão). Nada de processo, parte, fila, Cofre,
 * histórico, listas lidas das telas nem identificação de quem exportou.
 *
 * O IMPORTADOR é uma lista branca derivada do próprio catálogo dos módulos (o mesmo
 * schema que desenha a tela de Preferências):
 *   - arquivo maior que TAMANHO_MAX, que não é JSON, sem a marca do formato ou com
 *     estrutura estranha → recusado INTEIRO, nada muda;
 *   - convênio ou opção que o CRATOS não conhece → descartado (e listado);
 *   - valor fora do tipo, fora das opções, maior que o limite ou com caractere
 *     proibido → descartado (e listado), e a opção fica como está;
 *   - só então o que sobrou é mostrado como DIFERENÇAS e aplicado com confirmação.
 * Não há IA dentro do CRATOS, então o risco de um arquivo malicioso não é "prompt
 * injection", e sim o clássico: texto que vira HTML na tela, ou caminho de pasta que
 * escapa da pasta de downloads ("../"). Os dois estão fechados aqui (e a tela de
 * Preferências escapa tudo de qualquer jeito, desde a 1.5.5).
 *
 * Puro (sem DOM, sem browser.*): testável no Node.
 */
(function () {
  "use strict";
  if (globalThis.CratosConfigIO) return;

  const FORMATO = "cratos-configuracoes";
  const VERSAO_FORMATO = 1;
  const TAMANHO_MAX = 64 * 1024;           // bytes do arquivo
  const TEXTO_MAX = 200;                   // caracteres de um campo de texto
  const LISTA_LIVRE_MAX = 150;             // lista lida da tela (vara, órgão)
  const PASTA_MAX = 80;
  const CHAVES_MAX = 600;                  // folhas no arquivo inteiro
  const PROFUNDIDADE_MAX = 4;

  /* Os dados da LOTAÇÃO de quem usa: no "manter os meus", ficam como estão. */
  const LOTACAO = [
    ["infojud", "vara"], ["infojud", "magistrado"],
    ["renajud", "tribunal"], ["renajud", "orgao"], ["renajud", "magistrado"],
    ["cnib", "orgaoEsperado"],
  ];
  const ehLotacao = (mod, chave) => LOTACAO.some(([m, c]) => m === mod && c === chave);

  /* Campo de pasta: só nomes simples, até 4 níveis, sem "." nem ".." */
  const ehPasta = (chave) => /^(pasta|pastaDownload)$/.test(chave);
  const SEG_PASTA = /^[\p{L}\p{N} _().-]{1,40}$/u;
  /* Texto livre: sem controle, sem < > ` { } \ " (nada que vire marcação ou escape) */
  const PROIBIDO = /[\u0000-\u001F\u007F<>`{}\\"]/;

  const ehObj = (x) => !!x && typeof x === "object" && !Array.isArray(x);
  const valorDe = (o) => (ehObj(o) ? o.valor : o);
  const rotuloDe = (o) => (ehObj(o) ? o.rotulo : o);

  /* Percorre o schema: [{ mod, grupo|null, chave, esp, rotuloMod, rotuloCampo }] */
  function campos(catalogo) {
    const out = [];
    for (const m of (catalogo || [])) {
      for (const [chave, esp] of Object.entries(m.config || {})) {
        if (chave === "_grupos") {
          for (const [g, grupo] of Object.entries(esp || {})) {
            for (const [ck, cesp] of Object.entries((grupo && grupo.campos) || {})) {
              out.push({ mod: m.nome, grupo: g, chave: ck, esp: cesp, rotuloMod: m.rotulo, rotuloCampo: `${grupo.rotulo || g} · ${cesp.rotulo || ck}` });
            }
          }
          continue;
        }
        if (!esp || esp.tipo === "aviso" || chave.charAt(0) === "_") continue;
        out.push({ mod: m.nome, grupo: null, chave, esp, rotuloMod: m.rotulo, rotuloCampo: esp.rotulo || chave });
      }
    }
    return out;
  }
  const ler = (cfg, c) => {
    const m = ehObj(cfg) ? cfg[c.mod] : null;
    const base = c.grupo ? (ehObj(m) ? m[c.grupo] : null) : m;
    return ehObj(base) ? base[c.chave] : undefined;
  };
  const gravar = (cfg, c, v) => {
    if (!ehObj(cfg[c.mod])) cfg[c.mod] = {};
    if (c.grupo) {
      if (!ehObj(cfg[c.mod][c.grupo])) cfg[c.mod][c.grupo] = {};
      cfg[c.mod][c.grupo][c.chave] = v;
    } else cfg[c.mod][c.chave] = v;
  };
  const nomeDe = (c) => `${c.mod}.${c.grupo ? c.grupo + "." : ""}${c.chave}`;

  /* Um valor contra a especificação do campo → { ok, v } | { ok:false, motivo } */
  function conferir(c, bruto) {
    const esp = c.esp;
    const t = esp.tipo;
    const texto = (s, max) => {
      if (typeof s !== "string") return { ok: false, motivo: "não é texto" };
      if (s.length > max) return { ok: false, motivo: `mais de ${max} caracteres` };
      if (PROIBIDO.test(s)) return { ok: false, motivo: "caractere não permitido" };
      return { ok: true, v: s.trim() };
    };
    if (t === "toggle") {
      if (!ehObj(bruto) || typeof bruto.ativo !== "boolean" || Object.keys(bruto).length !== 1) return { ok: false, motivo: "formato inválido" };
      return { ok: true, v: { ativo: bruto.ativo } };
    }
    if (t === "toggle_anos") {
      if (!ehObj(bruto) || typeof bruto.ativo !== "boolean" || !Number.isInteger(bruto.anos) || bruto.anos < 1 || bruto.anos > 5 ||
        Object.keys(bruto).length !== 2) return { ok: false, motivo: "formato inválido" };
      return { ok: true, v: { ativo: bruto.ativo, anos: bruto.anos } };
    }
    if (t === "numero") {
      const min = Number.isFinite(esp.min) ? esp.min : 0, max = Number.isFinite(esp.max) ? esp.max : 1e6;
      if (!Number.isInteger(bruto) || bruto < min || bruto > max) return { ok: false, motivo: "número fora do limite" };
      return { ok: true, v: bruto };
    }
    if (t === "multiselect") {
      const opc = (esp.opcoes || []).map(valorDe).map(String);
      if (!Array.isArray(bruto) || bruto.length > opc.length || bruto.some((x) => typeof x !== "string" || opc.indexOf(x) < 0) ||
        new Set(bruto).size !== bruto.length) return { ok: false, motivo: "fora das opções" };
      return { ok: true, v: bruto.slice() };
    }
    if (t === "escolha" || t === "select" || (t === "lista" && !esp.listaDinamica)) {
      const opc = (esp.opcoes || []).map(valorDe).map(String);
      if (typeof bruto !== "string" || (opc.indexOf(bruto) < 0 && !(t === "lista" && bruto === ""))) return { ok: false, motivo: "fora das opções" };
      return { ok: true, v: bruto };
    }
    if (t === "lista") return texto(bruto, LISTA_LIVRE_MAX);      // lida da tela: varia por usuário
    if (ehPasta(c.chave)) {
      const r = texto(bruto, PASTA_MAX);
      if (!r.ok) return r;
      const segs = r.v.split("/");
      if (!r.v || segs.some((s) => !SEG_PASTA.test(s) || /^\.+$/.test(s.trim())) || segs.length > 4) return { ok: false, motivo: "pasta inválida" };
      return r;
    }
    return texto(bruto, TEXTO_MAX);                                 // texto
  }

  /* Folhas e profundidade do JSON (antes de olhar o conteúdo) */
  function medir(x, prof) {
    if (prof > PROFUNDIDADE_MAX + 2) return { folhas: Infinity, prof };
    if (Array.isArray(x)) return x.reduce((a, y) => { const r = medir(y, prof + 1); return { folhas: a.folhas + r.folhas, prof: Math.max(a.prof, r.prof) }; }, { folhas: 0, prof });
    if (ehObj(x)) return Object.values(x).reduce((a, y) => { const r = medir(y, prof + 1); return { folhas: a.folhas + r.folhas, prof: Math.max(a.prof, r.prof) }; }, { folhas: 0, prof });
    return { folhas: 1, prof };
  }

  /* ── EXPORTAR ─────────────────────────────────────────────────────────── */
  function exportar(config, catalogo, versaoCratos, agoraIso) {
    const efetivo = {};
    for (const c of campos(catalogo)) {
      const salvo = ler(config, c);
      const r = salvo === undefined ? null : conferir(c, salvo);
      if (r && r.ok) gravar(efetivo, c, r.v);
      else if (c.esp.padrao !== undefined) {
        const p = conferir(c, JSON.parse(JSON.stringify(c.esp.padrao)));
        if (p.ok) gravar(efetivo, c, p.v);
      }
    }
    return {
      formato: FORMATO,
      versaoFormato: VERSAO_FORMATO,
      versaoCratos: String(versaoCratos || ""),
      geradoEm: String(agoraIso || new Date().toISOString()),
      aviso: "Preferências do CRATOS. Só opções de configuração: nenhum dado de processo ou de parte.",
      configuracoes: efetivo,
    };
  }
  const nomeArquivo = (agora) => {
    const d = agora && typeof agora.getFullYear === "function" && !isNaN(agora) ? agora : new Date();   // sem instanceof: Date de outro contexto
    const p = (n) => String(n).padStart(2, "0");
    return `CRATOS-configuracoes-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
  };

  /* ── LER O ARQUIVO ────────────────────────────────────────────────────── */
  /* texto do arquivo → { ok, aceitos, descartados[], versaoCratos, geradoEm } | { ok:false, motivo } */
  function ler_(textoArquivo, catalogo) {
    const s = String(textoArquivo == null ? "" : textoArquivo);
    if (!s.trim()) return { ok: false, motivo: "o arquivo está vazio" };
    if (s.length > TAMANHO_MAX) return { ok: false, motivo: `o arquivo é maior que ${TAMANHO_MAX / 1024} KB — não é um arquivo de configurações do CRATOS` };
    let j;
    try { j = JSON.parse(s); } catch (e) { return { ok: false, motivo: "o arquivo não é um arquivo de configurações do CRATOS (não é JSON)" }; }
    if (!ehObj(j) || j.formato !== FORMATO) return { ok: false, motivo: "o arquivo não é um arquivo de configurações do CRATOS" };
    if (j.versaoFormato !== VERSAO_FORMATO) return { ok: false, motivo: `formato ${String(j.versaoFormato).slice(0, 10)} não suportado por esta versão do CRATOS` };
    const extras = Object.keys(j).filter((k) => ["formato", "versaoFormato", "versaoCratos", "geradoEm", "aviso", "configuracoes"].indexOf(k) < 0);
    if (extras.length) return { ok: false, motivo: "o arquivo tem campos que o CRATOS não reconhece — foi alterado fora do CRATOS" };
    const cfg = j.configuracoes;
    if (!ehObj(cfg)) return { ok: false, motivo: "o arquivo não traz configurações" };
    const m = medir(cfg, 0);
    if (m.folhas > CHAVES_MAX || m.prof > PROFUNDIDADE_MAX) return { ok: false, motivo: "estrutura do arquivo fora do padrão" };

    const lista = campos(catalogo);
    const aceitos = {};
    const descartados = [];
    const conhecido = new Set(lista.map(nomeDe));
    /* o que o arquivo traz e o CRATOS não conhece */
    for (const [mod, v] of Object.entries(cfg)) {
      if (!ehObj(v) || !lista.some((c) => c.mod === mod)) { descartados.push({ nome: mod, motivo: "convênio desconhecido" }); continue; }
      for (const [k, x] of Object.entries(v)) {
        if (ehObj(x) && lista.some((c) => c.mod === mod && c.grupo === k)) {
          for (const k2 of Object.keys(x)) if (!conhecido.has(`${mod}.${k}.${k2}`)) descartados.push({ nome: `${mod}.${k}.${k2}`, motivo: "opção desconhecida" });
        } else if (!conhecido.has(`${mod}.${k}`)) descartados.push({ nome: `${mod}.${k}`, motivo: "opção desconhecida" });
      }
    }
    for (const c of lista) {
      const bruto = ler(cfg, c);
      if (bruto === undefined) continue;
      const r = conferir(c, bruto);
      if (r.ok) gravar(aceitos, c, r.v);
      else descartados.push({ nome: nomeDe(c), rotulo: `${c.rotuloMod} → ${c.rotuloCampo}`, motivo: r.motivo });
    }
    const vc = typeof j.versaoCratos === "string" && /^\d{1,3}(\.\d{1,3}){1,3}$/.test(j.versaoCratos) ? j.versaoCratos : "";
    const ge = typeof j.geradoEm === "string" && !isNaN(Date.parse(j.geradoEm)) && j.geradoEm.length <= 40 ? j.geradoEm : "";
    return { ok: true, aceitos, descartados: descartados.map((d) => ({ nome: String(d.nome).slice(0, 80), rotulo: d.rotulo, motivo: d.motivo })), versaoCratos: vc, geradoEm: ge };
  }

  /* ── APLICAR e DIFERENÇAS ─────────────────────────────────────────────── */
  function aplicar(atual, aceitos, catalogo, opts) {
    const novo = JSON.parse(JSON.stringify(ehObj(atual) ? atual : {}));
    const manter = !!(opts && opts.manterLotacao);
    for (const c of campos(catalogo)) {
      const v = ler(aceitos, c);
      if (v === undefined) continue;
      if (manter && !c.grupo && ehLotacao(c.mod, c.chave)) continue;
      gravar(novo, c, JSON.parse(JSON.stringify(v)));
    }
    return novo;
  }
  function mostrar(c, v) {
    const esp = c.esp;
    if (v === undefined || v === null || v === "") return "(em branco)";
    if (esp.tipo === "toggle") return v.ativo ? "sim" : "não";
    if (esp.tipo === "toggle_anos") return v.ativo ? `sim, ${v.anos} ano${v.anos === 1 ? "" : "s"}` : "não";
    if (esp.tipo === "multiselect") return v.length ? v.join(", ") : "(nenhum)";
    if (esp.tipo === "escolha" || esp.tipo === "select" || esp.tipo === "lista") {
      const o = (esp.opcoes || []).find((x) => String(valorDe(x)) === String(v));
      return o ? String(rotuloDe(o)) : String(v);
    }
    return String(v);
  }
  /* [{ modulo, campo, de, para, lotacao }] — só o que muda de fato */
  function diferencas(atual, novo, catalogo) {
    const out = [];
    for (const c of campos(catalogo)) {
      const a = ler(atual, c), n = ler(novo, c);
      const ea = a === undefined ? c.esp.padrao : a, en = n === undefined ? c.esp.padrao : n;
      if (JSON.stringify(ea) === JSON.stringify(en)) continue;
      out.push({ modulo: c.rotuloMod, campo: c.rotuloCampo, de: mostrar(c, ea), para: mostrar(c, en), lotacao: !c.grupo && ehLotacao(c.mod, c.chave) });
    }
    return out;
  }
  /* O arquivo traz dados de lotação DIFERENTES dos meus? (para mostrar a opção) */
  function lotacaoDiferente(atual, aceitos, catalogo) {
    return campos(catalogo).some((c) => !c.grupo && ehLotacao(c.mod, c.chave) && ler(aceitos, c) !== undefined &&
      JSON.stringify(ler(aceitos, c)) !== JSON.stringify(ler(atual, c) === undefined ? c.esp.padrao : ler(atual, c)));
  }

  globalThis.CratosConfigIO = {
    FORMATO, VERSAO_FORMATO, TAMANHO_MAX, TEXTO_MAX, LOTACAO,
    exportar, nomeArquivo, ler: ler_, aplicar, diferencas, lotacaoDiferente, campos,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = globalThis.CratosConfigIO;
})();
