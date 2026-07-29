const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const RAIZ = path.join(__dirname, '..');

async function releaseSomenteLeitura(base) {
  const release = path.join(base, 'Programa somente leitura');
  const config = path.join(release, 'src', 'config');
  await fs.mkdir(config, { recursive: true });
  await fs.copyFile(path.join(RAIZ, 'src', 'config', 'env.js'), path.join(config, 'env.js'));
  await fs.copyFile(path.join(RAIZ, 'src', 'config', 'paths.js'), path.join(config, 'paths.js'));
  await fs.symlink(path.join(RAIZ, 'node_modules'), path.join(release, 'node_modules'), 'dir');
  await fs.chmod(path.join(config, 'env.js'), 0o444);
  await fs.chmod(path.join(config, 'paths.js'), 0o444);
  await fs.chmod(config, 0o555);
  await fs.chmod(path.join(release, 'src'), 0o555);
  await fs.chmod(release, 0o555);
  return release;
}

async function tornarRemovivel(release) {
  await fs.chmod(release, 0o755).catch(() => {});
  await fs.chmod(path.join(release, 'src'), 0o755).catch(() => {});
  await fs.chmod(path.join(release, 'src', 'config'), 0o755).catch(() => {});
}

describe('F8.2 — contrato de diretórios', () => {
  it('grava apenas em SAGE_DATA_DIR absoluto, com espaços e acentos, sem depender do cwd', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'sage-diretorios-'));
    const dataDir = path.join(base, 'Dados da escola São José');
    const cwd = path.join(base, 'cwd diferente');
    await fs.mkdir(cwd);
    const release = await releaseSomenteLeitura(base);
    const modulo = path.join(release, 'src', 'config', 'paths.js');

    try {
      const script = `
        const { paths, ensureDataDirs, isInside } = require(${JSON.stringify(modulo)});
        ensureDataDirs();
        process.stdout.write(JSON.stringify({
          paths,
          cwd: process.cwd(),
          backupValido: isInside(paths.backups, require('path').join(paths.backups, 'ok.sql')),
          prefixoIrmao: isInside(paths.backups, paths.backups + '-outro/roubo.sql')
        }));
      `;
      const env = { ...process.env, SAGE_DATA_DIR: dataDir };
      delete env.SAGE_CONFIG_FILE;
      const { stdout } = await execFileAsync(process.execPath, ['-e', script], { cwd, env });
      const resultado = JSON.parse(stdout);

      expect(await fs.realpath(resultado.cwd)).toBe(await fs.realpath(cwd));
      expect(resultado.paths.dataRoot).toBe(dataDir);
      expect(await fs.realpath(resultado.paths.appRoot)).toBe(await fs.realpath(release));
      expect(resultado.paths.uploads).toBe(path.join(dataDir, 'uploads'));
      expect(resultado.paths.models).toBe(path.join(resultado.paths.appRoot, 'models'));
      expect(resultado.backupValido).toBe(true);
      expect(resultado.prefixoIrmao).toBe(false);

      for (const dir of ['config', 'logs', 'uploads', 'exports', 'backups']) {
        expect((await fs.stat(path.join(dataDir, dir))).isDirectory()).toBe(true);
      }
      expect(await fs.readdir(release)).toEqual(['node_modules', 'src']);
    } finally {
      await tornarRemovivel(release);
      await fs.rm(base, { recursive: true, force: true });
    }
  });

  it('rejeita SAGE_DATA_DIR relativo', async () => {
    const script = `require(${JSON.stringify(path.join(RAIZ, 'src', 'config', 'paths.js'))})`;
    const env = { ...process.env, SAGE_DATA_DIR: 'dados-relativos' };
    delete env.SAGE_CONFIG_FILE;

    await expect(execFileAsync(process.execPath, ['-e', script], { env })).rejects.toMatchObject({
      code: 1
    });
  });

  it('rejeita SAGE_CONFIG_FILE relativo', async () => {
    const script = `require(${JSON.stringify(path.join(RAIZ, 'src', 'config', 'env.js'))})`;
    const env = { ...process.env, SAGE_CONFIG_FILE: 'config-relativa.env' };
    delete env.SAGE_DATA_DIR;

    await expect(execFileAsync(process.execPath, ['-e', script], { env })).rejects.toMatchObject({
      code: 1
    });
  });
});
