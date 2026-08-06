$ErrorActionPreference = 'Stop'
$mysqladmin = 'C:\Program Files\SAGE\runtime\mysql\bin\mysqladmin.exe'
$shutdownClient = 'C:\ProgramData\SAGE\config\shutdown-client.cnf'
if (-not (Test-Path -LiteralPath $mysqladmin -PathType Leaf) -or
    -not (Test-Path -LiteralPath $shutdownClient -PathType Leaf)) {
  throw 'Componentes de shutdown do MySQL ausentes'
}
& $mysqladmin "--defaults-extra-file=$shutdownClient" shutdown 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Shutdown gracioso do MySQL falhou com exit $LASTEXITCODE" }
