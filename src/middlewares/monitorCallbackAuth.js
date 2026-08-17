/**
 * Middleware de segurança para o callback do Monitor (catraca Control iD).
 * Aplica token compartilhado e/ou whitelist de IP do Monitor.
 * Documentação: docs/SEGURANCA_CATRACA_E_MONITORAMENTO.md
 */
const crypto = require('crypto');
const logger = require('../config/logger');

function normalizarIp(ip) {
  return String(ip || '').trim().replace(/^::ffff:/i, '').toLowerCase();
}

function tokenValido(recebido, esperado) {
  if (typeof esperado !== 'string' || esperado.trim().length === 0) return false;
  const recebidoBuffer = Buffer.from(typeof recebido === 'string' ? recebido : '', 'utf8');
  const esperadoBuffer = Buffer.from(esperado, 'utf8');
  if (recebidoBuffer.length !== esperadoBuffer.length) return false;
  return crypto.timingSafeEqual(recebidoBuffer, esperadoBuffer);
}

function monitorCallbackAuth(req, res, next) {
  const token = process.env.MONITOR_CALLBACK_TOKEN;
  const whitelistRaw = process.env.MONITOR_IP_WHITELIST;

  const providedToken = req.headers['x-monitor-token'];
  if (!tokenValido(providedToken, token)) {
    logger.warn('[MONITOR AUTH] Token inválido ou ausente');
    return res.status(401).json({ ok: false, error: 'Token inválido ou ausente' });
  }

  if (whitelistRaw && whitelistRaw.trim().length > 0) {
    const allowedIps = whitelistRaw.split(',').map(normalizarIp).filter(Boolean);
    const clientIp = normalizarIp(req.socket?.remoteAddress);
    const allowed = allowedIps.includes(clientIp);
    if (!allowed) {
      logger.warn('[MONITOR AUTH] IP não permitido');
      return res.status(403).json({ ok: false, error: 'IP não permitido' });
    }
  }

  return next();
}

module.exports = monitorCallbackAuth;
