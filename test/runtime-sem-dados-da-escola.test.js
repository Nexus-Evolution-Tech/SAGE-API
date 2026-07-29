const fs = require('fs').promises;
const path = require('path');

const SOURCE = path.join(__dirname, '..', 'src');
const FORBIDDEN = /etec123|ETEC Taboão|Taboão da Serra|Praça Miguel Ortega|192\.168\.0\.12[67]|62823257029344/i;

async function sourceFiles(dir = SOURCE) {
  const files = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(absolute));
    else if (entry.isFile() && /\.(?:js|ya?ml)$/i.test(entry.name)) files.push(absolute);
  }
  return files;
}

describe('runtime distribuível sem dados conhecidos da escola', () => {
  it('não contém credencial, endereço ou IP conhecido nos arquivos empacotáveis', async () => {
    const matches = [];
    for (const file of await sourceFiles()) {
      const content = await fs.readFile(file, 'utf8');
      if (FORBIDDEN.test(content)) matches.push(path.relative(SOURCE, file));
    }
    expect(matches).toEqual([]);
    await expect(fs.stat(path.join(SOURCE, 'config', 'config.js')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });
});
