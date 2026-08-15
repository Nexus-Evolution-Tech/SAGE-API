const { randomBytes } = require('crypto');
const logger = require('../config/logger');
const { sanitizar } = require('../services/sanitizador');
function responderErroInterno(res, erro, mensagem = 'Erro interno no servidor') {
  const traceId = randomBytes(16).toString('hex');
  logger.error('[HTTP] codigo=ERRO_INTERNO', {
    traceId,
    detalhe: sanitizar(erro || { mensagem: 'erro interno sem detalhe' })
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
