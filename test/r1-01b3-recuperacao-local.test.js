const bcrypt = require('bcrypt');
const crypto = require('crypto');
const http = require('http');
const mysql = require('mysql2/promise');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { configConexao, temBancoDisponivel } = require('./helpers/banco');

const execFileAsync = promisify(execFile);
const database = `sage_verif_r1_01b3_${process.pid}_teste`;
const RAIZ = path.join(__dirname, '..');
const chaveInicial = 'chave-local-r1-01b3';
const senhaAdminAntiga = 'senha-admin-antiga';
const senhaUnidadeLegada = 'senha-unidade-legada';

process.env.DB_NAME = database;
process.env.JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
process.env.NODE_ENV = 'test';

const app = require('../src/app');
const schoolController = require('../src/controllers/schoolController');
const logger = require('../src/config/logger');

function hashChave(chave) {
  return crypto.createHash('sha256').update(chave, 'utf8').digest('hex');
}

function payloadRecuperacao(login, chave, senha) {
  return {
    login,
    chave_recuperacao: chave,
    nova_senha: senha,
    confirmacao_nova_senha: senha
  };
}

function request(port, body) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body));
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      method: 'POST',
      path: '/escolas/recuperar-acesso',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': payload.length
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        body: JSON.parse(Buffer.concat(chunks).toString())
      }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

const describeDatabase = (await temBancoDisponivel()) ? describe : describe.skip;

describeDatabase('R1-01B3 — recuperação local administrativa', () => {
  let db;
  let server;
  let port;
  let unidadeId;
  let adminId;
  let secretariaId;
  let hashUnidadeOriginal;

  beforeAll(async () => {
    const cfg = configConexao();
    await execFileAsync(
      process.execPath,
      [path.join(RAIZ, 'scripts', 'setup-database.js')],
      {
        cwd: RAIZ,
        timeout: 120000,
        env: {
          ...process.env,
          DB_HOST: cfg.host,
          DB_PORT: String(cfg.port),
          DB_USER: cfg.user,
          DB_PASSWORD: cfg.password,
          DB_NAME: database,
          SAGE_ALLOW_FIRST_RUN_ONBOARDING: 'true',
          LOG_LEVEL: 'error'
        }
      }
    );
    db = await mysql.createConnection({ ...cfg, database });
    await db.query('ALTER TABLE UnidadeEscolar AUTO_INCREMENT = 100');
    const [unidades] = await db.query(
      `INSERT INTO UnidadeEscolar
       (nome, login, senha, recuperacao_chave_hash, recuperacao_falhas)
       VALUES (?, ?, ?, ?, 0)`,
      ['Unidade R1-01B3', 'unidade-diferente', await bcrypt.hash(senhaUnidadeLegada, 10), hashChave(chaveInicial)]
    );
    unidadeId = unidades.insertId;
    const [admins] = await db.query(
      `INSERT INTO Usuario
       (login, senha_hash, nome_exibicao, papel, precisa_trocar_senha, falhas_login, bloqueado_ate)
       VALUES (?, ?, ?, 'ADMINISTRADOR', TRUE, 4, DATE_ADD(NOW(), INTERVAL 15 MINUTE))`,
      ['admin-diferente', await bcrypt.hash(senhaAdminAntiga, 10), 'Admin de teste']
    );
    adminId = admins.insertId;
    const [secretarias] = await db.query(
      `INSERT INTO Usuario (login, senha_hash, nome_exibicao, papel)
       VALUES (?, ?, ?, 'SECRETARIA')`,
      ['secretaria-r1-01b3', await bcrypt.hash('senha-secretaria', 10), 'Secretaria de teste']
    );
    secretariaId = secretarias.insertId;
    const [[unidade]] = await db.query('SELECT senha FROM UnidadeEscolar WHERE id = ?', [unidadeId]);
    hashUnidadeOriginal = unidade.senha;
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  }, 120000);

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (db) await db.end();
    const admin = await mysql.createConnection(configConexao());
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin.end();
  });

  it('recusa origem que não seja loopback antes de consultar o banco', async () => {
    const res = { status: vi.fn(() => res), json: vi.fn(() => res) };
    await schoolController.recuperarAcesso({
      socket: { remoteAddress: '192.0.2.10' },
      body: {}
    }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('aplica bloqueio temporário para chave inválida sem enumerar login', async () => {
    const respostas = [];
    for (let tentativa = 0; tentativa < 5; tentativa++) {
      respostas.push(await request(
        port,
        payloadRecuperacao(
          tentativa === 4 ? 'login-inexistente' : 'admin-diferente',
          'chave-incorreta',
          'senha-nova-8'
        )
      ));
    }
    expect(respostas.slice(0, 4).every((resposta) => resposta.status === 401)).toBe(true);
    expect(respostas[4].status).toBe(429);
    expect(respostas[0].body).toEqual(respostas[4].body);
    expect(JSON.stringify(respostas[0].body)).not.toContain('admin-diferente');
    const bloqueada = await request(port, payloadRecuperacao('admin-diferente', chaveInicial, 'senha-nova-8'));
    expect(bloqueada.status).toBe(429);
    await db.query(
      'UPDATE UnidadeEscolar SET recuperacao_falhas = 0, recuperacao_bloqueada_ate = NULL WHERE id = ?',
      [unidadeId]
    );
  });

  it('recusa SECRETARIA mesmo com a chave local válida', async () => {
    const resposta = await request(port, payloadRecuperacao('secretaria-r1-01b3', chaveInicial, 'senha-nova-8'));
    expect(resposta.status).toBe(401);
    expect(JSON.stringify(resposta.body)).not.toMatch(/secretaria-r1-01b3|senha-nova-8|chave-local-r1-01b3/i);
    const [[secretaria]] = await db.query('SELECT senha_hash FROM Usuario WHERE id = ?', [secretariaId]);
    expect(await bcrypt.compare('senha-secretaria', secretaria.senha_hash)).toBe(true);
  });

  it('recusa administrador inativo sem alterar sua senha', async () => {
    await db.query('UPDATE Usuario SET ativo = FALSE WHERE id = ?', [adminId]);
    const resposta = await request(port, payloadRecuperacao('admin-diferente', chaveInicial, 'senha-inativa-8'));
    expect(resposta.status).toBe(401);
    expect(resposta.body).toEqual({ message: 'Chave inválida ou login não autorizado.' });
    expect(JSON.stringify(resposta.body)).not.toContain('admin-diferente');
    const [[admin]] = await db.query('SELECT senha_hash FROM Usuario WHERE id = ?', [adminId]);
    expect(await bcrypt.compare(senhaAdminAntiga, admin.senha_hash)).toBe(true);
    await db.query('UPDATE Usuario SET ativo = TRUE WHERE id = ?', [adminId]);
    await db.query(
      'UPDATE UnidadeEscolar SET recuperacao_falhas = 0, recuperacao_bloqueada_ate = NULL WHERE id = ?',
      [unidadeId]
    );
  });

  it('faz rollback se a rotação da chave falhar depois da senha do usuário', async () => {
    const trigger = `falha_recuperacao_unidade_${process.pid}`;
    await db.query(
      `CREATE TRIGGER \`${trigger}\` BEFORE UPDATE ON UnidadeEscolar FOR EACH ROW
       SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'falha transacional controlada'`
    );
    const loggerError = vi.spyOn(logger, 'error');
    try {
      const resposta = await request(port, payloadRecuperacao('admin-diferente', chaveInicial, 'senha-nova-8'));
      expect(resposta.status).toBe(500);
      expect(JSON.stringify(resposta.body)).not.toMatch(/falha transacional|admin-diferente|senha-nova-8/i);
      expect(loggerError).toHaveBeenCalledWith('[RECUPERACAO] codigo=RECUPERACAO_LOCAL_FALHOU');
      expect(JSON.stringify(loggerError.mock.calls)).not.toContain('falha transacional controlada');
    } finally {
      loggerError.mockRestore();
      await db.query(`DROP TRIGGER \`${trigger}\``);
    }
    const [[admin]] = await db.query(
      'SELECT senha_hash, precisa_trocar_senha, falhas_login, bloqueado_ate FROM Usuario WHERE id = ?',
      [adminId]
    );
    expect(await bcrypt.compare(senhaAdminAntiga, admin.senha_hash)).toBe(true);
    expect(admin).toMatchObject({ precisa_trocar_senha: 1, falhas_login: 4 });
    const [[unidade]] = await db.query(
      'SELECT senha, recuperacao_chave_hash, recuperacao_falhas, recuperacao_bloqueada_ate FROM UnidadeEscolar WHERE id = ?',
      [unidadeId]
    );
    expect(unidade.senha).toBe(hashUnidadeOriginal);
    expect(unidade.recuperacao_chave_hash).toBe(hashChave(chaveInicial));
    expect(unidade.recuperacao_falhas).toBe(0);
    expect(unidade.recuperacao_bloqueada_ate).toBeNull();
  });

  it('exige a única unidade, seleciona o administrador separadamente e limpa os estados', async () => {
    const senhaNova = 'senha-recuperada-8';
    const [outra] = await db.query(
      `INSERT INTO UnidadeEscolar (nome, login, senha, recuperacao_chave_hash)
       VALUES (?, ?, ?, ?)`,
      ['Outra unidade', 'outra-unidade', hashUnidadeOriginal, hashChave('outra-chave')]
    );
    const comDuasUnidades = await request(port, payloadRecuperacao('admin-diferente', chaveInicial, senhaNova));
    expect(comDuasUnidades.status).toBe(401);
    await db.query('DELETE FROM UnidadeEscolar WHERE id = ?', [outra.insertId]);

    const resposta = await request(port, payloadRecuperacao('admin-diferente', chaveInicial, senhaNova));
    expect(resposta.status).toBe(200);
    expect(resposta.body).toMatchObject({
      message: expect.any(String),
      recoveryKey: expect.any(String)
    });
    expect(resposta.body.recoveryKey).not.toBe(chaveInicial);
    expect(JSON.stringify(resposta.body)).not.toMatch(/senha-recuperada-8|chave-local-r1-01b3|admin-diferente/i);

    const [[admin]] = await db.query(
      'SELECT senha_hash, precisa_trocar_senha, falhas_login, bloqueado_ate FROM Usuario WHERE id = ?',
      [adminId]
    );
    expect(await bcrypt.compare(senhaNova, admin.senha_hash)).toBe(true);
    expect(admin).toMatchObject({ precisa_trocar_senha: 0, falhas_login: 0, bloqueado_ate: null });
    const [[unidade]] = await db.query(
      'SELECT senha, recuperacao_chave_hash, recuperacao_falhas, recuperacao_bloqueada_ate FROM UnidadeEscolar WHERE id = ?',
      [unidadeId]
    );
    expect(await bcrypt.compare(senhaUnidadeLegada, unidade.senha)).toBe(true);
    expect(unidade.recuperacao_chave_hash).toBe(hashChave(resposta.body.recoveryKey));
    expect(unidade.recuperacao_chave_hash).not.toBe(hashChave(chaveInicial));
    expect(unidade).toMatchObject({ recuperacao_falhas: 0, recuperacao_bloqueada_ate: null });

    const chaveAntiga = await request(port, payloadRecuperacao('admin-diferente', chaveInicial, 'outra-senha-8'));
    expect(chaveAntiga.status).toBe(401);
  });
});
