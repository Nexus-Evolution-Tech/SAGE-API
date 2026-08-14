const bcrypt = require('bcrypt');
const crypto = require('crypto');
const http = require('http');
const jwtLib = require('jsonwebtoken');
const mysql = require('mysql2/promise');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { configConexao, temBancoDisponivel } = require('./helpers/banco');

const database = `sage_verif_r1_01b1_${process.pid}_teste`;
process.env.DB_NAME = database;
process.env.JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
process.env.NODE_ENV = 'test';
const app = require('../src/app');
const db = require('../src/config/database');
const autenticar = require('../src/middlewares/autenticar');
const { gerarToken, verificarToken } = require('../src/utils/jwt');
const execFileAsync = promisify(execFile);

function request(port, method, requestPath, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({ hostname: '127.0.0.1', port, method, path: requestPath,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}) }
    }, (res) => { const chunks = []; res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() })); });
    req.on('error', reject); if (payload) req.write(payload); req.end();
  });
}

describe('R1-01B1 — contrato JWT e consulta de sessão', () => {
  it('rejeita claims extras, ausentes ou inválidos', () => {
    const claims = { usuario_id: 7, papel: 'ADMINISTRADOR', emitido_em: new Date().toISOString() };
    expect(Object.keys(jwtLib.decode(gerarToken(claims))).sort()).toEqual(['emitido_em', 'exp', 'papel', 'usuario_id']);
    expect(verificarToken(gerarToken(claims))).toMatchObject(claims);
    expect(() => gerarToken({ ...claims, extra: true })).toThrow();
    const assinar = (dados) => jwtLib.sign(dados, process.env.JWT_SECRET, { noTimestamp: true, expiresIn: '1h' });
    expect(verificarToken(assinar({ papel: claims.papel, emitido_em: claims.emitido_em }))).toBeNull();
    expect(verificarToken(assinar({ ...claims, usuario_id: '7' }))).toBeNull();
    expect(verificarToken(assinar({ ...claims, papel: 'GESTOR' }))).toBeNull();
    expect(verificarToken(assinar({ ...claims, emitido_em: 'data-invalida' }))).toBeNull();
  });

  it('consulta Usuario por requisição e nega falha do banco sem PII', async () => {
    const originalQuery = db.query;
    db.query = vi.fn().mockRejectedValue(new Error('falha de banco com dado sensível'));
    const req = { headers: { authorization: `Bearer ${gerarToken({ usuario_id: 7, papel: 'ADMINISTRADOR', emitido_em: new Date().toISOString() })}` }, method: 'GET', path: '/config' };
    const res = { status: vi.fn(() => res), json: vi.fn(() => res) };
    try { await autenticar(req, res, vi.fn()); } finally { db.query = originalQuery; }
    expect(res.status).toHaveBeenCalledWith(503);
    expect(JSON.stringify(res.json.mock.calls)).not.toContain('dado sensível');
  });
});

const describeDatabase = (await temBancoDisponivel()) ? describe : describe.skip;
describeDatabase('R1-01B1 — bootstrap, login e troca obrigatória', () => {
  let server; let port; let connection; let adminId;

  beforeAll(async () => {
    const cfg = configConexao();
    await execFileAsync(process.execPath, [path.join(__dirname, '..', 'scripts', 'setup-database.js')], {
      cwd: path.join(__dirname, '..'), timeout: 120000,
      env: { ...process.env, DB_HOST: cfg.host, DB_PORT: String(cfg.port), DB_USER: cfg.user,
        DB_PASSWORD: cfg.password, DB_NAME: database, SAGE_ALLOW_FIRST_RUN_ONBOARDING: 'true' }
    });
    connection = await mysql.createConnection({ ...cfg, database });
    server = http.createServer(app); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  }, 120000);

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (connection) await connection.end();
    const admin = await mysql.createConnection(configConexao());
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``); await admin.end();
  });

  it('cria unidade e administrador atomicamente, ignora a senha legada e exige troca', async () => {
    const initialized = await request(port, 'POST', '/setup/initialize', {
      nome: 'Unidade R1B1', login: 'admin.r1b1', senha: 'senha-inicial-8'
    });
    expect(initialized.status).toBe(201);
    const [[school]] = await connection.query('SELECT id FROM UnidadeEscolar');
    const [[user]] = await connection.query('SELECT id, login, papel FROM Usuario WHERE login = ?', ['admin.r1b1']);
    adminId = user.id;
    expect(user).toMatchObject({ login: 'admin.r1b1', papel: 'ADMINISTRADOR' });
    await connection.query('UPDATE UnidadeEscolar SET senha = ? WHERE id = ?', [await bcrypt.hash('legada-8', 10), school.id]);
    await connection.query('UPDATE Usuario SET senha_hash = ?, precisa_trocar_senha = TRUE WHERE id = ?', [await bcrypt.hash('migrada-8', 10), adminId]);
    expect((await request(port, 'POST', '/escolas/login/999', { usuario: 'admin.r1b1', senha: 'legada-8' })).status).toBe(401);
    const login = await request(port, 'POST', '/escolas/login/999', { usuario: 'admin.r1b1', senha: 'migrada-8' });
    expect(login.status).toBe(200);
    const token = JSON.parse(login.body).token;
    expect(jwtLib.decode(token).usuario_id).toBe(adminId);
    expect((await request(port, 'GET', '/config', undefined, token)).status).toBe(428);
    expect((await request(port, 'PATCH', '/unidade/trocar-senha', { senha_atual: 'migrada-8', nova_senha: 'curta' }, token)).status).toBe(400);
    expect((await request(port, 'PATCH', '/unidade/trocar-senha', { senha_atual: 'migrada-8', nova_senha: 'senha-nova-8' }, token)).status).toBe(200);
    expect((await request(port, 'GET', '/config', undefined, token)).status).toBe(200);
    const [[state]] = await connection.query('SELECT precisa_trocar_senha, falhas_login, bloqueado_ate FROM Usuario WHERE id = ?', [adminId]);
    expect(state).toEqual({ precisa_trocar_senha: 0, falhas_login: 0, bloqueado_ate: null });
  });

  it('diferencia logins e recusa o usuário desativado na requisição seguinte', async () => {
    const [insert] = await connection.query('INSERT INTO Usuario (login, senha_hash, nome_exibicao, papel) VALUES (?, ?, ?, \'SECRETARIA\')', ['secretaria.r1b1', await bcrypt.hash('senha-secretaria', 10), 'Secretaria R1B1']);
    const [a, b] = await Promise.all([
      request(port, 'POST', '/escolas/login/1', { usuario: 'admin.r1b1', senha: 'senha-nova-8' }),
      request(port, 'POST', '/escolas/login/1', { usuario: 'secretaria.r1b1', senha: 'senha-secretaria' })
    ]);
    expect(jwtLib.decode(JSON.parse(a.body).token).usuario_id).toBe(adminId);
    expect(jwtLib.decode(JSON.parse(b.body).token).usuario_id).toBe(insert.insertId);
    await connection.query('UPDATE Usuario SET ativo = FALSE WHERE id = ?', [insert.insertId]);
    expect((await request(port, 'GET', '/config', undefined, JSON.parse(b.body).token)).status).toBe(401);
  });
});
