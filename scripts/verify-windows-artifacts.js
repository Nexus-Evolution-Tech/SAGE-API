const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const DEFAULT_MANIFEST = path.join(__dirname, '..', 'installer', 'windows', 'artifacts.json');

function validateManifest(manifest) {
  if (manifest?.schemaVersion !== 1 || manifest.target !== 'win32-x64') {
    throw new Error('Manifesto Windows incompatível');
  }
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
    throw new Error('Manifesto sem artefatos');
  }
  const ids = new Set();
  const names = new Set();
  for (const artifact of manifest.artifacts) {
    if (!/^[a-z0-9-]+$/.test(artifact.id) || ids.has(artifact.id)) {
      throw new Error(`ID inválido ou duplicado: ${artifact.id}`);
    }
    if (path.basename(artifact.fileName) !== artifact.fileName || names.has(artifact.fileName)) {
      throw new Error(`Nome de arquivo inseguro ou duplicado: ${artifact.fileName}`);
    }
    if (!['runtime', 'build'].includes(artifact.role) || typeof artifact.includeInPayload !== 'boolean') {
      throw new Error(`Papel inválido: ${artifact.id}`);
    }
    if (artifact.role === 'build' && artifact.includeInPayload) {
      throw new Error(`Ferramenta de build não pode entrar no payload: ${artifact.id}`);
    }
    if (typeof artifact.version !== 'string' || !artifact.version || !artifact.digestSource) {
      throw new Error(`Metadados incompletos: ${artifact.id}`);
    }
    if (new URL(artifact.url).protocol !== 'https:') {
      throw new Error(`URL não HTTPS: ${artifact.id}`);
    }
    if (!Number.isSafeInteger(artifact.size) || artifact.size <= 0) {
      throw new Error(`Tamanho inválido: ${artifact.id}`);
    }
    if (!/^[a-f0-9]{64}$/.test(artifact.sha256)) {
      throw new Error(`SHA-256 inválido: ${artifact.id}`);
    }
    ids.add(artifact.id);
    names.add(artifact.fileName);
  }
  return manifest;
}

async function loadManifest(manifestPath = DEFAULT_MANIFEST) {
  return validateManifest(JSON.parse(await fsp.readFile(manifestPath, 'utf8')));
}

async function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => fs.createReadStream(filePath)
    .on('data', (chunk) => hash.update(chunk))
    .on('error', reject)
    .on('end', resolve));
  return hash.digest('hex');
}

async function verifyArtifact(filePath, artifact) {
  const stat = await fsp.lstat(filePath);
  if (stat.isSymbolicLink()) {
    throw new Error(`Link simbólico recusado: ${artifact.id}`);
  }
  if (!stat.isFile() || stat.size !== artifact.size) {
    throw new Error(`Tamanho divergente: ${artifact.id}`);
  }
  if (await sha256(filePath) !== artifact.sha256) {
    throw new Error(`SHA-256 divergente: ${artifact.id}`);
  }
}

async function verifyArtifactCache(cacheDir, manifestPath = DEFAULT_MANIFEST) {
  const manifest = await loadManifest(manifestPath);
  for (const artifact of manifest.artifacts) {
    await verifyArtifact(path.join(cacheDir, artifact.fileName), artifact);
  }
  return manifest.artifacts.map(({ id }) => id);
}

if (require.main === module) {
  const cacheDir = process.argv[2];
  if (!cacheDir) {
    console.error('Uso: node scripts/verify-windows-artifacts.js <cacheDir>');
    process.exitCode = 2;
  } else {
    verifyArtifactCache(cacheDir)
      .then((ids) => console.log(`Integridade local verificada: ${ids.join(', ')}`))
      .catch((error) => { console.error(error.message); process.exitCode = 1; });
  }
}

module.exports = { DEFAULT_MANIFEST, loadManifest, validateManifest, verifyArtifact, verifyArtifactCache };
