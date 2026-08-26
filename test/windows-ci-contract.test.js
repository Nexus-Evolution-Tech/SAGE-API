const fs = require('fs');
const path = require('path');

const WORKFLOW = path.join(__dirname, '..', '.github', 'workflows', 'windows-native.yml');
const BUILDER = path.join(__dirname, '..', 'installer', 'windows', 'build-release.ps1');

describe('CI do layout Windows nativo', () => {
  const source = fs.readFileSync(WORKFLOW, 'utf8');
  const builder = fs.readFileSync(BUILDER, 'utf8');

  it('usa Windows x64, PowerShell 5.1 e frontend em commit exato', () => {
    expect(source).toContain('runs-on: windows-2025');
    expect(source.match(/shell: powershell/g).length).toBeGreaterThanOrEqual(4);
    expect(source).toContain("$PSVersionTable.PSEdition -ne 'Desktop'");
    expect(source).toContain('e8c5131e1d155e2bcf8d7c58ffefb4e81677407f');
    expect(source).toContain('repository: Nexus-Evolution-Tech/SAGE');
  });

  it('pina actions, restringe permissão e revalida cache antes do uso', () => {
    expect(source).toMatch(/permissions:\r?\n  contents: read/);
    const actions = [...source.matchAll(/uses: actions\/[a-z-]+@([^\s]+)/g)].map((match) => match[1]);
    expect(actions.length).toBeGreaterThanOrEqual(4);
    expect(actions.every((ref) => /^[a-f0-9]{40}$/.test(ref))).toBe(true);
    expect(source).toContain('windows-x64-artifacts-${{ hashFiles(');
    expect(builder).toContain('scripts/verify-windows-artifacts.js');
    expect(source).not.toContain('restore-keys:');
  });

  it('executa runtimes do layout e nunca publica o protótipo', () => {
    expect(source).toContain("runtime\\mysql\\bin\\mysqld.exe') --version");
    expect(source).toContain("'SAGESmoke.exe'");
    expect(source).toContain('& $winswExe version');
    expect(source).toContain("require('bcrypt').hash('windows-smoke',4)");
    expect(source).not.toMatch(/upload-artifact|gh release|softprops\/action-gh-release/i);
    expect(source).toContain('Descartar protótipo');
  });

  it('prova bootstrap e segundo boot MySQL sem persistir root no runner', () => {
    expect(source).toContain('Provar bootstrap privado do MySQL');
    expect(source).toContain("service\\initialize-mysql.ps1");
    expect(source).toContain('--install-manual SAGE-MySQL-Smoke');
    expect(source).toContain('Segundo bootstrap MySQL não foi idempotente');
    expect(source).toContain('scripts/setup-database.js');
    expect(source).toContain("$env:MYSQLDUMP_PATH = Join-Path $mysqlRoot 'bin\\mysqldump.exe'");
    expect(source).toContain("$env:MYSQL_PATH = Join-Path $mysqlRoot 'bin\\mysql.exe'");
    expect(source).toContain('b.verificarBackup(x.caminho)');
    expect(source).toContain('Backup/restauração com grants restritos falhou');
    expect(source).toContain('Provar serviços privados e recuperação');
    expect(source).toContain('& $provision -StartApi');
    expect(source).toContain("LocalPort 33060");
    expect(source).toContain('Get-NetFirewallRule -PolicyStore ActiveStore -Name SAGE-API-LAN');
    expect(source).toContain('-TracePolicyStore');
    expect(source).toContain("$firewall[0].PolicyStoreSourceType.ToString() -ne 'Local'");
    expect(source).toContain('Política efetiva do Windows Firewall não está fail-closed');
    expect(source).toContain("$firewallAddress.RemoteAddress -ne 'LocalSubnet'");
    expect(source).toContain("Stop-Process -Id $nodeBefore.ProcessId -Force");
    expect(source).toContain('Stop-Process -Id $mysqlListenerBefore[0].OwningProcess -Force');
    expect(source).toContain('$mysqlListenerAfter[0].OwningProcess -ne $mysqlListenerBefore[0].OwningProcess');
    expect(source).toContain('Segredo apareceu em processo, XML ou log');
    expect(source).toContain("service\\uninstall-services.ps1");
    expect(source).toContain('Desinstalação alterou dados persistentes');
    expect(source).toContain('Desinstalação preservou firewall SAGE');
    expect(source).toContain('Não foi possível simular serviço marcado para exclusão');
    expect(source).toContain('Segunda desinstalação sem binários não foi idempotente');
    expect(source).toContain("-NewName 'SAGE-API.exe.removed'");
    expect(source).toContain("-NewName 'mysqld.exe.removed'");
    expect(source).toContain('Desinstalação não preservou regra de firewall divergente');
    expect(source).toContain('Descartar serviços do smoke');
    expect(source).toContain("service\\SAGE-MySQL.exe'");
    expect(source).toContain('& $mysqlWinsw uninstall');
    expect(source.match(/for \(\$attempt = 0; \$attempt -lt 20/g)).toHaveLength(6);
    expect(source).toContain('Processo residual do SAGE não encerrou');
    expect(source).toContain('Remove-Item -LiteralPath $program -Recurse -Force -ErrorAction Stop');
    expect(source).toContain('Descartar estado do smoke MySQL');
    expect(source).toContain("'mysql-bootstrap-client.cnf'");
    expect(source).toContain('credencial root após sucesso');
  });

  it('prova posse e ausência do estado antes de descartar ou provisionar', () => {
    const mysqlCleanup = source.slice(
      source.indexOf('Descartar estado do smoke MySQL'),
      source.indexOf('Provar serviços privados e recuperação')
    );
    const services = source.slice(source.indexOf('Provar serviços privados e recuperação'));
    expect(mysqlCleanup).toContain('sage-state-owned-');
    expect(mysqlCleanup).toContain('$env:GITHUB_RUN_ATTEMPT');
    expect(mysqlCleanup).toContain('Estado do smoke permaneceu após a limpeza');
    expect(mysqlCleanup).toContain('Estado SAGE preexistente não pertence ao smoke; preservado');
    expect(mysqlCleanup).toContain('Remove-Item -LiteralPath $state -Recurse -Force -ErrorAction Stop');
    expect(services.indexOf("if (Test-Path -LiteralPath $state) {")).toBeLessThan(
      services.indexOf('& $provision')
    );
    expect(services).toContain("[IO.FileMode]::CreateNew");
  });

  it('produz evidência da ACL protegida nos caminhos críticos', () => {
    const services = source.slice(source.indexOf('Provar serviços privados e recuperação'));
    expect(services).toContain('Assert-SmokePrivateAcl');
    expect(services).toContain('$acl.AreAccessRulesProtected');
    expect(services).toContain('$rule.IsInherited');
    expect(services).toContain('ChangePermissions');
    expect(services).toContain('TakeOwnership');
    expect(services).toContain("'config/sage.env'");
    expect(services).toContain("'config/mysql.ini'");
    expect(services).toContain('Evidência ACL privada confirmada');
  });
});
