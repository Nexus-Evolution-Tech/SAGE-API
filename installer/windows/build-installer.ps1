[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$LayoutDirectory,
  [Parameter(Mandatory = $true)][string]$OutputDirectory
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$layout = (Resolve-Path -LiteralPath $LayoutDirectory).Path
$release = [IO.File]::ReadAllText((Join-Path $layout 'release.json')) | ConvertFrom-Json
if ($release.distribution.public -ne $false) { throw 'Builder interno recusa layout público' }
$iscc = @(
  (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'),
  (Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe'),
  (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs\Inno Setup 6\ISCC.exe')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
if (-not $iscc) { throw 'ISCC.exe 6.7.3 não encontrado' }
[void][IO.Directory]::CreateDirectory([IO.Path]::GetFullPath($OutputDirectory))
& $iscc '/Qp' '/DInternalBuild=1' "/DSourceRoot=$layout" "/DAppVersion=$($release.version)" `
  "/DInstallerOutput=$([IO.Path]::GetFullPath($OutputDirectory))" `
  (Join-Path $PSScriptRoot 'SAGE.iss')
if ($LASTEXITCODE -ne 0) { throw "Inno Setup falhou com exit $LASTEXITCODE" }
