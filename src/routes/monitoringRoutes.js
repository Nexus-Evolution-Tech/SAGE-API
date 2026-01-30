/**
 * Rotas de monitoramento e estado
 * Disponibiliza dados do servidor para o frontend
 */

const express = require('express');
const router = express.Router();
const globalState = require('../state/globalState');
const redis = require('../config/redis');
const logger = require('../config/logger');
const db = require('../config/database');

// GET /monitoring/state - Snapshot completo do estado
router.get('/monitoring/state', async (req, res) => {
  try {
    const snapshot = globalState.getSnapshot();
    const [acessos] = await db.query(
      `SELECT a.id, a.pessoa_id, a.dispositivo_id, a.status, a.permitido, a.data_hora, p.nome AS pessoa_nome
       FROM Acesso a LEFT JOIN Pessoa p ON p.id = a.pessoa_id
       ORDER BY a.id DESC LIMIT 50`
    );
    snapshot.recentAccesses = (acessos || []).map((a) => ({
      id: a.id,
      pessoa_id: a.pessoa_id,
      dispositivo_id: a.dispositivo_id,
      status: a.status,
      permitido: a.permitido,
      data_hora: a.data_hora ? new Date(a.data_hora).toISOString() : null,
      pessoa_nome: a.pessoa_nome
    }));
    res.json({
      timestamp: new Date().toISOString(),
      data: snapshot
    });
  } catch (error) {
    logger.error(`Erro ao obter state: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// GET /monitoring/stats - Estatísticas em tempo real
router.get('/monitoring/stats', (req, res) => {
  try {
    res.json({
      timestamp: new Date().toISOString(),
      stats: globalState.getStats()
    });
  } catch (error) {
    logger.error(`Erro ao obter stats: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// GET /monitoring/devices - Status de todos os dispositivos
router.get('/monitoring/devices', (req, res) => {
  try {
    const devices = globalState.getAllDeviceStatuses();
    res.json({
      timestamp: new Date().toISOString(),
      devices
    });
  } catch (error) {
    logger.error(`Erro ao obter devices: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// GET /monitoring/sync - Sincronizações em andamento e fila
router.get('/monitoring/sync', (req, res) => {
  try {
    res.json({
      timestamp: new Date().toISOString(),
      inProgress: globalState.getSyncInProgress(),
      queue: globalState.getQueue(),
      queueSize: globalState.getQueue().length
    });
  } catch (error) {
    logger.error(`Erro ao obter sync: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// GET /monitoring/cache - Informações sobre cache
router.get('/monitoring/cache', (req, res) => {
  try {
    res.json({
      timestamp: new Date().toISOString(),
      cache: redis.getStats(),
      enabled: redis.isEnabled()
    });
  } catch (error) {
    logger.error(`Erro ao obter cache info: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// GET /monitoring/users - Usuários conectados
router.get('/monitoring/users', (req, res) => {
  try {
    res.json({
      timestamp: new Date().toISOString(),
      connectedUsers: globalState.getConnectedUsers(),
      totalConnected: globalState.getConnectedUsers().length
    });
  } catch (error) {
    logger.error(`Erro ao obter users: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// POST /monitoring/cache/clear - Limpar cache (admin only)
router.post('/monitoring/cache/clear', async (req, res) => {
  try {
    logger.warn('[ADMIN] Cache limpo manualmente');
    await redis.flush();
    res.json({
      success: true,
      message: 'Cache limpo com sucesso'
    });
  } catch (error) {
    logger.error(`Erro ao limpar cache: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// GET /monitoring/slow-queries - Queries lentas (últimas)
const slowQueries = [];

router.get('/monitoring/slow-queries', (req, res) => {
  try {
    res.json({
      timestamp: new Date().toISOString(),
      slowQueries: slowQueries.slice(-20) // Últimas 20
    });
  } catch (error) {
    logger.error(`Erro ao obter slow queries: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Helper para registrar query lenta
function trackSlowQuery(query, duration) {
  if (duration > 500) { // > 500ms
    slowQueries.push({
      query: query.substring(0, 200),
      duration,
      timestamp: new Date().toISOString()
    });
    if (slowQueries.length > 50) slowQueries.shift();
  }
}

global.trackSlowQuery = trackSlowQuery;

// GET /monitoring/sync-db - Status da fila de sincronização no banco (sync_pendente)
router.get('/monitoring/sync-db', async (req, res) => {
  try {
    const [[{ total }]] = await db.query('SELECT COUNT(*) AS total FROM sync_pendente');
    const [byOperation] = await db.query('SELECT operation, COUNT(*) AS total FROM sync_pendente GROUP BY operation');
    const [[times]] = await db.query('SELECT MIN(data_tentativa) AS oldest, MAX(data_tentativa) AS newest FROM sync_pendente');

    const [latest] = await db.query(
      `SELECT sp.id, sp.operation, sp.pessoa_id, p.nome AS pessoa, sp.dispositivo_id, d.nome AS dispositivo,
              sp.data_tentativa, sp.retry_count, sp.last_attempt, sp.error_message
         FROM sync_pendente sp
         LEFT JOIN Pessoa p ON p.id = sp.pessoa_id
         LEFT JOIN Dispositivo d ON d.id = sp.dispositivo_id
        ORDER BY sp.data_tentativa DESC
        LIMIT 50`
    );

    res.json({
      timestamp: new Date().toISOString(),
      total,
      byOperation,
      oldest: times?.oldest || null,
      newest: times?.newest || null,
      latest
    });
  } catch (error) {
    logger.error(`Erro ao obter status da fila DB: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// GET /sync-db - Rota alternativa sem prefixo /monitoring
router.get('/sync-db', async (req, res) => {
  try {
    const [[{ total }]] = await db.query('SELECT COUNT(*) AS total FROM sync_pendente');
    const [byOperation] = await db.query('SELECT operation, COUNT(*) AS total FROM sync_pendente GROUP BY operation');
    const [[times]] = await db.query('SELECT MIN(data_tentativa) AS oldest, MAX(data_tentativa) AS newest FROM sync_pendente');

    const [latest] = await db.query(
      `SELECT sp.id, sp.operation, sp.pessoa_id, p.nome AS pessoa, sp.dispositivo_id, d.nome AS dispositivo,
              sp.data_tentativa, sp.retry_count, sp.last_attempt, sp.error_message
         FROM sync_pendente sp
         LEFT JOIN Pessoa p ON p.id = sp.pessoa_id
         LEFT JOIN Dispositivo d ON d.id = sp.dispositivo_id
        ORDER BY sp.data_tentativa DESC
        LIMIT 50`
    );

    res.json({
      timestamp: new Date().toISOString(),
      total,
      byOperation,
      oldest: times?.oldest || null,
      newest: times?.newest || null,
      latest
    });
  } catch (error) {
    logger.error(`Erro ao obter status da fila DB: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
