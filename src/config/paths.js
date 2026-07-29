const fs = require('fs');
const path = require('path');
const { appRoot } = require('./env');

const configuredDataDir = process.env.SAGE_DATA_DIR;
if (configuredDataDir && !path.isAbsolute(configuredDataDir)) {
  throw new Error('SAGE_DATA_DIR deve ser um caminho absoluto');
}

const dataRoot = configuredDataDir || appRoot;
const paths = Object.freeze({
  appRoot,
  dataRoot,
  config: path.join(dataRoot, 'config'),
  logs: path.join(dataRoot, 'logs'),
  uploads: configuredDataDir ? path.join(dataRoot, 'uploads') : path.join(appRoot, 'src', 'uploads'),
  exports: path.join(dataRoot, 'exports'),
  backups: path.join(dataRoot, 'backups'),
  models: path.join(appRoot, 'models')
});

function ensureDataDirs() {
  for (const dir of [paths.config, paths.logs, paths.uploads, paths.exports, paths.backups]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return paths;
}

function isInside(base, target) {
  const relative = path.relative(path.resolve(base), path.resolve(target));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

module.exports = { paths, ensureDataDirs, isInside };
