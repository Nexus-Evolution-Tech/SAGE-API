CREATE TABLE UnidadeEscolar (
    id INT AUTO_INCREMENT PRIMARY KEY COMMENT 'Identificador único da unidade escolar',
    login VARCHAR(100) COMMENT 'Login da unidade para autenticação com a catraca',
    senha VARCHAR(255) COMMENT 'Senha da unidade para autenticação com a catraca',
    cnpj VARCHAR(18),
    nome_unidade VARCHAR(255),
    n_unidade INT(3),
    endereco VARCHAR(255),
    logo VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE UnidadeFoto (
    id INT AUTO_INCREMENT PRIMARY KEY,
    unidade_id INT,
    tipo VARCHAR(50) COMMENT 'Ex: Fachada, Planta',
    caminho VARCHAR(255) COMMENT 'Caminho da imagem local ou nuvem',
    descricao VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (unidade_id) REFERENCES UnidadeEscolar(id)
);

CREATE TABLE Area (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100),
    unidade_id INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (unidade_id) REFERENCES UnidadeEscolar(id)
);

CREATE TABLE Dispositivo (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(50),
    modelo VARCHAR(50) COMMENT 'Ex: IDBlock, IDAcess',
    endereco VARCHAR(50),
    porta INT,
    usuario VARCHAR(255),
    senha VARCHAR(255),
    area_id INT,
    numero_serial VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (area_id) REFERENCES Area(id)
);

CREATE TABLE Curso (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE Turma (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(50),
    turno ENUM ('MATUTINO', 'VESPERTINO', 'NOTURNO', 'INTEGRAL'),
    curso_id INT,
    unidade_id INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (curso_id) REFERENCES Curso(id),
    FOREIGN KEY (unidade_id) REFERENCES UnidadeEscolar(id)
);

CREATE TABLE Pessoa (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100),
    foto VARCHAR(255),
    unidade_id INT,
    email VARCHAR(100) COMMENT 'Email de contato, em caso de alunos é o institucional',
    telefone VARCHAR(20),
    qr_code VARCHAR(255),
    cartao_rfid VARCHAR(255),
    senha_acesso VARCHAR(255),
    tipo ENUM ("ALUNO", "PROFESSOR", "ADMINISTRADOR", "TERCEIRIZADO", "PROFADM"),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (unidade_id) REFERENCES UnidadeEscolar(id)
);

CREATE TABLE Aluno (
    id INT PRIMARY KEY,
    turma_id INT,
    rm VARCHAR(12),
    email_responsavel VARCHAR(100),
    tel_responsavel VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (id) REFERENCES Pessoa(id),
    FOREIGN KEY (turma_id) REFERENCES Turma(id)
);

CREATE TABLE Professor (
    id INT PRIMARY KEY,
    siape VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (id) REFERENCES Pessoa(id)
);

CREATE TABLE Administrador (
    id INT PRIMARY KEY,
    funcao VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (id) REFERENCES Pessoa(id)
);

CREATE TABLE Terceirizado (
    id INT PRIMARY KEY,
    nome_empresa VARCHAR(100),
    cnpj VARCHAR(14),
    funcao VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (id) REFERENCES Pessoa(id)
);

/* CREATE TABLE Visitante (
    id INT PRIMARY KEY,
    documento_identidade VARCHAR(50) COMMENT 'Número do documento de identidade, opcional',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (id) REFERENCES Pessoa(id)
); */

CREATE TABLE Aula (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(50),
    professor_id INT,
    turma_id INT,
    inicio TIME,
    fim TIME,
    dia_semana VARCHAR(10) COMMENT 'Ex: Segunda, Terça',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (professor_id) REFERENCES Professor(id),
    FOREIGN KEY (turma_id) REFERENCES Turma(id)
);

CREATE TABLE Acesso (
    id INT AUTO_INCREMENT PRIMARY KEY,
    pessoa_id INT,
    dispositivo_id INT,
    tipo VARCHAR(10) COMMENT 'Ex: Entrada, Saída',
    permitido BOOLEAN,
    inicio_acesso TIME COMMENT 'Hora inicial permitida (opcional)',
    fim_acesso TIME COMMENT 'Hora final permitida (opcional)',
    dias_semana VARCHAR(50) COMMENT 'Dias permitidos, exemplo: Segunda, Terça',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by INT,
    FOREIGN KEY (pessoa_id) REFERENCES Pessoa(id),
    FOREIGN KEY (dispositivo_id) REFERENCES Dispositivo(id),
    FOREIGN KEY (updated_by) REFERENCES Pessoa(id)
);

CREATE TABLE EventoCatraca (
    id INT AUTO_INCREMENT PRIMARY KEY,
    pessoa_id INT,
    dispositivo_id INT,
    timestamp DATETIME,
    estado ENUM ('ENTRADA', 'SAIDA', 'NEGADO'),
    metodo_auth ENUM ('QRCODE', 'RFID', 'SENHA'),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (pessoa_id) REFERENCES Pessoa(id),
    FOREIGN KEY (dispositivo_id) REFERENCES Dispositivo(id)
);

CREATE TABLE LogSincronizacao (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tabela VARCHAR(50) COMMENT 'Nome da tabela afetada',
    registro_id INT COMMENT 'ID do registro afetado',
    tipo_operacao VARCHAR(10) COMMENT 'INSERT, UPDATE, DELETE',
    timestamp DATETIME
);

-- SET FOREIGN_KEY_CHECKS = 0;
-- DROP TABLE dispositivos;
-- SET FOREIGN_KEY_CHECKS = 1;