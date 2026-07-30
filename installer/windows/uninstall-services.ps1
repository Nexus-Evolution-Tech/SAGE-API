[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw 'A remoção dos serviços SAGE só pode rodar no Windows'
}
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'A remoção dos serviços SAGE exige elevação administrativa'
}

$programRoot = Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'SAGE'
$configRoot = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'SAGE\config'
$mysqld = Join-Path $programRoot 'runtime\mysql\bin\mysqld.exe'
$mysqladmin = Join-Path $programRoot 'runtime\mysql\bin\mysqladmin.exe'
$mysqlIni = Join-Path $configRoot 'mysql.ini'
$shutdownClient = Join-Path $configRoot 'shutdown-client.cnf'
$winsw = Join-Path $programRoot 'service\SAGE-API.exe'
$node = Join-Path $programRoot 'runtime\node\node.exe'
$sc = Join-Path ([Environment]::SystemDirectory) 'sc.exe'
$firewallName = 'SAGE-API-LAN'

if (-not (Test-Path -LiteralPath $sc -PathType Leaf)) {
  throw "Service Controller do Windows ausente: $sc"
}

function Get-ServiceRecord {
  param([string]$Name)
  return Get-CimInstance Win32_Service -Filter "Name='$Name'" -ErrorAction SilentlyContinue
}

function Assert-ServiceRecord {
  param([string]$Name, [string[]]$AllowedPathNames)
  $record = Get-ServiceRecord $Name
  if ($null -ne $record -and ($AllowedPathNames -notcontains $record.PathName.Trim() -or
      $record.StartName -ne 'NT AUTHORITY\LocalService')) {
    throw "Serviço preexistente divergente; remoção recusada: $Name"
  }
}

function Test-ServiceMarkedForDeletion {
  param($ErrorRecord)
  $exception = $ErrorRecord.Exception
  while ($null -ne $exception) {
    $nativeCode = $exception.PSObject.Properties['NativeErrorCode']
    if ($null -ne $nativeCode -and $exception.NativeErrorCode -eq 1072) { return $true }
    $exception = $exception.InnerException
  }
  return $false
}

function Assert-RegularFile {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Arquivo obrigatório ausente: $Path" }
  $current = $Path
  while ($current) {
    if ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
      throw "Reparse point não permitido: $current"
    }
    $parent = Split-Path -Parent $current
    if ($parent -eq $current) { break }
    $current = $parent
  }
}

function Assert-SystemAdminAcl {
  param([string]$Path)
  $acl = Get-Acl -LiteralPath $Path
  $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
  $allowed = @('S-1-5-18', 'S-1-5-32-544')
  $identities = @($rules.IdentityReference.Value | Sort-Object -Unique)
  if (-not $acl.AreAccessRulesProtected -or $rules.Count -ne 2 -or $identities.Count -ne 2 -or
      @($rules | Where-Object {
        $allowed -notcontains $_.IdentityReference.Value -or $_.AccessControlType -ne 'Allow' -or
        ($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -ne
          [Security.AccessControl.FileSystemRights]::FullControl
      }).Count -ne 0) { throw "ACL privada divergente: $Path" }
}

function Disable-And-StopService {
  param([string]$Name)
  $service = Get-Service $Name -ErrorAction SilentlyContinue
  if ($null -eq $service) { return }
  try {
    Set-Service $Name -StartupType Disabled
    if ($service.Status -ne 'Stopped') {
      Stop-Service $Name -Force
      $service.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(120))
    }
  } catch {
    if (-not (Test-ServiceMarkedForDeletion $_)) { throw }
  }
}

function Stop-MySqlGracefully {
  $service = Get-Service SAGEMySQL -ErrorAction SilentlyContinue
  if ($null -eq $service -or $service.Status -eq 'Stopped') { return }
  try { Set-Service SAGEMySQL -StartupType Disabled }
  catch { if (-not (Test-ServiceMarkedForDeletion $_)) { throw } }
  Assert-RegularFile $mysqladmin
  Assert-RegularFile $shutdownClient
  Assert-SystemAdminAcl $shutdownClient
  & $mysqladmin "--defaults-extra-file=$shutdownClient" shutdown 2>$null | Out-Null
  $exitCode = $LASTEXITCODE
  $current = Get-Service SAGEMySQL -ErrorAction SilentlyContinue
  if ($exitCode -ne 0 -and $null -ne $current -and $current.Status -ne 'Stopped') {
    throw "MySQL recusou parada segura com exit $exitCode"
  }
  if ($null -ne $current -and $current.Status -ne 'Stopped') {
    $current.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(120))
  }
}

function Assert-FirewallRuleOwned {
  param($Rule)
  $port = @(Get-NetFirewallPortFilter -AssociatedNetFirewallRule $Rule)
  $address = @(Get-NetFirewallAddressFilter -AssociatedNetFirewallRule $Rule)
  $application = @(Get-NetFirewallApplicationFilter -AssociatedNetFirewallRule $Rule)
  $security = @(Get-NetFirewallSecurityFilter -AssociatedNetFirewallRule $Rule)
  if ($Rule.DisplayName -cne 'SAGE API (LAN privada)' -or $Rule.Group -cne 'SAGE' -or
      $Rule.Enabled.ToString() -cne 'True' -or
      $Rule.Direction.ToString() -cne 'Inbound' -or $Rule.Action.ToString() -cne 'Allow' -or
      $Rule.EdgeTraversalPolicy.ToString() -cne 'Block' -or
      [int]$Rule.Profile -ne 3 -or $port.Count -ne 1 -or
      $port.Protocol.ToString() -cne 'TCP' -or $port.LocalPort.ToString() -cne '3000' -or
      $port.RemotePort.ToString() -cne 'Any' -or
      $address.Count -ne 1 -or @($address.RemoteAddress).Count -ne 1 -or
      $address.RemoteAddress -cne 'LocalSubnet' -or $application.Count -ne 1 -or
      $application.Program -cne $node -or $security.Count -ne 1 -or
      $security.OverrideBlockRules.ToString() -cne 'False') {
    throw "Regra de firewall divergente; remoção recusada: $firewallName"
  }
}

function Remove-ServiceRecord {
  param([string]$Name)
  if ($null -eq (Get-ServiceRecord $Name)) { return }
  & $sc delete $Name | Out-Null
  $exitCode = $LASTEXITCODE
  if ($exitCode -notin @(0, 1060, 1072) -and $null -ne (Get-ServiceRecord $Name)) {
    throw "$sc delete $Name falhou com exit $exitCode"
  }
}

function Get-SageProcesses {
  $programPrefix = $programRoot.TrimEnd('\') + '\'
  return @(Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.StartsWith(
      $programPrefix, [StringComparison]::OrdinalIgnoreCase
    )
  })
}

$lifecycleMutex = [Threading.Mutex]::new($false, 'Global\SAGE-Service-Lifecycle')
$lifecycleLockTaken = $false
try {
  try { $lifecycleLockTaken = $lifecycleMutex.WaitOne([TimeSpan]::FromSeconds(60)) }
  catch [Threading.AbandonedMutexException] { $lifecycleLockTaken = $true }
  if (-not $lifecycleLockTaken) { throw 'Outra operação de serviço SAGE continua em execução' }

$mysqlPaths = @(
  "`"$mysqld`" --defaults-file=`"$mysqlIni`" SAGEMySQL",
  "`"$mysqld`" --defaults-file=$mysqlIni SAGEMySQL"
)
Assert-ServiceRecord 'SAGEMySQL' $mysqlPaths
Assert-ServiceRecord 'SAGEAPI' @("`"$winsw`"", $winsw)
$firewallRules = @(Get-NetFirewallRule -PolicyStore PersistentStore -Name $firewallName `
  -ErrorAction SilentlyContinue)
if ($firewallRules.Count -gt 1) { throw "Mais de uma regra local usa o nome: $firewallName" }
if ($firewallRules.Count -eq 1) { Assert-FirewallRuleOwned $firewallRules[0] }

Disable-And-StopService 'SAGEAPI'
Remove-ServiceRecord 'SAGEAPI'

Stop-MySqlGracefully
Disable-And-StopService 'SAGEMySQL'
Remove-ServiceRecord 'SAGEMySQL'

$remaining = @(Get-SageProcesses)
foreach ($process in $remaining) {
  if (-not $process.ExecutablePath.Equals($mysqld, [StringComparison]::OrdinalIgnoreCase)) {
    Stop-Process -Id $process.ProcessId -Force
  }
}

for ($attempt = 0; $attempt -lt 240; $attempt++) {
  $remaining = @(Get-SageProcesses)
  if ($remaining.Count -eq 0 -and -not (Get-ServiceRecord 'SAGEAPI') -and
      -not (Get-ServiceRecord 'SAGEMySQL')) { break }
  Start-Sleep -Milliseconds 250
}
if (@($remaining | Where-Object {
      $_.ExecutablePath.Equals($mysqld, [StringComparison]::OrdinalIgnoreCase)
    }).Count -ne 0) {
  throw 'MySQL não encerrou de forma segura; encerramento forçado recusado'
}
if ($remaining.Count -ne 0 -or (Get-ServiceRecord 'SAGEAPI') -or
    (Get-ServiceRecord 'SAGEMySQL')) {
  throw 'Processo ou serviço SAGE permaneceu após a remoção'
}

if ($firewallRules.Count -eq 1) {
  $firewallRules[0] | Remove-NetFirewallRule
  if (Get-NetFirewallRule -PolicyStore PersistentStore -Name $firewallName `
      -ErrorAction SilentlyContinue) {
    throw "Regra de firewall não foi removida: $firewallName"
  }
}

Write-Host 'Serviços e firewall do SAGE removidos; dados escolares preservados.'
} finally {
  if ($lifecycleLockTaken) { $lifecycleMutex.ReleaseMutex() }
  $lifecycleMutex.Dispose()
}
