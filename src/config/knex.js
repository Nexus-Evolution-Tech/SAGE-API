const knex = require('knex');

const config = {
  client: 'mysql2',
  connection: {
    host: 'localhost',
    user: 'root',
    password: 'etec',
    database: 'checkly',
    timezone: '-03:00'
  }
};

const db = knex(config);

module.exports = db;
