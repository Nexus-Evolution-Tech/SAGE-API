const mysql = require('mysql2');
const logger = require('./logger');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'sage',
  timezone: process.env.DB_TIMEZONE || '-03:00',
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '10'),
  queueLimit: 0
});

// Testar conexão
pool.getConnection((err, connection) => {
  if (err) {
    logger.error(`Erro ao conectar no MySQL: ${err.message}`);
  } else {
    logger.info(`MySQL conectado: ${process.env.DB_HOST}:${process.env.DB_PORT}`);
    connection.release();
  }
});

module.exports = pool.promise(); // Usamos pool.promise() para trabalhar com Promises