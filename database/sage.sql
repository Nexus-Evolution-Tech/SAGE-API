-- BANCO: PADRÃO, O SCRIPT RODARÁ O sage.sql PRA TER O BANCO
CREATE SCHEMA IF NOT EXISTS sage;
USE sage;

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
    qr_code VARCHAR(255) NOT NULL COMMENT 'Precisa ser descoberto o padrão ER deste campo: provavelmente será UUID ou código numérico',
    cartao_rfid VARCHAR(8) NOT NULL COMMENT 'Dígito de 8 caracteres: <area>.<codigo>',
    CONSTRAINT chk_rfid CHECK (REGEXP_LIKE(cartao_rfid, '^[0-9]{3}[0-9]{5}$')),
    senha_acesso VARCHAR(255) COMMENT 'Precisa de criptografia na aplicação Node.js',
    data_nascimento DATE ,
    tipo ENUM ('ALUNO', 'RESPONSAVEL', 'PROFESSOR', 'ADMINISTRADOR', 'TERCEIRIZADO', 'PROFADM') ,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (unidade_id) REFERENCES UnidadeEscolar(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS Horario (
    id INT AUTO_INCREMENT PRIMARY KEY,
    pessoa_id INT ,
    dia_semana ENUM ('DOMINGO', 'SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA', 'SABADO') ,
    entrada TIME,
    saida TIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (pessoa_id) REFERENCES Pessoa(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS Atraso (
    id INT AUTO_INCREMENT PRIMARY KEY,
    pessoa_id INT ,
    data DATE ,
    horario_previsto TIME,
    horario_chegada TIME,
    FOREIGN KEY (pessoa_id) REFERENCES Pessoa(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS Responsavel (
    id INT PRIMARY KEY,
    aluno_id INT,
    FOREIGN KEY (id) REFERENCES Pessoa(id) ON DELETE CASCADE
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
    cargo ENUM ('DIRETOR',
	  'VICE_DIRETOR',
	  'COORDENADOR_PEDAGOGICO',
	  'SECRETARIO_ESCOLAR',
	  'TESOUREIRO',
	  'SUPERVISOR_ADMINISTRATIVO',
	  'AUXILIAR_ADMINISTRATIVO',
	  'TECNICO_ADMINISTRATIVO',
	  'ORIENTADOR_EDUCACIONAL',
	  'COORDENADOR_DE_CURSO',
	  'RESPONSAVEL_FINANCEIRO',
	  'ALMOXARIFE',
	  'BIBLIOTECARIO',
	  'OUTRO') ,
    FOREIGN KEY (id) REFERENCES Funcionario(id) ON DELETE CASCADE
);

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
	  'AUXILIZAR_LIMPEZA',
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
    nome VARCHAR(50) ,
    professor_id INT,
    turma_id INT,
    materia_id INT,
    inicio TIME ,
    fim TIME ,
    dia_semana ENUM ('DOMINGO', 'SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA', 'SABADO') ,
    divisao ENUM ('INT', 'DIV A', 'DIV B') ,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (professor_id) REFERENCES Professor(id) ON DELETE SET NULL,
    FOREIGN KEY (turma_id) REFERENCES Turma(id) ON DELETE SET NULL,
    FOREIGN KEY (materia_id) REFERENCES Materia(id) ON DELETE SET NULL
);

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
  action ENUM ('CREATE', 'UPDATE', 'DELETE'),
  FOREIGN KEY (pessoa_id) REFERENCES Pessoa(id),
  FOREIGN KEY (dispositivo_id) REFERENCES Dispositivo(id)
);

DELIMITER $$

CREATE PROCEDURE atualizar_turmas_e_status()
BEGIN
    DECLARE v_atualizados INT DEFAULT 0;
    DECLARE v_desligados INT DEFAULT 0;

    -- Desliga alunos que estão em turmas finais
    UPDATE Aluno a
    JOIN Pessoa p ON a.id = p.id
    SET a.status = 'CANCELADO', p.updated_at = NOW() -- o SET ocorre depois do WHERE ser avaliado
    WHERE p.tipo = 'ALUNO'
      AND a.status = 'EM CURSO'
      AND YEAR(p.updated_at) < YEAR(CURDATE())
      AND a.turma_id IN (5, 6, 8, 9);

    SET v_desligados = ROW_COUNT(); -- pega quantos foram desligados

    -- Atualiza turma conforme regras definidas
    UPDATE Aluno a
    JOIN Pessoa p ON a.id = p.id
    SET 
        a.turma_id = CASE 
                        WHEN a.turma_id = 1 THEN 3
                        WHEN a.turma_id = 2 THEN 4
                        WHEN a.turma_id = 3 THEN 5
                        WHEN a.turma_id = 4 THEN 6
                        WHEN a.turma_id = 7 THEN 9
                        ELSE a.turma_id
                    END,
        p.updated_at = NOW()
    WHERE p.tipo = 'ALUNO'
      AND a.status = 'EM CURSO'
      AND YEAR(p.updated_at) < YEAR(CURDATE())
      AND a.turma_id IN (1, 2, 3, 4, 7);

    SET v_atualizados = ROW_COUNT(); -- pega quantos foram atualizados   

END$$

DELIMITER ;


DELIMITER $$

CREATE EVENT atualizar_ou_desligar_alunos
-- ON SCHEDULE AT CURRENT_TIMESTAMP + INTERVAL 1 MINUTE
ON SCHEDULE
    EVERY 1 YEAR
    STARTS TIMESTAMP(CONCAT(YEAR(CURDATE()) + 1, '-01-01 00:00:00'))
DO
BEGIN
    CALL atualizar_turmas_e_status();
    
    -- Exibe o número de alunos atualizados e desligados
    SELECT CONCAT('Alunos atualizados: ', v_atualizados) AS Atualizados,
           CONCAT('Alunos desligados: ', v_desligados) AS Desligados;
END$$

DELIMITER ;
