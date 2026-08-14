const usuarioService = require('../services/usuarioService');
const logger = require('../config/logger');

function responderErro(res, error) {
  const statusPorCodigo = {
    USUARIO_DADOS_INVALIDOS: 400,
    USUARIO_ID_INVALIDO: 400,
    USUARIO_PESSOA_INVALIDA: 400,
    USUARIO_SENHA_INVALIDA: 400,
    USUARIO_LOGIN_DUPLICADO: 409,
    USUARIO_NAO_ENCONTRADO: 404,
    USUARIOS_INDISPONIVEIS: 503
  };
  const status = statusPorCodigo[error.code] || 503;
  const mensagens = {
    USUARIO_ID_INVALIDO: 'id invalido',
    USUARIO_SENHA_INVALIDA: 'Nova senha invalida',
    USUARIO_NAO_ENCONTRADO: 'Usuario nao encontrado',
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

function idDaRota(req, res) {
  const id = Number(req.params.id);
  if (!usuarioService.validarId(id) || String(id) !== req.params.id) {
    responderErro(res, { code: 'USUARIO_ID_INVALIDO' });
    return undefined;
  }
  return id;
}

function corpoDesativacaoVazio(body) {
  return body === undefined || (body !== null && typeof body === 'object'
    && !Array.isArray(body) && Object.getPrototypeOf(body) === Object.prototype
    && Object.keys(body).length === 0);
}

async function editar(req, res) {
  const id = idDaRota(req, res);
  if (id === undefined) return res;
  try {
    const usuario = await usuarioService.atualizarUsuario(id, req.body);
    return usuario ? res.json({ data: usuario }) : responderErro(res, { code: 'USUARIO_NAO_ENCONTRADO' });
  } catch (error) {
    return responderErro(res, error);
  }
}

async function desativar(req, res) {
  const id = idDaRota(req, res);
  if (id === undefined) return res;
  if (!corpoDesativacaoVazio(req.body)) return responderErro(res, { code: 'USUARIO_DADOS_INVALIDOS' });
  try {
    const usuario = await usuarioService.desativarUsuario(id);
    return usuario ? res.json({ data: usuario }) : responderErro(res, { code: 'USUARIO_NAO_ENCONTRADO' });
  } catch (error) {
    return responderErro(res, error);
  }
}

async function redefinirSenha(req, res) {
  const id = idDaRota(req, res);
  if (id === undefined) return res;
  try {
    const usuario = await usuarioService.redefinirSenha(id, req.body);
    return usuario ? res.json({ data: usuario }) : responderErro(res, { code: 'USUARIO_NAO_ENCONTRADO' });
  } catch (error) {
    return responderErro(res, error);
  }
}

module.exports = { criar, listar, obter, editar, desativar, redefinirSenha };
