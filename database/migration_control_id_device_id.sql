-- Migração: Permitir mapear device_id enviado pelo Monitor da Control iD para nosso Dispositivo
-- O equipamento envia POST para /api/notifications/dao com device_id no JSON.
-- Preencha este campo no cadastro do dispositivo (valor obtido da API da catraca ou do próprio JSON de teste).

-- Se a coluna já existir, ignore o erro ou execute apenas a linha que faltar.
ALTER TABLE Dispositivo
ADD COLUMN control_id_device_id BIGINT NULL COMMENT 'ID do equipamento na Control iD (enviado no Monitor)' AFTER numero_serial;

CREATE INDEX idx_dispositivo_control_id_device_id ON Dispositivo(control_id_device_id);
