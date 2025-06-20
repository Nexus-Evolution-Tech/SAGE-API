CREATE SCHEMA IF NOT EXISTS checkly;
USE checkly;

CREATE TABLE IF NOT EXISTS UnidadeEscolar (
    id INT AUTO_INCREMENT PRIMARY KEY COMMENT 'Identificador único da unidade escolar',
    login VARCHAR(100) COMMENT 'Login da unidade para autenticação com a catraca',
    senha VARCHAR(255) COMMENT 'Senha da unidade para autenticação com a catraca',
    cnpj VARCHAR(18),
    nome VARCHAR(255),
    numero VARCHAR(3),
    endereco VARCHAR(255),
    logo VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS UnidadeFoto (
    id INT AUTO_INCREMENT PRIMARY KEY,
    unidade_id INT,
    tipo VARCHAR(50) COMMENT 'Ex: Fachada, Planta',
    caminho VARCHAR(255) COMMENT 'Caminho da imagem local ou nuvem',
    descricao VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (unidade_id) REFERENCES UnidadeEscolar(id)
);

CREATE TABLE IF NOT EXISTS Area (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100),
    unidade_id INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (unidade_id) REFERENCES UnidadeEscolar(id)
);

CREATE TABLE IF NOT EXISTS Dispositivo (
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

CREATE TABLE IF NOT EXISTS Curso (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Turma (
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

CREATE TABLE IF NOT EXISTS Pessoa (
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

CREATE TABLE IF NOT EXISTS Responsavel (
	id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100),
    rg VARCHAR(12),
    cpf VARCHAR(14),
    email VARCHAR(100) COMMENT 'Email de contato, em caso de alunos é o institucional',
    telefone VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Aluno (
    id INT PRIMARY KEY,
    turma_id INT,
    rm VARCHAR(12) COMMENT '20232930077 -> yyyy<numero_unidade><numero_aluno>',
    responsavel_id INT,
    FOREIGN KEY (id) REFERENCES Pessoa(id),
    FOREIGN KEY (turma_id) REFERENCES Turma(id),
    FOREIGN KEY (responsavel_id) REFERENCES Responsavel(id)
);

CREATE TABLE IF NOT EXISTS Professor (
    id INT PRIMARY KEY,
    siape VARCHAR(20),
    FOREIGN KEY (id) REFERENCES Pessoa(id)
);

CREATE TABLE IF NOT EXISTS Administrador (
    id INT PRIMARY KEY,
    funcao VARCHAR(50),
    FOREIGN KEY (id) REFERENCES Pessoa(id)
);

CREATE TABLE IF NOT EXISTS Empresa (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100),
    cnpj VARCHAR(18),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Terceirizado (
    id INT PRIMARY KEY,
    empresa_id INT,
    funcao VARCHAR(50),
    FOREIGN KEY (id) REFERENCES Pessoa(id),
    FOREIGN KEY (empresa_id) REFERENCES Empresa(id)
);

CREATE TABLE IF NOT EXISTS Aula (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(50),
    professor_id INT,
    turma_id INT,
    inicio TIME,
    fim TIME,
    dia_semana ENUM ('DOMINGO', 'SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA'),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (professor_id) REFERENCES Professor(id),
    FOREIGN KEY (turma_id) REFERENCES Turma(id)
);

CREATE TABLE IF NOT EXISTS Acesso (
    id INT AUTO_INCREMENT PRIMARY KEY,
    pessoa_id INT,
    dispositivo_id INT,
    tipo VARCHAR(10) COMMENT 'Ex: Entrada, Saída',
    permitido BOOLEAN,
    data_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    metodo_auth ENUM ('QRCODE', 'RFID', 'SENHA'),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (pessoa_id) REFERENCES Pessoa(id),
    FOREIGN KEY (dispositivo_id) REFERENCES Dispositivo(id)
);
