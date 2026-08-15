CREATE TABLE IF NOT EXISTS TrilhaAuditoria (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NOT NULL,
  acao VARCHAR(60) NOT NULL,
  entidade VARCHAR(60) NULL,
  entidade_id INT NULL,
  detalhe JSON NULL,
  ocorrido_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_trilha_auditoria_usuario
    FOREIGN KEY (usuario_id) REFERENCES Usuario(id) ON DELETE RESTRICT,
  INDEX idx_trilha_auditoria_usuario_ocorrido (usuario_id, ocorrido_em),
  INDEX idx_trilha_auditoria_entidade (entidade, entidade_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TRIGGER IF NOT EXISTS tr_trilha_auditoria_no_update
BEFORE UPDATE ON TrilhaAuditoria
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TrilhaAuditoria e append-only';
END;

CREATE TRIGGER IF NOT EXISTS tr_trilha_auditoria_no_delete
BEFORE DELETE ON TrilhaAuditoria
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TrilhaAuditoria e append-only';
END;
