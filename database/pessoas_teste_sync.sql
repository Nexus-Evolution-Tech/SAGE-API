-- Inserção de Professores e Administradores
INSERT INTO Pessoa (nome, foto, rg, cpf, telefone, email, qr_code, cartao_rfid, senha_acesso, data_nascimento, tipo)
VALUES
('Harry Antônio Leite', 'foto.jpg', '123456789', '11122233344', '11999998888', 'harry@escola.com', '75689745', '45268793', 'senha123', '1980-01-01', 'PROFESSOR');

INSERT INTO Funcionario (id, matricula, data_admissao, data_saida, tipo_contrato) VALUES
(1, '10001', '2015-02-10', '2018-02-10', 'DETERMINADO');

INSERT INTO Professor (id) VALUES
(1);

-- Alunos 3°B
INSERT INTO Pessoa (nome, foto, rg, cpf, telefone, email, qr_code, cartao_rfid, senha_acesso, data_nascimento, tipo)
VALUES
('Igor', 'foto.jpg', '634150467', '45328562801', '11930402308', 'igorfcfs@gmail.com', '86597432', '78932264', 'senha123', '2007-08-23', 'ALUNO');
INSERT INTO Aluno (id, ra, rm, divisao, status) VALUES
(2, "0001115926676", "20232930077", 'DIV A', 'EM CURSO');

-- Responsáveis
INSERT INTO Pessoa (nome, rg, cpf, telefone, email, data_nascimento, tipo) VALUES
('Jorge Augusto Oliveira Silva', '286319500', '29843488857', '11972541918', 'jorgeaos@gmail.com', '1990-11-07', 'RESPONSAVEL');
INSERT INTO Responsavel (id, aluno_id) VALUES (3, 2);
