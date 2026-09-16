# CRATOS

**Central de Recursos para Automação de Tarefas e Operações Sistêmicas**
Extensão Firefox (Manifest V2) que captura os dados do processo no PJe e
**prepara** a execução de convênios (consultas e registro) para o processo em
tela, no âmbito do TRT da 18ª Região.

> Versão: **1.4.2** · Compatibilidade: Firefox 115+ · Este repositório é
> disponibilizado para fins de **homologação** pelo Tribunal.

---

## Princípio de escopo (o mais importante)

**O CRATOS prepara; quem confirma, assina e envia é sempre o usuário.** Em todos
os convênios, sem exceção. A extensão automatiza o trabalho repetitivo
(preencher formulários, ler respostas de API, montar certidões) e **para antes
de qualquer ato irreversível** — não clica em "Assinar", não confirma bloqueios,
não envia. O ato definitivo é sempre uma ação humana consciente.

## Convênios cobertos

- **INFOJUD** (eCAC / Receita Federal) — registro de solicitações e coleta das
  respostas na caixa postal.
- **SAB / SISBAJUD** — inclusão (ordem de bloqueio) e baixa (interrupção).
- **RENAJUD** — inclusão e baixa de restrições de veículos.
- **CNIB** (indisponibilidade.onr.org.br) — inclusão e cancelamento total.
- **CENSEC / CEP** — consulta de escrituras e procurações.
- **SerasaJUD** — inclusão e baixa.

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
  sistemas oficiais. Os dados do processo ficam no armazenamento local do Firefox
  e são **sobrescritos a cada nova operação**.
- A extensão **não manuseia senhas, tokens ou certificados**: o login (inclusive
  certificado digital e token por e-mail) é sempre feito pelo usuário.
- Dados protegidos pela **LGPD**. As permissões de host no `manifest.json`
  existem só para os domínios dos sistemas oficiais usados:

  | Host | Para quê |
  |---|---|
  | `*.trt18.jus.br` | PJe e SAB (captura do processo, movimento, juntada) |
  | `*.receita.fazenda.gov.br` | eCAC / INFOJUD e caixa postal |
  | `renajud.pdpj.jus.br` | RENAJUD |
  | `indisponibilidade.onr.org.br` | CNIB |
  | `*.censec.org.br` | CENSEC / CEP |
  | `serasa-judicial.serasaexperian.com.br` | SerasaJUD |

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

1. Use o pacote **`.xpi` assinado** (distribuição *unlisted* na AMO) fornecido
   à parte, ou carregue-o temporariamente em `about:debugging` →
   "Este Firefox" → "Carregar extensão temporária".
2. Ao abrir um processo no PJe, o painel do CRATOS aparece; o interruptor de
   energia no cabeçalho liga/desliga a extensão.

## Testes

As suítes são de Node + jsdom, sem dependência de rede.

```bash
npm install          # instala jsdom (ver package.json)
cd testes
node teste-<nome>.js # roda uma suíte
```

Há **21 suítes / 533 asserções**. A `teste-cnib.js` é lenta (~5 min, usa relógio
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
```

## Autoria

Rodrigo Madalosso Araujo — TRT da 18ª Região.
Contato / responsável pela homologação: `[preencher]`.

## Licença

Ver [`LICENSE`](./LICENSE).
