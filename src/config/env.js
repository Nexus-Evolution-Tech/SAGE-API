const path = require('path');
const dotenv = require('dotenv');

const appRoot = path.resolve(__dirname, '..', '..');
const dataDir = process.env.SAGE_DATA_DIR;
const explicitConfigFile = process.env.SAGE_CONFIG_FILE;

if (dataDir && !path.isAbsolute(dataDir)) {
  throw new Error('SAGE_DATA_DIR deve ser um caminho absoluto');
}
if (explicitConfigFile && !path.isAbsolute(explicitConfigFile)) {
  throw new Error('SAGE_CONFIG_FILE deve ser um caminho absoluto');
}

const configFile = explicitConfigFile
  ? explicitConfigFile
  : dataDir
    ? path.join(dataDir, 'config', 'sage.env')
    : path.join(appRoot, '.env');

dotenv.config({ path: configFile, debug: false, quiet: true });

module.exports = { appRoot, configFile };
