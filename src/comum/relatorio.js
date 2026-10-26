/*
 * comum/relatorio.js — o relatório de problema que o beta-tester manda para o
 * Rodrigo.
 *
 * O PROBLEMA QUE ELE RESOLVE: por melhor que seja a mensagem de erro, ela não
 * diz POR QUE quebrou. Sem o rastro, diagnosticar exige reproduzir — e quem
 * reproduz é quem tem o processo na mão, não quem escreve o código.
 *
 * A TRAVA DE DESENHO: o cartão "Sobre o CRATOS" promete "não tem servidor, nem
 * telemetria". Se a extensão passasse a mandar log sozinha, esse texto viraria
 * mentira — e é o texto que a pessoa lê antes de instalar. Então NADA sai
 * daqui por conta própria: o relatório é baixado como arquivo, mostrado antes,
 * e quem envia é o usuário, por e-mail ou chat, como qualquer anexo.
 *
 * O QUE É MASCARADO (decisão do Rodrigo, 19/08):
 *   · CPF/CNPJ  -> só os dois últimos dígitos sobrevivem, o bastante para
 *                  distinguir duas partes no log sem identificar ninguém;
 *   · nomes das partes -> iniciais;
 *   · número do processo -> **fica inteiro, de propósito**. É o que permite
 *     ao Rodrigo abrir o mesmo processo e reproduzir o erro com você.
 *
 * Como as partes vêm do estado que o próprio CRATOS gravou, eu SEI os nomes e
 * documentos exatos — mascarar é substituição literal, não adivinhação por
 * expressão regular em texto solto. É por isso que a máscara também limpa o
 * rastro de passos, onde os nomes aparecem no meio da frase.
 */
if (typeof globalThis.CratosRelatorio === "undefined") {

  const MAX_PASSOS = 30;

  const CratosRelatorio = {
    _passos: [],

    /* Toda mensagem que aparece na tela passa pela faixa, então a faixa é o
       ponto onde o rastro se registra sozinho. Sem instrumentar fluxo nenhum. */
    registrar(modulo, texto, nivel) {
      try {
        /* 1.9.0: hora LOCAL, como o cabeçalho "Quando". Antes saía em UTC (toISOString):
           o relatório de 23/10 dizia 18:13 num problema das 15:13. */
        const d = new Date(), p2 = (n) => String(n).padStart(2, "0");
        this._passos.push({
          t: p2(d.getHours()) + ":" + p2(d.getMinutes()) + ":" + p2(d.getSeconds()),
          m: String(modulo || ""),
          n: nivel || "info",
          x: String(texto || ""),
        });
        if (this._passos.length > MAX_PASSOS) this._passos.shift();
      } catch (e) { /* rastro é melhor-esforço: nunca atrapalha o fluxo */ }
    },

    /* ── MÁSCARA ───────────────────────────────────────────────────────────
       `segredos` é a lista de pares [literal, substituto] extraída do estado.
       Aplicada do maior para o menor: "MARIA DA SILVA LTDA" tem de ser trocada
       antes de "MARIA", senão sobra pedaço. */
    _mascarar(texto, segredos) {
      let s = String(texto == null ? "" : texto);
      /* ORDENAR AQUI É O QUE FAZ A MÁSCARA FUNCIONAR, e eu tinha esquecido: o
         credor "MARIA" vinha antes de "MARIA DA SILVA SAUROS LTDA" no estado, era
         trocado primeiro, e sobrava "M. DA SILVA SAUROS LTDA" no arquivo — nome
         de terceiro vazando por ordem de iteração. Do maior para o menor. */
      const ordenados = segredos.slice().sort((a, b) => String(b[0]).length - String(a[0]).length);
      for (const [de, para] of ordenados) {
        if (!de) continue;
        s = s.split(de).join(para);
      }
      /* Rede de segurança para documento que escapou da lista (veio digitado na
         tela, por exemplo). O \b impede que o número do processo — 20 dígitos —
         seja atingido: ele não casa com \d{11} nem com \d{14} inteiros. */
      s = s.replace(/\b(\d{3})\.(\d{3})\.(\d{3})-(\d{2})\b/g, "***.***.***-$4");
      s = s.replace(/\b(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})-(\d{2})\b/g, "**.***.***/****-$5");
      s = s.replace(/\b\d{9}(\d{2})\b/g, "*********$1");
      s = s.replace(/\b\d{12}(\d{2})\b/g, "************$1");
      return s;
    },

    /* Sufixo societário e conectivo ficam inteiros: "M. DA S. LTDA" diz que é
       pessoa jurídica, e saber se o campo recebeu PF ou PJ é metade do
       diagnóstico. Não identificam ninguém sozinhos. */
    _MANTER: ["LTDA", "ME", "EPP", "SA", "S/A", "EIRELI", "CIA", "MEI", "LTDA.", "S.A."],

    _iniciais(nome) {
      const partes = String(nome || "").trim().split(/\s+/).filter(Boolean);
      if (!partes.length) return "[parte]";
      return partes
        .map((p) => (p.length <= 2 || this._MANTER.includes(p.toUpperCase()) ? p : p[0] + "."))
        .join(" ");
    },

    _docCurto(doc) {
      const d = String(doc || "").replace(/\D/g, "");
      if (d.length < 3) return "[doc]";
      return "*".repeat(d.length - 2) + d.slice(-2);
    },

    /* Varre o estado atrás de nome/cpfcnpj, em qualquer profundidade, e monta a
       lista de substituições.
       `chavePai` existe por causa de um vazamento real, visto no primeiro
       relatório de exemplo que gerei: `nomesAlterados` guarda o de-para da
       limpeza de símbolos — e o "de" é o nome ORIGINAL da parte, com o "&" e
       tudo. Ele não se chama "nome", então passava batido pela máscara e
       reaparecia inteiro no rastro. Dentro dessa lista, "de" e "para" são nome. */
    _segredosDe(obj, acc, vistos, chavePai) {
      acc = acc || [];
      vistos = vistos || new Set();
      if (!obj || typeof obj !== "object" || vistos.has(obj)) return acc;
      vistos.add(obj);
      if (Array.isArray(obj)) {
        for (const it of obj) this._segredosDe(it, acc, vistos, chavePai);
        return acc;
      }
      const ehDeParaDeNome = /nomesAlterados/i.test(String(chavePai || ""));
      for (const [k, v] of Object.entries(obj)) {
        if (v && typeof v === "object") { this._segredosDe(v, acc, vistos, k); continue; }
        if (typeof v !== "string" || !v.trim()) continue;
        const ehNome = /^(nome|razaoSocial)$/i.test(k) || /nomeAbrev/i.test(k) ||
                       (ehDeParaDeNome && /^(de|para)$/i.test(k));
        if (ehNome) acc.push([v, this._iniciais(v)]);
        if (/^(cpfcnpj|cpf|cnpj|documento)$/i.test(k)) acc.push([v, this._docCurto(v)]);
      }
      return acc;
    },

    /* ── O ARQUIVO ─────────────────────────────────────────────────────────
       Texto puro de propósito: abre em qualquer lugar, cola em qualquer chat, e
       quem manda consegue LER antes de mandar. */
    async gerar(modulo, msgErro, opts) {
      const o = opts || {};
      const chaves = {
        cnib: "cnib_estado", serasajud: "serasajud_estado", censec: "censec_estado",
        sab: "sab_estado", renajud: "renajud_estado", infojud: "coleta_estado",
      };

      let estado = null, config = null, versao = "?";
      try { estado = await Store.get(chaves[modulo] || (modulo + "_estado")); } catch (e) {}
      try { config = ((await Store.get(CHAVES.config)) || {})[modulo] || null; } catch (e) {}
      try { versao = browser.runtime.getManifest().version; } catch (e) {}

      // Sem mascarar, a lista de segredos fica vazia e nada é trocado.
      const segredos = o.incluirPartes ? [] : this._segredosDe(estado);
      const m = (t) => this._mascarar(t, segredos);

      const L = [];
      L.push("RELATÓRIO DE PROBLEMA — CRATOS");
      L.push("=".repeat(60));
      L.push("");
      L.push("Este arquivo foi gerado no seu navegador e NÃO foi enviado a lugar");
      L.push("nenhum. Confira o conteúdo e mande você mesmo, se quiser.");
      L.push("");
      L.push("Versão do CRATOS ....... " + versao);
      L.push("Convênio ............... " + String(modulo || "?").toUpperCase());
      L.push("Operação ............... " + ((estado && estado.operacao) || "—"));
      L.push("Parou na fase .......... " + ((estado && estado.fase) || "—"));
      L.push("Quando ................. " + new Date().toString());
      L.push("Endereço da tela ....... " + location.host + location.pathname);
      L.push("Navegador .............. " + navigator.userAgent);
      L.push("");
      L.push("Número do processo ..... " +
        ((estado && (estado.numProcesso || estado.numeroProcesso)) || "—") +
        "   (não mascarado, de propósito: é o que permite reproduzir o erro)");
      L.push("");
      L.push("O QUE PAROU");
      L.push("-".repeat(60));
      L.push(m(String(msgErro || "—")));
      L.push("");
      L.push("OS ÚLTIMOS PASSOS (o que apareceu na tela, na ordem)");
      L.push("-".repeat(60));
      if (!this._passos.length) L.push("(nenhum passo registrado nesta aba)");
      for (const p of this._passos) {
        L.push(`${p.t}  [${p.n}] ${m(p.x).replace(/\n+/g, " ⏎ ")}`);
      }
      L.push("");
      L.push("ESTADO DA OPERAÇÃO" + (o.incluirPartes ? "  (COM os dados das partes)" : "  (partes mascaradas)"));
      L.push("-".repeat(60));
      L.push(estado ? m(JSON.stringify(estado, null, 1)) : "(sem estado gravado)");
      L.push("");
      L.push("PREFERÊNCIAS DESTE CONVÊNIO");
      L.push("-".repeat(60));
      L.push(config ? JSON.stringify(config, null, 1) : "(nenhuma salva)");
      L.push("");
      return L.join("\n");
    },

    _nomeArquivo(modulo) {
      const d = new Date();
      const p = (n) => String(n).padStart(2, "0");
      return `CRATOS-problema-${modulo}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
             `-${p(d.getHours())}${p(d.getMinutes())}.txt`;
    },

    /* Baixa sem passar pelo background: Blob + <a download>. Menos peça no
       caminho, e a permissão "downloads" não é usada para isto. */
    baixar(texto, modulo) {
      const url = URL.createObjectURL(new Blob([texto], { type: "text/plain;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = this._nomeArquivo(modulo);
      (document.body || document.documentElement).appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    },

    /* ── PAINEL ────────────────────────────────────────────────────────────
       Abre em cima da faixa, mostra o texto REAL que será baixado, e só então
       oferece o download. Ver antes de mandar não é detalhe: é o que permite
       à pessoa decidir com conhecimento. */
    async abrirPainel(modulo, msgErro) {
      const id = "cratos-relatorio-painel";
      const antigo = document.getElementById(id);
      if (antigo) antigo.remove();

      const cx = document.createElement("div");
      cx.id = id;
      cx.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:2147483647;" +
        "width:min(620px,92vw);max-height:78vh;display:flex;flex-direction:column;" +
        "background:#111;color:#e8e8e8;border:1px solid #333;border-radius:10px;" +
        "box-shadow:0 8px 30px rgba(0,0,0,.6);font:13px/1.45 system-ui,sans-serif";

      const topo = document.createElement("div");
      topo.style.cssText = "display:flex;align-items:center;justify-content:space-between;" +
        "padding:10px 12px;border-bottom:1px solid #2a2a2a;font-weight:600";
      topo.append("Relatório de problema — confira antes de mandar");
      const xis = document.createElement("button");
      xis.textContent = "✕";
      xis.style.cssText = "background:none;border:none;color:#b0b0b0;font-size:16px;cursor:pointer";
      xis.onclick = () => cx.remove();
      topo.appendChild(xis);

      const pre = document.createElement("pre");
      pre.style.cssText = "margin:0;padding:12px;overflow:auto;flex:1;white-space:pre-wrap;" +
        "font:12px/1.4 ui-monospace,Consolas,monospace;color:#d8d8d8";

      const rodape = document.createElement("div");
      rodape.style.cssText = "display:flex;gap:12px;align-items:center;flex-wrap:wrap;" +
        "padding:10px 12px;border-top:1px solid #2a2a2a";

      const rotuloCheck = document.createElement("label");
      rotuloCheck.style.cssText = "display:flex;gap:7px;align-items:center;color:#b0b0b0;cursor:pointer";
      const check = document.createElement("input");
      check.type = "checkbox";
      rotuloCheck.append(check, "incluir os dados das partes (nomes e CPF/CNPJ)");

      const baixar = document.createElement("button");
      baixar.textContent = "Baixar relatório";
      baixar.style.cssText = "padding:8px 16px;background:#e11d1d;color:#fff;border:none;" +
        "border-radius:7px;font-weight:600;cursor:pointer";

      const copiar = document.createElement("button");
      copiar.textContent = "Copiar";
      copiar.style.cssText = "padding:8px 14px;background:#2a2a2a;color:#e8e8e8;border:none;" +
        "border-radius:7px;cursor:pointer";

      const nota = document.createElement("span");
      nota.style.cssText = "color:#7a7a7a;font-size:12px";
      nota.textContent = "nada é enviado por aqui";

      rodape.append(rotuloCheck, baixar, copiar, nota);
      cx.append(topo, pre, rodape);
      (document.body || document.documentElement).appendChild(cx);

      const atualizar = async () => {
        pre.textContent = "gerando…";
        pre.textContent = await this.gerar(modulo, msgErro, { incluirPartes: check.checked });
      };
      check.onchange = atualizar;
      baixar.onclick = () => this.baixar(pre.textContent, modulo);
      copiar.onclick = async () => {
        try {
          await navigator.clipboard.writeText(pre.textContent);
          copiar.textContent = "copiado ✓";
          setTimeout(() => (copiar.textContent = "Copiar"), 2000);
        } catch (e) {
          nota.textContent = "a página bloqueou a cópia — use o Baixar";
        }
      };
      await atualizar();
    },
  };

  globalThis.CratosRelatorio = CratosRelatorio;
}
