# CRATOS

**Central de Recursos para Automação de Tarefas e Operações Sistêmicas**
Extensão Firefox (Manifest V2) que captura os dados do processo no PJe e
**prepara** a execução de convênios (consultas e registro) para o processo em
tela, no âmbito do TRT da 18ª Região.

> Versão: **1.9.1** · Compatibilidade: Firefox 140+ (ESR 140 ou superior) · Este repositório é
> disponibilizado para fins de **homologação** pelo Tribunal.
> Última versão **homologada** pela STI: **1.6.5** (release `v1.6.5`). As versões 1.7 a 1.9 estão
> descritas abaixo e no cartão "Novidades" da própria extensão.

---

## Princípio de escopo (o mais importante)

**O CRATOS prepara; quem confirma, assina e envia é sempre o usuário.** Em todos
os convênios, sem exceção. A extensão automatiza o trabalho repetitivo
(preencher formulários, ler respostas de API, montar certidões) e **para antes
de qualquer ato irreversível** — não clica em "Assinar", não confirma bloqueios,
não envia. O ato definitivo é sempre uma ação humana consciente.

> **Ressalva (CCS, desde a 1.6.1).** Duas Preferências do CCS — aceitar o Termo
> de Uso e enviar o pedido de detalhamento — podem ser **ligadas pelo próprio
> usuário**; vêm **desligadas** de fábrica. Ligadas, o envio só ocorre com a
> marcação conferida (todas as linhas pretendidas e nenhuma fora do critério), e
> a certidão de envio registra que o ato foi automático, por configuração do
> usuário, com a hora — para rastreabilidade.

## Convênios cobertos

- **INFOJUD** (eCAC / Receita Federal) — registro de solicitações e coleta das
  respostas na caixa postal; e, desde a 1.9.0, o "Recuperar NI – CNPJ": as empresas
  em que o executado pessoa física é o responsável, com certidão consolidada.
- **SAB / SISBAJUD** — inclusão (ordem de bloqueio) e baixa (interrupção).
- **RENAJUD** — inclusão e baixa de restrições de veículos.
- **CNIB** (indisponibilidade.onr.org.br) — inclusão e cancelamento total.
- **CENSEC / CEP** — consulta de escrituras e procurações.
- **SerasaJUD** — inclusão e baixa.
- **CCS** (Cadastro de Clientes do SFN / Banco Central) — requisição de
  relacionamentos, pedido de detalhamento e coleta das respostas (PDF do BCB +
  certidão do estado: quem respondeu e quem falta). Os anexos nascem sigilosos
  (LC 105/2001).
- **SNIPER** (investigação patrimonial, CNJ) — só investigação (nunca constrição):
  relatório das fontes + certidão fonte por fonte. Anexos sigilosos.
- **PREVJUD** (Dossiê Previdenciário, CNJ/INSS) — só o Dossiê Previdenciário, por CPF
  do executado pessoa física: PDFs oficiais do INSS + certidão documento por documento.
  Nunca abre o Dossiê Médico. Anexos sigilosos.

**Sistema fora do ar (desde a 1.9.0).** O botão "Verificar disponibilidade" mede o convênio
(até 3 tentativas, com o PJe como controle) e, só com a confirmação do usuário, gera
**certidão de indisponibilidade**. Falha técnica **nunca** vira certidão negativa.

Na **baixa**, quando o convênio não tem restrição ativa a retirar (RENAJUD, CNIB),
o CRATOS gera certidão desse fato em vez de terminar calado.

## Como funciona (arquitetura, em resumo)

- **Content scripts** rodam nas páginas dos sistemas (PJe e convênios) e dirigem
  a tela ou leem as respostas de API que o próprio site recebe.
- Onde o convênio tem **API JSON** (CENSEC, RENAJUD, SAB), um *grampo* injetado
  no contexto da página escuta/realiza a chamada **na mesma origem** — porque o
  content script, isolado, sairia sem a credencial de sessão. Esses grampos só
  leem o que a tela mostraria e nunca alteram requisição de terceiros.
- O **background** guarda o estado da fila de execução e monta os PDFs das
  certidões.

## Privacidade e tratamento de dados

- **Tudo acontece no navegador do próprio usuário**, dentro dos sistemas em que
  ele **já está autenticado**. As requisições são as mesmas que ele faria à mão.
- **Não há servidor do CRATOS, nem telemetria.** Nada é enviado para fora dos
  sistemas oficiais. Os dados de cada processo ficam no armazenamento local do
  Firefox **só enquanto a aba do processo estiver aberta**: ao fechá-la, são
  apagados (com confirmação, se houver certidão ainda não juntada), e o que sobrar
  é apagado quando o Firefox abre (desde a 1.9.0).
- **Atualização automática (desde a 1.9.0).** O Firefox consulta, cerca de uma vez
  por dia, o [`updates.json`](./updates.json) deste repositório e baixa a versão nova
  **assinada** pela Mozilla, conferindo o SHA-256. Nessa consulta não vai nenhum
  dado de processo. Só entra no `updates.json` a versão que o responsável decidir
  distribuir. Rotina em [`distribuicao/LEIA-ME.md`](./distribuicao/LEIA-ME.md).
- A extensão **não manuseia senhas, tokens ou certificados**: o login (inclusive
  certificado digital e token por e-mail) é sempre feito pelo usuário.
- Todo HTML montado com dado externo passa por `CratosHTML` (escape
  automático); `testes/teste-seguranca-html.js` varre o código-fonte e reprova
  `innerHTML` com dado.
- Dados protegidos pela **LGPD**. As permissões de host no `manifest.json`
  existem só para os domínios dos sistemas oficiais usados:

  | Host (só `https://`) | Para quê |
  |---|---|
  | `*.trt18.jus.br` | PJe e SAB (captura do processo, movimento, juntada) |
  | `*.receita.fazenda.gov.br` | eCAC / INFOJUD e caixa postal |
  | `renajud.pdpj.jus.br` | RENAJUD |
  | `indisponibilidade.onr.org.br` | CNIB |
  | `*.censec.org.br` | CENSEC / CEP |
  | `serasa-judicial.serasaexperian.com.br` | SerasaJUD |
  | `www3.bcb.gov.br` | CCS (Banco Central) |
  | `sniper.pdpj.jus.br` | SNIPER |
  | `previdenciario.pdpj.jus.br` | PREVJUD |

## Nota normativa (para a área avaliar)

O CRATOS é uma **automação determinística** de interface e de chamadas às APIs
dos próprios sistemas — **não é um sistema de inteligência artificial**. Assim, o
marco de IA no Judiciário (Res. CNJ 615/2025 e registro no Sinapses)
provavelmente **não se aplica**; ainda assim, a decisão sobre enquadramento e
sobre eventuais exigências de rastreabilidade cabe à área competente do Tribunal.
Para rastreabilidade, registre-se que todo ato definitivo permanece humano e que
os resultados caem em registro auditável do próprio PJe (movimentos, minutas,
certidões).

## Instalação para teste

1. Use o pacote **`.xpi` assinado** (distribuição *unlisted* na AMO), publicado
   nas [Releases](https://github.com/Rodrigo-Madalosso-Araujo/CRATOS/releases), ou
   carregue-o temporariamente em `about:debugging` → "Este Firefox" →
   "Carregar extensão temporária". A partir da 1.9.0, as versões seguintes chegam
   sozinhas pela atualização automática.
2. Ao abrir um processo no PJe, o painel do CRATOS aparece; o interruptor de
   energia no cabeçalho liga/desliga a extensão.

## Testes

As suítes são de Node + jsdom, sem dependência de rede.

```bash
npm install          # instala jsdom (ver package.json)
cd testes
node teste-<nome>.js # roda uma suíte
```

Há **43 suítes / 1147 asserções**. A `teste-cnib.js` é lenta (~5 min, usa relógio
real); as demais são rápidas. Cada suíte imprime o próprio placar. O padrão do
projeto é que **teste novo reprove a versão anterior** — várias aceitam
`CRATOS_SRC=<pasta do .xpi descompactado>` para serem apontadas a uma versão
antiga. Ver `testes/INVENTARIO.md`.

> **Dados de teste são fictícios.** Todas as *fixtures* usam nomes, CPF/CNPJ e
> números de processo sintéticos — nenhum dado pessoal real.

## Estrutura

```
src/            código da extensão (é o que vira o .xpi)
  manifest.json
  background.js
  comum/        storage, APIs (PJe, caixa postal), faixa, relatório
  conteudo/     content scripts + grampos de API (contexto da página)
  modulos/      um por convênio (registro no catálogo + orquestração)
  opcoes/       tela de Preferências
  icones/
testes/         suítes Node/jsdom + INVENTARIO.md
manual/         gerar-manual.js (gera o "CRATOS - Manual do Usuario.docx" da raiz)
distribuicao/   rotina da atualização automática
updates.json    lista de versões lida pelo Firefox (atualização automática)
```

## Autoria

Rodrigo Madalosso Araujo — TRT da 18ª Região.
Contato / responsável pela homologação: `[preencher]`.

## Licença

Ver [`LICENSE`](./LICENSE).
