/**
 * Middleware de segurança para o callback do Monitor (catraca Control iD).
 * Aplica token compartilhado e/ou whitelist de IP quando configurados no .env.
 * Documentação: docs/SEGURANCA_CATRACA_E_MONITORAMENTO.md
 */
const logger = require('../config/logger');

function monitorCallbackAuth(req, res, next) {
  const token = process.env.MONITOR_CALLBACK_TOKEN;
  const whitelistRaw = process.env.MONITOR_IP_WHITELIST;

  if (token && token.length > 0) {
    const providedToken = req.query.token || req.headers['x-monitor-token'] || '';
    if (providedToken !== token) {
      logger.warn(`[MONITOR AUTH] Token inválido ou ausente (origem: ${req.ip || req.connection?.remoteAddress || '?'})`);
      return res.status(401).json({ ok: false, error: 'Token inválido ou ausente' });
    }
  }

  if (whitelistRaw && whitelistRaw.trim().length > 0) {
    const allowedIps = whitelistRaw.split(',').map((ip) => ip.trim()).filter(Boolean);
    const clientIp = (req.headers['x-forwarded-for'] && req.headers['x-forwarded-for'].split(',')[0].trim()) || req.ip || req.connection?.remoteAddress || '';
    const normalizedClient = clientIp.replace(/^::ffff:/, '');
    const allowed = allowedIps.some((ip) => {
      const normalized = ip.replace(/^::ffff:/, '');
      return normalized === normalizedClient || normalized === clientIp;
    });
    if (!allowed) {
      logger.warn(`[MONITOR AUTH] IP não permitido: ${clientIp} (whitelist: ${allowedIps.join(', ')})`);
      return res.status(403).json({ ok: false, error: 'IP não permitido' });
    }
  }

  next();
}

module.exports = monitorCallbackAuth;
