# CRATOS — Atualização automática pelo GitHub (desde a 1.9.0)

A partir da 1.9.0, o `manifest.json` traz:

```
"update_url": "https://raw.githubusercontent.com/Rodrigo-Madalosso-Araujo/CRATOS/main/updates.json"
```

O Firefox consulta esse arquivo cerca de uma vez por dia. Também dá para forçar em `about:addons` → engrenagem → "Procurar atualizações". Quando o arquivo lista uma versão maior que a instalada, o Firefox baixa o xpi do `update_link`, confere o `update_hash` e instala.

- **Quem está na 1.8.7 ou antes instala a 1.9.0 à mão, uma vez.** As anteriores não têm o `update_url`.
- **Assinatura na AMO:** sempre **"Por conta própria" (On your own / unlisted)**. Em extensão listada na loja, a Mozilla não aceita `update_url`. No validador local, use `addons-linter --self-hosted`.
- **O repositório tem de ficar PÚBLICO.** O Firefox lê o `updates.json` sem login.
- **Só entra no `updates.json` a versão que o Rodrigo decidir distribuir** (combinado em 21/10: versão homologada). Esse arquivo é o portão: o que não estiver nele não chega a ninguém.

## Rotina a cada versão nova (ex.: 1.9.1)

1. **Assinar** a versão na AMO ("Por conta própria") e salvar o xpi assinado em `assinados\` com o nome **`cratos-X.Y.Z.xpi`, tudo em minúsculas** (convenção desde 26/10). É o mesmo nome que vai na release, e o GitHub diferencia maiúsculas: o arquivo segue direto, sem renomear. Avisar o Claude.
2. O Claude calcula o SHA-256 e prepara um **PR** que acrescenta a entrada no `updates.json` (na raiz do repositório). Ele **não** faz o merge.
   ```json
   { "version": "1.9.1",
     "update_link": "https://github.com/Rodrigo-Madalosso-Araujo/CRATOS/releases/download/v1.9.1/cratos-1.9.1.xpi",
     "update_hash": "sha256:<64 hexadecimais>",
     "browser_specific_settings": { "gecko": { "strict_min_version": "140.0" } } }
   ```
3. O Rodrigo **cria a release** `v1.9.1` no GitHub e anexa o xpi assinado com o nome **exato** `cratos-1.9.1.xpi` (o proxy da sessão não deixa o Claude criar release nem tag).
4. **Só depois** o Rodrigo faz o merge do PR. Nessa ordem, ninguém recebe link quebrado.
5. Conferir: em `about:addons` → "Procurar atualizações", numa máquina com a versão anterior.

Ao trocar de hospedagem (ex.: a STI passa a hospedar), muda-se o `update_url` numa versão seguinte, distribuída ainda pelo endereço antigo. A partir dela, vale o endereço novo.

## Primeira vez (antes de distribuir a 1.9.0)

Pôr `updates.json` na raiz do `main` do repositório. Pode ir vazio (`"updates": []`), porque a 1.9.0 é instalada à mão. Enquanto o arquivo não existir, o Firefox só registra um erro silencioso e nada acontece.

## Histórico de publicações

| versão | data | xpi assinado (SHA-256) | PR do updates.json | release |
|---|---|---|---|---|
| 1.9.1 | 26/10/2026 | `1e08a9d171c4d1f54283dfdd79552106f1752ae019b791617f2f2c3c9a06f2a1` | #3 (junto com src/testes/manual da 1.9.1) | `v1.9.1` — a criar pelo Rodrigo, antes do merge |
| 1.9.2 | 05/11/2026 | `322156532640c154682f6542c6b7e9e0a5305ea941fce2e1953bca4bba09f465` | #4 (junto com src/testes/manual da 1.9.2) | `v1.9.2` — a criar pelo Rodrigo, antes do merge |
| 1.9.3 | 11/11/2026 | `3093f079068ae11e8773f9fe2f3a808c049769464058138d94a1bab5aa041181` | #5 (junto com src/testes/manual da 1.9.3) | `v1.9.3` — a criar pelo Rodrigo, antes do merge |
| 1.9.6 | 16/11/2026 | `f0e5131a93b767fde2c86be7336d7e02969e31d532fec5df18725bc89105d398` | #6 (junto com src/testes/manual da 1.9.6) | `v1.9.6` — antes do merge |
| 1.9.7 | 18/11/2026 | `b427fe147ecc1f50177aff5311831f5df0278d0c9abc7d4cd5529683da49f49c` | junto com src/testes da 1.9.7 | `v1.9.7` — antes do merge |

A 1.9.1 é a primeira versão entregue pela atualização automática. Ela foi publicada para testar o mecanismo, com só o Rodrigo na 1.9.0. Daqui em diante vale o portão: versão homologada.

A 1.9.2 foi publicada completa por decisão do Rodrigo (05/11), antes da homologação pela STI, para acompanhar o curso de operação; eventuais correções seguem em versões seguintes.

A 1.9.3 também foi publicada completa por decisão do Rodrigo (11/11), antes da homologação pela STI e sem o teste ao vivo de todos os itens (o "Refazer" depende de casos raros); o teste fica com os colegas das varas, no uso, com retorno ao Rodrigo.

A 1.9.4 e a 1.9.5 foram assinadas e **não publicadas** (números queimados): a 1.9.4 não juntava a transferência já enviada ao banco, e a 1.9.5 não tinha as correções do primeiro lote real.

A 1.9.6 também foi publicada por decisão do Rodrigo (13/11, confirmada em 16/11), antes da homologação pela STI, depois do teste ao vivo do lote "Coletar respostas SAB" de 12/11 (três processos juntados, sem falhas). É a versão que substitui a extensão SABRe nas varas.

A 1.9.7 (18/11) leva o CRATOS ao PJe dos 24 TRTs. O uso nos demais tribunais está autorizado pelo CSJT, por requisição direta entre as presidências (informado pelo Rodrigo em 18/11). Como a lista de hosts muda, o Firefox pede a quem atualizar que autorize as permissões novas.

A 1.9.7 também foi publicada por decisão do Rodrigo (18/11), antes da homologação pela STI, depois do teste ao vivo no TRT19 (captura, terceiros, SAB ausente) e no TRT18 (certidão com "em face de", SNIPER só com a parte marcada, SAB na inclusão e na baixa, verificação de disponibilidade). Sem manual em PDF nesta versão: o manual não mudou, só o carimbo de versão.
