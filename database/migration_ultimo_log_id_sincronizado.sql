-- Migração: Último id de log da catraca sincronizado por dispositivo
-- Usado para pedir à API Control iD apenas logs com id > ultimo_log_id_sincronizado (load_objects com where),
-- reduzindo carga quando há muitos registros na catraca.

-- Se a coluna já existir, ignore o erro.
ALTER TABLE Dispositivo
ADD COLUMN ultimo_log_id_sincronizado BIGINT NULL COMMENT 'Maior access_logs.id já sincronizado da catraca (Control iD)' AFTER numero_serial;

CREATE INDEX idx_dispositivo_ultimo_log_id ON Dispositivo(ultimo_log_id_sincronizado);
