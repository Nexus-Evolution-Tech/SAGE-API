[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Inicializa/valida primeiro os caminhos, segredos e ACLs. O dot-source também reutiliza os
# helpers privados sem criar uma segunda implementação de segurança.
. (Join-Path $PSScriptRoot 'initialize-state.ps1')

$mysqlRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'runtime\mysql'
$mysqld = Join-Path $mysqlRoot 'bin\mysqld.exe'
$mysql = Join-Path $mysqlRoot 'bin\mysql.exe'
$mysqladmin = Join-Path $mysqlRoot 'bin\mysqladmin.exe'
Assert-RegularLocalPath $mysqlRoot
Assert-RegularLocalPath (Join-Path $mysqlRoot 'bin')
foreach ($file in @($mysqld, $mysql, $mysqladmin)) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw 'Runtime MySQL incompleto' }
  Assert-RegularLocalPath $file
}

$dataDir = Join-Path $dataRoot 'mysql\data'
$marker = Join-Path $configDir 'mysql-accounts.ready'
$rootClient = Join-Path $configDir 'mysql-bootstrap-client.cnf'
$runtimeClient = Join-Path $configDir 'runtime-client.partial.cnf'
$initSql = Join-Path $configDir 'mysql-bootstrap.partial.sql'
$bootstrapLog = Join-Path $dataRoot 'mysql\bootstrap.log'
$sharedMemory = 'SAGEBootstrap'

function Read-KeyValues {
  param([string]$Path)
  Assert-RegularLocalPath $Path
  Assert-PrivateAcl $Path
  $values = @{}
  foreach ($line in [IO.File]::ReadAllLines($Path)) {
    if ($line -notmatch '^([A-Z][A-Z0-9_]*)=(.+)$' -or $values.ContainsKey($Matches[1])) {
      throw 'Configuração privada inválida'
    }
    $values[$Matches[1]] = $Matches[2]
  }
  return $values
}

function Assert-Secret {
  param([string]$Value)
  if ($Value -notmatch '^[A-Za-z0-9_-]{32,}$') { throw 'Segredo privado inválido' }
}

function Quote-NativeArgument {
  param([string]$Value)
  if ($Value.Contains('"') -or $Value.EndsWith('\')) { throw 'Argumento nativo inseguro' }
  return '"' + $Value + '"'
}

function Start-Native {
  param([string]$File, [string[]]$Arguments, [bool]$Redirect = $false)
  $info = [Diagnostics.ProcessStartInfo]::new()
  $info.FileName = $File
  $info.Arguments = (($Arguments | ForEach-Object { Quote-NativeArgument $_ }) -join ' ')
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardInput = $Redirect
  $info.RedirectStandardOutput = $Redirect
  $info.RedirectStandardError = $Redirect
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $info
  if (-not $process.Start()) { throw 'Processo MySQL não iniciou' }
  return $process
}

function Invoke-Client {
  param([string]$File, [string]$DefaultsFile, [string[]]$Arguments, [string]$InputSql = '')
  $all = @("--defaults-extra-file=$DefaultsFile") + $Arguments
  $process = Start-Native $File $all $true
  if ($InputSql) { $process.StandardInput.Write($InputSql) }
  $process.StandardInput.Close()
  $stdout = $process.StandardOutput.ReadToEnd()
  [void]$process.StandardError.ReadToEnd()
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) { throw 'Cliente MySQL falhou sem expor sua saída' }
  $process.Dispose()
  return $stdout
}

function Wait-Root {
  param([string]$DefaultsFile)
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    try {
      [void](Invoke-Client $mysqladmin $DefaultsFile @('ping', '--silent'))
      return
    } catch { Start-Sleep -Milliseconds 500 }
  }
  throw 'MySQL privado não ficou pronto'
}

function Stop-Root {
  param([string]$DefaultsFile, [Diagnostics.Process]$Server)
  [void](Invoke-Client $mysqladmin $DefaultsFile @('shutdown'))
  if (-not $Server.WaitForExit(30000)) { throw 'MySQL privado não encerrou corretamente' }
  if ($Server.ExitCode -ne 0) { throw 'MySQL privado encerrou com erro' }
  $Server.Dispose()
}

function Start-Server {
  param([string[]]$Extra)
  $arguments = @(
    '--no-defaults', "--basedir=$mysqlRoot", "--datadir=$dataDir",
    "--log-error=$bootstrapLog", '--log-error-verbosity=1', '--mysqlx=0'
  ) + $Extra
  return Start-Native $mysqld $arguments
}

function Assert-Accounts {
  $runtimeGrants = Invoke-Client $mysql $runtimeClient @('--batch', '--skip-column-names') "SHOW GRANTS;`n"
  $maintenanceGrants = Invoke-Client $mysql (Join-Path $configDir 'maintenance-client.cnf') @(
    '--batch', '--skip-column-names'
  ) "SHOW GRANTS;`n"
  $shutdownGrants = Invoke-Client $mysql $shutdownClient @(
    '--batch', '--skip-column-names'
  ) "SHOW GRANTS;`n"
  $runtimeLines = @($runtimeGrants.Trim() -split "`r?`n")
  $maintenanceLines = @($maintenanceGrants.Trim() -split "`r?`n")
  $shutdownLines = @($shutdownGrants.Trim() -split "`r?`n")
  if ($runtimeLines.Count -ne 2 -or
      @($runtimeLines -match '^GRANT USAGE ON \*\.\* TO `sage_runtime`@`127\.0\.0\.1`$').Count -ne 1 -or
      @($runtimeLines -match 'GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE ON `sage`\.\*').Count -ne 1 -or
      $runtimeGrants -match 'GRANT OPTION|ALL PRIVILEGES') {
    throw 'Privilégios do runtime divergentes'
  }
  if ($maintenanceLines.Count -ne 4 -or
      @($maintenanceLines -match '^GRANT USAGE ON \*\.\* TO `sage_maintenance`@`127\.0\.0\.1`$').Count -ne 1 -or
      @($maintenanceLines -match 'GRANT SHOW_ROUTINE ON \*\.\*').Count -ne 1 -or
      @($maintenanceLines -match 'GRANT ALL PRIVILEGES ON `sage`\.\*').Count -ne 1 -or
      @($maintenanceLines -match 'sage.*verif.*%').Count -ne 1 -or
      $maintenanceGrants -match 'GRANT OPTION|GRANT ALL PRIVILEGES ON \*\.\*') {
    throw 'Privilégios de manutenção divergentes'
  }
  if ($shutdownLines.Count -ne 2 -or
      @($shutdownLines -match '^GRANT USAGE ON \*\.\* TO `sage_shutdown`@`127\.0\.0\.1`$').Count -ne 1 -or
      @($shutdownLines -match '^GRANT SHUTDOWN ON \*\.\* TO `sage_shutdown`@`127\.0\.0\.1`$').Count -ne 1 -or
      $shutdownGrants -match 'GRANT OPTION|ALL PRIVILEGES') {
    throw 'Privilégios de shutdown divergentes'
  }
}

$runtime = Read-KeyValues (Join-Path $configDir 'sage.env')
$maintenance = Read-KeyValues (Join-Path $configDir 'maintenance.env')
Assert-Secret $runtime.DB_PASSWORD
Assert-Secret $maintenance.DB_PASSWORD
Assert-Secret $shutdownPassword
$runtimeContent = @(
  '[client]', 'protocol=TCP', 'host=127.0.0.1', 'port=3307', 'user=sage_runtime',
  "password=$($runtime.DB_PASSWORD)", ''
) -join [Environment]::NewLine

$mutex = [Threading.Mutex]::new($false, 'Global\SAGE-MySQL-Initialization')
$lockTaken = $false
$server = $null
try {
  try { $lockTaken = $mutex.WaitOne(0) }
  catch [Threading.AbandonedMutexException] { $lockTaken = $true }
  if (-not $lockTaken) { throw 'Outro bootstrap MySQL está em execução' }
  Write-PrivateTextOnce $runtimeClient $runtimeContent

  if (Test-Path -LiteralPath $marker) {
    Assert-RegularLocalPath $marker
    Assert-PrivateAcl $marker
    $markerContent = [IO.File]::ReadAllText($marker)
    if ($markerContent -ceq "schemaVersion=1`r`n") {
      throw 'Estado MySQL pré-alpha v1 não é atualizável; recrie-o antes do primeiro release'
    }
    if ($markerContent -cne "schemaVersion=2`r`n") { throw 'Marcador MySQL inválido' }
    Assert-Accounts
    Write-Host 'Contas MySQL privadas verificadas; nenhum segredo foi exibido.'
    return
  }

  $dataExisted = Test-Path -LiteralPath $dataDir
  [void][IO.Directory]::CreateDirectory($dataDir)
  Assert-RegularLocalPath $dataDir
  if ($dataExisted) { Assert-PrivateAcl $dataDir } else { New-PrivateAcl $dataDir $true }

  if (Test-Path -LiteralPath $rootClient) {
    Assert-RegularLocalPath $rootClient
    Assert-PrivateAcl $rootClient
    $rootLine = @([IO.File]::ReadAllLines($rootClient) | Where-Object { $_.StartsWith('password=') })
    if ($rootLine.Count -ne 1) { throw 'Recuperação root inválida' }
    $rootSecret = $rootLine[0].Substring('password='.Length)
    $expectedRoot = @(
      '[client]', 'protocol=MEMORY', "shared-memory-base-name=$sharedMemory", 'user=root',
      "password=$rootSecret", ''
    ) -join [Environment]::NewLine
    if ([IO.File]::ReadAllText($rootClient) -cne $expectedRoot) { throw 'Recuperação root divergente' }
  } else {
    if ((Get-ChildItem -LiteralPath $dataDir -Force | Measure-Object).Count -ne 0) {
      throw 'Data directory sem marcador nem recuperação; intervenção obrigatória'
    }
    $rootSecret = New-Secret 48
    $rootContent = @(
      '[client]', 'protocol=MEMORY', "shared-memory-base-name=$sharedMemory", 'user=root',
      "password=$rootSecret", ''
    ) -join [Environment]::NewLine
    Write-PrivateTextOnce $rootClient $rootContent
    $initialize = Start-Server @('--initialize-insecure')
    $initialize.WaitForExit()
    if ($initialize.ExitCode -ne 0) { throw 'Inicialização offline do MySQL falhou' }
    $initialize.Dispose()
  }
  Assert-Secret $rootSecret

  $sqlTemplate = @'
ALTER USER 'root'@'localhost' IDENTIFIED BY '__ROOT_SECRET__';
CREATE DATABASE IF NOT EXISTS `sage` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS 'sage_runtime'@'127.0.0.1' IDENTIFIED BY '__RUNTIME_SECRET__';
ALTER USER 'sage_runtime'@'127.0.0.1' IDENTIFIED BY '__RUNTIME_SECRET__';
REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'sage_runtime'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE ON `sage`.* TO 'sage_runtime'@'127.0.0.1';
CREATE USER IF NOT EXISTS 'sage_maintenance'@'127.0.0.1' IDENTIFIED BY '__MAINTENANCE_SECRET__';
ALTER USER 'sage_maintenance'@'127.0.0.1' IDENTIFIED BY '__MAINTENANCE_SECRET__';
REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'sage_maintenance'@'127.0.0.1';
GRANT SHOW_ROUTINE ON *.* TO 'sage_maintenance'@'127.0.0.1';
GRANT ALL PRIVILEGES ON `sage`.* TO 'sage_maintenance'@'127.0.0.1';
GRANT ALL PRIVILEGES ON `sage\_verif\_%`.* TO 'sage_maintenance'@'127.0.0.1';
CREATE USER IF NOT EXISTS 'sage_shutdown'@'127.0.0.1' IDENTIFIED BY '__SHUTDOWN_SECRET__';
ALTER USER 'sage_shutdown'@'127.0.0.1' IDENTIFIED BY '__SHUTDOWN_SECRET__';
REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'sage_shutdown'@'127.0.0.1';
GRANT SHUTDOWN ON *.* TO 'sage_shutdown'@'127.0.0.1';
'@
  $sql = $sqlTemplate.Replace('__ROOT_SECRET__', $rootSecret)
  $sql = $sql.Replace('__RUNTIME_SECRET__', $runtime.DB_PASSWORD)
  $sql = $sql.Replace('__MAINTENANCE_SECRET__', $maintenance.DB_PASSWORD)
  $sql = $sql.Replace('__SHUTDOWN_SECRET__', $shutdownPassword)
  Write-PrivateTextOnce $initSql $sql
  $server = Start-Server @(
    '--skip-networking', '--shared-memory', "--shared-memory-base-name=$sharedMemory",
    "--init-file=$initSql"
  )
  Wait-Root $rootClient
  Stop-Root $rootClient $server
  $server = $null
  [IO.File]::Delete($initSql)

  $server = Start-Server @(
    '--skip-name-resolve', '--bind-address=127.0.0.1', '--port=3307', '--shared-memory',
    "--shared-memory-base-name=$sharedMemory"
  )
  Wait-Root $rootClient
  Assert-Accounts
  Stop-Root $rootClient $server
  $server = $null
  Write-PrivateTextOnce $marker "schemaVersion=2`r`n"
  [IO.File]::Delete($rootClient)
  Write-Host 'MySQL privado inicializado e validado; nenhum segredo foi exibido.'
} finally {
  if ($null -ne $server -and -not $server.HasExited) {
    try { Stop-Root $rootClient $server } catch { }
  }
  foreach ($temporary in @($runtimeClient, $initSql, $bootstrapLog)) {
    if (Test-Path -LiteralPath $temporary) { [IO.File]::Delete($temporary) }
  }
  if ($lockTaken) { [void]$mutex.ReleaseMutex() }
  $mutex.Dispose()
}
