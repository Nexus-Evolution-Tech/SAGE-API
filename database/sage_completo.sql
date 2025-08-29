-- BANCO: PADRÃO, O SCRIPT RODARÁ O sage.sql PRA TER O BANCO
CREATE SCHEMA IF NOT EXISTS sage;
USE sage;

SET time_zone = '-03:00';

CREATE TABLE IF NOT EXISTS UnidadeEscolar (
    id INT AUTO_INCREMENT PRIMARY KEY COMMENT 'Identificador único da unidade escolar',
    nome VARCHAR(255) NOT NULL,
    numero_unidade CHAR(3) NOT NULL,
    cnpj CHAR(14) NOT NULL,
    CONSTRAINT chk_cnpj CHECK (REGEXP_LIKE(cnpj, '^[0-9]{14}$')),
    login VARCHAR(100) NOT NULL COMMENT 'Login da unidade para autenticação com a catraca',
    senha VARCHAR(255) NOT NULL COMMENT 'Senha da unidade para autenticação com a catraca - Precisa ser criptografada na aplicação Node.js',
    logradouro CHAR(255) NOT NULL,
	numero VARCHAR(255) NOT NULL,
	complemento VARCHAR(255),
	bairro VARCHAR(255) NOT NULL,
	cidade VARCHAR(255) NOT NULL,
	estado CHAR(2) NOT NULL,
	cep CHAR(8) NOT NULL,
    CONSTRAINT chk_cep CHECK (REGEXP_LIKE(cep, '^[0-9]{8}$')),
    telefone_contato VARCHAR(11) NOT NULL,
    CONSTRAINT chk_telefone_contato CHECK (REGEXP_LIKE(telefone_contato, '^[0-9]{10,11}$')),
    logo VARCHAR(255) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS UnidadeFoto (
    id INT AUTO_INCREMENT PRIMARY KEY,
    unidade_id INT,
    tipo  ENUM('FACHADA', 'PLANTA', 'EVENTOS', 'INTERNA', 'EXTERNA', 'LOGO', 'OUTRO') DEFAULT 'OUTRO' NOT NULL COMMENT 'Ex: Fachada, Planta',
    caminho VARCHAR(255) NOT NULL COMMENT 'Caminho da imagem local ou nuvem',
    descricao VARCHAR(255) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (unidade_id) REFERENCES UnidadeEscolar(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS Area (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    unidade_id INT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (unidade_id) REFERENCES UnidadeEscolar(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS Dispositivo (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(50) NOT NULL,
    modelo VARCHAR(50) NOT NULL COMMENT 'Ex: IDBlock, IDAcess',
    endereco VARCHAR(50) NOT NULL,
    porta VARCHAR(50) NOT NULL,
    usuario VARCHAR(255) NOT NULL,
    senha VARCHAR(255) NOT NULL COMMENT 'Precisa ser criptografada na aplicação Node.js',
    area_id INT,
    numero_serial VARCHAR(255) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (area_id) REFERENCES Area(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS Curso (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    duracao INT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Turma (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(50) NOT NULL,
    turno ENUM ('MATUTINO', 'VESPERTINO', 'NOTURNO', 'INTEGRAL') NOT NULL,
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
    rg VARCHAR(9) NOT NULL,
    CONSTRAINT chk_rg CHECK (REGEXP_LIKE(rg, '^[0-9]{7}$|^[0-9]{9}$')),
    cpf CHAR(11) NOT NULL,
    CONSTRAINT chk_cpf CHECK (REGEXP_LIKE(cpf, '^[0-9]{11}$')),
    telefone VARCHAR(20) NOT NULL,
    CONSTRAINT chk_telefone CHECK (REGEXP_LIKE(telefone, '^[0-9]{10,11}$')),
    email VARCHAR(100) NOT NULL COMMENT 'Email de contato, em caso de alunos é o institucional',
    unidade_id INT,
    qr_code VARCHAR(255) COMMENT 'Precisa ser descoberto o padrão ER deste campo: provavelmente será UUID ou código numérico',
    cartao_rfid VARCHAR(8) COMMENT 'Dígito de 8 caracteres: <area>.<codigo>',
    CONSTRAINT chk_rfid CHECK (REGEXP_LIKE(cartao_rfid, '^[0-9]{3}[0-9]{5}$')),
    senha_acesso VARCHAR(255) COMMENT 'Precisa de criptografia na aplicação Node.js',
    data_nascimento DATE NOT NULL,
    tipo ENUM ('ALUNO', 'RESPONSAVEL', 'PROFESSOR', 'ADMINISTRADOR', 'TERCEIRIZADO', 'PROFADM') NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (unidade_id) REFERENCES UnidadeEscolar(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS Horario (
    id INT AUTO_INCREMENT PRIMARY KEY,
    pessoa_id INT NOT NULL,
    dia_semana ENUM ('DOMINGO', 'SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA', 'SABADO') NOT NULL,
    entrada TIME,
    saida TIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (pessoa_id) REFERENCES Pessoa(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS Atraso (
    id INT AUTO_INCREMENT PRIMARY KEY,
    pessoa_id INT NOT NULL,
    data DATE NOT NULL,
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
    ra CHAR(14) NOT NULL COMMENT '00001115926676 -> 0001115926676<digito>',
    CONSTRAINT chk_ra CHECK (REGEXP_LIKE(ra, '^[0-9]{10,14}$')),
    rm CHAR(12) NOT NULL COMMENT '20232930077 -> yyyy<numero_unidade><numero_aluno>',
    CONSTRAINT chk_rm CHECK (REGEXP_LIKE(rm, '^[0-9]{4}[0-9]{3}[0-9]{4}$')),
    turma_id INT,
    divisao ENUM ('DIV A', 'DIV B', 'INT'),
    status ENUM ('CANCELADO', 'CONCLUIDO', 'DESISTENTE', 'EM CURSO', 'RETIDO', 'TRANCADO', 'TRANSFERENCIA EXPEDIDA', 'SUSPENSO') NOT NULL,
    FOREIGN KEY (id) REFERENCES Pessoa(id) ON DELETE CASCADE,
    FOREIGN KEY (turma_id) REFERENCES Turma(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS Funcionario (
    id INT PRIMARY KEY,
    matricula VARCHAR(6) NOT NULL,
    CONSTRAINT chk_matricula CHECK (REGEXP_LIKE(matricula, '^[0-9]{5,6}$')),
    data_admissao DATE NOT NULL,
    data_saida DATE NOT NULL,
    tipo_contrato ENUM ('DETERMINADO', 'INDETERMINADO') NOT NULL,
    FOREIGN KEY (id) REFERENCES Pessoa(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS Professor (
    id INT PRIMARY KEY,
    FOREIGN KEY (id) REFERENCES Funcionario(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS Materia (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    sigla VARCHAR(10) NOT NULL,
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
	  'OUTRO') NOT NULL,
    FOREIGN KEY (id) REFERENCES Funcionario(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS Empresa (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    cnpj CHAR(14) NOT NULL,
    CONSTRAINT chk_cnpj_empresa CHECK (REGEXP_LIKE(cnpj, '^[0-9]{14}$')),
    logradouro CHAR(255) NOT NULL,
	numero VARCHAR(255) NOT NULL,
	complemento VARCHAR(255),
	bairro VARCHAR(255) NOT NULL,
	cidade VARCHAR(255) NOT NULL,
	estado CHAR(2) NOT NULL,
	cep CHAR(8) NOT NULL,
    CONSTRAINT chk_cep_empresa CHECK (REGEXP_LIKE(cep, '^[0-9]{8}$')),
    telefone_contato VARCHAR(11) NOT NULL,
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
	  'OUTRO') NOT NULL,
    FOREIGN KEY (id) REFERENCES Funcionario(id) ON DELETE CASCADE,
    FOREIGN KEY (empresa_id) REFERENCES Empresa(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS Aula (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(50) NOT NULL,
    professor_id INT,
    turma_id INT,
    materia_id INT,
    inicio TIME NOT NULL,
    fim TIME NOT NULL,
    dia_semana ENUM ('DOMINGO', 'SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA', 'SABADO') NOT NULL,
    divisao ENUM ('INT', 'DIV A', 'DIV B') NOT NULL,
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
    status ENUM ('ENTRADA', 'SAIDA') NOT NULL,
    permitido BOOLEAN NOT NULL,
    metodo_auth ENUM ('QR_CODE', 'CARTAO_RFID', 'SENHA', 'BIOMETRIA') NOT NULL,
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
    status ENUM ('PENDENTE', 'APROVADA', 'NEGADA') NOT NULL,
    data_hora_resposta DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    observacao_resposta VARCHAR(255),
    FOREIGN KEY (aluno_id) REFERENCES Aluno(id) ON DELETE SET NULL
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

-- INSERÇÕES
/*UNIDADE*/
INSERT INTO sage.unidadeescolar (nome, numero_unidade, cnpj, login, senha, logradouro, numero, complemento, bairro, cidade, estado, cep, telefone_contato, logo) VALUES 
("ETEC Taboão da Serra", 293, "62823257029344", "etec", "etec123", "Praça Miguel Ortega", "135", "Prédio Principal", "Parque Assunção", "Taboão da Serra", "SP", "06754160", "1147011856", "etec.png");

/*CURSOS*/
INSERT INTO sage.curso (nome, duracao) VALUES
("Desenvolvimento de Sistemas", 100),
("Informática para Internet", 100),
("Modular", 100);

/*MATERIAS*/
-- DS
INSERT INTO sage.materia (nome, sigla, curso_id) VALUES 
('Língua Portuguesa', 'LP', 1),
('Matemática', 'MAT', 1),
('Física', 'FIS', 1),
('Biologia', 'BIO', 1),
('Química', 'QUI', 1),
('História', 'HIS', 1),
('Geografia', 'GEO', 1),
('Filosofia', 'FILO', 1),
('Sociologia', 'SOC', 1),
('Inglês', 'ING', 1),
('Espanhol', 'ESP', 1),
('Arte', 'ART', 1),
('Educação Física', 'ED. FIS', 1),
('Estudos Avançados de Ciências', 'E.A.C', 1),
('Estudos Avançados de Matemática', 'E.A.M', 1),
('Práticas de Empreendedorismo', 'PE', 1),
('Ética', 'ET', 1),
('Laboratório de Investigação Científica', 'LIC', 1),
('Laboratório de Mediação e Interação Social', 'LMIS', 1),
('Laboratório de Processos Criativos', 'LPC', 1),
('Técnicas de Programação e Algoritmos', 'TPA', 1),
('Análise e Projeto de Sistemas', 'APS', 1),
('Banco de Dados', 'BD', 1),
('Fundamentos de Informática', 'FI', 1),
('Programação Web', 'WEB', 1),
('Programação de Aplicativos Mobile', 'PAM', 1),
('Design Digital', 'DD', 1),
('Desenvolvimento de Sistemas', 'DS', 1),
('Internet Protocol e Segurança de Informação', 'IPSSI', 1),
('Sistemas Embarcados', 'SE', 1),
('Qualidade e Teste de Software', 'QTS', 1),
('Projeto de Trabalho de Conclusão de Curso', 'PDTCC', 1);

-- II
INSERT INTO sage.materia (nome, sigla, curso_id) VALUES 
('Português', 'POR', 2),
('Matemática', 'MAT', 2),
('Física', 'FIS', 2),
('Biologia', 'BIO', 2),
('Química', 'QUI', 2),
('História', 'HIS', 2),
('Geografia', 'GEO', 2),
('Inglês', 'ING', 2),
('Arte', 'ART', 2),
('Educação Física', 'ED. FIS', 1),
('Ética', 'ET', 2),
('I. Web', 'IWEB', 2),
('Fundamentos de Informática', 'FI', 2),
('AD?', 'A.D.', 2),
('APW?', 'A.P.W.', 2),
('PA?', 'PA', 2),
('PC?', 'PC', 2),
('MBD?', 'M.B.D.', 2),
('OCA?', 'O.C.A.', 2),
('SU?', 'SU', 2),
('LI?', 'LI', 2),
('IMC?', 'IMC', 2),
('Computação em Nuvem WEB', 'CNW', 2),
('D.D. Móveis?', 'DDM', 2),
('Banco de Dados', 'BD', 2),
('Sistemas WEB', 'SWEB', 2);

/*TURMAS*/
INSERT INTO sage.turma (nome, turno, curso_id, unidade_id) VALUES
("1º A - MTec-PI Desenvolvimento de Sistemas", "INTEGRAL", 1, 1),
("1º B - MTec-PI Desenvolvimento de Sistemas", "INTEGRAL", 1, 1),
("2º A - MTec-PI Desenvolvimento de Sistemas", "INTEGRAL", 1, 1),
("2º B - MTec-PI Desenvolvimento de Sistemas", "INTEGRAL", 1, 1),
("3º A - MTec-PI Desenvolvimento de Sistemas", "INTEGRAL", 1, 1),
("3º B - MTec-PI Desenvolvimento de Sistemas", "INTEGRAL", 1, 1),
("1º A - MTec-N Informática para Internet", "NOTURNO", 2, 1),
("1º B - MTec-N Informática para Internet", "NOTURNO", 2, 1),
("2º A - MTec-N Informática para Internet", "NOTURNO", 2, 1),
("2º Módulo DS", "NOTURNO", 1, 1),
("3º Módulo DS", "NOTURNO", 1, 1);

-- Inserção de Professores e Administradores
INSERT INTO Pessoa (nome, foto, rg, cpf, telefone, email, unidade_id, qr_code, cartao_rfid, senha_acesso, data_nascimento, tipo)
VALUES
('Harry Antônio Leite', 'foto.jpg', '123456789', '11122233344', '11999998888', 'harry@escola.com', 1, 'uuid-harry', '12345678', 'senha123', '1980-01-01', 'PROFESSOR'),
('Francisco Saiz', 'foto.jpg', '223456789', '11122233355', '11999998887', 'saiz@escola.com', 1, 'uuid-saiz', '94857293', 'senha123', '1981-02-01', 'PROFESSOR'),
('Alícia Stefany', 'foto.jpg', '323456789', '11122233366', '11999998886', 'alicia@escola.com', 1, 'uuid-alicia', '16374859', 'senha123', '1982-03-01', 'PROFADM'),
('Rosana', 'foto.jpg', '423456789', '11122233377', '11999998885', 'rosana@escola.com', 1, 'uuid-rosana', '17263548', 'senha123', '1983-04-01', 'PROFESSOR'),
('Heliene dos Santos', 'foto.jpg', '523456789', '11122233388', '11999998884', 'heliene@escola.com', 1, 'uuid-heliene', '86952341', 'senha123', '1984-05-01', 'PROFESSOR'),
('Votto', 'foto.jpg', '623456789', '11122233399', '11999998883', 'votto@escola.com', 1, 'uuid-votto', '85746273', 'senha123', '1985-06-01', 'PROFESSOR'),
('Giancelo', 'foto.jpg', '723456789', '11122233400', '11999998882', 'giancelo@escola.com', 1, 'uuid-giancoleo', '47463625', 'senha123', '1986-07-01', 'PROFESSOR'),
('Manoel Messias Araújo', 'foto.jpg', '823456789', '11122233411', '11999998881', 'messias@escola.com', 1, 'uuid-messias', '85745849', 'senha123', '1987-08-01', 'PROFESSOR'),
('Sâmela Wutzuke', 'foto.jpg', '923456789', '11122233422', '11999998880', 'samela@escola.com', 1, 'uuid-samela', '14562545', 'senha123', '1988-09-01', 'PROFADM'),
('Carlindo Baeta', 'foto.jpg', '133456789', '11122233433', '11999998879', 'carlindo@escola.com', 1, 'uuid-carlindo', '78549635', 'senha123', '1989-10-01', 'PROFESSOR'),
('Josiane', 'foto.jpg', '143456789', '11122233444', '11999998878', 'josiane@escola.com', 1, 'uuid-josiane', '45215478', 'senha123', '1990-01-01', 'PROFESSOR'),
('Nathane', 'foto.jpg', '153456789', '11122233455', '11999998877', 'nathane@escola.com', 1, 'uuid-nathane', '96586598', 'senha123', '1990-02-01', 'PROFESSOR'),
('Diego', 'foto.jpg', '163456789', '11122233466', '11999998876', 'diego@escola.com', 1, 'uuid-diego', '78548965', 'senha123', '1990-03-01', 'PROFESSOR'),
('Marcelo Afonso Zollo', 'foto.jpg', '173456789', '11122233477', '11999998875', 'zollo@escola.com', 1, 'uuid-zollo', '78549658', 'senha123', '1990-04-01', 'PROFESSOR'),
('Patrícia', 'foto.jpg', '183456789', '11122233488', '11999998874', 'patricia@escola.com', 1, 'uuid-patricia', '12547896', 'senha123', '1990-05-01', 'PROFESSOR'),
('Daniel', 'foto.jpg', '193456789', '11122233499', '11999998873', 'daniel@escola.com', 1, 'uuid-daniel', '15487965', 'senha123', '1990-06-01', 'PROFESSOR'),
('Cristiano SA', 'foto.jpg', '203456789', '11122233500', '11999998872', 'cristiano@escola.com', 1, 'uuid-cristiano', '12365478', 'senha123', '1990-07-01', 'PROFESSOR'),
('Ales Raposo', 'foto.jpg', '213456789', '11122233511', '11999998871', 'ales@escola.com', 1, 'uuid-ales', '45678197', 'senha123', '1990-08-01', 'PROFESSOR'),
('Marcos S.', 'foto.jpg', '223456789', '11122233522', '11999998870', 'marcos.s@escola.com', 1, 'uuid-marcos-s', '34257618', 'senha123', '1990-09-01', 'PROFESSOR'),
('Jean', 'foto.jpg', '233456789', '11122233533', '11999998869', 'jean@escola.com', 1, 'uuid-jean', '15342768', 'senha123', '1990-10-01', 'PROFESSOR'),
('Sheila', 'foto.jpg', '253456789', '11122233555', '11999998867', 'sheila@escola.com', 1, 'uuid-sheila', '15678494', 'senha123', '1990-12-01', 'PROFESSOR'),
('Julia', 'foto.jpg', '263456789', '11122233566', '11999998866', 'julia@escola.com', 1, 'uuid-julia', '12345768', 'senha123', '1991-01-01', 'PROFESSOR'),
('Thiago', 'foto.jpg', '273456789', '11122233577', '11999998865', 'thiago@escola.com', 1, 'uuid-thiago', '15648791', 'senha123', '1991-02-01', 'PROFESSOR'),
('Leide', 'foto.jpg', '283456789', '11122233588', '11999998864', 'leide@escola.com', 1, 'uuid-leide', '15678194', 'senha123', '1991-03-01', 'PROFESSOR'),
('Stephany', 'foto.jpg', '293456789', '11122233599', '11999998863', 'stephany@escola.com', 1, 'uuid-stephany', '15648791', 'senha123', '1991-04-01', 'PROFESSOR'),
('Joelane', 'foto.jpg', '303456789', '11122233600', '11999998862', 'joelane@escola.com', 1, 'uuid-joelane', '64372519', 'senha123', '1991-05-01', 'PROFESSOR'),
('Lucas', 'foto.jpg', '313456789', '11122233611', '11999998861', 'lucas@escola.com', 1, 'uuid-lucas', '54679187', 'senha123', '1991-06-01', 'PROFESSOR'),
('Rafael', 'foto.jpg', '323456789', '11122233622', '11999998860', 'rafael@escola.com', 1, 'uuid-rafael', '13426758', 'senha123', '1991-07-01', 'PROFESSOR'),
('Flávia', 'foto.jpg', '333456789', '11122233633', '11999998859', 'flavia@escola.com', 1, 'uuid-flavia', '13246758', 'senha123', '1991-08-01', 'PROFESSOR'),
('Sullivan', 'foto.jpg', '343456789', '11122233644', '11999998858', 'sullivan@escola.com', 1, 'uuid-sullivan', '45678137', 'senha123', '1991-09-01', 'PROFESSOR'),
('Fabiana', 'foto.jpg', '353456789', '11122233655', '11999998857', 'fabiana@escola.com', 1, 'uuid-fabiana', '59867534', 'senha123', '1991-10-01', 'PROFESSOR'),
('Gleyce', 'foto.jpg', '363456789', '11122233666', '11999998856', 'gleyce@escola.com', 1, 'uuid-gleyce', '99657846', 'senha123', '1991-11-01', 'PROFESSOR'),
('Acássio', 'foto.jpg', '363456789', '11122233666', '11999998856', 'gleyce@escola.com', 1, 'uuid-gleyce', '67854316', 'senha123', '1991-11-01', 'PROFESSOR'),
('Débora', 'foto.jpg', '363456789', '11122233666', '11999998856', 'gleyce@escola.com', 1, 'uuid-gleyce', '76489756', 'senha123', '1991-11-01', 'PROFESSOR'),
('Joelane', 'foto.jpg', '363456789', '11122233666', '11999998856', 'gleyce@escola.com', 1, 'uuid-gleyce', '46578493', 'senha123', '1991-11-01', 'PROFESSOR'),
('Marcos Lisa', 'foto.jpg', '363456789', '11122233666', '11999998856', 'gleyce@escola.com', 1, 'uuid-gleyce', '34215679', 'senha123', '1991-11-01', 'PROFESSOR'),
('Felipe', 'foto.jpg', '363456789', '11122233666', '11999998856', 'gleyce@escola.com', 1, 'uuid-gleyce', '54685673', 'senha123', '1991-11-01', 'PROFESSOR');

INSERT INTO Funcionario (id, matricula, data_admissao, data_saida, tipo_contrato) VALUES
(1, '10001', '2015-02-10', '2018-02-10', 'DETERMINADO'),
(2, '10002', '2016-03-15', '2019-03-15', 'DETERMINADO'),
(3, '10003', '2017-05-01', '2025-12-31', 'INDETERMINADO'),
(4, '10004', '2014-07-20', '2025-12-31', 'INDETERMINADO'),
(5, '10005', '2019-01-12', '2022-01-12', 'DETERMINADO'),
(6, '10006', '2018-06-01', '2025-12-31', 'INDETERMINADO'),
(7, '10007', '2020-09-15', '2023-09-15', 'DETERMINADO'),
(8, '10008', '2013-11-10', '2025-12-31', 'INDETERMINADO'),
(9, '10009', '2021-04-05', '2024-04-05', 'DETERMINADO'),
(10, '10010', '2012-08-18', '2025-12-31', 'INDETERMINADO'),
(11, '10011', '2017-10-22', '2020-10-22', 'DETERMINADO'),
(12, '10012', '2019-12-01', '2025-12-31', 'INDETERMINADO'),
(13, '10013', '2016-01-07', '2019-01-07', 'DETERMINADO'),
(14, '10014', '2015-09-30', '2025-12-31', 'INDETERMINADO'),
(15, '10015', '2018-03-11', '2021-03-11', 'DETERMINADO'),
(16, '10016', '2014-05-25', '2025-12-31', 'INDETERMINADO'),
(17, '10017', '2013-02-13', '2016-02-13', 'DETERMINADO'),
(18, '10018', '2017-07-19', '2025-12-31', 'INDETERMINADO'),
(19, '10019', '2019-11-01', '2022-11-01', 'DETERMINADO'),
(20, '10020', '2012-04-28', '2025-12-31', 'INDETERMINADO'),
(21, '10021', '2020-01-14', '2023-01-14', 'DETERMINADO'),
(22, '10022', '2016-06-03', '2025-12-31', 'INDETERMINADO'),
(23, '10023', '2018-09-27', '2021-09-27', 'DETERMINADO'),
(24, '10024', '2015-12-05', '2025-12-31', 'INDETERMINADO'),
(25, '10025', '2017-08-18', '2020-08-18', 'DETERMINADO'),
(26, '10026', '2013-10-12', '2025-12-31', 'INDETERMINADO'),
(27, '10027', '2014-03-09', '2017-03-09', 'DETERMINADO'),
(28, '10028', '2016-11-16', '2025-12-31', 'INDETERMINADO'),
(29, '10029', '2018-05-21', '2021-05-21', 'DETERMINADO'),
(30, '10030', '2012-09-14', '2025-12-31', 'INDETERMINADO'),
(31, '10031', '2019-07-02', '2022-07-02', 'DETERMINADO'),
(32, '10032', '2015-04-26', '2025-12-31', 'INDETERMINADO'),
(33, '10033', '2016-12-30', '2019-12-30', 'DETERMINADO'),
(34, '10034', '2013-06-22', '2025-12-31', 'INDETERMINADO'),
(35, '10035', '2017-02-17', '2020-02-17', 'DETERMINADO'),
(36, '10036', '2014-11-05', '2025-12-31', 'INDETERMINADO'),
(37, '10037', '2018-08-09', '2021-08-09', 'DETERMINADO');

INSERT INTO Professor (id) VALUES
(1),
(2),
(3),
(4),
(5),
(6),
(7),
(8),
(9),
(10),
(11),
(12),
(13),
(14),
(15),
(16),
(17),
(18),
(19),
(20),
(21),
(22),
(23),
(24),
(25),
(26),
(27),
(28),
(29),
(30),
(31),
(32),
(33),
(34),
(35),
(36),
(37);

INSERT INTO Administrador (id, cargo) VALUES
(3, 'COORDENADOR_PEDAGOGICO'),
(9, 'COORDENADOR_PEDAGOGICO');

-- Alunos 3°B
INSERT INTO Pessoa (nome, foto, rg, cpf, telefone, email, unidade_id, qr_code, cartao_rfid, senha_acesso, data_nascimento, tipo)
VALUES
('Igor', 'foto.jpg', '634150467', '45328562801', '11930402308', 'igorfcfs@gmail.com', 1, 'uuid-harry', '15822040', 'senha123', '2007-08-23', 'ALUNO');
INSERT INTO Aluno (id, ra, rm, turma_id, divisao, status) VALUES
(38, "0001115926676", "20232930077", 6, 'DIV A', 'EM CURSO');

-- Responsáveis
INSERT INTO Pessoa (nome, rg, cpf, telefone, email, data_nascimento, tipo) VALUES
('Jorge Augusto Oliveira Silva', '286319500', '29843488857', '11972541918', 'jorgeaos@gmail.com', '1990-11-07', 'RESPONSAVEL');
INSERT INTO Responsavel (id, aluno_id) VALUES (39, 38);

/*AULAS*/
-- 1º A - MTec-PI Desenvolvimento de Sistemas
INSERT INTO sage.aula (nome, professor_id, turma_id, materia_id, inicio, fim, dia_semana, divisao) VALUES
("Educ. Física - Harry", 1, 1, 13, "07:30:00", "09:10:00", "SEGUNDA", "INT"),
("TPA - Saiz", 2, 1, 21, "09:10:00", "12:00:00", "SEGUNDA", "DIV A"),
("TPA - Alicia", 3, 1, 21, "09:10:00", "12:00:00", "SEGUNDA", "DIV B"),
("LP - Rosana", 4, 1, 1, "13:00:00", "15:30:00", "SEGUNDA", "INT"),
("APS - Heliene", 5, 1, 22, "07:30:00", "09:10:00", "TERÇA", "DIV A"),
("APS - Heliene", 5, 1, 22, "09:10:00", "11:10:00", "TERÇA", "DIV B"),
("FI - Votto", 6, 1, 24, "07:30:00", "09:10:00", "TERÇA", "DIV B"),
("FI - Votto", 6, 1, 24, "09:10:00", "11:10:00", "TERÇA", "DIV A"),
("Lab. Investigação Científica - Giancelo", 7, 1, 18, "11:10:00", "13:50:00", "TERÇA", "INT"),
("Matemática - Messias", 8, 1, 2, "13:50:00", "15:30:00", "TERÇA", "INT"),
("P. Empreendedorismo - Sâmela", 9, 1, 16, "07:30:00", "09:10:00", "QUARTA", "INT"),
("Inglês - Carlindo", 10, 1, 10, "09:10:00", "11:10:00", "QUARTA", "INT"),
("Arte - Josiane", 11, 1, 12, "11:10:00", "13:50:00", "QUARTA", "INT"),
("DD - Nathane", 12, 1, 27, "13:50:00", "15:30:00", "QUARTA", "DIV A"),
("DD - Votto", 6, 1, 27, "13:50:00", "15:30:00", "QUARTA", "DIV B"),
("História - Diego", 13, 1, 6, "11:10:00", "13:50:00", "QUINTA", "INT"),
("Química - Carlindo", 10, 1, 5, "13:50:00", "15:30:00", "QUINTA", "INT"),
("Física - Zollo", 14, 1, 3, "07:30:00", "09:10:00", "SEXTA", "INT"),
("E.A.C - Sheila", 21, 1, 14, "09:10:00", "10:00:00", "SEXTA", "DIV A"),
("E.A.C - Sheila", 21, 1, 14, "10:20:00", "11:10:00", "SEXTA", "DIV B"),
("E.A.M - Patrícia", 15, 1, 15, "09:10:00", "10:00:00", "SEXTA", "DIV B"),
("E.A.M - Patrícia", 15, 1, 15, "10:20:00", "11:10:00", "SEXTA", "DIV A"),
("WEB I - Daniel", 16, 1, 25, "11:10:00", "13:50:00", "SEXTA", "INT"),
("BD I - Daniel", 16, 1, 23, "13:50:00", "15:30:00", "SEXTA", "INT");

-- 1º B - MTec-PI Desenvolvimento de Sistemas
INSERT INTO sage.aula (nome, professor_id, turma_id, materia_id, inicio, fim, dia_semana, divisao) VALUES
("LP - Rosana", 4, 2, 1, "07:30:00", "09:10:00", "SEGUNDA", "INT"),
("Educ. Física - Harry", 1, 2, 13, "09:10:00", "11:10:00", "SEGUNDA", "INT"),
("LP - Rosana", 4, 2, 1, "11:10:00", "12:00:00", "SEGUNDA", "INT"),
("TPA - Saiz", 2, 2, 21, "13:00:00", "15:30:00", "SEGUNDA", "DIV A"),
("TPA - Alicia", 3, 2, 21, "13:00:00", "15:30:00", "SEGUNDA", "DIV B"),
("P. Empreendedorismo - Sâmela", 9, 2, 10, "07:30:00", "09:10:00", "TERÇA", "INT"),
("Lab. Investigação Científica - Gianclo", 7, 2, 18, "09:10:00", "11:10:00", "TERÇA", "INT"),
("APS - Heliene", 5, 2, 22, "11:10:00", "13:50:00", "TERÇA", "DIV A"),
("APS - Heliane", 5, 2, 22, "13:50:00", "15:30:00", "TERÇA", "DIV B"),
("FI - Votto", 6, 2, 24, "11:10:00", "13:50:00", "TERÇA", "DIV B"),
("FI - Votto", 6, 2, 24, "13:50:00", "15:30:00", "TERÇA", "DIV A"),
("Inglês - Carlindo", 10, 2, 10, "07:30:00", "09:10:00", "QUARTA", "INT"),
("DD - Nathane", 12, 2, 27, "09:10:00", "11:10:00", "QUARTA", "DIV A"),
("DD - Votto", 6, 2, 27, "09:10:00", "11:10:00", "QUARTA", "DIV B"),
("Matemática - Messias", 8, 2, 2, "11:10:00", "13:50:00", "QUARTA", "INT"),
("Arte - Josiane", 11, 2, 12, "13:50:00", "15:30:00", "QUARTA", "INT"),
("História - Diego", 13, 2, 6, "07:30:00", "09:10:00", "QUINTA", "INT"),
("Química - Carlindo", 10, 2, 5, "09:10:00", "11:10:00", "QUINTA", "INT"),
("WEB I - Daniel", 16, 2, 25, "11:10:00", "13:50:00", "QUINTA", "INT"),
("BD I - Daniel***", 16, 2, 23, "13:50:00", "15:30:00", "QUINTA", "INT"),
("E.A.C - Sheila", 21, 2, 14, "07:30:00", "08:20:00", "SEXTA", "DIV A"),
("E.A.M - Patrícia", 15, 2, 14, "07:30:00", "08:20:00", "SEXTA", "DIV B"),
("E.A.M - Patrícia", 15, 2, 15, "08:20:00", "09:10:00", "SEXTA", "DIV A"),
("E.A.C - Sheila", 21, 2, 15, "08:20:00", "09:10:00", "SEXTA", "DIV B"),
("Física - Zollo", 14, 2, 3, "09:10:00", "11:10:00", "SEXTA", "INT");

-- 2º A - MTec-PI Desenvolvimento de Sistemas
INSERT INTO sage.aula (nome, professor_id, turma_id, materia_id, inicio, fim, dia_semana, divisao) VALUES
("Biologia - Cristiano", 17, 3, 4, "07:30:00", "09:10:00", "SEGUNDA", "INT"),
("BD II - Votto", 6, 3, 23, "09:10:00", "11:10:00", "SEGUNDA", "DIV A"),
("WEB II - Messias", 8, 3, 25, "09:10:00", "11:10:00", "SEGUNDA", "DIV B"),
("Educ. Física - Harry", 1, 3, 13, "11:10:00", "13:50:00", "SEGUNDA", "INT"),
("WEB II - Daniel", 16, 3, 25, "13:50:00", "15:30:00", "SEGUNDA", "DIV A"),
("BD II - Votto", 6, 3, 23, "13:50:00", "15:30:00", "SEGUNDA", "DIV B"),
("História - Ales", 18, 3, 6, "07:30:00", "09:10:00", "TERÇA", "INT"),
("Ética - Ales", 18, 3, 17, "09:10:00", "10:00:00", "TERÇA", "INT"),
("Matemática - Messias", 8, 3, 2, "10:20:00", "11:10:00", "TERÇA", "INT"),
("Química - ?", NULL, 3, 5, "11:10:00", "13:50:00", "TERÇA", "DIV A"),
("E.A.C - Giancelo", 7, 3, 14, "13:50:00", "14:40:00", "TERÇA", "INT"),
("Geografia - Marcos S.", 19, 3, 7, "07:30:00", "09:10:00", "QUARTA", "INT"),
("Matemática - Messias", 8, 3, 2, "09:10:00", "11:10:00", "QUARTA", "INT"),
("E.A.M - Patrícia", 15, 3, 15, "11:10:00", "12:00:00", "QUARTA", "DIV B"),
("E.A.M - Patrícia", 15, 3, 15, "13:00:00", "13:50:00", "QUARTA", "DIV A"),
("Inglês - Carlindo", 10, 3, 10, "13:50:00", "15:30:00", "QUARTA", "INT"),
("DS - Jean", 20, 3, 28, "07:30:00", "10:00:00", "QUINTA", "DIV A"),
("PAM - Alícia", 3, 3, 26, "09:10:00", "10:00:00", "QUINTA", "DIV A"),
("PAM - Alícia", 3, 3, 26, "10:20:00", "12:00:00", "QUINTA", "DIV B"),
("DS - Jean", 20, 3, 28, "10:20:00", "13:50:00", "QUINTA", "DIV B"),
("LP Criativos - Giancelo", 7, 3, 20, "13:50:00", "15:30:00", "QUINTA", "INT"),
("LP - ?", NULL, 3, 1, "08:20:00", "11:10:00", "SEXTA", "INT"),
("Física - Zollo", 14, 3, 3, "11:10:00", "13:50:00", "SEXTA", "INT"),
("LMI Sociocultural - Sâmela", 9, 3, 19, "13:50:00", "15:30:00", "SEXTA", "INT");

-- 2º B - MTec-PI Desenvolvimento de Sistemas
INSERT INTO sage.aula (nome, professor_id, turma_id, materia_id, inicio, fim, dia_semana, divisao) VALUES
("BD II - Votto", 6, 4, 23, "07:30:00", "09:10:00", "SEGUNDA", "DIV A"),
("WEB II - Messias", 8, 4, 25, "07:30:00", "09:10:00", "SEGUNDA", "DIV B"),
("Biologia - Cristiano", 17, 4, 4, "09:10:00", "11:10:00", "SEGUNDA", "INT"),
("WEB II - Daniel", 16, 4, 25, "11:10:00", "13:50:00", "SEGUNDA", "DIV A"),
("BD II - Votto", 6, 4, 23, "11:10:00", "13:50:00", "SEGUNDA", "DIV B"),
("Educ. Física - Harry", 1, 4, 13, "13:50:00", "15:30:00", "SEGUNDA", "INT"),
("E.A.C - Giancelo", 7, 4, 14, "08:20:00", "09:10:00", "TERÇA", "INT"),
("LMI Sociocultural - Sâmela", 9, 4, 19, "09:10:00", "10:00:00", "TERÇA", "INT"),
("Ética - Ales", 18, 4, 17, "10:20:00", "11:10:00", "TERÇA", "INT"),
("História - Ales", 18, 4, 6, "11:10:00", "13:50:00", "TERÇA", "INT"),
("Química", NULL, 4, 5, "13:50:00", "15:30:00", "TERÇA", "INT"),
("Matemática - Messias", 8, 4, 2, "07:30:00", "09:10:00", "QUARTA", "INT"),
("E.A.M - Patrícia", 15, 4, 15, "09:10:00", "11:10:00", "QUARTA", "DIV B"),
("E.A.M - Patrícia", 15, 4, 15, "10:20:00", "11:10:00", "QUARTA", "DIV A"),
("Inglês - Carlindo", 10, 4, 10, "11:10:00", "13:50:00", "QUARTA", "INT"),
("LMI Sociocultural - Sâmela", 9, 4, 19, "13:50:00", "14:40:00", "QUARTA", "INT"),
("Matemática - Messias", 8, 4, 2, "14:40:00", "15:30:00", "QUARTA", "INT"),
("Geografia - Marcos S.", 19, 4, 7, "08:20:00", "10:00:00", "QUINTA", "INT"),
("LP Criativos - Giancelo", 7, 4, 20, "10:20:00", "12:00:00", "QUINTA", "INT"),
("LP - ?", NULL, 4, 1, "13:00:00", "15:30:00", "QUINTA", "INT"),
("DS - Jean", 20, 3, 28, "07:30:00", "10:00:00", "SEXTA", "DIV A"),
("PAM - Alícia", 3, 3, 26, "09:10:00", "10:00:00", "SEXTA", "DIV A"),
("PAM - Alícia", 3, 3, 26, "10:20:00", "12:00:00", "SEXTA", "DIV B"),
("DS - Jean", 20, 3, 28, "10:20:00", "13:50:00", "SEXTA", "DIV B"),
("Física - Zollo", 14, 4, 3, "13:50:00", "15:30:00", "SEXTA", "INT");

-- 3º A - MTec-PI Desenvolvimento de Sistemas
INSERT INTO sage.aula (nome, professor_id, turma_id, materia_id, inicio, fim, dia_semana, divisao) VALUES
("E.A.C - Julia", 22, 5, 14, "07:30:00", "09:10:00", "SEGUNDA", "DIV A"),
("E.A.Mat - Thiago", 23, 5, 15, "07:30:00", "09:10:00", "SEGUNDA", "DIV B"),
("LP - Rosana", 4, 5, 1, "09:10:00", "11:10:00", "SEGUNDA", "INT"),
("Biologia - Cristiano", 17, 5, 4, "11:10:00", "13:50:00", "SEGUNDA", "INT"),
("Espanhol - Leide", 24, 5, 11, "13:50:00", "15:30:00", "SEGUNDA", "INT"),
("QTS - Nathane", 12, 5, 31, "07:30:00", "09:10:00", "TERÇA", "DIV A"),
("PAM II - Alícia", 3, 5, 26, "07:30:00", "09:10:00", "TERÇA", "DIV B"),
("PAM II - Alícia", 3, 5, 26, "09:10:00", "11:10:00", "TERÇA", "DIV A"),
("QTS - Nathane", 12, 5, 31, "09:10:00", "11:10:00", "TERÇA", "DIV B"),
("Matemática - Messias", 8, 5, 2, "11:10:00", "13:50:00", "TERÇA", "INT"),
("Filosofia - Ales", 18, 5, 8, "13:50:00", "15:30:00", "TERÇA", "INT"),
("IPSS - Stephany", 25, 5, 29, "07:30:00", "09:10:00", "QUARTA", "DIV A"),
("Web III - Alícia", 3, 5, 25, "07:30:00", "09:10:00", "QUARTA", "DIV B"),
("Web III - Alícia", 3, 5, 25, "09:10:00", "11:10:00", "QUARTA", "DIV A"),
("IPSS - Stephany", 25, 5, 29, "09:10:00", "11:10:00", "QUARTA", "DIV B"),
("SE - Votto", 6, 5, 30, "11:10:00", "13:50:00", "QUARTA", "DIV A"),
("SE - Nathane", 12, 5, 30, "11:10:00", "13:50:00", "QUARTA", "DIV B"),
("Matemática - Messias", 8, 5, 2, "13:50:00", "14:40:00", "QUARTA", "INT"),
("Sociologia - Sâmela", 9, 5, 9, "14:40:00", "15:30:00", "QUARTA", "INT"),
("Inglês - Carlindo", 10, 5, 10, "07:30:00", "09:10:00", "QUINTA", "INT"),
("Sociologia - Sâmela", 9, 5, 9, "09:10:00", "10:00:00", "QUINTA", "INT"),
("Geografia - Marcos S.", 19, 5, 7, "10:20:00", "12:00:00", "QUINTA", "INT"),
("PDTCC - Nathane", 12, 5, 32, "13:00:00", "15:30:00", "QUINTA", "DIV B"),
("E.A.Mat - Thiago", 23, 5, 15, "07:30:00", "10:00:00", "SEXTA", "DIV A"),
("E.A.C - Julia", 22, 5, 14, "07:30:00", "10:00:00", "SEXTA", "DIV B"),
("E.A.C - Julia", 22, 5, 14, "10:20:00", "11:10:00", "SEXTA", "DIV A"),
("E.A.Mat - Thiago", 23, 5, 15, "10:20:00", "11:10:00", "SEXTA", "DIV B"),
("PDTCC - Nathane", 12, 5, 32, "11:10:00", "14:40:00", "SEXTA", "DIV A");

-- 3º B - MTec-PI Desenvolvimento de Sistemas
INSERT INTO sage.aula (nome, professor_id, turma_id, materia_id, inicio, fim, dia_semana, divisao) VALUES
("Filosofia - Ales", 18, 6, 8, "07:30:00", "09:10:00", "SEGUNDA", "INT"),
("E.A.Mat - Thiago", 23, 6, 15, "09:10:00", "12:00:00", "SEGUNDA", "DIV A"),
("E.A.C - Julia", 22, 6, 14, "09:10:00", "12:00:00", "SEGUNDA", "DIV B"),
("E.A.C - Julia", 22, 6, 14, "13:00:00", "13:50:00", "SEGUNDA", "DIV A"),
("E.A.Mat - Thiago", 23, 6, 15, "13:00:00", "13:50:00", "SEGUNDA", "DIV B"),
("Biologia - Cristiano", 17, 6, 4, "13:50:00", "15:30:00", "SEGUNDA", "INT"),
("Matemática - Messias", 8, 6, 2, "07:30:00", "10:00:00", "TERÇA", "INT"),
("Sociologia - Sâmela", 9, 6, 9, "10:00:00", "11:10:00", "TERÇA", "INT"),
("QTS - Nathane", 12, 6, 31, "11:10:00", "13:50:00", "TERÇA", "DIV A"),
("PAM II - Alícia", 3, 6, 26, "11:10:00", "13:50:00", "TERÇA", "DIV B"),
("PAM II - Alícia", 3, 6, 26, "13:50:00", "15:30:00", "TERÇA", "DIV A"),
("QTS - Nathane", 12, 6, 31, "13:50:00", "15:30:00", "TERÇA", "DIV B"),
("SE - Votto", 6, 6, 30, "07:30:00", "09:10:00", "QUARTA", "DIV A"),
("SE - Nathane", 12, 6, 30, "07:30:00", "09:10:00", "QUARTA", "DIV B"),
("Geografia - Marcos S.", 19, 6, 7, "09:10:00", "10:00:00", "QUARTA", "INT"),
("IPSS - Alícia***", 3, 6, 29, "11:10:00", "13:50:00", "QUARTA", "INT"),
("Web III - Alícia", 3, 6, 25, "13:50:00", "15:30:00", "QUARTA", "INT"),
("PDTCC - Nathane", 12, 6, 32, "07:30:00", "10:00:00", "QUINTA", "DIV A"),
("Sociologia - Sâmela", 9, 6, 9, "10:20:00", "11:10:00", "QUINTA", "INT"),
("Inglês - Carlindo", 10, 6, 10, "11:10:00", "13:50:00", "QUINTA", "INT"),
("Espanhol - Leide", 24, 6, 11, "13:50:00", "15:30:00", "QUINTA", "INT"),
("PDTCC - Nathane", 12, 6, 32, "08:20:00", "11:10:00", "SEXTA", "DIV B"),
("E.A.C - Julia", 22, 6, 14, "11:10:00", "13:50:00", "SEXTA", "DIV A"),
("E.A.Mat - Thiago", 23, 6, 15, "11:10:00", "13:50:00", "SEXTA", "DIV B"),
("LP - Rosana", 4, 6, 1, "13:50:00", "15:30:00", "SEXTA", "INT");

-- 1º A - MTec-N Informática para Internet
INSERT INTO sage.aula (nome, professor_id, turma_id, materia_id, inicio, fim, dia_semana, divisao) VALUES
("Física - Jean", 20, 7, 35, "18:10:00", "19:50:00", "SEGUNDA", "DIV A"),
("WEB - Daniel", 16, 7, 44, "19:50:00", "20:40:00", "SEGUNDA", "DIV A"),
("WEB - ?", NULL, 7, 44, "19:50:00", "20:40:00", "SEGUNDA", "DIV B"),
("Arte - Josiane", 11, 7, 41, "21:00:00", "22:40:00", "SEGUNDA", "INT"),
("I. WEB - Daniel", 16, 7, 44, "19:10:00", "19:00:00", "TERCA", "DIV A"),
("I. WEB - ?", NULL, 7, 44, "18:10:00", "19:00:00", "TERCA", "DIV B"),
("EF - Harry", 1, 7, 42, "19:00:00", "20:40:00", "TERÇA", "INT"),
("LP - Débora", 34, 7, 33, "21:00:00", "22:40:00", "TERÇA", "INT"),
("FI - Rafael - EAD", 28, 7, 45, "22:40:00", "00:20:00", "TERÇA", "INT"),
("Etica - Flávia", 29, 7, 43, "18:10:00", "19:00:00", "QUARTA", "DIV A"),
("A.D. - Joelane", 35, 7, 46, "19:00:00", "20:40:00", "QUARTA", "DIV A"),
("A.D. - Lucas", 27, 7, 46, "19:00:00", "20:40:00", "QUARTA", "DIV B"),
("Química - Flávia", 29, 7, 37, "21:00:00", "22:40:00", "QUARTA", "INT"),
("Mat - Thiago", 23, 7, 34, "18:10:00", "20:40:00", "QUINTA", "INT"),
("A.P.W. - Lucas", 27, 7, 47, "21:00:00", "22:40:00", "QUINTA", "DIV A"),
("A.P.W. - Daniel", 16, 7, 47, "21:00:00", "22:40:00", "QUINTA", "DIV B"),
("P.A. - Votto", 6, 7, 48, "18:10:00", "20:40:00", "SEXTA", "DIV A"),
("P.A. - Acássio", 33, 7, 48, "18:10:00", "19:00:00", "SEXTA", "DIV B"),
("LP - Débora", 34, 7, 33, "21:00:00", "21:50:00", "SEXTA", "INT"),
("Inglês - Fabiana - EAD", 31, 7, 40, "22:40:00", "00:20:00", "TERÇA", "INT"),
("Biologia - Rafael - EAD", 28, 7, 36, "00:20:00", "02:00:00", "TERÇA", "INT");

-- 1º B - MTec-N Informática para Internet
INSERT INTO sage.aula (nome, professor_id, turma_id, materia_id, inicio, fim, dia_semana, divisao) VALUES
("EF - Harry", 1, 8, 42, "18:10:00", "19:00:00", "SEGUNDA", "INT"),
("Arte - Josiane", 11, 8, 41, "19:00:00", "20:40:00", "SEGUNDA", "INT"),
("PC - Daniel", 16, 8, 49, "21:00:00", "22:40:00", "SEGUNDA", "DIV A"),
("PC - Gleyce", 32, 8, 49, "21:00:00", "22:40:00", "SEGUNDA", "DIV B"),
("M.B.D. - Francisco - EAD", 2, 8, 49, "22:40:00", "00:20:00", "SEGUNDA", "DIV B"),
("EF - Harry", 1, 8, 42, "18:10:00", "19:00:00", "TERÇA", "INT"),
("Física - Jean", 20, 8, 35, "19:00:00", "20:40:00", "TERÇA", "INT"),
("O.C.A. - Lucas", 27, 8, 51, "21:00:00", "22:40:00", "TERÇA", "DIV A"),
("O.C.A. - Daniel", 16, 8, 51, "21:00:00", "22:40:00", "TERÇA", "DIV B"),
("Mat - Thiago", 23, 8, 34, "18:10:00", "20:40:00", "QUARTA", "INT"),
("SU - Lucas", 27, 8, 52, "21:00:00", "22:40:00", "QUARTA", "DIV A"),
("SU - Felipe", 37, 8, 52, "21:00:00", "22:40:00", "QUARTA", "DIV B"),
("Quí - Flávia", 29, 8, 37, "18:10:00", "19:50:00", "QUINTA", "INT"),
("Geo - Marcos Lisa", 30, 8, 39, "19:50:00", "21:50:00", "QUINTA", "INT"),
("História - Diego - EAD", 13, 8, 38, "22:40:00", "00:20:00", "QUINTA", "INT"),
("LP - Débora", 34, 8, 33, "18:10:00", "20:40:00", "SEXTA", "INT"),
("IMC - Votto", 6, 8, 54, "21:00:00", "22:40:00", "SEXTA", "DIV A"),
("IMC - Acássio", 33, 8, 54, "21:00:00", "22:40:00", "SEXTA", "DIV B"),
("LI - Fabiana", 31, 8, 53, "22:40:00", "00:20:00", "SEXTA", "INT");

-- 2º A - MTec-N Informática para Internet
INSERT INTO sage.aula (nome, professor_id, turma_id, materia_id, inicio, fim, dia_semana, divisao) VALUES
-- Segunda
("LI - Carlindo", 10, 9, 40, "18:10:00", "19:50:00", "SEGUNDA", "DIV A"),
("LI - Carlindo", 10, 9, 40, "18:10:00", "19:50:00", "SEGUNDA", "DIV B"),
("Física - Jean", 20, 9, 35, "19:50:00", "21:50:00", "SEGUNDA", "INT"),
("Geo - Marcos Lisa", 36, 9, 39, "22:40:00", "00:20:00", "SEGUNDA", "INT"),
("C.Nuvem Web I - Alícia", 3, 9, 55, "23:20:00", "00:20:00", "SEGUNDA", "INT"),
("LP - Débora", 34, 9, 33, "18:10:00", "19:00:00", "TERÇA", "INT"),
("Biologia - Sheila", 21, 9, 36, "19:00:00", "20:40:00", "TERÇA", "INT"),
("EF - Harry", 1, 9, 42, "21:00:00", "22:40:00", "TERÇA", "INT"),
("Mat - Sullivan", 30, 9, 34, "18:10:00", "19:00:00", "QUARTA", "INT"),
("Qui - Flávia", 29, 9, 37, "19:00:00", "20:40:00", "QUARTA", "INT"),
("Mat - Sullivan", 30, 9, 34, "21:00:00", "22:40:00", "QUARTA", "INT"),
("D.D. Movies I - Daniel", 16, 9, 56, "18:10:00", "19:00:00", "QUINTA", "DIV A"),
("D.D. Movies I - ?", NULL, 9, 56, "18:10:00", "19:00:00", "QUINTA", "DIV B"),
("BD - Lucas", 27, 9, 57, "19:00:00", "20:40:00", "QUINTA", "DIV A"),
("BD - Daniel", 16, 9, 57, "19:00:00", "20:40:00", "QUINTA", "DIV B"),
("LP - Débora", 34, 9, 33, "21:00:00", "22:40:00", "QUINTA", "INT"),
("História - Diego - EAD", 13, 9, 38, "22:40:00", "00:20:00", "QUINTA", "INT"),
("D.D. Movies I - Daniel", 16, 9, 56, "18:10:00", "19:00:00", "SEXTA", "DIV A"),
("D.D. Movies I - ?", NULL, 9, 56, "18:10:00", "19:00:00", "SEXTA", "DIV B"),
("I. Web II - Daniel", 16, 9, 44, "19:00:00", "20:40:00", "SEXTA", "DIV A"),
("I. Web II - ?", NULL, 9, 44, "19:00:00", "20:40:00", "SEXTA", "DIV B"),
("S. Web I - Daniel", 16, 9, 44, "21:00:00", "22:40:00", "SEXTA", "DIV A"),
("S. Web I -", NULL, 9, 44, "21:00:00", "22:40:00", "SEXTA", "DIV B");

INSERT INTO Dispositivo (nome, modelo, endereco, porta, usuario, senha, numero_serial)
VALUES ("Catraca 01", "IDBlock", "192.168.0.126", "80", "admin", "admin", "0K0410/0011BC");

INSERT INTO Dispositivo (nome, modelo, endereco, porta, usuario, senha, numero_serial)
VALUES ("Catraca 02", "IDBlock", "192.168.0.127", "82", "admin", "admin", "0K0410/00177E");