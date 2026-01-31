-- Migration: adicionar coluna foto na tabela Area (para upload de imagem da área)
-- Execute uma vez no banco existente: mysql -u user -p nome_banco < migration_area_foto.sql

ALTER TABLE Area ADD COLUMN foto VARCHAR(255) NULL COMMENT 'Caminho relativo da foto (ex: areas/area_1.png)' AFTER unidade_id;
