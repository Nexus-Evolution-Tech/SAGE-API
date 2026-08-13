[CmdletBinding()]
param()

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

& $provision -Version $targetVersion
if (-not $?) { throw 'Provisionamento base falhou' }

try {
  try {
    $env:SAGE_CONFIG_FILE = Join-Path $dataRoot 'config\maintenance.env'
    $env:SAGE_ALLOW_FIRST_RUN_ONBOARDING = 'true'
    $env:SAGE_MAINTENANCE_CONFIG_FILE = Join-Path $dataRoot 'config\maintenance.env'
    $env:MYSQL_DEFAULTS_EXTRA_FILE = Join-Path $dataRoot 'config\maintenance-client.cnf'
    $env:MYSQLDUMP_PATH = Join-Path $programRoot 'runtime\mysql\bin\mysqldump.exe'
    $env:MYSQL_PATH = Join-Path $programRoot 'runtime\mysql\bin\mysql.exe'
    $env:SAGE_REQUIRE_MAINTENANCE_DB = 'true'
    Push-Location -LiteralPath $apiRoot
    try {
      if ($previousVersion) {
        $backupCheck = "const b=require('./src/services/backupBanco');(async()=>{const x=await b.gerarBackup();const v=await b.verificarBackup(x.caminho);if(!v.ok)throw new Error('backup reprovado')})().catch(()=>process.exit(1))"
        & $node -e $backupCheck
        if ($LASTEXITCODE -ne 0) { throw 'Backup verificado antes da migration falhou' }
      }
      & $node 'scripts\setup-database.js'
      if ($LASTEXITCODE -ne 0) { throw "Setup do banco falhou com exit $LASTEXITCODE" }
    } finally { Pop-Location }
  } finally {
    Remove-Item Env:SAGE_CONFIG_FILE, Env:SAGE_ALLOW_FIRST_RUN_ONBOARDING,
      Env:SAGE_MAINTENANCE_CONFIG_FILE, Env:MYSQL_DEFAULTS_EXTRA_FILE,
      Env:MYSQLDUMP_PATH, Env:MYSQL_PATH, Env:SAGE_REQUIRE_MAINTENANCE_DB -ErrorAction SilentlyContinue
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
