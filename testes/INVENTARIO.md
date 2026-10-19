# Inventário das suítes — o que cada uma trava

⛔ **Em 21/08/2026 as suítes foram perdidas.** Elas existiram, rodaram e ficaram
verdes na 1.0.7 (18 arquivos, 497 asserções), mas viviam dentro do contêiner da
sessão do Claude e nunca foram entregues como arquivo. O contêiner foi reciclado.

Sobreviveu **uma**: `teste-cnib.js`, na versão da 0.3.0 (331 linhas, 20
asserções — hoje seriam 28), porque foi salva à mão na Área de Trabalho.

> **Regra que nasceu disto:** teste novo se entrega como ARQUIVO, nesta pasta, na
> mesma resposta em que nasce. "Rodei aqui, tudo verde" não é entrega.

Este arquivo é a **especificação de reconstrução**. Cada suíte se reescreve
quando o módulo dela for tocado, e só vale se REPROVAR a versão anterior — o
método que travou todo bug real desta lista.

---

## Situação

### As que RODAM hoje (19/10/2026 — 1.6.5 = 1.6.4 + entrada do CCS): 37 suítes, 855 asserções

>>> 1.6.5: o CCS ficou EM BRANCO depois do login (campo, 19/10) — o CRATOS abria uma página
    interna e a volta do ADFS caía nela sem sessão. Agora abre pela ENTRADA (iniciar.do) e,
    se ainda cair em página vazia, volta UMA vez e depois para pedindo limpar os cookies do BCB.
    Nova `teste-ccs-entrada.js` (19), que reprova a 1.6.4 com 12 falhas (inclui o teto que
    faltava na coleta: tela ≠ 0801 navegava sem limite). `teste-ccs-requisicao.js` ajustada.

### RODARAM na 1.6.4 (19/10/2026 — 1.6.3 + PDF do CCS + chip): 36 suítes, 836 asserções

>>> No repositório estão de volta as três suítes da 1.4.1 que se perderam do disco
    (`teste-censec-partes.js`, `teste-infojud-recoleta.js`, `teste-opcoes-rotulo.js`)
    e o `teste-painel-liga-desliga.js` com 26 asserções (1.4.2). Todas passam na 1.6.4.

>>> 1.6.4: (a) CCSFW0802 real — nome <req>-<AAAAMMDDhhmm>-<login>.pdf, coluna só com a data;
    a 1.6.3 lia a coluna (meia-noite) e nunca aceitava o PDF. Agora serve o PDF gerado DEPOIS
    DA ÚLTIMA RESPOSTA (ou pelo clique), o mais recente; sem "documento" falso no nome.
    `teste-ccs-coleta.js` 50 → 58 (inclui o caso do print: PDF de tentativa anterior aceito).
    (b) Chip "CCS - aguardar resposta" ligado por padrão, só depois do envio confirmado;
    `teste-ccs-requisicao.js` 38 → 42. Ambas reprovam a 1.6.3.

### RODARAM na 1.6.3 (19/10/2026 — 1.6.2 + ajustes do teste de campo): 33 suítes, 783 asserções

>>> 1.6.3 (teste de campo de 19/10):
    • CCS coleta — a 0801 REAL mostra um CPF/CNPJ por vez, em tabelas aninhadas, e o status
      vem como "Não solicitado"/"Pendente"/data. `teste-ccs-coleta.js` 43 → 50: fixture da
      coleta refeito no desenho real (reprova a 1.6.2 com "não reconheci"); leitura do
      documento selecionado, visita aos demais SÓ para ler, soma, certidão agrupada por
      executado, nome do arquivo pelo executado (não pelo exequente).
    • `teste-renajud-erro-interno.js` (9, novo): erro interno do RENAJUD-WS na retirada →
      faixa orienta o RENAJUD antigo + ID de rastreabilidade; inclusão → "tente mais tarde";
      demais recusas trazem a mensagem do servidor.
    • `teste-serasajud-nomes.js` (5, novo): Autor/Réu casam ignorando pontuação ("… LTDA - ME"
      × "… LTDA ME") ou pela grafia da tabela de titulares; nada casa → não escolhe às cegas.
    • Recon 0.2.1 (pasta recon/, fora da bateria do CRATOS): link malformado não derruba a
      extração — `recon/testes/teste-recon-estrutura.js` 29 → 32.

### RODARAM na 1.6.2 (19/10/2026 — 1.6.1 + baixa sem restrição): 31 suítes, 762 asserções

>>> 1.6.2: baixa sem restrição ativa no CNIB e no RENAJUD passa a gerar certidão (relato do
    Rodrigo, 16/10; telas reais nos prints de 19/10). Nova suíte `teste-baixa-nada-a-cancelar.js`
    (35): RENAJUD "Nenhuma restrição encontrada" → certidão + pulso; aviso velho não vale;
    "Necessário informar…"/timeout e número que não fixa → faixa, nunca certidão; GET não vira
    "recusou". CNIB "não localizado" (+ popup "Não identificada") → certidão; popup com
    instituição nomeada → faixa sem certidão; "já canceladas" → certidão com protocolos.
    Consolidada de baixa separa "procedi ao cancelamento" de "não foram localizadas
    restrições ativas a cancelar". Reprova a 1.6.1.
    Achado junto: o `_faixa` do RENAJUD mandava o texto no lugar do módulo (faixas saíam
    "CRATOS — undefined"); os mocks de `teste-renajud-folha.js`/`-multiparte.js` imitavam a
    assinatura errada — alinhados à API real e com asserção nova (folha 35 → 36).
    `teste-painel-encadeamento.js`: a asserção "pulso só no concluido" passou à regra nova
    (também nada_a_cancelar/ja_canceladas; nunca sem_resposta/outra_instituicao).

### RODARAM na 1.6.1 (15/10/2026 — endurecimento HTML + CCS): 30 suítes, 726 asserções

>>> 1.6.1: módulo CCS (Cadastro de Clientes do SFN / Bacen). Três suítes novas, todas com
    telas FICTÍCIAS montadas a partir do mapa do recon (`testes/fixture-ccs.js`; o harness
    comum é `testes/harness-ccs.js` — nenhum dos dois é suíte):
      `teste-ccs-requisicao.js` (38) — módulo de fundo, 0501/0502/0801, padrões de fábrica,
        termo NÃO aceito sem a Preferência, trava de processo, sem relacionamento, fiação;
      `teste-ccs-marcacao.js` (19) — 0601: sufixo, critério todas/sem Data Fim, linha
        escondida marcada, nunca selecionarTodos(), envio só com marcação limpa, sufixo
        (com CPF) fora de faixa/console/storage;
      `teste-ccs-coleta.js` (43) — certidão de envio (LGPD, rastro, divergência), registro,
        coleta direta, arquivo só com data de geração POSTERIOR ao clique, %PDF pelos
        bytes, certidão do estado atual (quem falta), estado 1/dia, plano B em janelas de
        30 dias, background e sigilo.
    As três reprovam a 1.5.4 (sem módulo CCS). `teste-seguranca-html.js` segue 34/34 com o
    CCS dentro da varredura.

### Endurecimento HTML (15/10/2026 — entra na versão seguinte à 1.5.4): 27 suítes, 626 asserções

>>> 1.5.5 (passe de segurança pedido pela DSC, chamado interno): todo dado externo que vai
    para a tela como HTML passa por escape. Helper único `CratosHTML` em `comum/storage.js`
    (o arquivo carregado em todo contexto): `html```, que escapa toda interpolação, e
    `CratosHTML.definir(el, frag)`, o ÚNICO ponto de escrita de HTML dinâmico (monta os
    nós por DOMParser, sem innerHTML). Revisadas as 41 ocorrências de innerHTML em
    `painel.js`, `opcoes.js`, `serasajud.js` e `sab.js`; as 27 com conteúdo dinâmico
    passaram para `definir(html``)`. Eram crus na 1.5.4: polo e documento da parte, dados da
    caixa postal da Receita, data do cálculo no popup do SAB, valores salvos nas
    Preferências (o escapeAttr antigo só tratava aspas). ESLint ganhou o
    `eslint-plugin-no-unsanitized` com a configuração da Mozilla (sem escapers):
    27 → 0 achados; addons-linter: UNSAFE_VAR_ASSIGNMENT 28 → 0. Nova suíte
    teste-seguranca-html.js (34). Nenhuma outra suíte mudou de resultado.

### As que RODAM hoje (29/09/2026 — 1.5.4): 26 suítes, 592 asserções

>>> 1.5.4: SerasaJUD sem cálculo nos autos deixou de abortar — o background marca
    valorPendente/dataPendente e abre a aba; o content script mostra um popup (estilo SAB)
    pedindo valor e/ou data, com espera SEM timeout e botão "Cancelar (faço à mão)". A
    certidão registra origem manual. Nova suíte teste-serasajud-manual.js (31).

### RODARAM na 1.5.3 (28/09/2026): 25 suítes, 561 asserções

>>> 1.5.3: o eFinanceira não-pronto SEM link (linha `resultadoSolicitacao` sem lupa, só o
    texto "processamento ainda não concluído") também vira a certidão "Consolidando
    resultados" — `lerItensResultado` parou de descartar a linha assíncrona sem `<a>`, e
    `colherUmItem` emite a certidão. Mais um guarda anti-duplicação (`fabricarCertidao
    EfinPendente` checa o Cofre antes de emitir: 2 coletas no mesmo dia = 1 certidão).
    Fecha o sub-caso do link-ausente que a 1.5.2 (link-presente-corpo-vazio) não cobria.

>>> 1.5.2: (1) OVERLAY central de coleta — cortina "As certidões estão sendo baixadas"
    no CENTRO da tela do e-CAC durante a colheita (só INFOJUD, bloqueia clique, some no
    fim ou quando uma faixa de parada aparece); `CratosOverlay` vive em `comum/faixa.js`.
    (2) eFinanceira NÃO-PRONTO: quando o link da Receita devolve corpo que NÃO é zip real
    (página "em processamento" / blob vazio), o CRATOS emite a certidão "Consolidando
    resultados" em vez de salvar um `.zip` bruto — que a juntada tentava anexar e o PJe
    recusava com ARQ-041 "Arquivo deve ser PDF" (bug de campo, print do Rodrigo em 25/09).
    Regra de ferro preservada: zip real ilegível continua ERRO, nunca certidão falsa.

>>> 1.5.1 consertou DOIS bugs de campo do eFinanceira: (1) o pedido não carrega mais
    `ano` (carregava → o incluirPedido tentava o dropdown de ano do eCAC, que o
    eFinanceira não tem, e travava a solicitação); (2) a abertura do zip saiu do
    content script para o BACKGROUND — no sandbox/Xray do Firefox o DecompressionStream
    recusava o buffer ("Value could not be converted to ArrayBufferView"), erro que o
    teste em Node não pegava. Agora o unzip roda no background (mesmo ambiente do Node)
    e a lógica de nome está em `unzip.js: rotularEfinPdfs`, testável direto.

| suíte | asserções | tempo |
|---|---|---|
| `teste-baixa-nada-a-cancelar.js` | 35 | rápida |
| `teste-ccs-coleta.js` | 58 | rápida |
| `teste-ccs-entrada.js` | 19 | rápida |
| `teste-ccs-marcacao.js` | 19 | rápida |
| `teste-ccs-requisicao.js` | 42 | rápida |
| `teste-censec-partes.js` | 15 | rápida |
| `teste-cnib-detalhe.js` | 81 | rápida |
| `teste-cnib.js` | 20 | ⏳ **~5 min** (usa relógio real) |
| `teste-desligado.js` | 4 | rápida |
| `teste-ecac-aviso-encerramento.js` | 9 | rápida |
| `teste-infojud-efin-botao.js` | 8 | rápida |
| `teste-infojud-efin-pendente.js` | 21 | rápida |
| `teste-infojud-efin-zip.js` | 7 | rápida |
| `teste-infojud-efinanceira.js` | 14 | rápida |
| `teste-infojud-entrada-colheita.js` | 49 | rápida |
| `teste-infojud-lotes.js` | 31 | rápida |
| `teste-infojud-overlay.js` | 12 | rápida |
| `teste-infojud-pulso.js` | 10 | rápida |
| `teste-infojud-recoleta.js` | 8 | rápida |
| `teste-infojud-vara.js` | 24 | rápida |
| `teste-juntada-anexos.js` | 61 | rápida |
| `teste-opcoes-rotulo.js` | 9 | rápida |
| `teste-opcoes-vara.js` | 17 | rápida |
| `teste-painel-autoscroll.js` | 3 | rápida |
| `teste-painel-encadeamento.js` | 58 | rápida |
| `teste-painel-liga-desliga.js` | 26 | rápida |
| `teste-painel-maispje.js` | 10 | rápida |
| `teste-renajud-erro-interno.js` | 9 | rápida |
| `teste-renajud-folha.js` | 36 | rápida |
| `teste-renajud-multiparte.js` | 23 | rápida |
| `teste-sab-atualizacao.js` | 23 | rápida |
| `teste-sab-conclusao-unica.js` | 4 | rápida |
| `teste-sab-marcar-partes.js` | 9 | rápida |
| `teste-seguranca-html.js` | 34 | rápida |
| `teste-serasajud-data.js` | 11 | rápida |
| `teste-serasajud-manual.js` | 31 | rápida |
| `teste-serasajud-nomes.js` | 5 | rápida |

>>> As três suítes da 1.4.1 que chegaram a se perder do disco de trabalho foram
    recuperadas do repositório e estão na tabela acima, assim como o
    `teste-painel-liga-desliga.js` com 26 asserções (checagem do ícone SVG).

>>> ⛔ Ao rodar a bateria, **confira que cada suíte imprimiu o próprio placar.**
    O `teste-cnib.js` passou meses explodindo com `ENOENT` antes da primeira
    asserção — e crash não é reprovação: não diz nada sobre o código e se
    confunde com ruído no log. Suíte que não roda é pior que suíte nenhuma,
    porque ocupa o lugar de uma que rodaria. As três causas conhecidas de morte
    silenciosa, todas já vistas neste projeto: **caminho** relativo ao diretório
    de chamada (use `CRATOS_SRC`), **namespace** velho (`carrasco:` em vez de
    `cratos:`), e arquivo de `comum/` criado depois do harness e nunca carregado
    (`faixa.js`, `relatorio.js`).
    Quarta causa, vista em 15/10/2026: **API do navegador que o jsdom não tem**.
    O `teste-cnib.js` morria no passo 1 com "CSS is not defined" (`CSS.escape`
    existe no Firefox, não no jsdom). Placar 4/20 com cara de reprovação, mas era
    crash: o harness agora faz polyfill de `CSS.escape` e voltou a 20/20.

### Ainda a refazer

| suíte | asserções | situação |
|---|---|---|
| `teste-cnib-baixa.js` | 30 | refazer |
| `teste-painel.js` | 10 | refazer |
| `teste-opcoes.js` | 31 | refazer |
| `teste-pdf.js` | 39 | refazer |
| `teste-censec.js` | 64 | refazer |
| `teste-api-pje.js` | 19 | refazer |
| `teste-serasajud.js` | 84 | refazer |
| `teste-mensagens.js` | 11 | refazer |
| `teste-relatorio.js` | 24 | refazer |
| `teste-diario.js` | 33 | refazer |
| `teste-marcacoes.js` | 21 | refazer |
| `teste-juntada.js` | 25 | refazer |
| `teste-infojud-fila.js` | 20 | refazer |
| `teste-ecac-entrada.js` | 12 | refazer |
| `teste-infojud-pedidos.js` | 14 | refazer |
| `teste-infojud-erro-ecac.js` | 21 | **prioridade** — usa `CRATOS_SRC=` |
| `teste-infojud-postback.js` | 11 | **prioridade** — usa `CRATOS_SRC=` |

---

## O que cada uma tem de pegar

**`teste-cnib.js`** — inclusão. DOM que imita Blazor: o "servidor" reescreve o
`.value` a partir do modelo, e o modelo só muda com evento `change` — quem
escrever sem disparar evento vê o valor sumir. Ids invertidos do `KnowValue`
(`#hasKnownDebit` = "Não"). Botão de incluir executado só com ícone. O campo de
CPF/CNPJ **não se limpa** entre inclusões. Overlay de queda de conexão.
*Falta na cópia atual:* o comprovante da inclusão por `fetch` same-origin (o
"Imprimir" virou `onclick` sem `href`) e o plano B do clique — os dois caminhos.

**`teste-cnib-baixa.js`** — cancelamento total. Multi-página com máquina de
estado pela rota. Ordem já cancelada volta com checkbox **marcado e travado** →
filtrar, e se todas estiverem assim avisar "nada a cancelar" em verde, não como
erro. Tabela com "Histórico da Ordem" **aninhado** — só linhas com `.orderCheck`,
lendo apenas células filhas diretas. Popup do Imprimir (não automatizar em
`window.opener`). Download do comprovante.

**`teste-painel.js`** — seleção de partes no painel do PJe.

**`teste-opcoes.js`** — tela de Preferências, protege TODOS os convênios. Além
disso: lê o `manifest.json` e, para cada ícone declarado (`icons` e
`browser_action.default_icon`), cobra o arquivo no disco **e confere
largura/altura lendo o cabeçalho do PNG** — ícone de 32 salvo com 16px de verdade
não avisa ninguém. Também lê os `src="../..."` do `opcoes.html`/`opcoes.js` e
cobra o arquivo. Uma asserção reprova se voltar a frase de privacidade do InfoJOB
("removidos automaticamente ao concluir cada operação") — aqui o estado é
sobrescrito, não apagado.

**`teste-pdf.js`** — `gerarPDFTexto`. Multi-página, margem dos **dois** lados,
linha órfã. Quebra por **largura real** (AFM das base-14), não por contagem de
caracteres: a linha de cartório do CENSEC dava 653pt numa folha de 595pt. Caixa
útil 495pt. Título comprido ENCOLHE (16→10pt) em vez de quebrar. Valida por fora
com `pypdf`.

**`teste-censec.js`** — grampo de API, fluxo do CEP, captcha, negativa, recarga
automática na primeira abertura, e o módulo (quem entra na fila) exercitado
direto, sem DOM. Pontos duros: `campoDocumento()` em cascata (formcontrolname →
máscara `000.000.000-00` → rótulo) e **nunca** id gerado pelo Angular; presença
de `<spa-captcha>` **não** é desafio ativo (detectar por geometria, e só para
ESTENDER prazo); HTTP de erro **nunca** vira certidão negativa; entram na fila as
partes marcadas de **qualquer polo**, com dedupe por documento.

**`teste-api-pje.js`** — as duas datas do PJe-Calc.

**`teste-serasajud.js`** — inclusão e baixa. Máscara por paste DE VERDADE
(ClipboardEvent + DataTransfer), botões que nascem cinza, diálogos "Entendi",
datepicker, e a PARADA. Preferência que não pôde ser aplicada (o prazo) tem de
virar faixa âmbar, não silêncio.

**`teste-mensagens.js`** — varre as mensagens de parada. Reprova vocabulário
interno ("passo 4 do wizard" — a numeração é invenção nossa, o site mostra
nomes), reprova rótulo sem saída, reprova `console.warn + return` sem faixa, e
confere que todo content script que usa `CratosFaixa` tem `comum/faixa.js`
declarado no manifesto.

**`teste-relatorio.js`** — o relatório de problema. Uma asserção reprova qualquer
`fetch`/`XHR`/`sendBeacon` dentro do arquivo: o cartão "Sobre" promete que não há
servidor nem telemetria. Máscara: CPF/CNPJ só os 2 últimos dígitos; nomes em
iniciais **guardando o sufixo societário**; número do processo **inteiro, de
propósito**. Os dois bugs que ela pegou: substituição de nomes fora de ordem
(trocar "MARIA" antes de "MARIA DA SILVA … LTDA" vaza nome de terceiro) e o
`nomesAlterados`, cujo de-para guarda o original num campo chamado `de`.

**`teste-diario.js`** — diário da sessão, instrumentado no funil do download.
Guarda NOME de arquivo, nunca bytes. `registrar` precisa de **fila de promessas**:
sem ela, downloads simultâneos (CENSEC por parte, INFOJUD em lote) fazem 5 virar
1. Duas famílias separadas: "Convênios realizados" e "Cancelamento das
restrições" — campo `familia`, não `tipo` (chave duplicada no literal fazia a
família sobrescrever o nome da mensagem).

**`teste-marcacoes.js`** — chips e GIGS. `idsEtiquetas` quer o id da **instância**
(150), não o `etiqueta.id` (126) — ambos no mesmo objeto, e o POST responde 200
com o errado.

**`teste-juntada.js`** — minuta por API. NÃO anexa, NÃO atropela rascunho
existente, NÃO crava id nenhum (os `idEstruturaDocumentoTopico` vêm na resposta
do template), e **asserção dedicada de que não chega perto de assinar** — aqui
não existe diálogo de confirmação.

**`teste-infojud-fila.js`** — os quatro bugs empilhados do orquestrador:
`ModuloInfojud` não existia (literal anônimo); assinatura posicional contra
função de um objeto; `processo.numero` onde se esperava o objeto; `.filter(Boolean)`
que não filtrava nada (corte tem de ser pelo NI, 11 ou 14 dígitos). Chamar na
forma posicional antiga e **exigir recusa**. `abrirEcacERegistrar` recusa fila
vazia e NÃO abre aba.

**`teste-ecac-entrada.js`** — a porta nova do eCAC (`Aplicacao.aspx?id=5032` →
iframe do menu → "Registrar Solicitação" → iframe `solicitacao.asp`). Três casos:
com fila clica, sem fila **não** clica, menu sem link avisa em faixa vermelha.
⚠️ Espera 20s de propósito, para provar o alarme falso do frame de topo.

**`teste-infojud-pedidos.js`** — as economias da 1.0.5. Os 6 pedidos entram, cada
um com o SEU ano, e o tipo muda 3 vezes em vez de 6. Rodar contra uma cópia com
as otimizações desligadas tem de reprovar 3 asserções.
**Velocidade que perde pedido é pior que lentidão.**

**`teste-infojud-erro-ecac.js`** — ⛔ ano pedido e não obtido ⇒ não clica, não
envia, a fila PARA. Contra a 1.0.5 reprova 19 e mostra a duplicata com o ano
herdado (`DIRPF|2026, DIRPF|2026, DITR|2026`). Também: a aba só fecha em execução
limpa (`ecac_anomalias`), o AJAX de anos reconhece a página de erro do eCAC, e o
alerta é capturado por `conteudo/ecac-grampo.js` no contexto da página — o
`window.alert` do content script **nunca funcionou** (Xray).
**Solicitação registrada errada é pior que não registrada: a errada parece certa.**

**`teste-infojud-postback.js`** — o único harness que **recarrega a página a cada
inclusão**, como o eCAC faz (7 submits para 6 pedidos). Contra a 1.0.6 reprova 3
e imprime a revisão inteira. Consulta à tabela no topo de `incluirPedido`; tipo
decidido pela TELA, não por variável de passada.
**Variável de passada não sobrevive a postback; a tela sobrevive.**

**`teste-infojud-efinanceira.js`** (1.5.0) — as opções finas do eFinanceira nas
Preferências. `gerarListaPedidos` passa Tipo de conta/relação/câmbio/extrato para
cada pedido; padrão recomendado (Todas/Todas/Sim/Contas e movimentações) mesmo em
config antiga (fallback); ano sempre a partir do ano anterior FECHADO (anoAtual-1),
nunca o corrente. Confere também que `incluirPedido` consome opcoes.conta/relacao/
cambio/extrato nos selects novoTipo* da tela. Reprova a 1.4.3 (sem gerarListaPedidos
no hook e pedido só com datas).

**`teste-infojud-efin-zip.js`** (1.5.0) — descompactar + renomear. `CratosUnzip` lê
o container zip e descomprime DEFLATE (round-trip com zlib). `colherEFinanceiraZip`
manda baixar cada PDF como "eFinanceira (<ano>)"; 2º do mesmo ano em diante ganha
índice ANTES do ano ("eFinanceira 2 (<ano>)"); anos diferentes viram rótulos
distintos (o nome interno é idêntico entre zips — não pode colidir). Zip sem PDF →
`vazioEfin`. Dados 100% sintéticos (LGPD). Reprova a 1.4.3 (sem unzip).
**Zip não anexa no PJe; o que a juntada precisa é do PDF de dentro, com nome único por ano.**

**`teste-infojud-efin-pendente.js`** (1.5.0, reforçado 1.5.2) — eFinanceira assíncrono,
dia 1. Zip vazio/sem PDF na coleta → certidão "Consolidando resultados da consulta ao
e-Financeira", que certifica o ESTADO da diligência (registrada, retorno assíncrono
pendente) e NÃO afirma resultado nem "nada consta". Zip com PDF → baixa, sem certidão
de consolidação. **1.5.2 fechou o buraco do campo:** quando o link devolve HTML "em
processamento" OU um corpo que nem é arquivo (não-PK, não-%PDF), também vira a certidão
de consolidação — antes o HTML virava erro "sem link" e o "outro" era salvo como `.zip`
cru, que a juntada tentava anexar e o PJe recusava (ARQ-041 "Arquivo deve ser PDF").
E o caso 6 trava a REGRA DE FERRO: zip REAL que estoura no inflate = erro vermelho,
NUNCA certidão falsa (tem dado, é falha de leitura). **1.5.3 (casos 7-8):** a linha do
eFinanceira SEM lupa (a Opções traz só "processamento ainda não concluído") também vira
a certidão — `lerItensResultado` parou de descartar a linha assíncrona sem `<a>` e
`colherUmItem` emite (testado de ponta a ponta via `colherTodosItens`, reprova a 1.5.2
que descartava a linha); e o guarda anti-duplicação (2 coletas no mesmo dia = 1 certidão,
via `cofre_listar`). O harness ganhou um Cofre falso acumulável. Reprova a 1.4.3 (gate),
a 1.5.1 (casos 4-5) e a 1.5.2 (casos 7-8).
**Pendência (sem dado) vira certidão de estado; dado ilegível vira erro — jamais uma certidão falsa.**

**`teste-infojud-efin-botao.js`** (1.5.0) — o botão exclusivo "Baixar só o
e-Financeira" (coleta do dia seguinte). Com `soEfin`, `colherTodosItens` colhe só o
eFinanceira e ignora DIRPF/DOI/etc.; sem item de eFinanceira, devolve `semEfin` (não
colhe os outros à toa). Confere a fiação de ponta a ponta: painel (botão) →
`coletar_tudo(soEfin)` → background (`coleta_estado.soEfin`) → content script (filtro).
Reprova a 1.4.3.

**`teste-infojud-overlay.js`** (1.5.2) — a cortina central de coleta. `CratosOverlay`
(em `comum/faixa.js`): `mostrar()` cria uma cortina FIXA cobrindo a tela (`inset:0`),
z-index bem no topo mas ABAIXO da faixa (para uma parada aparecer por cima), engolindo
clique/tecla; idempotente (chamar 2x mantém um só e atualiza o texto). `esconder()`
remove. `CratosFaixa.parar()` esconde o overlay (a parada precisa ser vista e clicável).
Fiação no INFOJUD: `iniciarColetaEcac` MOSTRA ao entrar na tela de resultado; `coleta
ColherEAvancar` ESCONDE quando a fila termina. Só INFOJUD, por ora. Rede de segurança:
some sozinho após 180s. Reprova a 1.5.1 (sem CratosOverlay nem a fiação na coleta).
**A cortina bloqueia o clique durante o download, mas some na hora de uma parada — quem parou precisa agir.**

**`teste-serasajud-manual.js`** (1.5.4) — lançamento manual de valor/data quando não há
cálculo nos autos. Bug de campo: a baixa do SerasaJUD abortava sem cálculo. Trava: o
background NÃO aborta mais (gate por fonte: some "Não achei o valor da dívida"/"A baixa
exige a Data da Dívida", entra valorPendente/dataPendente); `garantirDadosManuais` mostra
o popup pedindo só o que falta (valor+data na baixa; só data se o cálculo trouxe o valor;
só valor na inclusão); normalizadores pt-BR de valor e data (real, não futura); Confirmar
preenche o estado + origemManual; Cancelar → false + `CratosFaixa.parar`; entrada inválida
mantém o popup aberto; sem pendência segue direto; **espera SEM timeout** (só resolve por
ação do usuário). Reprova a 1.5.3 (sem `garantirDadosManuais`).
**Sem cálculo nos autos não é erro: é o usuário AFIRMAR o valor/data à mão — e a certidão registra a origem.**

**`teste-seguranca-html.js`** (1.5.5) — escape de todo dado externo que vira HTML. Cargas
fictícias (`<img onerror>`, `"><svg onload>`, `<script>`, aspas, `&`) passam pelo PAINEL
(nome, polo e documento da parte; nº da solicitação, processo e data da caixa postal;
pendências e falhas da colheita; título/convênios do diário; erro do PJe na juntada;
relatório e progresso da fila), pelas PREFERÊNCIAS (valor salvo volta intacto no campo e é
salvo igual; aviso mantém `<b>` mas não `<img>`) e pelos POPUPS do SerasaJUD e do SAB —
nenhum elemento injetado, texto literal na tela, sem escape duplo. Testa o próprio helper
(`esc`, `html```, arrays, `marcacaoLimitada`, `definir`). E VARRE `src/`: `innerHTML` só
com literal fixo; HTML com dado só por `CratosHTML.definir(el, html`…`)`; proibidos
`insertAdjacentHTML`, `outerHTML=`, `document.write` (a varredura prova a si mesma num
arquivo-isca com 5 erros). Reprova a 1.5.4 (sem `CratosHTML`; polo, caixa postal e
opções injetam elemento; 27 pontos na varredura).
**Módulo novo (CCS, SNIPER, PREVJUD…) que montar HTML fora do `definir(html``)` reprova aqui.**

**`teste-censec-partes.js`** (1.4.1) — as partes de cada ato na certidão do CEP.
Exercita o fluxo dentro da página (censec.js + censec-api.js): o grampo chama
`GET /api/busca-atos/cep/{atoId}/partes` e o content script lista nome + CPF/CNPJ
**formatado** + qualidade abaixo de cada ato. Pontos duros: **autentica só com o
cookie** (`credentials:include` + `X-Subscription`, SEM Authorization — confirmado
no ambiente real 16/09); atrás do checkbox `puxarPartes` (desligado → não lista e
NEM chama o /partes, sem round-trip extra); e **falha do /partes não derruba a
certidão** (sai sem a seção de partes). Reprova a 1.4.0: lá não há `__cratosCensec`.
**Detalhe a mais na certidão nunca pode custar a certidão.**

**`teste-infojud-recoleta.js`** (1.4.1) — rebaixar o INFOJUD com a mensagem já
lida. Até a 1.4.0 a fila de `coletarTudo` era montada só com as NÃO lidas, e uma
mensagem já aberta/colhida deixava a fila vazia. Exercita o helper puro
`filaDeSolicitacoes`: inclui as lidas, dedupe por número, descarta número curto.
A trava anti-vazamento é o **casamento do processo** (em coletarAchar), não a
leitura. Reprova a 1.4.0: lá não existe o helper (filtro `!s.lida` inline).
**O resultado no eCAC fica de pé por meses; leitura não é motivo para não rebaixar.**

**`teste-opcoes-rotulo.js`** (1.4.1) — o rótulo do checkbox nas Preferências. Roda
a IIFE de opcoes.js com um catálogo representativo e lê o DOM: toggle **solto**
(SAB, CENSEC) usa o próprio rótulo como texto do checkbox, sem "Consultar" e sem
duplicar acima; toggle em **_grupos** (INFOJUD) mantém "Consultar" + rótulo curto
acima. Reprova a 1.4.0: lá o SAB mostra "Consultar" ao lado do checkbox.
**O texto ao lado do checkbox tem de dizer o que a opção faz, não um verbo genérico.**
