-- Inserção de Professores e Administradores
INSERT INTO Pessoa (nome, foto, rg, cpf, telefone, email, unidade_id, qr_code, cartao_rfid, senha_acesso, data_nascimento, genero, tipo)
VALUES
('Harry Antônio Leite', 'foto.jpg', '123456789', '11122233344', '11999998888', 'harry@escola.com', 1, 'uuid-harry', 'rfid1234A', 'senha123', '1980-01-01', 'MASCULINO', 'PROFESSOR'),
('Francisco Saiz', 'foto.jpg', '223456789', '11122233355', '11999998887', 'saiz@escola.com', 1, 'uuid-saiz', 'rfid1234B', 'senha123', '1981-02-01', 'MASCULINO', 'PROFESSOR'),
('Alícia Stefany', 'foto.jpg', '323456789', '11122233366', '11999998886', 'alicia@escola.com', 1, 'uuid-alicia', 'rfid1234C', 'senha123', '1982-03-01', 'FEMININO', 'PROFADM'),
('Rosana', 'foto.jpg', '423456789', '11122233377', '11999998885', 'rosana@escola.com', 1, 'uuid-rosana', 'rfid1234D', 'senha123', '1983-04-01', 'FEMININO', 'PROFESSOR'),
('Heliene dos Santos', 'foto.jpg', '523456789', '11122233388', '11999998884', 'heliene@escola.com', 1, 'uuid-heliene', 'rfid1234E', 'senha123', '1984-05-01', 'FEMININO', 'PROFESSOR'),
('Votto', 'foto.jpg', '623456789', '11122233399', '11999998883', 'votto@escola.com', 1, 'uuid-votto', 'rfid1234F', 'senha123', '1985-06-01', 'MASCULINO', 'PROFESSOR'),
('Giancelo', 'foto.jpg', '723456789', '11122233400', '11999998882', 'giancelo@escola.com', 1, 'uuid-giancoleo', 'rfid1234G', 'senha123', '1986-07-01', 'MASCULINO', 'PROFESSOR'),
('Manoel Messias Araújo', 'foto.jpg', '823456789', '11122233411', '11999998881', 'messias@escola.com', 1, 'uuid-messias', 'rfid1234H', 'senha123', '1987-08-01', 'MASCULINO', 'PROFESSOR'),
('Sâmela Wutzuke', 'foto.jpg', '923456789', '11122233422', '11999998880', 'samela@escola.com', 1, 'uuid-samela', 'rfid1234I', 'senha123', '1988-09-01', 'FEMININO', 'PROFADM'),
('Carlindo Baeta', 'foto.jpg', '133456789', '11122233433', '11999998879', 'carlindo@escola.com', 1, 'uuid-carlindo', 'rfid1234J', 'senha123', '1989-10-01', 'MASCULINO', 'PROFESSOR'),
('Josiane', 'foto.jpg', '143456789', '11122233444', '11999998878', 'josiane@escola.com', 1, 'uuid-josiane', 'rfid1234K', 'senha123', '1990-01-01', 'FEMININO', 'PROFESSOR'),
('Nathane', 'foto.jpg', '153456789', '11122233455', '11999998877', 'nathane@escola.com', 1, 'uuid-nathane', 'rfid1234L', 'senha123', '1990-02-01', 'FEMININO', 'PROFESSOR'),
('Diego', 'foto.jpg', '163456789', '11122233466', '11999998876', 'diego@escola.com', 1, 'uuid-diego', 'rfid1234M', 'senha123', '1990-03-01', 'MASCULINO', 'PROFESSOR'),
('Marcelo Afonso Zollo', 'foto.jpg', '173456789', '11122233477', '11999998875', 'zollo@escola.com', 1, 'uuid-zollo', 'rfid1234N', 'senha123', '1990-04-01', 'MASCULINO', 'PROFESSOR'),
('Patrícia', 'foto.jpg', '183456789', '11122233488', '11999998874', 'patricia@escola.com', 1, 'uuid-patricia', 'rfid1234O', 'senha123', '1990-05-01', 'FEMININO', 'PROFESSOR'),
('Daniel', 'foto.jpg', '193456789', '11122233499', '11999998873', 'daniel@escola.com', 1, 'uuid-daniel', 'rfid1234P', 'senha123', '1990-06-01', 'MASCULINO', 'PROFESSOR'),
('Cristiano SA', 'foto.jpg', '203456789', '11122233500', '11999998872', 'cristiano@escola.com', 1, 'uuid-cristiano', 'rfid1234Q', 'senha123', '1990-07-01', 'MASCULINO', 'PROFESSOR'),
('Ales Raposo', 'foto.jpg', '213456789', '11122233511', '11999998871', 'ales@escola.com', 1, 'uuid-ales', 'rfid1234R', 'senha123', '1990-08-01', 'MASCULINO', 'PROFESSOR'),
('Marcos S.', 'foto.jpg', '223456789', '11122233522', '11999998870', 'marcos.s@escola.com', 1, 'uuid-marcos-s', 'rfid1234S', 'senha123', '1990-09-01', 'MASCULINO', 'PROFESSOR'),
('Jean', 'foto.jpg', '233456789', '11122233533', '11999998869', 'jean@escola.com', 1, 'uuid-jean', 'rfid1234T', 'senha123', '1990-10-01', 'MASCULINO', 'PROFESSOR'),
('Sheila', 'foto.jpg', '253456789', '11122233555', '11999998867', 'sheila@escola.com', 1, 'uuid-sheila', 'rfid1234V', 'senha123', '1990-12-01', 'FEMININO', 'PROFESSOR'),
('Julia', 'foto.jpg', '263456789', '11122233566', '11999998866', 'julia@escola.com', 1, 'uuid-julia', 'rfid1234W', 'senha123', '1991-01-01', 'FEMININO', 'PROFESSOR'),
('Thiago', 'foto.jpg', '273456789', '11122233577', '11999998865', 'thiago@escola.com', 1, 'uuid-thiago', 'rfid1234X', 'senha123', '1991-02-01', 'MASCULINO', 'PROFESSOR'),
('Leide', 'foto.jpg', '283456789', '11122233588', '11999998864', 'leide@escola.com', 1, 'uuid-leide', 'rfid1234Y', 'senha123', '1991-03-01', 'FEMININO', 'PROFESSOR'),
('Stephany', 'foto.jpg', '293456789', '11122233599', '11999998863', 'stephany@escola.com', 1, 'uuid-stephany', 'rfid1234Z1', 'senha123', '1991-04-01', 'FEMININO', 'PROFESSOR'),
('Joelane', 'foto.jpg', '303456789', '11122233600', '11999998862', 'joelane@escola.com', 1, 'uuid-joelane', 'rfid1234Z2', 'senha123', '1991-05-01', 'FEMININO', 'PROFESSOR'),
('Lucas', 'foto.jpg', '313456789', '11122233611', '11999998861', 'lucas@escola.com', 1, 'uuid-lucas', 'rfid1234Z3', 'senha123', '1991-06-01', 'MASCULINO', 'PROFESSOR'),
('Rafael', 'foto.jpg', '323456789', '11122233622', '11999998860', 'rafael@escola.com', 1, 'uuid-rafael', 'rfid1234Z4', 'senha123', '1991-07-01', 'MASCULINO', 'PROFESSOR'),
('Flávia', 'foto.jpg', '333456789', '11122233633', '11999998859', 'flavia@escola.com', 1, 'uuid-flavia', 'rfid1234Z5', 'senha123', '1991-08-01', 'FEMININO', 'PROFESSOR'),
('Sullivan', 'foto.jpg', '343456789', '11122233644', '11999998858', 'sullivan@escola.com', 1, 'uuid-sullivan', 'rfid1234Z6', 'senha123', '1991-09-01', 'MASCULINO', 'PROFESSOR'),
('Fabiana', 'foto.jpg', '353456789', '11122233655', '11999998857', 'fabiana@escola.com', 1, 'uuid-fabiana', 'rfid1234Z7', 'senha123', '1991-10-01', 'FEMININO', 'PROFESSOR'),
('Gleyce', 'foto.jpg', '363456789', '11122233666', '11999998856', 'gleyce@escola.com', 1, 'uuid-gleyce', 'rfid1234Z8', 'senha123', '1991-11-01', 'FEMININO', 'PROFESSOR'),
('Acássio', 'foto.jpg', '363456789', '11122233666', '11999998856', 'gleyce@escola.com', 1, 'uuid-gleyce', 'rfid1234Z8', 'senha123', '1991-11-01', 'MASCULINO', 'PROFESSOR'),
('Débora', 'foto.jpg', '363456789', '11122233666', '11999998856', 'gleyce@escola.com', 1, 'uuid-gleyce', 'rfid1234Z8', 'senha123', '1991-11-01', 'FEMININO', 'PROFESSOR'),
('Joelane', 'foto.jpg', '363456789', '11122233666', '11999998856', 'gleyce@escola.com', 1, 'uuid-gleyce', 'rfid1234Z8', 'senha123', '1991-11-01', 'FEMININO', 'PROFESSOR'),
('Marcos Lisa', 'foto.jpg', '363456789', '11122233666', '11999998856', 'gleyce@escola.com', 1, 'uuid-gleyce', 'rfid1234Z8', 'senha123', '1991-11-01', 'MASCULINO', 'PROFESSOR'),
('Felipe', 'foto.jpg', '363456789', '11122233666', '11999998856', 'gleyce@escola.com', 1, 'uuid-gleyce', 'rfid1234Z8', 'senha123', '1991-11-01', 'MASCULINO', 'PROFESSOR');


INSERT INTO Professor (id, siape) VALUES
(1, 'SIAPE001'),
(2, 'SIAPE002'),
(3, 'SIAPE003'),
(4, 'SIAPE004'),
(5, 'SIAPE005'),
(6, 'SIAPE006'),
(7, 'SIAPE007'),
(8, 'SIAPE008'),
(9, 'SIAPE009'),
(10, 'SIAPE010'),
(11, 'SIAPE011'),
(12, 'SIAPE012'),
(13, 'SIAPE013'),
(14, 'SIAPE014'),
(15, 'SIAPE015'),
(16, 'SIAPE016'),
(17, 'SIAPE017'),
(18, 'SIAPE018'),
(19, 'SIAPE019'),
(20, 'SIAPE020'),
(21, 'SIAPE021'),
(22, 'SIAPE022'),
(23, 'SIAPE023'),
(24, 'SIAPE024'),
(25, 'SIAPE025'),
(26, 'SIAPE026'),
(27, 'SIAPE027'),
(28, 'SIAPE028'),
(29, 'SIAPE029'),
(30, 'SIAPE030'),
(31, 'SIAPE031'),
(32, 'SIAPE032'),
(33, 'SIAPE032'),
(34, 'SIAPE032'),
(35, 'SIAPE032'),
(36, 'SIAPE032'),
(37, 'SIAPE032');

INSERT INTO Administrador (id, cargo) VALUES
(3, 'COORDENADOR_PEDAGOGICO'),
(9, 'COORDENADOR_PEDAGOGICO');

-- Alunos 3°B
INSERT INTO Pessoa (nome, foto, rg, cpf, telefone, email, unidade_id, qr_code, cartao_rfid, senha_acesso, data_nascimento, genero, tipo)
VALUES
('Igor', 'foto.jpg', '634150467', '45328562801', '11930402308', 'igorfcfs@gmail.com', 1, 'uuid-harry', 'rfid1234A', 'senha123', '2007-08-23', 'MASCULINO', 'ALUNO');

INSERT INTO Aluno (id, rm, turma_id, responsavel_id, status) VALUES
(38, "20232930077", 6, NULL, 'ATIVO');

INSERT INTO Responsavel (nome, rg, cpf, telefone, email) VALUES
("Jorge Augusto Oliveira Silva", "286319500", "29843488857", "11972541918", "jorgeaos@gmail.com");

UPDATE Aluno SET responsavel_id = 1 WHERE responsavel_id IS NULL;