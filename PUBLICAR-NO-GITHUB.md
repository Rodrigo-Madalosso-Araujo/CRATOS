# Como publicar este repositório no GitHub (privado)

> Esta pasta já está pronta para virar um repositório. Eu **não** faço o `push`
> por você — a sua credencial do GitHub fica sempre com você. Siga um dos
> caminhos abaixo, a partir **desta pasta** (`Desktop\CRATOS-github`).

Pré-requisitos: **Git** instalado. (Opcional: **GitHub CLI** `gh`, que simplifica
a criação do repositório.) Confira com:

```powershell
git --version
gh --version   # opcional
```

---

## Caminho A — com GitHub CLI (mais simples)

No PowerShell, dentro desta pasta:

```powershell
gh auth login                      # se ainda não estiver logado
git init
git add .
git commit -m "CRATOS 1.4.2 — versão para homologação"
git branch -M main
gh repo create cratos --private --source=. --remote=origin --push
```

Pronto: o repositório privado `cratos` é criado na sua conta e o conteúdo sobe.

---

## Caminho B — sem CLI (criando o repo pelo site)

1. Em https://github.com/new crie um repositório **privado** chamado `cratos`
   (deixe **sem** README/LICENSE/.gitignore — este repo já os traz).
2. No PowerShell, dentro desta pasta:

```powershell
git init
git add .
git commit -m "CRATOS 1.4.2 — versão para homologação"
git branch -M main
git remote add origin https://github.com/<SEU_USUARIO>/cratos.git
git push -u origin main
```

Troque `<SEU_USUARIO>` pelo seu usuário do GitHub.

---

## Depois de subir

- **Convide a equipe de homologação / STI** como colaboradores em
  *Settings → Collaborators* (o repo é privado).
- **O `.xpi` assinado não vai no repositório** (binário). Publique-o como
  *Release*: aba **Releases → Draft a new release**, tag `v1.4.2`, e anexe o
  arquivo `cratos-1_4_2.xpi` assinado.
- Confira o `README.md` (tem um `[preencher]` de contato) e o `LICENSE`
  (tem um `[preencher]` sobre o modelo de licenciamento final).

## Atualizações futuras

A cada nova versão, a partir desta pasta:

```powershell
git add .
git commit -m "CRATOS x.y.z — <o que mudou>"
git push
```
