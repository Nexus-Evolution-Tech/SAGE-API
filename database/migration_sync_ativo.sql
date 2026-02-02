-- Migration: Adiciona coluna sync_ativo na tabela Dispositivo
-- Descrição: Permite ativar/desativar a sincronização automática por dispositivo
-- Data: 2026-02-02

USE sage;

-- Adiciona coluna sync_ativo (por padrão TRUE para não impactar dispositivos existentes)
ALTER TABLE Dispositivo 
ADD COLUMN IF NOT EXISTS sync_ativo BOOLEAN DEFAULT TRUE 
COMMENT 'Ativa ou desativa a sincronização automática para este dispositivo';

-- Verificar a adição
SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_DEFAULT, COLUMN_COMMENT 
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_SCHEMA = 'sage' 
  AND TABLE_NAME = 'Dispositivo' 
  AND COLUMN_NAME = 'sync_ativo';
