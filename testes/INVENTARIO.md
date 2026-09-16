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

### As que RODAM hoje (16/09/2026 — 1.4.2): 21 suítes, 533 asserções

| suíte | asserções | tempo |
|---|---|---|
| `teste-censec-partes.js` | 15 | rápida |
| `teste-infojud-recoleta.js` | 8 | rápida |
| `teste-opcoes-rotulo.js` | 9 | rápida |
| `teste-cnib-detalhe.js` | 81 | rápida |
| `teste-infojud-entrada-colheita.js` | 49 | rápida |
| `teste-juntada-anexos.js` | 61 | rápida |
| `teste-renajud-folha.js` | 35 | rápida |
| `teste-renajud-multiparte.js` | 23 | rápida |
| `teste-serasajud-data.js` | 11 | rápida |
| `teste-infojud-lotes.js` | 31 | rápida |
| `teste-painel-encadeamento.js` | 58 | rápida |
| `teste-painel-maispje.js` | 10 | rápida |
| `teste-painel-liga-desliga.js` | 26 | rápida |
| `teste-desligado.js` | 4 | rápida |
| `teste-infojud-vara.js` | 24 | rápida |
| `teste-sab-atualizacao.js` | 23 | rápida |
| `teste-sab-marcar-partes.js` | 9 | rápida |
| `teste-cnib.js` | 20 | ⏳ **~5 min** (usa relógio real) |
| `teste-opcoes-vara.js` | 17 | rápida |
| `teste-infojud-pulso.js` | 10 | rápida |
| `teste-ecac-aviso-encerramento.js` | 9 | rápida |

>>> ⛔ Ao rodar a bateria, **confira que cada suíte imprimiu o próprio placar.**
    O `teste-cnib.js` passou meses explodindo com `ENOENT` antes da primeira
    asserção — e crash não é reprovação: não diz nada sobre o código e se
    confunde com ruído no log. Suíte que não roda é pior que suíte nenhuma,
    porque ocupa o lugar de uma que rodaria. As três causas conhecidas de morte
    silenciosa, todas já vistas neste projeto: **caminho** relativo ao diretório
    de chamada (use `CRATOS_SRC`), **namespace** velho (`carrasco:` em vez de
    `cratos:`), e arquivo de `comum/` criado depois do harness e nunca carregado
    (`faixa.js`, `relatorio.js`).

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
