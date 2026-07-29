const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const {
  DEFAULT_MANIFEST,
  loadManifest,
  verifyArtifactCache
} = require('./verify-windows-artifacts');

async function downloadArtifact(artifact, destination, fetchImpl) {
  const response = await fetchImpl(artifact.url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(10 * 60 * 1000)
  });
  if (!response.ok || !response.body) {
    throw new Error(`Download falhou para ${artifact.id}: HTTP ${response.status}`);
  }
  if (response.url && new URL(response.url).protocol !== 'https:') {
    throw new Error(`Redirect sem TLS recusado para ${artifact.id}`);
  }
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > artifact.size) {
    throw new Error(`Servidor declarou tamanho excessivo para ${artifact.id}`);
  }
  let received = 0;
  const limit = new Transform({
    transform(chunk, encoding, callback) {
      received += chunk.length;
      callback(received > artifact.size ? new Error(`Download excedeu tamanho de ${artifact.id}`) : null, chunk);
    }
  });
  await pipeline(
    Readable.fromWeb(response.body),
    limit,
    fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 })
  );
  if (received !== artifact.size) throw new Error(`Tamanho divergente no download de ${artifact.id}`);
}

async function fetchWindowsArtifacts(destination, {
  manifestPath = DEFAULT_MANIFEST,
  fetchImpl = globalThis.fetch
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch indisponível');
  const manifest = await loadManifest(manifestPath);
  const requested = path.resolve(destination);
  const output = path.join(await fsp.realpath(path.dirname(requested)), path.basename(requested));
  if (output === path.parse(output).root) throw new Error('Destino inseguro para artefatos');
  if (await fsp.stat(output).then(() => true, () => false)) throw new Error('Cache de artefatos já existe');
  const staging = `${output}.partial-${process.pid}-${crypto.randomUUID()}`;
  let stagingCreated = false;
  try {
    await fsp.mkdir(staging);
    stagingCreated = true;
    for (const artifact of manifest.artifacts) {
      await downloadArtifact(artifact, path.join(staging, artifact.fileName), fetchImpl);
    }
    await verifyArtifactCache(staging, manifestPath);
    await fsp.rename(staging, output);
    return manifest.artifacts.map(({ id }) => id);
  } catch (error) {
    if (stagingCreated) await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

if (require.main === module) {
  const destination = process.argv[2];
  if (!destination) {
    console.error('Uso: node scripts/fetch-windows-artifacts.js <cacheDir>');
    process.exitCode = 2;
  } else {
    fetchWindowsArtifacts(destination)
      .then((ids) => console.log(`Artefatos adquiridos e verificados: ${ids.join(', ')}`))
      .catch((error) => { console.error(error.message); process.exitCode = 1; });
  }
}

module.exports = { downloadArtifact, fetchWindowsArtifacts };
