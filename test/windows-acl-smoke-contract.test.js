const fs = require('fs');
const path = require('path');

const WORKFLOW = path.join(__dirname, '..', '.github', 'workflows', 'windows-native.yml');

describe('smoke Windows do estado ACL', () => {
  const source = fs.readFileSync(WORKFLOW, 'utf8');

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
    expect(mysqlCleanup).toContain('Remove-Item -LiteralPath $stateOwnership -Force -ErrorAction Stop');
    expect(services.indexOf("if (Test-Path -LiteralPath $state) {")).toBeLessThan(
      services.indexOf('& $provision')
    );
    expect(services).toContain('[IO.FileMode]::CreateNew');
    expect(services).toContain('Processo MySQL descartável não encerrou');
  });

  it('produz evidência da ACL protegida nos caminhos críticos', () => {
    const services = source.slice(source.indexOf('Provar serviços privados e recuperação'));
    expect(services).toContain('Assert-SmokePrivateAcl');
    expect(services).toContain('$acl.AreAccessRulesProtected');
    expect(services).toContain('$rule.IsInherited');
    expect(services).toContain('$allowedSidValues -notcontains $sid');
    expect(services).toContain('AccessControlType]::Allow');
    expect(services).toContain('FullControl');
    expect(services).toContain('ChangePermissions');
    expect(services).toContain('TakeOwnership');
    expect(services).toContain("'config/sage.env'");
    expect(services).toContain("'config/mysql.ini'");
    expect(services).toContain('Evidência ACL privada confirmada');
  });
});
