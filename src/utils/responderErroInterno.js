const { randomBytes } = require('crypto');
const logger = require('../config/logger');
const { sanitizar } = require('../services/sanitizador');

const CODIGOS_REDE_CATRACA = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH']);

function gerarOcorrencia() {
  return randomBytes(6).toString('base64url').slice(0, 8).toUpperCase();
}

function codigoEstavel(erro) {
  const codigo = erro?.codigo || erro?.code;
  if (CODIGOS_REDE_CATRACA.has(codigo)) return 'CAT-CONN-03';
  if (typeof codigo === 'string' && /^[A-Z][A-Z0-9_-]{2,63}$/.test(codigo)) {
    return codigo;
  }
  return 'SAGE-HTTP-500';
}

function detalheSanitizavel(erro) {
  const message = erro instanceof Error ? erro.message : erro?.message || String(erro || 'erro interno sem detalhe');
  const stack = erro instanceof Error ? erro.stack : erro?.stack;
  return sanitizar({ message, ...(stack ? { stack: String(stack) } : {}) });
}
function responderErroInterno(res, erro, mensagem = 'Erro interno no servidor') {
  const traceId = randomBytes(16).toString('hex');
  const ocorrencia = gerarOcorrencia();
  const codigo = codigoEstavel(erro);
  logger.error('[HTTP] codigo=ERRO_INTERNO', {
    traceId,
    ocorrencia,
    codigo,
    detalhe: detalheSanitizavel(erro)
  });
  res.locals = res.locals || {};
  res.locals.sageErroInterno = true;
  try {
    return res.status(500).json({ error: mensagem, codigo, ocorrencia, traceId });
  } finally {
    delete res.locals.sageErroInterno;
  }
}
module.exports = { responderErroInterno, codigoEstavel, gerarOcorrencia };
