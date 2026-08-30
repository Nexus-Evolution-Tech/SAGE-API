[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw 'O estado do SAGE só pode ser provisionado no Windows'
}
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'O provisionamento exige elevação administrativa'
}

$dataRoot = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'SAGE'
$programRoot = Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'SAGE'
if (-not [IO.Path]::IsPathRooted($dataRoot) -or $dataRoot -notmatch '^[A-Za-z]:\\' -or
    $dataRoot.StartsWith('\\')) {
  throw 'ProgramData local inválido'
}

$systemSid = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$adminsSid = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
$requiredSids = @($systemSid.Value, $adminsSid.Value)
$serviceSids = @(@('SAGEAPI', 'SAGEMySQL') | ForEach-Object {
  try {
    [Security.Principal.NTAccount]::new('NT SERVICE', $_).Translate(
      [Security.Principal.SecurityIdentifier]
    ).Value
  } catch { $null }
} | Where-Object { $_ })
$allowedSids = @($requiredSids) + @($serviceSids)
$secretMarker = '__GENERATED_SECRET__'

function New-PrivateAcl {
  param([string]$Path, [bool]$Container)
  $acl = if ($Container) {
    [Security.AccessControl.DirectorySecurity]::new()
  } else {
    [Security.AccessControl.FileSecurity]::new()
  }
  $acl.SetAccessRuleProtection($true, $false)
  $inheritance = if ($Container) {
    [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
      [Security.AccessControl.InheritanceFlags]::ObjectInherit
  } else { [Security.AccessControl.InheritanceFlags]::None }
  foreach ($sid in @($systemSid, $adminsSid)) {
    $rule = [Security.AccessControl.FileSystemAccessRule]::new(
      $sid, [Security.AccessControl.FileSystemRights]::FullControl, $inheritance,
      [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow
    )
    [void]$acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $Path -AclObject $acl
}

function Assert-PrivateAcl {
  param([string]$Path)
  $acl = Get-Acl -LiteralPath $Path
  if (-not $acl.AreAccessRulesProtected) { throw "ACL herdada não permitida: $Path" }
  $seen = @{}
  foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    $sid = $rule.IdentityReference.Value
    $forbiddenServiceRights = [Security.AccessControl.FileSystemRights]::ChangePermissions -bor
      [Security.AccessControl.FileSystemRights]::TakeOwnership
    if ($allowedSids -notcontains $sid -or
        $rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
        ($requiredSids -contains $sid -and
          ($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -ne
            [Security.AccessControl.FileSystemRights]::FullControl) -or
        ($serviceSids -contains $sid -and ($rule.FileSystemRights -band $forbiddenServiceRights))) {
      throw "ACL não autorizada: $Path"
    }
    $seen[$sid] = $true
  }
  foreach ($sid in $requiredSids) {
    if (-not $seen.ContainsKey($sid)) { throw "ACL obrigatória ausente: $Path" }
  }
}

function Assert-RegularLocalPath {
  param([string]$Path)
  $item = Get-Item -LiteralPath $Path -Force
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "Reparse point não permitido: $Path"
  }
}

function New-Secret {
  param([int]$Bytes = 32)
  $buffer = [byte[]]::new($Bytes)
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($buffer)
    return [Convert]::ToBase64String($buffer).Replace('+', '-').Replace('/', '_').TrimEnd('=')
  } finally { $rng.Dispose() }
}

function Assert-Config {
  param([string]$Path, [Collections.Specialized.OrderedDictionary]$Expected)
  Assert-RegularLocalPath $Path
  Assert-PrivateAcl $Path
  $found = @{}
  foreach ($line in [IO.File]::ReadAllLines($Path)) {
    if ($line -notmatch '^([A-Z][A-Z0-9_]*)=(.+)$') { throw "Configuração inválida: $Path" }
    if ($found.ContainsKey($Matches[1])) { throw "Chave duplicada em configuração: $Path" }
    $found[$Matches[1]] = $Matches[2]
  }
  if ($found.Count -ne $Expected.Count) { throw "Conjunto de chaves inválido: $Path" }
  foreach ($key in $Expected.Keys) {
    if (-not $found.ContainsKey($key)) { throw "Chave obrigatória ausente em: $Path" }
    $policy = $Expected[$key]
    $valid = if ($policy -eq $secretMarker) {
      $found[$key] -match '^[A-Za-z0-9_-]{32,}$'
    } else { $found[$key] -ceq $policy }
    if (-not $valid) { throw "Valor de configuração inválido: $Path" }
  }
}

function Write-ConfigOnce {
  param([string]$Path, [Collections.Specialized.OrderedDictionary]$Expected, [scriptblock]$Factory)
  if (Test-Path -LiteralPath $Path) { Assert-Config $Path $Expected; return }
  $values = & $Factory
  if (([string[]]$values.Keys -join ',') -ne ([string[]]$Expected.Keys -join ',')) {
    throw 'Contrato interno de configuração divergente'
  }
  $partial = "$Path.partial-$PID-$([guid]::NewGuid().ToString('N'))"
  $writer = $null
  try {
    $stream = [IO.FileStream]::new($partial, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write,
      [IO.FileShare]::None, 4096, [IO.FileOptions]::WriteThrough)
    try {
      $writer = [IO.StreamWriter]::new($stream, [Text.UTF8Encoding]::new($false))
      foreach ($entry in $values.GetEnumerator()) { $writer.WriteLine("$($entry.Key)=$($entry.Value)") }
      $writer.Flush()
      $stream.Flush($true)
    } finally {
      if ($null -ne $writer) { $writer.Dispose() } else { $stream.Dispose() }
    }
    New-PrivateAcl $partial $false
    [IO.File]::Move($partial, $Path)
  } finally {
    if (Test-Path -LiteralPath $partial) { [IO.File]::Delete($partial) }
  }
  Assert-Config $Path $Expected
}

function Write-PrivateTextOnce {
  param([string]$Path, [string]$ExpectedContent)
  if (Test-Path -LiteralPath $Path) {
    Assert-RegularLocalPath $Path
    Assert-PrivateAcl $Path
    if ([IO.File]::ReadAllText($Path) -cne $ExpectedContent) { throw "Arquivo privado divergente: $Path" }
    return
  }
  $partial = "$Path.partial-$PID-$([guid]::NewGuid().ToString('N'))"
  $writer = $null
  try {
    $stream = [IO.FileStream]::new($partial, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write,
      [IO.FileShare]::None, 4096, [IO.FileOptions]::WriteThrough)
    try {
      $writer = [IO.StreamWriter]::new($stream, [Text.UTF8Encoding]::new($false))
      $writer.Write($ExpectedContent); $writer.Flush(); $stream.Flush($true)
    } finally {
      if ($null -ne $writer) { $writer.Dispose() } else { $stream.Dispose() }
    }
    New-PrivateAcl $partial $false
    [IO.File]::Move($partial, $Path)
  } finally {
    if (Test-Path -LiteralPath $partial) { [IO.File]::Delete($partial) }
  }
  Assert-PrivateAcl $Path
  if ([IO.File]::ReadAllText($Path) -cne $ExpectedContent) { throw "Arquivo privado divergente: $Path" }
}

function Ensure-DeviceCredentialKeys {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return }
  Assert-RegularLocalPath $Path
  Assert-PrivateAcl $Path
  $lines = [Collections.Generic.List[string]]::new()
  $found = @{}
  foreach ($line in [IO.File]::ReadAllLines($Path)) {
    $lines.Add($line)
    if ($line -match '^([A-Z][A-Z0-9_]*)=(.+)$') { $found[$Matches[1]] = $true }
  }
  $missing = @('SAGE_DEVICE_CREDENTIAL_KEY', 'SAGE_DEVICE_CREDENTIAL_KEY_PREVIOUS') |
    Where-Object { -not $found.ContainsKey($_) }
  if (@($missing).Count -eq 0) { return }
  foreach ($key in $missing) { $lines.Add("$key=$(New-Secret)") }

  $partial = "$Path.partial-$PID-$([guid]::NewGuid().ToString('N'))"
  $writer = $null
  try {
    $stream = [IO.FileStream]::new($partial, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write,
      [IO.FileShare]::None, 4096, [IO.FileOptions]::WriteThrough)
    try {
      $writer = [IO.StreamWriter]::new($stream, [Text.UTF8Encoding]::new($false))
      foreach ($line in $lines) { $writer.WriteLine($line) }
      $writer.Flush(); $stream.Flush($true)
    } finally {
      if ($null -ne $writer) { $writer.Dispose() } else { $stream.Dispose() }
    }
    New-PrivateAcl $partial $false
    [IO.File]::Move($partial, $Path, $true)
  } finally {
    if (Test-Path -LiteralPath $partial) { [IO.File]::Delete($partial) }
  }
  Assert-Config $Path ([ordered]@{
    NODE_ENV='production'; PORT='3000'; SAGE_DATA_DIR=$dataRoot; SAGE_REQUIRE_WEB='true'
    DB_HOST='127.0.0.1'; DB_PORT='3307'; DB_USER='sage_runtime'; DB_PASSWORD=$secretMarker
    DB_NAME='sage'; REDIS_ENABLED='false'; JWT_SECRET=$secretMarker
    SAGE_DEVICE_CREDENTIAL_KEY=$secretMarker; SAGE_DEVICE_CREDENTIAL_KEY_PREVIOUS=$secretMarker
    MONITOR_USE_PUSH='false'; MONITOR_POLLING_INTERVAL_MS='20000'; MONITOR_CALLBACK_TOKEN=$secretMarker
    SYNC_CHECK_INTERVAL='*/5 * * * *'; SYNC_BATCH_SIZE='50'; HEALTH_CHECK_INTERVAL='60000'; PROMOCAO_CRON='false'; BACKUP_CRON='0 3 * * *'
    MYSQLDUMP_PATH=(Join-Path $programRoot 'runtime\mysql\bin\mysqldump.exe')
    MYSQL_PATH=(Join-Path $programRoot 'runtime\mysql\bin\mysql.exe')
    SAGE_REQUIRE_MAINTENANCE_DB='true'
    SAGE_MAINTENANCE_CONFIG_FILE=(Join-Path $configDir 'maintenance.env')
    MYSQL_DEFAULTS_EXTRA_FILE=(Join-Path $configDir 'maintenance-client.cnf')
  })
}

$mutex = [Threading.Mutex]::new($false, 'Global\SAGE-State-Initialization')
$lockTaken = $false
try {
try { $lockTaken = $mutex.WaitOne(0) }
catch [Threading.AbandonedMutexException] { $lockTaken = $true }
if (-not $lockTaken) { throw 'Outro provisionamento do SAGE está em execução' }
$directories = @(
  'config', 'mysql', 'mysql\tmp', 'logs', 'logs\api', 'logs\mysql',
  'backups', 'uploads', 'exports'
)
$rootExisted = Test-Path -LiteralPath $dataRoot
[void][IO.Directory]::CreateDirectory($dataRoot)
Assert-RegularLocalPath $dataRoot
if ($rootExisted) { Assert-PrivateAcl $dataRoot } else { New-PrivateAcl $dataRoot $true; Assert-PrivateAcl $dataRoot }
foreach ($name in $directories) {
  $directory = Join-Path $dataRoot $name
  $existed = Test-Path -LiteralPath $directory
  [void][IO.Directory]::CreateDirectory($directory)
  Assert-RegularLocalPath $directory
  if ($existed) { Assert-PrivateAcl $directory } else { New-PrivateAcl $directory $true; Assert-PrivateAcl $directory }
}

$configDir = Join-Path $dataRoot 'config'
Ensure-DeviceCredentialKeys (Join-Path $configDir 'sage.env')
Write-ConfigOnce (Join-Path $configDir 'sage.env') ([ordered]@{
  NODE_ENV='production'; PORT='3000'; SAGE_DATA_DIR=$dataRoot; SAGE_REQUIRE_WEB='true'
  DB_HOST='127.0.0.1'; DB_PORT='3307'; DB_USER='sage_runtime'; DB_PASSWORD=$secretMarker
  DB_NAME='sage'; REDIS_ENABLED='false'; JWT_SECRET=$secretMarker
  SAGE_DEVICE_CREDENTIAL_KEY=$secretMarker
  SAGE_DEVICE_CREDENTIAL_KEY_PREVIOUS=$secretMarker
  MONITOR_USE_PUSH='false'; MONITOR_POLLING_INTERVAL_MS='20000'; MONITOR_CALLBACK_TOKEN=$secretMarker
  SYNC_CHECK_INTERVAL='*/5 * * * *'; SYNC_BATCH_SIZE='50'; HEALTH_CHECK_INTERVAL='60000'; PROMOCAO_CRON='false'; BACKUP_CRON='0 3 * * *'
  MYSQLDUMP_PATH=(Join-Path $programRoot 'runtime\mysql\bin\mysqldump.exe')
  MYSQL_PATH=(Join-Path $programRoot 'runtime\mysql\bin\mysql.exe')
  SAGE_REQUIRE_MAINTENANCE_DB='true'
  SAGE_MAINTENANCE_CONFIG_FILE=(Join-Path $configDir 'maintenance.env')
  MYSQL_DEFAULTS_EXTRA_FILE=(Join-Path $configDir 'maintenance-client.cnf')
}) {
  [ordered]@{
  NODE_ENV='production'; PORT='3000'; SAGE_DATA_DIR=$dataRoot; SAGE_REQUIRE_WEB='true'
  DB_HOST='127.0.0.1'; DB_PORT='3307'; DB_USER='sage_runtime'; DB_PASSWORD=(New-Secret)
  DB_NAME='sage'; REDIS_ENABLED='false'; JWT_SECRET=(New-Secret 48)
  SAGE_DEVICE_CREDENTIAL_KEY=(New-Secret)
  SAGE_DEVICE_CREDENTIAL_KEY_PREVIOUS=(New-Secret)
  MONITOR_USE_PUSH='false'; MONITOR_POLLING_INTERVAL_MS='20000'; MONITOR_CALLBACK_TOKEN=(New-Secret)
  SYNC_CHECK_INTERVAL='*/5 * * * *'; SYNC_BATCH_SIZE='50'; HEALTH_CHECK_INTERVAL='60000'; PROMOCAO_CRON='false'; BACKUP_CRON='0 3 * * *'
  MYSQLDUMP_PATH=(Join-Path $programRoot 'runtime\mysql\bin\mysqldump.exe')
  MYSQL_PATH=(Join-Path $programRoot 'runtime\mysql\bin\mysql.exe')
  SAGE_REQUIRE_MAINTENANCE_DB='true'
  SAGE_MAINTENANCE_CONFIG_FILE=(Join-Path $configDir 'maintenance.env')
  MYSQL_DEFAULTS_EXTRA_FILE=(Join-Path $configDir 'maintenance-client.cnf')
  }
}
Write-ConfigOnce (Join-Path $configDir 'maintenance.env') ([ordered]@{
  DB_HOST='127.0.0.1'; DB_PORT='3307'; DB_USER='sage_maintenance'; DB_PASSWORD=$secretMarker
  DB_NAME='sage'
}) {
  [ordered]@{
  DB_HOST='127.0.0.1'; DB_PORT='3307'; DB_USER='sage_maintenance'; DB_PASSWORD=(New-Secret)
  DB_NAME='sage'
  }
}
$maintenancePasswordLines = @([IO.File]::ReadAllLines((Join-Path $configDir 'maintenance.env')) |
  Where-Object { $_.StartsWith('DB_PASSWORD=') })
if ($maintenancePasswordLines.Count -ne 1) { throw 'Senha de manutenção inválida' }
$maintenancePassword = $maintenancePasswordLines[0].Substring('DB_PASSWORD='.Length)
$clientContent = @(
  '[client]', 'host=127.0.0.1', 'port=3307', 'user=sage_maintenance',
  "password=$maintenancePassword", ''
) -join [Environment]::NewLine
Write-PrivateTextOnce (Join-Path $configDir 'maintenance-client.cnf') $clientContent

$shutdownClient = Join-Path $configDir 'shutdown-client.cnf'
$shutdownPassword = New-Secret
if (Test-Path -LiteralPath $shutdownClient) {
  Assert-RegularLocalPath $shutdownClient
  Assert-PrivateAcl $shutdownClient
  $shutdownPasswordLines = @([IO.File]::ReadAllLines($shutdownClient) |
    Where-Object { $_.StartsWith('password=') })
  if ($shutdownPasswordLines.Count -ne 1) { throw 'Senha de shutdown inválida' }
  $shutdownPassword = $shutdownPasswordLines[0].Substring('password='.Length)
}
if ($shutdownPassword -notmatch '^[A-Za-z0-9_-]{32,}$') { throw 'Senha de shutdown inválida' }
$shutdownContent = @(
  '[client]', 'protocol=TCP', 'host=127.0.0.1', 'port=3307', 'user=sage_shutdown',
  "password=$shutdownPassword", ''
) -join [Environment]::NewLine
Write-PrivateTextOnce $shutdownClient $shutdownContent

$mysqlIniContent = @(
  '[mysqld]'
  "basedir=$((Join-Path $programRoot 'runtime\mysql').Replace('\', '/'))"
  "datadir=$((Join-Path $dataRoot 'mysql\data').Replace('\', '/'))"
  "tmpdir=$((Join-Path $dataRoot 'mysql\tmp').Replace('\', '/'))"
  'port=3307'
  'bind-address=127.0.0.1'
  'mysqlx=0'
  'skip-name-resolve'
  'local-infile=OFF'
  'innodb-flush-log-at-trx-commit=1'
  "log-error=$((Join-Path $dataRoot 'logs\mysql\mysql-error.log').Replace('\', '/'))"
  'log-error-verbosity=2'
  ''
) -join [Environment]::NewLine
Write-PrivateTextOnce (Join-Path $configDir 'mysql.ini') $mysqlIniContent

Write-Host 'Estado privado do SAGE inicializado; nenhum segredo foi exibido.'
} finally {
  if ($lockTaken) { [void]$mutex.ReleaseMutex() }
  $mutex.Dispose()
}
