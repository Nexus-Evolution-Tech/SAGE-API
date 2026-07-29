const crypto = require('crypto');
const fsp = require('fs').promises;
const path = require('path');
const { loadMigrations } = require('./migration-runner');

const REQUIRED_FILES = Object.freeze([
  'index.js',
  'package.json',
  'package-lock.json',
  'scripts/legacy-baseline.js',
  'scripts/migration-runner.js',
  'scripts/runtime-schema-gate.js',
  'scripts/setup-database.js',
  'scripts/start-with-setup.js',
  'models/PlanilhaDadosEscolares-Modelo.xlsx',
  'models/PlanilhaPessoas-Modelo.xlsx',
  'database/sage.sql',
  'database/melhorias_sistema.sql'
]);

const SOURCE_FILES = Object.freeze(Object.entries({
  '': ['app.js'],
  cache: ['cacheKeys.js', 'helpers.js'],
  config: ['axios.js', 'database.js', 'env.js', 'loadRoutes.js', 'logger.js', 'paths.js',
    'queryBuilder.js', 'redis.js', 'syncOrder.js', 'web.js'],
  controllers: ['accessController.js', 'accessSolicitationController.js', 'areaController.js',
    'classController.js', 'companyController.js', 'courseController.js', 'dataController.js',
    'deviceController.js', 'funcionarioHorarioController.js', 'genericControllerFactory.js',
    'horarioAulaController.js', 'horarioController.js', 'lessonController.js', 'materiaController.js',
    'peopleController.js', 'presenceController.js', 'promocaoController.js',
    'recuperacaoSenhaController.js', 'relatorioController.js', 'roomController.js', 'salaController.js',
    'schoolController.js', 'schoolPhotoController.js', 'subjectController.js'],
  docs: ['swagger.yml'], errors: ['ErroDispositivo.js'], jobs: ['scheduledJobs.js'],
  middlewares: ['autenticar.js', 'monitorCallbackAuth.js', 'uploadFoto.js', 'validacao.js'],
  routes: ['accessRoutes.js', 'acessSolicitationRoutes.js', 'areaRoutes.js', 'classRoutes.js',
    'companyRoutes.js', 'courseRoutes.js', 'dataRoutes.js', 'deviceRoutes.js',
    'funcionarioHorarioRoutes.js', 'genericRoutesFactory.js', 'horarioAulaRoutes.js',
    'horarioRoutes.js', 'lessonRoutes.js', 'materiaRoutes.js', 'monitoringRoutes.js',
    'notificationRoutes.js', 'peopleRoutes.js', 'presenceRoutes.js', 'promocaoRoutes.js',
    'relatorioRoutes.js', 'roomRoutes.js', 'salaRoutes.js', 'schoolPhotoRoutes.js', 'schoolRoutes.js',
    'statusRoutes.js', 'subjectRoutes.js'],
  services: ['accessService.js', 'backupBanco.js', 'catracaImportService.js', 'controlIdService.js',
    'deviceService.js', 'diagnostico.js', 'emailService.js', 'exportService.js', 'importService.js',
    'networkDiscoveryService.js', 'notificationService.js', 'peopleService.js', 'presenceService.js',
    'promocaoAlunosService.js', 'protecaoLogs.js', 'readinessService.js', 'sanitizador.js',
    'saudeDispositivos.js', 'sync.js'],
  state: ['globalState.js'],
  utils: ['ajustaFusoHorario.js', 'controlId-utils.js', 'converterPngBase64.js', 'criptografia.js',
    'generic-db-utils.js', 'gerarCardValue.js', 'gerarNumero8Digitos.js', 'jwt.js',
    'people-db-utils.js', 'photo-user-utils.js', 'syncFlags.js', 'sync_catracas.js'],
  websocket: ['wsServer.js']
}).flatMap(([dir, names]) => names.map((name) => path.posix.join('src', dir, name))));

function isInside(base, target) {
  const relative = path.relative(base, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function copyEntry(source, destination) {
  const stat = await fsp.lstat(source);
  if (stat.isSymbolicLink()) throw new Error(`Link simbólico recusado: ${source}`);
  if (stat.isDirectory()) {
    const entries = (await fsp.readdir(source)).sort();
    await fsp.mkdir(destination, { recursive: true });
    for (const entry of entries) {
      await copyEntry(path.join(source, entry), path.join(destination, entry));
    }
    return;
  }
  if (!stat.isFile()) throw new Error(`Entrada não regular recusada: ${source}`);
  if (/^(?:\.npmrc|\.env(?:\..*)?)$/i.test(path.basename(source))
    || /\.(?:key|pem|pfx|p12)$/i.test(source)) {
    throw new Error(`Configuração secreta recusada: ${source}`);
  }
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  await fsp.copyFile(source, destination);
}

async function assertNoSymlinkComponents(root, relative) {
  let current = root;
  for (const segment of relative.split('/')) {
    current = path.join(current, segment);
    if ((await fsp.lstat(current)).isSymbolicLink()) throw new Error(`Link simbólico recusado: ${current}`);
  }
}

async function listFiles(root, current = root) {
  const files = [];
  for (const name of (await fsp.readdir(current)).sort()) {
    const absolute = path.join(current, name);
    const stat = await fsp.lstat(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Link simbólico recusado: ${absolute}`);
    if (stat.isDirectory()) files.push(...await listFiles(root, absolute));
    else if (stat.isFile()) files.push(path.relative(root, absolute).split(path.sep).join('/'));
    else throw new Error(`Entrada não regular recusada: ${absolute}`);
  }
  return files;
}

async function selectedSourceFiles(sourceRoot) {
  await assertNoSymlinkComponents(sourceRoot, 'src');
  const actual = await listFiles(path.join(sourceRoot, 'src'));
  const expected = SOURCE_FILES.map((file) => file.slice('src/'.length)).sort();
  const unexpected = actual.filter((file) => !expected.includes(file));
  const missing = expected.filter((file) => !actual.includes(file));
  if (unexpected.length || missing.length) {
    throw new Error(`Allowlist src divergente; inesperados=[${unexpected}], ausentes=[${missing}]`);
  }
  return SOURCE_FILES;
}

async function selectedDatabaseFiles(sourceRoot) {
  const databaseDir = path.join(sourceRoot, 'database');
  await assertNoSymlinkComponents(sourceRoot, 'database');
  await assertNoSymlinkComponents(sourceRoot, 'database/migrations');
  const legacy = (await fsp.readdir(databaseDir))
    .filter((name) => /^migration_[a-z0-9_-]+\.sql$/i.test(name))
    .map((name) => `database/${name}`);
  const versioned = (await loadMigrations(path.join(databaseDir, 'migrations')))
    .map(({ file }) => `database/migrations/${file}`);
  return [...legacy, ...versioned].sort();
}

async function assertProductionNodeModules(source) {
  await fsp.stat(path.join(source, 'node_modules', '.package-lock.json'));
  const pkg = JSON.parse(await fsp.readFile(path.join(source, 'package.json'), 'utf8'));
  for (const dependency of Object.keys(pkg.devDependencies || {})) {
    const present = await fsp.stat(path.join(source, 'node_modules', ...dependency.split('/')))
      .then(() => true, () => false);
    if (present) throw new Error(`Dependência de desenvolvimento no payload: ${dependency}`);
  }
  return pkg;
}

async function assembleApiPayload(sourceRoot, destination) {
  const requestedSource = path.resolve(sourceRoot);
  if ((await fsp.lstat(requestedSource)).isSymbolicLink()) throw new Error('Raiz de origem não pode ser link');
  const source = await fsp.realpath(requestedSource);
  const requestedOutput = path.resolve(destination);
  const output = path.join(await fsp.realpath(path.dirname(requestedOutput)), path.basename(requestedOutput));
  if (output === path.parse(output).root || isInside(source, output) || isInside(output, source)) {
    throw new Error('Destino inseguro para montagem');
  }
  if (await fsp.stat(output).then(() => true, () => false)) throw new Error('Destino já existe');
  const staging = `${output}.partial-${process.pid}-${crypto.randomUUID()}`;
  let stagingCreated = false;
  try {
    await fsp.mkdir(staging, { recursive: false });
    stagingCreated = true;
    const files = [
      ...REQUIRED_FILES,
      ...await selectedDatabaseFiles(source),
      ...await selectedSourceFiles(source)
    ];
    for (const relative of files) {
      await assertNoSymlinkComponents(source, relative);
      await copyEntry(path.join(source, relative), path.join(staging, relative));
    }
    await assertNoSymlinkComponents(source, 'node_modules');
    const pkg = await assertProductionNodeModules(source);
    await copyEntry(path.join(source, 'node_modules'), path.join(staging, 'node_modules'));
    await fsp.rename(staging, output);
    return { name: pkg.name, version: pkg.version };
  } catch (error) {
    if (stagingCreated) await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

if (require.main === module) {
  const [source, destination] = process.argv.slice(2);
  if (!source || !destination) {
    console.error('Uso: node scripts/assemble-api-payload.js <sourceRoot> <destination>');
    process.exitCode = 2;
  } else {
    assembleApiPayload(source, destination)
      .then((result) => console.log(`Payload API montado: ${result.name}@${result.version}`))
      .catch((error) => { console.error(error.message); process.exitCode = 1; });
  }
}

module.exports = { REQUIRED_FILES, SOURCE_FILES, assembleApiPayload };
