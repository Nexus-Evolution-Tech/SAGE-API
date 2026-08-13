const { verificarToken } = require('../utils/jwt');
const db = require('../config/database');
const logger = require('../config/logger');

async function autenticar(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ message: 'Token não fornecido' });

  const payload = verificarToken(token);
  if (!payload) return res.status(401).json({ message: 'Token inválido ou expirado' });

  try {
    const [[usuario]] = await db.query(
      'SELECT id, login, nome_exibicao, papel, ativo, pessoa_id, precisa_trocar_senha FROM Usuario WHERE id = ? LIMIT 1',
      [payload.usuario_id]
    );
    if (!usuario || !usuario.ativo) return res.status(401).json({ message: 'Usuário inativo ou inexistente' });
    if (usuario.precisa_trocar_senha && !(req.method === 'PATCH' && req.path === '/unidade/trocar-senha')) {
      return res.status(428).json({ message: 'Troca de senha obrigatória' });
    }
    req.user = { ...usuario, usuario_id: usuario.id };
  } catch (error) {
    logger.error('[AUTH] codigo=CONSULTA_USUARIO_FALHOU');
    return res.status(503).json({ message: 'Autenticação indisponível' });
  }
  next();
}

module.exports = autenticar;
