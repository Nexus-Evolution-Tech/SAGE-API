const usuarioService = require('../services/usuarioService');
const logger = require('../config/logger');

function responderErro(res, error) {
  const statusPorCodigo = {
    USUARIO_DADOS_INVALIDOS: 400,
    USUARIO_PESSOA_INVALIDA: 400,
    USUARIO_LOGIN_DUPLICADO: 409,
    USUARIOS_INDISPONIVEIS: 503
  };
  const status = statusPorCodigo[error.code] || 503;
  const mensagens = {
    USUARIO_DADOS_INVALIDOS: 'Dados de usuário inválidos',
    USUARIO_PESSOA_INVALIDA: 'pessoa_id inválido',
    USUARIO_LOGIN_DUPLICADO: 'Login já cadastrado',
    USUARIOS_INDISPONIVEIS: 'Usuários indisponíveis'
  };
  if (!statusPorCodigo[error.code]) logger.error('[USUARIOS] codigo=ERRO_NAO_CLASSIFICADO');
  return res.status(status).json({ message: mensagens[error.code] || 'Usuários indisponíveis' });
}

async function criar(req, res) {
  try {
    const usuario = await usuarioService.criarUsuario(req.body);
    return res.status(201).json({ data: usuario });
  } catch (error) {
    return responderErro(res, error);
  }
}

async function listar(req, res) {
  try {
    return res.json({ data: await usuarioService.listarUsuarios() });
  } catch (error) {
    logger.error('[USUARIOS] codigo=LISTAGEM_FALHOU');
    return res.status(503).json({ message: 'Usuários indisponíveis' });
  }
}

async function obter(req, res) {
  const id = Number(req.params.id);
  if (!usuarioService.validarId(id) || String(id) !== req.params.id) {
    return res.status(400).json({ message: 'id inválido' });
  }
  try {
    const usuario = await usuarioService.buscarUsuarioPorId(id);
    return usuario
      ? res.json({ data: usuario })
      : res.status(404).json({ message: 'Usuário não encontrado' });
  } catch (error) {
    logger.error('[USUARIOS] codigo=CONSULTA_FALHOU');
    return res.status(503).json({ message: 'Usuários indisponíveis' });
  }
}

module.exports = { criar, listar, obter };
