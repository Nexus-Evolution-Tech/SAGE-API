-- Execute este arquivo MANUALMENTE no MySQL se você já tem o banco criado
-- e quer apenas as alterações necessárias para a tela de relatórios funcionar.
-- Uso: mysql -u root -p sage < database/MIGRACAO_RELATORIOS_MANUAL.sql

USE sage;

-- Índice para melhorar performance dos relatórios de acesso (Presenca por data e pessoa)
-- Se der erro "Duplicate key name", o índice já existe e pode ignorar.
CREATE INDEX idx_presenca_data_pessoa ON Presenca(data, pessoa_id);
