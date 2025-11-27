const db = require('../config/database');
async function verificarDuplicidade(campo, valor, idAtual) {
  if (!valor || valor.trim() === "") return; // campo não preenchido → ignorar

  const [rows] = await db.query(
    `SELECT id FROM Pessoa WHERE ${campo} = ? AND id <> ? LIMIT 1`,
    [valor, idAtual]
  );

  if (rows.length > 0) {
    throw new Error(`Já existe uma pessoa com este ${campo}.`);
  }
}

module.exports = verificarDuplicidade;