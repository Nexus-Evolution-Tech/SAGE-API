const db = require('../config/database');
const projecoes = require('../config/projecoes');

const ERROS_ESCRITA = new Set(['ESCRITA_CHAVE_NAO_DECLARADA', 'ESCRITA_NENHUM_CAMPO_APLICAVEL']);

function erroEscrita(code, chaves, ignorados = []) {
  const erro = new Error(`${code}: ${chaves.join(', ') || 'nenhum campo aplicável'}`);
  erro.code = code;
  erro.chaves = chaves;
  erro.ignorados = ignorados;
  return erro;
}

function filtrarDadosDeEscrita(tabela, dados = {}) {
  const declaracao = projecoes.obterDeclaracao(tabela);
  const declaradas = new Set([...declaracao.leitura, ...declaracao.escrita, ...declaracao.segredo]);
  const escrita = new Set(declaracao.escrita);
  const aplicaveis = {};
  const ignorados = [];
  const desconhecidas = [];

  for (const [chave, valor] of Object.entries(dados)) {
    if (!declaradas.has(chave)) desconhecidas.push(chave);
    else if (valor !== undefined && escrita.has(chave)) aplicaveis[chave] = valor;
    else if (valor !== undefined) ignorados.push(chave);
  }
  if (desconhecidas.length) throw erroEscrita('ESCRITA_CHAVE_NAO_DECLARADA', desconhecidas, ignorados);
  if (!Object.keys(aplicaveis).length) throw erroEscrita('ESCRITA_NENHUM_CAMPO_APLICAVEL', [], ignorados);
  return { dados: aplicaveis, ignorados };
}

function anexarIgnorados(registro, ignorados) {
  if (registro && typeof registro === 'object') {
    Object.defineProperty(registro, 'ignorados', { value: ignorados, enumerable: false, configurable: true });
  }
  return registro;
}

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
  const filtrado = filtrarDadosDeEscrita(tabela, dados);
  const campos = Object.keys(filtrado.dados);
  const valores = Object.values(filtrado.dados);

  const placeholders = campos.map(() => '?').join(', ');

  const query = `INSERT INTO ${tabela} (${campos.join(', ')}) VALUES (${placeholders})`;
  const [result] = await connection.query(query, valores);
  const insertId = result?.insertId;
  if (insertId == null) return undefined;
  projecoes.exigirProjecao(tabela);
  const colunas = projecoes.colunasDeLeitura(tabela);
  const [rows] = await connection.query(`SELECT ${colunas.join(', ')} FROM ${tabela} WHERE id = ?`, [insertId]);
  const registro = rows[0] || { id: insertId, ...filtrado.dados };
  return anexarIgnorados(projecoes.projetarRegistro(tabela, registro), filtrado.ignorados);
}

async function atualizarRegistro(tabela, id, updates, connection = db) {
  const filtrado = filtrarDadosDeEscrita(tabela, updates);
  const campos = Object.keys(filtrado.dados);
  const valores = Object.values(filtrado.dados);

  const setClauses = campos.map(campo => `${campo} = ?`).join(', ');
  const query = `UPDATE ${tabela} SET ${setClauses} WHERE id = ?`;

  await connection.query(query, [...valores, id]);
  return { ignorados: filtrado.ignorados };
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
  removerRegistro,
  filtrarDadosDeEscrita,
  ERROS_ESCRITA
};
