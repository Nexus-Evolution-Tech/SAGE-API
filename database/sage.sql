-- Schema do SAGE.
--
-- ATENÇÃO (achado A-1, docs/ACHADOS-INSTALADOR.md): este arquivo NÃO deve criar nem selecionar o
-- banco. Antes ele fazia `CREATE SCHEMA IF NOT EXISTS sage; USE sage;`, o que ignorava a variável
-- DB_NAME: o schema ia sempre para `sage` e as migrations seguintes rodavam num banco vazio,
-- falhando todas — com o instalador reportando sucesso (exit 0).
--
-- Quem cria e seleciona o banco é `scripts/setup-database.js`, que já respeita DB_NAME.
-- Para rodar este arquivo à mão, informe o banco: `mysql -u root -p -D nome_do_banco < sage.sql`

SET time_zone = '-03:00';

CREATE TABLE IF NOT EXISTS UnidadeEscolar (
    id INT AUTO_INCREMENT PRIMARY KEY COMMENT 'Identificador único da unidade escolar',
    nome VARCHAR(255) ,
    numero_unidade CHAR(3),
    cnpj CHAR(14),
    CONSTRAINT chk_cnpj CHECK (REGEXP_LIKE(cnpj, '^[0-9]{14}$')),
    login VARCHAR(100) COMMENT 'Login da unidade para autenticação com a catraca',
    senha VARCHAR(255) COMMENT 'Senha da unidade para autenticação com a catraca - Precisa ser criptografada na aplicação Node.js',
    logradouro CHAR(255),
	numero VARCHAR(255),
	complemento VARCHAR(255),
	bairro VARCHAR(255),
	cidade VARCHAR(255),
	estado CHAR(2),
	cep CHAR(8),
    CONSTRAINT chk_cep CHECK (REGEXP_LIKE(cep, '^[0-9]{8}$')),
    telefone_contato VARCHAR(11),
    CONSTRAINT chk_telefone_contato CHECK (REGEXP_LIKE(telefone_contato, '^[0-9]{10,11}$')),
    email VARCHAR(255) NULL COMMENT 'Email de contato da unidade',
    logo VARCHAR(255),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS UnidadeFoto (
    id INT AUTO_INCREMENT PRIMARY KEY,
    unidade_id INT,
    tipo  ENUM('FACHADA', 'PLANTA', 'EVENTOS', 'INTERNA', 'EXTERNA', 'LOGO', 'OUTRO') DEFAULT 'OUTRO'  COMMENT 'Ex: Fachada, Planta',
    caminho VARCHAR(255)  COMMENT 'Caminho da imagem local ou nuvem',
    descricao VARCHAR(255) ,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (unidade_id) REFERENCES UnidadeEscolar(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS Area (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100) ,
    unidade_id INT,
    foto VARCHAR(255) NULL COMMENT 'Caminho relativo da foto (ex: areas/area_1.png)',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (unidade_id) REFERENCES UnidadeEscolar(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS Dispositivo (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(50) ,
    modelo VARCHAR(50)  COMMENT 'Ex: IDBlock, IDAcess',
    endereco VARCHAR(50) ,
    porta VARCHAR(50) ,
    usuario VARCHAR(255) ,
    senha VARCHAR(255)  COMMENT 'Precisa ser criptografada na aplicação Node.js',
    status ENUM('ONLINE', 'OFFLINE', 'DESCONHECIDO') DEFAULT 'DESCONHECIDO',
    sync_enabled TINYINT(1) NOT NULL DEFAULT 1 COMMENT '0 desativa sincronização automática',
    last_health_check DATETIME NULL,
    area_id INT,
    numero_serial VARCHAR(255) ,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (area_id) REFERENCES Area(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS Curso (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100) ,
    duracao INT ,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Turma (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(50) ,
    turno ENUM ('MATUTINO', 'VESPERTINO', 'NOTURNO', 'INTEGRAL') ,
    curso_id INT,
    unidade_id INT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (curso_id) REFERENCES Curso(id) ON DELETE SET NULL,
    FOREIGN KEY (unidade_id) REFERENCES UnidadeEscolar(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS Pessoa (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    foto VARCHAR(255),
    orgao_emissor_rg VARCHAR(255),
    rg VARCHAR(9) ,
    CONSTRAINT chk_rg CHECK (REGEXP_LIKE(rg, '^[0-9]{7}$|^[0-9]{9}$')),
    cpf CHAR(11) ,
    CONSTRAINT chk_cpf CHECK (REGEXP_LIKE(cpf, '^[0-9]{11}$')),
    telefone VARCHAR(20) ,
    CONSTRAINT chk_telefone CHECK (REGEXP_LIKE(telefone, '^[0-9]{10,11}$')),
    email VARCHAR(100)  COMMENT 'Email de contato, em caso de alunos é o institucional',
    unidade_id INT,
    qr_code VARCHAR(8),
    cartao_rfid VARCHAR(8) COMMENT 'Dígito de 8 caracteres: <area>.<codigo>',
    CONSTRAINT chk_rfid CHECK (REGEXP_LIKE(cartao_rfid, '^[0-9]{3}[0-9]{5}$')),
    senha_acesso VARCHAR(255) COMMENT 'Precisa de criptografia na aplicação Node.js',
    data_nascimento DATE,
    tipo ENUM ('ALUNO', 'RESPONSAVEL', 'PROFESSOR', 'ADMINISTRADOR', 'TERCEIRIZADO', 'PROFADM'),
    visivel BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (unidade_id) REFERENCES UnidadeEscolar(id) ON DELETE SET NULL
);

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
CREATE INDEX idx_presenca_data_pessoa ON Presenca(data, pessoa_id);

CREATE TABLE IF NOT EXISTS Responsavel (
    id INT PRIMARY KEY,
    aluno_id INT,
    FOREIGN KEY (id) REFERENCES Pessoa(id) ON DELETE CASCADE -- ATENÇÃO: quando ficar invisível, precisa fazer o soft delete do responsável também
);

CREATE TABLE IF NOT EXISTS Aluno (
    id INT PRIMARY KEY,
    ra CHAR(14)  COMMENT '00001115926676 -> 0001115926676<digito>',
    CONSTRAINT chk_ra CHECK (REGEXP_LIKE(ra, '^[0-9]{10,14}$')),
    rm CHAR(12)  COMMENT '20232930077 -> yyyy<numero_unidade><numero_aluno>',
    CONSTRAINT chk_rm CHECK (REGEXP_LIKE(rm, '^[0-9]{4}[0-9]{3}[0-9]{4}$')),
    turma_id INT,
    divisao ENUM ('DIV A', 'DIV B', 'INT'),
    status ENUM ('CANCELADO', 'CONCLUIDO', 'DESISTENTE', 'EM CURSO', 'RETIDO', 'TRANCADO', 'TRANSFERENCIA EXPEDIDA', 'SUSPENSO') ,
    FOREIGN KEY (id) REFERENCES Pessoa(id) ON DELETE CASCADE,
    FOREIGN KEY (turma_id) REFERENCES Turma(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS Funcionario (
    id INT PRIMARY KEY,
    matricula VARCHAR(6) ,
    CONSTRAINT chk_matricula CHECK (REGEXP_LIKE(matricula, '^[0-9]{5,6}$')),
    data_admissao DATE ,
    data_saida DATE ,
    tipo_contrato ENUM ('DETERMINADO', 'INDETERMINADO') ,
    FOREIGN KEY (id) REFERENCES Pessoa(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS Professor (
    id INT PRIMARY KEY,
    FOREIGN KEY (id) REFERENCES Funcionario(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS Materia (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(255) ,
    sigla VARCHAR(10) ,
    professor_id INT,
    curso_id INT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (professor_id) REFERENCES Professor(id) ON DELETE SET NULL,
    FOREIGN KEY (curso_id) REFERENCES Curso(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS Administrador (
    id INT PRIMARY KEY,
    cargo VARCHAR(50),
    FOREIGN KEY (id) REFERENCES Funcionario(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS Sala (
    id INT AUTO_INCREMENT PRIMARY KEY,
    unidade_id INT,
    FOREIGN KEY (unidade_id) REFERENCES UnidadeEscolar(id) ON DELETE SET NULL,
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

CREATE TABLE IF NOT EXISTS Empresa (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100) ,
    cnpj CHAR(14) ,
    CONSTRAINT chk_cnpj_empresa CHECK (REGEXP_LIKE(cnpj, '^[0-9]{14}$')),
    logradouro CHAR(255) ,
	numero VARCHAR(255) ,
	complemento VARCHAR(255),
	bairro VARCHAR(255) ,
	cidade VARCHAR(255) ,
	estado CHAR(2) ,
	cep CHAR(8) ,
    CONSTRAINT chk_cep_empresa CHECK (REGEXP_LIKE(cep, '^[0-9]{8}$')),
    telefone_contato VARCHAR(11) ,
    CONSTRAINT chk_telefone_contato_empresa CHECK (REGEXP_LIKE(telefone_contato, '^[0-9]{10,11}$')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Terceirizado (
    id INT PRIMARY KEY,
    empresa_id INT,
    funcao ENUM ('VIGILANTE',
	  'AUXILIAR_LIMPEZA',
	  'SEGURANCA',
	  'SERVICOS_GERAIS',
	  'TECNICO_MANUTENCAO',
	  'JARDINEIRO',
	  'CANTINEIRO',
      'COZINHEIRO',
	  'OUTRO') ,
    FOREIGN KEY (id) REFERENCES Funcionario(id) ON DELETE CASCADE,
    FOREIGN KEY (empresa_id) REFERENCES Empresa(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS Aula (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(50) NOT NULL,
    professor_id INT,
    materia_id INT,
    observacao VARCHAR(255) NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (professor_id) REFERENCES Professor(id) ON DELETE SET NULL,
    FOREIGN KEY (materia_id) REFERENCES Materia(id) ON DELETE SET NULL,
    INDEX idx_professor (professor_id),
    INDEX idx_materia (materia_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabela de agendamento de aulas (separa a associação Aula x Turma x Horário)
CREATE TABLE IF NOT EXISTS HorarioAula (
    id INT AUTO_INCREMENT PRIMARY KEY,
    turma_id INT NOT NULL,
    aula_id INT NOT NULL,
	divisao ENUM('INT', 'DIV A', 'DIV B') NOT NULL,
    dia_semana ENUM('DOMINGO', 'SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA', 'SABADO') NOT NULL,
    horario VARCHAR(11) NOT NULL,
    sala_id INT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (turma_id) REFERENCES Turma(id) ON DELETE CASCADE,
    FOREIGN KEY (aula_id) REFERENCES Aula(id) ON DELETE CASCADE,
    FOREIGN KEY (sala_id) REFERENCES Sala(id) ON DELETE SET NULL,
    
    -- Índices para pesquisas frequentes
    INDEX idx_turma_dia (turma_id, dia_semana),
    INDEX idx_dia_horario (dia_semana, horario),
    INDEX idx_sala (sala_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS Acesso (
    id INT AUTO_INCREMENT PRIMARY KEY,
    pessoa_id INT,
    dispositivo_id INT,
    status ENUM ('ENTRADA', 'SAIDA') ,
    permitido BOOLEAN ,
    metodo_auth ENUM ('QR_CODE', 'CARTAO_RFID', 'SENHA', 'BIOMETRIA') ,
    data_hora DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (pessoa_id) REFERENCES Pessoa(id) ON DELETE SET NULL,
    FOREIGN KEY (dispositivo_id) REFERENCES Dispositivo(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS SolicitacaoAcesso (
    id INT AUTO_INCREMENT PRIMARY KEY,
    aluno_id INT,
    data_hora_solicitacao DATETIME DEFAULT CURRENT_TIMESTAMP,
    motivo VARCHAR(255),
    status ENUM ('PENDENTE', 'APROVADA', 'NEGADA') ,
    data_hora_resposta DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    observacao_resposta VARCHAR(255),
    FOREIGN KEY (aluno_id) REFERENCES Aluno(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS sync_pendente (
  id INT AUTO_INCREMENT PRIMARY KEY,
  pessoa_id INT NOT NULL,
  dispositivo_id INT NOT NULL,
  data_tentativa TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  operation ENUM ('CREATE', 'UPDATE', 'DELETE'),
  FOREIGN KEY (pessoa_id) REFERENCES Pessoa(id),
  FOREIGN KEY (dispositivo_id) REFERENCES Dispositivo(id)
);

-- Configurações do sistema (promoção automática de alunos, etc.)
CREATE TABLE IF NOT EXISTS ConfigSistema (
  chave VARCHAR(100) PRIMARY KEY,
  valor VARCHAR(500),
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Inicializa promoção: 0 = "nunca executou" (primeira execução rodará ao detectar ano novo)
INSERT IGNORE INTO ConfigSistema (chave, valor) VALUES ('ultimo_ano_promocao', '0');
