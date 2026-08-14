/**
 * Rotas para receber notificações do Monitor da Control iD.
 * A catraca envia POST para estes endpoints quando há eventos (acessos, etc.).
 * Segurança: use MONITOR_CALLBACK_TOKEN e/ou MONITOR_IP_WHITELIST no .env (ver docs/SEGURANCA_CATRACA_E_MONITORAMENTO.md).
 * Documentação: https://www.controlid.com.br/docs/access-api-pt/monitor/introducao-ao-monitor/
 */
const express = require('express');
const router = express.Router();
const monitorCallbackAuth = require('../middlewares/monitorCallbackAuth');
const { autenticacaoPropria } = require('../middlewares/autorizacao');
const { processarNotificacaoMonitorDao } = require('../services/accessService');
const logger = require('../config/logger');

// POST /api/notifications/dao — alterações em access_logs, templates, cards, alarm_logs
// Middleware opcional: token (query ?token= ou header X-Monitor-Token) e/ou IP whitelist quando configurados
router.post('/api/notifications/dao', autenticacaoPropria('monitorCallbackAuth'), monitorCallbackAuth, async (req, res) => {
  try {
    const payload = req.body || {};
    const deviceId = payload.device_id;
    const changes = Array.isArray(payload.object_changes) ? payload.object_changes : [];
    const accessLogs = changes.filter((c) => c.object === 'access_logs' && c.type === 'inserted');
    logger.info(`[MONITOR DAO] POST recebido: device_id=${deviceId}, ${accessLogs.length} acesso(s) em object_changes`);
    const resultado = await processarNotificacaoMonitorDao(payload);
    if (resultado.erros.length > 0) {
      logger.warn(`[MONITOR DAO] Processamento incompleto: ${resultado.erros.length} erro(s)`);
      return res.status(502).json({ ok: false, ...resultado });
    }
    if (resultado.processados > 0) {
      logger.info(`[MONITOR DAO] ${resultado.processados} acesso(s) registrado(s), ${resultado.ignorados} ignorado(s)`);
    } else {
      logger.debug(`[MONITOR DAO] Processados: ${resultado.processados}, ignorados: ${resultado.ignorados}`);
    }
    return res.status(200).json({ ok: true, ...resultado });
  } catch (error) {
    logger.error(`[MONITOR DAO] Erro ao processar notificação: ${error.message}`);
    return res.status(500).json({ ok: false, error: 'Falha ao processar notificação' });
  }
});

module.exports = router;
