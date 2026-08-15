const db = require('../config/database');
const projecoes = require('../config/projecoes');
const { filtrarDadosDeEscrita } = require('./generic-db-utils');

const CAMPOS_FILHOS_PESSOA = Object.freeze(['ra', 'rm', 'turma_id', 'divisao', 'status', 'matricula', 'data_admissao', 'data_saida', 'tipo_contrato', 'cargo', 'empresa_id', 'funcao', 'aluno_id']);
const camposFilhos = new Set(CAMPOS_FILHOS_PESSOA);

function filtrarDadosPessoa(dados = {}) {
  const base = {}, filhos = {}, desconhecidas = [];
  const declaradas = new Set([...projecoes.Pessoa.leitura, ...projecoes.Pessoa.escrita, ...projecoes.Pessoa.segredo]);
  for (const [chave, valor] of Object.entries(dados)) {
    if (declaradas.has(chave)) base[chave] = valor;
    else if (camposFilhos.has(chave)) filhos[chave] = valor;
    else if (valor !== undefined) desconhecidas.push(chave);
  }
  if (desconhecidas.length) {
    const erro = new Error(`ESCRITA_CHAVE_NAO_DECLARADA: ${desconhecidas.join(', ')}`);
    erro.code = 'ESCRITA_CHAVE_NAO_DECLARADA'; erro.chaves = desconhecidas; throw erro;
  }
  let filtrado = { dados: {}, ignorados: [] };
  if (Object.keys(base).length) {
    try { filtrado = filtrarDadosDeEscrita('Pessoa', base); }
    catch (erro) {
      if (erro.code !== 'ESCRITA_NENHUM_CAMPO_APLICAVEL' || !Object.keys(filhos).length) throw erro;
      filtrado = { dados: {}, ignorados: erro.ignorados || [] };
    }
  }
  if (!Object.keys(filtrado.dados).length && !Object.keys(filhos).length) {
    const erro = new Error('ESCRITA_NENHUM_CAMPO_APLICAVEL: nenhum campo aplicável');
    erro.code = 'ESCRITA_NENHUM_CAMPO_APLICAVEL'; erro.ignorados = filtrado.ignorados; throw erro;
  }
  return { dados: { ...filtrado.dados, ...filhos }, ignorados: filtrado.ignorados };
}

// Buscar dados base da Pessoa
async function buscarPessoaBase(id) {
  const [result] = await db.query('SELECT * FROM Pessoa WHERE id = ?', [id]);
  return result.length ? result[0] : null;
}

// Buscar Aluno
async function buscarAluno(id) {
  const [result] = await db.query('SELECT * FROM Aluno WHERE id = ?', [id]);
  return result.length ? result[0] : {};
}

// Buscar Responsavel
async function buscarResponsavel(id) {
  const [result] = await db.query('SELECT * FROM Responsavel WHERE id = ?', [id]);
  return result.length ? result[0] : {};
}

// Buscar Funcionario
async function buscarFuncionario(id) {
  const [result] = await db.query('SELECT * FROM Funcionario WHERE id = ?', [id]);
  const funcData = result.length ? result[0] : {};
  return formatarDatasFuncionario(funcData);
}

function formatarDatasFuncionario(funcData) {
  const formatarData = (data) => {
    if (!data) return null;
    const d = new Date(data);
    return d.toISOString().split('T')[0]; // Retorna 'YYYY-MM-DD'
  };

  return {
    ...funcData,
    data_admissao: formatarData(funcData.data_admissao),
    data_saida: formatarData(funcData.data_saida)
  };
}

// Buscar Professor
async function buscarProfessor(id) {
  const funcData = await buscarFuncionario(id);
  const [result] = await db.query('SELECT * FROM Professor WHERE id = ?', [id]);
  return { ...funcData, ...(result.length ? result[0] : {}) };
}

// Buscar Administrador
async function buscarAdministrador(id) {
  const funcData = await buscarFuncionario(id);
  const [result] = await db.query('SELECT * FROM Administrador WHERE id = ?', [id]);
  return { ...funcData, ...(result.length ? result[0] : {}) };
}

// Buscar Terceirizado
async function buscarTerceirizado(id) {
  const funcData = await buscarFuncionario(id);
  const [result] = await db.query('SELECT * FROM Terceirizado WHERE id = ?', [id]);
  return { ...funcData, ...(result.length ? result[0] : {}) };
}

// Buscar ProfAdm (Professor + Administrador)
async function buscarProfAdm(id) {
  const funcData = await buscarFuncionario(id);
  const professor = await buscarProfessor(id);
  const administrador = await buscarAdministrador(id);
  return { ...funcData, ...professor, ...administrador };
}

// Criar Pessoa base
async function criarPessoaBase(dados) {
  const { dados: campos } = filtrarDadosDeEscrita('Pessoa', dados);
  const nomes = Object.keys(campos);
  const query = `INSERT INTO Pessoa (${nomes.join(', ')}) VALUES (${nomes.map(() => '?').join(', ')})`;
  const values = nomes.map((campo) => campos[campo]);
  const [result] = await db.query(query, values);
  return { id: result.insertId };
}

// Criar Aluno
async function criarAluno(pessoaId, dados) {
  const query = `
    INSERT INTO Aluno (id, ra, rm, turma_id, divisao, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `;
  const values = [
    pessoaId,
    dados.ra,
    dados.rm,
    dados.turma_id,
    dados.divisao,
    dados.status || 'EM CURSO'
  ];
  await db.query(query, values);
}

// Criar Responsavel
async function criarResponsavel(pessoaId, dados) {
  const query = `
    INSERT INTO Responsavel (id, aluno_id)
    VALUES (?, ?)
  `;
  await db.query(query, [pessoaId, dados?.aluno_id || null]);
}

// Criar Funcionario base
async function criarFuncionarioBase(pessoaId, dados) {
  const query = `
    INSERT INTO Funcionario (id, matricula, data_admissao, data_saida, tipo_contrato)
    VALUES (?, ?, ?, ?, ?)
  `;
  const values = [
    pessoaId,
    dados.matricula,
    dados.data_admissao,
    dados.data_saida,
    dados.tipo_contrato
  ];
  const [result] = await db.query(query, values);
  return { id: result.insertId };
}

// Criar Professor
async function criarProfessor(pessoaId, dados) {
  // await criarFuncionarioBase(pessoaId, dados);
  const query = `
    INSERT INTO Professor (id)
    VALUES (?)
  `;
  await db.query(query, [pessoaId]);
}

// Criar Administrador
async function criarAdministrador(pessoaId, dados) {
  // await criarFuncionarioBase(pessoaId, dados);
  const query = `
    INSERT INTO Administrador (id, cargo)
    VALUES (?, ?)
  `;
  await db.query(query, [pessoaId, dados.cargo]);
}

// Criar Terceirizado
async function criarTerceirizado(pessoaId, dados) {
  // await criarFuncionarioBase(pessoaId, dados);
  const query = `
    INSERT INTO Terceirizado (id, empresa_id, funcao)
    VALUES (?, ?, ?)
  `;
  const values = [
    pessoaId,
    dados.empresa_id,
    dados.funcao
  ];
  await db.query(query, values);
}

// Criar Professor Administrador
async function criarProfAdm(pessoaId, dados) {
  // Cria apenas uma vez na tabela Funcionario
  // await criarFuncionarioBase(pessoaId, dados);

  // Depois insere nas tabelas específicas
  const queryProfessor = `INSERT INTO Professor (id) VALUES (?)`;
  await db.query(queryProfessor, [pessoaId]);

  const queryAdministrador = `INSERT INTO Administrador (id, cargo) VALUES (?, ?)`;
  await db.query(queryAdministrador, [pessoaId, dados.cargo]);
}

// Buscar todas as pessoas
async function buscarTodasPessoas(limit, offset) {
  const [pessoas] = await db.query('SELECT * FROM Pessoa WHERE visivel = 1 LIMIT ? OFFSET ?', [limit, offset]);

  const resultado = [];

  for (const pessoa of pessoas) {
    let dadosEspecificos = {};

    switch (pessoa.tipo) {
      case 'ALUNO':
        dadosEspecificos = await buscarAluno(pessoa.id);
        break;
      case 'RESPONSAVEL':
        dadosEspecificos = await buscarResponsavel(pessoa.id);
        break;
      case 'PROFESSOR':
        dadosEspecificos = await buscarProfessor(pessoa.id);
        break;
      case 'ADMINISTRADOR':
        dadosEspecificos = await buscarAdministrador(pessoa.id);
        break;
      case 'PROFADM':
        dadosEspecificos = await buscarProfAdm(pessoa.id);
        break;
      case 'TERCEIRIZADO':
        dadosEspecificos = await buscarTerceirizado(pessoa.id);
        break;
      default:
        // Tipo inválido ou desconhecido, pode logar ou apenas ignorar os extras
        break;
    }

    resultado.push({
      ...pessoa,
      ...dadosEspecificos
    });
  }

  return resultado;
}

async function buscarPorId(id) {
  // Consulta protegida contra SQL Injection
  const [rows] = await db.query(`SELECT * FROM Pessoa WHERE id = ? AND visivel = 1`, [id]);

  const pessoa = rows[0]; // Pega o primeiro (e único) resultado
  if (!pessoa) {
    throw new Error(`Pessoa com id ${id} não encontrada.`);
  }

  let dadosEspecificos = {};

  switch (pessoa.tipo) {
    case 'ALUNO':
      dadosEspecificos = await buscarAluno(pessoa.id);
      break;
    case 'RESPONSAVEL':
      dadosEspecificos = await buscarResponsavel(pessoa.id);
      break;
    case 'PROFESSOR':
      dadosEspecificos = await buscarProfessor(pessoa.id);
      break;
    case 'ADMINISTRADOR':
      dadosEspecificos = await buscarAdministrador(pessoa.id);
      break;
    case 'PROFADM':
      dadosEspecificos = await buscarProfAdm(pessoa.id);
      break;
    case 'TERCEIRIZADO':
      dadosEspecificos = await buscarTerceirizado(pessoa.id);
      break;
    default:
      // Tipo desconhecido, pode logar um aviso se quiser
      break;
  }

  return {
    ...pessoa,
    ...dadosEspecificos
  };
}

// Buscar o tipo da pessoa
async function buscarTipoPessoa(id, connection = db) {
  const [result] = await connection.query('SELECT tipo FROM Pessoa WHERE id = ?', [id]);
  if (result.length === 0) throw new Error('Pessoa não encontrada');
  return result[0].tipo;
}

// Atualizar a tabela
async function atualizarTabela(tabela, campos, id, connection = db) {
  const setClauses = [];
  const values = [];

  for (const campo in campos) {
    setClauses.push(`${campo} = ?`);
    values.push(campos[campo]);
  }

  if (setClauses.length === 0) return;

  values.push(id);
  const query = `UPDATE ${tabela} SET ${setClauses.join(', ')} WHERE id = ?`;
  await connection.query(query, values);
}

// Atualizar apenas se houver campos válidos
async function atualizarSeExistir(tabela, camposPermitidos, updates, id, connection = db) {
  const camposFiltrados = {};

  for (const campo of camposPermitidos) {
    if (updates[campo] !== undefined) {
      camposFiltrados[campo] = updates[campo];
    }
  }

  if (Object.keys(camposFiltrados).length > 0) {
    await atualizarTabela(tabela, camposFiltrados, id, connection);
  }
}

//  Função principal do PATCH
async function atualizarPessoaCompleta(id, updates, connection = db) {
  // Campos específicos por tabela
  const pessoaFields = projecoes.Pessoa.escrita;
  const funcionarioFields = ['matricula', 'data_admissao', 'data_saida', 'tipo_contrato'];
  const alunoFields = ['ra', 'rm', 'turma_id', 'divisao', 'status'];
  const administradorFields = ['cargo'];
  const terceirizadoFields = ['empresa_id', 'funcao'];

  // A lista de escrita da Pessoa é a fonte única desta atualização.
  const filtrado = filtrarDadosPessoa(updates);
  const dadosAtualizacao = filtrado.dados;

  // Buscar o tipo da pessoa para saber quais tabelas atualizar
  const tipo = await buscarTipoPessoa(id, connection);

  // Atualizar a tabela base (Pessoa) sempre
  await atualizarSeExistir('Pessoa', pessoaFields, dadosAtualizacao, id, connection);

  // Atualizar conforme tipo
  switch (tipo) {
    case 'ALUNO':
      await atualizarSeExistir('Aluno', alunoFields, dadosAtualizacao, id, connection);
      break;

    case 'RESPONSAVEL':
      // Nenhum campo específico em Responsavel, mas mantém por clareza
      break;

    case 'PROFESSOR':
      await atualizarSeExistir('Funcionario', funcionarioFields, dadosAtualizacao, id, connection);
      // Nenhum campo específico em Professor por enquanto
      break;

    case 'ADMINISTRADOR':
      await atualizarSeExistir('Funcionario', funcionarioFields, dadosAtualizacao, id, connection);
      await atualizarSeExistir('Administrador', administradorFields, dadosAtualizacao, id, connection);
      break;

    case 'PROFADM':
      await atualizarSeExistir('Funcionario', funcionarioFields, dadosAtualizacao, id, connection);
      await atualizarSeExistir('Professor', [], dadosAtualizacao, id, connection); // Ainda que sem campos, mantém por clareza estrutural
      await atualizarSeExistir('Administrador', administradorFields, dadosAtualizacao, id, connection);
      break;

    case 'TERCEIRIZADO':
      await atualizarSeExistir('Funcionario', funcionarioFields, dadosAtualizacao, id, connection);
      await atualizarSeExistir('Terceirizado', terceirizadoFields, dadosAtualizacao, id, connection);
      break;

    default:
      throw new Error(`Tipo '${tipo}' não reconhecido para atualização.`);
  }
  return { ignorados: filtrado.ignorados };
}

// Remover pessoa (incluindo nas tabelas filhas)
async function removerPessoa(id, connection = db) {
  // await db.query('DELETE FROM Aluno WHERE id = ?', [id]);
  // await db.query('DELETE FROM Professor WHERE id = ?', [id]);
  // await db.query('DELETE FROM Administrador WHERE id = ?', [id]);
  // await db.query('DELETE FROM Terceirizado WHERE id = ?', [id]);
  // await db.query('DELETE FROM Pessoa WHERE id = ?', [id]);
  await connection.query('UPDATE Pessoa SET visivel = 0 WHERE id = ?', [id]);
}

module.exports = {
  buscarPessoaBase,
  buscarAluno,
  buscarResponsavel,
  buscarProfessor,
  buscarAdministrador,
  buscarProfAdm,
  buscarTerceirizado,
  criarPessoaBase,
  criarFuncionarioBase,
  criarAluno,
  criarResponsavel,
  criarProfessor,
  criarAdministrador,
  criarTerceirizado,
  criarProfAdm,
  buscarTodasPessoas,
  buscarPorId,
  atualizarPessoaCompleta,
  removerPessoa,
  filtrarDadosPessoa,
  CAMPOS_FILHOS_PESSOA
};
