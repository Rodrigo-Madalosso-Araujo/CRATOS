# CRATOS — pasta do projeto

Extensão Firefox (MV2) que unifica a execução de convênios a partir do processo
no PJe do TRT18. Versão atual: **1.9.1**.

## O que é cada pasta

| pasta | o que tem | pode apagar? |
|---|---|---|
| `src\` | o código. É exatamente o que vira o `.xpi` | não |
| `entrega\` | um `.xpi` por versão entregue | **NUNCA** — ver abaixo |
| `notas\` | `estado-e-notas.md`, a memória do projeto | não |
| `testes\` | as suítes em jsdom + `INVENTARIO.md` | não |

**Por que `entrega\` não se apaga:** os testes aceitam `CRATOS_SRC=<pasta>` para
serem apontados a uma versão ANTIGA. É assim que se prova que um teste novo mede
o que diz medir — ele tem de REPROVAR a versão que tinha o bug. Sem os XPIs
antigos, essa prova deixa de existir. Foi o que pegou o ano herdado da 1.0.5 e as
15 seleções de tipo da 1.0.6.

## Como retomar o trabalho com o Claude

Conectar esta pasta (botão **"Add folder"** no app de desktop) e dizer
**"retomar CRATOS"**. Não anexar `.md` nem `.xpi`: o que está aqui é a verdade.

## Quem roda o quê

**Nada precisa estar instalado nesta máquina.** Node, npm e git não são
necessários — quem roda teste e lint é a sessão do Claude, no ambiente dela, a
partir dos arquivos desta pasta. Aqui só se instala e se usa a extensão.

O que é do Rodrigo, e só dele:
- instalar o `.xpi` **assinado** no Firefox e usar em produção;
- subir o `.xpi` na AMO para assinar (unlisted → *Submit a New Add-on* →
  **"On your own"**), baixar o assinado e guardar em `entrega\`;
- dizer o que quebrou.

O que é da sessão:
- `npx addons-linter --self-hosted src` — tem de dar **0 erros, 0 avisos, 0 notas**
  (o `--self-hosted` é obrigatório desde a 1.9.0, por causa do `update_url`);
- `npm i jsdom` e `node testes/teste-*.js`;
- apontar um teste para versão antiga:
  `CRATOS_SRC=<xpi descompactado> node testes/teste-infojud-postback.js`;
- empacotar o `.xpi` a partir de `src\`.

Rodar os testes em blocos, não todos de uma vez: algumas suítes têm esperas de
verdade (a de entrada do eCAC espera 20s de propósito, para provar o alarme
falso) e estouram timeout curto.

> Só o `.xpi` **assinado** instala em Firefox normal. O não assinado só roda como
> add-on temporário em `about:debugging`, e some ao fechar o navegador.

## Regra de escopo (não reverter)

O CRATOS **só prepara**. Confirmar, enviar, assinar e salvar é sempre do usuário.
Na juntada da certidão no PJe ele não clica em Assinar nem para abrir o diálogo —
ali não existe a barreira de confirmação que os outros convênios têm.
