/* Gera "CRATOS - Manual do Usuario.docx" — público geral, não técnico.
 *
 * COMO ATUALIZAR: edite este arquivo e rode `node gerar-manual.js` dentro da pasta
 * manual\ (precisa do pacote "docx"). A VERSÃO da capa sai do src\manifest.json —
 * nunca fica desatualizada. Atualizado para a 1.9.0 em 23/10/2026; o capítulo 4
 * ("Primeiros passos") será reescrito na 1.9.1, com a página nova de configuração.
 */
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  PageBreak, LevelFormat, TableOfContents,
} = require("docx");
const fs = require("fs");
const path = require("path");

/* Versão da capa = a do manifesto (../src/manifest.json); sem ele, a última conhecida. */
let VERSAO = "1.9.0";
try { VERSAO = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "src", "manifest.json"), "utf8")).version || VERSAO; } catch (e) { /* fica a conhecida */ }

const AZUL = "1F3A5F", VERM = "C0392B", CINZA = "6B7280", CINZACLARO = "F2F4F7";
const AMARELO = "FFF4CE", VERDECLARO = "E8F5E9";

/* ---------- helpers ---------- */
const T = (text, o = {}) => new TextRun({ text, ...o });
const P = (children, o = {}) =>
  new Paragraph({ children: Array.isArray(children) ? children : [T(String(children))], ...o });

function h1(txt) { return new Paragraph({ text: txt, heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 140 } }); }
function h2(txt) { return new Paragraph({ text: txt, heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 100 } }); }
function corpo(txt, o = {}) { return new Paragraph({ children: [T(txt)], spacing: { after: 120, line: 276 }, ...o }); }

function bullet(txt) {
  const runs = Array.isArray(txt) ? txt : [T(txt)];
  return new Paragraph({ children: runs, numbering: { reference: "lista", level: 0 }, spacing: { after: 60, line: 264 } });
}
/* Cada lista de passos recomeça do 1: `novaLista()` antes do primeiro passo de cada
   capítulo (antes, o capítulo 4 continuava a numeração do 3: 5, 6, 7). */
let _instPassos = 1;
function novaLista() { _instPassos++; }
function passo(txt) {
  const runs = Array.isArray(txt) ? txt : [T(txt)];
  return new Paragraph({ children: runs, numbering: { reference: "passos", level: 0, instance: _instPassos }, spacing: { after: 80, line: 264 } });
}

/* Caixa de destaque (uma linha de título + linhas de texto), com cor de fundo. */
function caixa(titulo, linhas, fundo, corTitulo) {
  const filhos = [];
  if (titulo) filhos.push(new Paragraph({ children: [T(titulo, { bold: true, color: corTitulo || AZUL })], spacing: { after: 60 } }));
  (linhas || []).forEach((l) => filhos.push(new Paragraph({
    children: Array.isArray(l) ? l : [T(l)], spacing: { after: 40, line: 264 },
  })));
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 2, color: fundo === AMARELO ? "E6B800" : "CBD5E1" },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: fundo === AMARELO ? "E6B800" : "CBD5E1" },
      left: { style: BorderStyle.SINGLE, size: 12, color: fundo === AMARELO ? "E6B800" : (corTitulo || AZUL) },
      right: { style: BorderStyle.SINGLE, size: 2, color: fundo === AMARELO ? "E6B800" : "CBD5E1" },
      insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE },
    },
    rows: [new TableRow({ children: [new TableCell({
      width: { size: 9360, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: fundo || CINZACLARO },
      margins: { top: 120, bottom: 120, left: 160, right: 160 },
      children: filhos,
    })] })],
  });
}

/* Marcador de captura de tela — visualmente distinto (pedido do Rodrigo). */
function captura(desc) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA }, columnWidths: [9360],
    borders: {
      top: { style: BorderStyle.DASHED, size: 6, color: VERM },
      bottom: { style: BorderStyle.DASHED, size: 6, color: VERM },
      left: { style: BorderStyle.DASHED, size: 6, color: VERM },
      right: { style: BorderStyle.DASHED, size: 6, color: VERM },
    },
    rows: [new TableRow({ children: [new TableCell({
      width: { size: 9360, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: "FDECEA" },
      margins: { top: 100, bottom: 100, left: 160, right: 160 },
      children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [
        T("📷 [INSERIR CAPTURA] ", { bold: true, color: VERM }),
        T(desc, { italics: true, color: VERM }),
      ] })],
    })] })],
  });
}

/* Tabela de configurações: [opção, o que faz, padrão]. */
function tabelaConfig(linhas) {
  const W = [2600, 5560, 1200];
  const th = (t) => new TableCell({
    width: { size: 0, type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, fill: AZUL },
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ children: [T(t, { bold: true, color: "FFFFFF", size: 19 })] })],
  });
  const td = (t, i, bold) => new TableCell({
    width: { size: W[i], type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, fill: "FFFFFF" },
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ children: Array.isArray(t) ? t : [T(t, { size: 19, bold: !!bold })] })],
  });
  const head = new TableRow({ tableHeader: true, children: [th("Opção"), th("O que faz"), th("Padrão")] });
  const rows = linhas.map((l, idx) => new TableRow({ children: [
    new TableCell({ width: { size: W[0], type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, fill: idx % 2 ? CINZACLARO : "FFFFFF" }, margins: { top: 60, bottom: 60, left: 100, right: 100 }, children: [new Paragraph({ children: [T(l[0], { size: 19, bold: true })] })] }),
    new TableCell({ width: { size: W[1], type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, fill: idx % 2 ? CINZACLARO : "FFFFFF" }, margins: { top: 60, bottom: 60, left: 100, right: 100 }, children: [new Paragraph({ children: [T(l[1], { size: 19 })] })] }),
    new TableCell({ width: { size: W[2], type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, fill: idx % 2 ? CINZACLARO : "FFFFFF" }, margins: { top: 60, bottom: 60, left: 100, right: 100 }, children: [new Paragraph({ children: [T(l[2] || "—", { size: 19, italics: true, color: CINZA })] })] }),
  ] }));
  return new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: W, rows: [head, ...rows] });
}

const children = [];

/* ═══════════════ CAPA ═══════════════ */
children.push(new Paragraph({ spacing: { before: 2600 }, alignment: AlignmentType.CENTER, children: [T("CRATOS", { bold: true, size: 76, color: AZUL })] }));
children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [T("Manual do Usuário", { size: 36, color: CINZA })] }));
children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [T("Execução unificada de convênios a partir do processo no PJe", { size: 22, italics: true, color: CINZA })] }));
children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 1800 }, children: [T("Tribunal Regional do Trabalho da 18ª Região", { size: 22 })] }));
children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [T("Versão " + VERSAO, { size: 20, color: CINZA }), T("     •     ", { size: 20, color: CINZA }), T("[preencher: mês/ano]", { size: 20, color: VERM, bold: true })] }));
children.push(new Paragraph({ children: [new PageBreak()] }));

/* ═══════════════ SUMÁRIO ═══════════════ */
children.push(new Paragraph({ children: [T("Sumário", { bold: true, size: 30, color: AZUL })], spacing: { after: 200 } }));
[
  "1.  O que é o CRATOS",
  "2.  A regra de ouro",
  "3.  Instalação",
  "4.  Primeiros passos",
  "5.  Usando no dia a dia",
  "6.  As configurações (Preferências)",
  "7.  Observações importantes",
  "8.  Perguntas frequentes",
].forEach((s) => children.push(new Paragraph({ children: [T(s, { size: 24, color: "2E5A88" })], spacing: { after: 120 } })));
children.push(new Paragraph({ children: [new PageBreak()] }));

/* ═══════════════ 1. O QUE É ═══════════════ */
children.push(h1("1. O que é o CRATOS"));
children.push(corpo("O CRATOS é uma extensão para o navegador Firefox que ajuda a executar, a partir de um processo aberto no PJe, as consultas e ordens dos convênios do dia a dia da execução — INFOJUD (eCAC/Receita), SAB (bloqueio/SISBAJUD), RENAJUD, CNIB, CENSEC, SerasaJUD, CCS (Banco Central), SNIPER (investigação patrimonial do CNJ) e PREVJUD (Dossiê Previdenciário do INSS)."));
children.push(corpo("Em vez de você abrir cada sistema, digitar o número do processo e os dados das partes um por um, o CRATOS captura tudo do processo em tela e prepara cada convênio para você. Ao final, ele ainda organiza as certidões e prepara a juntada no PJe."));
children.push(corpo("A ideia é simples: você conduz, o CRATOS faz o trabalho repetitivo."));

children.push(h1("2. A regra de ouro"));
children.push(caixa("O CRATOS PREPARA. Você confere, assina e envia.", [
  [T("A extensão nunca clica em ", {}), T("Enviar", { bold: true }), T(", nunca ", {}), T("Assina", { bold: true }), T(" com o seu certificado e nunca ", {}), T("Confirma", { bold: true }), T(" uma ordem no seu lugar.", {})],
  "Em cada convênio, ela preenche os campos e PARA no ponto da decisão. O ato — o clique que produz efeito jurídico — é sempre seu.",
  [T("Guarde esta regra: se algo parece que \"vai sozinho até o fim\", não vai. ", { }), T("O último passo é sempre humano.", { bold: true })],
], VERDECLARO, "1E7E34"));

/* ═══════════════ 3. INSTALAÇÃO ═══════════════ */
children.push(h1("3. Instalação"));
children.push(corpo("O CRATOS é instalado uma única vez, no Firefox. Você recebe um arquivo com final .xpi (a extensão já assinada)."));
children.push(passo("Abra o Firefox."));
children.push(passo([T("Arraste o arquivo ", {}), T(".xpi", { bold: true }), T(" para dentro da janela do Firefox (ou digite ", {}), T("about:addons", { bold: true }), T(" na barra de endereço, clique na engrenagem e escolha \"Instalar add-on a partir de arquivo\").", {})]));
children.push(passo("Confirme a instalação quando o Firefox perguntar."));
children.push(passo("Pronto: um ícone do CRATOS passa a aparecer quando você abrir um processo no PJe."));
children.push(caixa("Observação", [
  [T("Só a versão ", {}), T("assinada", { bold: true }), T(" (.xpi que você recebeu pronto) instala de forma permanente. Se instalar uma versão não assinada, ela some ao fechar o Firefox.", {})],
], AMARELO, "8A6D00"));
children.push(caixa("Atualizações automáticas", [
  "Depois da primeira instalação, você não precisa instalar de novo: as versões novas do CRATOS chegam sozinhas pelo próprio Firefox, que consulta cerca de uma vez por dia a lista de versões publicada pelo responsável pela extensão.",
  "Depois de cada atualização, o painel mostra uma vez o cartão \"Novidades\", com o que mudou (veja 5.11).",
  "O CRATOS exige o Firefox 140 ou mais novo.",
], CINZACLARO));
children.push(captura("tela do Firefox confirmando a instalação da extensão"));

/* ═══════════════ 4. PRIMEIROS PASSOS ═══════════════ */
children.push(h1("4. Primeiros passos"));
children.push(corpo("Antes de usar pela primeira vez, vale abrir as Preferências e ajustar os padrões dos convênios (capítulo 6). Depois, o uso é sempre o mesmo:"));
novaLista();
children.push(passo("Abra o processo no PJe, na tela de detalhes."));
children.push(passo([T("Clique no botão flutuante do ", {}), T("CRATOS", { bold: true }), T(". Um painel abre no canto da tela. (Você pode arrastar o botão para onde preferir; a posição fica guardada.)", {})]));
children.push(passo("O CRATOS captura as partes do processo e mostra a lista."));
children.push(captura("painel do CRATOS aberto ao lado do processo, com a lista de partes"));

/* ═══════════════ 5. USANDO NO DIA A DIA ═══════════════ */
children.push(h1("5. Usando no dia a dia"));

children.push(h2("5.1. Escolher as partes"));
children.push(corpo("No painel, cada parte do processo aparece com uma caixinha de seleção. As partes do polo passivo (os executados) já vêm marcadas — são o alvo natural das pesquisas. O polo ativo vem desmarcado, para você não pesquisar o credor por engano. Marque ou desmarque como precisar."));

children.push(h2("5.2. Inclusão ou Baixa"));
children.push(corpo("Escolha o que vai fazer: INCLUSÃO (incluir restrições/ordens e fazer consultas) ou BAIXA (retirar restrições). O CRATOS mostra os convênios adequados a cada caso. As consultas — INFOJUD, CENSEC, CCS, SNIPER e PREVJUD — aparecem na INCLUSÃO; SAB, RENAJUD, CNIB e SerasaJUD aparecem nas duas."));

children.push(h2("5.3. Escolher os convênios e a ordem"));
children.push(corpo("Marque os convênios que quer executar. Você pode ajustar a ordem com as setinhas (▲▼). Depois, clique em Executar selecionados."));
children.push(captura("painel na tela de seleção de convênios, com os botões Inclusão / Baixa"));

children.push(h2("5.4. A fila que anda sozinha"));
children.push(corpo("A partir daí, o CRATOS executa um convênio de cada vez. Quando um termina — o que ele reconhece pela chegada da certidão — a extensão passa para o próximo automaticamente e fecha a aba do convênio concluído. Você acompanha o progresso pelo painel."));
children.push(caixa("Dois botões sempre à mão", [
  [T("✓ Concluí — próximo: ", { bold: true }), T("use quando você terminou aquele convênio no sistema e quer seguir para o próximo.", {})],
  [T("⏭ Pular — próximo da fila: ", { bold: true }), T("use quando quiser deixar aquele convênio para depois. A fila segue, e o convênio pulado aparece sinalizado no relatório final.", {})],
], CINZACLARO));
children.push(corpo("Em alguns convênios (INFOJUD, SNIPER, PREVJUD), enquanto o CRATOS trabalha, a aba do sistema fica coberta por um aviso. Não clique nela até ele terminar."));

children.push(h2("5.5. O relatório do fim"));
children.push(corpo("Quando a fila termina, o painel mostra um resumo: quantos convênios foram concluídos e quais precisam da sua atenção (por exemplo, um que você pulou, que voltou incompleto ou cujo sistema estava fora do ar). Esse resumo é a sua conferência rápida — vale sempre ler."));

children.push(h2("5.6. Buscar as respostas do INFOJUD"));
children.push(corpo("O INFOJUD não responde na hora: o pedido é registrado e a resposta chega na caixa postal do eCAC minutos ou horas depois. Ao final da fila, o CRATOS já verifica e baixa as respostas disponíveis. Se ainda não chegaram, é normal — use o botão \"Localizar resultado na caixa postal\" mais tarde para buscar."));

children.push(corpo("Junto com o INFOJUD, se a opção estiver ligada (veja 6.1), o CRATOS pesquisa antes das solicitações as empresas em que cada executado pessoa física é o responsável (\"Recuperar NI – CNPJ\") e gera uma certidão consolidada, com o endereço de cada empresa. A pesquisa é feita por trás, com a sua sessão do e-CAC: a tela fica coberta por um aviso enquanto ela roda, e no fim a faixa mostra um resumo (por exemplo, \"F.S.: 3 empresas; B.P.: nenhuma\")."));
children.push(corpo("Se só o Recuperar NI estiver marcado (nenhum tipo de declaração ligado), o CRATOS faz apenas essa pesquisa: não abre a tela de solicitação nem consulta a caixa postal, porque a resposta é imediata."));

children.push(h2("5.7. Coletas posteriores: CCS e PREVJUD"));
children.push(corpo("Dois convênios também respondem depois, e cada um tem o seu botão na tela inicial do painel:"));
children.push(bullet([T("Coletar CCS (respostas das instituições): ", { bold: true }), T("no dia seguinte à requisição, junta o PDF de detalhamentos do próprio CCS e uma certidão com quem já respondeu e quem ainda falta responder.", {})]));
children.push(bullet([T("Coletar PREVJUD (dossiês em processamento): ", { bold: true }), T("busca os dossiês prontos do processo (pedidos dos últimos 7 dias) e junta os PDFs do INSS, mesmo que já tenham sido juntados antes.", {})]));

children.push(h2("5.8. Sistema fora do ar: certidão de indisponibilidade"));
children.push(corpo("Na tela inicial do painel, escolha um convênio e clique em \"Verificar disponibilidade do convênio\". O CRATOS faz até 3 tentativas, testa o próprio PJe como controle e mostra o resultado. Se o sistema estiver mesmo fora do ar, aparece o botão para gerar a certidão de indisponibilidade — só com a sua confirmação."));
children.push(corpo("Durante a fila, se um convênio falha ou fica sem resposta, o CRATOS faz essa verificação sozinho e, se for o caso, oferece a certidão."));
children.push(caixa("Observação", [
  "A certidão relata as tentativas, com hora e retorno, sem afirmar a causa, e diz que a diligência deve ser repetida. Se nem o PJe responder, o problema pode ser a rede da unidade, e o CRATOS não oferece certidão.",
], AMARELO, "8A6D00"));

children.push(h2("5.9. Juntar a certidão no processo"));
children.push(corpo("Ao terminar os convênios, o CRATOS reúne o que foi feito em uma certidão e anexa os comprovantes, criando a minuta no processo. Ele cria a minuta e PARA: conferir, ajustar e assinar é você. Se preferir, use o botão \"Juntar certidão dos convênios\" para fazer isso quando quiser."));
children.push(corpo("Inclusões e consultas saem numa certidão; cancelamentos de restrição, em outra; sistemas indisponíveis, numa terceira. Na baixa, quando o convênio não encontra restrição ativa para cancelar (CNIB e RENAJUD), também sai certidão, dizendo isso."));
children.push(corpo("Ao criar a certidão, o CRATOS também libera a visibilidade do documento para as partes do processo (você escolhe quais polos nas Preferências — veja 6.10)."));
children.push(caixa("Importante", [
  [T("Depois que a minuta é criada, ", {}), T("confira e assine você mesmo", { bold: true }), T(". Na tela de juntada não existe a pergunta de confirmação que os outros convênios têm — se você já assinou algo na sessão, o clique em Assinar assina direto.", {})],
], AMARELO, "8A6D00"));

children.push(h2("5.10. Junte antes de fechar a aba do processo"));
children.push(corpo("Por privacidade, os dados de cada processo ficam guardados só enquanto a aba dele estiver aberta. Ao fechar a aba, o CRATOS apaga tudo o que guardou daquele processo — inclusive a lista de arquivos para a juntada. O que sobrar é apagado quando o Firefox abre."));
children.push(caixa("Na prática", [
  [T("Faça a juntada ", {}), T("antes", { bold: true }), T(" de fechar a aba do processo. Se houver arquivo do CRATOS ainda não juntado, o Firefox pergunta se você quer mesmo sair da página.", {})],
  "Se fechar sem juntar, os arquivos continuam na sua pasta de downloads, mas o CRATOS não os oferece mais para juntada: anexe à mão ou refaça o convênio.",
], AMARELO, "8A6D00"));

children.push(h2("5.11. Novidades da versão"));
children.push(corpo("Depois de cada atualização, o painel mostra uma vez o cartão \"Novidades\", com o que mudou. Clique em \"Entendi\" para fechar; \"ver versões anteriores\" mostra o histórico. O mesmo histórico está nas Preferências, no botão \"Ver novidades das versões\" (veja 6.11)."));

/* ═══════════════ 6. CONFIGURAÇÕES ═══════════════ */
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h1("6. As configurações (Preferências)"));
children.push(corpo("As Preferências definem os padrões de cada convênio — como o que consultar, quais restrições aplicar e de onde vem o valor. Você ajusta uma vez e o CRATOS passa a usar esses padrões em todos os processos. Para abrir: clique com o botão direito no ícone do CRATOS e escolha Preferências (ou em about:addons, no CRATOS, aba Preferências)."));
children.push(captura("tela de Preferências do CRATOS"));

children.push(h2("6.1. INFOJUD (eCAC / Receita)"));
children.push(corpo("Escolha quais documentos consultar — separadamente para pessoas físicas (CPF) e jurídicas (CNPJ). Onde houver \"últimos anos\", você define quantos anos para trás a consulta abrange."));
children.push(tabelaConfig([
  ["Consultas para CPF", "DIRPF, DITR, DOI, DECRED, DIMOB, Informações Cadastrais e eFinanceira. Marque os que quer; ajuste os anos onde couber.", "DIRPF (3 anos)"],
  ["Consultas para CNPJ", "DIPJ, ECF, DITR, DOI, DECRED, DIMOB, CPMF, Informações Cadastrais e eFinanceira.", "nenhuma"],
  ["Opções do eFinanceira", "Tipo de conta, tipo de relação, exibir câmbio e tipo de extrato — separadas para CPF e CNPJ. O padrão é o relatório detalhado: Todas, Todas, Sim, Contas e movimentações.", "Detalhado"],
  ["Recuperar NI (no quadro CPF)", "Antes das solicitações, pesquisa as empresas em que cada executado pessoa física é o responsável e expede uma certidão consolidada, com o endereço de cada empresa.", "Ligado"],
  ["Vara", "A vara que assina a solicitação no eCAC. Escolha a sua na lista.", "—"],
  ["Tipo de processo", "Como o eCAC classifica o pedido.", "Ação Trabalhista"],
  ["Justificativa", "Texto da justificativa no eCAC.", "execução"],
  ["Magistrado", "Nome do magistrado no eCAC (opcional).", "—"],
  ["Ao terminar a fila", "Se o CRATOS verifica e colhe sozinho as respostas na caixa postal, só verifica e oferece o botão de colher, ou não verifica.", "Verificar e colher"],
  ["Pasta de download", "Subpasta onde os arquivos são salvos, dentro da pasta de downloads do Firefox.", "CRATOS"],
]));
children.push(caixa("Observações do INFOJUD", [
  "A eFinanceira é assíncrona: a resposta pode demorar. Isso é do sistema, não da extensão.",
  [T("Recuperar NI: ", { bold: true }), T("se o INFOJUD avisar que há mais de 50 empresas, o CRATOS refaz a pesquisa por UF (27 pesquisas, cerca de um minuto). Se a consulta falhar, a certidão diz que não pôde ser concluída e deve ser repetida — nunca que não há empresas.", {})],
  [T("O INFOJUD funciona dentro do e-CAC, que a Receita vem migrando para um novo portal. Enquanto a consulta judicial não existir no portal novo, o e-CAC atual continua no ar. ", {}), T("Vale acompanhar esse prazo.", { bold: true })],
], AMARELO, "8A6D00"));

children.push(h2("6.2. SAB (bloqueio / SISBAJUD)"));
children.push(tabelaConfig([
  ["Valor da obrigação", "Atualizar o valor para a data de hoje, ou usar o valor do cálculo sem atualizar.", "Atualizar p/ hoje"],
  ["Repetição contínua", "Por teimosinhas ou por automação.", "Teimosinhas"],
  ["Bloquear conta salário?", "Se inclui a conta salário no bloqueio.", "Não"],
  ["Utilizar conta única?", "Se usa a conta única.", "Sim"],
  ["Justificativa da baixa", "Texto usado ao interromper a determinação.", "Determinação judicial"],
  ["Chip ao concluir", "Aplica o marcador \"SISBAJUD - aguardar resposta\" ao concluir a inclusão.", "Desligado"],
  ["Atividade no GIGS", "Lança a atividade \"SISBAJUD - SAB em processamento\" no GIGS.", "Desligado"],
]));
children.push(caixa("Observação do SAB", [
  "Quando você escolhe atualizar o valor para hoje, o CRATOS usa o mesmo fator do PJe-Calc e mostra um aviso de que o valor foi atualizado. Confira sempre o valor antes de confirmar.",
], AMARELO, "8A6D00"));

children.push(h2("6.3. RENAJUD"));
children.push(tabelaConfig([
  ["Tipo(s) de restrição", "Transferência, Licenciamento e/ou Circulação (Restrição Total). Marque um ou mais.", "nenhuma"],
  ["Tribunal", "O tribunal que aparece nos Dados do Processo (lista com todos os TRTs).", "TRT da 18ª Região"],
  ["Órgão / Unidade", "A sua unidade, na lista do TRT18.", "—"],
  ["Magistrado", "Documento ou nome do magistrado.", "—"],
  ["Ramo da Justiça", "O ramo que aparece nos Dados do Processo.", "Justiça do Trabalho"],
]));
children.push(caixa("Observação do RENAJUD", [
  "Na baixa, se o RENAJUD não encontrar restrição ativa para cancelar, o CRATOS gera certidão dizendo isso.",
], CINZACLARO));

children.push(h2("6.4. CNIB (indisponibilidade)"));
children.push(tabelaConfig([
  ["Vara esperada", "Se preenchida, o CRATOS bloqueia caso o CNIB esteja logado em outra vara. Em branco, apenas informa.", "em branco"],
  ["Informar o valor da dívida?", "Se inclui o valor na ordem.", "Não"],
  ["De onde vem o valor", "Do PJe-Calc (último cálculo) ou um valor fixo.", "PJe-Calc"],
  ["Valor fixo", "Usado se você escolher valor fixo.", "—"],
  ["Nome do Processo", "Como a tela 1 do CNIB classifica o processo.", "Execução judicial"],
  ["Priorizar prenotação?", "Na Justiça do Trabalho não se usa.", "Não"],
]));
children.push(caixa("Observações do CNIB", [
  "Inclusão e cancelamento TOTAL: o CRATOS prepara e para no envio/assinatura, que são seus.",
  [T("Cancelamento PARCIAL é feito 100% à mão", { bold: true }), T(", fora da extensão: escolher quais matrículas saem é decisão jurídica caso a caso.", {})],
  "No cancelamento, se não houver ordem ativa a cancelar (não localizada ou já cancelada), o CRATOS gera certidão dizendo isso.",
], CINZACLARO));

children.push(h2("6.5. CENSEC (Escrituras e Procurações)"));
children.push(tabelaConfig([
  ["Gerar certidão negativa?", "Se cria a certidão também quando não há atos (negativa).", "Sim"],
  ["Listar as partes de cada ato", "Inclui na certidão as partes de cada ato (nome, CPF/CNPJ e qualidade).", "Desligado"],
  ["Pasta de download", "Subpasta onde os arquivos são salvos.", "CRATOS"],
]));
children.push(caixa("Observações do CENSEC", [
  "O login é seu (certificado digital + token por e-mail). O CRATOS abre a aba, espera você entrar e retoma sozinho.",
  "Consulta as partes que você marcou, de qualquer polo (é consulta, não constrição). Uma certidão por parte, inclusive a negativa.",
  "Se o site pedir um captcha, o CRATOS congela e espera você resolver — não tenta contornar.",
], CINZACLARO));

children.push(h2("6.6. SerasaJUD (negativação)"));
children.push(tabelaConfig([
  ["Prazo de atendimento", "5, 3, 2 ou 1 dia. O padrão do próprio SerasaJUD é 5 dias.", "5 dias"],
  ["De onde vem o valor", "Do PJe-Calc (último cálculo) ou um valor fixo.", "PJe-Calc"],
  ["Valor fixo", "Usado se você escolher valor fixo.", "—"],
  ["Gerar certidão depois de confirmar?", "Se emite a certidão após você confirmar a ordem.", "Sim"],
  ["Pasta de download", "Subpasta onde os arquivos são salvos.", "CRATOS"],
]));
children.push(caixa("Observações do SerasaJUD", [
  "Uma ordem por processo, com todos os executados como titulares. Se algum não entrar, o CRATOS para e avisa.",
  [T("Negativar é constrição: ", {}), T("se você marcar uma parte do polo ativo, ela entra (a marcação é sua), mas com aviso em vermelho na tela.", {})],
  "Se o processo não tiver cálculo do PJe-Calc, o CRATOS abre uma janela e espera, sem prazo, você informar o valor (e, na baixa, a data da dívida) à mão. A certidão registra que o dado foi informado por você.",
], CINZACLARO));

children.push(h2("6.7. CCS (Banco Central)"));
children.push(tabelaConfig([
  ["Aceitar o Termo de Uso", "Se o CRATOS aceita o termo por você ou para para você aceitar.", "Não (para)"],
  ["Enviar o detalhamento", "Se marca os relacionamentos e envia sozinho (só se a marcação sair limpa) ou marca e para para você clicar.", "Não (para)"],
  ["Quais relacionamentos detalhar", "Todos os detalháveis ou só os ativos (sem Data Fim).", "Todos"],
  ["Esconder inativos", "Só muda a exibição na tela, não a marcação.", "Não"],
  ["Chip \"CCS - aguardar resposta\"", "Aplica o chip no processo depois que o detalhamento é enviado. A etiqueta precisa existir na vara.", "Ligado"],
  ["Motivo da consulta", "Texto do motivo (o número do processo já vai no campo próprio).", "Execução trabalhista"],
  ["Pasta de download", "Subpasta onde os arquivos são salvos.", "CRATOS"],
]));
children.push(caixa("Observações do CCS", [
  "O login é seu (ADFS do Banco Central). Uma requisição por processo, com todos os executados.",
  "No dia seguinte, use \"Coletar CCS\" no painel (veja 5.7). Só o PDF do próprio CCS é juntado, e os anexos entram sigilosos.",
], CINZACLARO));

children.push(h2("6.8. SNIPER (investigação patrimonial)"));
children.push(tabelaConfig([
  ["Fontes", "Sisbajud (contas), Renajud (veículos), SERP/ONR (imóveis), AnacJud (aeronaves), Tribunal Marítimo (embarcações), TSE (bens declarados), SNGB (bens apreendidos) e CGU (sanções). Marque as que quer consultar.", "Todas"],
  ["Pasta de download", "Subpasta onde os arquivos são salvos.", "CRATOS"],
]));
children.push(caixa("Observações do SNIPER", [
  "O login é seu (PDPJ). O CRATOS só faz investigação: nunca clica em bloqueio, restrição ou outra constrição.",
  "Saem o relatório (com o cadastro da Receita e os processos de cada parte) e a certidão, fonte por fonte. Erro de uma fonte nunca vira \"nada encontrado\". Os anexos entram sigilosos.",
], CINZACLARO));

children.push(h2("6.9. PREVJUD (Dossiê Previdenciário)"));
children.push(tabelaConfig([
  ["Documentos a juntar", "Declaração de Benefícios, Carta de Concessão, Dados Cadastrais, Quadro Resumo, Extrato CNIS, Histórico de Créditos e outros que o PREVJUD passar a oferecer. Ligue ou desligue cada um.", "Todos"],
  ["Pasta de download", "Subpasta onde os arquivos são salvos.", "CRATOS"],
]));
children.push(caixa("Observações do PREVJUD", [
  "O login é seu (jus.br). Só o Dossiê Previdenciário, para executados pessoa física; o CRATOS nunca abre o Dossiê Médico.",
  "O CRATOS espera até 15 minutos. O que não ficar pronto vai na certidão como \"em processamento\" e é buscado depois por \"Coletar PREVJUD\" (veja 5.7). Os anexos entram sigilosos.",
], CINZACLARO));

children.push(h2("6.10. Juntada da certidão"));
children.push(tabelaConfig([
  ["Ao terminar os convênios", "Criar a minuta da certidão automaticamente, ou deixar para você criar pelo botão do painel.", "Criar"],
  ["Dar visibilidade às partes", "Liberar a certidão para o polo ativo e/ou o polo passivo. Marcando os dois, todas as partes enxergam.", "Ambos"],
]));

children.push(h2("6.11. Novidades da versão e Sobre"));
children.push(tabelaConfig([
  ["Mostrar novidades", "Mostra no painel o cartão de novidades depois de cada atualização.", "Ligado"],
]));
children.push(corpo("No fim das Preferências fica o cartão \"Sobre o CRATOS\", com a versão instalada, o que a extensão faz com os seus dados e o botão \"Ver novidades das versões\"."));

/* ═══════════════ 7. OBSERVAÇÕES GERAIS ═══════════════ */
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h1("7. Observações importantes"));
children.push(bullet([T("O CRATOS não assina nada. ", { bold: true }), T("Confirmar, enviar e assinar é sempre seu — em todos os convênios e na juntada.", {})]));
children.push(bullet([T("Confira antes de confirmar. ", { bold: true }), T("Valores, partes e restrições preenchidos pelo CRATOS devem ser conferidos na tela antes do seu clique.", {})]));
children.push(bullet([T("Login nos sistemas é seu. ", { bold: true }), T("Certificado digital e tokens são inseridos por você; o CRATOS espera e retoma.", {})]));
children.push(bullet([T("Leia o relatório do fim da fila. ", { bold: true }), T("É onde aparece o que precisa da sua atenção — um convênio pulado ou incompleto.", {})]));
children.push(bullet([T("Falha técnica nunca vira certidão negativa. ", { bold: true }), T("Se um sistema não responder como esperado, a certidão diz que a consulta não pôde ser concluída e deve ser repetida.", {})]));
children.push(bullet([T("Os arquivos ficam na sua pasta de downloads, ", {}), T("na subpasta CRATOS (ou a que você configurar).", {})]));
children.push(bullet([T("Junte antes de fechar a aba do processo. ", { bold: true }), T("Ao fechar a aba, os dados daquele processo são apagados do navegador (veja 5.10).", {})]));
children.push(bullet([T("Dados de processo não saem da sua máquina. ", { bold: true }), T("O CRATOS não tem servidor próprio nem telemetria — ele só opera os sistemas oficiais, com o seu login. A única consulta externa é a do Firefox à lista de versões do CRATOS, para a atualização automática, e nela não vai nenhum dado de processo.", {})]));

/* ═══════════════ 8. PERGUNTAS FREQUENTES ═══════════════ */
children.push(h1("8. Perguntas frequentes"));
const faq = [
  ["Instalei e o botão do CRATOS não aparece.", "Abra um processo no PJe, na tela de detalhes — o botão flutuante do CRATOS aparece nesse contexto. Se mesmo assim não surgir, confirme em about:addons se a extensão está ativada."],
  ["A extensão sumiu depois que fechei o Firefox.", "Isso acontece com versões não assinadas. Use o arquivo .xpi assinado que você recebeu."],
  ["Um convênio não avançou sozinho.", "Alguns exigem uma ação sua (login, confirmação, assinatura). Conclua no sistema e clique em \"Concluí — próximo\", ou use \"Pular\" para seguir e voltar depois."],
  ["A resposta do INFOJUD não veio.", "É normal: o INFOJUD responde depois, na caixa postal. Tente de novo mais tarde pelo botão \"Localizar resultado na caixa postal\"."],
  ["O CCS ou o PREVJUD não respondeu na hora.", "Também é normal. Use \"Coletar CCS\" no dia seguinte, ou \"Coletar PREVJUD\" mais tarde (veja 5.7)."],
  ["Fechei a aba do processo e a juntada não oferece mais as certidões.", "Ao fechar a aba, o CRATOS apaga os dados daquele processo. Os arquivos continuam na sua pasta de downloads: anexe à mão ou refaça o convênio (veja 5.10)."],
  ["O sistema do convênio estava fora do ar.", "Use \"Verificar disponibilidade do convênio\" no painel. Se a indisponibilidade se confirmar, você pode gerar a certidão (veja 5.8)."],
  ["Como recebo as versões novas?", "Sozinho: o Firefox atualiza o CRATOS automaticamente. Depois de cada atualização, o painel mostra o que mudou."],
  ["A certidão da juntada saiu com um documento a menos.", "Atualize para a versão mais recente do CRATOS. Se persistir, anote o processo e avise o responsável pela extensão."],
  ["Posso confiar que ele não vai enviar/assinar por engano?", "Sim. Por decisão de projeto, o CRATOS nunca clica em Enviar, Confirmar ou Assinar. Ele para antes do ato."],
];
faq.forEach(([q, a]) => {
  children.push(new Paragraph({ children: [T(q, { bold: true, color: AZUL })], spacing: { before: 120, after: 40 } }));
  children.push(corpo(a));
});

children.push(new Paragraph({ spacing: { before: 400 }, alignment: AlignmentType.CENTER, children: [T("— CRATOS • TRT18 —", { color: CINZA, size: 18 })] }));

/* ---------- documento ---------- */
const doc = new Document({
  creator: "TRT18",
  title: "CRATOS — Manual do Usuário",
  styles: {
    default: { document: { run: { font: "Calibri", size: 22, color: "222222" } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 30, bold: true, color: AZUL }, paragraph: { spacing: { before: 320, after: 140 } } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 25, bold: true, color: "2E5A88" }, paragraph: { spacing: { before: 240, after: 100 } } },
    ],
  },
  numbering: {
    config: [
      { reference: "lista", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 460, hanging: 260 } } } }] },
      { reference: "passos", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 460, hanging: 260 } } } }] },
    ],
  },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1200, bottom: 1200, left: 1440, right: 1440 } } },
    children,
  }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync("CRATOS - Manual do Usuario.docx", buf);
  console.log("OK:", buf.length, "bytes");
});
