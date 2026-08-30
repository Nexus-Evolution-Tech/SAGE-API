const fs = require('fs');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', 'installer', 'windows', 'initialize-state.ps1');

describe('contrato do estado privado no Windows', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');

  it('usa caminhos fixos locais, elevação e recusa reparse points', () => {
    expect(source).toContain("GetFolderPath('CommonApplicationData')");
    expect(source).toContain("GetFolderPath('ProgramFiles')");
    expect(source).toContain('WindowsBuiltInRole]::Administrator');
    expect(source).toContain('FileAttributes]::ReparsePoint');
    expect(source).toContain("$dataRoot -notmatch '^[A-Za-z]:\\\\'");
    expect(source).toContain("$dataRoot.StartsWith('\\\\')");
    expect(source).not.toMatch(/param\([\s\S]*(?:DataRoot|ProgramRoot)/);
  });

  it('gera segredos por CSPRNG e nunca os imprime nem os recebe como argumento', () => {
    const topLevelParameters = source.slice(0, source.indexOf('Set-StrictMode'));
    expect(source).toContain('RandomNumberGenerator]::Create()');
    expect(source).toContain('$rng.GetBytes($buffer)');
    expect(source).toContain('$rng.Dispose()');
    expect(source).not.toContain('RandomNumberGenerator]::Fill');
    expect(source).not.toMatch(/Get-Random|New-Guid/);
    expect(source).not.toMatch(/Write-(?:Host|Output).*(?:PASSWORD|SECRET|TOKEN|\.Value)/i);
    expect(topLevelParameters).not.toMatch(/Password|Secret|Token/i);
  });

  it('escreve atomicamente sem sobrescrever e restringe ACL a SIDs estáveis', () => {
    expect(source).toContain('[IO.FileMode]::CreateNew');
    expect(source).toContain('$stream.Flush($true)');
    expect(source).toContain('[IO.File]::Move($partial, $Path)');
    expect(source).not.toMatch(/Move-Item\s+-Force|Set-Content|Out-File/);
    expect(source).toContain("SecurityIdentifier]::new('S-1-5-18')");
    expect(source).toContain("SecurityIdentifier]::new('S-1-5-32-544')");
    expect(source).toContain('SetAccessRuleProtection($true, $false)');
    expect(source).toContain('Assert-PrivateAcl $Path');
    expect(source).toContain("'^[A-Za-z0-9_-]{32,}$'");
    expect(source).toContain('$found[$key] -ceq $policy');
    expect(source).toContain('catch [Threading.AbandonedMutexException]');
    expect(source).toContain("@('SAGEAPI', 'SAGEMySQL')");
    expect(source).toContain('ChangePermissions');
    expect(source).toContain('TakeOwnership');
  });

  it('separa runtime e manutenção sem criar credencial administrativa órfã', () => {
    expect(source).toContain("'sage.env'");
    expect(source).toContain("'maintenance.env'");
    expect(source).toContain("'maintenance-client.cnf'");
    expect(source).toContain('SAGE_DEVICE_CREDENTIAL_KEY');
    expect(source).toContain("'shutdown-client.cnf'");
    expect(source).toContain("'user=sage_maintenance'");
    expect(source).toContain("'user=sage_shutdown'");
    expect(source).toContain('Write-PrivateTextOnce');
    expect(source).not.toMatch(/initial-admin|SAGE_INITIAL_ADMIN|bootstrap\.completed/);
    expect(source).not.toMatch(/^[ \t]*(?:DB_PASSWORD|JWT_SECRET|MONITOR_CALLBACK_TOKEN)\s*=\s*['"][^'"]+/m);
    expect(source).not.toMatch(/etec123|SAGE_INITIAL_ADMIN_PASSWORD='[^']+'/);
  });

  it('gera configuração MySQL local e diretórios privados dos serviços', () => {
    expect(source).toContain("'mysql\\tmp'");
    expect(source).toContain("'logs\\api'");
    expect(source).toContain("'logs\\mysql'");
    expect(source).toContain("'bind-address=127.0.0.1'");
    expect(source).toContain("'mysqlx=0'");
    expect(source).toContain("'innodb-flush-log-at-trx-commit=1'");
    expect(source).toContain("'mysql.ini'");
  });
});
