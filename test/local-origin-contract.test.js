const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');

describe('origem local do painel instalado', () => {
  it('aceita as origens usadas pelo atalho e pelo loopback do SAGE', () => {
    expect(app).toContain("'http://localhost:3000'");
    expect(app).toContain("'http://127.0.0.1:3000'");
    expect(app).toContain('localSageOrigins.has(origin)');
  });
});
