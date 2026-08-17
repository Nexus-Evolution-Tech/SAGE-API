/**
 * WebSocket Server com Socket.io
 * Gerencia conexões em tempo real e emissão de eventos
 */

const { Server } = require('socket.io');
const logger = require('../config/logger');
const { verificarToken } = require('../utils/jwt');

let io = null;

const PAPEIS_PERMITIDOS = {
  acessos: new Set(['ADMINISTRADOR', 'SECRETARIA']),
  dispositivos: new Set(['ADMINISTRADOR', 'SECRETARIA']),
  sync: new Set(['ADMINISTRADOR']),
  stats: new Set(['ADMINISTRADOR', 'SECRETARIA'])
};

const CAMPOS_EVENTOS = {
  'acesso:novo': ['pessoa_id', 'pessoa_nome', 'dispositivo_id', 'status', 'permitido', 'data_hora'],
  'stats:update': ['acessos_hoje', 'acessos_negados_hoje', 'pessoas_ativas', 'catracas_online', 'catracas_offline']
};

function projetarEvento(event, data) {
  const campos = CAMPOS_EVENTOS[event];
  if (!campos || !data || typeof data !== 'object') return data;
  return Object.fromEntries(campos.filter((campo) => Object.hasOwn(data, campo)).map((campo) => [campo, data[campo]]));
}

function autorizarSala(socket, sala) {
  const papeis = PAPEIS_PERMITIDOS[sala];
  if (papeis?.has(socket.userRole)) return true;

  socket.emit('subscribe:error', {
    sala,
    codigo: 'WS_SALA_NAO_AUTORIZADA'
  });
  return false;
}

function entrarNaSalaAutorizada(socket, sala) {
  if (!autorizarSala(socket, sala)) return false;
  socket.join(sala);
  logger.debug(`[WS] ${socket.id} inscrito em '${sala}'`);
  return true;
}

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

  // O canal carrega presença e estado operacional; sem identidade ele não existe.
  io.use((socket, next) => {
    const token = socket.handshake?.auth?.token;
    if (typeof token !== 'string' || token.trim() === '') return next(new Error('Autenticação obrigatória'));

    const payload = verificarToken(token);
    if (!payload) return next(new Error('Token inválido'));

    socket.userId = payload.usuario_id;
    socket.userRole = payload.papel;
    return next();
  });

  // Connection handler
  io.on('connection', (socket) => {
    logger.info(`[WS] Usuário conectado: ${socket.id} (userId: ${socket.userId})`);

    // Namespaces de eventos
    socket.on('subscribe:acessos', () => entrarNaSalaAutorizada(socket, 'acessos'));
    socket.on('subscribe:dispositivos', () => entrarNaSalaAutorizada(socket, 'dispositivos'));
    socket.on('subscribe:sync', () => entrarNaSalaAutorizada(socket, 'sync'));
    socket.on('subscribe:stats', () => entrarNaSalaAutorizada(socket, 'stats'));

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
      data: projetarEvento(event, data)
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
