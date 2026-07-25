# Changelog - Controle de Sincronização por Dispositivo

## Data: 2026-02-02

### 🎯 Objetivo
Adicionar opção para ativar/desativar o processo de sincronização automática por dispositivo, permitindo melhor controle de recursos do sistema.

---

## 📋 Mudanças Implementadas

### 1. Banco de Dados

#### Arquivo: `database/sage.sql`
- ✅ Adicionada coluna `sync_ativo BOOLEAN DEFAULT TRUE` na tabela `Dispositivo`

#### Arquivo: `database/migration_sync_ativo.sql` (NOVO)
- ✅ Script de migração para adicionar coluna em bancos existentes
- ✅ Inclui verificação da criação da coluna

### 2. Backend - Serviços

#### Arquivo: `src/services/sync.js`
- ✅ Modificada função `registrarSyncPendente()` para verificar `sync_ativo`
- ✅ Dispositivos com `sync_ativo = false` são ignorados ao criar registros pendentes

#### Arquivo: `src/utils/sync_catracas.js`
- ✅ Modificada função `verificarSyncPendentes()` para verificar `sync_ativo`
- ✅ Retorna imediatamente se sincronização estiver desativada

#### Arquivo: `src/services/accessService.js`
- ✅ Modificada função `sincronizarTodosAcessos()` para verificar `sync_ativo`
- ✅ Dispositivos com sincronização desativada são pulados
- ✅ Adicionado log e resultado indicando que sync está desativado

#### Arquivo: `src/services/deviceService.js`
- ℹ️ Nenhuma alteração necessária (apenas leitura de dispositivos)

### 3. Backend - Controllers

#### Arquivo: `src/controllers/deviceController.js`
- ✅ Adicionado campo `sync_ativo` ao array `campos`
- ✅ Nova função `toggleSync()` para ativar/desativar sincronização
- ✅ Validação de parâmetros (id do dispositivo e valor booleano)
- ✅ Emissão de notificação quando sincronização é alterada
- ✅ Invalidação de cache após alteração
- ✅ Exportação da nova função no `module.exports`

### 4. Backend - Rotas

#### Arquivo: `src/routes/deviceRoutes.js`
- ✅ Adicionada rota `POST /dispositivos/:id/toggle-sync`
- ✅ Rota protegida com middleware `autenticar`

### 5. Backend - Jobs Agendados

#### Arquivo: `src/jobs/scheduledJobs.js`
- ✅ Modificada função `verificarSyncPendentesJob()` para verificar `sync_ativo`
- ✅ Dispositivos com sincronização desativada são marcados como "offline" internamente
- ✅ Evita processamento de sincronizações pendentes para esses dispositivos

### 6. Documentação

#### Arquivo: `database/README_SYNC_ATIVO.md` (NOVO)
- ✅ Documentação completa da funcionalidade
- ✅ Exemplos de uso da API
- ✅ Casos de uso e boas práticas
- ✅ Informações sobre impacto no sistema

---

## 🔧 Como Usar

### Passo 1: Aplicar Migração no Banco de Dados

```bash
mysql -u root -p sage < database/migration_sync_ativo.sql
```

### Passo 2: Reiniciar o Servidor

```bash
npm start
```

### Passo 3: Usar a API

**Desativar sincronização do dispositivo 1:**
```bash
curl -X POST http://localhost:3000/api/dispositivos/1/toggle-sync \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sync_ativo": false}'
```

**Reativar sincronização do dispositivo 1:**
```bash
curl -X POST http://localhost:3000/api/dispositivos/1/toggle-sync \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sync_ativo": true}'
```

---

## 🎨 Integração com Frontend

### Sugestões para Interface

1. **Toggle Switch** na lista de dispositivos
   - Mostra visualmente se sync está ativo/inativo
   - Permite ativar/desativar com um clique

2. **Badge de Status** no card do dispositivo
   ```
   🟢 Sync Ativo  |  🔴 Sync Desativado
   ```

3. **Confirmação** antes de desativar
   ```
   "Tem certeza que deseja desativar a sincronização?
    O dispositivo continuará funcionando mas não sincronizará automaticamente."
   ```

4. **Avisos visuais**
   - Ícone de alerta em dispositivos com sync desativado
   - Tooltip explicativo ao passar o mouse

### Exemplo de Código React (sugestão)

```jsx
const toggleSync = async (dispositivoId, novoValor) => {
  try {
    const response = await api.post(
      `/dispositivos/${dispositivoId}/toggle-sync`,
      { sync_ativo: novoValor }
    );
    
    // Atualizar lista de dispositivos
    fetchDispositivos();
    
    // Mostrar notificação de sucesso
    toast.success(response.data.message);
  } catch (error) {
    toast.error('Erro ao alterar sincronização');
  }
};
```

---

## 🧪 Testes Recomendados

### 1. Teste de Desativação
- [ ] Desativar sync de um dispositivo
- [ ] Verificar que não aparecem novos registros em `sync_pendente` para ele
- [ ] Verificar que acessos não são sincronizados

### 2. Teste de Reativação
- [ ] Reativar sync de um dispositivo
- [ ] Criar/editar uma pessoa
- [ ] Verificar que sincronização volta a funcionar

### 3. Teste de Integridade
- [ ] Dispositivos com sync ativo continuam funcionando normalmente
- [ ] Health check funciona independente do sync_ativo
- [ ] Status online/offline continua sendo atualizado

---

## ⚠️ Avisos Importantes

1. **Valor Padrão**: Todos os dispositivos existentes terão `sync_ativo = TRUE` por padrão
2. **Sincronizações Pendentes**: Desativar não remove pendências já criadas, apenas evita criar novas
3. **Logs Antigos**: Os logs já sincronizados permanecem no banco
4. **Performance**: Use esta feature para aliviar carga em momentos de pico

---

## 📊 Benefícios

✅ **Melhor Performance**: Reduz carga do sistema ao desativar sync de dispositivos não críticos
✅ **Flexibilidade**: Controle granular por dispositivo
✅ **Manutenção**: Facilita testes e manutenção sem afetar outros dispositivos
✅ **Transparente**: Alterações são logadas e notificadas
✅ **Reversível**: Pode ser reativado a qualquer momento

---

## 📝 Arquivos Modificados

- `database/sage.sql`
- `database/migration_sync_ativo.sql` (novo)
- `database/README_SYNC_ATIVO.md` (novo)
- `src/services/sync.js`
- `src/utils/sync_catracas.js`
- `src/services/accessService.js`
- `src/controllers/deviceController.js`
- `src/routes/deviceRoutes.js`
- `src/jobs/scheduledJobs.js`
- `CHANGELOG_SYNC_ATIVO.md` (novo)
