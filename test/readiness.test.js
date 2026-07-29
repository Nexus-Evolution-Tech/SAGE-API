const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const {
  REQUIRED_COLUMNS,
  hasCompatibleSchema,
  createReadinessChecker,
  createReadinessHandler
} = require('../src/services/readinessService');
const { temBancoDisponivel, criarBancoDeTeste } = require('./helpers/banco');

function fakeDatabase({ fail = false, missingColumn = false, invalidIndex = false } = {}) {
  return {
    async query(sql) {
      if (fail) throw new Error('segredo-do-driver');
      if (sql === 'SELECT 1') return [[], []];
      if (sql.includes('information_schema.COLUMNS')) {
        const columns = REQUIRED_COLUMNS
          .filter((column) => !missingColumn || column !== 'Acesso.catraca_log_id')
          .map((column) => {
            const [TABLE_NAME, COLUMN_NAME] = column.split('.');
            return { TABLE_NAME, COLUMN_NAME };
          });
        return [columns, []];
      }
      if (sql.includes('information_schema.STATISTICS')) {
        return [[
          { COLUMN_NAME: invalidIndex ? 'catraca_log_id' : 'dispositivo_id', NON_UNIQUE: 0 },
          { COLUMN_NAME: invalidIndex ? 'dispositivo_id' : 'catraca_log_id', NON_UNIQUE: 0 }
        ], []];
      }
      throw new Error('query inesperada');
    }
  };
}

describe('F8 — readiness sanitizado', () => {
  let base;
  let directories;

  beforeEach(async () => {
    base = await fs.mkdtemp(path.join(os.tmpdir(), 'sage-ready-'));
    directories = ['config', 'logs', 'uploads', 'exports', 'backups']
      .map((directory) => path.join(base, directory));
    await Promise.all(directories.map((directory) => fs.mkdir(directory)));
  });

  afterEach(async () => {
    await fs.rm(base, { recursive: true, force: true });
  });

  function checker(overrides = {}) {
    return createReadinessChecker({
      db: fakeDatabase(),
      dataDirectories: directories,
      routesReady: () => true,
      webReady: () => true,
      requireWeb: true,
      ...overrides
    });
  }

  it('retorna 200 apenas com todos os componentes prontos e sem expor detalhes', async () => {
    const checkReadiness = checker();
    const response = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis()
    };

    await createReadinessHandler(checkReadiness, '1.2.3')({}, response);

    expect(response.status).toHaveBeenCalledWith(200);
    const body = response.json.mock.calls[0][0];
    expect(body).toMatchObject({
      status: 'ready',
      version: '1.2.3',
      checks: { schema: { ok: true }, web: { ok: true } }
    });
    expect(Object.values(body.checks).every(({ ok }) => ok)).toBe(true);
    expect(JSON.stringify(body)).not.toContain(base);
    expect(JSON.stringify(body)).not.toContain('segredo-do-driver');
    await Promise.all(directories.map(async (directory) => {
      expect(await fs.readdir(directory)).toEqual([]);
    }));
  });

  it('separa falha de banco de schema sem vazar o erro interno', async () => {
    const outcome = await checker({ db: fakeDatabase({ fail: true }) })();

    expect(outcome.ready).toBe(false);
    expect(outcome.checks.database).toEqual({ ok: false, code: 'database_unavailable' });
    expect(outcome.checks.schema).toEqual({ ok: false, code: 'database_unavailable' });
    expect(JSON.stringify(outcome)).not.toContain('segredo-do-driver');
  });

  it('reprova coluna ou ordem do índice incompatível', async () => {
    const missingColumn = await checker({
      db: fakeDatabase({ missingColumn: true })
    })();
    const invalidIndex = await checker({
      db: fakeDatabase({ invalidIndex: true })
    })();

    expect(missingColumn.checks.schema).toEqual({ ok: false, code: 'schema_incompatible' });
    expect(invalidIndex.checks.schema).toEqual({ ok: false, code: 'schema_incompatible' });
  });

  it('reprova rotas, build obrigatório ou diretório não gravável', async () => {
    await fs.rm(directories[0], { recursive: true });
    const outcome = await checker({
      routesReady: () => false,
      webReady: () => false
    })();

    expect(outcome.ready).toBe(false);
    expect(outcome.checks.routes.ok).toBe(false);
    expect(outcome.checks.web.ok).toBe(false);
    expect(outcome.checks.dataDirectories.ok).toBe(false);
  });
});

describe('F8 — sentinel no MySQL real', () => {
  let database;
  let mysqlAvailable = false;

  beforeAll(async () => {
    mysqlAvailable = await temBancoDisponivel();
    if (mysqlAvailable) database = await criarBancoDeTeste('readiness');
  }, 240000);

  afterAll(async () => {
    if (database) await database.destruir();
  });

  it('aceita o schema instalado e reprova a perda do índice crítico', async ({ skip }) => {
    skip(!mysqlAvailable, 'MySQL indisponível');

    expect(await hasCompatibleSchema(database.pool)).toBe(true);
    await database.pool.query(
      'ALTER TABLE Acesso DROP INDEX uq_acesso_dispositivo_catraca_log'
    );
    expect(await hasCompatibleSchema(database.pool)).toBe(false);
  });
});
