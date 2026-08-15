const db = require('../config/database');

async function buscarTodos(tabela, campos = ['*'], limit = 50, offset = 0) {
  const query = `SELECT ${campos.join(', ')} FROM ${tabela} LIMIT ? OFFSET ?`;
  const [result] = await db.query(query, [limit, offset]);
  return result;
}

async function buscarPorId(id, tabela, campos = ['*']) {
  const query = `SELECT ${campos.join(', ')} FROM ${tabela} WHERE id = ?`;
  const [result] = await db.query(query, [id]);
  return result;
}

async function criarRegistro(tabela, dados, connection = db) {
  const campos = Object.keys(dados);
  const valores = Object.values(dados);

  const placeholders = campos.map(() => '?').join(', ');

  const query = `INSERT INTO ${tabela} (${campos.join(', ')}) VALUES (${placeholders})`;
  const [result] = await connection.query(query, valores);
  const insertId = result?.insertId;
  if (insertId == null) return undefined;
  const [rows] = await connection.query(`SELECT * FROM ${tabela} WHERE id = ?`, [insertId]);
  return rows[0] || { id: insertId, ...dados };
}

async function atualizarRegistro(tabela, id, updates, connection = db) {
  const campos = Object.keys(updates);
  const valores = Object.values(updates);

  if (campos.length === 0) return;

  const setClauses = campos.map(campo => `${campo} = ?`).join(', ');
  const query = `UPDATE ${tabela} SET ${setClauses} WHERE id = ?`;

  await connection.query(query, [...valores, id]);
}

async function removerRegistro(tabela, id, connection = db) {
  const query = `DELETE FROM ${tabela} WHERE id = ?`;
  await connection.query(query, [id]);
}

module.exports = {
  buscarTodos,
  buscarPorId,
  criarRegistro,
  atualizarRegistro,
  removerRegistro
};
