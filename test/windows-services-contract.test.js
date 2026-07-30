const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'installer', 'windows');
const script = fs.readFileSync(path.join(root, 'provision-services.ps1'), 'utf8');
const xml = fs.readFileSync(path.join(root, 'SAGE-API.xml.template'), 'utf8');
describe('serviços Windows privados do SAGE', () => {
  it('separa IDs SCM compatíveis e encadeia API depois do MySQL', () => {
    expect(xml).toContain('<id>SAGEAPI</id>');
    expect(xml).toContain('<name>SAGE API</name>');
    expect(xml).toContain('<depend>SAGEMySQL</depend>');
    expect(xml).toContain('<startmode>Manual</startmode>');
    expect(script).toContain("'SAGEMySQL', 'start=', 'auto'");
    expect(script).toContain("'SAGEAPI', 'start=', 'delayed-auto'");
    expect(script).toContain("RequiredServices.Name -notcontains 'SAGEMySQL'");
  });
  it('usa LocalService com SID por serviço e ACL sem tomada de posse', () => {
    expect(xml).toContain('<user>LocalService</user>');
    expect(script.match(/'sidtype', \$name, 'unrestricted'/)).toBeTruthy();
    expect(script).toContain("Resolve-ServiceSid 'SAGEMySQL'");
    expect(script).toContain("Resolve-ServiceSid 'SAGEAPI'");
    expect(script).toContain('Grant-ServiceAccess $configRoot $apiSid');
    expect(script).not.toContain("@('config', 'logs\\api'");
    expect(script).not.toMatch(/LocalSystem|FullControl/);
    expect(script).toContain('ChangePermissions');
    expect(script).toContain('TakeOwnership');
  });
  it('registra MySQL local, valida serviços preexistentes e não expõe segredo em argv', () => {
    expect(script).toContain("'--install-manual', 'SAGEMySQL'");
    expect(script).toContain("'--local-service'");
    expect(script).toContain("Assert-ServiceRecord 'SAGEMySQL' $mysqlPathNames");
    expect(script).toContain("Assert-ServiceRecord 'SAGEAPI' @(");
    expect(script).toContain('$AllowedPathNames -notcontains $record.PathName.Trim()');
    expect(script).toContain("$release.target -cne 'win32-x64'");
    expect(script).toContain('$xml.service.arguments -cne $expectedArguments');
    expect(script).toContain('"--defaults-extra-file=$maintenanceClient"');
    expect(script).not.toMatch(/--password|MYSQL_PWD|DB_PASSWORD|JWT_SECRET|CALLBACK_TOKEN/);
  });
  it('aplica backoff, rotação limitada e readiness real', () => {
    expect(xml).toContain('<onfailure action="restart" delay="5 sec"/>');
    expect(xml).toContain('<onfailure action="restart" delay="120 sec"/>');
    expect(xml).toContain('<log mode="roll-by-size">');
    expect(xml).toContain('<sizeThreshold>10240</sizeThreshold>');
    expect(xml).toContain('<keepFiles>8</keepFiles>');
    expect(script).toContain("Invoke-WebRequest 'http://127.0.0.1:3000/ready'");
    expect(script).toContain("$body.version -ceq $release.version");
    expect(script).toContain('Restart-Service SAGEAPI -Force');
    expect(script).toContain("throw 'SAGEAPI não atingiu readiness'");
  });
  it('recupera marker parcial e comprova isolamento da DACL', () => {
    expect(script.indexOf("Test-Path -LiteralPath $marker")).toBeLessThan(
      script.indexOf("'initialize-mysql.ps1'")
    );
    expect(script).toContain('Assert-ServiceAccess $dataDirectory $mysqlSid');
    expect(script).toContain('Assert-ServiceAbsent $dataDirectory $apiSid');
    expect(script).toContain("Assert-ServiceAbsent (Join-Path $configRoot 'sage.env') $mysqlSid");
    expect(script).not.toContain('shutdown-client.cnf');
  });
  it('serializa mudanças no SCM e usa o controlador absoluto do Windows', () => {
    expect(script).toContain("'Global\\SAGE-Service-Lifecycle'");
    expect(script).toContain('WaitOne([TimeSpan]::FromSeconds(60))');
    expect(script).toContain("[Environment]::SystemDirectory) 'sc.exe'");
    expect(script).not.toContain("Invoke-NativeChecked 'sc.exe'");
  });
});
