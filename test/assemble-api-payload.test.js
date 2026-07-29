const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { assembleApiPayload, REQUIRED_FILES, SOURCE_FILES } = require('../scripts/assemble-api-payload');

const tempDirs = [];
afterEach(async () => Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, {
  recursive: true,
  force: true
}))));

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sage-api-source-'));
  tempDirs.push(root);
  const content = Object.fromEntries([...REQUIRED_FILES, ...SOURCE_FILES]
    .map((file) => [file, `fixture:${file}`]));
  content['package.json'] = JSON.stringify({
    name: 'sage-api', version: '1.2.3', devDependencies: { vitest: '1.0.0' }
  });
  content['package-lock.json'] = '{}';
  content['node_modules/bcrypt/index.js'] = 'module.exports = {};';
  content['node_modules/.package-lock.json'] = '{}';
  content['database/migration_alpha.sql'] = 'SELECT 1;';
  content['database/migrations/0001_add-index.sql'] = 'SELECT 2;';
  for (const [relative, value] of Object.entries(content)) {
    const file = path.join(root, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, value);
  }
  return root;
}

describe('montagem segura do payload da API', () => {
  it('copia somente runtime, migrations e modelos vazios por allowlist', async () => {
    const source = await fixture();
    const destination = `${source}-payload`;
    tempDirs.push(destination);
    await fs.writeFile(path.join(source, '.env'), 'DB_PASSWORD=segredo');
    await fs.writeFile(path.join(source, 'database', 'PlanilhaPessoas.xlsx'), 'dado pessoal');
    await fs.writeFile(path.join(source, 'database', 'dados_etec_taboao.sql'), 'seed da escola');

    const result = await assembleApiPayload(source, destination);

    expect(result).toEqual({ name: 'sage-api', version: '1.2.3' });
    await expect(fs.stat(path.join(destination, 'database/migrations/0001_add-index.sql')))
      .resolves.toBeTruthy();
    for (const forbidden of ['.env', 'database/PlanilhaPessoas.xlsx', 'database/dados_etec_taboao.sql']) {
      await expect(fs.stat(path.join(destination, forbidden))).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });

  it('falha se aparecer arquivo fora da allowlist e não deixa payload parcial', async () => {
    const source = await fixture();
    const destination = `${source}-payload`;
    tempDirs.push(destination);
    await fs.mkdir(path.join(source, 'src', 'uploads'));
    await fs.writeFile(path.join(source, 'src', 'uploads', 'aluno.jpg'), 'foto');

    await expect(assembleApiPayload(source, destination))
      .rejects.toThrow('Allowlist src divergente');
    await expect(fs.stat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('recusa destino existente em vez de misturar releases', async () => {
    const source = await fixture();
    const destination = `${source}-payload`;
    tempDirs.push(destination);
    await fs.mkdir(destination);

    await expect(assembleApiPayload(source, destination)).rejects.toThrow('Destino já existe');
  });

  it('recusa link mesmo quando aponta para dentro da origem', async () => {
    const source = await fixture();
    const destination = `${source}-payload`;
    tempDirs.push(destination);
    const realModule = path.join(source, 'bcrypt-real');
    const linkedModule = path.join(source, 'node_modules', 'bcrypt');
    await fs.mkdir(realModule);
    await fs.writeFile(path.join(realModule, 'index.js'), 'module.exports = {};');
    await fs.rm(linkedModule, { recursive: true });
    await fs.symlink(realModule, linkedModule, 'junction');

    await expect(assembleApiPayload(source, destination)).rejects.toThrow('Link simbólico recusado');
    await expect(fs.stat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([
    ['node_modules/bcrypt/.npmrc', 'Configuração secreta recusada'],
    ['node_modules/vitest/index.js', 'Dependência de desenvolvimento no payload']
  ])('recusa conteúdo não produtivo em %s', async (relative, message) => {
    const source = await fixture();
    const file = path.join(source, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, 'não deve entrar');
    await expect(assembleApiPayload(source, `${source}-payload`)).rejects.toThrow(message);
  });

  it('recusa diretório ancestral das migrations quando ele é um link', async () => {
    const source = await fixture();
    const destination = `${source}-payload`;
    tempDirs.push(destination);
    const realMigrations = path.join(source, 'migrations-real');
    const linkedMigrations = path.join(source, 'database', 'migrations');
    await fs.rename(linkedMigrations, realMigrations);
    await fs.symlink(realMigrations, linkedMigrations, 'junction');

    await expect(assembleApiPayload(source, destination)).rejects.toThrow('Link simbólico recusado');
  });
});
