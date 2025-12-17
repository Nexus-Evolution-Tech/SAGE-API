/**
 * WebSocket Server com Socket.io
 * Gerencia conexões em tempo real e emissão de eventos
 */

const { Server } = require('socket.io');
const logger = require('../config/logger');

let io = null;

/**
 * Inicializar Socket.io anexado ao servidor HTTP
 */
function initWebSocket(server) {
  io = new Server(server, {
    cors: {
      origin: (process.env.CORS_ORIGINS || '').split(',').map(o => o.trim()),
      methods: ['GET', 'POST'],
      credentials: true
    },
    transports: ['websocket', 'polling'],
    pingInterval: parseInt(process.env.WS_PING_INTERVAL || '30000'),
    pingTimeout: parseInt(process.env.WS_PING_TIMEOUT || '60000'),
    maxHttpBufferSize: 1e7 // 10MB
  });

  // Middleware de autenticação (opcional)
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    
    if (!token) {
      // Permitir conexões sem token por enquanto (para desenvolvimento)
      socket.userId = null;
      return next();
    }

    try {
      const { verificarToken } = require('../utils/jwt');
      const payload = verificarToken(token);
      
      if (payload) {
        socket.userId = payload.id;
        socket.userRole = payload.role;
        return next();
      } else {
        return next(new Error('Token inválido'));
      }
    } catch (error) {
      logger.debug(`WS auth error: ${error.message}`);
      return next(new Error('Autenticação falhou'));
    }
  });

  // Connection handler
  io.on('connection', (socket) => {
    logger.info(`[WS] Usuário conectado: ${socket.id} (userId: ${socket.userId})`);

    // Namespaces de eventos
    socket.on('subscribe:acessos', () => {
      socket.join('acessos');
      logger.debug(`[WS] ${socket.id} inscrito em 'acessos'`);
    });

    socket.on('subscribe:dispositivos', () => {
      socket.join('dispositivos');
      logger.debug(`[WS] ${socket.id} inscrito em 'dispositivos'`);
    });

    socket.on('subscribe:sync', () => {
      socket.join('sync');
      logger.debug(`[WS] ${socket.id} inscrito em 'sync'`);
    });

    socket.on('subscribe:stats', () => {
      socket.join('stats');
      logger.debug(`[WS] ${socket.id} inscrito em 'stats'`);
    });

    // Heartbeat para manter conexão viva
    socket.on('ping', () => {
      socket.emit('pong');
    });

    // Disconnect
    socket.on('disconnect', (reason) => {
      logger.info(`[WS] Usuário desconectado: ${socket.id} (razão: ${reason})`);
    });

    socket.on('error', (error) => {
      logger.error(`[WS] Erro na conexão ${socket.id}: ${error}`);
    });
  });

  logger.info('✓ WebSocket (Socket.io) inicializado');
  return io;
}

/**
 * Emit evento para todos os clientes em uma room
 */
function emitToRoom(room, event, data) {
  if (io) {
    io.to(room).emit(event, {
      timestamp: new Date().toISOString(),
      data
    });
    logger.debug(`[WS] Emitido '${event}' para room '${room}'`);
  }
}

/**
 * Emit evento para todos os clientes
 */
function emitToAll(event, data) {
  if (io) {
    io.emit(event, {
      timestamp: new Date().toISOString(),
      data
    });
    logger.debug(`[WS] Emitido '${event}' para todos`);
  }
}

/**
 * Emit para usuário específico (se conectado)
 */
function emitToUser(userId, event, data) {
  if (io) {
    const sockets = io.sockets.sockets;
    for (const [socketId, socket] of sockets) {
      if (socket.userId === userId) {
        socket.emit(event, {
          timestamp: new Date().toISOString(),
          data
        });
        logger.debug(`[WS] Emitido '${event}' para usuário ${userId}`);
      }
    }
  }
}

/**
 * Obter número de clientes conectados
 */
function getConnectionCount() {
  if (!io) return 0;
  return io.engine.clientsCount;
}

/**
 * Obter clientes em uma room
 */
function getRoomClients(room) {
  if (!io) return [];
  const clients = io.sockets.adapter.rooms.get(room);
  return clients ? Array.from(clients) : [];
}

module.exports = {
  initWebSocket,
  emitToRoom,
  emitToAll,
  emitToUser,
  getConnectionCount,
  getRoomClients,
  getIO: () => io
};
