const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');
const logger = require('../config/logger');

const REQUIRED_COLUMNS = Object.freeze([
  'UnidadeEscolar.login',
  'UnidadeEscolar.senha',
  'Pessoa.id',
  'Area.foto',
  'Dispositivo.sync_enabled',
  'Dispositivo.control_id_device_id',
  'Dispositivo.ultimo_log_id_sincronizado',
  'Acesso.catraca_log_id',
  'Turma.id',
  'Sala.unidade_id',
  'HorarioAula.divisao',
  'HorarioAula.horario',
  'Presenca.horario_previsto',
  'CalendarioEscolar.data',
  'ExpectativaPresencaSlot.pessoa_id',
  'Excecao.id',
  'RegistroPresenca.id',
  'ConfigSistema.chave',
  'sync_pendente.id'
]);

async function hasCompatibleSchema(db) {
  const [columns] = await db.query(
    `SELECT TABLE_NAME, COLUMN_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()`
  );
  const available = new Set(columns.map(({ TABLE_NAME, COLUMN_NAME }) => (
    `${TABLE_NAME}.${COLUMN_NAME}`.toLowerCase()
  )));
  if (!REQUIRED_COLUMNS.every((column) => available.has(column.toLowerCase()))) return false;

  const [indexColumns] = await db.query(
    `SELECT COLUMN_NAME, NON_UNIQUE
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'Acesso'
        AND INDEX_NAME = 'uq_acesso_dispositivo_catraca_log'
      ORDER BY SEQ_IN_INDEX`
  );
  return indexColumns.length === 2
    && indexColumns.every(({ NON_UNIQUE }) => Number(NON_UNIQUE) === 0)
    && indexColumns.map(({ COLUMN_NAME }) => COLUMN_NAME.toLowerCase()).join(',')
      === 'dispositivo_id,catraca_log_id';
}

async function canWriteDirectory(directory) {
  const probe = path.join(directory, `.sage-readiness-${process.pid}-${randomUUID()}`);
  let handle;
  try {
    handle = await fs.open(probe, 'wx', 0o600);
    await handle.writeFile('ready');
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.unlink(probe);
    return true;
  } catch {
    return false;
  } finally {
    if (handle) await handle.close().catch(() => logger.warn('[READINESS] codigo=PROBE_HANDLE_FECHAR_FALHOU'));
    await fs.unlink(probe).catch(() => logger.warn('[READINESS] codigo=PROBE_ARQUIVO_REMOVER_FALHOU'));
  }
}

function result(ok, failureCode) {
  return { ok, code: ok ? 'ok' : failureCode };
}

function createReadinessChecker({
  db,
  dataDirectories,
  routesReady,
  webReady,
  requireWeb
}) {
  return async function checkReadiness() {
    let databaseOk = false;
    let schemaOk = false;
    try {
      await db.query('SELECT 1');
      databaseOk = true;
    } catch {
      databaseOk = false;
    }
    if (databaseOk) {
      try {
        schemaOk = await hasCompatibleSchema(db);
      } catch {
        schemaOk = false;
      }
    }

    const writable = await Promise.all(dataDirectories.map(canWriteDirectory));
    const directoriesOk = writable.every(Boolean);
    const routesOk = Boolean(routesReady());
    const webOk = !requireWeb || Boolean(webReady());
    const checks = {
      database: result(databaseOk, 'database_unavailable'),
      schema: result(schemaOk, databaseOk ? 'schema_incompatible' : 'database_unavailable'),
      routes: result(routesOk, 'routes_incomplete'),
      dataDirectories: result(directoriesOk, 'data_directories_unwritable'),
      web: result(webOk, 'web_build_missing')
    };

    return {
      ready: Object.values(checks).every(({ ok }) => ok),
      checks
    };
  };
}

function createReadinessHandler(checkReadiness, version) {
  return async function readinessHandler(req, res) {
    const outcome = await checkReadiness();
    return res.status(outcome.ready ? 200 : 503).json({
      status: outcome.ready ? 'ready' : 'not_ready',
      version,
      checks: outcome.checks
    });
  };
}

module.exports = {
  REQUIRED_COLUMNS,
  hasCompatibleSchema,
  canWriteDirectory,
  createReadinessChecker,
  createReadinessHandler
};
