-- Migração: Flag para habilitar/desabilitar sincronização automática por dispositivo
-- Execute este script após atualizar o código para evitar acesso às catracas quando a flag estiver desativada.

ALTER TABLE Dispositivo
ADD COLUMN sync_enabled TINYINT(1) NOT NULL DEFAULT 1 COMMENT '0 desativa sincronização automática' AFTER status;

CREATE INDEX idx_dispositivo_sync_enabled ON Dispositivo(sync_enabled);
