const path = require('path');
const dotenv = require('dotenv');

const appRoot = path.resolve(__dirname, '..', '..');
const FIRST_RUN_BOOTSTRAP_LOCK = 'sage_first_run_onboarding';
const dataDir = process.env.SAGE_DATA_DIR;
const explicitConfigFile = process.env.SAGE_CONFIG_FILE;

if (dataDir && !path.isAbsolute(dataDir)) {
  throw new Error('SAGE_DATA_DIR deve ser um caminho absoluto');
}
if (explicitConfigFile && !path.isAbsolute(explicitConfigFile)) {
  throw new Error('SAGE_CONFIG_FILE deve ser um caminho absoluto');
}

const configFile = explicitConfigFile
  ? explicitConfigFile
  : dataDir
    ? path.join(dataDir, 'config', 'sage.env')
    : path.join(appRoot, '.env');

dotenv.config({ path: configFile, debug: false, quiet: true });

if (process.env.NODE_ENV === 'production' && !process.env.SAGE_DATA_DIR) {
  throw new Error('SAGE_DATA_DIR deve ser configurado em produção para guardar estado fora do release');
}

const numericEnvironment = Object.freeze({
  PORT: [3000, 1, 65535], DB_PORT: [3306, 1, 65535], DB_CONNECTION_LIMIT: [10, 1, 100], DB_QUEUE_LIMIT: [100, 0, 10000],
  REDIS_PORT: [6379, 1, 65535], REDIS_DB: [0, 0, 15], SMTP_PORT: [587, 1, 65535],
  CATRACA_TIMEOUT: [10000, 1, 300000], CATRACA_RETRY_ATTEMPTS: [3, 0, 100], CATRACA_RETRY_DELAY: [1000, 0, 60000],
  CATRACA_LOAD_LOGS_TIMEOUT: [60000, 1, 3600000], CATRACA_DELAY_APOS_BACKUP_MS: [15000, 0, 600000],
  CATRACA_ZERAR_LOGS_TIMEOUT_MS: [180000, 1, 3600000], CATRACA_BACKUP_CHUNK_SIZE: [2000, 1, 100000],
  CATRACA_LOGS_INFO_THRESHOLD: [5000, 1, 1000000], CATRACA_USER_ID_OFFSET: [undefined, 0, Number.MAX_SAFE_INTEGER],
  CATRACA_ENTRADA_PORTAL_ID: [1, 0, Number.MAX_SAFE_INTEGER], CATRACA_SAIDA_PORTAL_ID: [2, 0, Number.MAX_SAFE_INTEGER],
  CATRACA_MIN_LOG_ID: [0, 0, Number.MAX_SAFE_INTEGER], CATRACA_RETRY_DELAY_1_MS: [2000, 0, 60000],
  CATRACA_RETRY_DELAY_2_MS: [5000, 0, 60000], CATRACA_RETRY_DELAY_3_MS: [10000, 0, 60000],
  MONITOR_POLLING_INTERVAL_MS: [20000, 1000, 3600000], MONITOR_CALLBACK_PORT: [3000, 1, 65535],
  MONITOR_MAX_EVENT_AGE_SECONDS: [300, 1, 86400], MONITOR_SYNC_LIMIT: [200, 1, 100000],
  HEALTH_CHECK_INTERVAL: [60000, 1000, 3600000], SYNC_BATCH_SIZE: [50, 1, 1000], SYNC_PARALLEL_LIMIT: [3, 1, 100],
  SYNC_PASSO_PONTEIRO: [25, 1, 100000], REQUEST_TIMEOUT: [30000, 1, 3600000], IMPORT_TIMEOUT_MS: [300000, 1, 3600000],
  UPLOAD_MAX_SIZE_MB: [25, 1, 1024], WS_PING_INTERVAL: [30000, 1, 3600000], WS_PING_TIMEOUT: [60000, 1, 3600000],
  BACKUP_MAX_HORAS: [24, 1, 8760], BACKUP_RETER_DIAS: [14, 1, 3650], BACKUP_RETER_MINIMO: [3, 1, 1000],
  SAGE_RUNTIME_SCHEMA_RETRY_ATTEMPTS: [10, 1, 10], SAGE_RUNTIME_SCHEMA_RETRY_DELAY_MS: [3000, 1, 10000]
});

function readInteger(name, [defaultValue, minimum, maximum]) {
  const rawValue = process.env[name];
  if (rawValue === undefined) return defaultValue;
  if (!/^\d+$/.test(rawValue)) {
    throw new Error(`Configuração inválida para ${name}. Consulte .env.example.`);
  }
  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Configuração inválida para ${name}. Consulte .env.example.`);
  }
  return value;
}

const numericConfig = Object.freeze(Object.fromEntries(
  Object.entries(numericEnvironment).map(([name, definition]) => [name, readInteger(name, definition)])
));

const config = Object.freeze({
  jobs: Object.freeze({
    catracaSyncEnabled: (process.env.CATRACA_SYNC_ENABLED || 'true').toLowerCase() !== 'false',
    monitorPollingIntervalMs: numericConfig.MONITOR_POLLING_INTERVAL_MS,
    healthCheckIntervalMs: numericConfig.HEALTH_CHECK_INTERVAL,
    syncBatchSize: numericConfig.SYNC_BATCH_SIZE,
    syncCheckInterval: process.env.SYNC_CHECK_INTERVAL || '*/5 * * * *',
    promocaoCron: (process.env.PROMOCAO_CRON || 'false').trim(),
    backupCron: (process.env.BACKUP_CRON || '0 3 * * *').trim()
  })
});

module.exports = { appRoot, configFile, config, numericConfig, numericEnvironment, FIRST_RUN_BOOTSTRAP_LOCK };
