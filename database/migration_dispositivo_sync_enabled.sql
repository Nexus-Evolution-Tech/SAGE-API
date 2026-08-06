-- Convergência expand-only da flag de sincronização por dispositivo.
-- 1 = sincronização pesada habilitada; 0 = apenas monitoramento leve.

-- Cria a coluna canônica sem remover aliases legados.
SET @tem_nova = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Dispositivo' AND COLUMN_NAME = 'sync_enabled');
SET @sql = IF(@tem_nova = 0,
  'ALTER TABLE Dispositivo ADD COLUMN sync_enabled TINYINT(1) NOT NULL DEFAULT 1 COMMENT ''0 desativa sincronizacao automatica'' AFTER status',
  'SELECT ''sync_enabled ja existe''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Copia valores dos aliases quando existirem; as colunas antigas permanecem preservadas.
SET @tem_antiga = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Dispositivo' AND COLUMN_NAME = 'sincronizar');
SET @sql = IF(@tem_antiga = 1,
  'UPDATE Dispositivo SET sync_enabled = sincronizar',
  'SELECT ''sem alias sincronizar''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @tem_antiga = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Dispositivo' AND COLUMN_NAME = 'sync_ativo');
SET @sql = IF(@tem_antiga = 1,
  'UPDATE Dispositivo SET sync_enabled = sync_ativo',
  'SELECT ''sem alias sync_ativo''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Índice idempotente.
SET @tem_idx = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Dispositivo' AND INDEX_NAME = 'idx_dispositivo_sync_enabled');
SET @sql = IF(@tem_idx = 0,
  'CREATE INDEX idx_dispositivo_sync_enabled ON Dispositivo(sync_enabled)',
  'SELECT ''indice ja existe''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
