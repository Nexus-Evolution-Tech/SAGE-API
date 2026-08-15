const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const APP = path.join(__dirname, '..', 'src', 'app.js');

function requisitar(porta, caminho, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: porta, path: caminho, headers, method }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
}

async function esperarArquivo(caminho, predicado) {
  const limite = Date.now() + 5000;
  while (Date.now() < limite) {
    if (fs.existsSync(caminho)) {
      const conteudo = fs.readFileSync(caminho, 'utf8');
      if (predicado(conteudo)) return conteudo;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('log não foi gravado no prazo');
}

describe('R1-04C — redação no transporte e log HTTP', () => {
  it('grava texto livre redigido no arquivo real em info, error e debug', async () => {
    const diretorio = fs.mkdtempSync(path.join(os.tmpdir(), 'sage-r1-04c-'));
    const logLevelAnterior = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = 'debug';
    const { criarLogger } = require('../src/config/logger');
    const logger = criarLogger({ diretorio });
    logger.transports[0].silent = true;

    try {
      logger.info('info CPF 398.123.456-78 email ana@escola.test telefone (11) 98765-4321');
      logger.error('error CPF 39812345678 email erro@escola.test telefone 11987654321');
      logger.debug('debug CPF 111.222.333-44 email debug@escola.test telefone 11911112222');
      logger.info('url https://sage.test/callback?token=abc123&key=chave&senha=senha-real&password=pass-real&secret=segredo');
      const conteudo = await esperarArquivo(path.join(diretorio, 'api.log'), (texto) => texto.split('\n').length >= 4);

      expect(conteudo).not.toMatch(/398\.123\.456-78|39812345678|ana@escola\.test|erro@escola\.test|debug@escola\.test|98765-4321|11987654321|11911112222|abc123|chave|senha-real|pass-real|segredo/);
      expect(conteudo).toContain('CPF_REDIGIDO');
      expect(conteudo).toContain('EMAIL_REDIGIDO');
      expect(conteudo).toContain('TELEFONE_REDIGIDO');
    } finally {
      logger.close();
      if (logLevelAnterior === undefined) delete process.env.LOG_LEVEL;
      else process.env.LOG_LEVEL = logLevelAnterior;
      fs.rmSync(diretorio, { recursive: true, force: true });
    }
  });

  it('registra método e rota parametrizada sem query, token ou IP no arquivo', async () => {
    const diretorio = fs.mkdtempSync(path.join(os.tmpdir(), 'sage-r1-04c-http-'));
    const script = `
      const http = require('http');
      const app = require(${JSON.stringify(APP)});
      const server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => process.send(server.address().port));
      process.on('message', (msg) => { if (msg === 'stop') server.close(() => process.exit(0)); });
    `;
    const child = spawn(process.execPath, ['-e', script], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'http', MONITOR_CALLBACK_TOKEN: 'monitor-secret', SAGE_DATA_DIR: diretorio },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc']
    });

    try {
      const porta = await new Promise((resolve, reject) => {
        child.once('message', resolve);
        child.once('error', reject);
        child.once('exit', (codigo) => reject(new Error(`app encerrou (${codigo})`)));
      });
      expect(await requisitar(porta, '/pessoas/17?token=abc123', { 'x-forwarded-for': '192.0.2.10' })).toBe(401);
      expect(await requisitar(porta, '/api/notifications/dao?token=abc123', { 'x-forwarded-for': '192.0.2.10' }, 'POST')).toBe(401);
      const conteudo = await esperarArquivo(path.join(diretorio, 'logs', 'api', 'api.log'), (texto) => texto.includes('401'));

      expect(conteudo).toMatch(/GET .*:id.*401/);
      expect(conteudo).not.toContain('/pessoas/17');
      expect(conteudo).not.toContain('token=abc123');
      expect(conteudo).not.toContain('192.0.2.10');
      expect(conteudo).not.toContain('127.0.0.1');
    } finally {
      if (child.connected) child.send('stop');
      await new Promise((resolve) => child.once('exit', resolve));
      fs.rmSync(diretorio, { recursive: true, force: true });
    }
  });
});
