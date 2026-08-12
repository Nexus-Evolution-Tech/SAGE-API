const fs = require('fs');
const os = require('os');
const path = require('path');
const { verificarDiretorio } = require('../scripts/check-source-observability');
const dirs = [];
function fixture(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sage-observability-'));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'fixture.js'), source);
  return verificarDiretorio(dir);
}
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
describe('check-source-observability', () => {
  it('ignora comentários, strings e texto de template', () => {
    expect(fixture('// console.log()\nconst x = "catch {}"; const r=/console\\.log|catch \\{\\}/; function f(){ return /console\\.log|catch \\{\\}/; } const y = `console.error()`;')).toEqual([]);
  });
  it('detecta console dentro de interpolação de template', () => {
    expect(fixture('const x = `${console.log("x")}`;')).toHaveLength(1);
  });
  it('detecta catches semanticamente vazios', () => {
    expect(fixture('try {} catch (e) { /* ignorar */ }\ncatch (e) { ; }\nPromise.resolve().catch(() => {});\nPromise.resolve().catch(async () => {});')).toHaveLength(4);
  });
});
