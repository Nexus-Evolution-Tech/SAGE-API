const crypto = require('crypto');
const http = require('http');
const path = require('path');
const mysql = require('mysql2/promise');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { configConexao, temBancoDisponivel } = require('./helpers/banco');

const execFileAsync = promisify(execFile);
const database = `sage_verif_onboarding_http_${process.pid}`;
process.env.DB_NAME = database;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const app = require('../src/app');

function request(port, method, requestPath, body) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({
      hostname: '127.0.0.1', port, method, path: requestPath,
      headers: {
        Origin: 'http://localhost:3000', Accept: 'application/json',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {})
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        latencyMs: Date.now() - started,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const hasDatabase = await temBancoDisponivel();
const describeDatabase = hasDatabase ? describe : describe.skip;

describeDatabase('fluxo HTTP completo do primeiro acesso', () => {
  let server;
  let port;

  beforeAll(async () => {
    const cfg = configConexao();
    await execFileAsync(process.execPath, [path.join(__dirname, '..', 'scripts', 'setup-database.js')], {
      cwd: path.join(__dirname, '..'), timeout: 120000,
      env: {
        ...process.env,
        DB_HOST: cfg.host, DB_PORT: String(cfg.port), DB_USER: cfg.user,
        DB_PASSWORD: cfg.password, DB_NAME: database,
        SAGE_ALLOW_FIRST_RUN_ONBOARDING: 'true'
      }
    });
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  }, 120000);

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    const admin = await mysql.createConnection(configConexao());
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin.end();
  });

  it('inicializa uma vez, lista a unidade e autentica', async () => {
    const statusBefore = await request(port, 'GET', '/setup/status');
    expect(JSON.parse(statusBefore.body).required).toBe(true);

    const initialized = await request(port, 'POST', '/setup/initialize', {
      nome: 'Unidade Teste', login: 'admin.teste', senha: 'senha123'
    });
    expect(initialized.status).toBe(201);

    const statusAfter = await request(port, 'GET', '/setup/status');
    expect(JSON.parse(statusAfter.body).required).toBe(false);

    const duplicate = await request(port, 'POST', '/setup/initialize', {
      nome: 'Outra Unidade', login: 'outro.admin', senha: 'outra123'
    });
    expect(duplicate.status).toBe(409);

    const schools = await request(port, 'GET', '/escolas');
    const school = JSON.parse(schools.body).data[0];
    expect(school).toEqual(expect.objectContaining({ nome: 'Unidade Teste', login: 'admin.teste' }));

    const login = await request(port, 'POST', `/escolas/login/${school.id}`, {
      usuario: 'admin.teste', senha: 'senha123'
    });
    expect(login.status).toBe(200);
    expect(JSON.parse(login.body).token).toBeTruthy();

    for (const response of [statusBefore, initialized, statusAfter, duplicate, schools, login]) {
      expect(response.latencyMs).toBeLessThan(2000);
    }
  }, 30000);
});
