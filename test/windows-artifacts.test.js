const crypto = require('crypto');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const {
  loadManifest,
  validateManifest,
  verifyArtifact
} = require('../scripts/verify-windows-artifacts');

const tempDirs = [];
afterEach(async () => Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, {
  recursive: true,
  force: true
}))));

describe('manifesto de artefatos Windows', () => {
  it('fixa os quatro binários e explicita a proveniência dos hashes', async () => {
    const manifest = await loadManifest();
    expect(manifest.artifacts.map(({ id, version }) => `${id}@${version}`)).toEqual([
      'node@24.18.0',
      'mysql@8.4.11',
      'winsw@2.12.0',
      'inno-setup@6.7.3'
    ]);
    expect(manifest.artifacts.every(({ url }) => url.startsWith('https://'))).toBe(true);
    expect(manifest.artifacts.find(({ id }) => id === 'mysql')).toMatchObject({
      digestSource: 'project-pinned-after-upstream-md5',
      redistribution: 'legal-review-required',
      signatureVerification: 'pending'
    });
    expect(manifest.artifacts.find(({ id }) => id === 'inno-setup')).toMatchObject({
      digestSource: 'upstream-issig-file-hash',
      includeInPayload: false,
      commercialAutomation: 'single-user-license-expected',
      sageReleaseGate: 'commercial-license-record-required'
    });
  });

  it('rejeita path traversal antes de aceitar a origem', () => {
    const base = {
      schemaVersion: 1,
      target: 'win32-x64',
      artifacts: [{ id: 'node', fileName: '../node.zip', url: 'http://invalid', size: 1, sha256: '0'.repeat(64) }]
    };
    expect(() => validateManifest(base)).toThrow('Nome de arquivo inseguro');
  });

  it('recusa ferramenta de build dentro do payload', () => {
    expect(() => validateManifest({
      schemaVersion: 1,
      target: 'win32-x64',
      artifacts: [{
        id: 'inno', role: 'build', includeInPayload: true, version: '1', digestSource: 'upstream',
        fileName: 'inno.exe', url: 'https://example.invalid/inno.exe', size: 1, sha256: '0'.repeat(64)
      }]
    })).toThrow('Ferramenta de build não pode entrar no payload');
  });

  it('falha fechado quando tamanho ou SHA-256 divergem', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sage-artifact-'));
    tempDirs.push(dir);
    const file = path.join(dir, 'fixture.bin');
    const content = Buffer.from('artefato conhecido');
    await fs.writeFile(file, content);
    const artifact = {
      id: 'fixture',
      size: content.length,
      sha256: crypto.createHash('sha256').update(content).digest('hex')
    };
    await expect(verifyArtifact(file, artifact)).resolves.toBeUndefined();
    await expect(verifyArtifact(file, { ...artifact, size: content.length + 1 }))
      .rejects.toThrow('Tamanho divergente');
    await expect(verifyArtifact(file, { ...artifact, sha256: '0'.repeat(64) }))
      .rejects.toThrow('SHA-256 divergente');
  });
});
