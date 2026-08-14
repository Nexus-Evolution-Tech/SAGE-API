const crypto = require('crypto');
const fs = require('fs').promises;
const http = require('http');
const os = require('os');
const path = require('path');
const mysql = require('mysql2/promise');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { configConexao, temBancoDisponivel } = require('./helpers/banco');

const execFileAsync = promisify(execFile);
const database = `sage_verif_r1_01b4_${process.pid}_teste`;
const dataDir = path.join(os.tmpdir(), `sage-r1-01b4-${process.pid}`);
const singletonCode = 'UNIDADE_ESCOLAR_SINGLETON_INVALIDA';

process.env.DB_NAME = database;
process.env.SAGE_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
process.env.NODE_ENV = 'test';

const app = require('../src/app');
const db = require('../src/config/database');
const { paths } = require('../src/config/paths');
const { gerarToken } = require('../src/utils/jwt');
const { buscarUnidadeSingleton } = require('../src/services/unidadeSingletonService');

function request(port, method, requestPath, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      method,
      path: requestPath,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {})
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
    if (payload) req.write(payload);
    req.end();
  });
}

async function upload(port, token) {
  const form = new FormData();
  form.append('logo', new Blob(['logo de teste'], { type: 'image/png' }), 'logo.png');
  const response = await fetch(`http://127.0.0.1:${port}/unidade/upload-logo`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
  return { status: response.status, body: await response.json() };
}

const describeDatabase = (await temBancoDisponivel()) ? describe : describe.skip;

describe('helper singleton da unidade', () => {
  it('rejeita campo não permitido antes de consultar o banco', async () => {
    const query = vi.spyOn(db, 'query');
    try {
      await expect(buscarUnidadeSingleton(['senha'])).rejects.toMatchObject({
        code: 'UNIDADE_SINGLETON_CAMPOS_INVALIDOS'
      });
      expect(query).not.toHaveBeenCalled();
    } finally {
      query.mockRestore();
    }
  });
});

describeDatabase('R1-01B4 — identidade singleton da unidade', () => {
  let connection;
  let server;
  let port;
  let unidadeId;
  let usuarioId;
  let token;

  beforeAll(async () => {
    const cfg = configConexao();
    await execFileAsync(process.execPath, [path.join(__dirname, '..', 'scripts', 'setup-database.js')], {
      cwd: path.join(__dirname, '..'),
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
    });
    connection = await mysql.createConnection({ ...cfg, database });
    await connection.query('ALTER TABLE UnidadeEscolar AUTO_INCREMENT = 100');
    const [unidade] = await connection.query(
      'INSERT INTO UnidadeEscolar (nome, login, senha) VALUES (?, ?, ?)',
      ['Unidade R1-01B4', 'unidade-r1-01b4', 'senha-legada-8']
    );
    unidadeId = unidade.insertId;
    await connection.query('ALTER TABLE Usuario AUTO_INCREMENT = 1');
    const [usuario] = await connection.query(
      `INSERT INTO Usuario (login, senha_hash, nome_exibicao, papel, ativo, precisa_trocar_senha)
       VALUES (?, ?, ?, 'ADMINISTRADOR', TRUE, FALSE)`,
      ['usuario-r1-01b4', await require('bcrypt').hash('senha-usuario-8', 10), 'Usuario R1-01B4']
    );
    usuarioId = usuario.insertId;
    token = gerarToken({ usuario_id: usuarioId, papel: 'ADMINISTRADOR', emitido_em: new Date().toISOString() });
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  }, 120000);

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (connection) await connection.end();
    const admin = await mysql.createConnection(configConexao());
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin.end();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('resolve leitura, atualização e logo pela única unidade, não pelo usuário', async () => {
    expect(usuarioId).not.toBe(unidadeId);
    const originalQuery = db.query.bind(db);
    const queries = [];
    db.query = vi.fn((...args) => {
      queries.push(args);
      return originalQuery(...args);
    });

    try {
      const leitura = await request(port, 'GET', '/unidade', undefined, token);
      expect(leitura.status).toBe(200);
      expect(leitura.body).toMatchObject({ id: unidadeId, nome: 'Unidade R1-01B4' });
      expect(leitura.body).not.toHaveProperty('senha');

      const atualizacao = await request(port, 'PATCH', '/unidade', { nome: 'Unidade atualizada' }, token);
      expect(atualizacao.status).toBe(200);
      const [[unidadeAtualizada]] = await connection.query(
        'SELECT id, nome FROM UnidadeEscolar WHERE id = ?', [unidadeId]
      );
      expect(unidadeAtualizada).toEqual({ id: unidadeId, nome: 'Unidade atualizada' });

      const logo = await upload(port, token);
      expect(logo.status).toBe(200);
      expect(logo.body.logo).toBe(`unidade/logo_${unidadeId}.png`);
      const [[unidadeComLogo]] = await connection.query(
        'SELECT id, logo FROM UnidadeEscolar WHERE id = ?', [unidadeId]
      );
      expect(unidadeComLogo).toEqual({ id: unidadeId, logo: `unidade/logo_${unidadeId}.png` });

      const consultasDaUnidade = queries.filter(([sql]) => /UnidadeEscolar/i.test(sql));
      expect(consultasDaUnidade.length).toBeGreaterThan(0);
      expect(consultasDaUnidade.flat().join(' ')).not.toMatch(/usuario_id/i);
      const parametrosDaUnidade = consultasDaUnidade.flatMap(([, params]) => (
        Array.isArray(params) ? params : []
      ));
      expect(parametrosDaUnidade).not.toContain(usuarioId);
    } finally {
      db.query = originalQuery;
    }
  });

  it('falha com código fixo e limpa upload temporário quando não há unidade', async () => {
    await connection.query('DELETE FROM UnidadeEscolar');
    const respostaLeitura = await request(port, 'GET', '/unidade', undefined, token);
    expect(respostaLeitura).toEqual({
      status: 503,
      body: { message: 'Unidade escolar indisponível', code: singletonCode }
    });

    const respostaAtualizacao = await request(port, 'PATCH', '/unidade', { nome: 'não deve gravar' }, token);
    expect(respostaAtualizacao.status).toBe(503);
    expect(respostaAtualizacao.body).toEqual({ message: 'Unidade escolar indisponível', code: singletonCode });

    const respostaLogo = await upload(port, token);
    expect(respostaLogo.status).toBe(503);
    expect(respostaLogo.body).toEqual({ message: 'Unidade escolar indisponível', code: singletonCode });
    const arquivosTemporarios = await fs.readdir(paths.uploads);
    expect(arquivosTemporarios.filter((arquivo) => arquivo.startsWith('temp_'))).toEqual([]);
    expect(JSON.stringify(respostaLogo.body)).not.toMatch(/usuario-r1-01b4|senha-usuario-8/i);
  });

  it('falha com o mesmo código quando há múltiplas unidades', async () => {
    await connection.query(
      `INSERT INTO UnidadeEscolar (nome, login, senha) VALUES
       ('Unidade A', 'unidade-a', 'senha-a-8'), ('Unidade B', 'unidade-b', 'senha-b-8')`
    );
    const leitura = await request(port, 'GET', '/unidade', undefined, token);
    expect(leitura.status).toBe(503);
    expect(leitura.body).toEqual({ message: 'Unidade escolar indisponível', code: singletonCode });
    expect(JSON.stringify(leitura.body)).not.toMatch(/unidade-a|unidade-b|usuario-r1-01b4/i);
  });
});
