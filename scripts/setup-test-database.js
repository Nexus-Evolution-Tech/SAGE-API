const mysql = require('mysql2/promise');

function assertTestDatabaseName(name) {
  if (typeof name !== 'string' || !name.endsWith('_teste')) {
    throw new Error('DB_NAME de teste deve terminar em _teste');
  }
  return name;
}

async function setupTestDatabase() {
  const database = assertTestDatabaseName(process.env.DB_NAME);
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number.parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || ''
  });

  try {
    await connection.query('DROP DATABASE IF EXISTS ??', [database]);
    await connection.query(
      'CREATE DATABASE ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
      [database]
    );
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  setupTestDatabase().catch((error) => {
    process.stderr.write(`Falha ao preparar banco descartavel: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { assertTestDatabaseName, setupTestDatabase };
