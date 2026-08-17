const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const express = require('express');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'teste-r1-05a-jwt-secret-32-caracteres';

const execFileAsync = promisify(execFile);
const RAIZ = path.join(__dirname, '..');
const TOKEN = 'r1-05a-monitor-token';

function iniciarCallback() {
  const app = express();
  const monitorCallbackAuth = require('../src/middlewares/monitorCallbackAuth');
  app.post('/api/notifications/dao', monitorCallbackAuth, (_req, res) => res.sendStatus(204));
  const server = http.createServer(app);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function requisitar(server, headers = {}, query = '', caminho = '/api/notifications/dao') {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1', port: server.address().port,
      method: 'POST', path: `${caminho}${query}`, headers
    }, (response) => {
      const partes = [];
      response.on('data', (parte) => partes.push(parte));
      response.on('end', () => resolve({
        status: response.statusCode,
        body: Buffer.concat(partes).toString('utf8')
      }));
    });
    request.on('error', reject);
    request.end();
  });
}

describe('R1-05A — fronteira do callback e regressão do diagnóstico', () => {
  let server;
  let tokenAnterior;
  let whitelistAnterior;
  let pushAnterior;

  beforeEach(async () => {
    tokenAnterior = process.env.MONITOR_CALLBACK_TOKEN;
    whitelistAnterior = process.env.MONITOR_IP_WHITELIST;
    pushAnterior = process.env.MONITOR_USE_PUSH;
    process.env.MONITOR_CALLBACK_TOKEN = TOKEN;
    delete process.env.MONITOR_IP_WHITELIST;
    delete process.env.MONITOR_USE_PUSH;
    server = await iniciarCallback();
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (tokenAnterior === undefined) delete process.env.MONITOR_CALLBACK_TOKEN;
    else process.env.MONITOR_CALLBACK_TOKEN = tokenAnterior;
    if (whitelistAnterior === undefined) delete process.env.MONITOR_IP_WHITELIST;
    else process.env.MONITOR_IP_WHITELIST = whitelistAnterior;
    if (pushAnterior === undefined) delete process.env.MONITOR_USE_PUSH;
    else process.env.MONITOR_USE_PUSH = pushAnterior;
  });

  it.each([
    [{}, 'ausente'],
    [{ 'x-monitor-token': 'errado' }, 'errado'],
    [{}, 'query errado']
  ])('responde 401 uniformemente para token %s', async (headers, caso) => {
    const query = caso === 'query errado' ? '?token=errado' : '';
    const resposta = await requisitar(server, headers, query);
    expect(resposta.status).toBe(401);
    expect(resposta.body).toBe(JSON.stringify({ ok: false, error: 'Token inválido ou ausente' }));
  });

  it('aceita o token correto no header ou na query', async () => {
    await expect(requisitar(server, { 'x-monitor-token': TOKEN })).resolves.toMatchObject({ status: 204 });
    await expect(requisitar(server, {}, `?token=${TOKEN}`)).resolves.toMatchObject({ status: 204 });
  });

  it('faz o header vencer quando header e query divergem', async () => {
    await expect(requisitar(server, { 'x-monitor-token': 'errado' }, `?token=${TOKEN}`))
      .resolves.toMatchObject({ status: 401 });
    await expect(requisitar(server, { 'x-monitor-token': TOKEN }, '?token=errado'))
      .resolves.toMatchObject({ status: 204 });
  });

  it('usa o socket como origem, ignorando x-forwarded-for', async () => {
    process.env.MONITOR_IP_WHITELIST = '203.0.113.10';
    const resposta = await requisitar(server, { 'x-monitor-token': TOKEN, 'x-forwarded-for': '203.0.113.10' });
    expect(resposta.status).toBe(403);
  });

  it('aceita ponta a ponta a URL que deviceService grava na catraca', async () => {
    process.env.MONITOR_USE_PUSH = 'true';
    const axiosInstance = require('../src/config/axios');
    const deviceService = require('../src/services/deviceService');
    const post = vi.spyOn(axiosInstance, 'post').mockImplementation(async (url) => (
      url.includes('/login.fcgi') ? { data: { session: 'sessao-teste' } } : { data: {} }
    ));

    try {
      await expect(deviceService.configurarMonitorNaCatraca({
        id: 109, nome: 'Catraca R1-05A', endereco: '192.0.2.10', porta: 80,
        usuario: 'admin', senha: 'senha-teste'
      })).resolves.toMatchObject({ ok: true });
      const configuracao = post.mock.calls.find(([url]) => url.includes('set_configuration.fcgi'))[1].monitor;
      expect(configuracao.path).toBe(`api/notifications/dao?token=${encodeURIComponent(TOKEN)}`);

      const resposta = await requisitar(server, {}, '', `/${configuracao.path}`);
      expect(resposta.status).toBe(204);
    } finally {
      post.mockRestore();
    }
  });
});

describe('R1-05A — fail-closed no boot e guard do diagnóstico', () => {
  it('não inicia sem MONITOR_CALLBACK_TOKEN', async () => {
    const env = { ...process.env, NODE_ENV: 'test', SAGE_CONFIG_FILE: path.join(os.tmpdir(), `sage-missing-${process.pid}.env`) };
    delete env.MONITOR_CALLBACK_TOKEN;
    const resultado = await execFileAsync(process.execPath, ['-e', "require('./src/app')"], {
      cwd: RAIZ, env
    }).then(() => null, (error) => error);
    expect(resultado).toBeTruthy();
    expect(resultado.code).not.toBe(0);
    expect(`${resultado.stdout || ''}${resultado.stderr || ''}`).toContain('MONITOR_CALLBACK_TOKEN');
  });

  it('não inicia em push sem MONITOR_IP_WHITELIST', async () => {
    const env = {
      ...process.env,
      NODE_ENV: 'test',
      MONITOR_CALLBACK_TOKEN: TOKEN,
      MONITOR_USE_PUSH: 'true',
      SAGE_CONFIG_FILE: path.join(os.tmpdir(), `sage-push-missing-${process.pid}.env`)
    };
    delete env.MONITOR_IP_WHITELIST;
    const resultado = await execFileAsync(process.execPath, ['-e', "require('./src/app')"], {
      cwd: RAIZ, env
    }).then(() => null, (error) => error);
    expect(resultado).toBeTruthy();
    expect(resultado.code).not.toBe(0);
    expect(`${resultado.stdout || ''}${resultado.stderr || ''}`).toContain('MONITOR_IP_WHITELIST');
  });

  it('mantém diagnosticoAcessos atrás de exige e sem DIAGNOSTICO_KEY', () => {
    const authz = require('../src/middlewares/autorizacao');
    const resultado = authz.inspecionarArvoreExpress(require('../src/app'));
    const rota = resultado.rotas.find((item) => item.caminho === '/dispositivos/:id/diagnostico-acessos');
    expect(resultado.falhas).toEqual([]);
    expect(rota?.declaracoes).toEqual([{ tipo: 'papel', papel: 'ADMINISTRADOR' }]);
    expect(resultado.rotas.some((item) => item.caminho === '/diagnostico-acessos/:id')).toBe(false);

    const arquivos = [];
    function visitar(diretorio) {
      for (const entrada of fs.readdirSync(diretorio, { withFileTypes: true })) {
        const nome = path.join(diretorio, entrada.name);
        if (entrada.isDirectory()) visitar(nome);
        else if (entrada.isFile() && nome.endsWith('.js')) arquivos.push(nome);
      }
    }
    visitar(path.join(RAIZ, 'src'));
    expect(arquivos.some((arquivo) => fs.readFileSync(arquivo, 'utf8').includes('DIAGNOSTICO_KEY'))).toBe(false);
  });
});
