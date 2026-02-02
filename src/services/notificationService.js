/**
 * Serviço central para enviar notificações em tempo real ao painel do frontend.
 * Emite evento 'notification' no WebSocket no formato esperado pelo NotificationContext.
 */

const { getIO } = require('../websocket/wsServer');
const logger = require('../config/logger');

function buildPayload({ title, message = '', type = 'info' }) {
  return {
    id: `n-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    title,
    message,
    type,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Emite uma notificação para todos os clientes conectados.
 * @param {Object} opts - { title, message?, type? }
 */
function emitNotification({ title, message = '', type = 'info' }) {
  const io = getIO();
  if (!io) {
    logger.debug('[NOTIFICATION] WebSocket não inicializado, notificação não enviada:', title);
    return;
  }
  const payload = buildPayload({ title, message, type });
  io.emit('notification', payload);
  logger.debug(`[NOTIFICATION] Emitida: ${title} (${type})`);
}

/**
 * Emite notificação apenas para os clientes de um usuário (ex.: novo login na conta).
 * @param {number} userId - ID do usuário (UnidadeEscolar.id)
 * @param {Object} opts - { title, message?, type? }
 */
function emitNotificationToUser(userId, { title, message = '', type = 'info' }) {
  const io = getIO();
  if (!io || !userId) return;
  const payload = buildPayload({ title, message, type });
  const sockets = io.sockets.sockets;
  for (const socket of sockets.values()) {
    if (socket.userId === userId) {
      socket.emit('notification', payload);
      logger.debug(`[NOTIFICATION] Emitida para usuário ${userId}: ${title}`);
    }
  }
}

module.exports = {
  emitNotification,
  emitNotificationToUser,
};
