CREATE TABLE IF NOT EXISTS CalendarioEscolar (
  id INT AUTO_INCREMENT PRIMARY KEY,
  data DATE NOT NULL,
  tipo ENUM('DIA_LETIVO', 'FERIADO', 'RECESSO', 'SABADO_LETIVO') NOT NULL,
  descricao VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_calendario_data (data),
  INDEX idx_calendario_tipo_data (tipo, data)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ExpectativaPresencaSlot (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  pessoa_id INT NOT NULL,
  data DATE NOT NULL,
  faixa_inicio TIME NOT NULL,
  faixa_fim TIME NOT NULL,
  origem ENUM('GRADE', 'FUNCIONARIO') NOT NULL,
  origem_id INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_expectativa_slot (pessoa_id, data, faixa_inicio, faixa_fim, origem, origem_id),
  INDEX idx_expectativa_data_pessoa (data, pessoa_id),
  CONSTRAINT fk_expectativa_pessoa FOREIGN KEY (pessoa_id) REFERENCES Pessoa(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO ConfigSistema (chave, valor) VALUES
  ('tempo_horario_abertura', '06:00'),
  ('tempo_horario_fechamento', '23:00'),
  ('tempo_tolerancia_atraso_minutos', '15');
