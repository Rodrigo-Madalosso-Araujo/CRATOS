/*
 * teste-cnib.js — harness de verificação do conteudo/cnib.js num DOM falso que
 * imita o CNIB 2.0, incluindo as duas maldades reais:
 *   (a) comportamento Blazor: o "servidor" reescreve o .value a partir do modelo,
 *       e o modelo só é atualizado quando chega um evento 'change'. Quem escrever
 *       sem disparar evento vê o valor sumir — igual ao CNIB de verdade.
 *   (b) o campo de CPF/CNPJ NÃO é limpo depois de incluir.
 * Também: ids invertidos do KnowValue, botão de incluir só com ícone,
 * wizard de 5 passos na mesma URL, e o overlay de reconexão.
 *
 * Rodar: node teste-cnib.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

/* Antes, os caminhos eram relativos ao diretório de onde se chamava o node —
   rodar de dentro de testes/ derrubava a suíte com ENOENT antes da primeira
   asserção, e um crash não é uma reprovação: não diz nada sobre o código. */
const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");

const falhas = [];
const oks = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }

// ── DOM do passo 1 ──────────────────────────────────────────────────────────
const PASSO1 = `
<div class="form-group">
  <div class="form-check form-check-inline">
    <input type="radio" id="inlineRadio1" name="TypeNumberProcess" value="true" checked>
    <label class="form-check-label" for="inlineRadio1">Padronizado</label>
  </div>
  <div class="form-check form-check-inline">
    <input type="radio" id="inlineRadio2" name="TypeNumberProcess" value="false">
    <label class="form-check-label" for="inlineRadio2">Outros</label>
  </div>
  <input type="text" id="numberProcess1blazor" class="numberProcess1blazor form-control">
  <input type="text" id="numberProcess2blazor" class="form-control" value="5.18">
  <input type="text" id="numberProcess3blazor" class="form-control">
  <select id="InputNomeProcesso" class="form-control">
    <option value="">(Selecione)</option>
    <option value="1">Processo de execução judicial ou cumprimento de sentença</option>
    <option value="2">Demais processos</option>
  </select>
  <!-- ATENÇÃO: ids invertidos de propósito, como no CNIB real -->
  <div class="form-check form-check-inline">
    <input type="radio" id="hasKnownDebit" name="KnowValue" value="option1" checked>
    <label class="form-check-label" for="hasKnownDebit">Não</label>
  </div>
  <div class="form-check form-check-inline">
    <input type="radio" id="hasntKnownDebit" name="KnowValue" value="option2">
    <label class="form-check-label" for="hasntKnownDebit">Sim</label>
  </div>
  <div class="input-group w-100">
    <input type="text" id="txtCpfCnpjInputPerson" class="form-control h-100 w-75">
    <div class="input-group-append ml-4"><span class="btn-add-person"><svg></svg></span></div>
  </div>
  <table><thead><tr><th>Nome ou Razão Social</th><th>CPF ou CNPJ</th><th>Ações</th></tr></thead>
    <tbody></tbody></table>
  <div class="form-check form-check-inline">
    <input type="radio" id="SecretJusticeNo" name="SecretJustice" value="false" checked>
    <label class="form-check-label" for="SecretJusticeNo">Não</label>
  </div>
  <div class="form-check form-check-inline">
    <input type="radio" id="SecretJusticeYes" name="SecretJustice" value="true">
    <label class="form-check-label" for="SecretJusticeYes">Sim</label>
  </div>
  <input type="submit" id="btnConfirm" class="btn btn-primary" value="Confirmar">
</div>`;

const PASSO2 = `
<div><table><thead><tr><th></th><th>Nome / Razão Social</th><th>CPF / CNPJ</th></tr></thead>
  <tbody><tr><td><input type="checkbox" checked></td><td>FULANO</td><td>111</td></tr></tbody></table>
  <button class="btn btn-secondary">Voltar</button>
  <button class="btn btn-primary">Pesquisar Estado(s) Selecionado(s)</button>
  <div class="btnActionOrderGeneric">
    <button class="btn btn-primary">Continuar para indisponibilidade genérica</button>
  </div></div>`;

const PASSO4 = `
<div>
  <div class="form-check form-check-inline">
    <input type="radio" id="isPriorityOrder" name="priorityOrder" value="true">
    <label class="form-check-label" for="isPriorityOrder">Sim</label>
  </div>
  <div class="form-check form-check-inline">
    <input type="radio" id="isNotPriorityOrder" name="priorityOrder" value="false" checked>
    <label class="form-check-label" for="isNotPriorityOrder">Não</label>
  </div>
  <input type="button" class="btn btn-secondary" value="Voltar">
  <input type="submit" class="btn btn-primary" value="Enviar Indisponibilidade">
</div>`;

const PASSO5 = `
<div><h4>Ordem Enviada com Sucesso</h4>
  <button class="btn btn-out-line-orn">Ver Detalhes do Protocolo IA</button>
  <div class="modal" id="detalhe" style="display:none"><button class="btn btn-primary">Imprimir</button></div>
</div>`;

async function rodar(cenario) {
  const dom = new JSDOM(
    `<!doctype html><html><body><div id="app">${PASSO1}</div></body></html>`,
    { url: "https://indisponibilidade.onr.org.br/ordem/cadastro", pretendToBeVisual: true,
      runScripts: "outside-only" }
  );
  const { window } = dom;
  const doc = window.document;

  // jsdom não faz layout: getBoundingClientRect volta zerado e o visivel() do
  // módulo rejeitaria tudo. Damos dimensão a quem não está com display:none.
  window.Element.prototype.getBoundingClientRect = function () {
    let el = this;
    while (el) {
      if (el.style && el.style.display === "none") return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
      el = el.parentElement;
    }
    return { width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20 };
  };

  // ── simulação do Blazor Server ────────────────────────────────────────────
  // O modelo do "servidor" só aprende o valor via evento; e o servidor
  // re-renderiza periodicamente, sobrescrevendo o .value pelo modelo.
  const modelo = new Map();
  const blazorizar = (el) => {
    if (!el || el.__blz) return;
    el.__blz = true;
    modelo.set(el.id, el.value || "");
    el.addEventListener("change", () => modelo.set(el.id, el.value));
    if (cenario.blazorAceitaInput) el.addEventListener("input", () => modelo.set(el.id, el.value));
  };
  const rerender = () => {
    for (const el of doc.querySelectorAll("input[type=text]")) {
      blazorizar(el);
      const m = modelo.get(el.id);
      if (m !== undefined && el.value !== m) el.value = m;   // servidor manda
    }
  };
  doc.querySelectorAll("input[type=text]").forEach(blazorizar);
  const tickServidor = setInterval(rerender, 120);

  let linhasNoConfirmar = null;   // foto no instante do Confirmar

  // botão de incluir: adiciona a linha e NÃO limpa o campo (como o CNIB real)
  let cliquesAdd = 0;
  doc.querySelector(".btn-add-person").addEventListener("click", () => {
    cliquesAdd++;
    const campo = doc.querySelector("#txtCpfCnpjInputPerson");
    const d = String(campo.value || "").replace(/\D/g, "");
    if (cenario.recusaTudo) return;                                           // CNIB recusa sempre
    if (cenario.exigeFormatado && !/[.\-/]/.test(campo.value || "")) return;  // recusa dígitos crus
    if (d.length !== 11 && d.length !== 14) return;
    const tb = doc.querySelector("tbody");
    const tr = doc.createElement("tr");
    tr.innerHTML = `<td>PARTE ${tb.children.length + 1}</td><td>${campo.value}</td>` +
      `<td><i class="bi bi-trash text-danger"></i></td>`;
    tb.appendChild(tr);
    // de propósito: o campo continua preenchido
  });

  const trocarPasso = (html) => { doc.getElementById("app").innerHTML = html; };
  doc.querySelector("#btnConfirm").addEventListener("click", () => {
    linhasNoConfirmar = doc.querySelectorAll("tbody tr").length;
    if (cenario.travaConfirmar) return;
    setTimeout(() => {
      trocarPasso(PASSO2);
      doc.querySelector(".btnActionOrderGeneric button").addEventListener("click", () => {
        setTimeout(() => {
          trocarPasso(PASSO4);
          if (cenario.enviaDepois) {
            setTimeout(() => {
              trocarPasso(PASSO5);
              doc.querySelector("button.btn-out-line-orn").addEventListener("click", () => {
                doc.querySelector("#detalhe").style.display = "block";
              });
              doc.querySelector("#detalhe .btn-primary").addEventListener("click", () => {
                dom.__imprimiu = doc.title;
              });
            }, 4000);
          }
        }, 400);
      });
    }, 200);
  });

  // overlay de reconexão, se o cenário pedir
  if (cenario.quedaMs) {
    setTimeout(() => {
      const o = doc.createElement("div");
      o.innerHTML = `<p>Houve falha na conexão com a internet. Estamos tentando reestabelecer a conexão com ao servidor....</p>
        <input type="button" id="btnWaitReconnect" value="Aguardar 🔄">`;
      o.id = "overlay";
      doc.body.appendChild(o);
      setTimeout(() => { const x = doc.getElementById("overlay"); if (x) x.remove(); }, cenario.quedaMs);
    }, cenario.quedaEm || 1500);
  }

  // ── ambiente da extensão ──────────────────────────────────────────────────
  const guardado = {};
  window.browser = {
    storage: {
      local: {
        get: async (k) => ({ [k]: guardado[k] }),
        set: async (o) => Object.assign(guardado, o),
        remove: async (k) => { delete guardado[k]; },
      },
      onChanged: { addListener() {}, removeListener() {} },
    },
    runtime: { sendMessage: async () => ({ ok: true }) },
  };
  guardado["cratos:cnib_estado"] = cenario.estado;

  const registros = [];
  for (const m of ["log", "warn", "error"]) {
    window.console[m] = (...a) => registros.push(a.map(String).join(" "));
  }

  // A cada troca de passo o DOM é substituído e a tabela do passo 1 some.
  // Então acompanhamos ao vivo o MÁXIMO de linhas e os documentos vistos.
  let maxLinhas = 0;
  const docsVistos = new Set();
  const espiao = setInterval(() => {
    for (const t of doc.querySelectorAll("table")) {
      const ths = Array.from(t.querySelectorAll("th")).map((x) => x.textContent.toLowerCase());
      const idx = ths.findIndex((h) => h.includes("cpf"));
      if (idx < 0) continue;
      const trs = t.querySelectorAll("tbody tr");
      if (trs.length > maxLinhas) maxLinhas = trs.length;
      for (const tr of trs) {
        const c = tr.children[idx];
        const d = c ? c.textContent.replace(/\D/g, "") : "";
        if (d.length === 11 || d.length === 14) docsVistos.add(d);
      }
    }
  }, 150);

  const rodarNoDom = (arquivo) => {
    const src = fs.readFileSync(arquivo, "utf8");
    window.eval(src);
  };
  rodarNoDom(path.join(SRC, "comum", "storage.js"));
  rodarNoDom(path.join(SRC, "comum", "relatorio.js"));
  rodarNoDom(path.join(SRC, "comum", "faixa.js"));
  rodarNoDom(path.join(SRC, "conteudo", "cnib.js"));

  const limite = cenario.espera || 30000;
  const t0 = Date.now();
  while (Date.now() - t0 < limite) {
    await new Promise((r) => setTimeout(r, 250));
    const acabou = dom.__imprimiu ||
      (guardado["cratos:cnib_estado"] && guardado["cratos:cnib_estado"].fase === "erro") ||
      (!cenario.enviaDepois && registros.join("\n").includes("ordem PREPARADA"));
    if (acabou) { await new Promise((r) => setTimeout(r, 600)); break; }
  }
  clearInterval(tickServidor);
  clearInterval(espiao);

  const linhas = Array.from(doc.querySelectorAll("tbody tr"))
    .map((tr) => (tr.children[1] ? tr.children[1].textContent : ""));

  return { doc, registros, linhas, maxLinhas, linhasNoConfirmar, docsVistos: Array.from(docsVistos),
           cliquesAdd, estadoFinal: guardado["cratos:cnib_estado"], dom, window };
}

const ESTADO_BASE = {
  ativo: true, operacao: "inclusao",
  numProcesso: "0000003-14.2024.5.18.0008",
  numeroDigitos: "00000031420245180008",
  executados: [
    { nome: "SERVICOS EXEMPLO LTDA", cpfcnpj: "12345678000199" },
    { nome: "ENERGIA EXEMPLO LTDA", cpfcnpj: "98765432000111" },
  ],
  segredo: false,
  config: {
    informarValor: false, valor: null,
    nomeProcesso: "Processo de execução judicial ou cumprimento de sentença",
    priorizarPrenotacao: false,
  },
  abertoEm: new Date().toISOString(),
};

(async () => {
  console.log("═══ 1. Caminho feliz (Blazor só aceita 'change') ═══");
  let r = await rodar({ estado: JSON.parse(JSON.stringify(ESTADO_BASE)), enviaDepois: true, espera: 40000 });
  const d = r.doc;
  checar(r.maxLinhas === 2, `2 executados na tabela (max visto: ${r.maxLinhas})`);
  checar(r.docsVistos.length === 2, `documentos distintos incluídos: ${r.docsVistos.join(", ")}`);
  checar(r.cliquesAdd === 2, `clicou 'incluir' exatamente 2x (foi ${r.cliquesAdd})`);
  checar(/ordem enviada com sucesso/i.test(d.body.textContent), "chegou ao passo 5");
  checar(/CNIB Inclusao/.test(r.dom.__imprimiu || ""), `título forçado antes de imprimir: "${r.dom.__imprimiu}"`);
  checar(r.estadoFinal && r.estadoFinal.ativo === false, "estado encerrado ao fim");

  if (process.env.DEBUG1) { console.log("--- LOG cenario 1 ---"); r.registros.slice(-18).forEach((l)=>console.log("   ",l)); console.log("   title:", r.doc.title, "| imprimiu:", r.dom.__imprimiu, "| estado:", JSON.stringify(r.estadoFinal && {ativo:r.estadoFinal.ativo, fase:r.estadoFinal.fase})); process.exit(0); }
  console.log("═══ 2. Ids invertidos + segredo + nº do processo ═══");
  const est2 = JSON.parse(JSON.stringify(ESTADO_BASE));
  est2.segredo = true;
  est2.config.informarValor = true;
  est2.config.valor = "1.234,56";
  r = await rodar({ estado: est2, espera: 40000 });
  const d2 = r.doc;
  // o passo 1 já trocou? se sim, pegamos do log
  const logProc = r.registros.join("\n");
  checar(/KnowValue = "Sim" \(id real: hasntKnownDebit\)/.test(logProc),
    "marcou 'Sim' do valor pelo RÓTULO (id real invertido: hasntKnownDebit)");
  checar(/SecretJustice = "Sim" \(id real: SecretJusticeYes\)/.test(logProc),
    "marcou segredo de justiça = Sim");
  checar(/2 executado\(s\) na ordem/.test(logProc), "os 2 executados entraram");

  console.log("═══ 3. Campo exige documento FORMATADO (fallback) ═══");
  r = await rodar({ estado: JSON.parse(JSON.stringify(ESTADO_BASE)), exigeFormatado: true, espera: 90000 });
  checar(r.maxLinhas === 2, `fallback formatado incluiu os 2 (max visto: ${r.maxLinhas})`);
  checar(/tentando formatado/.test(r.registros.join("\n")), "registrou a tentativa com documento formatado");

  console.log("═══ 4. Queda de conexão no meio do laço ═══");
  r = await rodar({
    estado: JSON.parse(JSON.stringify(ESTADO_BASE)),
    quedaEm: 1200, quedaMs: 4000, espera: 60000,
  });
  const log4 = r.registros.join("\n");
  checar(/automação CONGELADA/.test(log4), "congelou durante a queda");
  checar(/reconectado — retomando/.test(log4), "retomou depois da reconexão");
  checar(r.maxLinhas === 2, `terminou os 2 executados apesar da queda (max visto: ${r.maxLinhas})`);
  checar(r.cliquesAdd === 2, `sem clique duplicado no incluir (foi ${r.cliquesAdd})`);

  console.log("═══ 5. CNIB recusa o executado → aborta e NÃO monta ordem incompleta ═══");
  r = await rodar({ estado: JSON.parse(JSON.stringify(ESTADO_BASE)), recusaTudo: true, espera: 60000 });
  const log5 = r.registros.join("\n");
  checar(/PAREI/.test(log5), "abortou com mensagem explícita");
  checar(/não entrou na lista/.test(log5), "disse QUAL executado não entrou");
  checar(r.maxLinhas === 0, `nenhum executado entrou (max visto: ${r.maxLinhas})`);
  checar(!/Continuar para indisponibilidade/.test(r.doc.body.textContent),
    "NÃO avançou para o passo 2 com a ordem incompleta");
  checar(r.estadoFinal && r.estadoFinal.fase === "erro", "gravou fase=erro no estado");

  console.log("\n──────── RESULTADO ────────");
  for (const o of oks) console.log("  ✓", o);
  for (const f of falhas) console.log("  ✗", f);
  console.log(`\n${oks.length} passaram, ${falhas.length} falharam`);
  process.exit(falhas.length ? 1 : 0);
})();