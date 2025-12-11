const knex = require('knex');
const env = require('./environment');

const config = {
  client: 'mysql2',
  connection: {
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    database: env.db.database,
    timezone: env.db.timezone
  }
};

const db = knex(config);

module.exports = db;
