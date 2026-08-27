const fs = require('fs');
const path = require('path');

const PROVISIONER = path.join(__dirname, '..', 'installer', 'windows', 'provision-services.ps1');
const WORKFLOW = path.join(__dirname, '..', '.github', 'workflows', 'windows-native.yml');

describe('smoke Windows do estado ACL', () => {
  const provisioner = fs.readFileSync(PROVISIONER, 'utf8');
  const workflow = fs.readFileSync(WORKFLOW, 'utf8');

  function section(startMarker, endMarker) {
    const start = workflow.indexOf(startMarker);
    const end = endMarker ? workflow.indexOf(endMarker, start) : workflow.length;
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    return workflow.slice(start, end);
  }

  it('protege o estado antes dos installs e valida novamente apos registrar os servicos', () => {
    const initCalls = [...provisioner.matchAll(/initialize-state\.ps1/g)].map((match) => match.index);
    const mysqlInstalls = [...provisioner.matchAll(/Invoke-NativeChecked \$mysqlWinsw @\('install'\)/g)]
      .map((match) => match.index);
    const apiInstalls = [...provisioner.matchAll(/Invoke-NativeChecked \$winsw @\('install'\)/g)]
      .map((match) => match.index);

    expect(initCalls).toHaveLength(2);
    expect(mysqlInstalls.length).toBeGreaterThanOrEqual(1);
    expect(apiInstalls.length).toBeGreaterThanOrEqual(1);
    expect(initCalls[0]).toBeLessThan(mysqlInstalls[0]);
    expect(initCalls[0]).toBeLessThan(apiInstalls[0]);
    expect(initCalls[1]).toBeGreaterThan(mysqlInstalls[0]);
    expect(initCalls[1]).toBeGreaterThan(apiInstalls[0]);

    const postRegistration = provisioner.slice(initCalls[1]);
    expect(postRegistration).toContain('foreach ($directory in @($dataRoot, $configRoot))');
    expect(postRegistration).toContain('Resolve-ServiceSid');
    expect(postRegistration).toContain('Assert-ServiceAccess');
    expect(postRegistration).toContain('Assert-ServiceAbsent');
    expect(provisioner).toContain('Get-Acl');
    expect(provisioner).toContain('ChangePermissions');
    expect(provisioner).toContain('TakeOwnership');
  });

  it('usa posse exclusiva para limpar o estado descartavel', () => {
    const bootstrap = section('Provar bootstrap privado do MySQL', 'Descartar estado do smoke MySQL');
    const mysqlCleanup = section(
      'Descartar estado do smoke MySQL',
      'Provar servi\u00e7os privados e recupera\u00e7\u00e3o'
    );
    const services = section(
      'Provar servi\u00e7os privados e recupera\u00e7\u00e3o',
      'Descartar servi\u00e7os do smoke'
    );
    const serviceCleanup = section('Descartar servi\u00e7os do smoke');

    expect(bootstrap).toContain('$env:RUNNER_TEMP');
    expect(bootstrap).toContain('$env:GITHUB_RUN_ID');
    expect(bootstrap).toContain('$env:GITHUB_RUN_ATTEMPT');
    expect(bootstrap).toContain('$stateOwnership');
    expect(bootstrap).toContain('[IO.FileMode]::CreateNew');
    expect(bootstrap.indexOf('[IO.FileMode]::CreateNew')).toBeLessThan(
      bootstrap.indexOf('initialize-mysql.ps1')
    );

    expect(mysqlCleanup).toContain('$stateOwnership');
    expect(mysqlCleanup).toContain('Remove-Item -LiteralPath $state -Recurse -Force -ErrorAction Stop');
    expect(mysqlCleanup).toContain('Remove-Item -LiteralPath $stateOwnership -Force -ErrorAction Stop');
    expect(mysqlCleanup).toContain('elseif (Test-Path -LiteralPath $state)');

    expect(services).toContain('$stateOwnership');
    expect(services).toContain('if (Test-Path -LiteralPath $state)');
    expect(services).toContain('Assert-SmokePrivateAcl');
    expect(services).toContain('$acl.AreAccessRulesProtected');
    expect(services).toContain('$rule.IsInherited');
    expect(services).toContain('ChangePermissions');
    expect(services).toContain('TakeOwnership');
    expect(services).toContain("'config/sage.env'");
    expect(services).toContain("'config/mysql.ini'");
    expect(services.indexOf('Assert-SmokePrivateAcl')).toBeGreaterThan(services.indexOf('& $provision'));

    expect(serviceCleanup).toContain("$ErrorActionPreference = 'Stop'");
    expect(serviceCleanup).toContain('$stateOwnership');
    expect(serviceCleanup).toContain('Remove-Item -LiteralPath $state -Recurse -Force -ErrorAction Stop');
    expect(serviceCleanup).toContain('Remove-Item -LiteralPath $stateOwnership -Force -ErrorAction Stop');
    expect(serviceCleanup).toContain('elseif (Test-Path -LiteralPath $state)');
  });

  it('mantem a fixture MySQL temporaria do pacote integrado', () => {
    expect(workflow).toContain('$env:RUNNER_TEMP');
    expect(workflow).toContain('log-bin=$binlog');
    expect(workflow).toContain('log-bin-trust-function-creators=1');
    expect(workflow).toContain('SHOW GRANTS;');
    expect(workflow).toContain('SAGE-MySQL-Smoke');
    expect(workflow).toContain('service\\uninstall-services.ps1');
    expect(workflow).toContain('sage-smoke-bin.*');
  });
});
