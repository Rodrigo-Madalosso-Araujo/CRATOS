/*
 * modulos/disponibilidade.js — certidão de INDISPONIBILIDADE de sistema conveniado (1.9.0).
 *
 * Pedido do Rodrigo (21/10), desenho aprovado em 22/10. É certidão de ESTADO, não de
 * resultado — e só com confirmação humana. Regra de ferro: falha do próprio CRATOS
 * (sessão, rede da vara, tela não reconhecida, bug) NÃO vira certidão; continua na faixa.
 *
 * MEDIÇÃO (`medir`): até 3 tentativas, com 10 s de intervalo, ao endereço de entrada do
 * convênio — só endereços que o CRATOS já tem permissão de acessar (nada novo no
 * manifest). Cada tentativa anota hora, código e mensagem.
 *   - conta como FALHA só sinal inequívoco: HTTP 502/503/504, sem conexão, sem resposta
 *     em 15 s;
 *   - qualquer outra resposta (200, redirecionamento para o login, 401/403, 404, 500…)
 *     = o sistema RESPONDEU → nada a certificar (500/401/403/404 seguem na faixa);
 *   - se as 3 falharem, testa o PJe (CONTROLE). PJe também fora = pode ser a rede da
 *     unidade → NÃO certifica.
 * Sem print de tela: exigiria permissão mais ampla (a STI repara).
 * Sem cookies (credentials: "omit") e sem seguir redirecionamento (redirect: "manual"):
 * a medição não toca em sessão nem em outro domínio.
 *
 * Limitação conhecida: há sistema que responde a página inicial e falha só depois do
 * login — aí a medição diz "respondeu". O sinal da própria operação é o mais confiável.
 */

const DISPONIBILIDADE_ALVOS = {
  INFOJUD: { rotulo: "e-CAC da Receita Federal (INFOJUD)", url: "https://cav.receita.fazenda.gov.br/ecac/" },
  RENAJUD: { rotulo: "RENAJUD", url: "https://renajud.pdpj.jus.br/" },
  CNIB: { rotulo: "CNIB (Central Nacional de Indisponibilidade de Bens)", url: "https://indisponibilidade.onr.org.br/" },
  CENSEC: { rotulo: "CENSEC", url: "https://www.censec.org.br/" },
  SERASAJUD: { rotulo: "SerasaJUD", url: "https://serasa-judicial.serasaexperian.com.br/" },
  CCS: { rotulo: "CCS (Cadastro de Clientes do Sistema Financeiro — Bacen)", url: "https://www3.bcb.gov.br/ccs/" },
  SNIPER: { rotulo: "SNIPER", url: "https://sniper.pdpj.jus.br/" },
  PREVJUD: { rotulo: "PREVJUD", url: "https://previdenciario.pdpj.jus.br/" },
};
const DISPONIBILIDADE_CONTROLE = "https://pje.trt18.jus.br/pjekz/";

const ModuloDisponibilidade = {
  io: {
    fetch: (u, o) => fetch(u, o),
    esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
    agora: () => Date.now(),
  },
  /* 1.9.0 (revisão de segurança): as medições ficam AQUI, no fundo. A certidão só sai de
     uma medição que o próprio fundo fez — o painel manda só o identificador dela. */
  _medicoes: new Map(),
  VALIDADE_MEDICAO_MS: 24 * 60 * 60 * 1000,
  novoId() {
    try { if (globalThis.crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID(); } catch (e) { /* nada */ }
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
  },
  TENTATIVAS: 3,
  INTERVALO_MS: 10 * 1000,
  TEMPO_LIMITE_MS: 15 * 1000,

  async sondar(url) {
    const hora = new Date(this.io.agora()).toISOString();
    let ctl = null, tm = null;
    try {
      ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
      if (ctl) tm = setTimeout(() => { try { ctl.abort(); } catch (e) { /* nada */ } }, this.TEMPO_LIMITE_MS);
      const r = await this.io.fetch(url, { method: "GET", cache: "no-store", credentials: "omit", redirect: "manual",
        signal: ctl ? ctl.signal : undefined });
      if (r.type === "opaqueredirect" || (r.status >= 300 && r.status < 400)) {
        return { hora, codigo: r.status || null, mensagem: "respondeu (redirecionou para outra página)", falhou: false };
      }
      const falhou = r.status === 502 || r.status === 503 || r.status === 504;
      const txt = String(r.statusText || "").trim();
      return { hora, codigo: r.status, mensagem: `HTTP ${r.status}${txt ? " " + txt : ""}`, falhou };
    } catch (e) {
      const tempo = e && e.name === "AbortError";
      return { hora, codigo: null, falhou: true,
        mensagem: tempo ? `sem resposta em ${Math.round(this.TEMPO_LIMITE_MS / 1000)} segundos` : "falha de conexão (o servidor não respondeu)" };
    } finally {
      if (tm) clearTimeout(tm);
    }
  },

  async medir(convenioId) {
    const id = String(convenioId || "").toUpperCase();
    const alvo = DISPONIBILIDADE_ALVOS[id];
    if (!alvo) return { ok: false, motivo: `Não há verificação de disponibilidade para "${convenioId}".` };
    const tentativas = [];
    for (let i = 0; i < this.TENTATIVAS; i++) {
      if (i) await this.io.esperar(this.INTERVALO_MS);
      const t = await this.sondar(alvo.url);
      tentativas.push(t);
      if (!t.falhou) break;                       // respondeu: não insiste
    }
    const todasFalharam = tentativas.every((t) => t.falhou);
    let controle = null;
    if (todasFalharam) {
      const c = await this.sondar(DISPONIBILIDADE_CONTROLE);
      controle = Object.assign(c, { ok: !c.falhou && !(c.codigo >= 500) });
    }
    const conclusao = !todasFalharam ? "respondeu" : (controle && controle.ok ? "indisponivel" : "controle_falhou");
    let host = alvo.url;
    try { host = new URL(alvo.url).host; } catch (e) { /* nada */ }
    const m = { ok: true, id: this.novoId(), convenio: id, rotulo: alvo.rotulo, url: alvo.url, host, tentativas, controle, conclusao,
      medidoEm: new Date(this.io.agora()).toISOString() };
    const limite = this.io.agora() - this.VALIDADE_MEDICAO_MS;
    for (const [k, v] of this._medicoes) if (Date.parse(v.medidoEm) < limite) this._medicoes.delete(k);
    this._medicoes.set(m.id, JSON.parse(JSON.stringify(m)));
    return m;
  },

  /* Relato OBJETIVO, sem afirmar causa. `origem`: "fila" (detectado durante a execução)
     ou "botao" (verificação pedida). A confirmação é sempre do(a) responsável. */
  linhasCertidao(m, ctx) {
    const p2 = (n) => String(n).padStart(2, "0");
    const d = (iso) => new Date(iso);
    const data = (iso) => `${p2(d(iso).getDate())}/${p2(d(iso).getMonth() + 1)}/${d(iso).getFullYear()}`;
    const hms = (iso) => `${p2(d(iso).getHours())}:${p2(d(iso).getMinutes())}:${p2(d(iso).getSeconds())}`;
    const ts = m.tentativas || [];
    const ini = ts[0].hora, fim = ts[ts.length - 1].hora;
    const L = ["",
      `Certifico e dou fé que, em ${data(ini)}, no processo nº ${ctx.numProcesso}, ao tentar realizar diligência ` +
      `pelo sistema conveniado ${m.rotulo}, este não estava disponível.`,
      "",
      `Foram feitas ${ts.length} tentativa(s) de acesso ao endereço ${m.host}` +
      (ts.length > 1 ? `, entre ${hms(ini)} e ${hms(fim)},` : `, às ${hms(ini)},`) + " com o seguinte retorno:",
    ];
    for (const t of ts) L.push(`   - ${hms(t.hora)}: ${t.mensagem}.`);
    if (m.controle) L.push("", `Na mesma ocasião (${hms(m.controle.hora)}), o PJe deste Tribunal respondeu normalmente (verificação de controle).`);
    L.push("", ctx.origem === "fila"
      ? "A indisponibilidade foi detectada pelo CRATOS durante a execução dos convênios e confirmada pelo(a) responsável por este ato."
      : "A verificação foi feita pelo CRATOS, a pedido do(a) responsável por este ato, que confirmou o resultado.");
    L.push("", `A diligência no ${m.rotulo} deverá ser repetida oportunamente.`);
    L.push("", "Era o que me cumpria certificar.");
    return L;
  },

  /* Gera a certidão — só para medição que concluiu "indisponivel". */
  async certidao(msg, fabricar) {
    const m = msg && msg.idMedicao ? this._medicoes.get(String(msg.idMedicao)) : null;
    if (!m) return { ok: false, motivo: "Medição não encontrada (ou com mais de 24 horas). Verifique a disponibilidade de novo." };
    const num = String((msg && msg.numProcesso) || "").replace(/\D/g, "");
    if (!m || m.conclusao !== "indisponivel" || !(m.tentativas || []).length) {
      return { ok: false, motivo: "A medição não concluiu indisponibilidade; nada a certificar." };
    }
    if (num.length !== 20) return { ok: false, motivo: "Sem número de processo para a certidão." };
    const pasta = String((msg && msg.pasta) || "CRATOS").replace(/[\\:*?"<>|]/g, "").trim() || "CRATOS";
    const filename = `${pasta}/${num}_${m.convenio} indisponibilidade certidao.pdf`;
    const linhas = this.linhasCertidao(m, { numProcesso: msg.numProcesso, origem: msg.origem });
    return fabricar({
      titulo: "CERTIDÃO — INDISPONIBILIDADE DE SISTEMA CONVENIADO",
      linhas, filename, numProcesso: msg.numProcesso, convenio: m.convenio, operacao: "indisponibilidade", detalhe: "certidao",
    });
  },
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = { ModuloDisponibilidade, DISPONIBILIDADE_ALVOS, DISPONIBILIDADE_CONTROLE };
}
