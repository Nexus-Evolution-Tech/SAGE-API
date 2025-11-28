const jwt = require('jsonwebtoken');
const SECRET = 'sua_chave_super_secreta'; // ideal usar variável de ambiente

function gerarToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: '10m' }); // expira em 1 hora
}

function verificarToken(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch (err) {
    return null; // token inválido ou expirado
  }
}

module.exports = { gerarToken, verificarToken };