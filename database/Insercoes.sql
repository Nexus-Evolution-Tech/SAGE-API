-- CURSO --
INSERT INTO Curso (nome) VALUES ("Desenvolvimento de Sistemas");

-- PESSOA --
INSERT INTO Pessoa (nome, email, telefone, tipo) VALUES ("Igor", "igor.silva816@etec.sp.gov.br", "11971322867", "ALUNO");
INSERT INTO Pessoa (nome, email, telefone, tipo) VALUES ("Marcello Zollo", "marcello.zollo@etec.sp.gov.br", "11956234782", "PROFESSOR");

-- PROFESSOR --
INSERT INTO Aluno (id, rm) VALUES (1, "20232930077");
INSERT INTO Professor (id) VALUES (2); -- preciso criar uma tabela professor para referenciar em pessoa - essa logica sera garantida pela api

-- ESCOLA --
INSERT INTO UnidadeEscolar (login, senha, nome_unidade) VALUES ("etc", "293", "ETEC Taboão da Serra");

-- TURMA --
INSERT INTO Turma (nome, turno, curso_id) VALUES ("1ºB", "DIURNO", 1);
UPDATE Turma SET unidade_id = 1 WHERE id = 1;

-- CATRACAS --
INSERT INTO Dispositivo (nome, modelo, endereco, porta, usuario, senha)
VALUES ("Catraca 01", "IDBlock", "192.168.0.126", "81", "admin", "admin");

INSERT INTO Dispositivo (nome, modelo, endereco, porta, usuario, senha)
VALUES ("Catraca 02", "IDBlock", "192.168.0.127", "82", "admin", "admin");

-- OUTROS --

DELETE FROM Dispositivo WHERE id = 3;
SET SQL_SAFE_UPDATES = 0;
DELETE FROM Dispositivo; -- Your original DELETE statement
SET SQL_SAFE_UPDATES = 1; -- **Important:** Re-enable safe mode!

UPDATE Dispositivos
SET nome = 'Catraca 01'
WHERE id = 1;