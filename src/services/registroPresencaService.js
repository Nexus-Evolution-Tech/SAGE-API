const db = require('../config/database');

const SENTIDOS = new Set(['ENTRADA', 'SAIDA']);
const ORIGENS = new Set(['CATRACA', 'MANUAL', 'CORRECAO', 'IMPORTACAO']);

function validarFato(fato) {
  if (!fato || !Number.isInteger(Number(fato.pessoa_id)) || Number(fato.pessoa_id) <= 0) {
    throw new Error('REGISTRO_PRESENCA_PESSOA_INVALIDA');
  }
  if (!(fato.momento instanceof Date) && Number.isNaN(new Date(fato.momento).getTime())) {
    throw new Error('REGISTRO_PRESENCA_MOMENTO_INVALIDO');
  }
  if (!SENTIDOS.has(fato.sentido)) throw new Error('REGISTRO_PRESENCA_SENTIDO_INVALIDO');
  if (!ORIGENS.has(fato.origem)) throw new Error('REGISTRO_PRESENCA_ORIGEM_INVALIDA');
  if (fato.origem === 'CORRECAO') {
    if (!Number.isInteger(Number(fato.registro_corrigido_id)) || Number(fato.registro_corrigido_id) <= 0) {
      throw new Error('REGISTRO_PRESENCA_CORRECAO_SEM_ALVO');
    }
    if (!Number.isInteger(Number(fato.criado_por)) || Number(fato.criado_por) <= 0) {
      throw new Error('REGISTRO_PRESENCA_CORRECAO_SEM_AUTOR');
    }
    if (typeof fato.justificativa !== 'string' || fato.justificativa.trim().length < 10) {
      throw new Error('REGISTRO_PRESENCA_CORRECAO_SEM_JUSTIFICATIVA');
    }
  }
}

async function registrarFato(fato, executor = db) {
  validarFato(fato);
  const [resultado] = await executor.query(
    `INSERT INTO RegistroPresenca
       (pessoa_id, dispositivo_id, momento, sentido, origem, log_catraca_id,
        registro_corrigido_id, criado_por, justificativa)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      fato.pessoa_id,
      fato.dispositivo_id ?? null,
      fato.momento,
      fato.sentido,
      fato.origem,
      fato.log_catraca_id ?? null,
      fato.registro_corrigido_id ?? null,
      fato.criado_por ?? null,
      fato.justificativa ?? null
    ]
  );
  return { id: resultado.insertId, ...fato };
}

async function registrarCorrecao(fato, executor = db) {
  return registrarFato({ ...fato, origem: 'CORRECAO' }, executor);
}

async function listarVigentes({ pessoaId, inicio, fim } = {}, executor = db) {
  const filtros = [];
  const params = [];
  if (pessoaId != null) { filtros.push('pessoa_id = ?'); params.push(pessoaId); }
  if (inicio != null) { filtros.push('momento >= ?'); params.push(inicio); }
  if (fim != null) { filtros.push('momento <= ?'); params.push(fim); }
  const [rows] = await executor.query(
    `SELECT * FROM RegistroPresencaVigente${filtros.length ? ` WHERE ${filtros.join(' AND ')}` : ''} ORDER BY momento ASC, id ASC`,
    params
  );
  return rows;
}

module.exports = { SENTIDOS, ORIGENS, validarFato, registrarFato, registrarCorrecao, listarVigentes };
