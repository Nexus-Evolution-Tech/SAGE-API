-- Migration: Garantir que HorarioAula tenha coluna 'horario' para relatórios
-- Quando o schema usa inicio/fim, esta migration adiciona horario como coluna gerada
-- Uso: mysql -u root -p sage < database/migration_horario_aula_horario.sql

-- Verificar se a coluna horario existe; se não, adicionar a partir de inicio/fim
-- Nota: MySQL não permite IF NOT EXISTS para colunas diretamente.
-- Execute manualmente se sua HorarioAula tem inicio/fim mas não horario:

-- ALTER TABLE HorarioAula ADD COLUMN horario VARCHAR(11) GENERATED ALWAYS AS
--   (CONCAT(TIME_FORMAT(inicio,'%H:%i'),'-',TIME_FORMAT(fim,'%H:%i'))) STORED;

-- Ou, se a coluna já existe como NULL e você quer preencher:
-- UPDATE HorarioAula SET horario = CONCAT(TIME_FORMAT(inicio,'%H:%i'),'-',TIME_FORMAT(fim,'%H:%i')) WHERE horario IS NULL AND inicio IS NOT NULL AND fim IS NOT NULL;
