-- Migração: identidade real do acesso — o id do log NA CATRACA.
--
-- MOTIVO (Fase 2b, PR #2)
-- Hoje a deduplicação de acessos usa a tupla (pessoa_id, dispositivo_id, data_hora). Isso está
-- errado nos dois sentidos:
--
--   1) FALSO POSITIVO — duas passagens legítimas da mesma pessoa, na mesma catraca, dentro do
--      mesmo SEGUNDO são indistinguíveis. A segunda é descartada como "duplicata". Raro, mas
--      acontece em revalidação de cartão e em porta dupla.
--   2) FALSO NEGATIVO — o resync após queda relia a mesma janela e comparava DATETIME contra
--      DATETIME. Com o desvio de 3h do driver (ver test/fuso-horario.test.js), a mesma linha
--      podia não bater consigo mesma e ser inserida DE NOVO.
--
-- O log da catraca já tem identidade própria e estável: `log.id`, monotônico por equipamento.
-- Guardá-lo torna a ingestão IDEMPOTENTE por construção — o banco passa a ser o guardião da
-- unicidade, não a lógica da aplicação. É o que permite, no PR #3, trocar
-- `SELECT ... ; if (!existe) INSERT` (2 a 3 idas ao banco por log) por um único
-- `INSERT ... ON DUPLICATE KEY UPDATE`, que num HD mecânico é a diferença que importa.
--
-- COMPATIBILIDADE
-- A coluna é NULL nas linhas já existentes. Em MySQL, um índice UNIQUE **ignora NULLs**: quantas
-- linhas antigas houver, todas convivem. Nenhum backfill é necessário e nenhum acesso histórico
-- é perdido — não temos como saber, retroativamente, qual log da catraca gerou cada linha.
--
-- CUSTO
-- Um ALTER com criação de índice reescreve o índice secundário inteiro. Com ~48k acessos num HD
-- 7200rpm isso é de segundos, e roda uma única vez, na atualização. Aceitável.
--
-- Idempotente: pode rodar em banco novo, em banco já migrado, e repetidas vezes.

-- 1) Coluna (idempotente)
SET @tem_coluna = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Acesso' AND COLUMN_NAME = 'catraca_log_id');
SET @sql = IF(@tem_coluna = 0,
  'ALTER TABLE Acesso ADD COLUMN catraca_log_id BIGINT NULL DEFAULT NULL COMMENT ''id do log no equipamento; NULL em acessos manuais e em linhas anteriores a esta migracao'' AFTER dispositivo_id',
  'SELECT ''catraca_log_id ja existe''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2) Unicidade por equipamento (idempotente).
--    A ordem das colunas importa: (dispositivo_id, catraca_log_id) também serve como índice de
--    varredura por dispositivo, que é como a sync sempre consulta.
SET @tem_idx = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Acesso'
    AND INDEX_NAME = 'uq_acesso_dispositivo_catraca_log');
SET @sql = IF(@tem_idx = 0,
  'ALTER TABLE Acesso ADD CONSTRAINT uq_acesso_dispositivo_catraca_log UNIQUE (dispositivo_id, catraca_log_id)',
  'SELECT ''uq_acesso_dispositivo_catraca_log ja existe''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
