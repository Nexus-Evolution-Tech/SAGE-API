const { randomBytes } = require('crypto');
const logger = require('../config/logger');
const { sanitizar } = require('../services/sanitizador');
function detalheSanitizavel(erro) {
  const message = erro instanceof Error ? erro.message : erro?.message || String(erro || 'erro interno sem detalhe');
  const stack = erro instanceof Error ? erro.stack : erro?.stack;
  return sanitizar({ message, ...(stack ? { stack: String(stack) } : {}) });
}
function responderErroInterno(res, erro, mensagem = 'Erro interno no servidor') {
  const traceId = randomBytes(16).toString('hex');
  logger.error('[HTTP] codigo=ERRO_INTERNO', {
    traceId,
    detalhe: detalheSanitizavel(erro)
  });
  res.locals = res.locals || {};
  res.locals.sageErroInterno = true;
  try {
    return res.status(500).json({ error: mensagem, traceId });
  } finally {
    delete res.locals.sageErroInterno;
  }
}
module.exports = { responderErroInterno };
