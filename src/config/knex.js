const knex = require('knex');

const config = {
  client: 'mysql2',
  connection: {
    host: 'localhost',
    user: 'root',
    password: 'root',
    database: 'checkly'
  }
};

const db = knex(config);

module.exports = db;
