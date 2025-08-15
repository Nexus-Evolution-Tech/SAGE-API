const db = require('../config/database');

// 🔎 Buscar dados base da Pessoa
async function buscarPessoaBase(id) {
  const [result] = await db.query('SELECT * FROM Pessoa WHERE id = ?', [id]);
  return result.length ? result[0] : null;
}

// 🔎 Buscar Aluno
async function buscarAluno(id) {
  const [result] = await db.query('SELECT * FROM Aluno WHERE id = ?', [id]);
  return result.length ? result[0] : {};
}

// 🔎 Buscar Responsavel
async function buscarResponsavel(id) {
  const [result] = await db.query('SELECT * FROM Responsavel WHERE id = ?', [id]);
  return result.length ? result[0] : {};
}

// 🔎 Buscar Funcionario
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

// 🔎 Buscar Professor
async function buscarProfessor(id) {
  const funcData = await buscarFuncionario(id);
  const [result] = await db.query('SELECT * FROM Professor WHERE id = ?', [id]);
  return { ...funcData, ...(result.length ? result[0] : {}) };
}

// 🔎 Buscar Administrador
async function buscarAdministrador(id) {
  const funcData = await buscarFuncionario(id);
  const [result] = await db.query('SELECT * FROM Administrador WHERE id = ?', [id]);
  return { ...funcData, ...(result.length ? result[0] : {}) };
}

// 🔎 Buscar Terceirizado
async function buscarTerceirizado(id) {
  const funcData = await buscarFuncionario(id);
  const [result] = await db.query('SELECT * FROM Terceirizado WHERE id = ?', [id]);
  return { ...funcData, ...(result.length ? result[0] : {}) };
}

// 🔎 Buscar ProfAdm (Professor + Administrador)
async function buscarProfAdm(id) {
  const funcData = await buscarFuncionario(id);
  const professor = await buscarProfessor(id);
  const administrador = await buscarAdministrador(id);
  return { ...funcData, ...professor, ...administrador };
}

// 📌 Criar Pessoa base
async function criarPessoaBase(dados) {
  const query = `
    INSERT INTO Pessoa (nome, foto, rg, cpf, telefone, email, unidade_id, qr_code, cartao_rfid, senha_acesso, data_nascimento, tipo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const values = [
    dados.nome,
    dados.foto,
    dados.rg,
    dados.cpf,
    dados.telefone,
    dados.email,
    dados.unidade_id,
    dados.qr_code,
    dados.cartao_rfid,
    dados.senha_acesso,
    dados.data_nascimento,
    dados.tipo
  ];
  const [result] = await db.query(query, values);
  return { id: result.insertId };
}

// 📌 Criar Aluno
async function criarAluno(pessoaId, dados) {
  const query = `
    INSERT INTO Aluno (id, ra, rm, turma_id, divisao, status)
    VALUES (?, ?, ?, ?, ?, 'EM CURSO')
  `;
  const values = [
    pessoaId,
    dados.ra,
    dados.rm,
    dados.turma_id,
    dados.divisao
  ];
  await db.query(query, values);
}

// 📌 Criar Responsavel
async function criarResponsavel(pessoaId) {
  const query = `
    INSERT INTO Responsavel (id)
    VALUES (?)
  `;
  await db.query(query, [pessoaId]);
}

// 📌 Criar Funcionario base
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

// 📌 Criar Professor
async function criarProfessor(pessoaId, dados) {
  criarFuncionarioBase(pessoaId, dados);
  const query = `
    INSERT INTO Professor (id)
    VALUES (?)
  `;
  await db.query(query, [pessoaId]);
}

// 📌 Criar Administrador
async function criarAdministrador(pessoaId, dados) {
  criarFuncionarioBase(pessoaId, dados);
  const query = `
    INSERT INTO Administrador (id, cargo)
    VALUES (?, ?)
  `;
  await db.query(query, [pessoaId, dados.cargo]);
}

// 📌 Criar Terceirizado
async function criarTerceirizado(pessoaId, dados) {
  criarFuncionarioBase(pessoaId, dados);
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

// 📌 Criar Professor Administrador
async function criarProfAdm(pessoaId, dados) {
  // Cria apenas uma vez na tabela Funcionario
  await criarFuncionarioBase(pessoaId, dados);

  // Depois insere nas tabelas específicas
  const queryProfessor = `INSERT INTO Professor (id) VALUES (?)`;
  await db.query(queryProfessor, [pessoaId]);

  const queryAdministrador = `INSERT INTO Administrador (id, cargo) VALUES (?, ?)`;
  await db.query(queryAdministrador, [pessoaId, dados.cargo]);
}

// 📌 Buscar todas as pessoas
async function buscarTodasPessoas() {
  const [pessoas] = await db.query('SELECT * FROM Pessoa');

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
  const [rows] = await db.query(`SELECT * FROM Pessoa WHERE id = ?`, [id]);

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


// 🔎 Buscar o tipo da pessoa
async function buscarTipoPessoa(id) {
  const [result] = await db.query('SELECT tipo FROM Pessoa WHERE id = ?', [id]);
  if (result.length === 0) throw new Error('Pessoa não encontrada');
  return result[0].tipo;
}

// 🔨 Atualizar a tabela
async function atualizarTabela(tabela, campos, id) {
  const setClauses = [];
  const values = [];

  for (const campo in campos) {
    setClauses.push(`${campo} = ?`);
    values.push(campos[campo]);
  }

  if (setClauses.length === 0) return;

  values.push(id);
  const query = `UPDATE ${tabela} SET ${setClauses.join(', ')} WHERE id = ?`;
  await db.query(query, values);
}

// 🛠️ Atualizar apenas se houver campos válidos
async function atualizarSeExistir(tabela, camposPermitidos, updates, id) {
  const camposFiltrados = {};

  for (const campo of camposPermitidos) {
    if (updates[campo] !== undefined) {
      camposFiltrados[campo] = updates[campo];
    }
  }

  if (Object.keys(camposFiltrados).length > 0) {
    await atualizarTabela(tabela, camposFiltrados, id);
  }
}

// 🚀 Função principal do PATCH
async function atualizarPessoaCompleta(id, updates) {
  const pessoaFields = ['nome', 'foto', 'rg', 'cpf', 'telefone', 'email', 'unidade_id', 'qr_code', 'cartao_rfid', 'senha_acesso', 'data_nascimento', 'genero'];
  const alunoFields = ['ra', 'rm','turma_id', 'divisao', 'status'];
  const responsavelFields = [''];
  const professorFields = [''];
  const administradorFields = ['cargo'];
  const terceirizadoFields = ['empresa_id', 'funcao'];
  
  // 🚫 Impedir alteração do campo "tipo"
  delete updates.tipo;

  // 1. Buscar tipo da pessoa
  const tipo = await buscarTipoPessoa(id);

  // 2. Atualizar campos da tabela Pessoa
  const pessoaUpdates = {};
  for (const campo of pessoaFields) {
    if (updates[campo] !== undefined) {
      pessoaUpdates[campo] = updates[campo];
    }
  }
  if (Object.keys(pessoaUpdates).length > 0) {
    await atualizarTabela('Pessoa', pessoaUpdates, id);
  }

  // 3. Atualizar tabelas específicas
  if (tipo === 'ALUNO') {
    await atualizarSeExistir('Aluno', alunoFields, updates, id);
  }

  if (tipo === 'RESPONSAVEL') {
    await atualizarSeExistir('Responsavel', responsavelFields, updates, id);
  }

  if (tipo === 'PROFESSOR') {
    await atualizarSeExistir('Professor', professorFields, updates, id);
  }

  if (tipo === 'ADMINISTRADOR') {
    await atualizarSeExistir('Administrador', administradorFields, updates, id);
  }

  if (tipo === 'PROFADM') {
    await atualizarSeExistir('Professor', professorFields, updates, id);
    await atualizarSeExistir('Administrador', administradorFields, updates, id);
  }

  if (tipo === 'TERCEIRIZADO') {
    await atualizarSeExistir('Terceirizado', terceirizadoFields, updates, id);
  }
}

// 📌 Remover pessoa (incluindo nas tabelas filhas)
async function removerPessoa(id) {
  await db.query('DELETE FROM Aluno WHERE id = ?', [id]);
  await db.query('DELETE FROM Professor WHERE id = ?', [id]);
  await db.query('DELETE FROM Administrador WHERE id = ?', [id]);
  await db.query('DELETE FROM Terceirizado WHERE id = ?', [id]);
  await db.query('DELETE FROM Pessoa WHERE id = ?', [id]);
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
  removerPessoa
};
