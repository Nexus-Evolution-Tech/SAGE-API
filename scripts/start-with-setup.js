const { assertSecurityConfiguration } = require('../src/config/env');
assertSecurityConfiguration();
const { spawn } = require('child_process');

const TRANSIENT_MYSQL_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'PROTOCOL_CONNECTION_LOST',
  'ER_CON_COUNT_ERROR',
  'ER_SERVER_SHUTDOWN'
]);
const DEFAULT_RETRY_ATTEMPTS = 10;
const DEFAULT_RETRY_DELAY_MS = 3000;

function boundedPositiveInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback;
}

function isTransientMySqlError(error) {
  return TRANSIENT_MYSQL_CODES.has(error && error.code);
}

async function verificarESetup() {
  // A conta da API não recebe DDL. O instalador aplica migrations com outra credencial; na
  // partida, o runtime apenas confere schema, checksums e estados antes de aceitar tráfego.
  const { verifyRuntimeSchema } = require('./runtime-schema-gate');
  await verifyRuntimeSchema();
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function verificarESetupComRetry({
  verify = verificarESetup,
  retryAttempts = boundedPositiveInteger(
    process.env.SAGE_RUNTIME_SCHEMA_RETRY_ATTEMPTS,
    DEFAULT_RETRY_ATTEMPTS,
    DEFAULT_RETRY_ATTEMPTS
  ),
  retryDelayMs = boundedPositiveInteger(
    process.env.SAGE_RUNTIME_SCHEMA_RETRY_DELAY_MS,
    DEFAULT_RETRY_DELAY_MS,
    10000
  ),
  sleep = esperar
} = {}) {
  for (let retry = 0; ; retry += 1) {
    try {
      return await verify();
    } catch (error) {
      if (!isTransientMySqlError(error) || retry >= retryAttempts) {
        throw error;
      }

      console.warn(`MySQL ainda não está pronto; nova tentativa em ${retryDelayMs}ms (${retry + 1}/${retryAttempts}).`);
      await sleep(retryDelayMs);
    }
  }
}

function iniciarServidor() {
  // Executar verificação e depois iniciar servidor
  verificarESetupComRetry()
    .then(() => {
    // A credencial de bootstrap é de uso único e não deve ser herdada pelo processo da API.
    delete process.env.SAGE_INITIAL_ADMIN_LOGIN;
    delete process.env.SAGE_INITIAL_ADMIN_PASSWORD;
    delete process.env.SAGE_INITIAL_SCHOOL_NAME;

    console.log(' Iniciando servidor...\n');
    
    // Iniciar com nodemon se estiver em dev, senão node normal
    const isProduction = process.env.NODE_ENV === 'production';
    const command = isProduction ? process.execPath : 'nodemon';
    const args = ['index.js'];
    
    const child = spawn(command, args, {
      stdio: 'inherit',
      detached: false // Garante que o child é kill junto com o parent
    });

    // Propagar sinais SIGINT (Ctrl+C) e SIGTERM para o child
    process.on('SIGINT', () => {
      child.kill('SIGINT');
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      child.kill('SIGTERM');
      process.exit(0);
    });

    child.on('exit', (code) => {
      process.exit(code);
    });
    })
    .catch((error) => {
      console.error(' Erro fatal:', error);
      process.exit(1);
    });
}

if (require.main === module) {
  iniciarServidor();
}

module.exports = {
  DEFAULT_RETRY_ATTEMPTS,
  DEFAULT_RETRY_DELAY_MS,
  isTransientMySqlError,
  verificarESetupComRetry
};
