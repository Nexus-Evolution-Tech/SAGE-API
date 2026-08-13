const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'installer', 'windows');
const iss = fs.readFileSync(path.join(root, 'SAGE.iss'), 'utf8');
const install = fs.readFileSync(path.join(root, 'complete-install.ps1'), 'utf8');
const build = fs.readFileSync(path.join(root, 'build-installer.ps1'), 'utf8');
const prepare = fs.readFileSync(path.join(root, 'prepare-install.ps1'), 'utf8');

describe('instalador Inno interno do SAGE', () => {
  it('instala apenas em Windows x64 administrativo e nunca publica', () => {
    expect(iss).toContain('PrivilegesRequired=admin');
    expect(iss).toContain('ArchitecturesAllowed=x64compatible');
    expect(iss).toContain('Uninstallable=yes');
    expect(iss).toContain('Compression=lzma2');
    expect(iss).not.toContain('ultra64');
    expect(iss).toContain('SAGE-Setup-{#AppVersion}-x64-internal');
    expect(iss).not.toMatch(/^\s*SignTool\s*=/mi);
    expect(iss).not.toMatch(/https?:\/\/(?!localhost(?::|\/))/i);
  });

  it('coleta credencial inicial sem colocá-la em argv ou log', () => {
    expect(iss).not.toContain('CreateInputQueryPage');
    expect(iss).not.toMatch(/Senha inicial|initial-admin\.pending|CredentialPage/i);
    expect(install).not.toMatch(/CredentialFile|SAGE_INITIAL_ADMIN_(?:LOGIN|PASSWORD)/i);
    expect(install).toContain("SAGE_ALLOW_FIRST_RUN_ONBOARDING = 'true'");
  });

  it('aplica schema antes de iniciar API e exige readiness', () => {
    expect(iss).toContain('function PrepareToInstall');
    expect(iss).toContain('prepare-install.ps1');
    expect(iss).toContain('procedure DeinitializeSetup');
    expect(prepare).toContain("@('SAGEAPI', 'SAGEMySQL')");
    expect(prepare).toContain('Stop-Service -Name $name');
    expect(install).toContain("Join-Path $serviceRoot 'provision-services.ps1'");
    expect(install).toContain('scripts\\setup-database.js');
    expect(install.indexOf('scripts\\setup-database.js')).toBeLessThan(
      install.indexOf('& $provision -Version $targetVersion -StartApi')
    );
    expect(install).toContain("Invoke-RestMethod 'http://127.0.0.1:3000/ready'");
  });

  it('verifica backup restaurável antes de migration em upgrade', () => {
    expect(install).toContain('if ($previousVersion)');
    expect(install).toContain('gerarBackup');
    expect(install).toContain('verificarBackup');
    expect(install).toContain('SAGE_MAINTENANCE_CONFIG_FILE');
    expect(install).toContain('MYSQL_DEFAULTS_EXTRA_FILE');
    expect(install.indexOf('verificarBackup')).toBeLessThan(
      install.indexOf('scripts\\setup-database.js')
    );
  });

  it('preserva ProgramData e falha alto se o uninstall seguro falhar', () => {
    expect(iss).toContain('uninstall-services.ps1');
    expect(iss).toContain('RaiseException');
    expect(iss).not.toMatch(/DestDir:\s*"\{commonappdata\}/i);
    expect(iss).not.toMatch(/uninsdelete|deltree/i);
    expect(build).toContain('ISCC.exe');
    expect(build).toContain("[Environment]::GetFolderPath('LocalApplicationData')");
    expect(build).toContain('/DInternalBuild=1');
  });
});
