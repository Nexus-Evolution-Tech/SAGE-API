# CI — pipeline pronto, aguardando um passo manual

O arquivo `github-actions-ci.yml` é o workflow do GitHub Actions da Fase 1: roda a suíte com
MySQL 8.4 LTS de verdade e barra merge vermelho.

**Ele não está ativo ainda.** O push foi recusado com:

> refusing to allow an OAuth App to create or update workflow `.github/workflows/ci.yml`
> without `workflow` scope

Ou seja: o token usado não tem permissão para criar workflows — uma proteção do próprio GitHub,
não um erro do projeto. O conteúdo está versionado aqui para não se perder.

## Para ativar

```bash
gh auth refresh -s workflow          # concede o escopo (abre o navegador)
git mv ci/github-actions-ci.yml .github/workflows/ci.yml
git commit -m "ci: ativar pipeline"
git push
```

Alternativa sem CLI: criar o arquivo pela interface do GitHub (Actions → new workflow) e colar o
conteúdo daqui.

## O que o pipeline faz além de rodar os testes

Duas guardas contra regressão dos achados do instalador (`docs/planejamento/ACHADOS-INSTALADOR.md`):

1. Instalação limpa precisa provisionar **≥ 20 tabelas** de verdade.
2. O instalador precisa terminar com **exit ≠ 0** quando uma migration quebra (achado A-2).

A segunda guarda cria uma migration proposital quebrada, roda e remove. Sem ela, o A-2 poderia
voltar sem ninguém perceber — que é exatamente como ele passou despercebido até agora.
