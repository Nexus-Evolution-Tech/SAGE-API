const fs = require('fs');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', 'installer', 'windows', 'initialize-mysql.ps1');

describe('bootstrap privado do MySQL no Windows', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');

  it('faz primeiro boot sem rede e não recebe segredo ou caminho externo', () => {
    const parameters = source.slice(0, source.indexOf('Set-StrictMode'));
    expect(parameters).toBe('[CmdletBinding()]\nparam()\n\n');
    expect(source).toContain("'--initialize-insecure'");
    expect(source).toContain("'--skip-networking'");
    expect(source).toContain("'--shared-memory'");
    expect(source).toContain('"--init-file=$initSql"');
    expect(source.indexOf("'--skip-networking'")).toBeLessThan(source.indexOf("'--bind-address=127.0.0.1'"));
  });

  it('usa identidades TCP locais e grants mínimos comprovados', () => {
    expect(source).toContain("'sage_runtime'@'127.0.0.1'");
    expect(source).toContain("'sage_maintenance'@'127.0.0.1'");
    expect(source).toContain('GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE ON `sage`.*');
    expect(source).toContain('GRANT SHOW_ROUTINE ON *.*');
    expect(source).toContain('GRANT ALL PRIVILEGES ON `sage\\_verif\\_%`.*');
    expect(source).not.toMatch(/'sage_(?:runtime|maintenance)'@'%'|GRANT ALL PRIVILEGES ON \*\.\*/);
    const grants = source.split('\n').filter((line) => line.startsWith('GRANT '));
    expect(grants.join('\n')).not.toMatch(/\bGRANT OPTION\b/);
  });

  it('nunca passa senha em argv, ambiente, stdout ou erro', () => {
    expect(source).not.toMatch(/MYSQL_PWD|--password|-p\$|\.Arguments.*(?:PASSWORD|SECRET|TOKEN)/i);
    expect(source).toContain('$process.StandardInput.Write($InputSql)');
    expect(source).toContain('[void]$process.StandardError.ReadToEnd()');
    expect(source).not.toMatch(/Write-(?:Host|Output).*(?:rootSecret|DB_PASSWORD|\.StandardError)/i);
  });

  it('preserva recuperação até promover marcador e valida o segundo boot', () => {
    expect(source).toContain("'mysql-bootstrap-client.cnf'");
    expect(source).toContain("'mysql-accounts.ready'");
    expect(source).toContain('Write-PrivateTextOnce $marker');
    expect(source.indexOf('Assert-Accounts\n  Stop-Root')).toBeLessThan(source.indexOf('Write-PrivateTextOnce $marker'));
    expect(source.indexOf('Write-PrivateTextOnce $marker')).toBeLessThan(source.indexOf('[IO.File]::Delete($rootClient)'));
    expect(source).toContain("catch [Threading.AbandonedMutexException]");
    expect(source).toContain('Data directory sem marcador nem recuperação');
  });

  it('mantém compatibilidade com Windows PowerShell 5.1', () => {
    expect(source).toContain('[Diagnostics.ProcessStartInfo]::new()');
    expect(source).not.toMatch(/\.ArgumentList|\?\?|ForEach-Object\s+-Parallel|ConvertFrom-Json\s+-AsHashtable/);
    expect(source).not.toContain('RandomNumberGenerator]::Fill');
  });
});
