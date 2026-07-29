const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { assembleApiPayload, copyEntry } = require('./assemble-api-payload');
const { loadManifest: loadArtifactManifest, verifyArtifactCache } = require('./verify-windows-artifacts');

const execFileAsync = promisify(execFile);
const WEB_ROOT_FILES = Object.freeze([
  'asset-manifest.json', 'favicon.ico', 'index.html', 'logo192.png', 'logo512.png', 'manifest.json', 'robots.txt'
]);

function isInside(base, target) {
  const relative = path.relative(base, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function regularFile(file, label) {
  const stat = await fsp.lstat(file).catch(() => null);
  if (!stat || stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} inválido: ${file}`);
}

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => fs.createReadStream(file)
    .on('data', (chunk) => hash.update(chunk))
    .on('error', reject)
    .on('end', resolve));
  return hash.digest('hex');
}

async function inventory(root, current = root) {
  const result = [];
  for (const name of (await fsp.readdir(current)).sort()) {
    const absolute = path.join(current, name);
    const stat = await fsp.lstat(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Link simbólico no release: ${absolute}`);
    if (stat.isDirectory()) result.push(...await inventory(root, absolute));
    else if (stat.isFile()) result.push({
      path: path.relative(root, absolute).split(path.sep).join('/'),
      size: stat.size,
      sha256: await sha256(absolute)
    });
    else throw new Error(`Entrada não regular no release: ${absolute}`);
  }
  return result;
}

async function canonicalInput(input) {
  const requested = path.resolve(input);
  if ((await fsp.lstat(requested)).isSymbolicLink()) throw new Error(`Origem não pode ser link: ${input}`);
  return fsp.realpath(requested);
}

async function extractZipWindows(archive, destination) {
  if (process.platform !== 'win32') throw new Error('Extração real exige Windows');
  await fsp.mkdir(destination, { recursive: true });
  await execFileAsync('tar.exe', ['-xf', archive, '-C', destination], { windowsHide: true });
}

async function selectedWebFiles(webRoot) {
  const actual = (await inventory(webRoot)).map(({ path: file }) => file);
  const allowed = (file) => WEB_ROOT_FILES.includes(file)
    || /^static\/(?:css|js|media)\/[A-Za-z0-9_.-]+\.(?:css|js|map|txt|png|svg|ico|jpe?g|webp|woff2?|ttf)$/i.test(file);
  const unexpected = actual.filter((file) => !allowed(file));
  const missing = WEB_ROOT_FILES.filter((file) => !actual.includes(file));
  if (unexpected.length || missing.length) {
    throw new Error(`Allowlist web divergente; inesperados=[${unexpected}], ausentes=[${missing}]`);
  }
  return actual;
}

async function assembleWindowsLayout({
  apiSourceRoot, webBuildDir, artifactCache, destination,
  artifactManifestPath, extractArchive = extractZipWindows
}) {
  const inputs = {
    api: await canonicalInput(apiSourceRoot),
    web: await canonicalInput(webBuildDir),
    artifacts: await canonicalInput(artifactCache)
  };
  const webFiles = await selectedWebFiles(inputs.web);
  const artifactManifest = await loadArtifactManifest(artifactManifestPath);
  await verifyArtifactCache(inputs.artifacts, artifactManifestPath);
  const artifact = (id) => {
    const found = artifactManifest.artifacts.find((item) => item.id === id);
    if (!found) throw new Error(`Artefato ausente no manifesto: ${id}`);
    return found;
  };

  const pkg = JSON.parse(await fsp.readFile(path.join(inputs.api, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version)) throw new Error('Versão inválida');
  const requestedOutput = path.resolve(destination);
  const output = path.join(await fsp.realpath(path.dirname(requestedOutput)), path.basename(requestedOutput));
  if (output === path.parse(output).root || Object.values(inputs).some((input) => isInside(input, output))) {
    throw new Error('Destino inseguro para release');
  }
  if (await fsp.stat(output).then(() => true, () => false)) throw new Error('Destino já existe');

  const staging = `${output}.partial-${process.pid}-${crypto.randomUUID()}`;
  let stagingCreated = false;
  try {
    await fsp.mkdir(staging);
    stagingCreated = true;
    const intake = path.join(staging, '.intake');
    for (const id of ['node', 'mysql']) {
      const item = artifact(id);
      const extracted = path.join(intake, id);
      await extractArchive(path.join(inputs.artifacts, item.fileName), extracted);
      const runtime = path.join(extracted, item.fileName.replace(/\.zip$/i, ''));
      await regularFile(path.join(runtime, id === 'node' ? 'node.exe' : 'bin/mysqld.exe'), `${id} Windows`);
      await copyEntry(runtime, path.join(staging, 'runtime', id));
    }
    await copyEntry(path.join(inputs.artifacts, artifact('winsw').fileName), path.join(staging, 'service', 'SAGE-API.exe'));
    const releaseDir = path.join(staging, 'releases', pkg.version);
    await fsp.mkdir(releaseDir, { recursive: true });
    await assembleApiPayload(inputs.api, path.join(releaseDir, 'api'));
    for (const file of webFiles) {
      await copyEntry(path.join(inputs.web, file), path.join(releaseDir, 'web', file));
    }
    await fsp.rm(intake, { recursive: true, force: true });

    const release = {
      schemaVersion: 1,
      product: 'SAGE',
      version: pkg.version,
      target: artifactManifest.target,
      inventoryScope: 'payload-files-excluding-release.json',
      distribution: {
        status: 'prototype-only',
        public: false,
        gates: artifactManifest.artifacts
          .filter(({ sageReleaseGate }) => sageReleaseGate)
          .map(({ id, sageReleaseGate }) => `${id}:${sageReleaseGate}`)
      },
      components: Object.fromEntries(artifactManifest.artifacts
        .filter(({ includeInPayload }) => includeInPayload)
        .map(({ id, version, sha256 }) => [id, { version, sha256 }])),
      files: await inventory(staging)
    };
    await fsp.writeFile(path.join(staging, 'release.json'), `${JSON.stringify(release, null, 2)}\n`);
    await fsp.rename(staging, output);
    return release;
  } catch (error) {
    if (stagingCreated) await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

if (require.main === module) {
  const [apiSourceRoot, webBuildDir, artifactCache, destination] = process.argv.slice(2);
  if (![apiSourceRoot, webBuildDir, artifactCache, destination].every(Boolean)) {
    console.error('Uso: node scripts/assemble-windows-layout.js <api> <web> <cache-artefatos> <destino>');
    process.exitCode = 2;
  } else {
    assembleWindowsLayout({ apiSourceRoot, webBuildDir, artifactCache, destination })
      .then((release) => console.log(`Release Windows montada: SAGE ${release.version}`))
      .catch((error) => { console.error(error.message); process.exitCode = 1; });
  }
}

module.exports = { assembleWindowsLayout };
