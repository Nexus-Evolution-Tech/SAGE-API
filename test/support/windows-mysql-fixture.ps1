[CmdletBinding()]
param(
  [ValidateSet('Run', 'Cleanup')][string]$Action = 'Run',
  [string]$MysqlRoot,
  [string]$ApiRepository,
  [string]$NodeExecutable,
  [string]$FixtureRoot,
  [string]$Commit
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $ApiRepository) { $ApiRepository = Split-Path -Parent (Split-Path -Parent $PSScriptRoot) }

function Invoke-Native {
  param([string]$File, [string[]]$Arguments)
  $info = [Diagnostics.ProcessStartInfo]::new()
  $info.FileName = $File
  $info.Arguments = (($Arguments | ForEach-Object { if ($_.Contains('"')) { throw 'Argumento inseguro' }; '"' + $_ + '"' }) -join ' ')
  $info.UseShellExecute = $false; $info.CreateNoWindow = $true
  $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
  $p = [Diagnostics.Process]::new(); $p.StartInfo = $info
  if (-not $p.Start()) { throw "Processo nativo não iniciou: $File" }
  $out = $p.StandardOutput.ReadToEnd(); $err = $p.StandardError.ReadToEnd(); $p.WaitForExit()
  if ($p.ExitCode -ne 0) {
    $detail = $err.Trim() -replace '(?i)(password|senha)([=:]\s*)\S+', '$1$2<redacted>'
    throw "Comando nativo falhou: $File (exit=$($p.ExitCode)) $detail"
  }
  $p.Dispose(); return $out
}

function New-Secret {
  $bytes = [byte[]]::new(32); $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return [Convert]::ToBase64String($bytes)
}

function Invoke-Configured {
  param([string]$File, [string]$ClientFile, [string[]]$Arguments, [string]$Sql)
  $all = @("--defaults-extra-file=$ClientFile") + $Arguments
  if ($null -ne $Sql) { $all += @('-e', $Sql) }
  return Invoke-Native $File $all
}

function Invoke-Sql {
  param([string]$ClientFile, [string]$Sql)
  $output = Invoke-Configured $mysql $ClientFile @('--batch', '--skip-column-names') $Sql
  return @($output -split '\r?\n' | Where-Object { $_.Trim().Length -gt 0 } | ForEach-Object { $_.Trim() })
}

function Assert-TemporaryPath {
  param([string]$Path)
  $full = [IO.Path]::GetFullPath($Path).TrimEnd('\')
  $roots = @($env:TEMP, $env:RUNNER_TEMP) | Where-Object { $_ } | ForEach-Object { [IO.Path]::GetFullPath($_).TrimEnd('\') }
  if (@($roots | Where-Object { $full.StartsWith($_ + '\', [StringComparison]::OrdinalIgnoreCase) }).Count -eq 0 -or
      [IO.Path]::GetFileName($full) -notmatch '^sage-r2-02-mysql-') { throw 'Fixture fora de diretório temporário autorizado' }
  return $full
}

function Wait-Ready {
  param([string]$ClientFile, [Diagnostics.Process]$Process)
  for ($i = 0; $i -lt 60; $i++) {
    try {
      if ((Invoke-Sql $ClientFile 'SELECT 1').Trim() -eq '1') { return }
    } catch { $lastError = $_.Exception.Message }
    if ($Process.HasExited) { throw 'MySQL encerrou antes da readiness' }
    Start-Sleep -Milliseconds 500
  }
  throw 'MySQL não ficou pronto'
}

function Get-FixtureProcesses {
  param([string]$MysqlPath, [string]$Ini, [string]$Root)
  @(Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.Equals($MysqlPath, [StringComparison]::OrdinalIgnoreCase) -and
    $_.CommandLine -and $_.CommandLine.IndexOf($Ini, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
    $_.CommandLine.IndexOf($Root, [StringComparison]::OrdinalIgnoreCase) -ge 0
  })
}

function Get-FixtureListeners {
  param([int[]]$ProcessIds)
  $processIds = @($ProcessIds)
  if ($processIds.Count -eq 0) { return @() }
  @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $processIds -contains $_.OwningProcess })
}

function Invoke-AuthenticatedShutdown {
  param([string]$ClientFile)
  $shutdownClient = $ClientFile; $temporaryClient = $null
  try {
    if (@(Get-Content -LiteralPath $ClientFile -ErrorAction SilentlyContinue | Where-Object { $_ -match '^database=' }).Count -ne 0) {
      $temporaryClient = Join-Path (Split-Path -Parent $ClientFile) 'maintenance-shutdown.cnf'
      $lines = @(Get-Content -LiteralPath $ClientFile | Where-Object { $_ -notmatch '^database=' })
      [IO.File]::WriteAllLines($temporaryClient, $lines, [Text.UTF8Encoding]::new($false)); $shutdownClient = $temporaryClient
    }
    $output = @(& $mysqladmin "--defaults-extra-file=$shutdownClient" shutdown 2>&1)
    if ($LASTEXITCODE -ne 0) { throw 'mysqladmin shutdown autenticado falhou' }
  } finally {
    if ($temporaryClient -and (Test-Path -LiteralPath $temporaryClient)) { Remove-Item -LiteralPath $temporaryClient -Force }
  }
}

function Stop-FixtureServer {
  param([string]$Root, [string]$MysqlPath, [Diagnostics.Process]$Parent)
  $ini = Join-Path $Root 'mysql-fixture.ini'
  $clients = @((Join-Path $Root 'root-client.cnf'), (Join-Path $Root 'maintenance-client.cnf'))
  for ($i = 0; $i -lt 60; $i++) {
    $procs = @(Get-FixtureProcesses $MysqlPath $ini $Root)
    $parentAlive = $Parent -and -not $Parent.HasExited
    if ($procs.Count -eq 0 -and -not $parentAlive) { return }
    foreach ($client in $clients) {
      if (Test-Path -LiteralPath $client) {
        try { Invoke-AuthenticatedShutdown $client; break } catch { $lastShutdownError = $_.Exception.Message }
      }
    }
    if ($Parent -and -not $Parent.HasExited) { [void]$Parent.WaitForExit(500) }
    Start-Sleep -Milliseconds 500
  }
  throw 'Processo residual do fixture MySQL nao encerrou apos shutdown autenticado'
}

function Cleanup-Fixture {
  param([string]$Root, [string]$MysqlPath, [Diagnostics.Process]$Parent)
  $ini = Join-Path $Root 'mysql-fixture.ini'
  Stop-FixtureServer $Root $MysqlPath $Parent
  $procs = @(Get-FixtureProcesses $MysqlPath $ini $Root)
  if ($procs.Count -ne 0) { throw 'Processo residual do fixture MySQL não encerrou' }
  $procs = @(Get-FixtureProcesses $MysqlPath $ini $Root)
  $fixturePids = @($procs | ForEach-Object { [int]$_.ProcessId })
  if ((@(Get-FixtureListeners -ProcessIds $fixturePids)).Count -ne 0) { throw 'Listener do fixture MySQL permaneceu aberto' }
  if (Test-Path -LiteralPath $Root) { Remove-Item -LiteralPath $Root -Recurse -Force }
  if (Test-Path -LiteralPath $Root) { throw 'Datadir/tmp/logs do fixture não foram removidos' }
}

function New-AvailablePort {
  for ($i = 0; $i -lt 10; $i++) {
    $probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    try { $probe.Start(); $candidate = [int]$probe.LocalEndpoint.Port } finally { $probe.Stop() }
    if (Test-PortAvailable $candidate) { return $candidate }
  }
  throw 'Nao foi possivel reservar uma porta livre para a fixture'
}

function Test-PortAvailable {
  param([int]$Port)
  $client = [Net.Sockets.TcpClient]::new()
  try {
    try {
      $client.Connect('127.0.0.1', $Port)
      return $false
    } catch [Net.Sockets.SocketException] {
      if ($_.Exception.SocketErrorCode -ne [Net.Sockets.SocketError]::ConnectionRefused) {
        throw "Nao foi possivel validar a porta temporaria $Port"
      }
      return $true
    }
  } finally { $client.Dispose() }
}

function Assert-PortAvailable {
  param([int]$Port)
  if (-not (Test-PortAvailable $Port)) { throw "Porta temporaria $Port ja esta ocupada; fixture recusada" }
}

if (-not $MysqlRoot) { $MysqlRoot = Split-Path -Parent ((Get-Command mysqld.exe -ErrorAction Stop).Source) }
if (-not $NodeExecutable) { $NodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source }
$MysqlRoot = [IO.Path]::GetFullPath($MysqlRoot).TrimEnd('\')
$mysqld = Join-Path $MysqlRoot 'bin\mysqld.exe'; $mysql = Join-Path $MysqlRoot 'bin\mysql.exe'; $mysqladmin = Join-Path $MysqlRoot 'bin\mysqladmin.exe'
foreach ($file in @($mysqld, $mysql, $mysqladmin)) { if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Runtime MySQL incompleto: $file" } }
if (-not $FixtureRoot) { $FixtureRoot = Join-Path ($(if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { $env:TEMP })) ('sage-r2-02-mysql-' + [guid]::NewGuid().ToString('N')) }
$FixtureRoot = Assert-TemporaryPath $FixtureRoot
$state = Join-Path $FixtureRoot 'fixture-state.json'
if ($Action -eq 'Cleanup') {
  if (-not (Test-Path -LiteralPath $state)) { throw 'Estado do fixture ausente; limpeza recusada' }
  $saved = Get-Content -LiteralPath $state -Raw | ConvertFrom-Json
  $MysqlRoot = $saved.mysqlRoot; $mysqld = Join-Path $MysqlRoot 'bin\mysqld.exe'; $mysql = Join-Path $MysqlRoot 'bin\mysql.exe'
  Cleanup-Fixture $FixtureRoot $mysqld; exit 0
}
if (Test-Path -LiteralPath $FixtureRoot) { throw 'Diretório do fixture já existe; não reutilizar estado' }
New-Item -ItemType Directory -Path $FixtureRoot, (Join-Path $FixtureRoot 'data'), (Join-Path $FixtureRoot 'tmp'), (Join-Path $FixtureRoot 'binlog') | Out-Null
$data = Join-Path $FixtureRoot 'data'; $tmp = Join-Path $FixtureRoot 'tmp'; $binlog = Join-Path $FixtureRoot 'binlog\sage-r2-02-bin'; $errorLog = Join-Path $FixtureRoot 'mysql-error.log'; $consoleLog = Join-Path $FixtureRoot 'mysql-console.log'; $ini = Join-Path $FixtureRoot 'mysql-fixture.ini'
$port = New-AvailablePort
Assert-PortAvailable $port
$toIni = { param($p) $p.Replace('\', '/') }
[IO.File]::WriteAllLines($ini, @('[mysqld]', "basedir=$(& $toIni $MysqlRoot)", "datadir=$(& $toIni $data)", "tmpdir=$(& $toIni $tmp)", "port=$port", "log-bin=$(& $toIni $binlog)", 'log-bin-trust-function-creators=1', 'server-id=20260827', 'bind-address=127.0.0.1', 'mysqlx=0', 'skip-name-resolve', 'local-infile=OFF', 'innodb-flush-log-at-trx-commit=1', "log-error=$(& $toIni $errorLog)"), [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText($state, ([ordered]@{ mysqlRoot = $MysqlRoot; port = $port } | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
$server = $null; $envNames = @('DB_HOST','DB_PORT','DB_USER','DB_PASSWORD','DB_NAME','SAGE_ALLOW_FIRST_RUN_ONBOARDING','SAGE_INITIAL_ADMIN_LOGIN','SAGE_INITIAL_ADMIN_PASSWORD','SAGE_INITIAL_SCHOOL_NAME'); $oldEnv = @{}
try {
  $version = (Invoke-Native $mysqld @('--version')).Trim(); if ($version -notmatch '\b8\.4\.') { throw 'Runtime não é MySQL 8.4' }
  [void](Invoke-Native $mysqld @('--no-defaults', "--basedir=$MysqlRoot", "--datadir=$data", '--initialize-insecure'))
  $sharedMemory = 'SAGER202' + $PID; $rootSecret = New-Secret; $maintenanceSecret = New-Secret
  $rootClient = Join-Path $FixtureRoot 'root-client.cnf'; $maintenanceClient = Join-Path $FixtureRoot 'maintenance-client.cnf'; $initSql = Join-Path $FixtureRoot 'mysql-init.sql'
  [IO.File]::WriteAllText($rootClient, "[client]`nprotocol=MEMORY`nshared-memory-base-name=$sharedMemory`nuser=root`npassword=$rootSecret`n", [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText($maintenanceClient, "[client]`nprotocol=TCP`nhost=127.0.0.1`nport=$port`nuser=sage_maintenance`npassword=$maintenanceSecret`n", [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText($initSql, @"
ALTER USER 'root'@'localhost' IDENTIFIED BY '$rootSecret';
CREATE DATABASE IF NOT EXISTS sage CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS 'sage_maintenance'@'127.0.0.1' IDENTIFIED BY '$maintenanceSecret';
ALTER USER 'sage_maintenance'@'127.0.0.1' IDENTIFIED BY '$maintenanceSecret';
REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'sage_maintenance'@'127.0.0.1';
GRANT SHOW_ROUTINE ON *.* TO 'sage_maintenance'@'127.0.0.1';
GRANT SHUTDOWN ON *.* TO 'sage_maintenance'@'127.0.0.1';
GRANT ALL PRIVILEGES ON sage.* TO 'sage_maintenance'@'127.0.0.1';
"@, [Text.UTF8Encoding]::new($false))
  $bootstrapArgs = @('--defaults-file="' + $ini + '"', '--skip-networking', '--shared-memory', "--shared-memory-base-name=$sharedMemory", '--init-file="' + $initSql + '"')
  Assert-PortAvailable $port
  $server = Start-Process -FilePath $mysqld -ArgumentList $bootstrapArgs -RedirectStandardError $errorLog -RedirectStandardOutput $consoleLog -PassThru -WindowStyle Hidden
  Wait-Ready $rootClient $server
  Write-Host 'readiness=bootstrap-authenticated-shared-memory'
  Stop-FixtureServer $FixtureRoot $mysqld $server
  if ($server -and -not $server.HasExited) { [void]$server.WaitForExit(30000) }
  if ($server) { $server.Dispose() }
  $server = $null
  [IO.File]::Delete($initSql)
  Assert-PortAvailable $port
  $server = Start-Process -FilePath $mysqld -ArgumentList @('--defaults-file="' + $ini + '"') -RedirectStandardError $errorLog -RedirectStandardOutput $consoleLog -PassThru -WindowStyle Hidden
  Wait-Ready $maintenanceClient $server
  Write-Host 'readiness=final-authenticated-tcp'
  foreach ($name in $envNames) { $oldEnv[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
  $env:DB_HOST='127.0.0.1'; $env:DB_PORT="$port"; $env:DB_USER='sage_maintenance'; $env:DB_PASSWORD=$maintenanceSecret; $env:DB_NAME='sage'; $env:SAGE_ALLOW_FIRST_RUN_ONBOARDING='true'
  foreach ($name in @('SAGE_INITIAL_ADMIN_LOGIN','SAGE_INITIAL_ADMIN_PASSWORD','SAGE_INITIAL_SCHOOL_NAME')) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
  $setup = @(& $NodeExecutable (Join-Path $ApiRepository 'scripts\setup-database.js') 2>&1); if ($LASTEXITCODE -ne 0) { throw 'Provisionamento existente de schema/migrations falhou' }
  Write-Host 'schema=migrations-command-complete'
  $effective = @(Invoke-Sql $maintenanceClient 'SELECT @@version,@@datadir,@@tmpdir,@@port,@@bind_address,@@log_bin,@@log_bin_trust_function_creators;'); $parts = $effective[0] -split "`t"
  if ($parts.Count -ne 7) { throw 'Configuração efetiva/readiness MySQL sem os campos esperados' }
  $logBinEnabled = @('1', 'ON') -contains $parts[5].Trim(); $trustCreatorsEnabled = @('1', 'ON') -contains $parts[6].Trim()
  if ($parts[0] -notmatch '\b8\.4\.' -or [int]$parts[3] -ne $port -or $parts[4] -ne '127.0.0.1' -or -not $logBinEnabled -or -not $trustCreatorsEnabled) { throw "Configuração efetiva/readiness MySQL diverge: port=$($parts[3]) bind=$($parts[4]) log_bin=$($parts[5]) trust=$($parts[6])" }
  if (@(Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1 -LocalPort $port).Count -ne 1) { throw 'Listener MySQL não está restrito ao loopback' }
  $tables = @(Invoke-Sql $maintenanceClient "SELECT LOWER(TABLE_NAME) FROM information_schema.TABLES WHERE TABLE_SCHEMA='sage';"); foreach ($required in @('unidadeescolar','pessoa','dispositivo','acesso','turma')) { if ($tables -notcontains $required) { throw "Schema incompleto: $required" } }
  $counts = @(Invoke-Sql $maintenanceClient "SELECT COUNT(*) FROM sage.UnidadeEscolar UNION ALL SELECT COUNT(*) FROM sage.Pessoa UNION ALL SELECT COUNT(*) FROM sage.Dispositivo UNION ALL SELECT COUNT(*) FROM sage.Acesso UNION ALL SELECT COUNT(*) FROM sage.Turma;"); if (@($counts | Where-Object { $_.Trim() -ne '0' }).Count -ne 0) { throw 'Fixture criou entidade de domínio' }
  $grants = (Invoke-Sql $maintenanceClient 'SHOW GRANTS;') -join "`n"; if ($grants -notmatch 'sage_maintenance' -or $grants -match '(?i)SUPER|GRANT OPTION|GRANT ALL PRIVILEGES ON \*\.\*') { throw 'sage_maintenance possui privilégio amplo' }
  Write-Host "evidence=R2-02-precond commit=$Commit platform=$((Get-CimInstance Win32_OperatingSystem).Caption) x64 mysql=$version port=$port bind=127.0.0.1 datadir=fixture tmpdir=fixture log_bin=$($parts[5]) trust_function_creators=$($parts[6]) schema=ready privileges=sage_maintenance-restricted entities=0"
} finally {
  foreach ($name in $envNames) { if ($null -eq $oldEnv[$name]) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue } else { Set-Item "Env:$name" $oldEnv[$name] } }
  Cleanup-Fixture $FixtureRoot $mysqld $server
  if ($server) { $server.Dispose() }
  Write-Host 'cleanup=service-absent process=0 listener=0 datadir=0 tmpdir=0 logs=0'
}
$global:LASTEXITCODE = 0
