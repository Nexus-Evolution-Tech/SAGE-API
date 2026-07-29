# CI — pipeline ativo

O workflow da Fase 1 está em `.github/workflows/ci.yml`. Ele roda a suíte com MySQL 8.4 LTS de
verdade em pushes e pull requests e impede que um resultado vermelho seja tratado como entrega
válida.

## O que o pipeline faz além de rodar os testes

Duas guardas contra regressão dos achados do instalador (`docs/planejamento/ACHADOS-INSTALADOR.md`):

1. Instalação limpa precisa provisionar **≥ 20 tabelas** de verdade.
2. O instalador precisa terminar com **exit ≠ 0** quando uma migration quebra (achado A-2).

A segunda guarda cria uma migration proposital quebrada, roda e remove. Sem ela, o A-2 poderia
voltar sem ninguém perceber — que é exatamente como ele passou despercebido até agora.
