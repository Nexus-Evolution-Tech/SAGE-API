/*UNIDADE - Não funciona porque não criptografa a senha com padrão bcrypt*/
INSERT INTO sage.unidadeescolar (nome, numero_unidade, cnpj, login, senha, logradouro, numero, complemento, bairro, cidade, estado, cep, telefone_contato, logo) VALUES 
("ETEC Taboão da Serra", 293, "62823257029344", "etec", "etec123", "Praça Miguel Ortega", "135", "Prédio Principal", "Parque Assunção", "Taboão da Serra", "SP", "06754160", "1147011856", "etec.png");

/*CURSOS*/
INSERT INTO sage.curso (nome, duracao) VALUES
("MTec - Desenvolvimento de Sistemas", 3600),
("MTec - Informática para Internet", 3600),
("MTec - Informática", 3600),
("Técnico em Informática", 1500),
("Técnico em Desenvolvimento de Sistemas", 1500);

/*TURMAS*/
INSERT INTO sage.turma (nome, turno, curso_id, unidade_id) VALUES
("1º A - MTec-PI Desenvolvimento de Sistemas", "INTEGRAL", 1, 1),
("1º B - MTec-PI Desenvolvimento de Sistemas", "INTEGRAL", 1, 1),
("2º A - MTec-PI Desenvolvimento de Sistemas", "INTEGRAL", 1, 1),
("2º B - MTec-PI Desenvolvimento de Sistemas", "INTEGRAL", 1, 1),
("3º A - MTec-PI Desenvolvimento de Sistemas", "INTEGRAL", 1, 1),
("3º B - MTec-PI Desenvolvimento de Sistemas", "INTEGRAL", 1, 1),
("1º A - MTec-N Informática para Internet", "NOTURNO", 2, 1),
("2º A - MTec-N Informática para Internet", "NOTURNO", 2, 1),
("1º A - MTec-N Informática", "NOTURNO", 3, 1),
("1º A - TI-N - Informática", "NOTURNO", 4, 1),
("3º A - TDS-N Desenvolvimento de Sistemas", "NOTURNO", 5, 1);

INSERT INTO sage.Dispositivo (nome, modelo, endereco, porta, usuario, senha, numero_serial) VALUES
("Catraca 01", "IDBlock", "192.168.0.126", "80", "admin", "admin", "0K0410/0011BC"),
("Catraca 02", "IDBlock", "192.168.0.127", "82", "admin", "admin", "0K0410/00177E");

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

-- SOURCE D:\mywork\javascript\SGC-API\database\pessoas_etec.sql;

ALTER TABLE sage.aula 
MODIFY COLUMN dia_semana ENUM('DOMINGO', 'SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÁBADO');

/*AULAS -> Usar o arquivo 'Insercao_aulas_atualizado'*/
