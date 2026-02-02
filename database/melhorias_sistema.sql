-- Migração: Adicionar campos para melhorias no sistema
-- (status e last_health_check já estão no sage.sql; aqui só para DBs antigos que rodaram sage antes dessa alteração)

-- Email da unidade escolar (configurações / contato)
ALTER TABLE UnidadeEscolar ADD COLUMN email VARCHAR(255) NULL COMMENT 'Email de contato da unidade' AFTER telefone_contato;

-- Adicionar coluna de status e last_health_check na tabela Dispositivo (ignorar se já existir)
ALTER TABLE Dispositivo 
ADD COLUMN status ENUM('ONLINE', 'OFFLINE', 'DESCONHECIDO') DEFAULT 'DESCONHECIDO' AFTER senha,
ADD COLUMN last_health_check DATETIME NULL AFTER status;

-- Índice (ignorar se já existir)
CREATE INDEX idx_dispositivo_status ON Dispositivo(status);

-- Adicionar colunas na tabela sync_pendente
ALTER TABLE sync_pendente
ADD COLUMN error_message TEXT NULL AFTER operation,
ADD COLUMN retry_count INT DEFAULT 0 AFTER error_message,
ADD COLUMN last_attempt DATETIME NULL AFTER retry_count;

-- Adicionar índices para melhorar performance
CREATE INDEX idx_sync_pessoa_dispositivo ON sync_pendente(pessoa_id, dispositivo_id);
CREATE INDEX idx_sync_operation ON sync_pendente(operation);
CREATE INDEX idx_sync_data_tentativa ON sync_pendente(data_tentativa);
-- Evita duplicidade por pessoa/dispositivo/operação e elimina SELECTs de deduplicação na aplicação
-- ALTER TABLE sync_pendente ADD UNIQUE KEY uniq_sync_pendente (pessoa_id, dispositivo_id, operation);

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

-- Ajustes de estrutura para alinhamento com API atual
-- Criar tabela Sala (caso ainda não exista)
CREATE TABLE IF NOT EXISTS Sala (
    id INT AUTO_INCREMENT PRIMARY KEY,
    numero VARCHAR(50) NOT NULL COMMENT 'Número ou identificador da sala',
    nome VARCHAR(100) NULL COMMENT 'Nome descritivo da sala',
    capacidade INT NULL COMMENT 'Capacidade de alunos',
    tipo ENUM('SALA_AULA', 'LABORATORIO', 'AUDITORIO', 'BIBLIOTECA', 'OUTRO') DEFAULT 'SALA_AULA',
    ativo BOOLEAN DEFAULT TRUE,
    observacao TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_numero (numero),
    INDEX idx_sala_ativo (ativo),
    INDEX idx_sala_tipo (tipo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- (Removido) Inserção de salas de exemplo — não inserir dados iniciais

-- Aula: adicionar colunas novas (se não existirem)
ALTER TABLE Aula 
ADD COLUMN IF NOT EXISTS sala_padrao_id INT NULL AFTER materia_id;

-- Índices úteis para buscas
CREATE INDEX idx_aula_professor ON Aula(professor_id);
CREATE INDEX idx_aula_materia ON Aula(materia_id);

-- Criar tabela HorarioAula (caso ainda não exista)
CREATE TABLE IF NOT EXISTS HorarioAula (
  id INT AUTO_INCREMENT PRIMARY KEY,
  turma_id INT NOT NULL,
  aula_id INT NOT NULL,
  dia_semana ENUM ('SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA') NOT NULL,
  horario TIME NOT NULL,
  sala_id INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (turma_id) REFERENCES Turma(id) ON DELETE CASCADE,
  FOREIGN KEY (aula_id) REFERENCES Aula(id) ON DELETE CASCADE,
  FOREIGN KEY (sala_id) REFERENCES Sala(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Adicionar FK para sala_padrao_id em Aula (se não existir)
-- Nota: Esta linha pode falhar em MySQL antigo que não suporta ADD CONSTRAINT IF NOT EXISTS
-- Se falhar, ignore o erro
SET @exist_fk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS 
                  WHERE CONSTRAINT_SCHEMA = DATABASE() 
                  AND TABLE_NAME = 'Aula' 
                  AND CONSTRAINT_NAME = 'fk_aula_sala_padrao');

SET @sql_fk := IF(@exist_fk = 0,
    'ALTER TABLE Aula ADD CONSTRAINT fk_aula_sala_padrao FOREIGN KEY (sala_padrao_id) REFERENCES Sala(id) ON DELETE SET NULL',
    'SELECT "FK já existe" AS resultado');

PREPARE stmt FROM @sql_fk;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Garantir índices e unicidade
-- CREATE UNIQUE INDEX idx_horario_turma_dia_hora ON HorarioAula(turma_id, dia_semana, horario);
-- CREATE INDEX idx_horario_sala ON HorarioAula(sala_id);
-- CREATE INDEX idx_horario_dia_hora ON HorarioAula(dia_semana, horario);

-- Tabela Presenca (relatórios de acesso e presença) — garante existência mesmo se sage.sql for parcial
CREATE TABLE IF NOT EXISTS Presenca (
    id INT AUTO_INCREMENT PRIMARY KEY,
    pessoa_id INT NOT NULL,
    data DATE NOT NULL,
    dia_semana ENUM('DOMINGO', 'SEGUNDA', 'TERCA', 'QUARTA', 'QUINTA', 'SEXTA', 'SABADO') NOT NULL,
    aulas_perdidas INT NOT NULL DEFAULT 0,
    horario_previsto TIME,
    horario_chegada TIME,
    atrasado BOOLEAN NOT NULL DEFAULT FALSE,
    FOREIGN KEY (pessoa_id) REFERENCES Pessoa(id) ON DELETE CASCADE
);

-- Índice para relatórios de acesso (Presenca por data e pessoa)
CREATE INDEX idx_presenca_data_pessoa ON Presenca(data, pessoa_id);

-- Horário fixo de entrada/saída por dia da semana (Administrador, Terceirizado, Professor+Admin)
CREATE TABLE IF NOT EXISTS FuncionarioHorario (
    id INT AUTO_INCREMENT PRIMARY KEY,
    funcionario_id INT NOT NULL,
    dia_semana ENUM('SEGUNDA', 'TERCA', 'QUARTA', 'QUINTA', 'SEXTA', 'SABADO') NOT NULL,
    hora_entrada TIME NOT NULL,
    hora_saida TIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_func_dia (funcionario_id, dia_semana),
    FOREIGN KEY (funcionario_id) REFERENCES Funcionario(id) ON DELETE CASCADE
);

-- Professor/ProfAdm que também é Admin: quando true, usa FuncionarioHorario em vez de HorarioAula
ALTER TABLE Professor ADD COLUMN usar_horario_fixo BOOLEAN DEFAULT FALSE;

-- Recuperação de senha (esqueci a senha) — token único por solicitação
CREATE TABLE IF NOT EXISTS RecuperacaoSenha (
  id INT AUTO_INCREMENT PRIMARY KEY,
  unidade_id INT NOT NULL,
  token_hash VARCHAR(64) NOT NULL COMMENT 'Hash SHA-256 do token enviado por email',
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (unidade_id) REFERENCES UnidadeEscolar(id) ON DELETE CASCADE,
  INDEX idx_token_hash (token_hash),
  INDEX idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Configurações do sistema (promoção automática de alunos)
CREATE TABLE IF NOT EXISTS ConfigSistema (
  chave VARCHAR(100) PRIMARY KEY,
  valor VARCHAR(500),
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO ConfigSistema (chave, valor) VALUES ('ultimo_ano_promocao', '0');
