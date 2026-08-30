[CmdletBinding()]
param([switch]$StartApi, [string]$Version = '')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw 'Os serviços do SAGE só podem ser provisionados no Windows'
}
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'O provisionamento dos serviços exige elevação administrativa'
}

$programRoot = Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'SAGE'
$dataRoot = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'SAGE'
$configRoot = Join-Path $dataRoot 'config'
$mysqlRoot = Join-Path $programRoot 'runtime\mysql'
$mysqld = Join-Path $mysqlRoot 'bin\mysqld.exe'
$mysqladmin = Join-Path $mysqlRoot 'bin\mysqladmin.exe'
$mysqlIni = Join-Path $configRoot 'mysql.ini'
$maintenanceClient = Join-Path $configRoot 'maintenance-client.cnf'
$winsw = Join-Path $PSScriptRoot 'SAGE-API.exe'
$winswXml = Join-Path $PSScriptRoot 'SAGE-API.xml'
$mysqlWinsw = Join-Path $PSScriptRoot 'SAGE-MySQL.exe'
$mysqlWinswXml = Join-Path $PSScriptRoot 'SAGE-MySQL.xml'
$releaseFile = Join-Path $programRoot 'release.json'
$sc = Join-Path ([Environment]::SystemDirectory) 'sc.exe'

function Assert-RegularPath {
  param([string]$Path, [bool]$Leaf)
  $pathType = if ($Leaf) { 'Leaf' } else { 'Container' }
  if (-not (Test-Path -LiteralPath $Path -PathType $pathType)) {
    throw "Componente obrigatório ausente: $Path"
  }
  $item = Get-Item -LiteralPath $Path -Force
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "Reparse point não permitido: $Path"
  }
}

function Invoke-NativeChecked {
  param([string]$File, [string[]]$Arguments)
  & $File @Arguments | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "$File falhou com exit $LASTEXITCODE" }
}

function Get-ServiceRecord {
  param([string]$Name)
  return Get-CimInstance Win32_Service -Filter "Name='$Name'" -ErrorAction SilentlyContinue
}

function Grant-ServiceAccess {
  param(
    [string]$Path,
    [Security.Principal.SecurityIdentifier]$Sid,
    [Security.AccessControl.FileSystemRights]$Rights,
    [Security.AccessControl.InheritanceFlags]$Inheritance
  )
  $acl = Get-Acl -LiteralPath $Path
  $rule = [Security.AccessControl.FileSystemAccessRule]::new(
    $Sid, $Rights, $Inheritance, [Security.AccessControl.PropagationFlags]::None,
    [Security.AccessControl.AccessControlType]::Allow
  )
  $acl.SetAccessRule($rule)
  Set-Acl -LiteralPath $Path -AclObject $acl
}

function Resolve-ServiceSid {
  param([string]$Name)
  return [Security.Principal.NTAccount]::new('NT SERVICE', $Name).Translate(
    [Security.Principal.SecurityIdentifier]
  )
}

function Assert-ServiceRecord {
  param([string]$Name, [string[]]$AllowedPathNames)
  $record = Get-ServiceRecord $Name
  if ($null -eq $record -or $AllowedPathNames -notcontains $record.PathName.Trim() -or
      $record.StartName -ne 'NT AUTHORITY\LocalService') {
    throw "Serviço preexistente divergente: $Name"
  }
}

function Assert-ServiceAccess {
  param([string]$Path, [Security.Principal.SecurityIdentifier]$Sid,
    [Security.AccessControl.FileSystemRights]$Required)
  $rules = (Get-Acl -LiteralPath $Path).GetAccessRules(
    $true, $true, [Security.Principal.SecurityIdentifier]
  ) | Where-Object { $_.IdentityReference.Value -eq $Sid.Value }
  $forbidden = [Security.AccessControl.FileSystemRights]::ChangePermissions -bor
    [Security.AccessControl.FileSystemRights]::TakeOwnership
  if (@($rules).Count -ne 1 -or $rules.AccessControlType -ne 'Allow' -or
      ($rules.FileSystemRights -band $Required) -ne $Required -or
      ($rules.FileSystemRights -band $forbidden)) {
    throw "ACL do serviço divergente: $Path"
  }
}

function Assert-ServiceAbsent {
  param([string]$Path, [Security.Principal.SecurityIdentifier]$Sid)
  $found = (Get-Acl -LiteralPath $Path).GetAccessRules(
    $true, $true, [Security.Principal.SecurityIdentifier]
  ) | Where-Object { $_.IdentityReference.Value -eq $Sid.Value }
  if ($found) { throw "Serviço possui acesso indevido: $Path" }
}

$lifecycleMutex = [Threading.Mutex]::new($false, 'Global\SAGE-Service-Lifecycle')
$lifecycleLockTaken = $false
try {
  try { $lifecycleLockTaken = $lifecycleMutex.WaitOne([TimeSpan]::FromSeconds(60)) }
  catch [Threading.AbandonedMutexException] { $lifecycleLockTaken = $true }
  if (-not $lifecycleLockTaken) { throw 'Outra operação de serviço SAGE continua em execução' }

foreach ($directory in @($programRoot, $mysqlRoot, $PSScriptRoot)) {
  Assert-RegularPath $directory $false
}
foreach ($file in @($mysqld, $mysqladmin, $winsw, $winswXml, $mysqlWinsw, $mysqlWinswXml, $releaseFile)) {
  Assert-RegularPath $file $true
}
Assert-RegularPath $sc $true
$xml = [xml][IO.File]::ReadAllText($winswXml)
$mysqlXml = [xml][IO.File]::ReadAllText($mysqlWinswXml)
$release = [IO.File]::ReadAllText($releaseFile) | ConvertFrom-Json
$activeVersion = if ($Version) { $Version } else { $release.version }
if ($activeVersion -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') {
  throw 'Versão ativa inválida'
}
$activeApiRoot = Join-Path $programRoot "releases\$activeVersion\api"
Assert-RegularPath $activeApiRoot $false
$expectedArguments = '"%BASE%\..\releases\' + $activeVersion + '\api\scripts\start-with-setup.js"'
$expectedWorkingDirectory = '%BASE%\..\releases\' + $activeVersion + '\api'
$xml.service.arguments = $expectedArguments
$xml.service.workingdirectory = $expectedWorkingDirectory
$xml.Save($winswXml)
if ($xml.service.id -cne 'SAGEAPI' -or $xml.service.depend -cne 'SAGEMySQL' -or
    $xml.service.serviceaccount.user -cne 'LocalService' -or
    $xml.service.executable -cne '%BASE%\..\runtime\node\node.exe' -or
    $xml.service.arguments -cne $expectedArguments -or
    $xml.service.workingdirectory -cne $expectedWorkingDirectory -or
    $release.product -cne 'SAGE' -or $release.target -cne 'win32-x64' -or
    $release.version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$' -or
    [IO.File]::ReadAllText($winswXml) -match '(?i)password|secret|token') {
  throw 'Configuração WinSW inválida ou contém segredo'
}
if ($mysqlXml.service.id -cne 'SAGEMySQL' -or
    $mysqlXml.service.serviceaccount.user -cne 'LocalService' -or
    $mysqlXml.service.executable -cne '%BASE%\..\runtime\mysql\bin\mysqld.exe' -or
    $mysqlXml.service.stopexecutable -cne
      '%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe' -or
    [IO.File]::ReadAllText($mysqlWinswXml) -match '(?i)password|secret|token') {
  throw 'Configuração WinSW do MySQL inválida ou contém segredo'
}

$mysqlService = Get-ServiceRecord 'SAGEMySQL'
$mysqlPathNames = @(
  "`"$mysqld`" --defaults-file=`"$mysqlIni`" SAGEMySQL",
  "`"$mysqld`" --defaults-file=$mysqlIni SAGEMySQL"
)
if ($null -ne $mysqlService) {
  Assert-ServiceRecord 'SAGEMySQL' (@($mysqlPathNames) + @("`"$mysqlWinsw`"", $mysqlWinsw))
}
$apiService = Get-ServiceRecord 'SAGEAPI'
if ($null -ne $apiService) { Assert-ServiceRecord 'SAGEAPI' @("`"$winsw`"", $winsw) }

# A primeira passagem protege o estado antes de qualquer registro no SCM.
& (Join-Path $PSScriptRoot 'initialize-state.ps1')
if (-not $?) { throw 'Estado privado falhou antes do registro dos serviços' }
foreach ($directory in @($dataRoot, $configRoot)) { Assert-RegularPath $directory $false }
foreach ($file in @($mysqlIni, $maintenanceClient)) { Assert-RegularPath $file $true }

if ($null -eq $mysqlService) {
  Invoke-NativeChecked $mysqlWinsw @('install')
  $mysqlService = Get-ServiceRecord 'SAGEMySQL'
}
if ($null -eq $apiService) {
  Invoke-NativeChecked $winsw @('install')
  $apiService = Get-ServiceRecord 'SAGEAPI'
}

& (Join-Path $PSScriptRoot 'initialize-state.ps1')
if (-not $?) { throw 'Estado privado falhou' }
foreach ($directory in @($dataRoot, $configRoot)) { Assert-RegularPath $directory $false }
foreach ($file in @($mysqlIni, $maintenanceClient)) { Assert-RegularPath $file $true }

if ($null -ne $mysqlService -and $mysqlPathNames -contains $mysqlService.PathName.Trim()) {
  if ((Get-Service SAGEMySQL).Status -ne 'Stopped') { Stop-Service SAGEMySQL }
  Invoke-NativeChecked $mysqld @('--remove', 'SAGEMySQL')
  for ($attempt = 0; $attempt -lt 40 -and (Get-ServiceRecord 'SAGEMySQL'); $attempt++) {
    Start-Sleep -Milliseconds 250
  }
  if (Get-ServiceRecord 'SAGEMySQL') { throw 'Serviço MySQL nativo não foi removido' }
  Invoke-NativeChecked $mysqlWinsw @('install')
  $mysqlService = Get-ServiceRecord 'SAGEMySQL'
}
Assert-ServiceRecord 'SAGEMySQL' @("`"$mysqlWinsw`"", $mysqlWinsw)
Assert-ServiceRecord 'SAGEAPI' @("`"$winsw`"", $winsw)

foreach ($name in @('SAGEMySQL', 'SAGEAPI')) {
  Invoke-NativeChecked $sc @('sidtype', $name, 'unrestricted')
}
$failureActions = 'restart/5000/restart/30000/restart/120000'
foreach ($name in @('SAGEMySQL', 'SAGEAPI')) {
  Invoke-NativeChecked $sc @('failure', $name, 'reset=', '3600', 'actions=', $failureActions)
  Invoke-NativeChecked $sc @('failureflag', $name, '1')
}
if ((Get-Service SAGEAPI).RequiredServices.Name -notcontains 'SAGEMySQL') {
  throw 'SAGEAPI não depende de SAGEMySQL'
}

$mysqlSid = Resolve-ServiceSid 'SAGEMySQL'
$apiSid = Resolve-ServiceSid 'SAGEAPI'
$inheritAll = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
  [Security.AccessControl.InheritanceFlags]::ObjectInherit
$none = [Security.AccessControl.InheritanceFlags]::None
foreach ($sid in @($mysqlSid, $apiSid)) {
  Grant-ServiceAccess $dataRoot $sid ([Security.AccessControl.FileSystemRights]::ReadAndExecute) $none
  Grant-ServiceAccess (Join-Path $dataRoot 'logs') $sid `
    ([Security.AccessControl.FileSystemRights]::ReadAndExecute) $none
}
Grant-ServiceAccess (Join-Path $dataRoot 'mysql') $mysqlSid `
  ([Security.AccessControl.FileSystemRights]::ReadAndExecute) $none
Grant-ServiceAccess $configRoot $mysqlSid `
  ([Security.AccessControl.FileSystemRights]::ReadAndExecute) $none
foreach ($path in @('mysql\tmp', 'logs\mysql')) {
  Grant-ServiceAccess (Join-Path $dataRoot $path) $mysqlSid `
    ([Security.AccessControl.FileSystemRights]::Modify) $inheritAll
}
Grant-ServiceAccess $mysqlIni $mysqlSid ([Security.AccessControl.FileSystemRights]::Read) $none
Grant-ServiceAccess (Join-Path $configRoot 'shutdown-client.cnf') $mysqlSid `
  ([Security.AccessControl.FileSystemRights]::Read) $none
Grant-ServiceAccess $configRoot $apiSid `
  ([Security.AccessControl.FileSystemRights]::ReadAndExecute) $none
foreach ($path in @('logs\api', 'backups', 'uploads', 'exports')) {
  Grant-ServiceAccess (Join-Path $dataRoot $path) $apiSid `
    ([Security.AccessControl.FileSystemRights]::Modify) $inheritAll
}
foreach ($file in @('sage.env', 'maintenance.env', 'maintenance-client.cnf')) {
  Grant-ServiceAccess (Join-Path $configRoot $file) $apiSid `
    ([Security.AccessControl.FileSystemRights]::Read) $none
}

$dataDirectory = Join-Path $dataRoot 'mysql\data'
if (Test-Path -LiteralPath $dataDirectory) {
  Grant-ServiceAccess $dataDirectory $mysqlSid `
    ([Security.AccessControl.FileSystemRights]::Modify) $inheritAll
}
$marker = Join-Path $configRoot 'mysql-accounts.ready'
$null = Invoke-NativeChecked $sc @('config', 'SAGEMySQL', 'start=', 'auto')
$null = Invoke-NativeChecked $sc @('config', 'SAGEAPI', 'start=', 'delayed-auto')
$mysqlService = Get-Service SAGEMySQL
if (Test-Path -LiteralPath $marker) {
  if ($mysqlService.Status -ne 'Running') { Start-Service SAGEMySQL }
} elseif ($mysqlService.Status -ne 'Stopped') {
  Stop-Service SAGEMySQL -Force
}
& (Join-Path $PSScriptRoot 'initialize-mysql.ps1')
if (-not $?) { throw 'Bootstrap MySQL falhou' }
Grant-ServiceAccess $dataDirectory $mysqlSid `
  ([Security.AccessControl.FileSystemRights]::Modify) $inheritAll
Assert-ServiceAccess $dataDirectory $mysqlSid ([Security.AccessControl.FileSystemRights]::Modify)
Assert-ServiceAbsent $dataDirectory $apiSid
Assert-ServiceAccess (Join-Path $configRoot 'sage.env') $apiSid `
  ([Security.AccessControl.FileSystemRights]::Read)
Assert-ServiceAbsent (Join-Path $configRoot 'sage.env') $mysqlSid
$mysqlService = Get-Service SAGEMySQL
if ($mysqlService.Status -ne 'Running') { Start-Service SAGEMySQL }
for ($attempt = 0; $attempt -lt 60; $attempt++) {
  & $mysqladmin "--defaults-extra-file=$maintenanceClient" ping --silent 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { break }
  Start-Sleep -Milliseconds 500
}
if ($LASTEXITCODE -ne 0) { throw 'SAGEMySQL não ficou pronto' }

if ($StartApi) {
  & (Join-Path $PSScriptRoot 'configure-firewall.ps1')
  if (-not $?) { throw 'Firewall privado do SAGE falhou' }
  $apiService = Get-Service SAGEAPI
  if ($apiService.Status -eq 'Running') { Restart-Service SAGEAPI -Force }
  else { Start-Service SAGEAPI }
  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    try {
      $response = Invoke-WebRequest 'http://127.0.0.1:3000/ready' -UseBasicParsing -TimeoutSec 2
      $body = $response.Content | ConvertFrom-Json
      if ($response.StatusCode -eq 200 -and $body.status -ceq 'ready' -and
          $body.version -ceq $activeVersion) { $ready = $true; break }
    } catch { Start-Sleep -Milliseconds 500 }
  }
  if (-not $ready) { throw 'SAGEAPI não atingiu readiness' }
}

Write-Host 'Serviços privados do SAGE provisionados sem exibir segredos.'
} finally {
  if ($lifecycleLockTaken) { $lifecycleMutex.ReleaseMutex() }
  $lifecycleMutex.Dispose()
}
