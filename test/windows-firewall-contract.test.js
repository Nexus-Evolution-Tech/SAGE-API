const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'installer', 'windows');
const firewall = fs.readFileSync(path.join(root, 'configure-firewall.ps1'), 'utf8');
const provision = fs.readFileSync(path.join(root, 'provision-services.ps1'), 'utf8');

describe('firewall Windows mínimo do SAGE', () => {
  it('libera somente a API na sub-rede dos perfis privados', () => {
    expect(firewall).toContain("$ruleName = 'SAGE-API-LAN'");
    expect(firewall).toContain('-Profile Domain,Private');
    expect(firewall).toContain('-RemoteAddress LocalSubnet');
    expect(firewall).toContain('-Protocol TCP -LocalPort 3000');
    expect(firewall).toContain('-EdgeTraversalPolicy Block');
    expect(firewall).toContain("$Rule.OverrideBlockRules.ToString() -cne 'False'");
    expect(firewall).toContain('Get-NetFirewallProfile -PolicyStore ActiveStore -Name Domain,Private,Public');
    expect(firewall).toContain("$_.DefaultInboundAction.ToString() -cne 'Block'");
    expect(firewall).not.toMatch(/3307|33060|Profile (?:Any|Public)/);
  });

  it('amarra a regra ao Node empacotado e recusa reparse point', () => {
    expect(firewall).toContain("'runtime\\node\\node.exe'");
    expect(firewall).toContain('[IO.FileAttributes]::ReparsePoint');
    expect(firewall).toContain('$application.Program -cne $node');
    expect(firewall).not.toMatch(/process\.env|password|secret|token/i);
  });

  it('é idempotente e falha alto diante de regra preexistente divergente', () => {
    expect(firewall).toContain('-PolicyStore PersistentStore');
    expect(firewall).toContain('-PolicyStore ActiveStore');
    expect(firewall).toContain('-TracePolicyStore');
    expect(firewall).toContain("$activeRules[0].PolicyStoreSourceType.ToString() -cne 'Local'");
    expect(firewall).toContain("'Global\\SAGE-Firewall-Configuration'");
    expect(firewall).toContain('$mutex.WaitOne([TimeSpan]::FromSeconds(30))');
    expect(firewall).toContain('if ($rules.Count -eq 0)');
    expect(firewall).toContain("Assert-SageFirewallRule $rules[0] 'persistente'");
    expect(firewall).toContain("Assert-SageFirewallRule $activeRules[0] 'efetiva'");
    expect(provision).toContain("'configure-firewall.ps1'");
    expect(provision).toContain("throw 'Firewall privado do SAGE falhou'");
    expect(provision.indexOf("'configure-firewall.ps1'")).toBeGreaterThan(
      provision.indexOf('if ($StartApi)')
    );
  });
});
