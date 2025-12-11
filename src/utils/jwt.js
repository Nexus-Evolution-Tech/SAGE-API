const jwt = require('jsonwebtoken');
const env = require('../config/environment');

function gerarToken(payload) {
  return jwt.sign(payload, env.jwt.secret, { expiresIn: env.jwt.expiresIn });
}

function verificarToken(token) {
  try {
    return jwt.verify(token, env.jwt.secret);
  } catch (err) {
    return null; // token inválido ou expirado
  }
}

module.exports = { gerarToken, verificarToken };