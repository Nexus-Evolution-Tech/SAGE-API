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

// 🔎 Buscar Professor
async function buscarProfessor(id) {
  const [result] = await db.query('SELECT * FROM Professor WHERE id = ?', [id]);
  return result.length ? result[0] : {};
}

// 🔎 Buscar Administrador
async function buscarAdministrador(id) {
  const [result] = await db.query('SELECT * FROM Administrador WHERE id = ?', [id]);
  return result.length ? result[0] : {};
}

// 🔎 Buscar Terceirizado
async function buscarTerceirizado(id) {
  const [result] = await db.query('SELECT * FROM Terceirizado WHERE id = ?', [id]);
  return result.length ? result[0] : {};
}

// 🔎 Buscar ProfAdm (Professor + Administrador)
async function buscarProfAdm(id) {
  const professor = await buscarProfessor(id);
  const administrador = await buscarAdministrador(id);
  return { ...professor, ...administrador };
}

// 📌 Criar Pessoa base
async function criarPessoaBase(dados) {
  const query = `
    INSERT INTO Pessoa (nome, foto, rg, cpf, telefone, email, unidade_id, qr_code, cartao_rfid, senha_acesso, data_nascimento, genero, tipo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    dados.genero,
    dados.tipo
  ];
  const [result] = await db.query(query, values);
  return { id: result.insertId };
}

// 📌 Criar Aluno
async function criarAluno(pessoaId, dados) {
  const query = `
    INSERT INTO Aluno (id, rm, turma_id, responsavel_id, status)
    VALUES (?, ?, ?, ?, 'ATIVO')
  `;
  const values = [
    pessoaId,
    dados.rm,
    dados.turma_id,
    dados.responsavel_id
  ];
  await db.query(query, values);
}

// 📌 Criar Professor
async function criarProfessor(pessoaId, dados) {
  const query = `
    INSERT INTO Professor (id, siape)
    VALUES (?, ?)
  `;
  await db.query(query, [pessoaId, dados.siape]);
}

// 📌 Criar Administrador
async function criarAdministrador(pessoaId, dados) {
  const query = `
    INSERT INTO Administrador (id, cargo)
    VALUES (?, ?)
  `;
  await db.query(query, [pessoaId, dados.cargo]);
}

// 📌 Criar Terceirizado
async function criarTerceirizado(pessoaId, dados) {
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
  criarProfessor(pessoaId, dados);
  criarAdministrador(pessoaId, dados);
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
  const [pessoa] = await db.query(`SELECT * FROM Pessoa WHERE id = ${id}`);
  return pessoa;
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
  const alunoFields = ['rm', 'turma_id', 'responsavel_id', 'status'];
  const professorFields = ['siape'];
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
  buscarProfessor,
  buscarAdministrador,
  buscarProfAdm,
  buscarTerceirizado,
  criarPessoaBase,
  criarAluno,
  criarProfessor,
  criarAdministrador,
  criarTerceirizado,
  criarProfAdm,
  buscarTodasPessoas,
  buscarPorId,
  atualizarPessoaCompleta,
  removerPessoa
};
