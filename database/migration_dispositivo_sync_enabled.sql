-- Migração: Flag para habilitar/desabilitar sincronização automática por dispositivo
--
-- CONSOLIDAÇÃO (Fase 0 / decisão D-1):
-- A mesma feature foi implementada em três branches com nomes de coluna diferentes:
--   `sincronizar`  (primeiro-docker)
--   `sync_enabled` (terceira-versao)  <-- ESCOLHIDA
--   `sync_ativo`   (nao-funcional)
-- Padronizado em `sync_enabled`: é a única com helper dedicado (utils/syncFlags.js),
-- índice e semântica explícita.
--
-- Semântica: 1 = incluir na sincronização pesada de acessos (boot + cron);
--            0 = apenas monitoramento leve, sem sincronização automática.
--
-- Idempotente: roda em banco novo ou em banco já migrado com qualquer um dos nomes antigos.

-- 1) Banco já migrado com o nome antigo `sincronizar` -> renomeia preservando os dados
SET @tem_antiga = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Dispositivo' AND COLUMN_NAME = 'sincronizar');
SET @tem_nova = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Dispositivo' AND COLUMN_NAME = 'sync_enabled');
SET @sql = IF(@tem_antiga = 1 AND @tem_nova = 0,
  'ALTER TABLE Dispositivo CHANGE COLUMN sincronizar sync_enabled TINYINT(1) NOT NULL DEFAULT 1 COMMENT ''0 desativa sincronizacao automatica''',
  'SELECT ''nada a renomear (sincronizar)''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2) Banco já migrado com o nome antigo `sync_ativo` -> renomeia preservando os dados
SET @tem_antiga = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Dispositivo' AND COLUMN_NAME = 'sync_ativo');
SET @tem_nova = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Dispositivo' AND COLUMN_NAME = 'sync_enabled');
SET @sql = IF(@tem_antiga = 1 AND @tem_nova = 0,
  'ALTER TABLE Dispositivo CHANGE COLUMN sync_ativo sync_enabled TINYINT(1) NOT NULL DEFAULT 1 COMMENT ''0 desativa sincronizacao automatica''',
  'SELECT ''nada a renomear (sync_ativo)''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3) Banco novo (nenhuma das colunas existe) -> cria
SET @tem_nova = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Dispositivo' AND COLUMN_NAME = 'sync_enabled');
SET @sql = IF(@tem_nova = 0,
  'ALTER TABLE Dispositivo ADD COLUMN sync_enabled TINYINT(1) NOT NULL DEFAULT 1 COMMENT ''0 desativa sincronizacao automatica'' AFTER status',
  'SELECT ''sync_enabled ja existe''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4) Índice (idempotente)
SET @tem_idx = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Dispositivo' AND INDEX_NAME = 'idx_dispositivo_sync_enabled');
SET @sql = IF(@tem_idx = 0,
  'CREATE INDEX idx_dispositivo_sync_enabled ON Dispositivo(sync_enabled)',
  'SELECT ''indice ja existe''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
