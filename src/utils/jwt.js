const jwt = require('jsonwebtoken');
const logger = require('../config/logger');

const SECRET = process.env.JWT_SECRET;
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';

if (!SECRET) {
  logger.error('JWT_SECRET não configurado no .env!');
  throw new Error('JWT_SECRET é obrigatório');
}

function gerarToken(payload) {
  const chaves = Object.keys(payload || {}).sort();
  if (chaves.join(',') !== 'emitido_em,papel,usuario_id'
    || !Number.isInteger(payload.usuario_id)
    || !['ADMINISTRADOR', 'SECRETARIA'].includes(payload.papel)
    || typeof payload.emitido_em !== 'string'
    || Number.isNaN(Date.parse(payload.emitido_em))) {
    throw new TypeError('Claims de sessão inválidos');
  }
  try {
    return jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN, noTimestamp: true });
  } catch (error) {
    logger.errorWithStack('Erro ao gerar token JWT', error);
    throw error;
  }
}

function verificarToken(token) {
  try {
    const payload = jwt.verify(token, SECRET);
    const chaves = Object.keys(payload).sort();
    if (chaves.join(',') !== 'emitido_em,exp,papel,usuario_id'
      || !Number.isInteger(payload.usuario_id)
      || !['ADMINISTRADOR', 'SECRETARIA'].includes(payload.papel)
      || typeof payload.emitido_em !== 'string'
      || Number.isNaN(Date.parse(payload.emitido_em))) return null;
    return payload;
  } catch (err) {
    logger.debug(`Token inválido: ${err.message}`);
    return null; // token inválido ou expirado
  }
}

module.exports = { gerarToken, verificarToken };
