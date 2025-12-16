-- Migração: Adicionar campos para melhorias no sistema

-- Adicionar coluna de status e last_health_check na tabela Dispositivo
ALTER TABLE Dispositivo 
ADD COLUMN status ENUM('ONLINE', 'OFFLINE', 'DESCONHECIDO') DEFAULT 'DESCONHECIDO' AFTER senha,
ADD COLUMN last_health_check DATETIME NULL AFTER status;

-- Adicionar índice para melhorar performance de queries
CREATE INDEX idx_dispositivo_status ON Dispositivo(status);

-- Adicionar colunas na tabela sync_pendente
ALTER TABLE sync_pendente
ADD COLUMN error_message TEXT NULL AFTER action,
ADD COLUMN retry_count INT DEFAULT 0 AFTER error_message,
ADD COLUMN last_attempt DATETIME NULL AFTER retry_count;

-- Adicionar índices para melhorar performance
CREATE INDEX idx_sync_pessoa_dispositivo ON sync_pendente(pessoa_id, dispositivo_id);
CREATE INDEX idx_sync_action ON sync_pendente(action);
CREATE INDEX idx_sync_created ON sync_pendente(created_at);

-- Adicionar índices na tabela Acesso para melhorar performance
CREATE INDEX idx_acesso_pessoa_data ON Acesso(pessoa_id, data_hora DESC);
CREATE INDEX idx_acesso_dispositivo_data ON Acesso(dispositivo_id, data_hora DESC);
CREATE INDEX idx_acesso_status ON Acesso(status);

-- Adicionar índices na tabela Pessoa para melhorar performance
CREATE INDEX idx_pessoa_tipo ON Pessoa(tipo);
CREATE INDEX idx_pessoa_cpf ON Pessoa(cpf);
CREATE INDEX idx_pessoa_cartao_rfid ON Pessoa(cartao_rfid);

-- Adicionar campo qr_code na Pessoa se não existir
ALTER TABLE Pessoa 
ADD COLUMN qr_code VARCHAR(8) NULL AFTER cartao_rfid;

CREATE INDEX idx_pessoa_qrcode ON Pessoa(qr_code);

-- Criar tabela de logs do sistema (opcional)
CREATE TABLE IF NOT EXISTS system_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  level ENUM('error', 'warn', 'info', 'debug') NOT NULL,
  message TEXT NOT NULL,
  metadata JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_logs_level (level),
  INDEX idx_logs_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Criar tabela de cache de sessões (backup do Redis)
CREATE TABLE IF NOT EXISTS session_cache (
  dispositivo_id INT PRIMARY KEY,
  session_token VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (dispositivo_id) REFERENCES Dispositivo(id) ON DELETE CASCADE,
  INDEX idx_session_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
