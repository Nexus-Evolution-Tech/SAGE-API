/**
 * Rotas para receber notificações do Monitor da Control iD.
 * A catraca envia POST para estes endpoints quando há eventos (acessos, etc.).
 * Não exige autenticação JWT — a requisição vem do equipamento.
 * Documentação: https://www.controlid.com.br/docs/access-api-pt/monitor/introducao-ao-monitor/
 */
const express = require('express');
const router = express.Router();
const { processarNotificacaoMonitorDao } = require('../services/accessService');
const logger = require('../config/logger');

// POST /api/notifications/dao — alterações em access_logs, templates, cards, alarm_logs
router.post('/api/notifications/dao', async (req, res) => {
  try {
    const payload = req.body || {};
    const deviceId = payload.device_id;
    const changes = Array.isArray(payload.object_changes) ? payload.object_changes : [];
    const accessLogs = changes.filter((c) => c.object === 'access_logs' && c.type === 'inserted');
    logger.info(`[MONITOR DAO] POST recebido: device_id=${deviceId}, ${accessLogs.length} acesso(s) em object_changes`);
    const resultado = await processarNotificacaoMonitorDao(payload);
    if (resultado.processados > 0) {
      logger.info(`[MONITOR DAO] ${resultado.processados} acesso(s) registrado(s), ${resultado.ignorados} ignorado(s)`);
    } else if (resultado.erros.length > 0) {
      logger.warn(`[MONITOR DAO] Nenhum acesso registrado: ${resultado.erros.join('; ')}`);
    } else {
      logger.debug(`[MONITOR DAO] Processados: ${resultado.processados}, ignorados: ${resultado.ignorados}`);
    }
    res.status(200).json({ ok: true, ...resultado });
  } catch (error) {
    logger.error(`[MONITOR DAO] Erro ao processar notificação: ${error.message}`);
    res.status(200).json({ ok: false, error: error.message });
  }
});

module.exports = router;
