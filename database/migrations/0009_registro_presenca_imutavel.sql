CREATE TABLE IF NOT EXISTS RegistroPresenca (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  pessoa_id INT NOT NULL,
  dispositivo_id INT NULL,
  momento DATETIME NOT NULL,
  sentido ENUM('ENTRADA', 'SAIDA') NOT NULL,
  origem ENUM('CATRACA', 'MANUAL', 'CORRECAO', 'IMPORTACAO') NOT NULL,
  log_catraca_id INT NULL,
  registro_corrigido_id BIGINT NULL,
  criado_por INT NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  justificativa TEXT NULL,
  CONSTRAINT chk_registro_presenca_correcao CHECK (
    (origem = 'CORRECAO' AND registro_corrigido_id IS NOT NULL AND criado_por IS NOT NULL AND justificativa IS NOT NULL AND CHAR_LENGTH(TRIM(justificativa)) >= 10)
    OR (origem <> 'CORRECAO' AND registro_corrigido_id IS NULL)
  ),
  CONSTRAINT fk_registro_presenca_pessoa FOREIGN KEY (pessoa_id) REFERENCES Pessoa(id) ON DELETE RESTRICT,
  CONSTRAINT fk_registro_presenca_dispositivo FOREIGN KEY (dispositivo_id) REFERENCES Dispositivo(id) ON DELETE RESTRICT,
  CONSTRAINT fk_registro_presenca_anterior FOREIGN KEY (registro_corrigido_id) REFERENCES RegistroPresenca(id) ON DELETE RESTRICT,
  CONSTRAINT fk_registro_presenca_usuario FOREIGN KEY (criado_por) REFERENCES Usuario(id) ON DELETE RESTRICT,
  INDEX idx_registro_presenca_pessoa_momento (pessoa_id, momento),
  INDEX idx_registro_presenca_momento_sentido (momento, sentido),
  INDEX idx_registro_presenca_dispositivo_momento (dispositivo_id, momento),
  INDEX idx_registro_presenca_log_catraca (dispositivo_id, log_catraca_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER $$
CREATE TRIGGER trg_registro_presenca_no_update
BEFORE UPDATE ON RegistroPresenca
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RegistroPresenca e imutavel; insira uma correcao';
END$$

CREATE TRIGGER trg_registro_presenca_no_delete
BEFORE DELETE ON RegistroPresenca
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RegistroPresenca e imutavel; exclusao rejeitada';
END$$
DELIMITER ;

CREATE OR REPLACE VIEW RegistroPresencaVigente AS
SELECT atual.*
  FROM RegistroPresenca atual
 WHERE NOT EXISTS (
   SELECT 1
     FROM RegistroPresenca posterior
    WHERE posterior.registro_corrigido_id = atual.id
 );
