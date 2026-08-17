const fs = require('fs');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', 'installer', 'windows', 'build-release.ps1');

describe('contrato do builder nativo Windows', () => {
  it('constrói de commits descartáveis e prova dependências nativas antes do layout', () => {
    const script = fs.readFileSync(SCRIPT, 'utf8');
    expect(script).toContain("[Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne 'X64'");
    expect(script).toContain('major:parseInt(process.versions.node,10)');
    expect(script).not.toMatch(/runtimeExpression\s*=.*split\(["']/);
    expect(script.match(/git\.exe' @\('archive'/g)).toHaveLength(2);
    expect(script).toContain('git.exe rev-parse HEAD');
    expect(script).toContain('"--output=$apiZip", $apiCommit');
    expect(script).toContain('"--output=$webZip", $webCommit');
    expect(script).not.toMatch(/--output=\$(?:api|web)Zip", 'HEAD'/);
    expect(script).toContain("@('ci', '--ignore-scripts', '--omit=dev')");
    expect(script).toContain("require('bcrypt').hash('probe',4)");
    expect(script).toContain("@('run', 'build')");
    expect(script).toContain("scripts/fetch-windows-artifacts.js");
    expect(script).toContain("scripts/verify-windows-artifacts.js");
    expect(script).toContain("scripts/assemble-windows-layout.js");
    expect(script).not.toMatch(/npm(?:\.cmd)?\s+install|audit\s+fix/i);
  });

  it('recusa configuração externa do CRA para manter same-origin', () => {
    const script = fs.readFileSync(SCRIPT, 'utf8');
    expect(script).toContain("Where-Object Name -Like 'REACT_APP_*'");
    expect(script).toContain("@('REACT_APP_API_URL', 'REACT_APP_SOCKET_URL', 'REACT_APP_SOCKET_PATH')");
    expect(script).toContain('Remove-Item -LiteralPath $_.FullName -Force');
    expect(script).not.toMatch(/DB_PASSWORD|JWT_SECRET|MONITOR_CALLBACK_TOKEN/);
  });
});
