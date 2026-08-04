const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { criarBancoDeTeste, configConexao, temBancoDisponivel } = require('./helpers/banco');

const execFileAsync = promisify(execFile);
const ROOT = path.join(__dirname, '..');
const describeMySql = await temBancoDisponivel() ? describe : describe.skip;

describeMySql('gate read-only antes da API (MySQL 8.4)', () => {
  it('funciona com SELECT e recusa iniciar quando o ledger exige intervenção', async () => {
    const banco = await criarBancoDeTeste('runtime_gate');
    const config = configConexao();
    try {
      const runtimeEnv = {
        ...process.env,
        DB_HOST: config.host,
        DB_PORT: String(config.port),
        DB_USER: config.user,
        DB_PASSWORD: config.password,
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
      await banco.destruir();
    }
  }, 120000);
});
