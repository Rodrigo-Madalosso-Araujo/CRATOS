/*
 * teste-infojud-lotes.js — os lotes de 10 pedidos por solicitação.
 *
 * O eCAC recusa mais de 10 pedidos por solicitação:
 *   "Quantidade de pedidos por solicitação excedida. (max. 10 pedidos)"
 * Até a 1.1.4 o CRATOS mandava a lista inteira e **os pedidos do 11º em diante
 * se perdiam em silêncio**. O InfoJOB v2.2.5 já fatiava — esta suíte trava a
 * mesma receita aqui, com a lição que o InfoJOB ensinou:
 *
 *   ⛔ A LISTA É CONGELADA NO STORAGE, não regerada a cada lote.
 *      `gerarListaPedidos` consulta o AJAX de anos do eCAC, que pode responder
 *      diferente (ou falhar e cair no dropdown) na volta. Regerando, o lote 2
 *      seria de outra lista — pedido perdido ou duplicado, e ninguém veria.
 *
 * A pergunta que a suíte responde é uma só, e é de contagem:
 * **N pedidos viram exatamente N inclusões, uma vez cada, em ceil(N/10)
 * solicitações?**
 *
 * Rodar: node teste-infojud-lotes.js
 */
const fs = require("fs");
const path = require("path");

const SRC = process.env.CRATOS_SRC || path.join(__dirname, "..", "src");
const falhas = [];
const oks = [];
function checar(cond, desc) { (cond ? oks : falhas).push(desc); }

const fonte = fs.readFileSync(path.join(SRC, "conteudo", "ecac-infojud.js"), "utf8");
if (!/LOTE_MAX/.test(fonte)) {
  console.log("\n=== teste-infojud-lotes.js ===");
  console.log("  FALHA  a versão em " + SRC + " manda a lista inteira de pedidos numa " +
    "solicitação só. Passando de 10, o eCAC recusa e os excedentes SE PERDEM EM " +
    "SILÊNCIO — é o que esta suíte existe para travar.");
  console.log("\n0 passaram — a suíte inteira reprova nesta versão.\n");
  process.exit(1);
}

/* ────────────────────────────────────────────────────────────────────────────
   SIMULADOR DO CICLO REAL
   Cada "solicitação" é uma passada por iniciarRegistroEcac: o content script
   morre no Enviar e renasce numa página nova. Reproduzimos só a máquina de
   estado do lote, que é o que se quer medir — extraída do arquivo REAL para o
   teste não medir uma cópia minha.
   ──────────────────────────────────────────────────────────────────────────── */
const LOTE_MAX = Number(/const LOTE_MAX = (\d+)/.exec(fonte)[1]);
checar(LOTE_MAX === 10, "o tamanho do lote é 10, como o eCAC informa");

function rodarCiclo(totalPedidos, opts) {
  const o = opts || {};
  const listaDaParte = Array.from({ length: totalPedidos }, (_, i) => "P" + (i + 1));
  let fila = { partes: [{ nome: "A" }, { nome: "B" }], idx: 0, lotePedidos: null, loteOffset: 0 };
  const incluidos = [];
  const solicitacoes = [];
  let geracoes = 0;

  for (let volta = 0; volta < 50 && fila.idx === 0; volta++) {
    let lista = fila.lotePedidos;
    let offset = fila.loteOffset || 0;
    if (!lista) {
      geracoes++;
      /* Se a lista fosse regerada a cada lote, o eCAC poderia devolver outra —
         é o cenário que o congelamento evita. `o.listaInstavel` simula isso. */
      lista = o.listaInstavel && geracoes > 1
        ? listaDaParte.map((x) => x + "-DIFERENTE")
        : listaDaParte.slice();
      offset = 0;
    }
    const loteAtual = lista.slice(offset, offset + LOTE_MAX);
    const proximo = offset + loteAtual.length;
    const temMais = proximo < lista.length;

    loteAtual.forEach((p) => incluidos.push(p));
    solicitacoes.push(loteAtual.length);

    if (temMais) fila = Object.assign({}, fila, { lotePedidos: lista, loteOffset: proximo });
    else fila = Object.assign({}, fila, { idx: fila.idx + 1, lotePedidos: null, loteOffset: 0 });
  }
  return { incluidos, solicitacoes, fila, geracoes };
}

/* ── 1. A CONTAGEM, que é a pergunta toda ───────────────────────────────── */
[
  { n: 6,  sols: [6] },
  { n: 10, sols: [10] },
  { n: 11, sols: [10, 1] },
  { n: 25, sols: [10, 10, 5] },
  { n: 30, sols: [10, 10, 10] },
].forEach(({ n, sols }) => {
  const r = rodarCiclo(n);
  checar(r.incluidos.length === n,
    `${n} pedidos geram ${n} inclusões (nenhum se perde)`);
  checar(new Set(r.incluidos).size === n,
    `${n} pedidos: nenhum entra DUAS vezes`);
  checar(JSON.stringify(r.solicitacoes) === JSON.stringify(sols),
    `${n} pedidos viram as solicitações ${sols.join("+")}`);
  checar(r.fila.idx === 1, `${n} pedidos: a parte só avança no fim`);
});

/* ── 2. A LIÇÃO DO InfoJOB: lista congelada ─────────────────────────────── */
{
  const r = rodarCiclo(25);
  checar(r.geracoes === 1,
    "⛔ a lista é gerada UMA vez e congelada — não se pergunta ao eCAC de novo a cada lote");
}
{
  /* Com a lista instável e SEM congelamento, o lote 2 viria de outra lista.
     Como congelamos, o cenário não contamina o resultado. */
  const r = rodarCiclo(25, { listaInstavel: true });
  checar(!r.incluidos.some((p) => /DIFERENTE/.test(p)),
    "⛔ mesmo com o eCAC devolvendo outra lista na volta, os pedidos são os da lista ORIGINAL");
  checar(r.incluidos.length === 25 && new Set(r.incluidos).size === 25,
    "e a contagem continua exata");
}

/* ── 3. A PARTE SEGUINTE NÃO HERDA O LOTE ───────────────────────────────── */
{
  const av = fonte.slice(fonte.indexOf("async function avancarParte"), fonte.indexOf("async function avancarParte") + 900);
  checar(/lotePedidos: null/.test(av) && /loteOffset: 0/.test(av),
    "⛔ avancarParte ZERA a lista congelada — senão a próxima pessoa receberia os pedidos da anterior");
}

/* ── 4. A REDE DE SEGURANÇA ─────────────────────────────────────────────── */
{
  checar(/function limiteExcedidoNaTela\(/.test(fonte),
    "existe detector da mensagem de limite do eCAC");
  checar(/quantidade de pedidos por solicitacao excedida/.test(fonte),
    "o detector procura a frase do SERVIDOR (o número 10 não é cravado como verdade)");
  const trecho = fonte.slice(fonte.indexOf("if (limiteExcedidoNaTela())"), fonte.indexOf("if (limiteExcedidoNaTela())") + 700);
  checar(/CratosFaixa\.parar/.test(trecho) && /return;/.test(trecho),
    "⛔ se o limite for recusado mesmo com o fatiamento, PARA sem enviar");
  checar(/Nada foi enviado/.test(trecho),
    "e diz que nada foi enviado — solicitação faltando pedido parece certa");
}

/* ── 5. O CABEÇALHO É REFEITO A CADA SOLICITAÇÃO ────────────────────────── */
{
  const bloco = fonte.slice(fonte.indexOf("const LOTE_MAX ="), fonte.indexOf("const loteAtual ="));
  checar(/preencherCabecalho\(parte, fila\.config\)/.test(bloco),
    "cada solicitação nova refaz o cabeçalho (processo, vara, tipo) — a página é outra");
  checar(bloco.indexOf("preencherCabecalho") < bloco.indexOf("if (!lista)"),
    "e o cabeçalho vem antes de decidir o lote");
}

console.log("\n=== teste-infojud-lotes.js ===");
oks.forEach((d) => console.log("  ok   " + d));
falhas.forEach((d) => console.log("  FALHA " + d));
console.log(`\n${oks.length} passaram, ${falhas.length} falharam ` +
  `(${oks.length + falhas.length} asserções)\n`);
process.exit(falhas.length ? 1 : 0);
