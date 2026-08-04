const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'installer', 'windows');
const complete = fs.readFileSync(path.join(root, 'complete-install.ps1'), 'utf8');
const provision = fs.readFileSync(path.join(root, 'provision-services.ps1'), 'utf8');

describe('update e rollback Windows', () => {
  it('provisiona uma versão explícita somente se o release lado a lado existir', () => {
    expect(provision).toMatch(/param\([^)]*\[string\]\$Version/s);
    expect(provision).toContain("Join-Path $programRoot \"releases\\$activeVersion\\api\"");
    expect(provision).toContain("$xml.service.arguments =");
    expect(provision).toContain("$xml.Save($winswXml)");
  });

  it('migra e prova readiness antes de trocar current.json atomicamente', () => {
    expect(complete).toContain("'current.json'");
    expect(complete).toContain("'current.json.pending'");
    expect(complete.indexOf("scripts\\setup-database.js")).toBeLessThan(
      complete.indexOf('& $provision -Version $targetVersion -StartApi')
    );
    expect(complete.indexOf("Invoke-RestMethod 'http://127.0.0.1:3000/ready'")).toBeLessThan(
      complete.indexOf("Move-Item -LiteralPath $pendingMarker")
    );
  });

  it('em falha reativa o código anterior sem desfazer schema', () => {
    expect(complete).toMatch(/catch\s*\{/);
    expect(complete).toContain('& $provision -Version $previousVersion -StartApi');
    expect(complete).toContain('Rollback automático do código falhou');
    expect(complete).not.toMatch(/DROP\s+DATABASE|down migration|rollback.*schema/i);
  });
});
