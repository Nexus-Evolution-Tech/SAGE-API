# Promoção Automática de Alunos

Quando o ano letivo muda, o SAGE promove automaticamente os alunos para a série seguinte.

## Como Funciona

1. **Padrão das turmas**: O nome segue `Nº X - Sufixo`, ex: `1º A - MTec-PI Desenvolvimento de Sistemas`, `1º B - MTec-PI Desenvolvimento de Sistemas`.
2. **Promoção**: Só altera o **número** da série, mantendo o resto (letra + curso). Ex.:
   - `1º B - MTec-PI Desenvolvimento de Sistemas` → `2º B - MTec-PI Desenvolvimento de Sistemas` → `3º B - MTec-PI Desenvolvimento de Sistemas`
   - `1º A - MTec-N Informática para Internet` → `2º A - MTec-N Informática para Internet`; não existe 3º → finalizado.
3. **Finalização**: Se a próxima turma (mesmo nome com número+1) não existir no banco. Transferência entre turmas (ex.: 1º A → 1º B) é sempre **manual**.
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

- **Na subida da API**: Ao iniciar o servidor, verifica se o ano mudou e executa se necessário (pode ser desligado com `PROMOCAO_NA_SUBIDA=false`)
- **Job diário**: Horário configurável via `PROMOCAO_CRON` no `.env` (padrão: 08:10)
- **Tabela ConfigSistema**: Armazena `ultimo_ano_promocao` para não rodar duas vezes no mesmo ano

O PC fica desligado à meia-noite? Configure um horário em que esteja ligado:

```env
# Ex.: 08:10 da manhã (padrão)
PROMOCAO_CRON=10 8 * * *

# Desabilitar promoção na subida do servidor (evita finalizar todos se as turmas 2º/3º ainda não existirem)
PROMOCAO_NA_SUBIDA=false

# Desabilitar job diário: deixe vazio ou false
PROMOCAO_CRON=
```

Assim, mesmo que o sistema fique desligado em 1º de janeiro, ao subir em qualquer dia a promoção será executada (se `PROMOCAO_NA_SUBIDA` não for `false`).

### Se todos os alunos viraram "Finalizado" ou "Sem turma"

Isso acontece quando a **promoção roda** (na subida ou no cron) e **as turmas do próximo ano ainda não existem** no banco (ex.: turmas "2º A - ...", "3º A - ..."). A lógica considera "não existe próxima turma" e **finaliza** o aluno (status CONCLUIDO, turma_id = turma "Finalizado" ou null). No front, turmas passam a aparecer só "Sem turma" e "Finalizado".

**Solução:**

1. **Reverter** os alunos finalizados por engano (todos voltam para EM CURSO e turma_id = null; depois reatribua turmas por planilha ou manualmente):
   ```bash
   # Ver quantos seriam revertidos (não altera nada)
   curl -X POST "http://localhost:3000/promocao/reverter" -H "Authorization: Bearer SEU_TOKEN"

   # Aplicar a reversão
   curl -X POST "http://localhost:3000/promocao/reverter?confirmar=sim" -H "Authorization: Bearer SEU_TOKEN"
   ```
2. **Evitar de novo**: no `.env` use `PROMOCAO_NA_SUBIDA=false` e cadastre as turmas do próximo ano antes de rodar a promoção manualmente (`POST /promocao/executar`).

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

### Reverter alunos finalizados por engano

Se a promoção finalizou alunos que ainda não tinham concluído o curso, use uma das opções abaixo.

**Opção 1 – Script (recomendado)**

Na pasta do projeto SAGE-API:

```bash
# Ver quantos seriam revertidos (não altera nada). O script pede login e senha da escola.
node scripts/reverter-finalizados.js

# Aplicar a reversão (todos CONCLUIDO → EM CURSO, turma_id → null)
node scripts/reverter-finalizados.js --confirmar
```

Opcional: no `.env` defina `ESCOLA_USUARIO` e `ESCOLA_SENHA` (e, se quiser, `API_URL`, `UNIDADE_ID`) para não digitar no terminal.

**Opção 2 – cURL (com token)**

1. Fazer login para obter o token:
   ```bash
   curl -X POST "http://localhost:3000/escolas/login/1" -H "Content-Type: application/json" -d "{\"usuario\":\"SEU_LOGIN\",\"senha\":\"SUA_SENHA\"}"
   ```
   Na resposta, copie o valor de `token`.

2. Consultar quantos seriam revertidos (não altera):
   ```bash
   curl -X POST "http://localhost:3000/promocao/reverter" -H "Authorization: Bearer SEU_TOKEN"
   ```

3. Aplicar a reversão:
   ```bash
   curl -X POST "http://localhost:3000/promocao/reverter?confirmar=sim" -H "Authorization: Bearer SEU_TOKEN"
   ```

Substitua `SEU_TOKEN` pelo token obtido no login e `http://localhost:3000` pela URL da sua API (e `/escolas/login/1` pelo ID da sua unidade, se for diferente de 1).

Depois da reversão, reatribua as turmas aos alunos (reimportar planilha com a coluna Turma correta ou editar manualmente).

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
