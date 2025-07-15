-- ✅ Válido
INSERT INTO UnidadeEscolar (login, senha, cnpj, nome, numero, endereco, logo) VALUES
('teste1', 'senha1', '12345678901234', 'Escola 1', '001', 'Endereço 1', 'logo1.png');

-- ❌ Inválido (CNPJ com menos de 14 dígitos)
INSERT INTO UnidadeEscolar (login, senha, cnpj, nome, numero, endereco, logo) VALUES
('teste2', 'senha2', '12345', 'Escola 2', '002', 'Endereço 2', 'logo2.png');

-- ❌ Inválido (CNPJ contém letra)
INSERT INTO UnidadeEscolar (login, senha, cnpj, nome, numero, endereco, logo) VALUES
('teste3', 'senha3', '12345', 'Escola 3', '003', 'Endereço 3', 'logo3.png');


-- ✅ Válido
INSERT INTO Empresa (nome, cnpj) VALUES ('Empresa 1', '12345678901234');

-- ❌ Inválido (CNPJ com menos de 14 dígitos)
INSERT INTO Empresa (nome, cnpj) VALUES ('Empresa 2', '123456789');

-- ❌ Inválido (CNPJ contém letra)
INSERT INTO Empresa (nome, cnpj) VALUES ('Empresa 3', '12345678901A34');


-- ✅ Válido
INSERT INTO Pessoa (nome, rg, cpf, telefone, email, unidade_id) VALUES
('Pessoa Válida', '1234567', '12345678901', '11912345678', 'pessoa@email.com', 1);

-- ❌ Inválido (CPF com menos de 11 dígitos)
INSERT INTO Pessoa (nome, rg, cpf, telefone, email, unidade_id) VALUES
('CPF Inválido', '1234567', '123456789', '11912345678', 'email2@email.com', 1);

-- ❌ Inválido (RG com 8 dígitos → inválido pelo regex, só aceita 7 ou 9)
INSERT INTO Pessoa (nome, rg, cpf, telefone, email, unidade_id) VALUES
('RG Inválido', '12345678', '12345678901', '11912345678', 'email3@email.com', 1);

-- ❌ Inválido (Telefone com 9 dígitos → só aceita 10 ou 11)
INSERT INTO Pessoa (nome, rg, cpf, telefone, email, unidade_id) VALUES
('Telefone Inválido', '1234567', '12345678901', '123456789', 'email4@email.com', 1);



-- ✅ Válido
INSERT INTO Responsavel (nome, rg, cpf, telefone, email) VALUES
('Responsável Válido', '123456789', '12345678901', '11987654321', 'responsavel@email.com');

-- ❌ Inválido (RG com 8 dígitos)
INSERT INTO Responsavel (nome, rg, cpf, telefone, email) VALUES
('RG Responsavel Inválido', '12345678', '12345678901', '11987654321', 'resp1@email.com');

-- ❌ Inválido (CPF com 10 dígitos)
INSERT INTO Responsavel (nome, rg, cpf, telefone, email) VALUES
('CPF Responsavel Inválido', '123456789', '1234567890', '11987654321', 'resp2@email.com');

-- ❌ Inválido (Telefone com 9 dígitos)
INSERT INTO Responsavel (nome, rg, cpf, telefone, email) VALUES
('Telefone Responsavel Inválido', '123456789', '12345678901', '123456789', 'resp3@email.com');


-- ✅ Válido
INSERT INTO Curso (nome) VALUES ("Desenvolvimento de Sistemas");
INSERT INTO Turma (nome, turno, curso_id, unidade_id) VALUES ("1ºB", "MATUTINO", 1, 1);
INSERT INTO Aluno (id, rm, turma_id, responsavel_id) VALUES (1, '20232930077', 1, 1);

-- ❌ Inválido (RM com 10 dígitos, deveria ter 11)
INSERT INTO Aluno (id, rm, turma_id, responsavel_id) VALUES (2, '2023293007', 1, 1);
