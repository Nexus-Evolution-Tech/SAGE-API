const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const packageJson = require('../package.json');
const { criarBancoDeTeste, configConexao, temBancoDisponivel } = require('./helpers/banco');

const execFileAsync = promisify(execFile);
const ROOT = path.join(__dirname, '..');

const describeMySql = await temBancoDisponivel() ? describe : describe.skip;

describeMySql('setup real registra o ledger de migrations (MySQL 8.4)', () => {
  let banco;

  beforeAll(async () => {
    banco = await criarBancoDeTeste('setup_ledger');
  }, 120000);

  afterAll(async () => {
    if (banco) await banco.destruir();
  });

  it('aplica o baseline e preserva o checkpoint numa segunda execução', async () => {
    const [ledger] = await banco.pool.query(
      `SELECT version, status, app_version, CAST(applied_at AS CHAR) AS applied_at
         FROM schema_migrations ORDER BY version`
    );

    expect(ledger).toEqual(['0000', '0002', '0003', '0004'].map((version) => ({
      version,
      status: 'applied',
      app_version: packageJson.version,
      applied_at: expect.any(String)
    })));

    const config = configConexao();
    const env = {
      ...process.env,
      DB_HOST: config.host,
      DB_PORT: String(config.port),
      DB_USER: config.user,
      DB_PASSWORD: config.password,
      DB_NAME: banco.nome,
      NODE_ENV: 'test',
      LOG_LEVEL: 'error'
    };
    await execFileAsync(process.execPath, [path.join(ROOT, 'scripts/setup-database.js')], { env });
    const [afterUpgrade] = await banco.pool.query(
      `SELECT version, status, app_version, CAST(applied_at AS CHAR) AS applied_at
         FROM schema_migrations ORDER BY version`
    );
    expect(afterUpgrade).toEqual(ledger);
  });
});
