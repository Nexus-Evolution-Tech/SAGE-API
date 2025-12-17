console.log('[BOOT-AUT] require start');
const { verificarToken } = require('../utils/jwt');
console.log('[BOOT-AUT] jwt util loaded');

function autenticar(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ message: 'Token não fornecido' });

  const payload = verificarToken(token);
  if (!payload) return res.status(403).json({ message: 'Token inválido ou expirado' });

  req.user = payload; // guarda os dados do usuário no request
  next();
}

module.exports = autenticar;