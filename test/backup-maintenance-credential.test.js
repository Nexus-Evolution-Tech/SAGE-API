const fs = require('fs').promises;
const fsSync = require('fs');
const os = require('os');
const path = require('path');
const backup = require('../src/services/backupBanco');

const SOURCE = path.join(__dirname, '..', 'src', 'services', 'backupBanco.js');
const KEYS = [
  'SAGE_MAINTENANCE_CONFIG_FILE', 'MYSQL_DEFAULTS_EXTRA_FILE',
  'SAGE_REQUIRE_MAINTENANCE_DB', 'DB_USER', 'DB_PASSWORD'
];

describe('backup usa credencial privilegiada separada', () => {
  let root;
  let previous;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'sage-maintenance-'));
    previous = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
    const maintenance = path.join(root, 'maintenance.env');
    const defaults = path.join(root, 'maintenance-client.cnf');
    await fs.writeFile(maintenance, [
      'DB_HOST=127.0.0.1', 'DB_PORT=3307', 'DB_USER=sage_maintenance',
      `DB_PASSWORD=${'a'.repeat(43)}`, 'DB_NAME=sage'
    ].join('\n'));
    await fs.writeFile(defaults, [
      '[client]', 'host=127.0.0.1', 'port=3307', 'user=sage_maintenance',
      `password=${'a'.repeat(43)}`, ''
    ].join('\n'));
    process.env.SAGE_MAINTENANCE_CONFIG_FILE = maintenance;
    process.env.MYSQL_DEFAULTS_EXTRA_FILE = defaults;
    process.env.SAGE_REQUIRE_MAINTENANCE_DB = 'true';
    process.env.DB_USER = 'sage_runtime';
    process.env.DB_PASSWORD = 'runtime-nao-deve-ser-usado';
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('seleciona manutenção e põe option file antes das demais opções', () => {
    const cfg = backup.config();
    expect(cfg.user).toBe('sage_maintenance');
    expect(cfg.user).not.toBe(process.env.DB_USER);
    const args = backup.clientArgs(cfg, cfg.defaultsFile, 'sage');
    expect(args[0]).toBe(`--defaults-extra-file=${cfg.defaultsFile}`);
    expect(args).not.toContain(expect.stringMatching(/password/i));
    const childEnv = backup.subprocessEnvironment();
    expect(childEnv).not.toHaveProperty('DB_PASSWORD');
    expect(childEnv).not.toHaveProperty('JWT_SECRET');
  });

  it('falha fechado sem os dois arquivos e recusa link simbólico', async () => {
    delete process.env.SAGE_MAINTENANCE_CONFIG_FILE;
    expect(() => backup.config()).toThrow(/credencial de manutenção separada/);

    const target = process.env.MYSQL_DEFAULTS_EXTRA_FILE;
    const link = path.join(root, 'client-link.cnf');
    await fs.symlink(target, link);
    process.env.SAGE_MAINTENANCE_CONFIG_FILE = path.join(root, 'maintenance.env');
    process.env.MYSQL_DEFAULTS_EXTRA_FILE = link;
    expect(() => backup.config()).toThrow(/Option file do MySQL inválido/);
  });

  it('não entrega senha por argumento nem variável de ambiente do subprocesso', () => {
    const source = fsSync.readFileSync(SOURCE, 'utf8');
    expect(source).not.toMatch(/MYSQL_PWD|--password|-p\$\{/);
    expect(source).toContain("'--no-tablespaces'");
    expect(source).toContain('--defaults-extra-file=${defaultsFile}');
    expect(source).toContain('env: subprocessEnvironment()');
    expect(source).toContain("process.platform === 'win32'");
    expect(source).toContain('Windows exige option file provisionado com DACL privada');
  });
});
