const mysql = require('mysql2/promise');
const path = require('path');
const { hasCompatibleSchema } = require('../src/services/readinessService');
const { MigrationError, verifyMigrationState } = require('./migration-runner');

async function verifyRuntimeSchema() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'sage'
  });
  try {
    if (!await hasCompatibleSchema(connection)) {
      throw new MigrationError('Schema incompatível com esta versão', 'SCHEMA_INCOMPATIBLE');
    }
    return await verifyMigrationState({
      connection,
      migrationsDir: path.join(__dirname, '..', 'database', 'migrations')
    });
  } finally {
    await connection.end().catch(() => {});
  }
}

module.exports = { verifyRuntimeSchema };
