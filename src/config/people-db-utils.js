const db = require('./database');

// 📌 Criar Pessoa base
async function criarPessoaBase(dados) {
  const query = `
    INSERT INTO Pessoa (nome, foto, unidade_id, email, telefone, qr_code, cartao_rfid, senha_acesso, tipo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const values = [
    dados.nome,
    dados.foto,
    dados.unidade_id,
    dados.email,
    dados.telefone,
    dados.qr_code,
    dados.cartao_rfid,
    dados.senha_acesso,
    dados.tipo
  ];
  const [result] = await db.query(query, values);
  return { id: result.insertId };
}

// 📌 Criar Aluno
async function criarAluno(pessoaId, dados) {
  const query = `
    INSERT INTO Aluno (id, turma_id, rm, email_responsavel, tel_responsavel)
    VALUES (?, ?, ?, ?, ?)
  `;
  const values = [
    pessoaId,
    dados.turma_id,
    dados.rm,
    dados.email_responsavel,
    dados.tel_responsavel
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
    INSERT INTO Administrador (id, funcao)
    VALUES (?, ?)
  `;
  await db.query(query, [pessoaId, dados.funcao]);
}

// 📌 Criar Terceirizado
async function criarTerceirizado(pessoaId, dados) {
  const query = `
    INSERT INTO Terceirizado (id, nome_empresa, cnpj, funcao)
    VALUES (?, ?, ?, ?)
  `;
  const values = [
    pessoaId,
    dados.nome_empresa,
    dados.cnpj,
    dados.funcao
  ];
  await db.query(query, values);
}

// 📌 Criar Professor Administrador
async function criarProfAdm(pessoaId, dados) {
  criarProfessor(pessoaId, dados);
  criarAdministrador(pessoaId,dados);
}

// 📌 Buscar todas as pessoas
async function buscarTodasPessoas() {
  const [pessoas] = await db.query('SELECT * FROM Pessoa');
  return pessoas;
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
  const pessoaFields = ['nome', 'email', 'telefone', 'foto', 'unidade_id', 'qr_code', 'cartao_rfid', 'senha_acesso'];
  const alunoFields = ['turma_id', 'rm', 'email_responsavel', 'tel_responsavel'];
  const professorFields = ['siape'];
  const administradorFields = ['funcao'];
  const terceirizadoFields = ['nome_empresa', 'cnpj', 'funcao'];

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
  criarPessoaBase,
  criarAluno,
  criarProfessor,
  criarAdministrador,
  criarTerceirizado,
  criarProfAdm,
  buscarTodasPessoas,
  atualizarPessoaCompleta,
  removerPessoa
};
