const crypto = require('crypto');
const fs = require('fs/promises');
const mysql = require('mysql2/promise');
const os = require('os');
const path = require('path');
const { configConexao, criarBancoDeTeste, temBancoDisponivel } = require('./helpers/banco');
const {
  MigrationError,
  lockNameForSchema,
  runMigrations
} = require('../scripts/migration-runner');

const dirs = [];
async function migrations(files) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sage-migrations-'));
  dirs.push(dir);
  await Promise.all(Object.entries(files).map(([name, sql]) => fs.writeFile(path.join(dir, name), sql)));
  return dir;
}
const checksum = (sql) => crypto.createHash('sha256').update(sql).digest('hex');

function db({
  ledger = [], insertError, shared, onMigrationSql, schema = 'sage_test',
  releaseResult = 1, releaseError, migrationError, statusUpdateResult = 1,
  rollbackError, failedStatusUpdateResult = 1, transactionState = 0
} = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push([sql, params]);
      if (sql.startsWith('SELECT DATABASE()')) return [[{ schema_name: schema }]];
      if (sql.includes('GET_LOCK')) {
        if (shared) { if (shared.locked) return [[{ acquired: 0 }]]; shared.locked = true; }
        return [[{ acquired: 1 }]];
      }
      if (sql.includes('RELEASE_LOCK')) {
        if (releaseError) throw releaseError;
        if (shared) shared.locked = false;
        return [[{ released: releaseResult }]];
      }
      if (sql === 'ROLLBACK') {
        if (rollbackError) throw rollbackError;
        return [[]];
      }
      if (sql === 'DO 0') {
        return [{ serverStatus: transactionState ? 1 : 2 }];
      }
      if (sql.startsWith('SELECT version')) return [ledger];
      if (sql.startsWith('CREATE TABLE IF NOT EXISTS retry_table')) await onMigrationSql?.();
      if (sql.startsWith('INSERT')) {
        if (insertError) throw insertError;
        ledger.push({ version: params[0], checksum: params[1], status: params[3] });
      }
      if (sql.startsWith('UPDATE schema_migrations SET status = \'applied\'')) {
        if (statusUpdateResult === 1) {
          ledger.find(({ version }) => version === params[0]).status = 'applied';
        }
        return [{ affectedRows: statusUpdateResult }];
      }
      if (sql.startsWith('UPDATE schema_migrations SET status = \'failed\'')) {
        if (failedStatusUpdateResult === 1) {
          ledger.find(({ version }) => version === params[0]).status = 'failed';
        }
        return [{ affectedRows: failedStatusUpdateResult }];
      }
      if (migrationError && sql === migrationError.sql) throw migrationError.error;
      return [[]];
    }
  };
}

afterEach(async () => Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))));

describe('runner de migrations versionadas', () => {
  it('marca in_progress antes do SQL e applied após cada migration pendente', async () => {
    const one = 'CREATE TABLE IF NOT EXISTS one_table (id INT);';
    const two = 'CREATE TABLE IF NOT EXISTS two_table (id INT);';
    const connection = db();
    const result = await runMigrations({ connection, appVersion: '8.1.0', migrationsDir: await migrations({ '0002_two.sql': two, '0001_one.sql': one, 'nota.txt': 'ignorada' }) });
    expect(result.applied).toEqual(['0001', '0002']);
    expect(connection.calls.filter(([sql]) => sql.startsWith('INSERT')).map(([, params]) => params)).toEqual([
      ['0001', checksum(one), '8.1.0', 'in_progress'], ['0002', checksum(two), '8.1.0', 'in_progress']
    ]);
    const sqlCalls = connection.calls.map(([sql]) => sql);
    expect(sqlCalls.findIndex((sql) => sql.startsWith('INSERT'))).toBeLessThan(sqlCalls.indexOf(one));
    expect(connection.calls.filter(([sql]) => sql.startsWith('UPDATE schema_migrations SET status = \'applied\''))).toHaveLength(2);
    expect(connection.calls.filter(([sql]) => sql.startsWith('ALTER TABLE schema_migrations'))).toHaveLength(0);
  });

  it('rejeita drift, ledger futuro e identificadores locais duplicados', async () => {
    const dir = await migrations({ '0001_alpha.sql': 'SELECT 1;', '0001_beta.sql': 'SELECT 2;' });
    await expect(runMigrations({ connection: db(), appVersion: 'x', migrationsDir: dir })).rejects.toMatchObject({ code: 'DUPLICATE_VERSION' });
    const valid = await migrations({ '0001_alpha.sql': 'SELECT 1;' });
    await expect(runMigrations({ connection: db({ ledger: [{ version: '0001', checksum: '0'.repeat(64), status: 'applied' }] }), appVersion: 'x', migrationsDir: valid })).rejects.toMatchObject({ code: 'CHECKSUM_DRIFT' });
    await expect(runMigrations({ connection: db({ ledger: [{ version: '9999', checksum: '0'.repeat(64), status: 'applied' }] }), appVersion: 'x', migrationsDir: valid })).rejects.toMatchObject({ code: 'MISSING_LOCAL_FILE' });
    const duplicateName = await migrations({ '0001_alpha.sql': 'SELECT 1;', '0002_alpha.sql': 'SELECT 2;' });
    await expect(runMigrations({ connection: db(), appVersion: 'x', migrationsDir: duplicateName })).rejects.toMatchObject({ code: 'DUPLICATE_NAME' });
    const invalidName = await migrations({ 'sem-versao.sql': 'SELECT 1;' });
    await expect(runMigrations({ connection: db(), appVersion: 'x', migrationsDir: invalidName })).rejects.toMatchObject({ code: 'INVALID_FILENAME' });
    const noMigrations = await migrations({ 'nota.txt': 'ignorada' });
    await expect(runMigrations({ connection: db(), appVersion: 'x', migrationsDir: noMigrations })).rejects.toMatchObject({ code: 'NO_MIGRATIONS' });
  });

  it('não roda sem lock e o libera inclusive quando há falha', async () => {
    const dir = await migrations({ '0001_alpha.sql': 'SELECT 1;' });
    const unavailable = {
      query: async (sql) => sql.startsWith('SELECT DATABASE()')
        ? [[{ schema_name: 'sage_test' }]]
        : sql.includes('GET_LOCK') ? [[{ acquired: 0 }]] : [[]]
    };
    await expect(runMigrations({ connection: unavailable, appVersion: 'x', migrationsDir: dir })).rejects.toMatchObject({ code: 'LOCK_NOT_ACQUIRED' });
    await expect(runMigrations({ connection: db({ schema: null }), appVersion: 'x', migrationsDir: dir })).rejects.toMatchObject({ code: 'DATABASE_NOT_SELECTED' });
    await expect(runMigrations({
      connection: { query() {}, getConnection() {} }, appVersion: 'x', migrationsDir: dir
    })).rejects.toThrow('connection deve ser dedicada');
    const connection = db({ ledger: [{ version: '0001', checksum: 'bad', status: 'applied' }] });
    await expect(runMigrations({ connection, appVersion: 'x', migrationsDir: dir })).rejects.toBeInstanceOf(MigrationError);
    expect(connection.calls.some(([sql, params]) => (
      sql.includes('RELEASE_LOCK') && params[0] === lockNameForSchema('sage_test')
    ))).toBe(true);
    await expect(runMigrations({
      connection: db({ releaseResult: 0 }), appVersion: 'x', migrationsDir: dir
    })).rejects.toMatchObject({ code: 'LOCK_RELEASE_FAILED' });
    await expect(runMigrations({
      connection: db({ ledger: [{ version: '0001', checksum: 'bad', status: 'applied' }], releaseError: new Error('release') }),
      appVersion: 'x', migrationsDir: dir
    })).rejects.toMatchObject({ code: 'CHECKSUM_DRIFT' });
  });

  it('bloqueia um segundo runner enquanto o primeiro está aplicando', async () => {
    const dir = await migrations({ '0001_retry.sql': 'CREATE TABLE IF NOT EXISTS retry_table (id INT);' });
    const shared = { locked: false };
    let releaseSql; let sqlStarted;
    const started = new Promise((resolve) => { sqlStarted = resolve; });
    const first = runMigrations({ connection: db({ shared, onMigrationSql: () => new Promise((resolve) => { releaseSql = resolve; sqlStarted(); }) }), appVersion: 'x', migrationsDir: dir });
    await started;
    await expect(runMigrations({ connection: db({ shared }), appVersion: 'x', migrationsDir: dir })).rejects.toMatchObject({ code: 'LOCK_NOT_ACQUIRED' });
    releaseSql();
    await first;
  });

  it('marca erro como failed e nunca reexecuta migration interrompida', async () => {
    const sql = 'CREATE TABLE IF NOT EXISTS retry_table (id INT);';
    const dir = await migrations({ '0001_retry.sql': sql });
    const ledger = [];
    const first = db({ ledger, migrationError: { sql, error: new Error('ddl interrompido') } });
    await expect(runMigrations({ connection: first, appVersion: 'x', migrationsDir: dir })).rejects.toThrow('ddl interrompido');
    expect(ledger).toEqual([{ version: '0001', checksum: checksum(sql), status: 'failed' }]);
    const retry = db({ ledger });
    await expect(runMigrations({ connection: retry, appVersion: 'x', migrationsDir: dir }))
      .rejects.toMatchObject({ code: 'MIGRATION_REQUIRES_INTERVENTION' });
    expect(first.calls.filter(([query]) => query === sql)).toHaveLength(1);
    expect(retry.calls.filter(([query]) => query === sql)).toHaveLength(0);
    expect(ledger).toHaveLength(1);
  });

  it('faz rollback antes de marcar failed e preserva o erro do SQL', async () => {
    const sql = 'START TRANSACTION; INSERT INTO retry_table VALUES (1);';
    const connection = db({ migrationError: { sql, error: new Error('insert inválido') } });
    await expect(runMigrations({
      connection, appVersion: 'x', migrationsDir: await migrations({ '0001_retry.sql': sql })
    })).rejects.toThrow('insert inválido');

    const calls = connection.calls.map(([query]) => query);
    expect(calls.indexOf(sql)).toBeLessThan(calls.indexOf('ROLLBACK'));
    expect(calls.indexOf('ROLLBACK')).toBeLessThan(calls.findIndex((query) => (
      query.startsWith("UPDATE schema_migrations SET status = 'failed'")
    )));
  });

  it('deixa in_progress quando o rollback falha e preserva o erro do SQL', async () => {
    const sql = 'START TRANSACTION; INSERT INTO retry_table VALUES (1);';
    const ledger = [];
    const connection = db({
      ledger,
      migrationError: { sql, error: new Error('conexão interrompida') },
      rollbackError: new Error('rollback indisponível')
    });
    await expect(runMigrations({
      connection, appVersion: 'x', migrationsDir: await migrations({ '0001_retry.sql': sql })
    })).rejects.toThrow('conexão interrompida');

    expect(ledger).toEqual([{ version: '0001', checksum: checksum(sql), status: 'in_progress' }]);
    expect(connection.calls.some(([query]) => query.startsWith("UPDATE schema_migrations SET status = 'failed'"))).toBe(false);
  });

  it('preserva o erro do SQL quando não consegue registrar failed', async () => {
    const sql = 'SELECT erro;';
    const ledger = [];
    const connection = db({
      ledger,
      migrationError: { sql, error: new Error('falha primária') },
      failedStatusUpdateResult: 0
    });
    await expect(runMigrations({
      connection, appVersion: 'x', migrationsDir: await migrations({ '0001_retry.sql': sql })
    })).rejects.toThrow('falha primária');

    expect(ledger).toEqual([{ version: '0001', checksum: checksum(sql), status: 'in_progress' }]);
  });

  it('rejeita migration que termina com transação aberta', async () => {
    const sql = 'START TRANSACTION; INSERT INTO retry_table VALUES (1);';
    const ledger = [];
    const connection = db({ ledger, transactionState: 1 });
    await expect(runMigrations({
      connection, appVersion: 'x', migrationsDir: await migrations({ '0001_retry.sql': sql })
    })).rejects.toMatchObject({ code: 'MIGRATION_TRANSACTION_LEFT_OPEN' });

    expect(ledger).toEqual([{ version: '0001', checksum: checksum(sql), status: 'failed' }]);
    const calls = connection.calls.map(([query]) => query);
    expect(calls.indexOf('ROLLBACK')).toBeLessThan(calls.findIndex((query) => (
      query.startsWith("UPDATE schema_migrations SET status = 'failed'")
    )));
  });

  it('bloqueia estado in_progress deixado por queda antes de executar SQL', async () => {
    const sql = 'SELECT 1;';
    const connection = db({ ledger: [{ version: '0001', checksum: checksum(sql), status: 'in_progress' }] });
    await expect(runMigrations({ connection, appVersion: 'x', migrationsDir: await migrations({ '0001_alpha.sql': sql }) }))
      .rejects.toMatchObject({ code: 'MIGRATION_REQUIRES_INTERVENTION' });
    expect(connection.calls.some(([query]) => query === sql)).toBe(false);
  });

  it('falha fechado se não conseguir concluir o estado applied', async () => {
    const sql = 'SELECT 1;';
    const connection = db({ statusUpdateResult: 0 });
    await expect(runMigrations({
      connection, appVersion: 'x', migrationsDir: await migrations({ '0001_alpha.sql': sql })
    })).rejects.toMatchObject({ code: 'MIGRATION_STATUS_UPDATE_FAILED' });
  });

  it('falha se uma versão posterior estiver aplicada antes de uma pendente', async () => {
    const one = 'SELECT 1;';
    const two = 'SELECT 2;';
    const dir = await migrations({ '0001_one.sql': one, '0002_two.sql': two });
    const connection = db({ ledger: [{ version: '0002', checksum: checksum(two), status: 'applied' }] });

    await expect(runMigrations({
      connection,
      appVersion: 'x',
      migrationsDir: dir
    })).rejects.toMatchObject({ code: 'MIGRATION_ORDER_GAP' });
    expect(connection.calls).not.toContainEqual([one, undefined]);
  });
});

const describeMySql = await temBancoDisponivel() ? describe : describe.skip;

describeMySql('runner de migrations no MySQL real (CI: 8.4)', () => {
  let banco;

  beforeAll(async () => {
    banco = await criarBancoDeTeste('migration_runner_rollback');
  }, 120000);

  beforeEach(async () => {
    await banco.pool.query('DROP TABLE IF EXISTS schema_migrations');
    await banco.pool.query('DROP TABLE IF EXISTS migration_runner_atomic_probe');
    await banco.pool.query('CREATE TABLE migration_runner_atomic_probe (id INT PRIMARY KEY) ENGINE=InnoDB');
  });

  afterAll(async () => {
    if (banco) await banco.destruir();
  });

  it('faz rollback atômico antes de persistir failed', async () => {
    const connection = await mysql.createConnection({ ...configConexao(), database: banco.nome });
    const sql = `START TRANSACTION;
INSERT INTO migration_runner_atomic_probe (id) VALUES (1);
INSERT INTO migration_runner_atomic_probe (id) VALUES (1);
    COMMIT;`;
    try {
      await expect(runMigrations({
        connection, appVersion: '8.1.0', migrationsDir: await migrations({ '0001_atomic.sql': sql })
      })).rejects.toThrow(/Duplicate entry/);

      const [rows] = await connection.query('SELECT id FROM migration_runner_atomic_probe');
      const [ledger] = await connection.query('SELECT status FROM schema_migrations WHERE version = ?', ['0001']);
      const [transaction] = await connection.query(
        'SELECT COUNT(*) AS active FROM information_schema.innodb_trx WHERE trx_mysql_thread_id = CONNECTION_ID()'
      );
      expect(rows).toEqual([]);
      expect(ledger).toEqual([{ status: 'failed' }]);
      expect(Number(transaction[0].active)).toBe(0);
    } finally {
      await connection.end();
    }
  });

  it('rejeita e desfaz migration que esquece o commit', async () => {
    const connection = await mysql.createConnection({ ...configConexao(), database: banco.nome });
    const sql = `START TRANSACTION;
INSERT INTO migration_runner_atomic_probe (id) VALUES (2);`;
    try {
      await expect(runMigrations({
        connection, appVersion: '8.1.0', migrationsDir: await migrations({ '0002_open.sql': sql })
      })).rejects.toMatchObject({ code: 'MIGRATION_TRANSACTION_LEFT_OPEN' });

      const [rows] = await connection.query('SELECT id FROM migration_runner_atomic_probe WHERE id = 2');
      const [ledger] = await connection.query('SELECT status FROM schema_migrations WHERE version = ?', ['0002']);
      expect(rows).toEqual([]);
      expect(ledger).toEqual([{ status: 'failed' }]);
    } finally {
      await connection.end();
    }
  });
});
