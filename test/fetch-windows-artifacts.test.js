const crypto = require('crypto');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { fetchWindowsArtifacts } = require('../scripts/fetch-windows-artifacts');

const roots = [];
afterEach(async () => Promise.all(roots.splice(0)
  .map((root) => fs.rm(root, { recursive: true, force: true }))));

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sage-artifact-fetch-'));
  roots.push(root);
  const contents = { node: 'node-archive', winsw: 'winsw-binary' };
  const artifacts = [
    ['node', 'runtime', true, '24.18.0', 'node.zip'],
    ['winsw', 'runtime', true, '2.12.0', 'winsw.exe']
  ].map(([id, role, includeInPayload, version, fileName]) => ({
    id, role, includeInPayload, version, fileName,
    url: `https://example.invalid/${fileName}`,
    size: Buffer.byteLength(contents[id]),
    sha256: crypto.createHash('sha256').update(contents[id]).digest('hex'),
    digestSource: 'fixture'
  }));
  const manifestPath = path.join(root, 'artifacts.json');
  await fs.writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, target: 'win32-x64', artifacts }));
  const destination = path.join(root, 'cache');
  return { root, contents, artifacts, manifestPath, destination };
}

function fakeFetch(contents) {
  return async (url) => {
    const id = url.endsWith('node.zip') ? 'node' : 'winsw';
    return new Response(contents[id], {
      status: 200,
      headers: { 'content-length': String(Buffer.byteLength(contents[id])) }
    });
  };
}

describe('aquisição verificada dos artefatos Windows', () => {
  it('publica o cache somente depois de tamanho e SHA-256 conferirem', async () => {
    const data = await fixture();
    await expect(fetchWindowsArtifacts(data.destination, {
      manifestPath: data.manifestPath,
      fetchImpl: fakeFetch(data.contents)
    })).resolves.toEqual(['node', 'winsw']);
    await expect(fs.readFile(path.join(data.destination, 'node.zip'), 'utf8'))
      .resolves.toBe(data.contents.node);
  });

  it('recusa conteúdo adulterado e remove o staging parcial', async () => {
    const data = await fixture();
    const altered = { ...data.contents, node: 'evil-archive' };
    await expect(fetchWindowsArtifacts(data.destination, {
      manifestPath: data.manifestPath,
      fetchImpl: fakeFetch(altered)
    })).rejects.toThrow('SHA-256 divergente: node');
    await expect(fs.stat(data.destination)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('não sobrescreve cache existente', async () => {
    const data = await fixture();
    await fs.mkdir(data.destination);
    await expect(fetchWindowsArtifacts(data.destination, {
      manifestPath: data.manifestPath,
      fetchImpl: fakeFetch(data.contents)
    })).rejects.toThrow('Cache de artefatos já existe');
  });
});
