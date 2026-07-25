const XLSX = require('xlsx');
const fs = require('fs');
const peopleService = require('./peopleService');
const db = require('../config/database');
const { hashSenha } = require('../utils/criptografia');
const { registrarSyncPendente, registrarSyncPendentesEmLote } = require('./sync');
const { listarTodos: listarDispositivos } = require('./deviceService');
const logger = require('../config/logger');

function cleanValue(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function onlyNumbers(value) {
  const text = cleanValue(value);
  if (!text) return null;
  const digits = text.replace(/\D+/g, '');
  return digits.length ? digits : null;
}

function padDigits(value, size) {
  const digits = onlyNumbers(value);
  if (!digits) return null;
  if (digits.length >= size) return digits.slice(0, size);
  return digits.padStart(size, '0');
}

function validateEmail(value) {
  const email = cleanValue(value);
  if (!email) return null;
  return /^[^@]+@[^@]+\.[^@]+$/.test(email) ? email.toLowerCase() : null;
}

function excelSerialToDate(serial) {
  const excelEpoch = new Date(Date.UTC(1899, 11, 30));
  const msPerDay = 24 * 60 * 60 * 1000;
  return new Date(excelEpoch.getTime() + serial * msPerDay);
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date && !isNaN(value)) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const fromSerial = excelSerialToDate(value);
    if (!isNaN(fromSerial)) return fromSerial.toISOString().slice(0, 10);
  }

  const text = cleanValue(value);
  if (!text) return null;

  const parsed = new Date(text);
  if (!isNaN(parsed)) return parsed.toISOString().slice(0, 10);

  return null;
}

function normalizeTurno(value) {
  const text = cleanValue(value);
  if (!text) return null;
  const upper = text.toUpperCase();
  const valid = ['MATUTINO', 'VESPERTINO', 'NOTURNO', 'INTEGRAL'];
  return valid.includes(upper) ? upper : null;
}

function normalizeDivision(value) {
  const text = cleanValue(value);
  if (!text) return null;
  const upper = text.toUpperCase();
  if (['A', 'DIV A', 'DIVA'].includes(upper)) return 'DIV A';
  if (['B', 'DIV B', 'DIVB'].includes(upper)) return 'DIV B';
  if (upper === 'INT') return 'INT';
  return null;
}

async function findTurmaIdByName(name) {
  const turma = cleanValue(name);
  if (!turma) return null;
  const [rows] = await db.query('SELECT id FROM Turma WHERE nome = ? LIMIT 1', [turma]);
  return rows.length ? rows[0].id : null;
}

async function findAlunoIdByName(name) {
  const aluno = cleanValue(name);
  if (!aluno) return null;
  const [rows] = await db.query(
    'SELECT p.id FROM Pessoa p JOIN Aluno a ON p.id = a.id WHERE p.nome = ? LIMIT 1',
    [aluno]
  );
  return rows.length ? rows[0].id : null;
}

function safeRowsFromSheet(sheet) {
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { defval: '' });
}

async function upsertEscola(sheet, summary) {
  let unidadeIdPreferida = null;

  for (const row of safeRowsFromSheet(sheet)) {
    const nome = cleanValue(row.Nome);
    if (!nome) continue;

    const numero_unidade = padDigits(row['Número Unidade'], 3);
    const cnpj = onlyNumbers(row.CNPJ);
    const telefone_contato = onlyNumbers(row['Telefone Contato']);
    const cep = onlyNumbers(row.Cep || row.CEP);

    const [existing] = await db.query('SELECT id FROM UnidadeEscolar WHERE nome = ? LIMIT 1', [nome]);
    if (existing.length) {
      summary.escolas.ignorados += 1;
      unidadeIdPreferida = unidadeIdPreferida || existing[0].id;
      continue;
    }

    const insertPayload = {
      nome,
      numero_unidade,
      cnpj,
      login: null,
      senha: null,
      logradouro: cleanValue(row.Logradouro),
      numero: cleanValue(row.Número || row.Numero),
      complemento: cleanValue(row.Complemento),
      bairro: cleanValue(row.Bairro),
      cidade: cleanValue(row.Cidade),
      estado: cleanValue(row.Estado),
      cep,
      telefone_contato,
      logo: null
    };

    // Se a planilha trouxer login/senha, aceita e hasheia a senha
    if (row.Login) insertPayload.login = cleanValue(row.Login);
    if (row.Senha) insertPayload.senha = await hashSenha(String(row.Senha));

    const columns = Object.keys(insertPayload).filter((k) => insertPayload[k] !== undefined);
    const values = columns.map((k) => insertPayload[k]);

    const placeholders = columns.map(() => '?').join(', ');
    const sql = `INSERT INTO UnidadeEscolar (${columns.join(', ')}) VALUES (${placeholders})`;
    const [result] = await db.query(sql, values);

    summary.escolas.criados += 1;
    unidadeIdPreferida = unidadeIdPreferida || result.insertId;
  }

  return unidadeIdPreferida;
}

async function upsertCursos(sheet, summary) {
  const createdIds = [];

  for (const row of safeRowsFromSheet(sheet)) {
    const nome = cleanValue(row.Nome);
    if (!nome) continue;
    const duracaoRaw = cleanValue(row['Duração (Horas)']);
    const duracao = duracaoRaw && Number.isFinite(Number(duracaoRaw)) ? Number(duracaoRaw) : null;

    const [existing] = await db.query('SELECT id FROM Curso WHERE nome = ? LIMIT 1', [nome]);
    if (existing.length) {
      summary.cursos.ignorados += 1;
      createdIds.push(existing[0].id);
      continue;
    }

    const [result] = await db.query(
      'INSERT INTO Curso (nome, duracao) VALUES (?, ?)',
      [nome, duracao]
    );

    summary.cursos.criados += 1;
    createdIds.push(result.insertId);
  }

  return createdIds;
}

async function upsertTurmas(sheet, summary, unidadeIdFallback, cursoIds) {
  const firstCursoId = Array.isArray(cursoIds) && cursoIds.length === 1 ? cursoIds[0] : null;

  for (const row of safeRowsFromSheet(sheet)) {
    const nome = cleanValue(row.Nome);
    if (!nome) continue;
    const turno = normalizeTurno(row.Turno);

    const [existing] = await db.query('SELECT id FROM Turma WHERE nome = ? LIMIT 1', [nome]);
    if (existing.length) {
      summary.turmas.ignorados += 1;
      continue;
    }

    await db.query(
      'INSERT INTO Turma (nome, turno, curso_id, unidade_id) VALUES (?, ?, ?, ?)',
      [nome, turno, firstCursoId, unidadeIdFallback]
    );
    summary.turmas.criados += 1;
  }
}

async function upsertCatracas(sheet, summary) {
  for (const row of safeRowsFromSheet(sheet)) {
    const nome = cleanValue(row.Nome);
    if (!nome) continue;

    const [existing] = await db.query('SELECT id FROM Dispositivo WHERE nome = ? LIMIT 1', [nome]);
    if (existing.length) {
      summary.catracas.ignorados += 1;
      continue;
    }

    await db.query(
      'INSERT INTO Dispositivo (nome, modelo, endereco, porta, usuario, senha, area_id, numero_serial, sync_enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        nome,
        cleanValue(row.Modelo),
        cleanValue(row['Endereço'] || row.Endereco),
        cleanValue(row.Porta),
        cleanValue(row['Usuário'] || row.Usuario),
        cleanValue(row.Senha),
        null,
        cleanValue(row['Número Serial'] || row['Numero Serial']),
        0
      ]
    );

    summary.catracas.criados += 1;
  }
}

async function processAluno(sheet, summary, unidadeIdDefault, dispositivosParaSync) {
  for (const row of safeRowsFromSheet(sheet)) {
    const nome = cleanValue(row.Nome || row.nome);
    if (!nome) continue;

    const payload = {
      nome,
      rg: padDigits(row.RG || row.Rg || row.rg, 9),
      cpf: padDigits(row.CPF || row.Cpf || row.cpf, 11),
      telefone: padDigits(row['Telefone'] || row['Telefone Contato'] || row.telefone, 11),
      email: validateEmail(row.Email || row.email),
      cartao_rfid: onlyNumbers(row['Número do Cartão'] || row['Numero do Cartao']),
      data_nascimento: parseDate(row['Data Nascimento'] || row['Data Nasc'] || row.data_nascimento),
      unidade_id: unidadeIdDefault,
      tipo: 'ALUNO',
      ra: padDigits(row.RA, 14),
      rm: padDigits(row.RM, 11),
      turma_id: await findTurmaIdByName(row.Turma),
      divisao: normalizeDivision(row['Divisão'] || row.Divisao),
      status: cleanValue(row.Status) || 'EM CURSO'
    };

    try {
      const criado = await peopleService.criarPessoaCompleta(payload);
      const pessoaId = criado?.idPessoa;
      // Enfileira para sincronismo nas catracas (ALUNO vai para catraca) em lote
      if (pessoaId && Array.isArray(dispositivosParaSync) && dispositivosParaSync.length > 0) {
        await registrarSyncPendentesEmLote(pessoaId, dispositivosParaSync, 'CREATE');
      }
      summary.pessoas.sucesso += 1;
    } catch (error) {
      summary.pessoas.erros += 1;
      summary.erros.push({ aba: 'ALUNO', nome, mensagem: error.message });
    }
  }
}

async function processResponsavel(sheet, summary, unidadeIdDefault) {
  for (const row of safeRowsFromSheet(sheet)) {
    const nome = cleanValue(row.Nome || row.nome);
    if (!nome) continue;

    const payload = {
      nome,
      rg: padDigits(row.RG || row.Rg || row.rg, 9),
      cpf: padDigits(row.CPF || row.Cpf || row.cpf, 11),
      telefone: padDigits(row['Telefone'] || row['Telefone Contato'] || row.telefone, 11),
      email: validateEmail(row.Email || row.email),
      cartao_rfid: onlyNumbers(row['Número do Cartão'] || row['Numero do Cartao']),
      data_nascimento: parseDate(row['Data Nascimento'] || row['Data Nasc'] || row.data_nascimento),
      unidade_id: unidadeIdDefault,
      tipo: 'RESPONSAVEL',
      aluno_id: await findAlunoIdByName(row['Nome do Aluno'] || row.Aluno)
    };

    try {
      await peopleService.criarPessoaCompleta(payload);
      summary.pessoas.sucesso += 1;
    } catch (error) {
      summary.pessoas.erros += 1;
      summary.erros.push({ aba: 'RESPONSAVEL', nome, mensagem: error.message });
    }
  }
}

async function processProfessor(sheet, summary, unidadeIdDefault, dispositivosParaSync) {
  for (const row of safeRowsFromSheet(sheet)) {
    const nome = cleanValue(row.Nome || row.nome);
    if (!nome) continue;

    const adminFlag = cleanValue(row.Administrador);
    const isAdmin = adminFlag && adminFlag.toLowerCase() === 'true';
    const tipo = isAdmin ? 'PROFADM' : 'PROFESSOR';

    const payload = {
      nome,
      rg: padDigits(row.RG || row.Rg || row.rg, 9),
      cpf: padDigits(row.CPF || row.Cpf || row.cpf, 11),
      telefone: padDigits(row['Telefone'] || row['Telefone Contato'] || row.telefone, 11),
      email: validateEmail(row.Email || row.email),
      cartao_rfid: onlyNumbers(row['Número do Cartão'] || row['Numero do Cartao']),
      data_nascimento: parseDate(row['Data Nascimento'] || row['Data Nasc'] || row.data_nascimento),
      unidade_id: unidadeIdDefault,
      tipo,
      matricula: padDigits(row['Matrícula (Nº)'] || row['Matricula (Nº)'] || row['Matrícula'] || row.Matricula, 6),
      data_admissao: parseDate(row['Data Admissão'] || row['Data Admissao']),
      data_saida: parseDate(row['Data Saída'] || row['Data Saida']),
      tipo_contrato: cleanValue(row['Tipo Contrato'] || row['Tipo_Contrato']),
      cargo: isAdmin ? cleanValue(row.Cargo) : null
    };

    try {
      const criado = await peopleService.criarPessoaCompleta(payload);
      const pessoaId = criado?.idPessoa;
      // PROFESSOR/PROFADM vão para catraca (lote)
      if (pessoaId && Array.isArray(dispositivosParaSync) && dispositivosParaSync.length > 0) {
        await registrarSyncPendentesEmLote(pessoaId, dispositivosParaSync, 'CREATE');
      }
      summary.pessoas.sucesso += 1;
    } catch (error) {
      summary.pessoas.erros += 1;
      summary.erros.push({ aba: 'PROFESSOR', nome, mensagem: error.message });
    }
  }
}

async function processAdministrador(sheet, summary, unidadeIdDefault, dispositivosParaSync) {
  for (const row of safeRowsFromSheet(sheet)) {
    const nome = cleanValue(row.Nome || row.nome);
    if (!nome) continue;

    const payload = {
      nome,
      rg: padDigits(row.RG || row.Rg || row.rg, 9),
      cpf: padDigits(row.CPF || row.Cpf || row.cpf, 11),
      telefone: padDigits(row['Telefone'] || row['Telefone Contato'] || row.telefone, 11),
      email: validateEmail(row.Email || row.email),
      cartao_rfid: onlyNumbers(row['Número do Cartão'] || row['Numero do Cartao']),
      data_nascimento: parseDate(row['Data Nascimento'] || row['Data Nasc'] || row.data_nascimento),
      unidade_id: unidadeIdDefault,
      tipo: 'ADMINISTRADOR',
      matricula: padDigits(row['Matrícula'] || row.Matricula, 6),
      data_admissao: parseDate(row['Data Admissão'] || row['Data Admissao']),
      data_saida: parseDate(row['Data Saída'] || row['Data Saida']),
      tipo_contrato: cleanValue(row['Tipo Contrato'] || row['Tipo_Contrato']),
      cargo: cleanValue(row.Cargo)
    };

    try {
      const criado = await peopleService.criarPessoaCompleta(payload);
      const pessoaId = criado?.idPessoa;
      if (pessoaId && Array.isArray(dispositivosParaSync) && dispositivosParaSync.length > 0) {
        await registrarSyncPendentesEmLote(pessoaId, dispositivosParaSync, 'CREATE');
      }
      summary.pessoas.sucesso += 1;
    } catch (error) {
      summary.pessoas.erros += 1;
      summary.erros.push({ aba: 'ADMINISTRADOR', nome, mensagem: error.message });
    }
  }
}

async function processTerceirizado(sheet, summary, unidadeIdDefault, dispositivosParaSync) {
  for (const row of safeRowsFromSheet(sheet)) {
    const nome = cleanValue(row.Nome || row.nome);
    if (!nome) continue;

    const payload = {
      nome,
      rg: padDigits(row.RG || row.Rg || row.rg, 9),
      cpf: padDigits(row.CPF || row.Cpf || row.cpf, 11),
      telefone: padDigits(row['Telefone'] || row['Telefone Contato'] || row.telefone, 11),
      email: validateEmail(row.Email || row.email),
      cartao_rfid: onlyNumbers(row['Número do Cartão'] || row['Numero do Cartao']),
      data_nascimento: parseDate(row['Data Nascimento'] || row['Data Nasc'] || row.data_nascimento),
      unidade_id: unidadeIdDefault,
      tipo: 'TERCEIRIZADO',
      matricula: padDigits(row['Matrícula (específica)'] || row['Matrícula (Nº)'] || row.Matricula, 6),
      data_admissao: parseDate(row['Data Admissão'] || row['Data Admissao']),
      data_saida: parseDate(row['Data Saída'] || row['Data Saida']),
      tipo_contrato: cleanValue(row['Tipo Contrato'] || row['Tipo_Contrato']),
      funcao: cleanValue(row['Função'] || row.Funcao)
    };

    try {
      const criado = await peopleService.criarPessoaCompleta(payload);
      const pessoaId = criado?.idPessoa;
      // TERCEIRIZADO também acessa catraca (lote)
      if (pessoaId && Array.isArray(dispositivosParaSync) && dispositivosParaSync.length > 0) {
        await registrarSyncPendentesEmLote(pessoaId, dispositivosParaSync, 'CREATE');
      }
      summary.pessoas.sucesso += 1;
    } catch (error) {
      summary.pessoas.erros += 1;
      summary.erros.push({ aba: 'TERCEIRIZADO', nome, mensagem: error.message });
    }
  }
}

function findFirstSheet(workbook, candidates) {
  for (const name of candidates) {
    if (workbook.Sheets[name]) return workbook.Sheets[name];
  }
  return null;
}

async function importarPlanilha(filePath, unidadeIdDefault = 1) {
  const startedAt = Date.now();
  try {
    const stat = fs.statSync(filePath);
    logger.info(`Importação iniciada: ${filePath} (${stat.size} bytes)`);
  } catch (e) {
    logger.warn(`Não foi possível obter tamanho do arquivo ${filePath}: ${e.message}`);
  }

  const summary = {
    escolas: { criados: 0, ignorados: 0 },
    cursos: { criados: 0, ignorados: 0 },
    turmas: { criados: 0, ignorados: 0 },
    catracas: { criados: 0, ignorados: 0 },
    pessoas: { sucesso: 0, erros: 0 },
    erros: []
  };

  const workbook = XLSX.readFile(filePath, { cellDates: true });

  // Pré-carrega dispositivos para enfileirar sync (se houver)
  let dispositivosParaSync = [];
  try {
    dispositivosParaSync = await listarDispositivos();
  } catch (e) {
    dispositivosParaSync = [];
  }

  // Infraestrutura escolar
  const escolaSheet = workbook.Sheets.Escola;
  const unidadePreferidaDaPlanilha = escolaSheet ? await upsertEscola(escolaSheet, summary) : null;
  const unidadeParaPessoas = unidadeIdDefault || unidadePreferidaDaPlanilha || 1;

  const cursosSheet = workbook.Sheets.Cursos;
  const cursosCriados = cursosSheet ? await upsertCursos(cursosSheet, summary) : [];

  const turmasSheet = workbook.Sheets.Turmas;
  if (turmasSheet) {
    await upsertTurmas(turmasSheet, summary, unidadeParaPessoas, cursosCriados);
  }

  const catracasSheet = workbook.Sheets.Catracas;
  if (catracasSheet) {
    await upsertCatracas(catracasSheet, summary);
  }

  await processAluno(workbook.Sheets.ALUNO, summary, unidadeParaPessoas, dispositivosParaSync);

  const responsavelSheet = findFirstSheet(workbook, ['RESPONSÁVEL', 'RESPONSAVEL', 'Responsaveis', 'Responsáveis', 'RESPONSAVEIS']);
  if (responsavelSheet) {
    await processResponsavel(responsavelSheet, summary, unidadeParaPessoas);
  }

  if (workbook.Sheets.PROFESSOR) {
    await processProfessor(workbook.Sheets.PROFESSOR, summary, unidadeParaPessoas, dispositivosParaSync);
  }

  if (workbook.Sheets.ADMINISTRADOR) {
    await processAdministrador(workbook.Sheets.ADMINISTRADOR, summary, unidadeParaPessoas, dispositivosParaSync);
  }

  if (workbook.Sheets.TERCEIRIZADO) {
    await processTerceirizado(workbook.Sheets.TERCEIRIZADO, summary, unidadeParaPessoas, dispositivosParaSync);
  }

  const elapsed = Date.now() - startedAt;
  logger.info(`Importação concluída em ${elapsed} ms (pessoas sucesso: ${summary.pessoas.sucesso}, erros: ${summary.pessoas.erros})`);
  return summary;
}

module.exports = { importarPlanilha };
