-- Seed: área padrão para as catracas (Portaria/Entrada)
-- 1) Rode antes: migration_area_foto.sql (para ter a coluna foto na tabela Area)
-- 2) Depois rode este arquivo. Pode rodar mais de uma vez: só insere se não existir.

INSERT INTO Area (nome, unidade_id, foto)
SELECT 'Portaria Principal', NULL, NULL
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM Area WHERE nome = 'Portaria Principal' LIMIT 1);
