[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ApiRepository,
  [Parameter(Mandatory = $true)][string]$WebRepository,
  [Parameter(Mandatory = $true)][string]$WorkDirectory,
  [Parameter(Mandatory = $true)][string]$OutputDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-Native {
  param([string]$File, [string[]]$Arguments, [string]$WorkingDirectory)
  Push-Location -LiteralPath $WorkingDirectory
  try {
    & $File @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$File falhou com exit $LASTEXITCODE" }
  } finally {
    Pop-Location
  }
}

function Get-GitHead {
  param([string]$Repository)
  Push-Location -LiteralPath $Repository
  try {
    $head = & git.exe rev-parse HEAD
    if ($LASTEXITCODE -ne 0 -or $head -notmatch '^[a-f0-9]{40,64}$') { throw 'Commit Git inválido' }
    return $head.Trim()
  } finally {
    Pop-Location
  }
}

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw 'O bundle final precisa ser produzido no Windows'
}
if ([Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne 'X64') {
  throw 'O bundle final precisa ser produzido em Windows x64 nativo'
}
if (Get-ChildItem Env: | Where-Object Name -Like 'REACT_APP_*') {
  throw 'Variáveis REACT_APP_* externas são recusadas para preservar same-origin'
}

$apiRoot = (Resolve-Path -LiteralPath $ApiRepository).Path
$webRoot = (Resolve-Path -LiteralPath $WebRepository).Path
$workRoot = [IO.Path]::GetFullPath($WorkDirectory)
$output = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $output) { throw 'OutputDirectory já existe' }
New-Item -ItemType Directory -Path $workRoot -Force | Out-Null
New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($output)) -Force | Out-Null

$nodeCommand = (Get-Command node.exe -ErrorAction Stop).Source
$npmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source
$runtimeExpression = 'JSON.stringify({platform:process.platform,arch:process.arch,major:Number(process.versions.node.split(".")[0])})'
$runtime = & $nodeCommand -p $runtimeExpression | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $runtime.platform -ne 'win32' -or $runtime.arch -ne 'x64' -or $runtime.major -ne 24) {
  throw 'Builder exige Node 24 x64 para Windows'
}

$session = Join-Path $workRoot ("session-" + [guid]::NewGuid().ToString('N'))
$apiZip = Join-Path $session 'api.zip'
$webZip = Join-Path $session 'web.zip'
$apiBuild = Join-Path $session 'api'
$webBuild = Join-Path $session 'web'
$artifactCache = Join-Path $workRoot 'artifacts'
$apiCommit = Get-GitHead $apiRoot
$webCommit = Get-GitHead $webRoot

try {
  New-Item -ItemType Directory -Path $session | Out-Null
  Invoke-Native 'git.exe' @('archive', '--format=zip', "--output=$apiZip", $apiCommit) $apiRoot
  Invoke-Native 'git.exe' @('archive', '--format=zip', "--output=$webZip", $webCommit) $webRoot
  Expand-Archive -LiteralPath $apiZip -DestinationPath $apiBuild
  Expand-Archive -LiteralPath $webZip -DestinationPath $webBuild

  $allowedReactApps = @('REACT_APP_API_URL', 'REACT_APP_SOCKET_URL')
  Get-ChildItem -LiteralPath $webBuild -Filter '.env*' -File | ForEach-Object {
    foreach ($line in Get-Content -LiteralPath $_.FullName) {
      if ($line -match 'REACT_APP_') {
        $parsed = [regex]::Match($line, '^[ \t]*(?:export[ \t]+)?(REACT_APP_[A-Z0-9_]+)[ \t]*=[ \t]*$')
        if (-not $parsed.Success) {
          throw "Variável REACT_APP_* com valor ou sintaxe não permitida em $($_.Name)"
        }
        if ($allowedReactApps -notcontains $parsed.Groups[1].Value) {
          throw "Variável REACT_APP_* não permitida em $($_.Name)"
        }
      }
    }
    Remove-Item -LiteralPath $_.FullName -Force
  }

  Invoke-Native $npmCommand @('ci', '--ignore-scripts', '--omit=dev') $apiBuild
  Invoke-Native $nodeCommand @('-e', "require('bcrypt').hash('probe',4).then(()=>process.exit(0)).catch(()=>process.exit(1))") $apiBuild

  $previousCi = $env:CI
  try {
    $env:CI = 'true'
    Invoke-Native $npmCommand @('ci', '--ignore-scripts') $webBuild
    Invoke-Native $npmCommand @('run', 'build') $webBuild
  } finally {
    $env:CI = $previousCi
  }

  if (Test-Path -LiteralPath $artifactCache) {
    Invoke-Native $nodeCommand @('scripts/verify-windows-artifacts.js', $artifactCache) $apiBuild
  } else {
    Invoke-Native $nodeCommand @('scripts/fetch-windows-artifacts.js', $artifactCache) $apiBuild
  }
  Invoke-Native $nodeCommand @(
    'scripts/assemble-windows-layout.js', $apiBuild, (Join-Path $webBuild 'build'), $artifactCache,
    $output, $apiCommit, $webCommit
  ) $apiBuild
} finally {
  if (Test-Path -LiteralPath $session) {
    Remove-Item -LiteralPath $session -Recurse -Force
  }
}

Write-Host "Layout Windows criado em $output"
