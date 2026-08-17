const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');
const { io: criarCliente } = require('socket.io-client');

const SAGE_DATA_DIR = path.resolve(os.tmpdir(), `sage-r1-05f-websocket-proxy-${process.pid}`);
fs.rmSync(SAGE_DATA_DIR, { recursive: true, force: true });
process.env.SAGE_DATA_DIR = SAGE_DATA_DIR;
const JWT_SECRET = process.env.JWT_SECRET || 'teste-r1-05f-websocket-32-caracteres';
process.env.JWT_SECRET = JWT_SECRET;
const websocket = require('../src/websocket/wsServer');

afterAll(() => fs.rmSync(SAGE_DATA_DIR, { recursive: true, force: true }));

function token(papel) {
  return jwt.sign({ usuario_id: 119, papel, emitido_em: new Date().toISOString() }, JWT_SECRET, {
    noTimestamp: true,
    expiresIn: '1h'
  });
}

function aguardarServidor(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function fecharServidor(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => server.close((erro) => erro && erro.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(erro) : resolve()));
}

async function iniciarApi() {
  const server = http.createServer();
  const io = websocket.initWebSocket(server);
  await aguardarServidor(server);
  return { server, io, alvo: { host: '127.0.0.1', port: server.address().port } };
}

async function pararApi(api) {
  api.io.engine.close();
  await new Promise((resolve) => setTimeout(resolve, 10));
  await fecharServidor(api.server);
}

function reescrever(caminho) {
  const url = new URL(caminho, 'http://proxy.local');
  url.pathname = url.pathname.replace(/^\/backend/, '') || '/';
  return `${url.pathname}${url.search}`;
}

async function iniciarProxy(alvo) {
  const tuneis = new Set();
  const proxy = http.createServer((req, res) => {
    const destino = alvo();
    const requisicao = http.request({ ...destino, method: req.method, path: reescrever(req.url), headers: req.headers }, (resposta) => {
      res.writeHead(resposta.statusCode, resposta.headers);
      resposta.pipe(res);
    });
    requisicao.on('error', () => res.destroy());
    req.pipe(requisicao);
  });
  proxy.on('upgrade', (req, cliente, head) => {
    const destino = alvo();
    const upstream = net.connect(destino.port, destino.host, () => {
      const linhas = [`${req.method} ${reescrever(req.url)} HTTP/${req.httpVersion}`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) linhas.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      upstream.write(`${linhas.join('\r\n')}\r\n\r\n`);
      if (head.length) upstream.write(head);
      cliente.pipe(upstream).pipe(cliente);
    });
    const tunel = { cliente, upstream };
    tuneis.add(tunel);
    const falhar = () => { tuneis.delete(tunel); cliente.destroy(); upstream.destroy(); };
    cliente.on('error', falhar);
    upstream.on('error', falhar);
  });
  await aguardarServidor(proxy);
  proxy.destruirTuneis = () => tuneis.forEach(({ cliente, upstream }) => { cliente.destroy(); upstream.destroy(); });
  return proxy;
}

function conectar(url, opcoes) {
  const cliente = criarCliente(url, opcoes);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cliente.disconnect(); reject(new Error('timeout conectando Socket.IO')); }, 2500);
    const erroConexao = (erro) => { clearTimeout(timer); cliente.disconnect(); reject(erro); };
    cliente.once('connect', () => { clearTimeout(timer); cliente.off('connect_error', erroConexao); resolve(cliente); });
    cliente.once('connect_error', erroConexao);
  });
}

function evento(cliente, nome, timeout = 2500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout aguardando ${nome}`)), timeout);
    cliente.once(nome, (valor) => { clearTimeout(timer); resolve(valor); });
  });
}

async function esperar(condicao, timeout = 2500) {
  const limite = Date.now() + timeout;
  while (Date.now() < limite) {
    if (condicao()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('condição não alcançada a tempo');
}

async function esperarSala(sala, socketId, presente = true) {
  await esperar(() => websocket.getRoomClients(sala).includes(socketId) === presente);
}

const opcoesProxy = (pathSocket, reconnection = false) => ({
  path: pathSocket,
  auth: { token: token('SECRETARIA') },
  transports: ['websocket'],
  reconnection,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 25,
  reconnectionDelayMax: 100,
  timeout: 150
});

describe('R1-05F — contrato Socket.IO atrás de proxy HTTP', () => {
  let api;
  let proxy;
  let clientes;

  beforeEach(async () => {
    api = await iniciarApi();
    proxy = await iniciarProxy(() => api.alvo);
    clientes = [];
  });

  afterEach(async () => {
    clientes.forEach((cliente) => cliente.disconnect());
    await fecharServidor(proxy);
    if (api) await pararApi(api);
  });

  it('falha de forma visível quando o path não é o contrato', async () => {
    await expect(conectar(`http://127.0.0.1:${proxy.address().port}`, opcoesProxy('/backend/path-errado/socket.io')))
      .rejects.toMatchObject({ message: expect.any(String) });
  });

  it('autentica SECRETARIA, assina acessos, projeta o evento e recusa sync e evento fora da allowlist', async () => {
    const cliente = await conectar(`http://127.0.0.1:${proxy.address().port}`, opcoesProxy('/backend/socket.io'));
    clientes.push(cliente);
    cliente.emit('subscribe:acessos');
    await esperarSala('acessos', cliente.id);

    const recebido = evento(cliente, 'acesso:novo');
    websocket.emitToRoom('acessos', 'acesso:novo', { pessoa_id: 19, dispositivo_id: 2, status: 'ENTRADA', permitido: true, data_hora: '2026-08-17T12:00:00.000Z', segredo: 'não publicar' });
    await expect(recebido).resolves.toMatchObject({ data: { pessoa_id: 19, dispositivo_id: 2, status: 'ENTRADA' } });

    const recusa = evento(cliente, 'subscribe:error');
    cliente.emit('subscribe:sync');
    await expect(recusa).resolves.toMatchObject({ sala: 'sync', codigo: 'WS_SALA_NAO_AUTORIZADA' });
    cliente.emit('join', 'sala-fora-da-allowlist');
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(websocket.getRoomClients('sala-fora-da-allowlist')).not.toContain(cliente.id);
  });

  it('mostra erro durante a queda e reconecta sem reload quando a API retorna', async () => {
    const cliente = await conectar(`http://127.0.0.1:${proxy.address().port}`, opcoesProxy('/backend/socket.io', true));
    clientes.push(cliente);
    const erros = [];
    const estados = [];
    cliente.on('connect_error', (erro) => erros.push(erro));
    cliente.on('disconnect', (motivo) => estados.push(`disconnect:${motivo}`));
    cliente.io.on('reconnect_attempt', (tentativa) => estados.push(`attempt:${tentativa}`));
    cliente.io.on('reconnect_error', (erro) => estados.push(`error:${erro.message}`));
    const reconectou = evento(cliente, 'connect', 5000).catch((erro) => { erro.message += ` (${estados.join(',')})`; throw erro; });
    proxy.destruirTuneis();
    await pararApi(api);
    await esperar(() => erros.length > 0, 3000);
    api = await iniciarApi();
    await reconectou;
    cliente.emit('subscribe:acessos');
    await esperarSala('acessos', cliente.id);
    const recebido = evento(cliente, 'acesso:novo');
    websocket.emitToRoom('acessos', 'acesso:novo', { pessoa_id: 20, dispositivo_id: 2, status: 'SAIDA', permitido: true, data_hora: '2026-08-17T12:01:00.000Z' });
    await expect(recebido).resolves.toMatchObject({ data: { pessoa_id: 20 } });
  });
});

describe('R1-05F — contrato mínimo do nginx', () => {
  it('mantém location, rewrite e cabeçalho de upgrade', () => {
    const raizFrontend = process.env.FRONTEND_PATH
      ? path.resolve(process.env.FRONTEND_PATH)
      : path.resolve(__dirname, '..', '..', 'SAGE');
    const nginx = fs.readFileSync(path.join(raizFrontend, 'nginx.conf'), 'utf8');
    expect(nginx).toMatch(/location\s+\/backend\/socket\.io\//);
    expect(nginx).toMatch(/rewrite\s+\^\/backend\(\.\*\)\$\s+\$1\s+break/);
    expect(nginx).toMatch(/proxy_set_header\s+Upgrade\s+\$http_upgrade/);
  });
});
