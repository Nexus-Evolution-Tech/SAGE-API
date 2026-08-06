ALTER TABLE UnidadeEscolar
  ADD COLUMN IF NOT EXISTS recuperacao_chave_hash CHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS recuperacao_falhas INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recuperacao_bloqueada_ate DATETIME NULL,
  ADD COLUMN IF NOT EXISTS recuperacao_gerada_em DATETIME NULL;
