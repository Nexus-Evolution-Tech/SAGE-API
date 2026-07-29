const fs = require('fs/promises');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const RAIZ = path.join(__dirname, '..');
const APP = path.join(RAIZ, 'src', 'app.js');
const WEB_CONFIG = path.join(RAIZ, 'src', 'config', 'web.js');

function requisitar(porta, rota, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port: porta, path: rota, headers }, (response) => {
      const partes = [];
      response.on('data', (parte) => partes.push(parte));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(partes).toString('utf8')
      }));
    });
    request.on('error', reject);
    request.end();
  });
}

function iniciarApp(env) {
  const script = `
    const http = require('http');
    const app = require(${JSON.stringify(APP)});
    const { initWebSocket } = require(${JSON.stringify(path.join(RAIZ, 'src', 'websocket', 'wsServer.js'))});
    const server = http.createServer(app);
    initWebSocket(server);
    server.listen(0, '127.0.0.1', () => process.send({ porta: server.address().port }));
    process.on('message', (message) => {
      if (message === 'encerrar') server.close(() => process.exit(0));
    });
  `;

  return new Promise((resolve, reject) => {
    const processo = spawn(process.execPath, ['-e', script], {
      cwd: RAIZ,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc']
    });
    let stderr = '';
    processo.stderr.on('data', (parte) => { stderr += parte; });
    processo.once('message', ({ porta }) => resolve({ processo, porta }));
    processo.once('exit', (codigo) => reject(new Error(`App encerrou antes de iniciar (${codigo}): ${stderr}`)));
    processo.once('error', reject);
  });
}

function encerrarApp(processo) {
  return new Promise((resolve) => {
    processo.once('exit', resolve);
    processo.send('encerrar');
  });
}

describe('F8.3b — painel servido pela API', () => {
  let base;
  let webDir;

  beforeEach(async () => {
    base = await fs.mkdtemp(path.join(os.tmpdir(), 'sage-web-'));
    webDir = path.join(base, 'build web');
    await fs.mkdir(webDir);
    await fs.writeFile(path.join(webDir, 'index.html'), '<!doctype html><title>SAGE painel</title>');
    await fs.writeFile(path.join(webDir, 'app.js'), 'window.sage = true;');
  });

  afterEach(async () => {
    await fs.rm(base, { recursive: true, force: true });
  });

  it('serve apenas navegação HTML das rotas SPA, preservando API e Socket.IO', async () => {
    const { processo, porta } = await iniciarApp({
      SAGE_WEB_DIR: webDir,
      NODE_ENV: 'test',
      DB_HOST: '127.0.0.1',
      DB_PORT: '1',
      DB_USER: 'indisponivel',
      DB_PASSWORD: 'indisponivel',
      DB_NAME: 'indisponivel'
    });
    try {
      const [raiz, asset, turmasHtml, turmasJson, turmasSemAccept, turmasWildcard, profunda, health, ready, docs, apiProtegida, apiAusente, endpointApiAusente, socket, uploadAusente] = await Promise.all([
        requisitar(porta, '/', { accept: 'text/html' }),
        requisitar(porta, '/app.js'),
        requisitar(porta, '/turmas', { accept: 'text/html' }),
        requisitar(porta, '/turmas', { accept: 'application/json' }),
        requisitar(porta, '/turmas'),
        requisitar(porta, '/turmas', { accept: '*/*' }),
        requisitar(porta, '/tabelas/alunos/42', { accept: 'text/html' }),
        requisitar(porta, '/health'),
        requisitar(porta, '/ready'),
        requisitar(porta, '/docs/'),
        requisitar(porta, '/materias'),
        requisitar(porta, '/api/nao-existe'),
        requisitar(porta, '/endpoint-api-inexistente', { accept: 'text/html' }),
        requisitar(porta, '/socket.io/?EIO=4&transport=polling'),
        requisitar(porta, '/uploads/nao-existe')
      ]);

      expect(raiz.status).toBe(200);
      expect(raiz.body).toContain('SAGE painel');
      expect(asset.status).toBe(200);
      expect(asset.body).toBe('window.sage = true;');
      expect(turmasHtml).toMatchObject({ status: 200, body: expect.stringContaining('SAGE painel') });
      expect(turmasJson).toMatchObject({ status: 401, body: expect.stringContaining('Token não fornecido') });
      expect(turmasSemAccept).toMatchObject({ status: 401, body: expect.stringContaining('Token não fornecido') });
      expect(turmasWildcard).toMatchObject({ status: 401, body: expect.stringContaining('Token não fornecido') });
      expect(profunda.status).toBe(200);
      expect(profunda.body).toContain('SAGE painel');
      expect(health.status).toBe(200);
      expect(health.headers['content-type']).toContain('application/json');
      expect(ready).toMatchObject({
        status: 503,
        body: expect.stringContaining('database_unavailable')
      });
      expect(docs.status).toBe(200);
      expect(docs.body).not.toContain('SAGE painel');
      expect(apiProtegida).toMatchObject({ status: 401, body: expect.stringContaining('Token não fornecido') });
      expect(apiAusente).toMatchObject({ status: 404, body: expect.stringContaining('Rota não encontrada') });
      expect(endpointApiAusente).toMatchObject({ status: 404, body: expect.stringContaining('Rota não encontrada') });
      expect(socket).toMatchObject({ status: 200, body: expect.stringContaining('"sid"') });
      expect(uploadAusente).toMatchObject({ status: 404, body: expect.stringContaining('Rota não encontrada') });
    } finally {
      await encerrarApp(processo);
    }
  });

  it('não oferece fallback SPA quando o build configurado está ausente', async () => {
    const ausente = path.join(base, 'build ausente');
    const { processo, porta } = await iniciarApp({ SAGE_WEB_DIR: ausente, NODE_ENV: 'test' });
    try {
      const resposta = await requisitar(porta, '/painel');
      expect(resposta).toMatchObject({ status: 404, body: expect.stringContaining('Rota não encontrada') });
    } finally {
      await encerrarApp(processo);
    }
  });

  it('rejeita SAGE_WEB_DIR relativo e mantém o padrão dentro do release', async () => {
    const relativo = { ...process.env, SAGE_WEB_DIR: 'web-relativo' };
    await expect(execFileAsync(process.execPath, ['-e', `require(${JSON.stringify(WEB_CONFIG)})`], { env: relativo }))
      .rejects.toMatchObject({ code: 1 });

    const padrao = { ...process.env };
    delete padrao.SAGE_WEB_DIR;
    const { stdout } = await execFileAsync(
      process.execPath,
      ['-e', `process.stdout.write(require(${JSON.stringify(WEB_CONFIG)}).webDir)`],
      { env: padrao }
    );
    expect(stdout).toBe(path.join(path.dirname(RAIZ), 'web'));
  });
});
