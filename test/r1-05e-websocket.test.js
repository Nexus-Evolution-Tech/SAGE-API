const fs = require('fs');
const http = require('http');
const path = require('path');
const jwt = require('jsonwebtoken');
const { io: criarCliente } = require('socket.io-client');
const JWT_SECRET = process.env.JWT_SECRET || 'teste-r1-05e-websocket-32-caracteres';
process.env.JWT_SECRET = JWT_SECRET;
const { gerarToken } = require('../src/utils/jwt');
const websocket = require('../src/websocket/wsServer');
const { emitNotification } = require('../src/services/notificationService');
function token(papel, opcoes = {}) {
  return jwt.sign({ usuario_id: opcoes.usuario_id || 7, papel, emitido_em: new Date().toISOString() }, JWT_SECRET, {
    noTimestamp: true,
    expiresIn: opcoes.expiresIn || '1h'
  });
}
function conectar(url, auth) {
  return new Promise((resolve, reject) => {
    const cliente = criarCliente(url, { auth, transports: ['websocket'], reconnection: false });
    cliente.once('connect', () => resolve(cliente));
    cliente.once('connect_error', reject);
  });
}
function esperarEvento(cliente, evento) {
  return new Promise((resolve) => cliente.once(evento, resolve));
}
async function esperarSala(sala, socketId, deveConter = true) {
  const limite = Date.now() + 2000;
  while (Date.now() < limite) {
    const contem = websocket.getRoomClients(sala).includes(socketId);
    if (contem === deveConter) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`estado inesperado da sala ${sala}`);
}
describe('R1-05E — autenticação e autorização do WebSocket', () => {
  let server;
  let url;
  let clientes = [];
  beforeEach(async () => {
    server = http.createServer();
    clientes = [];
    websocket.initWebSocket(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${server.address().port}`;
  });
  afterEach(async () => {
    clientes.forEach((cliente) => cliente.disconnect());
    const io = websocket.getIO();
    if (io) await new Promise((resolve) => io.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  });
  it.each([
    ['sem token', {}],
    ['token vazio', { token: '' }],
    ['token expirado', { token: token('SECRETARIA', { expiresIn: -1 }) }],
    ['token inválido', { token: 'token.invalido' }]
  ])('recusa handshake %s', async (_descricao, auth) => {
    await expect(conectar(url, auth)).rejects.toThrow();
  });
  it('usa os claims reais e autoriza SECRETARIA nas salas de negócio, mas recusa sync', async () => {
    const cliente = await conectar(url, { token: token('SECRETARIA') });
    clientes.push(cliente);
    for (const sala of ['acessos', 'dispositivos', 'stats']) {
      cliente.emit(`subscribe:${sala}`);
      await esperarSala(sala, cliente.id);
    }
    const recusa = esperarEvento(cliente, 'subscribe:error');
    cliente.emit('subscribe:sync');
    await expect(recusa).resolves.toMatchObject({ sala: 'sync', codigo: 'WS_SALA_NAO_AUTORIZADA' });
    await esperarSala('sync', cliente.id, false);
  });
  it('autoriza ADMINISTRADOR nas quatro salas', async () => {
    const cliente = await conectar(url, { token: token('ADMINISTRADOR') });
    clientes.push(cliente);
    for (const sala of ['acessos', 'dispositivos', 'sync', 'stats']) {
      cliente.emit(`subscribe:${sala}`);
      await esperarSala(sala, cliente.id);
    }
  });
  it('projeta os payloads de acesso e estatísticas sem campos proibidos', async () => {
    const cliente = await conectar(url, { token: gerarToken({ usuario_id: 7, papel: 'SECRETARIA', emitido_em: new Date().toISOString() }) });
    clientes.push(cliente);
    cliente.emit('subscribe:acessos');
    cliente.emit('subscribe:stats');
    await esperarSala('acessos', cliente.id);
    await esperarSala('stats', cliente.id);
    const acesso = esperarEvento(cliente, 'acesso:novo');
    websocket.emitToRoom('acessos', 'acesso:novo', {
      pessoa_id: 11, pessoa_nome: 'Pessoa sintética', dispositivo_id: 3, status: 'ENTRADA', permitido: true,
      data_hora: '2026-08-17T12:00:00.000Z', metodo_auth: 'QR', senha: 'não pode sair'
    });
    const acessoRecebido = await acesso;
    expect(Object.keys(acessoRecebido.data).sort()).toEqual(['data_hora', 'dispositivo_id', 'permitido', 'pessoa_id', 'pessoa_nome', 'status']);
    const stats = esperarEvento(cliente, 'stats:update');
    websocket.emitToRoom('stats', 'stats:update', {
      acessos_hoje: 1, acessos_negados_hoje: 2, pessoas_ativas: 3, catracas_online: 4, catracas_offline: 5,
      usuariosConectados: 99, filaSincronizacao: 88, sincronizacoesEmAndamento: 77, uptime: 66
    });
    const statsRecebido = await stats;
    expect(Object.keys(statsRecebido.data).sort()).toEqual(['acessos_hoje', 'acessos_negados_hoje', 'catracas_offline', 'catracas_online', 'pessoas_ativas']);
    const notification = esperarEvento(cliente, 'notification');
    emitNotification({ title: 'Atualização concluída', message: 'Operação sintética concluída.' });
    const notificationRecebida = await notification;
    expect(notificationRecebida).toMatchObject({ title: 'Atualização concluída', message: 'Operação sintética concluída.' });
    expect(notificationRecebida).not.toHaveProperty('pessoa_id');
    expect(notificationRecebida).not.toHaveProperty('pessoa_nome');
  });
  it('mantém a barreira: handlers subscribe não fazem join direto', () => {
    const fonte = fs.readFileSync(path.join(__dirname, '..', 'src', 'websocket', 'wsServer.js'), 'utf8');
    expect((fonte.match(/socket\.join\s*\(/g) || [])).toHaveLength(1);
    expect(fonte).toContain('if (!autorizarSala(socket, sala)) return false;');
    for (const sala of ['acessos', 'dispositivos', 'sync', 'stats']) {
      const handler = new RegExp(`socket\\.on\\('subscribe:${sala}'[\\s\\S]*?\\);`);
      expect(fonte.match(handler)?.[0]).not.toMatch(/socket\.join\s*\(/);
      expect(fonte.match(handler)?.[0]).toContain(`entrarNaSalaAutorizada(socket, '${sala}')`);
    }
  });
});
