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
  const services = source.slice(
    source.indexOf('Provar serviços privados e recuperação'),
    source.indexOf('Descartar serviços do smoke')
  );
  const serviceCleanup = source.slice(source.indexOf('Descartar serviços do smoke'));

  it('tem as seções necessárias e não deixa a guarda passar vazia', () => {
    expect(bootstrap).not.toBe('');
    expect(cleanup).not.toBe('');
    expect(services).not.toBe('');
    expect(serviceCleanup).not.toBe('');
    expect(source.indexOf('Provar bootstrap privado do MySQL')).toBeLessThan(
      source.indexOf('Descartar estado do smoke MySQL')
    );
    expect(source.indexOf('Provar serviços privados e recuperação')).toBeLessThan(
      source.indexOf('Descartar serviços do smoke')
    );
  });

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

  it('amarra SAGEMySQL ao fixture e valida variáveis efetivas', () => {
    expect(services).toContain('$mysqlSmokeDir = Join-Path $env:RUNNER_TEMP');
    expect(services).toContain('$mysqlServiceIni = Join-Path $mysqlSmokeDir');
    expect(services).toContain('$fixtureData = Join-Path $mysqlSmokeDir');
    expect(services).toContain('$fixtureTmp = Join-Path $mysqlSmokeDir');
    expect(services).toContain("$mysqlXml.service.arguments = '--defaults-file=\"' + $mysqlServiceIni");
    expect(services).toContain('Get-CimInstance Win32_Service -Filter "Name=\'SAGEMySQL\'"');
    expect(services).toContain('Get-Service SAGEMySQL -ErrorAction SilentlyContinue');
    expect(services).toContain('@@GLOBAL.datadir');
    expect(services).toContain('@@GLOBAL.tmpdir');
    expect(services).toContain('@@GLOBAL.log_bin = 1');
    expect(services).toContain('@@GLOBAL.log_bin_trust_function_creators = 1');
    expect(services).toContain('@@GLOBAL.port');
    expect(services).toContain('@@GLOBAL.bind_address');
    expect(services).toContain('Variáveis efetivas do SAGEMySQL divergem do fixture');
    expect(services).toContain('SAGEMySQL efetivo não está em execução');
    expect(services).toContain('Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1');
  });

  it('prova grants da conta efetiva e nega privilégios amplos', () => {
    expect(services).toContain('sage_maintenance');
    expect(services).toContain('SHOW GRANTS;');
    expect(services).toContain('sage_maintenance possui privilégio amplo');
    expect(services).toContain('GRANT OPTION');
    expect(services).not.toMatch(/GRANT\s+.*\bSUPER\b/i);
    expect(services).not.toMatch(/GRANT\s+ALL\s+PRIVILEGES\s+ON\s+\*\.\*/i);
    expect(services).not.toMatch(/SET\s+GLOBAL\s+log[-_]bin[-_]trust[-_]function[-_]creators/i);
  });

  it('rejeita configuração persistente com opções exclusivas do smoke', () => {
    expect(services).toContain('$persistentIni = Join-Path $state');
    expect(services).toContain('$persistentText = [IO.File]::ReadAllText($persistentIni)');
    expect(services).toContain('Configuração persistente recebeu opção exclusiva do smoke');
    expect(services).toMatch(/\$persistentText -match .*log\[-_\]bin/);
    expect(services).toMatch(/\$persistentText -match .*RUNNER_TEMP/);
    expect(services).not.toMatch(/mysql\.ini[^\n]*(?:log[-_]bin|trust[-_]function[-_]creators)/i);
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

  it('limpa SAGEMySQL, processos, binlogs e o fixture mesmo após falha', () => {
    expect(serviceCleanup).toContain('Stop-Service SAGEMySQL -Force');
    expect(serviceCleanup).toContain('Get-CimInstance Win32_Process');
    expect(serviceCleanup).toContain('Processo residual do fixture MySQL não encerrou');
    expect(serviceCleanup).toContain("Get-ChildItem -LiteralPath $binlogDir -Filter 'sage-smoke-bin.*'");
    expect(serviceCleanup).toContain('Remove-Item -LiteralPath $mysqlSmokeDir -Recurse -Force');
    expect(serviceCleanup).toContain('Fixture MySQL temporário não foi removido');
    expect(serviceCleanup.indexOf('Stop-Service SAGEMySQL -Force')).toBeLessThan(
      serviceCleanup.indexOf('Remove-Item -LiteralPath $mysqlSmokeDir -Recurse -Force')
    );
    expect(serviceCleanup.indexOf("'sage-smoke-bin.*'")).toBeLessThan(
      serviceCleanup.indexOf('Remove-Item -LiteralPath $mysqlSmokeDir -Recurse -Force')
    );
  });

  it('mantém negativos contra datadir produtivo, binlog desligado e trust ad hoc', () => {
    expect(services).not.toMatch(/\$mysqlServiceIni\s*=\s*Join-Path\s+\$state/i);
    expect(services).not.toMatch(/datadir=\$\{?state\}?|datadir=.*CommonApplicationData/i);
    expect(services).not.toMatch(/skip-log-bin|log[-_]bin\s*=\s*0/i);
    expect(services).not.toMatch(/SET\s+GLOBAL\s+log[-_]bin[-_]trust[-_]function[-_]creators/i);
  });
});
