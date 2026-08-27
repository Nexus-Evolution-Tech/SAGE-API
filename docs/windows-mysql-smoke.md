# Fixture local de MySQL/schema — Windows 11 x64

Este procedimento verifica somente a pré-condição de banco do R2-02. Não é E2E, não inicia
a API ou o frontend e não cria escola, usuário, pessoa, presença, catraca ou outro dado de
domínio. Ubuntu é N/A neste ciclo.

## Pré-requisitos

- Windows 11 x64, PowerShell 5.1 e permissão para executar processos locais.
- Node.js 24 x64 disponível como `node.exe`.
- MySQL Community Server 8.4 x64 já extraído localmente, com `bin\mysqld.exe`,
  `bin\mysql.exe` e `bin\mysqladmin.exe`. O caminho não pode ser uma instalação compartilhada.
- Clone correto em `C:\SAGE-WS\SAGE-API`, na base `6a69f43` ou em descendente, e dependências
  instaladas com `npm ci --ignore-scripts`.

## Sequência exata

Abra PowerShell em `C:\SAGE-WS\SAGE-API` e execute:

```powershell
$ErrorActionPreference = 'Stop'
Set-Location 'C:\SAGE-WS\SAGE-API'
$commit = (git rev-parse HEAD).Trim()
if ($commit -ne '6a69f43cbd5b1cc17ec6083edb87c4d08a08e90') {
  throw "Base inesperada: $commit"
}
npm ci --ignore-scripts
if ($LASTEXITCODE -ne 0) { throw 'npm ci falhou' }
$mysqlRoot = 'C:\SAGE-WS\mysql-runtime\mysql-8.4.11-winx64'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$fixtureRoot = Join-Path $env:TEMP ('sage-r2-02-mysql-' + [guid]::NewGuid().ToString('N'))
& .\test\support\windows-mysql-fixture.ps1 -FixtureRoot $fixtureRoot `
  -MysqlRoot $mysqlRoot -ApiRepository (Get-Location).Path -NodeExecutable $node -Commit $commit
if ($LASTEXITCODE -ne 0) { throw 'Pré-condição MySQL/schema falhou' }
```

O helper cria datadir, tmpdir, binlog, configuração e logs somente em `$fixtureRoot`, escolhe
uma porta livre, usa `bind-address=127.0.0.1`, `log-bin=...` e
`log-bin-trust-function-creators=1` somente nessa fixture. O MySQL é real e 8.4; a conta
`sage_maintenance` é local, sem `SUPER` e sem privilégio global amplo.
O bootstrap usa autenticação root efêmera por shared memory; não usa `--skip-grant-tables`
nem qualquer modo que desative autenticação. O boot final é TCP autenticado normalmente.

O schema é provisionado pelo entrypoint existente `scripts/setup-database.js`, com
`SAGE_ALLOW_FIRST_RUN_ONBOARDING=true` e banco descartável. O helper confirma consulta
autenticada `SELECT 1` pelo cliente configurado, listener único no loopback,
versão/porta/datadir/tmpdir/configuração efetiva, tabelas
essenciais, ausência de linhas nas entidades de domínio e `SHOW GRANTS` sem `SUPER`/`GRANT
OPTION`. Qualquer pré-requisito ou verificação falha com exit diferente de zero; não há skip.

## Cleanup e evidência

O teardown ocorre em `finally`: envia `SHUTDOWN`, espera o processo terminar, confirma que a
porta não está ouvindo e remove datadir, tmpdir, binlogs, configuração e logs. O comando falha
se restar processo, listener ou diretório. Se a sessão for interrompida antes do `finally`,
execute a limpeza usando o mesmo `$fixtureRoot`:

```powershell
& .\test\support\windows-mysql-fixture.ps1 -Action Cleanup -FixtureRoot $fixtureRoot -MysqlRoot $mysqlRoot
if ($LASTEXITCODE -ne 0) { throw 'Cleanup da fixture falhou; não apagar manualmente estado desconhecido' }
```

A única evidência esperada é a linha `evidence=R2-02-precond`, com commit, sistema, versão,
porta, bind, caminhos classificados como `fixture`, readiness, schema, privilégios e contagem
de entidades. Não redirecione credenciais nem publique conteúdo bruto dos logs.
## KeepAlive para npm start, API e Playwright

`Run` continua sendo a precondicao descartavel atual: valida o banco e encerra o MySQL no
`finally`. Para manter o MySQL autenticado em background durante `npm start`, a API e os testes
Playwright, use `KeepAlive` em um FixtureRoot novo:

```powershell
$ErrorActionPreference = 'Stop'
$fixtureRoot = Join-Path $env:TEMP ('sage-r2-02-mysql-' + [guid]::NewGuid().ToString('N'))
$mysqlRoot = 'C:\SAGE-WS\mysql-runtime\mysql-8.4.11-winx64'
$node = (Get-Command node.exe -ErrorAction Stop).Source
& .\test\support\windows-mysql-fixture.ps1 -Action KeepAlive -FixtureRoot $fixtureRoot `
  -MysqlRoot $mysqlRoot -ApiRepository (Get-Location).Path -NodeExecutable $node -Commit (git rev-parse HEAD)
if ($LASTEXITCODE -ne 0) { throw 'KeepAlive MySQL/schema falhou' }

$state = Get-Content (Join-Path $fixtureRoot 'fixture-state.json') -Raw | ConvertFrom-Json
$credentialLines = Get-Content -LiteralPath $state.credentialFile
$credentials = @{}
foreach ($line in $credentialLines) {
  if ($line -match '^(user|password)=(.*)$') { $credentials[$matches[1]] = $matches[2] }
}
$env:DB_HOST = '127.0.0.1'; $env:DB_PORT = "$($state.port)"; $env:DB_USER = $credentials.user
$env:DB_PASSWORD = $credentials.password; $env:DB_NAME = 'sage'
Write-Host "connection=$($env:DB_HOST):$($env:DB_PORT) database=$($env:DB_NAME) user=$($env:DB_USER)"
```

A fixture publica somente a conexao; a senha permanece em `maintenance-client.cnf` dentro do
`FixtureRoot` e nao aparece no estado nem na saida. Mantenha este PowerShell aberto para a API e
execute Playwright em um shell que carregue as mesmas variaveis sem imprimir `$env:DB_PASSWORD`.
Depois de parar API e Playwright, a limpeza explicita prova processo, listener e diretorios ausentes:

```powershell
& .\test\support\windows-mysql-fixture.ps1 -Action Cleanup -FixtureRoot $fixtureRoot
if ($LASTEXITCODE -ne 0) { throw 'Cleanup KeepAlive falhou; estado nao deve ser apagado manualmente' }
```
