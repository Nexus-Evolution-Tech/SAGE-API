const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const documentation = fs.readFileSync(path.join(root, 'docs', 'CONTROLID_ENDPOINTS.md'), 'utf8');
const implementationFiles = [
  path.join(root, 'src', 'services', 'deviceService.js'),
  path.join(root, 'src', 'services', 'networkDiscoveryService.js'),
  path.join(root, 'src', 'utils', 'controlId-utils.js')
];

describe('inventário documental da Access API Control iD', () => {
  it('documenta cada endpoint .fcgi usado pela integração', () => {
    const endpoints = new Set();
    for (const file of implementationFiles) {
      const source = fs.readFileSync(file, 'utf8');
      for (const match of source.matchAll(/\/([a-z_]+\.fcgi)/g)) endpoints.add(`/${match[1]}`);
    }

    expect(endpoints.size).toBe(10);
    for (const endpoint of endpoints) expect(documentation).toContain(endpoint);
  });

  it('não registra infraestrutura real ou material de autenticação', () => {
    expect(documentation).not.toMatch(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
    expect(documentation).not.toMatch(/(?:password|token|session)=\s*[^<>{}`\s]+/i);
  });
});
