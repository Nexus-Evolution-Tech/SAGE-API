const mysql = require('mysql2');
const env = require('./environment');

const pool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.database,
  timezone: env.db.timezone,
  waitForConnections: env.db.waitForConnections,
  connectionLimit: env.db.connectionLimit,
  queueLimit: env.db.queueLimit
});

module.exports = pool.promise(); // Usamos pool.promise() para trabalhar com Promises