# Promoção Automática de Alunos

Quando o ano letivo muda, o SAGE promove automaticamente os alunos para a série seguinte.

## Como Funciona

1. **Padrão das turmas**: O nome segue `Nº X - Sufixo`, ex: `1º A - MTec-PI Desenvolvimento de Sistemas`
2. **Promoção**: Aluno em `1º A - MTec-PI DS` → `2º A - MTec-PI DS` (se a turma existir)
3. **Finalização**: Se não existe próxima turma (ex: curso de 1 ano como `1º A - TI-N - Informática`):
   - Status do aluno → `CONCLUIDO`
   - Se existir turma "Finalizado" na unidade → aluno vai para ela
   - Caso contrário → `turma_id = NULL`

## Elegibilidade (quem é promovido)

O aluno precisa ter **completado pelo menos 1 ano** na escola:

- **RM**: Os primeiros 4 dígitos indicam o ano de matrícula (ex: `20252930067` → 2025)
- **Fallback**: Se não houver RM, usa `YEAR(Pessoa.created_at)` como ano de cadastro
- **Regra**: `anos_na_escola = ano_atual - ano_matricula >= 1` → elegível

Ex.: Aluno com RM 2025 em 2026 tem 1 ano na escola → promove 1º→2º. Em 2027, 2 anos → promove 2º→3º.

## Quando Roda (não depende de estar ligado em 1º de janeiro)

- **Na subida da API**: Ao iniciar o servidor, verifica se o ano mudou e executa se necessário
- **Job diário**: Horário configurável via `PROMOCAO_CRON` no `.env` (padrão: 08:10)
- **Tabela ConfigSistema**: Armazena `ultimo_ano_promocao` para não rodar duas vezes no mesmo ano

O PC fica desligado à meia-noite? Configure um horário em que esteja ligado:

```env
# Ex.: 08:10 da manhã (padrão)
PROMOCAO_CRON=10 8 * * *

# Ou 07:00, ou 18:30 em dias úteis
PROMOCAO_CRON=0 7 * * *
PROMOCAO_CRON=30 18 * * 1-5

# Desabilitar: deixe vazio ou false
PROMOCAO_CRON=
```

Assim, mesmo que o sistema fique desligado em 1º de janeiro, ao subir em qualquer dia a promoção será executada.

## Execução Manual

Para rodar manualmente (ex: teste ou ajuste de data):

```bash
# Simulação (não aplica alterações)
curl -X POST "http://localhost:3000/promocao/executar?simulacao=true" \
  -H "Authorization: Bearer SEU_TOKEN"

# Execução real
curl -X POST "http://localhost:3000/promocao/executar" \
  -H "Authorization: Bearer SEU_TOKEN"

# Filtrar por unidade
curl -X POST "http://localhost:3000/promocao/executar?unidade_id=1" \
  -H "Authorization: Bearer SEU_TOKEN"
```

## Setup (npm start em máquina zerada)

A tabela `ConfigSistema` já está em `sage.sql` e `melhorias_sistema.sql`, que rodam automaticamente no `npm start`. Nada a fazer manualmente.

## Migrations Adicionais (opcional)

**Turma "Finalizado"** (opcional):

Para que alunos concluídos sejam movidos para uma turma específica (em vez de `turma_id = NULL`):

1. Execute a migration:
   ```bash
   mysql -u user -p sage < database/migration_turma_finalizado.sql
   ```
2. Ou crie manualmente uma turma com nome "Finalizado" ou "Concluído" em cada unidade.

## MySQL: Desabilitar EVENT Antigo

O `sage.sql` original contém um EVENT que chama a procedure `atualizar_turmas_e_status()` (com IDs hardcoded). Para evitar processar duas vezes, desabilite o EVENT:

```sql
-- Verificar se o evento existe
SHOW EVENTS FROM sage;

-- Desabilitar o evento antigo
ALTER EVENT sage.atualizar_ou_desligar_alunos DISABLE;

-- Ou remover completamente
DROP EVENT IF EXISTS sage.atualizar_ou_desligar_alunos;
```

A promoção passa a ser feita exclusivamente pelo job do Node.js (mais flexível e baseada no padrão de nomes).
