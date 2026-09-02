const os = require('os');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const RAIZ = path.join(__dirname, '..');
const ENV = path.join(RAIZ, 'src', 'config', 'env.js');
const PATHS = path.join(RAIZ, 'src', 'config', 'paths.js');
const ENV_EXAMPLE = path.join(RAIZ, '.env.example');
const WINDOWS_STATE = path.join(RAIZ, 'installer', 'windows', 'initialize-state.ps1');

function ambiente(extra = {}) {
  const env = { ...process.env, NODE_ENV: 'production', ...extra };
  delete env.SAGE_CONFIG_FILE;
  return env;
}

async function executar(modulo, env) {
  try {
    await execFileAsync(process.execPath, ['-e', `require(${JSON.stringify(modulo)})`], { cwd: RAIZ, env });
    return { code: 0, output: '' };
  } catch (erro) {
    return { code: erro.code, output: `${erro.stdout || ''}${erro.stderr || ''}` };
  }
}

async function executarValidacaoDeSeguranca(env) {
  try {
    await execFileAsync(process.execPath, ['-e', `require(${JSON.stringify(ENV)}).assertSecurityConfiguration()`], { cwd: RAIZ, env });
    return { code: 0, output: '' };
  } catch (erro) {
    return { code: erro.code, output: `${erro.stdout || ''}${erro.stderr || ''}` };
  }
}

async function lerJobs(env) {
  const script = `process.stdout.write(JSON.stringify(require(${JSON.stringify(ENV)}).config.jobs))`;
  const { stdout } = await execFileAsync(process.execPath, ['-e', script], { cwd: RAIZ, env });
  return JSON.parse(stdout);
}

describe('R0-03 — configuração fail-fast', () => {
  const dataDir = path.join(os.tmpdir(), `sage-config-${process.pid}`);

  it.each(['abc', '0', '-1', '', '3600001'])(
    'impede o boot com MONITOR_POLLING_INTERVAL_MS inválido',
    async (valor) => {
      const resultado = await executar(ENV, ambiente({
        SAGE_DATA_DIR: dataDir,
        MONITOR_POLLING_INTERVAL_MS: valor
      }));

      expect(resultado.code).not.toBe(0);
      expect(resultado.output).toContain('MONITOR_POLLING_INTERVAL_MS');
    }
  );

  it('não expõe valor de configuração inválido na mensagem de boot', async () => {
    const segredo = 'sentinela-secreta-nao-ecoar-7f31c9b2';
    const resultado = await executar(ENV, ambiente({
      SAGE_DATA_DIR: dataDir,
      MONITOR_POLLING_INTERVAL_MS: segredo
    }));

    expect(resultado.code).not.toBe(0);
    expect(resultado.output).toContain('MONITOR_POLLING_INTERVAL_MS');
    expect(resultado.output).not.toContain(segredo);
  });

  it('centraliza os defaults dos jobs', async () => {
    const env = ambiente({ SAGE_DATA_DIR: dataDir });
    for (const chave of ['MONITOR_POLLING_INTERVAL_MS', 'HEALTH_CHECK_INTERVAL', 'SYNC_BATCH_SIZE', 'SYNC_CHECK_INTERVAL']) {
      delete env[chave];
    }

    await expect(lerJobs(env)).resolves.toEqual({
      monitorPollingIntervalMs: 20000,
      healthCheckIntervalMs: 60000,
      syncBatchSize: 50,
      syncCheckInterval: '*/5 * * * *',
      catracaSyncEnabled: true,
      promocaoCron: 'false',
      backupCron: '0 3 * * *',
      heartbeatIntervalMs: 300000,
      heartbeatMaxCatracaAgeSeconds: 1800
    });
  });

  it('alinha os defaults de jobs no exemplo e no instalador Windows', () => {
    const exemplo = fs.readFileSync(ENV_EXAMPLE, 'utf8');
    const windows = fs.readFileSync(WINDOWS_STATE, 'utf8');

    for (const [chave, valor] of Object.entries({
      MONITOR_POLLING_INTERVAL_MS: '20000', SYNC_CHECK_INTERVAL: '*/5 * * * *',
      SYNC_BATCH_SIZE: '50', HEALTH_CHECK_INTERVAL: '60000', PROMOCAO_CRON: 'false', BACKUP_CRON: '0 3 * * *'
    })) {
      expect(exemplo).toContain(`${chave}=${valor}`);
      expect(windows).toContain(`${chave}='${valor}'`);
    }
  });

  it('impede persistir estado no release quando SAGE_DATA_DIR está ausente em produção', async () => {
    const env = ambiente();
    delete env.SAGE_DATA_DIR;

    const resultado = await executar(PATHS, env);

    expect(resultado.code).not.toBe(0);
    expect(resultado.output).toContain('SAGE_DATA_DIR');
  });

  it.each([
    ['curta', 'A'.repeat(42)],
    ['com caractere inválido', `${'A'.repeat(42)}!`]
  ])('recusa chave de credencial de catraca %s em produção', async (_descricao, valor) => {
    const resultado = await executarValidacaoDeSeguranca(ambiente({
      SAGE_DATA_DIR: dataDir,
      SAGE_DEVICE_CREDENTIAL_KEY: valor
    }));

    expect(resultado.code).not.toBe(0);
    expect(resultado.output).toContain('SAGE_DEVICE_CREDENTIAL_KEY');
  });

  it('recusa chave anterior de credencial inválida durante rotação', async () => {
    const resultado = await executarValidacaoDeSeguranca(ambiente({
      SAGE_DATA_DIR: dataDir,
      SAGE_DEVICE_CREDENTIAL_KEY: 'A'.repeat(43),
      SAGE_DEVICE_CREDENTIAL_KEY_PREVIOUS: 'B'.repeat(42)
    }));

    expect(resultado.code).not.toBe(0);
    expect(resultado.output).toContain('SAGE_DEVICE_CREDENTIAL_KEY');
  });
});
