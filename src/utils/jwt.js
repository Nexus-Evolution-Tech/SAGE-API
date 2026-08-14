const jwt = require('jsonwebtoken');
const logger = require('../config/logger');

const SECRET = process.env.JWT_SECRET;
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';
const CLAIMS = ['emitido_em', 'papel', 'usuario_id'];
const PAPEIS = new Set(['ADMINISTRADOR', 'SECRETARIA']);

if (!SECRET) {
  logger.error('JWT_SECRET não configurado no .env!');
  throw new Error('JWT_SECRET é obrigatório');
}

function gerarToken(payload) {
  if (!claimsValidos(payload)) throw new TypeError('Claims de sessão inválidos');
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
    if (chaves.join(',') !== 'emitido_em,exp,papel,usuario_id' || !claimsValidos(payload)) return null;
    return payload;
  } catch (err) {
    logger.debug(`Token inválido: ${err.message}`);
    return null; // token inválido ou expirado
  }
}

function claimsValidos(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  if (Object.keys(payload).filter((chave) => chave !== 'exp').sort().join(',') !== CLAIMS.join(',')) return false;
  return Number.isInteger(payload.usuario_id) && payload.usuario_id > 0 &&
    PAPEIS.has(payload.papel) && typeof payload.emitido_em === 'string' &&
    Number.isFinite(Date.parse(payload.emitido_em));
}

module.exports = { gerarToken, verificarToken };
