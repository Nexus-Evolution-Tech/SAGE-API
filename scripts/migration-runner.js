const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const MIGRATION_FILE = /^(\d{4})_([a-z0-9_-]+)\.sql$/;
const LOCK_PREFIX = 'sage:migrations:';
const LOCK_TIMEOUT_SECONDS = 30;

class MigrationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'MigrationError';
    this.code = code;
  }
}

async function loadMigrations(migrationsDir) {
  const files = await fs.readdir(migrationsDir);
  const invalidSql = files.find(
    (file) => file.toLowerCase().endsWith('.sql') && !MIGRATION_FILE.test(file)
  );
  if (invalidSql) {
    throw new MigrationError(`Nome inválido de migration: ${invalidSql}`, 'INVALID_FILENAME');
  }
  const migrations = await Promise.all(files
    .map((file) => ({ file, match: MIGRATION_FILE.exec(file) }))
    .filter(({ match }) => match)
    .map(async ({ file, match }) => {
      const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
      return {
        file,
        version: match[1],
        name: match[2],
        checksum: crypto.createHash('sha256').update(sql).digest('hex'),
        sql
      };
    }));

  migrations.sort((a, b) => a.version.localeCompare(b.version) || a.file.localeCompare(b.file));
  const versions = new Set();
  const names = new Set();
  for (const migration of migrations) {
    if (versions.has(migration.version)) {
      throw new MigrationError(`Versão de migration duplicada: ${migration.version}`, 'DUPLICATE_VERSION');
    }
    if (names.has(migration.name)) {
      throw new MigrationError(`Nome de migration duplicado: ${migration.name}`, 'DUPLICATE_NAME');
    }
    versions.add(migration.version);
    names.add(migration.name);
  }
  if (migrations.length === 0) {
    throw new MigrationError('Nenhuma migration versionada foi encontrada', 'NO_MIGRATIONS');
  }
  return migrations;
}

function rowsOf(result) {
  return Array.isArray(result) ? result[0] : result;
}

function lockNameForSchema(schemaName) {
  const digest = crypto.createHash('sha256').update(schemaName).digest('hex').slice(0, 32);
  return `${LOCK_PREFIX}${digest}`;
}

async function runMigrations({ connection, appVersion, migrationsDir }) {
  if (!connection || typeof connection.query !== 'function') {
    throw new TypeError('connection deve ser uma conexão mysql2 aberta');
  }
  if (typeof connection.getConnection === 'function') {
    throw new TypeError('connection deve ser dedicada; pools mysql2 não são aceitos');
  }
  if (!appVersion || !migrationsDir) {
    throw new TypeError('appVersion e migrationsDir são obrigatórios');
  }

  const migrations = await loadMigrations(migrationsDir);
  const databaseRows = rowsOf(await connection.query('SELECT DATABASE() AS schema_name'));
  const schemaName = databaseRows?.[0]?.schema_name;
  if (!schemaName) {
    throw new MigrationError('Conexão sem schema selecionado', 'DATABASE_NOT_SELECTED');
  }
  const lockName = lockNameForSchema(schemaName);
  let locked = false;
  let primaryError;
  try {
    const lockRows = rowsOf(await connection.query(
      'SELECT GET_LOCK(?, ?) AS acquired', [lockName, LOCK_TIMEOUT_SECONDS]
    ));
    if (!lockRows || Number(lockRows[0]?.acquired) !== 1) {
      throw new MigrationError('Não foi possível adquirir o lock de migrations', 'LOCK_NOT_ACQUIRED');
    }
    locked = true;

    await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(4) NOT NULL PRIMARY KEY,
      checksum CHAR(64) NOT NULL,
      status ENUM('in_progress', 'applied', 'failed') NOT NULL,
      applied_at DATETIME(6) NULL DEFAULT NULL,
      app_version VARCHAR(255) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    const ledgerRows = rowsOf(await connection.query(
      'SELECT version, checksum, status FROM schema_migrations ORDER BY version'
    ));
    const localByVersion = new Map(migrations.map((migration) => [migration.version, migration]));
    const applied = new Map((ledgerRows || []).map((row) => [row.version, row]));

    for (const row of applied.values()) {
      if (row.status !== 'applied') {
        throw new MigrationError(
          `Migration ${row.version} está em estado ${row.status}; intervenção manual obrigatória`,
          'MIGRATION_REQUIRES_INTERVENTION'
        );
      }
      const local = localByVersion.get(row.version);
      if (!local) {
        throw new MigrationError(`Ledger contém versão sem arquivo local: ${row.version}`, 'MISSING_LOCAL_FILE');
      }
      if (local.checksum !== row.checksum) {
        throw new MigrationError(`Checksum divergente na migration ${row.version}`, 'CHECKSUM_DRIFT');
      }
    }

    let foundPending = false;
    for (const migration of migrations) {
      if (!applied.has(migration.version)) foundPending = true;
      else if (foundPending) {
        throw new MigrationError(
          `Migration posterior aplicada antes de uma pendente: ${migration.version}`,
          'MIGRATION_ORDER_GAP'
        );
      }
    }

    const executed = [];
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      let inProgress = false;
      try {
        await connection.query(
          'INSERT INTO schema_migrations (version, checksum, app_version, status) VALUES (?, ?, ?, ?)',
          [migration.version, migration.checksum, appVersion, 'in_progress']
        );
        inProgress = true;
        await connection.query(migration.sql);
        const statusResult = rowsOf(await connection.query(
          `UPDATE schema_migrations SET status = 'applied', applied_at = CURRENT_TIMESTAMP(6)
            WHERE version = ? AND status = 'in_progress'`,
          [migration.version]
        ));
        if (Number(statusResult?.affectedRows) !== 1) {
          throw new MigrationError(
            `Não foi possível concluir o estado da migration ${migration.version}`,
            'MIGRATION_STATUS_UPDATE_FAILED'
          );
        }
      } catch (error) {
        if (inProgress) {
          await connection.query(
            `UPDATE schema_migrations SET status = 'failed'
              WHERE version = ? AND status = 'in_progress'`,
            [migration.version]
          ).catch(() => {});
        }
        throw error;
      }
      executed.push(migration.version);
    }
    return { applied: executed, discovered: migrations.map(({ version }) => version) };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (locked) {
      try {
        const releaseRows = rowsOf(await connection.query(
          'SELECT RELEASE_LOCK(?) AS released', [lockName]
        ));
        if (Number(releaseRows?.[0]?.released) !== 1 && !primaryError) {
          throw new MigrationError('Não foi possível liberar o lock', 'LOCK_RELEASE_FAILED');
        }
      } catch (releaseError) {
        if (!primaryError) throw releaseError;
      }
    }
  }
}

module.exports = {
  LOCK_PREFIX, LOCK_TIMEOUT_SECONDS, MigrationError, loadMigrations, lockNameForSchema, runMigrations
};
