const fs = require('fs').promises;
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { REQUIRED_FILES, SOURCE_FILES } = require('../scripts/assemble-api-payload');
const { assembleWindowsLayout } = require('../scripts/assemble-windows-layout');

const roots = [];
afterEach(async () => Promise.all(roots.splice(0)
  .map((root) => fs.rm(root, { recursive: true, force: true }))));

async function write(root, relative, content = relative) {
  const file = path.join(root, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sage-windows-layout-'));
  roots.push(root);
  const api = path.join(root, 'api-source');
  for (const file of [...REQUIRED_FILES, ...SOURCE_FILES]) await write(api, file);
  await write(api, 'package.json', JSON.stringify({ name: 'sage-api', version: '1.2.3' }));
  await write(api, 'package-lock.json', '{}');
  await write(api, 'database/migration_alpha.sql');
  await write(api, 'database/migrations/0001_alpha.sql', 'SELECT 1;');
  await write(api, 'installer/windows/initialize-state.ps1');
  await write(api, 'installer/windows/initialize-mysql.ps1');
  await write(api, 'installer/windows/configure-firewall.ps1');
  await write(api, 'installer/windows/provision-services.ps1');
  await write(api, 'installer/windows/SAGE-API.xml.template', [
    '<service>', '<id>SAGEAPI</id>', '<depend>SAGEMySQL</depend>',
    '<arguments>__SAGE_VERSION__</arguments>', '</service>'
  ].join('\n'));
  await write(api, 'node_modules/.package-lock.json', '{}');
  await write(api, 'node_modules/bcrypt/index.js');
  const web = path.join(root, 'web');
  for (const file of ['asset-manifest.json', 'favicon.ico', 'index.html', 'logo192.png',
    'logo512.png', 'manifest.json', 'robots.txt', 'static/js/app.js']) await write(web, file);
  const artifactCache = path.join(root, 'artifacts');
  const bytes = { node: 'node', mysql: 'mysql', winsw: 'winsw', inno: 'inno' };
  const specs = [
    ['node', 'runtime', true, '24.18.0', 'node-fake.zip'],
    ['mysql', 'runtime', true, '8.4.11', 'mysql-fake.zip'],
    ['winsw', 'runtime', true, '2.12.0', 'WinSW-fake.exe'],
    ['inno-setup', 'build', false, '6.7.3', 'inno-fake.exe']
  ];
  const artifacts = specs.map(([id, role, includeInPayload, version, fileName]) => {
    const content = bytes[id === 'inno-setup' ? 'inno' : id];
    return {
      id, role, includeInPayload, version, fileName,
      url: `https://example.invalid/${fileName}`,
      size: Buffer.byteLength(content),
      sha256: crypto.createHash('sha256').update(content).digest('hex'),
      digestSource: 'fixture',
      ...(id === 'mysql' ? { sageReleaseGate: 'signature-and-redistribution-review-required' } : {}),
      ...(id === 'inno-setup' ? { sageReleaseGate: 'commercial-license-record-required' } : {})
    };
  });
  for (const item of artifacts) {
    const content = bytes[item.id === 'inno-setup' ? 'inno' : item.id];
    await write(artifactCache, item.fileName, content);
  }
  const artifactManifestPath = path.join(root, 'artifacts.json');
  await write(root, 'artifacts.json', JSON.stringify({ schemaVersion: 1, target: 'win32-x64', artifacts }));
  const extractArchive = async (archive, destination) => {
    if (path.basename(archive) === 'node-fake.zip') {
      await write(destination, 'node-fake/node.exe');
      await write(destination, 'node-fake/node_modules/npm/.npmrc', 'upstream config');
    }
    if (path.basename(archive) === 'mysql-fake.zip') await write(destination, 'mysql-fake/bin/mysqld.exe');
  };
  return { root, apiSourceRoot: api, webBuildDir: web, artifactCache, artifactManifestPath,
    extractArchive, destination: path.join(root, 'output'),
    apiCommit: 'a'.repeat(40), webCommit: 'b'.repeat(40) };
}

describe('layout reproduzível da release Windows', () => {
  it('monta runtimes, serviço, API e web com inventário SHA-256', async () => {
    const input = await fixture();
    const release = await assembleWindowsLayout(input);

    expect(release).toMatchObject({
      schemaVersion: 1,
      product: 'SAGE',
      version: '1.2.3',
      target: 'win32-x64',
      source: { apiCommit: 'a'.repeat(40), webCommit: 'b'.repeat(40) },
      distribution: {
        status: 'prototype-only',
        public: false,
        gates: expect.arrayContaining([
          'mysql:signature-and-redistribution-review-required',
          'inno-setup:commercial-license-record-required'
        ])
      },
      inventoryScope: 'payload-files-excluding-release.json',
      components: {
        node: { version: '24.18.0', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
        mysql: { version: '8.4.11', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
        winsw: { version: '2.12.0', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }
      }
    });
    const files = release.files.map((entry) => entry.path);
    expect(files).toContain('runtime/node/node.exe');
    expect(files).toContain('runtime/node/node_modules/npm/.npmrc');
    expect(files).toContain('runtime/mysql/bin/mysqld.exe');
    expect(files).toContain('service/SAGE-API.exe');
    expect(files).toContain('service/SAGE-API.xml');
    expect(files).toContain('service/initialize-state.ps1');
    expect(files).toContain('service/initialize-mysql.ps1');
    expect(files).toContain('service/configure-firewall.ps1');
    expect(files).toContain('service/provision-services.ps1');
    expect(files).toContain('releases/1.2.3/api/node_modules/bcrypt/index.js');
    expect(files).toContain('releases/1.2.3/web/index.html');
    const serviceXml = await fs.readFile(path.join(input.destination, 'service', 'SAGE-API.xml'), 'utf8');
    expect(serviceXml).toContain('<id>SAGEAPI</id>');
    expect(serviceXml).toContain('<depend>SAGEMySQL</depend>');
    expect(serviceXml).toContain('<arguments>1.2.3</arguments>');
    expect(serviceXml).not.toContain('__SAGE_VERSION__');
    expect(release.files.every(({ sha256 }) => /^[a-f0-9]{64}$/.test(sha256))).toBe(true);
    expect(JSON.parse(await fs.readFile(path.join(input.destination, 'release.json'), 'utf8')))
      .toEqual(release);
  });

  it('recusa archive adulterado antes da extração', async () => {
    const input = await fixture();
    await write(input.artifactCache, 'node-fake.zip', 'evil');
    await expect(assembleWindowsLayout(input)).rejects.toThrow('SHA-256 divergente: node');
  });

  it('recusa runtime incompleto depois da extração', async () => {
    const input = await fixture();
    const extract = input.extractArchive;
    input.extractArchive = async (archive, destination) => {
      if (path.basename(archive) !== 'mysql-fake.zip') await extract(archive, destination);
    };
    await expect(assembleWindowsLayout(input)).rejects.toThrow('mysql Windows inválido');
  });

  it.each(['credentials.json', 'static/media/alunos.csv'])(
    'recusa arquivo web fora da allowlist: %s', async (file) => {
      const input = await fixture();
      await write(input.webBuildDir, file, 'não deve entrar');
      await expect(assembleWindowsLayout(input)).rejects.toThrow('Allowlist web divergente');
      await expect(fs.stat(input.destination)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  );

  it('remove staging parcial quando a composição falha', async () => {
    const input = await fixture();
    input.extractArchive = async () => { throw new Error('extração falhou'); };
    await expect(assembleWindowsLayout(input)).rejects.toThrow('extração falhou');
    await expect(fs.stat(input.destination)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
