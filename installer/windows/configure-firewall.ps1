[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw 'O firewall do SAGE só pode ser configurado no Windows'
}
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'A configuração do firewall exige elevação administrativa'
}

$programRoot = Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'SAGE'
$node = Join-Path $programRoot 'runtime\node\node.exe'
$ruleName = 'SAGE-API-LAN'
$displayName = 'SAGE API (LAN privada)'
$group = 'SAGE'

if (-not (Test-Path -LiteralPath $node -PathType Leaf)) {
  throw "Runtime Node obrigatório ausente: $node"
}
$nodeItem = Get-Item -LiteralPath $node -Force
if (($nodeItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
  throw "Runtime Node não pode ser reparse point: $node"
}
$profiles = @(Get-NetFirewallProfile -PolicyStore ActiveStore -Name Domain,Private,Public)
$unsafeProfiles = @($profiles | Where-Object {
  $_.Enabled.ToString() -cne 'True' -or $_.DefaultInboundAction.ToString() -cne 'Block'
})
if ($profiles.Count -ne 3 -or $unsafeProfiles.Count -ne 0) {
  throw 'O firewall precisa estar ativo e bloquear entrada por padrão em todos os perfis'
}

function Assert-SageFirewallRule {
  param($Rule, [string]$Source)
  $port = @(Get-NetFirewallPortFilter -AssociatedNetFirewallRule $Rule)
  $address = @(Get-NetFirewallAddressFilter -AssociatedNetFirewallRule $Rule)
  $application = @(Get-NetFirewallApplicationFilter -AssociatedNetFirewallRule $Rule)
  $remote = @($address.RemoteAddress)
  if ($Rule.DisplayName -cne $displayName -or $Rule.Group -cne $group -or
      $Rule.Direction.ToString() -cne 'Inbound' -or $Rule.Action.ToString() -cne 'Allow' -or
      $Rule.Enabled.ToString() -cne 'True' -or [int]$Rule.Profile -ne 3 -or
      $Rule.OverrideBlockRules.ToString() -cne 'False' -or
      $Rule.EdgeTraversalPolicy.ToString() -cne 'Block' -or
      $port.Count -ne 1 -or $port.Protocol.ToString() -cne 'TCP' -or
      $port.LocalPort.ToString() -cne '3000' -or $port.RemotePort.ToString() -cne 'Any' -or
      $address.Count -ne 1 -or $remote.Count -ne 1 -or $remote[0] -cne 'LocalSubnet' -or
      $application.Count -ne 1 -or $application.Program -cne $node) {
    throw "Regra de firewall $Source divergente: $ruleName"
  }
}

$mutex = [Threading.Mutex]::new($false, 'Global\SAGE-Firewall-Configuration')
$lockTaken = $false
try {
  try { $lockTaken = $mutex.WaitOne([TimeSpan]::FromSeconds(30)) }
  catch [Threading.AbandonedMutexException] { $lockTaken = $true }
  if (-not $lockTaken) { throw 'Outro provisionamento do firewall SAGE está em execução' }

  $rules = @(Get-NetFirewallRule -PolicyStore PersistentStore -Name $ruleName `
    -ErrorAction SilentlyContinue)
  if ($rules.Count -gt 1) { throw "Mais de uma regra de firewall usa o nome: $ruleName" }
  if ($rules.Count -eq 0) {
    New-NetFirewallRule -PolicyStore PersistentStore -Name $ruleName -DisplayName $displayName `
      -Group $group -Direction Inbound -Action Allow -Enabled True -Profile Domain,Private `
      -Protocol TCP -LocalPort 3000 -RemoteAddress LocalSubnet -Program $node `
      -EdgeTraversalPolicy Block | Out-Null
    $rules = @(Get-NetFirewallRule -PolicyStore PersistentStore -Name $ruleName)
  }
  if ($rules.Count -ne 1) { throw "Regra de firewall não foi criada: $ruleName" }
  Assert-SageFirewallRule $rules[0] 'persistente'

  $activeRules = @()
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    $activeRules = @(Get-NetFirewallRule -PolicyStore ActiveStore -Name $ruleName `
      -TracePolicyStore -ErrorAction SilentlyContinue)
    if ($activeRules.Count -eq 1) { break }
    Start-Sleep -Milliseconds 250
  }
  if ($activeRules.Count -ne 1) { throw "Regra de firewall não está ativa: $ruleName" }
  if ($activeRules[0].PolicyStoreSourceType.ToString() -cne 'Local') {
    throw "GPO sobrescreveu a regra de firewall do SAGE: $ruleName"
  }
  Assert-SageFirewallRule $activeRules[0] 'efetiva'
} finally {
  if ($lockTaken) { [void]$mutex.ReleaseMutex() }
  $mutex.Dispose()
}

Write-Host 'Firewall do SAGE restrito a Domain/Private e LocalSubnet.'
