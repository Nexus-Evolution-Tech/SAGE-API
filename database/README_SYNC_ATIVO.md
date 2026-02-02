# Controle de Sincronização por Dispositivo

## Visão Geral

Esta funcionalidade permite ativar ou desativar a sincronização automática individualmente para cada dispositivo (catraca). Isso ajuda a reduzir a carga no sistema quando você não precisa que determinados dispositivos sincronizem automaticamente.

## Como Funciona

### 1. Coluna `sync_ativo` na Tabela `Dispositivo`

Foi adicionada a coluna `sync_ativo` (tipo BOOLEAN) na tabela `Dispositivo`:
- **Valor padrão**: `TRUE` (ativo)
- **TRUE (1)**: Sincronização automática ativada para o dispositivo
- **FALSE (0)**: Sincronização automática desativada para o dispositivo

### 2. Aplicação da Migração

Para adicionar a coluna em bancos de dados existentes, execute:

```bash
mysql -u root -p sage < database/migration_sync_ativo.sql
```

Ou execute manualmente:

```sql
USE sage;

ALTER TABLE Dispositivo 
ADD COLUMN IF NOT EXISTS sync_ativo BOOLEAN DEFAULT TRUE 
COMMENT 'Ativa ou desativa a sincronização automática para este dispositivo';
```

### 3. Uso da API

#### Endpoint: Ativar/Desativar Sincronização

**POST** `/api/dispositivos/:id/toggle-sync`

**Headers:**
```
Authorization: Bearer {seu_token_jwt}
Content-Type: application/json
```

**Body:**
```json
{
  "sync_ativo": false
}
```

**Resposta de Sucesso (200):**
```json
{
  "message": "Sincronização desativada com sucesso",
  "dispositivo": "Catraca Entrada Principal",
  "sync_ativo": false
}
```

#### Exemplos de Uso

**Desativar sincronização:**
```bash
curl -X POST http://localhost:3000/api/dispositivos/1/toggle-sync \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sync_ativo": false}'
```

**Reativar sincronização:**
```bash
curl -X POST http://localhost:3000/api/dispositivos/1/toggle-sync \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sync_ativo": true}'
```

### 4. Visualizar Status de Sincronização

Ao listar dispositivos, o campo `sync_ativo` estará presente:

**GET** `/api/dispositivos`

**Resposta:**
```json
[
  {
    "id": 1,
    "nome": "Catraca Entrada Principal",
    "modelo": "IDAccess",
    "endereco": "192.168.0.101",
    "porta": "80",
    "sync_ativo": true,
    ...
  },
  {
    "id": 2,
    "nome": "Catraca Saída",
    "modelo": "IDBlock",
    "endereco": "192.168.0.102",
    "porta": "80",
    "sync_ativo": false,
    ...
  }
]
```

## Impacto no Sistema

Quando `sync_ativo = FALSE`, o dispositivo é **IGNORADO** em:

1. ✅ **Registro de sincronizações pendentes** (`sync.js`)
   - Não cria registros na tabela `sync_pendente` para este dispositivo

2. ✅ **Verificação de sincronizações pendentes** (`sync_catracas.js`)
   - Não processa pendências existentes deste dispositivo

3. ✅ **Job de sincronizações pendentes** (`scheduledJobs.js`)
   - Marca o dispositivo como "offline" para não processar

4. ✅ **Sincronização de acessos** (`accessService.js`)
   - Não sincroniza logs de acesso deste dispositivo

## O Que Continua Funcionando

Mesmo com `sync_ativo = FALSE`, você ainda pode:

- ✅ Visualizar o status do dispositivo (online/offline)
- ✅ Testar conexão manualmente
- ✅ Fazer backup de logs
- ✅ Zerar logs da catraca
- ✅ Configurar o Monitor
- ✅ Fazer diagnóstico de acessos

## Casos de Uso

### 1. Dispositivo Temporariamente Fora de Uso
Se uma catraca está em manutenção ou desligada temporariamente, desative a sincronização para evitar tentativas desnecessárias.

### 2. Dispositivo Apenas para Monitoramento
Se você quer manter o dispositivo configurado mas não quer sincronizar automaticamente (ex: ambiente de testes).

### 3. Melhorar Performance
Se o sistema está sobrecarregado, desative a sincronização de dispositivos menos críticos temporariamente.

### 4. Dispositivos de Backup
Dispositivos configurados como backup que não devem sincronizar no dia-a-dia.

## Logs

Quando um dispositivo tem sincronização desativada, você verá mensagens nos logs:

```
[SYNC] Sync desativado para dispositivo 2 (Catraca Saída), ignorando operação CREATE
[SYNC] Sync desativado para catraca Catraca Saída, ignorando pendentes
[SYNC] Sync desativado para dispositivo Catraca Saída, pulando sincronização de acessos
```

## Reativação

Para reativar a sincronização:

1. Use a API com `sync_ativo: true`
2. O sistema começará a sincronizar normalmente no próximo ciclo
3. As sincronizações pendentes acumuladas serão processadas

## Notas Importantes

⚠️ **Atenção**: Desativar a sincronização **NÃO** apaga dados existentes. Apenas impede novos processos de sincronização.

⚠️ **Dados acumulados**: Se você desativar por muito tempo e depois reativar, pode haver muitas sincronizações pendentes para processar.

⚠️ **Monitoramento**: O health check continua funcionando mesmo com sincronização desativada.
