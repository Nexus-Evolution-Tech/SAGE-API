CREATE SCHEMA IF NOT EXISTS checkly;
USE checkly;

CREATE TABLE IF NOT EXISTS UnidadeEscolar (
    id INT AUTO_INCREMENT PRIMARY KEY COMMENT 'Identificador único da unidade escolar',
    login VARCHAR(100) NOT NULL COMMENT 'Login da unidade para autenticação com a catraca',
    senha VARCHAR(255) NOT NULL COMMENT 'Senha da unidade para autenticação com a catraca - Precisa ser criptografada na aplicação Node.js',
    cnpj CHAR(14) NOT NULL,
    CONSTRAINT chk_cnpj CHECK (REGEXP_LIKE(cnpj, '^[0-9]{14}$')),
    nome VARCHAR(255) NOT NULL,
    numero CHAR(3) NOT NULL,
    endereco VARCHAR(255) NOT NULL,
    logo VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS UnidadeFoto (
    id INT AUTO_INCREMENT PRIMARY KEY,
    unidade_id INT,
    tipo VARCHAR(50) NOT NULL COMMENT 'Ex: Fachada, Planta',
    caminho VARCHAR(255) NOT NULL COMMENT 'Caminho da imagem local ou nuvem',
    descricao VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (unidade_id) REFERENCES UnidadeEscolar(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS Area (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    unidade_id INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (unidade_id) REFERENCES UnidadeEscolar(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS Dispositivo (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(50) NOT NULL,
    modelo VARCHAR(50) NOT NULL COMMENT 'Ex: IDBlock, IDAcess',
    endereco VARCHAR(50) NOT NULL,
    porta INT NOT NULL,
    usuario VARCHAR(255) NOT NULL,
    senha VARCHAR(255) NOT NULL COMMENT 'Precisa ser criptografada na aplicação Node.js',
    area_id INT,
    numero_serial VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (area_id) REFERENCES Area(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS Curso (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    duracao INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Turma (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(50) NOT NULL,
    turno ENUM ('MATUTINO', 'VESPERTINO', 'NOTURNO', 'INTEGRAL') NOT NULL,
    curso_id INT,
    unidade_id INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (curso_id) REFERENCES Curso(id) ON DELETE SET NULL,
    FOREIGN KEY (unidade_id) REFERENCES UnidadeEscolar(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS Pessoa (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    foto VARCHAR(255) NOT NULL,
    rg VARCHAR(9) NOT NULL,
    CONSTRAINT chk_rg CHECK (REGEXP_LIKE(rg, '^[0-9]{7}$|^[0-9]{9}$')),
    cpf CHAR(11) NOT NULL,
    CONSTRAINT chk_cpf CHECK (REGEXP_LIKE(cpf, '^[0-9]{11}$')),
    telefone VARCHAR(20) NOT NULL,
    CONSTRAINT chk_telefone CHECK (REGEXP_LIKE(telefone, '^[0-9]{10,11}$')),
    email VARCHAR(100) NOT NULL COMMENT 'Email de contato, em caso de alunos é o institucional',
    unidade_id INT,
    qr_code VARCHAR(255) NOT NULL COMMENT 'Precisa ser descoberto o padrão ER deste campo: provavelmente será UUID ou código numérico',
    cartao_rfid VARCHAR(255) NOT NULL COMMENT 'Precisa ser descoberto o padrão ER deste campo: provavelmente será um hexadecimal ou numérico com 8 a 16 caracteres',
    senha_acesso VARCHAR(255) NOT NULL COMMENT 'Precisa de criptografia na aplicação Node.js',
    tipo ENUM ('ALUNO', 'PROFESSOR', 'ADMINISTRADOR', 'TERCEIRIZADO', 'PROFADM') NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (unidade_id) REFERENCES UnidadeEscolar(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS Professor (
    id INT PRIMARY KEY,
    siape VARCHAR(20) NOT NULL,
    FOREIGN KEY (id) REFERENCES Pessoa(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS Materia (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    sigla VARCHAR(10) NOT NULL,
    professor_id INT,
    curso_id INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (professor_id) REFERENCES Professor(id) ON DELETE SET NULL,
    FOREIGN KEY (curso_id) REFERENCES Curso(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS Administrador (
    id INT PRIMARY KEY,
    funcao VARCHAR(50) NOT NULL,
    FOREIGN KEY (id) REFERENCES Pessoa(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS Empresa (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    cnpj CHAR(14) NOT NULL,
    CONSTRAINT chk_cnpj_empresa CHECK (REGEXP_LIKE(cnpj, '^[0-9]{14}$')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Terceirizado (
    id INT PRIMARY KEY,
    empresa_id INT,
    funcao VARCHAR(50) NOT NULL,
    FOREIGN KEY (id) REFERENCES Pessoa(id) ON DELETE CASCADE,
    FOREIGN KEY (empresa_id) REFERENCES Empresa(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS Responsavel (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    rg VARCHAR(9) NOT NULL,
    CONSTRAINT chk_rg_responsavel CHECK (REGEXP_LIKE(rg, '^[0-9]{7}$|^[0-9]{9}$')),
    cpf CHAR(11) NOT NULL,
    CONSTRAINT chk_cpf_responsavel CHECK (REGEXP_LIKE(cpf, '^[0-9]{11}$')),
    telefone VARCHAR(11) NOT NULL,
    CONSTRAINT chk_telefone_responsavel CHECK (REGEXP_LIKE(telefone, '^[0-9]{10,11}$')),
    email VARCHAR(100) NOT NULL COMMENT 'Email de contato, em caso de alunos é o institucional',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Aluno (
    id INT PRIMARY KEY,
    rm CHAR(12) NOT NULL COMMENT '20232930077 -> yyyy<numero_unidade><numero_aluno>',
    CONSTRAINT chk_rm CHECK (REGEXP_LIKE(rm, '^[0-9]{4}[0-9]{3}[0-9]{4}$')),
    turma_id INT,
    responsavel_id INT,
    FOREIGN KEY (id) REFERENCES Pessoa(id) ON DELETE CASCADE,
    FOREIGN KEY (turma_id) REFERENCES Turma(id) ON DELETE SET NULL,
    FOREIGN KEY (responsavel_id) REFERENCES Responsavel(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS Aula (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(50) NOT NULL,
    professor_id INT,
    turma_id INT,
    materia_id INT,
    inicio TIME NOT NULL,
    fim TIME NOT NULL,
    dia_semana ENUM ('DOMINGO', 'SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA') NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (professor_id) REFERENCES Professor(id) ON DELETE SET NULL,
    FOREIGN KEY (turma_id) REFERENCES Turma(id) ON DELETE SET NULL,
    FOREIGN KEY (materia_id) REFERENCES Materia(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS Acesso (
    id INT AUTO_INCREMENT PRIMARY KEY,
    pessoa_id INT,
    dispositivo_id INT,
    status ENUM ('ENTRADA', 'SAIDA') NOT NULL,
    permitido BOOLEAN NOT NULL,
    data_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    metodo_auth ENUM ('QRCODE', 'RFID', 'SENHA') NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (pessoa_id) REFERENCES Pessoa(id) ON DELETE SET NULL,
    FOREIGN KEY (dispositivo_id) REFERENCES Dispositivo(id) ON DELETE SET NULL
);
