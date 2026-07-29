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
    if ($requiredSids -notcontains $sid -or
        $rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
        ($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -ne
          [Security.AccessControl.FileSystemRights]::FullControl) {
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

$mutex = [Threading.Mutex]::new($false, 'Global\SAGE-State-Initialization')
$lockTaken = $false
try {
try { $lockTaken = $mutex.WaitOne(0) }
catch [Threading.AbandonedMutexException] { $lockTaken = $true }
if (-not $lockTaken) { throw 'Outro provisionamento do SAGE está em execução' }
$directories = @('config', 'mysql', 'logs', 'backups', 'uploads', 'exports')
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
Write-ConfigOnce (Join-Path $configDir 'sage.env') ([ordered]@{
  NODE_ENV='production'; PORT='3000'; SAGE_DATA_DIR=$dataRoot; SAGE_REQUIRE_WEB='true'
  DB_HOST='127.0.0.1'; DB_PORT='3307'; DB_USER='sage_runtime'; DB_PASSWORD=$secretMarker
  DB_NAME='sage'; REDIS_ENABLED='false'; JWT_SECRET=$secretMarker
  MONITOR_USE_PUSH='false'; MONITOR_POLLING_INTERVAL_MS='20000'; MONITOR_CALLBACK_TOKEN=$secretMarker
  MYSQLDUMP_PATH=(Join-Path $programRoot 'runtime\mysql\bin\mysqldump.exe')
  MYSQL_PATH=(Join-Path $programRoot 'runtime\mysql\bin\mysql.exe')
}) {
  [ordered]@{
  NODE_ENV='production'; PORT='3000'; SAGE_DATA_DIR=$dataRoot; SAGE_REQUIRE_WEB='true'
  DB_HOST='127.0.0.1'; DB_PORT='3307'; DB_USER='sage_runtime'; DB_PASSWORD=(New-Secret)
  DB_NAME='sage'; REDIS_ENABLED='false'; JWT_SECRET=(New-Secret 48)
  MONITOR_USE_PUSH='false'; MONITOR_POLLING_INTERVAL_MS='20000'; MONITOR_CALLBACK_TOKEN=(New-Secret)
  MYSQLDUMP_PATH=(Join-Path $programRoot 'runtime\mysql\bin\mysqldump.exe')
  MYSQL_PATH=(Join-Path $programRoot 'runtime\mysql\bin\mysql.exe')
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

Write-Host 'Estado privado do SAGE inicializado; nenhum segredo foi exibido.'
} finally {
  if ($lockTaken) { [void]$mutex.ReleaseMutex() }
  $mutex.Dispose()
}
