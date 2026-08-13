# CLAUDE.md

As regras deste repositório estão em **[`AGENTS.md`](./AGENTS.md)**.

Leia por inteiro antes da primeira alteração. Existe um só conjunto de regras — este
arquivo existe apenas porque Claude Code procura por `CLAUDE.md` e Codex procura por
`AGENTS.md`.

## Resumo de emergência

Se você só puder ler dez linhas:

1. `git -C C:\SAGE-WS\SAGE-arquitetura pull` e leia `PLANO-POS-AUDITORIA.md` — é o que manda
2. Faça **exatamente** o que a issue pede, nada além
3. Achou outro bug? Abra issue separada, não corrija junto
4. Nunca invente dado — lacuna vira pendência para humano resolver
5. Nunca engula erro — `catch` vazio é proibido, falha parcial é falha
6. Nunca registre dado pessoal em log — `pessoa_id=4821`, jamais `pessoa=João Silva`
7. Escrita na catraca é idempotente (`create_or_update_objects`)
8. Decisão de segurança falha fechada — configuração ausente nega
9. Correção de bug exige teste que falha antes e passa depois
10. Dúvida de arquitetura? Abra issue de decisão e **pare**

Este sistema roda numa escola, sem ninguém técnico por perto, guardando dado de menores
de idade que alimenta folha de ponto e registro escolar. Errar em silêncio aqui custa caro.
