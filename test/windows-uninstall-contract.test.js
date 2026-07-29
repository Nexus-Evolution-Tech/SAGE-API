const fs = require('fs');
const path = require('path');

const script = fs.readFileSync(
  path.join(__dirname, '..', 'installer', 'windows', 'uninstall-services.ps1'), 'utf8'
);

describe('desinstalação segura dos serviços Windows', () => {
  it('valida identidade antes de qualquer mutação', () => {
    const validation = script.indexOf("Assert-ServiceRecord 'SAGEMySQL'");
    expect(validation).toBeGreaterThan(0);
    expect(validation).toBeLessThan(script.indexOf('Remove-NetFirewallRule'));
    expect(validation).toBeLessThan(script.indexOf("Disable-And-StopService 'SAGEAPI'"));
    expect(script).toContain('$AllowedPathNames -notcontains $record.PathName.Trim()');
    expect(script).toContain("$record.StartName -ne 'NT AUTHORITY\\LocalService'");
  });

  it('remove apenas a regra local exata da API', () => {
    expect(script).toContain('Get-NetFirewallRule -PolicyStore PersistentStore -Name $firewallName');
    expect(script).toContain("$Rule.Group -cne 'SAGE'");
    expect(script).toContain("$port.LocalPort.ToString() -cne '3000'");
    expect(script).toContain("$address.RemoteAddress -cne 'LocalSubnet'");
    expect(script).toContain('$application.Program -cne $node');
    expect(script).toContain("$Rule.Enabled.ToString() -cne 'True'");
    expect(script).toContain("$Rule.EdgeTraversalPolicy.ToString() -cne 'Block'");
    expect(script).toContain("$port.RemotePort.ToString() -cne 'Any'");
    expect(script).toContain('Get-NetFirewallSecurityFilter -AssociatedNetFirewallRule $Rule');
    expect(script).toContain("$security.OverrideBlockRules.ToString() -cne 'False'");
    expect(script).toContain('Regra de firewall não foi removida');
  });

  it('remove os dois serviços e nunca força o encerramento do MySQL', () => {
    expect(script).toContain("Remove-ServiceRecord 'SAGEAPI'");
    expect(script).toContain("Remove-ServiceRecord 'SAGEMySQL'");
    expect(script.indexOf("Disable-And-StopService 'SAGEMySQL'")).toBeLessThan(
      script.indexOf("Remove-ServiceRecord 'SAGEMySQL'")
    );
    expect(script).not.toContain("'failure', 'SAGEMySQL'");
    expect(script).toContain('& $sc delete $Name');
    expect(script).toContain('$exitCode -notin @(0, 1060, 1072)');
    expect(script).toContain("$exception.NativeErrorCode -eq 1072");
    expect(script).toContain('Test-ServiceMarkedForDeletion $_');
    expect(script).not.toContain("Invoke-NativeChecked $winsw @('uninstall')");
    expect(script).not.toContain("Invoke-NativeChecked $mysqld @('--remove', 'SAGEMySQL')");
    expect(script).toContain('$_.ExecutablePath.StartsWith(');
    expect(script).toContain('-not $process.ExecutablePath.Equals($mysqld');
    expect(script).toContain('MySQL não encerrou de forma segura; encerramento forçado recusado');
    expect(script).toContain('$attempt -lt 240');
    expect(script).toContain('Processo ou serviço SAGE permaneceu após a remoção');
  });

  it('serializa instalação e remoção sem depender do PATH', () => {
    expect(script).toContain("[Environment]::SystemDirectory) 'sc.exe'");
    expect(script).toContain("'Global\\SAGE-Service-Lifecycle'");
    expect(script).toContain('WaitOne([TimeSpan]::FromSeconds(60))');
    expect(script).toContain('$lifecycleMutex.ReleaseMutex()');
    expect(script).not.toContain('Invoke-NativeChecked');
  });

  it('não apaga ProgramData nem recebe segredos', () => {
    expect(script).not.toMatch(/Remove-Item|DelTree|DB_PASSWORD|JWT_SECRET|CALLBACK_TOKEN/);
    expect(script).not.toMatch(/ProgramData|backups|uploads|exports|mysql\\data/i);
    expect(script).toContain('dados escolares preservados');
  });
});
