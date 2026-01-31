-- Consulta: ver quais dispositivos estão vinculados a qual área
-- Rode no MySQL para conferir no banco: mysql -u user -p nome_banco < consulta_dispositivos_area.sql

SELECT
  d.id AS dispositivo_id,
  d.nome AS dispositivo_nome,
  d.area_id,
  a.nome AS area_nome
FROM Dispositivo d
LEFT JOIN Area a ON a.id = d.area_id
ORDER BY d.id;
