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

A 1.9.1 é a primeira versão entregue pela atualização automática. Ela foi publicada para testar o mecanismo, com só o Rodrigo na 1.9.0. Daqui em diante vale o portão: versão homologada.
