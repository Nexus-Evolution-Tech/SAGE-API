const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { hasCompatibleSchema } = require('../src/services/readinessService');
const {
  LOCK_TIMEOUT_SECONDS,
  MigrationError,
  lockNameForSchema
} = require('./migration-runner');

const BASELINE_VERSION = '0000';
const BASELINE_REQUIRED_TABLES = Object.freeze([
  'UnidadeEscolar', 'UnidadeFoto', 'Area', 'Dispositivo', 'Curso', 'Turma', 'Pessoa', 'Presenca',
  'Responsavel', 'Aluno', 'Funcionario', 'Professor', 'Materia', 'Administrador', 'Sala', 'Empresa',
  'Terceirizado', 'Aula', 'HorarioAula', 'Acesso', 'SolicitacaoAcesso', 'sync_pendente',
  'RecuperacaoSenha', 'ConfigSistema', 'FuncionarioHorario'
]);
const BASELINE_FILE = path.join(
  __dirname,
  '..',
  'database',
  'migrations',
  '0000_legacy_normalized.sql'
);

const rowsOf = (result) => (Array.isArray(result) ? result[0] : result);

async function readBaseline(file = BASELINE_FILE) {
  const sql = await fs.readFile(file, 'utf8');
  return {
    sql,
    checksum: crypto.createHash('sha256').update(sql).digest('hex')
  };
}

async function findDuplicateAccessLogs(connection) {
  const rows = rowsOf(await connection.query(
    `SELECT dispositivo_id, catraca_log_id, COUNT(*) AS total
       FROM Acesso
      WHERE dispositivo_id IS NOT NULL AND catraca_log_id IS NOT NULL
      GROUP BY dispositivo_id, catraca_log_id
     HAVING COUNT(*) > 1
      ORDER BY total DESC, dispositivo_id, catraca_log_id
      LIMIT 10`
  ));
  return rows || [];
}

function failOnDuplicateAccessLogs(duplicates) {
  if (duplicates.length > 0) {
    throw new MigrationError(
      `Há ${duplicates.length} duplicata(s) de logs de catraca não nulos`,
      'DUPLICATE_ACCESS_LOGS'
    );
  }
}

async function diagnoseLegacyDuplicates(connection) {
  try {
    failOnDuplicateAccessLogs(await findDuplicateAccessLogs(connection));
  } catch (error) {
    if (error.code === 'ER_NO_SUCH_TABLE' || error.code === 'ER_BAD_FIELD_ERROR') return;
    throw error;
  }
}

async function hasBaselineSchema(connection) {
  if (!await hasCompatibleSchema(connection)) return false;
  const tables = rowsOf(await connection.query(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()'
  ));
  const available = new Set((tables || []).map(({ TABLE_NAME }) => TABLE_NAME.toLowerCase()));
  return BASELINE_REQUIRED_TABLES.every((table) => available.has(table.toLowerCase()));
}

async function verifyBaselineReadiness(connection, checkSchema = hasBaselineSchema) {
  failOnDuplicateAccessLogs(await findDuplicateAccessLogs(connection));
  if (!await checkSchema(connection)) {
    throw new MigrationError('Sentinelas de schema incompatíveis para o baseline', 'BASELINE_READINESS_FAILED');
  }
}

async function ensureLegacyBaseline({
  connection,
  appVersion,
  normalizeLegacy,
  baselineFile = BASELINE_FILE,
  checkSchema = hasBaselineSchema
}) {
  if (!connection || typeof connection.query !== 'function' || typeof connection.getConnection === 'function') {
    throw new TypeError('connection deve ser uma conexão mysql2 dedicada');
  }
  if (!appVersion || typeof normalizeLegacy !== 'function') {
    throw new TypeError('appVersion e normalizeLegacy são obrigatórios');
  }

  const baseline = await readBaseline(baselineFile);
  const databaseRows = rowsOf(await connection.query('SELECT DATABASE() AS schema_name'));
  const schemaName = databaseRows?.[0]?.schema_name;
  if (!schemaName) throw new MigrationError('Conexão sem schema selecionado', 'DATABASE_NOT_SELECTED');

  const lockName = lockNameForSchema(schemaName);
  let locked = false;
  let primaryError;
  try {
    const lockRows = rowsOf(await connection.query(
      'SELECT GET_LOCK(?, ?) AS acquired', [lockName, LOCK_TIMEOUT_SECONDS]
    ));
    if (Number(lockRows?.[0]?.acquired) !== 1) {
      throw new MigrationError('Não foi possível adquirir o lock de migrations', 'LOCK_NOT_ACQUIRED');
    }
    locked = true;
    await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(4) NOT NULL PRIMARY KEY,
      checksum CHAR(64) NOT NULL,
      status ENUM('in_progress', 'applied', 'failed') NOT NULL,
      applied_at DATETIME(6) NULL,
      app_version VARCHAR(255) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    const ledger = rowsOf(await connection.query(
      'SELECT version, checksum, status FROM schema_migrations ORDER BY version'
    )) || [];
    const checkpoint = ledger.find(({ version }) => version === BASELINE_VERSION);

    if (!checkpoint && ledger.length > 0) {
      throw new MigrationError(
        'Ledger contém migrations aplicadas, mas não o baseline 0000',
        'BASELINE_MISSING_WITH_APPLIED_MIGRATIONS'
      );
    }
    if (checkpoint) {
      if (checkpoint.checksum !== baseline.checksum) {
        throw new MigrationError('Checksum divergente no baseline 0000', 'CHECKSUM_DRIFT');
      }
      if (checkpoint.status !== 'applied') {
        throw new MigrationError(
          `Baseline 0000 requer intervenção: ${checkpoint.status}`,
          'MIGRATION_REQUIRES_INTERVENTION'
        );
      }
      await verifyBaselineReadiness(connection, checkSchema);
      return { adopted: false };
    }

    await diagnoseLegacyDuplicates(connection);
    await normalizeLegacy(connection);
    await verifyBaselineReadiness(connection, checkSchema);
    await connection.query(
      `INSERT INTO schema_migrations
        (version, checksum, status, applied_at, app_version)
       VALUES (?, ?, 'applied', CURRENT_TIMESTAMP(6), ?)`,
      [BASELINE_VERSION, baseline.checksum, appVersion]
    );
    return { adopted: true };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (locked) {
      try {
        const rows = rowsOf(await connection.query('SELECT RELEASE_LOCK(?) AS released', [lockName]));
        if (Number(rows?.[0]?.released) !== 1 && !primaryError) {
          throw new MigrationError('Não foi possível liberar o lock', 'LOCK_RELEASE_FAILED');
        }
      } catch (releaseError) {
        if (!primaryError) throw releaseError;
      }
    }
  }
}

module.exports = {
  BASELINE_FILE,
  BASELINE_REQUIRED_TABLES,
  BASELINE_VERSION,
  diagnoseLegacyDuplicates,
  ensureLegacyBaseline,
  findDuplicateAccessLogs,
  hasBaselineSchema,
  readBaseline,
  verifyBaselineReadiness
};
