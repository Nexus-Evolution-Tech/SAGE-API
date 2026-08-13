const jwt = require('jsonwebtoken');
const logger = require('../config/logger');

const SECRET = process.env.JWT_SECRET;
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';

if (!SECRET) {
  logger.error('JWT_SECRET não configurado no .env!');
  throw new Error('JWT_SECRET é obrigatório');
}

function gerarToken(payload) {
  try {
    return jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN });
  } catch (error) {
    logger.errorWithStack('Erro ao gerar token JWT', error);
    throw error;
  }
}

function verificarToken(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch (err) {
    logger.debug(`Token inválido: ${err.message}`);
    return null; // token inválido ou expirado
  }
}

module.exports = { gerarToken, verificarToken };
