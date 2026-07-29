const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const { criarBancoDeTeste, configConexao, temBancoDisponivel } = require('./helpers/banco');

const execFileAsync = promisify(execFile);
const ROOT = path.join(__dirname, '..');
const describeMySql = await temBancoDisponivel() ? describe : describe.skip;

describeMySql('gate read-only antes da API (MySQL 8.4)', () => {
  it('funciona com SELECT e recusa iniciar quando o ledger exige intervenção', async () => {
    const banco = await criarBancoDeTeste('runtime_gate');
    const config = configConexao();
    const admin = await mysql.createConnection(config);
    const user = `sage_gate_${process.pid}`;
    const password = crypto.randomBytes(24).toString('base64url');
    try {
      await admin.query(`DROP USER IF EXISTS '${user}'@'%'`);
      await admin.query(`CREATE USER '${user}'@'%' IDENTIFIED BY ?`, [password]);
      await admin.query(`GRANT SELECT ON \`${banco.nome}\`.* TO '${user}'@'%'`);
      const runtimeEnv = {
        ...process.env,
        DB_HOST: config.host,
        DB_PORT: String(config.port),
        DB_USER: user,
        DB_PASSWORD: password,
        DB_NAME: banco.nome,
        NODE_ENV: 'production',
        LOG_LEVEL: 'error'
      };
      const gate = `require(${JSON.stringify(path.join(ROOT, 'scripts/runtime-schema-gate.js'))})`
        + '.verifyRuntimeSchema().then(() => process.exit(0)).catch(() => process.exit(1))';
      await expect(execFileAsync(process.execPath, ['-e', gate], { env: runtimeEnv })).resolves.toBeTruthy();

      await banco.pool.query("UPDATE schema_migrations SET status = 'failed' WHERE version = '0000'");
      await expect(execFileAsync(
        process.execPath,
        [path.join(ROOT, 'scripts/start-with-setup.js')],
        {
          timeout: 5000,
          env: runtimeEnv
        }
      )).rejects.toMatchObject({ code: 1 });
    } finally {
      await admin.query(`DROP USER IF EXISTS '${user}'@'%'`).catch(() => {});
      await admin.end().catch(() => {});
      await banco.destruir();
    }
  }, 120000);
});
