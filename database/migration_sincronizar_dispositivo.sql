-- Migração: Toggle "sincronizar" por dispositivo
-- Quando sincronizar = 0, o job de sync (histórico pesado) e o boot não sincronizam acessos desse dispositivo.
-- O monitoramento em tempo real (polling leve) continua para todos os dispositivos.
-- Rodar manualmente se a coluna já existir: ignorar erro "Duplicate column name".

ALTER TABLE Dispositivo
  ADD COLUMN sincronizar TINYINT(1) NOT NULL DEFAULT 1
  COMMENT '1 = incluir na sincronização pesada de acessos (boot + cron 10min); 0 = apenas monitoramento leve';
