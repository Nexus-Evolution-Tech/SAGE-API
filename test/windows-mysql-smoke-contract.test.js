const fs = require('fs');
const path = require('path');

const WORKFLOW = path.join(__dirname, '..', '.github', 'workflows', 'windows-native.yml');
const INITIALIZER = path.join(__dirname, '..', 'installer', 'windows', 'initialize-mysql.ps1');

describe('fixture do smoke MySQL restrito no Windows', () => {
  const source = fs.readFileSync(WORKFLOW, 'utf8');
  const initializer = fs.readFileSync(INITIALIZER, 'utf8');
  const bootstrap = source.slice(
    source.indexOf('Provar bootstrap privado do MySQL'),
    source.indexOf('Descartar estado do smoke MySQL')
  );
  const cleanup = source.slice(
    source.indexOf('Descartar estado do smoke MySQL'),
    source.indexOf('Provar serviços privados e recuperação')
  );

  it('mantém a confiança de creators somente no processo descartável do smoke', () => {
    expect(source).toContain('wp/r1-122-windows-mysql-smoke-20260826');
    expect(bootstrap).toContain('$env:RUNNER_TEMP');
    expect(bootstrap).toContain('$env:GITHUB_RUN_ID');
    expect(bootstrap).toContain('$env:GITHUB_RUN_ATTEMPT');
    expect(bootstrap).toContain("$myIni = Join-Path $mysqlSmokeDir 'mysql-smoke.ini'");
    expect(bootstrap).toContain('"log-bin=$binlog"');
    expect(bootstrap).toContain("'log-bin-trust-function-creators=1'");
    expect(bootstrap).toContain('"--defaults-file=$myIni"');
    expect(bootstrap).not.toMatch(/skip-log-bin|log[-_]bin\s*=\s*0/i);
    expect(initializer).not.toMatch(/log[-_]bin[-_]trust[-_]function[-_]creators|log[-_]bin\s*=/i);
  });

  it('prova binary logging e confiança com a conta de manutenção', () => {
    expect(bootstrap).toContain("$maintenance = Join-Path $config 'maintenance-client.cnf'");
    expect(bootstrap).toContain('$mysql "--defaults-extra-file=$maintenance"');
    expect(bootstrap).toContain('@@GLOBAL.log_bin = 1');
    expect(bootstrap).toContain('@@GLOBAL.log_bin_trust_function_creators = 1');
    expect(bootstrap).toContain('$binlogFiles = @(Get-ChildItem');
    expect(bootstrap).toContain("'sage-smoke-bin.*'");
    expect(source).not.toMatch(/GRANT\s+.*\bSUPER\b|GRANT\s+ALL\s+PRIVILEGES\s+ON\s+\*\.\*/i);
    expect(source).not.toMatch(/SET\s+GLOBAL\s+log[-_]bin[-_]trust[-_]function[-_]creators/i);
  });

  it('encerra o serviço antes de remover o diretório temporário do fixture', () => {
    expect(cleanup).toContain('$mysqlSmokeDir = Join-Path $env:RUNNER_TEMP');
    expect(cleanup).toContain('Remove-Item -LiteralPath $mysqlSmokeDir -Recurse -Force');
    expect(cleanup.indexOf('Remove-Item -LiteralPath $mysqlSmokeDir -Recurse -Force')).toBeGreaterThan(
      cleanup.indexOf('Stop-Service SAGE-MySQL-Smoke')
    );
    expect(bootstrap.indexOf('Stop-Service SAGE-MySQL-Smoke')).toBeGreaterThan(
      bootstrap.indexOf('$binlogFiles')
    );
  });
});
