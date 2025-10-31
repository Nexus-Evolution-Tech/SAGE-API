const db = require('../config/database');

async function buscarTodos(tabela, campos = ['*'], limit = 50, offset = 0) {
  const query = `SELECT ${campos.join(', ')} FROM ${tabela} LIMIT ? OFFSET ?`;
  const [result] = await db.query(query, [limit, offset]);
  return result;
}

async function buscarPorId(id, tabela, campos = ['*']) {
  const query = `SELECT ${campos.join(', ')} FROM ${tabela} WHERE id = ${id}`;
  const [result] = await db.query(query);
  return result;
}

async function criarRegistro(tabela, dados) {
  const campos = Object.keys(dados);
  const valores = Object.values(dados);

  const placeholders = campos.map(() => '?').join(', ');

  const query = `INSERT INTO ${tabela} (${campos.join(', ')}) VALUES (${placeholders})`;
  await db.query(query, valores);
}

async function atualizarRegistro(tabela, id, updates) {
  const campos = Object.keys(updates);
  const valores = Object.values(updates);

  if (campos.length === 0) return;

  const setClauses = campos.map(campo => `${campo} = ?`).join(', ');
  const query = `UPDATE ${tabela} SET ${setClauses} WHERE id = ?`;

  await db.query(query, [...valores, id]);
}

async function removerRegistro(tabela, id) {
  const query = `DELETE FROM ${tabela} WHERE id = ?`;
  await db.query(query, [id]);
}

module.exports = {
  buscarTodos,
  buscarPorId,
  criarRegistro,
  atualizarRegistro,
  removerRegistro
};
