const fs = require('fs');
const path = require('path');

const WORKFLOW = path.join(__dirname, '..', '.github', 'workflows', 'windows-native.yml');
const INITIALIZER = path.join(__dirname, '..', 'installer', 'windows', 'initialize-mysql.ps1');
const FIXTURE = path.join(__dirname, 'support', 'windows-mysql-fixture.ps1');
const RUNBOOK = path.join(__dirname, '..', 'docs', 'windows-mysql-smoke.md');

describe('fixture do smoke MySQL restrito no Windows', () => {
  const source = fs.readFileSync(WORKFLOW, 'utf8');
  const initializer = fs.readFileSync(INITIALIZER, 'utf8');
  const fixture = fs.readFileSync(FIXTURE, 'utf8');
  const runbook = fs.readFileSync(RUNBOOK, 'utf8');
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
    expect(services).toContain('Stop-Service SAGEAPI -Force');
    expect(services).toContain('Get-CimInstance Win32_Service -Filter "Name=\'SAGEAPI\'"');
    expect(services).toContain("$apiPathNames -notcontains $apiBeforeUninstall.PathName.Trim()");
    expect(services).toContain("$apiBeforeUninstallService.WaitForStatus('Stopped'");
    expect(services).toContain('& $sc delete SAGEAPI');
    expect(services).toContain('$apiDeleteConfirmed = $false');
    expect(services).toContain('1060|1072|MARKED FOR DELETE|MARKED FOR DELETION');
    expect(services).toContain('Registro SAGEAPI não ficou ausente ou marcado para exclusão');
    expect(services.indexOf('Stop-Service SAGEAPI -Force')).toBeLessThan(
      services.indexOf('& $sc delete SAGEAPI')
    );
    const firstUninstall = services.indexOf("service\\uninstall-services.ps1')");
    const teardownBeforeUninstall = services.slice(services.indexOf('$sentinels'), firstUninstall);
    expect(teardownBeforeUninstall).not.toContain('Stop-Service SAGEMySQL');
    expect(teardownBeforeUninstall).not.toContain('mysqlWinsw uninstall');
    expect(teardownBeforeUninstall).not.toContain('--remove SAGEMySQL');
    expect(firstUninstall).toBeGreaterThan(services.indexOf('$apiDeleteConfirmed = $false'));
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
  it('executa a precondição descartável também no workflow nativo', () => {
    expect(source).toContain('Provar precondição descartável MySQL/schema R2-02');
    expect(source).toContain('test\\support\\windows-mysql-fixture.ps1');
    expect(source).toContain('-Commit $env:GITHUB_SHA');
    expect(source).not.toContain('ubuntu-latest');
    expect(fixture).toContain('scripts\\setup-database.js');
    expect(fixture).toContain('SAGE_ALLOW_FIRST_RUN_ONBOARDING');
    expect(fixture).toContain('$global:LASTEXITCODE = 0');
    expect(fixture).not.toContain('--skip-grant-tables');
  });

  it('guarda isolamento, readiness, schema, privilégio restrito e cleanup', () => {
    expect(fixture).toContain('Assert-TemporaryPath');
    expect(fixture).toContain('New-AvailablePort');
    expect(fixture).toContain('Assert-PortAvailable $port');
    expect(fixture).toContain("$client.Connect('127.0.0.1', $Port)");
    expect(fixture).toContain('Get-FixtureProcesses');
    expect(fixture).toContain('Get-FixtureListeners');
    expect(fixture).toContain('Invoke-AuthenticatedShutdown');
    expect(fixture).toContain('Stop-FixtureServer $Root $MysqlPath $Parent');
    expect(fixture).toContain("GRANT SHUTDOWN ON *.* TO 'sage_maintenance'");
    expect(fixture).toContain('OwningProcess');
    expect(fixture).toContain('ExecutablePath');
    expect(fixture).toContain('CommandLine');
    expect(fixture).toContain('log-bin-trust-function-creators=1');
    expect(fixture).toContain('bind-address=127.0.0.1');
    expect(fixture).toContain('Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1');
    expect(fixture).toContain('information_schema.TABLES');
    expect(fixture).toContain('SHOW GRANTS;');
    expect(fixture).toContain('SUPER|GRANT OPTION');
    expect(fixture).toContain('password=$maintenanceSecret');
    expect(fixture).toContain('finally');
    expect(fixture).toContain('Remove-Item -LiteralPath $Root -Recurse -Force');
    expect(fixture).toContain('service-absent process=0 listener=0');
    const cleanupStart = fixture.indexOf('function Cleanup-Fixture');
    const cleanupEnd = fixture.indexOf('function New-AvailablePort');
    expect(fixture.slice(cleanupStart, cleanupEnd)).not.toContain('Get-NetTCPConnection');
  });

  it('documenta Windows 11 x64, Ubuntu N/A e evidência sanitizada', () => {
    expect(runbook).toContain('Windows 11 x64');
    expect(runbook).toContain('Ubuntu é N/A neste ciclo');
    expect(runbook).toContain('npm ci --ignore-scripts');
    expect(runbook).toContain('evidence=R2-02-precond');
    expect(runbook).toContain('Não redirecione credenciais');
  });
});
describe('contrato KeepAlive da fixture MySQL Windows 11', () => {
  const source = fs.readFileSync(WORKFLOW, 'utf8');
  const fixture = fs.readFileSync(FIXTURE, 'utf8');
  const runbook = fs.readFileSync(RUNBOOK, 'utf8');

  it('mantem Run no workflow e adiciona KeepAlive sem mudar o bootstrap autenticado', () => {
    const invocationStart = source.indexOf('& $fixture -MysqlRoot $mysqlRoot');
    const invocationEnd = source.indexOf('if ($LASTEXITCODE -ne 0)', invocationStart);
    const precondition = source.slice(invocationStart, invocationEnd);
    expect(invocationStart).toBeGreaterThan(-1);
    expect(invocationEnd).toBeGreaterThan(invocationStart);
    expect(fixture).toContain("[ValidateSet('Run', 'KeepAlive', 'Cleanup')]");
    expect(fixture).toContain("if ($Action -eq 'KeepAlive')");
    expect(fixture).toContain('Start-Process -FilePath $mysqld');
    expect(fixture).toContain('Write-FixtureState');
    expect(fixture).toContain('SELECT 1');
    expect(fixture).not.toContain('--skip-grant-tables');
    expect(precondition).toContain('& $fixture -MysqlRoot $mysqlRoot');
    expect(precondition).not.toContain('-Action KeepAlive');
  });

  it('reconstroi o runtime de Cleanup pelo estado antes da descoberta por PATH', () => {
    const savedState = fixture.indexOf('$saved = Get-Content -LiteralPath $state -Raw | ConvertFrom-Json');
    const pathLookup = fixture.indexOf('Get-Command mysqld.exe');
    expect(savedState).toBeGreaterThan(-1);
    expect(pathLookup).toBeGreaterThan(savedState);
    expect(fixture).toContain('$MysqlRoot = [IO.Path]::GetFullPath([string]$saved.mysqlRoot)');
    expect(fixture).toContain("$mysql = Join-Path $MysqlRoot 'bin\\mysql.exe'; $mysqladmin = Join-Path $MysqlRoot 'bin\\mysqladmin.exe'");
    expect(runbook).toContain('-Action Cleanup -FixtureRoot $fixtureRoot');
  });

  it('publica somente conexao e persiste credencial/identidade dentro da fixture', () => {
    expect(fixture).toContain("$maintenanceClient = Join-Path $FixtureRoot 'maintenance-client.cnf'");
    expect(fixture).toContain('credentialFile = $CredentialFile');
    expect(fixture).toContain('processId = $ProcessId');
    expect(fixture).toContain('keepalive=ready connection=127.0.0.1:$port');
    expect(fixture).toContain('credential-file=$maintenanceClient');
    expect(fixture).not.toMatch(/Write-Host[^\r\n]*maintenanceSecret/);
    expect(runbook).toContain('-Action KeepAlive');
    expect(runbook).toContain('npm start');
    expect(runbook).toContain('Playwright');
    expect(runbook).toContain('DB_PASSWORD');
  });

  it('limpa todos os processos pai/filho pela identidade exata e prova ausencia de listener e artefatos', () => {
    expect(fixture).toContain('$matchingBeforeShutdown = @(Get-FixtureProcesses $MysqlPath $ini $Root)');
    expect(fixture).toContain('$allProcs = @(Get-FixtureProcesses $MysqlPath $ini $Root)');
    expect(fixture).not.toContain('ExpectedProcessId');
    expect(fixture).not.toContain('-ProcessId $ExpectedProcessId');
    expect(fixture).toContain('Assert-FixtureListenerAbsent -Port $Port');
    expect(fixture).toContain('$pathsToRemove');
    expect(fixture).toContain('fixture-state.json');
    expect(fixture).toContain('MySQL morreu prematuramente antes do KeepAlive');
    expect(fixture).toContain('$primaryError = $_');
    expect(fixture).toContain('Write-Warning "Falha na limpeza da fixture; erro original preservado:');
    expect(runbook).toContain('-Action Cleanup');
  });
});
