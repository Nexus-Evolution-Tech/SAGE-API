const { REQUIRED_COLUMNS } = require('../src/services/readinessService');
const mysql = require('mysql2/promise');
const { configConexao, criarBancoDeTeste, temBancoDisponivel } = require('./helpers/banco');
const {
  BASELINE_REQUIRED_TABLES,
  BASELINE_VERSION,
  ensureLegacyBaseline,
  readBaseline
} = require('../scripts/legacy-baseline');

function connection({ ledger = [], duplicates = [], schemaOk = true, tablesOk = true } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push([sql, params]);
      if (sql.startsWith('SELECT DATABASE()')) return [[{ schema_name: 'sage_baseline_test' }]];
      if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
      if (sql.includes('RELEASE_LOCK')) return [[{ released: 1 }]];
      if (sql.startsWith('SELECT version')) return [ledger];
      if (sql.includes('GROUP BY dispositivo_id, catraca_log_id')) return [duplicates];
      if (sql.includes('information_schema.COLUMNS')) {
        return [schemaOk ? REQUIRED_COLUMNS.map((entry) => {
          const [TABLE_NAME, COLUMN_NAME] = entry.split('.');
          return { TABLE_NAME, COLUMN_NAME };
        }) : []];
      }
      if (sql.includes('information_schema.STATISTICS')) return [[
        { COLUMN_NAME: 'dispositivo_id', NON_UNIQUE: 0 },
        { COLUMN_NAME: 'catraca_log_id', NON_UNIQUE: 0 }
      ]];
      if (sql.includes('information_schema.TABLES')) {
        return [tablesOk ? BASELINE_REQUIRED_TABLES.map((TABLE_NAME) => ({ TABLE_NAME })) : []];
      }
      if (sql.startsWith('INSERT INTO schema_migrations')) {
        ledger.push({ version: params[0], checksum: params[1], status: 'applied' });
      }
      return [[]];
    }
  };
}

describe('baseline legado 0000', () => {
  it('normaliza uma vez, valida as sentinelas e só então registra o checkpoint local', async () => {
    const db = connection();
    const normalized = [];
    const checkpoint = await readBaseline();

    await expect(ensureLegacyBaseline({
      connection: db,
      appVersion: '8.0.0',
      normalizeLegacy: async () => normalized.push('run')
    })).resolves.toEqual({ adopted: true });

    expect(normalized).toEqual(['run']);
    expect(db.calls.findIndex(([sql]) => sql.startsWith('INSERT INTO schema_migrations')))
      .toBeGreaterThan(db.calls.findIndex(([sql]) => sql.includes('information_schema.STATISTICS')));
    expect(db.calls.find(([sql]) => sql.startsWith('INSERT INTO schema_migrations'))[1])
      .toEqual([BASELINE_VERSION, checkpoint.checksum, '8.0.0']);
  });

  it('nunca normaliza novamente quando 0000 já está marcado', async () => {
    const checkpoint = await readBaseline();
    const db = connection({
      ledger: [{ version: BASELINE_VERSION, checksum: checkpoint.checksum, status: 'applied' }]
    });
    const normalizeLegacy = vi.fn();

    await expect(ensureLegacyBaseline({ connection: db, appVersion: '8.0.0', normalizeLegacy }))
      .resolves.toEqual({ adopted: false });
    expect(normalizeLegacy).not.toHaveBeenCalled();
  });

  it('rejeita migrations sem baseline e não normaliza um estado parcialmente versionado', async () => {
    const db = connection({
      ledger: [{ version: '0001', checksum: 'a'.repeat(64), status: 'applied' }]
    });
    const checkpoint = await readBaseline();
    const interrupted = connection({
      ledger: [{ version: BASELINE_VERSION, checksum: checkpoint.checksum, status: 'in_progress' }]
    });
    const normalizeLegacy = vi.fn();

    await expect(ensureLegacyBaseline({ connection: db, appVersion: '8.0.0', normalizeLegacy }))
      .rejects.toMatchObject({ code: 'BASELINE_MISSING_WITH_APPLIED_MIGRATIONS' });
    await expect(ensureLegacyBaseline({
      connection: interrupted, appVersion: '8.0.0', normalizeLegacy
    })).rejects.toMatchObject({ code: 'MIGRATION_REQUIRES_INTERVENTION' });
    expect(normalizeLegacy).not.toHaveBeenCalled();
  });

  it('não registra 0000 quando há duplicatas não nulas ou sentinela incompatível', async () => {
    const duplicate = connection({ duplicates: [{ dispositivo_id: 7, catraca_log_id: 9, total: 2 }] });
    const incompatible = connection({ tablesOk: false });
    const normalizeLegacy = vi.fn();

    await expect(ensureLegacyBaseline({
      connection: duplicate, appVersion: '8.0.0', normalizeLegacy
    })).rejects.toMatchObject({ code: 'DUPLICATE_ACCESS_LOGS' });
    await expect(ensureLegacyBaseline({
      connection: incompatible, appVersion: '8.0.0', normalizeLegacy: async () => {}
    })).rejects.toMatchObject({ code: 'BASELINE_READINESS_FAILED' });
    for (const db of [duplicate, incompatible]) {
      expect(db.calls.some(([sql]) => sql.startsWith('INSERT INTO schema_migrations'))).toBe(false);
    }
    expect(normalizeLegacy).not.toHaveBeenCalled();
  });
});

const describeMySql = await temBancoDisponivel() ? describe : describe.skip;

describeMySql('baseline legado 0000 no MySQL real (CI: 8.4)', () => {
  let banco;

  beforeAll(async () => {
    banco = await criarBancoDeTeste('legacy_baseline');
  }, 120000);

  afterAll(async () => {
    if (banco) await banco.destruir();
  });

  it('adota schema legado compatível sem executar normalização duas vezes', async () => {
    const connection = await mysql.createConnection({ ...configConexao(), database: banco.nome });
    const normalizeLegacy = vi.fn();
    try {
      await expect(ensureLegacyBaseline({
        connection, appVersion: '8.0.0', normalizeLegacy
      })).resolves.toEqual({ adopted: true });
      await expect(ensureLegacyBaseline({
        connection, appVersion: '8.0.0', normalizeLegacy
      })).resolves.toEqual({ adopted: false });
      const [ledger] = await connection.query(
        'SELECT version FROM schema_migrations ORDER BY version'
      );
      expect(ledger).toEqual([{ version: BASELINE_VERSION }]);
      expect(normalizeLegacy).toHaveBeenCalledTimes(1);
    } finally {
      await connection.end();
    }
  });
});
