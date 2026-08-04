[CmdletBinding()]
param([string]$CredentialFile = '')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$programRoot = Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'SAGE'
$dataRoot = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'SAGE'
$serviceRoot = Join-Path $programRoot 'service'
$release = [IO.File]::ReadAllText((Join-Path $programRoot 'release.json')) | ConvertFrom-Json
$targetVersion = $release.version
$apiRoot = Join-Path $programRoot "releases\$targetVersion\api"
$node = Join-Path $programRoot 'runtime\node\node.exe'
$provision = Join-Path $serviceRoot 'provision-services.ps1'
$expectedCredentialFile = Join-Path $dataRoot 'config\initial-admin.pending'
$currentMarker = Join-Path $dataRoot 'current.json'
$pendingMarker = Join-Path $dataRoot 'current.json.pending'
$previousVersion = $null
if (Test-Path -LiteralPath $currentMarker -PathType Leaf) {
  $current = [IO.File]::ReadAllText($currentMarker) | ConvertFrom-Json
  if ($current.version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$' -or
      -not (Test-Path -LiteralPath (Join-Path $programRoot "releases\$($current.version)\api") -PathType Container)) {
    throw 'Marcador da versão ativa inválido'
  }
  $previousVersion = $current.version
}

function Assert-PrivateAcl {
  param($Acl, [bool]$RequireProtected)
  $allowed = @('S-1-5-18', 'S-1-5-32-544')
  $seen = @{}
  if ($RequireProtected -and -not $Acl.AreAccessRulesProtected) { throw 'ACL privada herdável' }
  foreach ($rule in $Acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    $sid = $rule.IdentityReference.Value
    if ($allowed -notcontains $sid -or
        $rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
        ($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -ne
          [Security.AccessControl.FileSystemRights]::FullControl) {
      throw 'ACL da credencial inicial não é privada'
    }
    $seen[$sid] = $true
  }
  foreach ($sid in $allowed) {
    if (-not $seen.ContainsKey($sid)) { throw 'ACL privada incompleta' }
  }
}

function Read-InitialCredential {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw 'Credencial inicial ausente' }
  $item = Get-Item -LiteralPath $Path -Force
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Credencial inicial inválida' }
  $parentAcl = Get-Acl -LiteralPath (Split-Path -Parent $Path)
  if (-not $parentAcl.AreAccessRulesProtected) { throw 'Diretório da credencial inicial não é privado' }
  Assert-PrivateAcl (Get-Acl -LiteralPath $Path) $false
  $values = @{}
  foreach ($line in [IO.File]::ReadAllLines($Path)) {
    if ($line -notmatch '^([A-Z]+)=(.*)$' -or $values.ContainsKey($Matches[1])) {
      throw 'Credencial inicial inválida'
    }
    $values[$Matches[1]] = $Matches[2]
  }
  if ($values.Keys.Count -ne 3 -or $values.LOGIN.Length -lt 3 -or
      $values.PASSWORD.Length -lt 16 -or -not $values.SCHOOL) {
    throw 'Credencial inicial incompleta'
  }
  return $values
}

& $provision -Version $targetVersion
if (-not $?) { throw 'Provisionamento base falhou' }

$credential = $null
try {
  try {
    if ($CredentialFile) {
      if ([IO.Path]::GetFullPath($CredentialFile) -cne [IO.Path]::GetFullPath($expectedCredentialFile)) {
        throw 'Caminho da credencial inicial inválido'
      }
      $credential = Read-InitialCredential $CredentialFile
      $env:SAGE_INITIAL_ADMIN_LOGIN = $credential.LOGIN
      $env:SAGE_INITIAL_ADMIN_PASSWORD = $credential.PASSWORD
      $env:SAGE_INITIAL_SCHOOL_NAME = $credential.SCHOOL
    }
    $env:SAGE_CONFIG_FILE = Join-Path $dataRoot 'config\maintenance.env'
    Push-Location -LiteralPath $apiRoot
    try {
      & $node 'scripts\setup-database.js'
      if ($LASTEXITCODE -ne 0) { throw "Setup do banco falhou com exit $LASTEXITCODE" }
    } finally { Pop-Location }
  } finally {
    Remove-Item Env:SAGE_INITIAL_ADMIN_LOGIN, Env:SAGE_INITIAL_ADMIN_PASSWORD,
      Env:SAGE_INITIAL_SCHOOL_NAME, Env:SAGE_CONFIG_FILE -ErrorAction SilentlyContinue
    if ($CredentialFile -and (Test-Path -LiteralPath $CredentialFile)) {
      [IO.File]::Delete($CredentialFile)
    }
  }

  & $provision -Version $targetVersion -StartApi
  if (-not $?) { throw 'Ativação da API falhou' }
  $ready = Invoke-RestMethod 'http://127.0.0.1:3000/ready' -TimeoutSec 5
  if ($ready.status -cne 'ready' -or $ready.version -cne $targetVersion) {
    throw 'Readiness final divergente'
  }
  if (Test-Path -LiteralPath $pendingMarker) { throw 'Marcador pendente preexistente' }
  $marker = [ordered]@{
    schemaVersion = 1
    version = $targetVersion
    apiCommit = $release.source.apiCommit
    activatedAt = [DateTime]::UtcNow.ToString('o')
  } | ConvertTo-Json
  $stream = [IO.File]::Open($pendingMarker, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try {
    $writer = [IO.StreamWriter]::new($stream, [Text.UTF8Encoding]::new($false))
    try { $writer.Write($marker) } finally { $writer.Dispose() }
  } finally { $stream.Dispose() }
  Move-Item -LiteralPath $pendingMarker -Destination $currentMarker -Force
} catch {
  $activationError = $_
  if ($previousVersion) {
    try {
      & $provision -Version $previousVersion -StartApi
      if (-not $?) { throw 'Readiness anterior falhou' }
    } catch {
      throw "Rollback automático do código falhou após erro de ativação: $($_.Exception.Message)"
    }
  }
  throw $activationError
} finally {
  if (Test-Path -LiteralPath $pendingMarker) { [IO.File]::Delete($pendingMarker) }
}
Write-Host 'Instalação interna concluída sem exibir credenciais.'
