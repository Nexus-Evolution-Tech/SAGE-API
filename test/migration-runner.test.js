const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
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
  releaseResult = 1, releaseError
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
      if (sql.startsWith('SELECT version')) return [ledger];
      if (sql.startsWith('CREATE TABLE IF NOT EXISTS retry_table')) await onMigrationSql?.();
      if (sql.startsWith('INSERT')) { if (insertError) throw insertError; ledger.push({ version: params[0], checksum: params[1] }); }
      return [[]];
    }
  };
}

afterEach(async () => Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))));

describe('runner de migrations versionadas', () => {
  it('executa pendentes em ordem e grava o ledger após cada SQL', async () => {
    const one = 'CREATE TABLE IF NOT EXISTS one_table (id INT);';
    const two = 'CREATE TABLE IF NOT EXISTS two_table (id INT);';
    const connection = db();
    const result = await runMigrations({ connection, appVersion: '8.1.0', migrationsDir: await migrations({ '0002_two.sql': two, '0001_one.sql': one, 'nota.txt': 'ignorada' }) });
    expect(result.applied).toEqual(['0001', '0002']);
    expect(connection.calls.filter(([sql]) => sql.startsWith('INSERT')).map(([, params]) => params)).toEqual([
      ['0001', checksum(one), '8.1.0'], ['0002', checksum(two), '8.1.0']
    ]);
    const sqlCalls = connection.calls.map(([sql]) => sql);
    expect(sqlCalls.indexOf(one)).toBeLessThan(sqlCalls.findIndex((sql) => sql.startsWith('INSERT')));
  });

  it('rejeita drift, ledger futuro e identificadores locais duplicados', async () => {
    const dir = await migrations({ '0001_alpha.sql': 'SELECT 1;', '0001_beta.sql': 'SELECT 2;' });
    await expect(runMigrations({ connection: db(), appVersion: 'x', migrationsDir: dir })).rejects.toMatchObject({ code: 'DUPLICATE_VERSION' });
    const valid = await migrations({ '0001_alpha.sql': 'SELECT 1;' });
    await expect(runMigrations({ connection: db({ ledger: [{ version: '0001', checksum: '0'.repeat(64) }] }), appVersion: 'x', migrationsDir: valid })).rejects.toMatchObject({ code: 'CHECKSUM_DRIFT' });
    await expect(runMigrations({ connection: db({ ledger: [{ version: '9999', checksum: '0'.repeat(64) }] }), appVersion: 'x', migrationsDir: valid })).rejects.toMatchObject({ code: 'MISSING_LOCAL_FILE' });
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
    const connection = db({ ledger: [{ version: '0001', checksum: 'bad' }] });
    await expect(runMigrations({ connection, appVersion: 'x', migrationsDir: dir })).rejects.toBeInstanceOf(MigrationError);
    expect(connection.calls.some(([sql, params]) => (
      sql.includes('RELEASE_LOCK') && params[0] === lockNameForSchema('sage_test')
    ))).toBe(true);
    await expect(runMigrations({
      connection: db({ releaseResult: 0 }), appVersion: 'x', migrationsDir: dir
    })).rejects.toMatchObject({ code: 'LOCK_RELEASE_FAILED' });
    await expect(runMigrations({
      connection: db({ ledger: [{ version: '0001', checksum: 'bad' }], releaseError: new Error('release') }),
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

  it('repete SQL idempotente se cair entre DDL e marcador', async () => {
    const sql = 'CREATE TABLE IF NOT EXISTS retry_table (id INT);';
    const dir = await migrations({ '0001_retry.sql': sql });
    const ledger = [];
    const first = db({ ledger, insertError: new Error('marker indisponível') });
    await expect(runMigrations({ connection: first, appVersion: 'x', migrationsDir: dir })).rejects.toThrow('marker indisponível');
    const retry = db({ ledger });
    await runMigrations({ connection: retry, appVersion: 'x', migrationsDir: dir });
    expect(first.calls.filter(([query]) => query === sql)).toHaveLength(1);
    expect(retry.calls.filter(([query]) => query === sql)).toHaveLength(1);
    expect(ledger).toHaveLength(1);
  });

  it('falha se uma versão posterior estiver aplicada antes de uma pendente', async () => {
    const one = 'SELECT 1;';
    const two = 'SELECT 2;';
    const dir = await migrations({ '0001_one.sql': one, '0002_two.sql': two });
    const connection = db({ ledger: [{ version: '0002', checksum: checksum(two) }] });

    await expect(runMigrations({
      connection,
      appVersion: 'x',
      migrationsDir: dir
    })).rejects.toMatchObject({ code: 'MIGRATION_ORDER_GAP' });
    expect(connection.calls).not.toContainEqual([one, undefined]);
  });
});
