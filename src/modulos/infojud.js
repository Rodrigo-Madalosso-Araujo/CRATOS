/*
 * infojud.js — módulo INFOJUD do CRATOS (consulta única, processo em tela).
 *
 * Origem: extrai o MIOLO da extensão InfoJOB v2.2.5 (Rodrigo Madalosso Araujo / TRT18,
 * Leandro Vinícius de Magalhães Rodrigues / TRT19), já aprovada e em produção no Chrome.
 * Aqui NÃO há planilha nem lote geral: uma parte por vez, a partir da captura do PJe.
 *
 * A automação do eCAC (registrar pedido + coletar da caixa postal) roda no content
 * script do eCAC (conteudo/ecac-infojud.js), portado do content.js do InfoJOB.
 * Este arquivo é a PONTE: contrato do módulo + tradução dos dados do PJe para o
 * formato que o miolo espera + config. A automação em si entra nos próximos pedaços.
 *
 * ====== PEDAÇO 1 de N: casca, config e mapeamento. Sem automação ainda. ======
 */

/* ⚠️ O OBJETO PRECISA DE NOME. Até 21/08 este arquivo passava um literal ANÔNIMO
   direto para `Registro.adicionar({...})` — e o `background.js` chamava
   `ModuloInfojud.mapearParte(...)`, um identificador que não existia em lugar
   nenhum. Resultado: ReferenceError no instante em que alguém rodava o INFOJUD
   pelo painel, ANTES de qualquer aba abrir. Era isto que fazia "a extensão não
   iniciar o eCAC" — e nenhum teste pegava, porque nenhum teste chamava o
   caminho do orquestrador.
   Todos os outros módulos já nomeiam o seu (ModuloSAB, ModuloCNIB, …); o
   INFOJUD era o único fora do padrão. */
/* Opções finas do eFinanceira — MESMOS textos das <option> do formulário do eCAC
   (o incluirPedido casa por TEXTO). O padrão segue a orientação do Tribunal para um
   relatório detalhado: Tipo de conta = Todas, Tipo de relação = Todas, Exibir câmbio
   = Sim, Tipo de extrato = Contas e movimentações. O usuário pode alterar. */
const EFIN_CONTA   = ["Conta de Depósito", "Conta de Custódia", "Conta de Investimento",
                      "Conta de Seguro", "Consórcio", "Conta em moeda estrangeira", "Todas"];
const EFIN_RELACAO = ["Titular", "Procurador", "Representante legal", "Intermediado",
                      "Beneficiário Final", "Doador - Empréstimo de TVM BTC",
                      "Tomador - Empréstimo de TVM BTC", "Todas"];
const EFIN_EXTRATO = ["Contas e movimentações", "Somente da lista de contas"];
const EFIN_CAMBIO  = ["Não", "Sim"];

const ModuloInfojud = {
  nome: "infojud",
  rotulo: "INFOJUD (eCAC/Receita)",
  requer: ["cpfcnpj"],
  suportaLote: false,

  /* Config fixa nas Preferências (decisão: o painel do processo não ajusta tipos).
     Espelha os tipos do InfoJOB, com foco nos de retorno rápido que o Rodrigo citou:
     DIRPF (IRPF), DOI, DITR, DIMOB, DECRED. eFinanceira fica disponível mas é a
     assíncrona típica — quando a resposta não chega na hora, a coleta avisa. */
  // Config INDEPENDENTE por NI (igual InfoJOB): grupos "cpf" e "cnpj" separados.
  // Cada grupo lista só os tipos aplicáveis àquele NI. Tipos comuns aparecem nos dois
  // e podem ter anos diferentes por NI. A tela de opções renderiza dois blocos.
  config: {
    _grupos: {
      cpf: {
        rotulo: "Consultas para CPF (pessoa física)",
        campos: {
          dirpf:   { tipo: "toggle_anos", padrao: { ativo: true,  anos: 3 }, rotulo: "DIRPF / IRPF — últimos anos" },
          ditr:    { tipo: "toggle_anos", padrao: { ativo: false, anos: 2 }, rotulo: "DITR — últimos anos" },
          doi:     { tipo: "toggle",      padrao: { ativo: false },          rotulo: "DOI — operações imobiliárias" },
          decred:  { tipo: "toggle_anos", padrao: { ativo: false, anos: 2 }, rotulo: "DECRED — últimos anos" },
          dimob:   { tipo: "toggle_anos", padrao: { ativo: false, anos: 2 }, rotulo: "DIMOB — últimos anos" },
          infocad: { tipo: "toggle",      padrao: { ativo: false },          rotulo: "Informações Cadastrais" },
          efin:    { tipo: "toggle_anos", padrao: { ativo: false, anos: 1 }, rotulo: "eFinanceira — últimos anos [assíncrona]" },
          efin_conta:   { tipo: "select", padrao: "Todas", opcoes: EFIN_CONTA,   rotulo: "eFinanceira · Tipo de conta" },
          efin_relacao: { tipo: "select", padrao: "Todas", opcoes: EFIN_RELACAO, rotulo: "eFinanceira · Tipo de relação" },
          efin_cambio:  { tipo: "select", padrao: "Sim",   opcoes: EFIN_CAMBIO,  rotulo: "eFinanceira · Exibir câmbio" },
          efin_extrato: { tipo: "select", padrao: "Contas e movimentações", opcoes: EFIN_EXTRATO, rotulo: "eFinanceira · Tipo de extrato" },
        },
      },
      cnpj: {
        rotulo: "Consultas para CNPJ (pessoa jurídica)",
        campos: {
          dipj:    { tipo: "toggle_anos", padrao: { ativo: false, anos: 2 }, rotulo: "DIPJ / PJ SIMPL — últimos anos" },
          ecf:     { tipo: "toggle_anos", padrao: { ativo: false, anos: 2 }, rotulo: "ECF (substitui IRPJ) — últimos anos" },
          ditr:    { tipo: "toggle_anos", padrao: { ativo: false, anos: 2 }, rotulo: "DITR — últimos anos" },
          doi:     { tipo: "toggle",      padrao: { ativo: false },          rotulo: "DOI — operações imobiliárias" },
          decred:  { tipo: "toggle_anos", padrao: { ativo: false, anos: 2 }, rotulo: "DECRED — últimos anos" },
          dimob:   { tipo: "toggle_anos", padrao: { ativo: false, anos: 2 }, rotulo: "DIMOB — últimos anos" },
          cpmf:    { tipo: "toggle",      padrao: { ativo: false },          rotulo: "CPMF" },
          infocad: { tipo: "toggle",      padrao: { ativo: false },          rotulo: "Informações Cadastrais" },
          efin:    { tipo: "toggle_anos", padrao: { ativo: false, anos: 1 }, rotulo: "eFinanceira — últimos anos [assíncrona]" },
          efin_conta:   { tipo: "select", padrao: "Todas", opcoes: EFIN_CONTA,   rotulo: "eFinanceira · Tipo de conta" },
          efin_relacao: { tipo: "select", padrao: "Todas", opcoes: EFIN_RELACAO, rotulo: "eFinanceira · Tipo de relação" },
          efin_cambio:  { tipo: "select", padrao: "Sim",   opcoes: EFIN_CAMBIO,  rotulo: "eFinanceira · Exibir câmbio" },
          efin_extrato: { tipo: "select", padrao: "Contas e movimentações", opcoes: EFIN_EXTRATO, rotulo: "eFinanceira · Tipo de extrato" },
        },
      },
    },

    // Configurações gerais (fora dos grupos de NI): cabeçalho do eCAC + pasta.
    // TEXTO LIVRE (nunca lista fixa) — nada hardcoded no TRT18, para nacionalização.
    /* ═══ LISTA DE VARAS DO eCAC (TRT18) — colada do `select[name=siglavara]`
       em 02/09/2026, a pedido da STI. 51 varas.
       ⚠ O VALOR GUARDADO É O CÓDIGO ("001"), não o nome. Três motivos:
         · no eCAC o `option value` vem preenchido com ESPAÇOS à direita
           ("001                 ", 20 caracteres) — comparar nome com nome é
           frágil de um jeito que falha calado;
         · o nome muda (a Receita já grafa duas varas em CAIXA ALTA e abrevia
           "São L. de M. Belos"); o código não;
         · texto livre casava por `includes`: quem escrevesse "Vara do Trabalho
           de Goiânia" sem o ordinal pegava a 1ª, sem avisar.
       Os rótulos abaixo estão EXATAMENTE como o eCAC exibe, maiúsculas
       inclusive — quem confere a tela tem de reconhecer o que escolheu.
       >>> DÉBITO DE NACIONALIZAÇÃO ASSUMIDO: esta lista é do TRT18. A saída sem
           débito está anotada nas notas (colher as opções da própria tela) e
           fica para a nacionalização, que vai demorar. */
    vara: {
      tipo: "lista",
      opcoes: [
          { valor: "001", rotulo: "001 — 1ª Vara do Trabalho de Goiânia" },
          { valor: "002", rotulo: "002 — 2ª Vara do Trabalho de Goiânia" },
          { valor: "003", rotulo: "003 — 3ª Vara do Trabalho de Goiânia" },
          { valor: "004", rotulo: "004 — 4ª Vara do Trabalho de Goiânia" },
          { valor: "005", rotulo: "005 — 5ª Vara do Trabalho de Goiânia" },
          { valor: "006", rotulo: "006 — 6ª Vara do Trabalho de Goiânia" },
          { valor: "007", rotulo: "007 — 7ª Vara do Trabalho de Goiânia" },
          { valor: "008", rotulo: "008 — 8ª Vara do Trabalho de Goiânia" },
          { valor: "009", rotulo: "009 — 9ª Vara do Trabalho de Goiânia" },
          { valor: "010", rotulo: "010 — 10ª Vara do Trabalho de Goiânia" },
          { valor: "011", rotulo: "011 — 11ª Vara do Trabalho de Goiânia" },
          { valor: "012", rotulo: "012 — 12ª Vara do Trabalho de Goiânia" },
          { valor: "013", rotulo: "013 — 13ª Vara do Trabalho de Goiânia" },
          { valor: "014", rotulo: "014 — 14ª Vara do Trabalho de Goiânia" },
          { valor: "015", rotulo: "015 — 15ª Vara do Trabalho de Goiânia" },
          { valor: "016", rotulo: "016 — 16ª Vara do Trabalho de Goiânia" },
          { valor: "017", rotulo: "017 — 17ª Vara do Trabalho de Goiânia" },
          { valor: "018", rotulo: "018 — 18ª Vara do Trabalho de Goiânia" },
          { valor: "051", rotulo: "051 — 1ª Vara do Trabalho de Anápolis" },
          { valor: "052", rotulo: "052 — 2ª Vara do Trabalho de Anápolis" },
          { valor: "053", rotulo: "053 — 3ª Vara do Trabalho de Anápolis" },
          { valor: "054", rotulo: "054 — 4ª Vara do Trabalho de Anápolis" },
          { valor: "081", rotulo: "081 — 1ª Vara do Trabalho de Aparecida de Goiânia" },
          { valor: "082", rotulo: "082 — 2ª Vara do Trabalho de Aparecida de Goiânia" },
          { valor: "083", rotulo: "083 — 3ª VARA DO TRABALHO DE APARECIDA DE GOIÂNIA" },
          { valor: "101", rotulo: "101 — 1ª Vara do Trabalho de Rio Verde" },
          { valor: "102", rotulo: "102 — 2ª Vara do Trabalho de Rio Verde" },
          { valor: "103", rotulo: "103 — 3ª Vara do Trabalho de Rio Verde" },
          { valor: "104", rotulo: "104 — 4ª Vara do Trabalho de Rio Verde" },
          { valor: "111", rotulo: "111 — Vara do Trabalho de Jataí" },
          { valor: "121", rotulo: "121 — 1ª Vara do Trabalho de Itumbiara" },
          { valor: "122", rotulo: "122 — 2ª Vara do Trabalho de Itumbiara" },
          { valor: "128", rotulo: "128 — Vara do Trabalho de Goiatuba" },
          { valor: "129", rotulo: "129 — Vara do Trabalho de Quirinópolis" },
          { valor: "131", rotulo: "131 — Vara do Trabalho de Luziânia" },
          { valor: "141", rotulo: "141 — Vara do Trabalho de Catalão" },
          { valor: "151", rotulo: "151 — Vara do Trabalho de Iporá" },
          { valor: "161", rotulo: "161 — Vara do Trabalho de Caldas Novas" },
          { valor: "171", rotulo: "171 — Vara do Trabalho de Ceres" },
          { valor: "181", rotulo: "181 — Vara do Trabalho de São L. de M. Belos" },
          { valor: "191", rotulo: "191 — Vara do Trabalho de Mineiros" },
          { valor: "201", rotulo: "201 — Vara do Trabalho de Uruaçu" },
          { valor: "211", rotulo: "211 — Vara do Trabalho de Formosa" },
          { valor: "221", rotulo: "221 — Vara do Trabalho de Goiás" },
          { valor: "231", rotulo: "231 — Vara do Trabalho de Posse" },
          { valor: "241", rotulo: "241 — Vara do Trabalho de Valparaíso" },
          { valor: "251", rotulo: "251 — Vara do Trabalho de Porangatu" },
          { valor: "261", rotulo: "261 — Vara do Trabalho de Goianésia" },
          { valor: "271", rotulo: "271 — Vara do Trabalho de Pires do Rio" },
          { valor: "281", rotulo: "281 — Vara do Trabalho de Inhumas" },
          { valor: "291", rotulo: "291 — VARA DO TRABALHO DE PALMEIRAS" },
      ],
      padrao: "",
      rotulo: "Vara (a que assina a solicitação no eCAC)",
    },
    tipoProcesso:  { tipo: "texto", padrao: "Ação Trabalhista", rotulo: "Tipo de processo (eCAC)" },
    justificativa: { tipo: "texto", padrao: "execução",         rotulo: "Justificativa (eCAC)" },
    magistrado:    { tipo: "texto", padrao: "",                 rotulo: "Magistrado (opcional — nome no eCAC)" },
    pastaDownload: { tipo: "texto", padrao: "CRATOS", rotulo: "Subpasta de downloads (padrão: CRATOS)" },
    /* ⚠ A Receita NÃO responde na hora: o retorno cai na caixa postal minutos ou
       horas depois. Então, na maioria das execuções, a verificação automática vai
       dizer "ainda não respondeu" — e isso é o certo, não uma falha. Quem achar a
       frase repetitiva desliga aqui. */
    colheitaAutomatica: {
      tipo: "escolha",
      opcoes: [
        { valor: "colher", rotulo: "Verificar e colher as respostas automaticamente" },
        { valor: "verificar", rotulo: "Só verificar, e me oferecer o botão de colher" },
        { valor: "nao", rotulo: "Não verificar (uso o botão do painel quando quiser)" },
      ],
      padrao: "colher",
      rotulo: "Ao terminar a fila de convênios",
    },
  },

  resumirConfig(cfg) {
    // cfg pode ser o grupo (cpf/cnpj) ou o objeto completo. Resume os tipos ativos.
    const grupos = [];
    if (cfg?.cpf || cfg?.cnpj) {
      if (cfg.cpf) grupos.push(["CPF", cfg.cpf]);
      if (cfg.cnpj) grupos.push(["CNPJ", cfg.cnpj]);
    } else {
      grupos.push(["", cfg || {}]);
    }
    const partes = [];
    for (const [rot, c] of grupos) {
      const ativos = [];
      const on = (k) => c[k]?.ativo;
      const an = (k, d) => (c[k]?.anos ?? d);
      if (on("dirpf"))  ativos.push(`DIRPF ${an("dirpf", 3)}a`);
      if (on("dipj"))   ativos.push(`DIPJ ${an("dipj", 2)}a`);
      if (on("ecf"))    ativos.push(`ECF ${an("ecf", 2)}a`);
      if (on("ditr"))   ativos.push(`DITR ${an("ditr", 2)}a`);
      if (on("doi"))    ativos.push("DOI");
      if (on("decred")) ativos.push(`DECRED ${an("decred", 2)}a`);
      if (on("dimob"))  ativos.push(`DIMOB ${an("dimob", 2)}a`);
      if (on("cpmf"))   ativos.push("CPMF");
      if (on("infocad"))ativos.push("Info.Cadastrais");
      if (on("efin"))   ativos.push(`eFinanceira ${an("efin", 1)}a`);
      if (ativos.length) partes.push((rot ? rot + ": " : "") + ativos.join(", "));
    }
    return partes.length ? partes.join(" | ") : "(nenhum tipo ativo)";
  },

  /* Traduz uma parte do CRATOS ({nome, cpfcnpj, tipoPessoa, ...}) + o processo
     capturado para o formato que o miolo do InfoJOB consome ({processo, nome,
     nomeAbrev, ni, tipo}). É o ponto onde as duas peças se encaixam. */
  mapearParte(parte, processo, cfg) {
    const ni = String(parte.cpfcnpj || "").replace(/\D/g, "");
    const tipo = parte.tipoPessoa === "juridica" ? "CNPJ" : "CPF";
    /* Aceita o OBJETO do processo ou só o NÚMERO. O orquestrador passava
       `processo.numero` (string) onde isto esperava o objeto, e o `?.numero`
       devolvia undefined em silêncio — o pedido ia para o eCAC sem número de
       processo. Terceiro desencontro da mesma função, mesmo dia. */
    const numero = typeof processo === "string" ? processo : (processo && processo.numero) || "";
    return {
      processo: numero,
      nome: parte.nome || "",
      nomeAbrev: doisPrimeirosNomes(parte.nome),
      ni,
      tipo,
    };
  },

  /* PLACEHOLDER — a automação real entra no próximo pedaço.
     Por ora valida o mapeamento e devolve o pedido montado, sem disparar nada. */
  async executar(parte, ctx) {
    const pedido = this.mapearParte(parte, ctx?.processo, ctx?.config);
    const niOk = (pedido.tipo === "CPF" && pedido.ni.length === 11) ||
                 (pedido.tipo === "CNPJ" && pedido.ni.length === 14);
    if (!niOk) {
      return { status: "erro", erro: `${pedido.tipo} inválido: ${pedido.ni || "(vazio)"}` };
    }
    return { status: "pendente_implementacao", pedido };
  },

  async coletarResultado(bloco, ctx) {
    const linhas = bloco.map((r) =>
      r.status === "erro"
        ? `- ${r.pedido?.nome || "?"}: ERRO — ${r.erro}`
        : `- ${r.pedido?.nome || "?"} (${r.pedido?.ni || "?"}): ${r.status}`
    );
    return {
      textoCertidao:
        "CERTIDÃO — Consulta INFOJUD (eCAC/Receita Federal)\n" +
        `Parâmetros: ${this.resumirConfig(ctx?.config)}\n` +
        "Partes consultadas:\n" + linhas.join("\n"),
    };
  },
};

Registro.adicionar(ModuloInfojud);

/* Helper portado do InfoJOB (idêntico ao original). */

function doisPrimeirosNomes(nomeCompleto) {
  const tokens = (nomeCompleto || "").trim().split(/\s+/);
  const validos = tokens.filter((t) => !t.includes("."));
  return validos.slice(0, 2).join(" ");
}
