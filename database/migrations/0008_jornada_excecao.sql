CREATE TABLE IF NOT EXISTS Excecao (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  escopo ENUM('PESSOA', 'TURMA', 'TODOS') NOT NULL,
  alvo_id INT NULL,
  efeito ENUM('REMOVER_EXPECTATIVA', 'JUSTIFICAR_AUSENCIA') NOT NULL,
  data_inicio DATE NOT NULL,
  data_fim DATE NOT NULL,
  criada_por INT NOT NULL,
  motivo VARCHAR(500) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_excecao_periodo CHECK (data_fim >= data_inicio),
  CONSTRAINT chk_excecao_alvo CHECK ((escopo = 'TODOS' AND alvo_id IS NULL) OR (escopo <> 'TODOS' AND alvo_id IS NOT NULL)),
  INDEX idx_excecao_janela (data_inicio, data_fim, escopo, alvo_id),
  CONSTRAINT fk_excecao_usuario FOREIGN KEY (criada_por) REFERENCES Usuario(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
