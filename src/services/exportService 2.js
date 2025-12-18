const XLSX = require('xlsx');
const db = require('../config/database');
const path = require('path');
const fs = require('fs');

async function exportarDados(outputPath) {
  const workbook = XLSX.utils.book_new();

  // Escola
  const [escolas] = await db.query(`
    SELECT nome AS 'Nome', numero_unidade AS 'Número Unidade', cnpj AS 'CNPJ',
           logradouro AS 'Logradouro', numero AS 'Número', complemento AS 'Complemento',
           bairro AS 'Bairro', cidade AS 'Cidade', estado AS 'Estado', cep AS 'Cep',
           telefone_contato AS 'Telefone Contato'
    FROM UnidadeEscolar
  `);
  const wsEscola = XLSX.utils.json_to_sheet(escolas);
  XLSX.utils.book_append_sheet(workbook, wsEscola, 'Escola');

  // Cursos
  const [cursos] = await db.query(`
    SELECT nome AS 'Nome', duracao AS 'Duração (Horas)'
    FROM Curso
  `);
  const wsCursos = XLSX.utils.json_to_sheet(cursos);
  XLSX.utils.book_append_sheet(workbook, wsCursos, 'Cursos');

  // Turmas
  const [turmas] = await db.query(`
    SELECT nome AS 'Nome', turno AS 'Turno'
    FROM Turma
  `);
  const wsTurmas = XLSX.utils.json_to_sheet(turmas);
  XLSX.utils.book_append_sheet(workbook, wsTurmas, 'Turmas');

  // Catracas
  const [catracas] = await db.query(`
    SELECT nome AS 'Nome', modelo AS 'Modelo', endereco AS 'Endereço', porta AS 'Porta',
           usuario AS 'Usuário', senha AS 'Senha', numero_serial AS 'Número Serial'
    FROM Dispositivo
  `);
  const wsCatracas = XLSX.utils.json_to_sheet(catracas);
  XLSX.utils.book_append_sheet(workbook, wsCatracas, 'Catracas');

  // ALUNO
  const [alunos] = await db.query(`
    SELECT p.nome AS 'Nome', '' AS 'Órgão Emissor RG', p.rg AS 'RG', p.cpf AS 'CPF',
           p.telefone AS 'Telefone', p.email AS 'Email',
           DATE_FORMAT(p.data_nascimento, '%Y-%m-%d') AS 'Data Nascimento',
           p.cartao_rfid AS 'Número do Cartão', p.qr_code AS 'Número do QRCode',
           a.ra AS 'RA', a.rm AS 'RM', t.nome AS 'Turma', a.divisao AS 'Divisão', a.status AS 'Status'
    FROM Pessoa p
    INNER JOIN Aluno a ON p.id = a.id
    LEFT JOIN Turma t ON a.turma_id = t.id
    WHERE p.tipo = 'ALUNO'
  `);
  const wsAluno = XLSX.utils.json_to_sheet(alunos);
  XLSX.utils.book_append_sheet(workbook, wsAluno, 'ALUNO');

  // RESPONSÁVEL
  const [responsaveis] = await db.query(`
    SELECT p.nome AS 'Nome', '' AS 'Órgão Emisor RG', p.rg AS 'RG', p.cpf AS 'CPF',
           p.telefone AS 'Telefone', p.email AS 'Email',
           DATE_FORMAT(p.data_nascimento, '%Y-%m-%d') AS 'Data Nascimento',
           '' AS 'Parentesco',
           pa.nome AS 'Nome do Aluno'
    FROM Pessoa p
    INNER JOIN Responsavel r ON p.id = r.id
    LEFT JOIN Pessoa pa ON r.aluno_id = pa.id
    WHERE p.tipo = 'RESPONSAVEL'
  `);
  const wsResponsavel = XLSX.utils.json_to_sheet(responsaveis);
  XLSX.utils.book_append_sheet(workbook, wsResponsavel, 'RESPONSÁVEL');

  // PROFESSOR
  const [professores] = await db.query(`
    SELECT p.nome AS 'Nome', '' AS 'Órgão Emissor RG', p.rg AS 'RG', p.cpf AS 'CPF',
           p.telefone AS 'Telefone', p.email AS 'Email',
           DATE_FORMAT(p.data_nascimento, '%Y-%m-%d') AS 'Data Nascimento',
           p.cartao_rfid AS 'Número do Cartão',
           IF(p.tipo = 'PROFADM', 'True', '') AS 'Administrador',
           f.matricula AS 'Matrícula (Nº)',
           DATE_FORMAT(f.data_admissao, '%Y-%m-%d') AS 'Data Admissão',
           DATE_FORMAT(f.data_saida, '%Y-%m-%d') AS 'Data Saída',
           f.tipo_contrato AS 'Tipo Contrato',
           '' AS '', '' AS ''
    FROM Pessoa p
    INNER JOIN Funcionario f ON p.id = f.id
    INNER JOIN Professor pr ON p.id = pr.id
    WHERE p.tipo IN ('PROFESSOR', 'PROFADM')
  `);
  const wsProfessor = XLSX.utils.json_to_sheet(professores);
  XLSX.utils.book_append_sheet(workbook, wsProfessor, 'PROFESSOR');

  // ADMINISTRADOR
  const [administradores] = await db.query(`
    SELECT p.nome AS 'Nome', '' AS 'Órgão Emissor RG', p.rg AS 'RG', p.cpf AS 'CPF',
           p.telefone AS 'Telefone', p.email AS 'Email',
           DATE_FORMAT(p.data_nascimento, '%Y-%m-%d') AS 'Data Nascimento',
           p.cartao_rfid AS 'Número do Cartão',
           a.cargo AS 'Cargo',
           f.matricula AS 'Matrícula (Nº)',
           DATE_FORMAT(f.data_admissao, '%Y-%m-%d') AS 'Data Admissão',
           DATE_FORMAT(f.data_saida, '%Y-%m-%d') AS 'Data Saída',
           f.tipo_contrato AS 'Tipo Contrato'
    FROM Pessoa p
    INNER JOIN Funcionario f ON p.id = f.id
    INNER JOIN Administrador a ON p.id = a.id
    WHERE p.tipo = 'ADMINISTRADOR'
  `);
  const wsAdministrador = XLSX.utils.json_to_sheet(administradores);
  XLSX.utils.book_append_sheet(workbook, wsAdministrador, 'ADMINISTRADOR');

  // TERCEIRIZADO
  const [terceirizados] = await db.query(`
    SELECT p.nome AS 'Nome', '' AS 'Órgão Emissor RG', p.rg AS 'RG', p.cpf AS 'CPF',
           p.telefone AS 'Telefone', p.email AS 'Email',
           DATE_FORMAT(p.data_nascimento, '%Y-%m-%d') AS 'Data Nascimento',
           p.cartao_rfid AS 'Número do Cartão',
           t.funcao AS 'Função',
           f.matricula AS 'Matrícula (específica)',
           DATE_FORMAT(f.data_admissao, '%Y-%m-%d') AS 'Data Admissão',
           DATE_FORMAT(f.data_saida, '%Y-%m-%d') AS 'Data Saída',
           f.tipo_contrato AS 'Tipo Contrato'
    FROM Pessoa p
    INNER JOIN Funcionario f ON p.id = f.id
    INNER JOIN Terceirizado t ON p.id = t.id
    WHERE p.tipo = 'TERCEIRIZADO'
  `);
  const wsTerceirizado = XLSX.utils.json_to_sheet(terceirizados);
  XLSX.utils.book_append_sheet(workbook, wsTerceirizado, 'TERCEIRIZADO');

  // Ensure output directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Write file
  XLSX.writeFile(workbook, outputPath);
  
  return outputPath;
}

module.exports = { exportarDados };
