const knex = require('knex');
const logger = require('./logger');

const config = {
  client: 'mysql2',
  connection: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'sage',
    timezone: process.env.DB_TIMEZONE || '-03:00'
  },
  pool: {
    min: 2,
    max: parseInt(process.env.DB_CONNECTION_LIMIT || '10')
  }
};

const db = knex(config);

// Testar conexão Knex
db.raw('SELECT 1')
  .then(() => {
    logger.info('Knex conectado ao MySQL');
  })
  .catch((err) => {
    logger.error(`Erro no Knex: ${err.message}`);
  });

module.exports = db;
