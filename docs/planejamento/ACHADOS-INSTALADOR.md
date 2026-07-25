# Achados — o instalador está quebrado (verificado em MySQL real)

> Descoberto ao verificar a Fase 0 contra um MySQL 9.5 real, rodando `scripts/setup-database.js`
> com `DB_NAME` apontando para um banco novo. **Todos verificados por execução, não por leitura.**
> Alimentam a Fase 2 (falha silenciosa) e a Fase 8 (instalador).

---

## ✅ A-1 — `sage.sql` ignora `DB_NAME` (nome do banco fixo no código) — **CORRIGIDO**

`database/sage.sql`, linhas 2-3:
```sql
CREATE SCHEMA IF NOT EXISTS sage;
USE sage;
```

O nome do banco está **hardcoded**. Consequências verificadas:

- Configurar `DB_NAME=outra_coisa` no `.env` **não funciona**: o schema é sempre criado em `sage`, e
  as migrations seguintes rodam contra o banco configurado, que fica **vazio**.
- Impossível instalar duas instâncias na mesma máquina, e impossível isolar banco de teste do de
  produção — o que **bloqueia a infraestrutura de teste da Fase 1**.

**Correção:** remover `CREATE SCHEMA`/`USE` do `.sql` e deixar criação/seleção do banco para o
`setup-database.js`, que já conhece `DB_NAME`.

## ✅ A-2 — A instalação falha inteira e reporta SUCESSO (exit 0) — **CORRIGIDO**

Execução real com `DB_NAME=sage_f0_full`:

```
exit=0
Erro ao executar migration melhorias_sistema.sql: Table 'sage_f0_full.unidadeescolar' doesn't exist
Erro ao executar migration migration_area_foto.sql: Table 'sage_f0_full.area' doesn't exist
Erro ao executar migration migration_control_id_device_id.sql: Table ... doesn't exist
Erro ao executar migration migration_dispositivo_sync_enabled.sql: Table ... doesn't exist
Erro ao executar migration migration_ultimo_log_id_sincronizado.sql: Table ... doesn't exist
=== tabelas criadas: 0
```

**Zero tabelas criadas, cinco migrations falhando, processo termina com código 0.**

É exatamente o padrão que a Fase 2 existe para matar (RNF-4), encontrado no lugar mais crítico
possível: o instalador. Numa escola isso significa "instalei, deu certo" seguido de um sistema que
não funciona, sem pista do motivo.

**Mecanismo (encontrado depois):** `executarMigration()` captura toda exceção e devolve `false` em
vez de lançar. Os três chamadores envolviam a chamada em `try/catch` — que nunca disparava,
justamente porque nada era lançado — e **ignoravam o retorno**.

✅ **Corrigido e verificado nos dois sentidos, contra MySQL 9.5 real:**
- instalação boa → `exit 0`, 27 tabelas (comportamento preservado)
- migration quebrada → `exit 1`, com a causa no log
- validação final confere tabelas essenciais antes de declarar sucesso

## 🟠 A-3 — Seed da unidade escolar sem `UNIQUE`, e com senha de admin commitada

`database/sage.sql`, linhas ~370-401:
```sql
INSERT INTO UnidadeEscolar (nome, numero_unidade, ..., login, senha)
VALUES ('ETEC Taboão da Serra', '206', ..., 'admin', '$2b$10$Sbfhh...')
ON DUPLICATE KEY UPDATE nome = VALUES(nome), login = VALUES(login), senha = VALUES(senha);
```

O `ON DUPLICATE KEY UPDATE` **nunca dispara**: a tabela não tem nenhum índice `UNIQUE` além da PK
auto-increment (verificado em `information_schema.STATISTICS` — existe apenas `PRIMARY`).

### ⚠️ Correção da severidade (medida depois)

Minha primeira redação afirmava que "cada execução do instalador insere uma unidade duplicada".
**Isso está errado e eu confirmei rodando o setup duas vezes:** na segunda execução a contagem de
unidades permaneceu 1. Motivo: `setup-database.js` só executa `sage.sql` quando detecta que as
tabelas **não existem**; em banco já provisionado ele pula.

Portanto A-3 **não** dispara no caminho normal de reinstalação. O que observei na prática foi A-3
disparando **como consequência de A-1**: com `DB_NAME` apontando para um banco novo e vazio, o setup
concluiu "tabelas não existem" e executou `sage.sql`, que por causa do `USE sage` foi escrever no
banco `sage` já populado — inserindo a duplicata lá.

O defeito de fundo continua real e vale corrigir, por dois motivos independentes de A-1:
1. Qualquer execução manual (`mysql < sage.sql`) contra banco com dados insere a duplicata.
2. **O hash de senha do `admin` está commitado no repositório**, portanto é conhecido por qualquer
   um com acesso ao código — isso é problema de segurança por si só, sem depender de duplicação.

**Correção:** `UNIQUE (numero_unidade)` ou `UNIQUE (cnpj)` para o `ON DUPLICATE` funcionar; e o seed
não deve conter senha — deve gerar credencial na instalação e exigir troca no primeiro acesso
(já previsto na Fase 3).

---

## Impacto no plano

| Achado | Fase | Muda algo? |
|---|---|---|
| A-1 | Fase 1 / Fase 8 | ✅ **corrigido** — desbloqueou o harness de banco isolado da Fase 1 |
| A-2 | Fase 2 (falha silenciosa) | ✅ **corrigido** com verificação nos dois sentidos |
| A-3 | Fase 3 (identidade) + Fase 8 | Severidade menor que a inicial (ver correção acima). O `UNIQUE` e a remoção do hash commitado seguem valendo |

**A-1 sobe de prioridade.** Sem ele não há banco de teste isolado, que é o que a Fase 1 precisa para
Testcontainers. Correção pequena, desbloqueio grande.

## Nota de transparência

Durante esta verificação, a execução do instalador inseriu **uma** linha duplicada
(`UnidadeEscolar id=2`) no banco `sage` local da máquina de desenvolvimento, por causa de A-1
combinado com A-3. A linha foi removida e o estado anterior restaurado. A unidade original
(`id=1`, login `etec`) **não foi alterada** — precisamente porque o `ON DUPLICATE KEY UPDATE` não
disparou, por falta do `UNIQUE`. Nenhum outro dado foi modificado.
