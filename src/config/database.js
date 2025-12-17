console.log('[BOOT-DB] carregando mysql2...');
const mysql = require('mysql2');
console.log('[BOOT-DB] mysql2 carregado');
const logger = require('./logger');
console.log('[BOOT-DB] logger carregado');

// Validações de pool
const connectionLimit = parseInt(process.env.DB_CONNECTION_LIMIT || '10');
const queueLimit = parseInt(process.env.DB_QUEUE_LIMIT || '100');

if (connectionLimit < 5) {
  logger.warn('DB_CONNECTION_LIMIT está baixo (<5), recomenda-se pelo menos 10');
}

console.log('[BOOT-DB] criando pool...');
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'sage',
  timezone: process.env.DB_TIMEZONE || '-03:00',
  waitForConnections: true,
  connectionLimit: connectionLimit,
  queueLimit: queueLimit,
  enableKeepAlive: true,
  connectTimeout: 2000
});
console.log('[BOOT-DB] pool criado');

// Usar pool.promise() para trabalhar com Promises
const promisePool = pool.promise();
console.log('[BOOT-DB] pool.promise pronto');

// Adicionar método de health check
promisePool.healthCheck = async () => {
  try {
    await promisePool.query('SELECT 1');
    return true;
  } catch (err) {
    logger.debug(`Health check falhou: ${err.message}`);
    return false;
  }
};

// Adicionar método de encerramento graceful
promisePool.end = (callback) => {
  pool.end((err) => {
    if (callback) callback(err);
  });
};

// Log de aviso se banco não estiver configurado
if (!process.env.DB_HOST || !process.env.DB_USER) {
  logger.warn('⚠ Variáveis de banco não configuradas. Verifique .env');
}

module.exports = promisePool;