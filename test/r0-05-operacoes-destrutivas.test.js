const fs = require('fs');
const axios = require('axios');
const { createCatracaSimulator } = require('./fakes/controlid');
const deviceService = require('../src/services/deviceService');
const backupBanco = require('../src/services/backupBanco');
const { compararContagens } = require('../scripts/renomear-bd-para-antigo');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

async function comFakes(fakes, executar) {
  const anteriores = fakes.map(([nome, exports]) => { const r = require.resolve(nome); const a = require.cache[r]; require.cache[r] = { id: r, filename: r, loaded: true, exports }; return [r, a]; });
  const alvo = require.resolve('../src/controllers/deviceController'); const anterior = require.cache[alvo]; delete require.cache[alvo];
  try { return await executar(require(alvo)); } finally { if (anterior) require.cache[alvo] = anterior; else delete require.cache[alvo]; for (const [r, a] of anteriores.reverse()) { if (a) require.cache[r] = a; else delete require.cache[r]; } }
}

describe('R0-05 — backup e destruição', () => {
  let sim;
  beforeEach(async () => { sim = await createCatracaSimulator(); });
  afterEach(async () => { await sim.stop(); });

  it('B-011: backup, limpeza, restore e releitura preservam os objetos', async () => {
    const d = { ...sim.dispositivo, id: 991, nome: 'simulada' };
    const login = await axios.post(`http://${sim.url}/login.fcgi`, { login: 'admin', password: 'admin' });
    await axios.post(`http://${sim.url}/create_objects.fcgi?session=${login.data.session}`, { object: 'users', values: [{ id: 9, registration: '9' }] });
    const backup = await deviceService.gerarBackupCompletoCatraca(d);
    const esperado = JSON.parse(fs.readFileSync(backup.filePath, 'utf8')).dados;
    await axios.post(`http://${sim.url}/destroy_objects.fcgi?session=${login.data.session}`, { object: 'users' });
    await deviceService.restaurarBackupCompletoCatraca(d, backup.filePath);
    const relido = await axios.post(`http://${sim.url}/load_objects.fcgi?session=${login.data.session}`, { object: 'users' });
    expect(relido.data.users).toEqual(esperado.users);
    fs.unlinkSync(backup.filePath);
  });

  it('B-011: falha de leitura recusa backup parcial sem gravar arquivo', async () => {
    const d = { ...sim.dispositivo, id: 992 }; const antes = new Set(fs.readdirSync(require('../src/config/paths').paths.backups));
    sim.setFailureMode('sessaoExpirada', { vezes: 2, aposOperacoes: 1 });
    await expect(deviceService.gerarBackupCompletoCatraca(d)).rejects.toThrow(/incompleto/);
    expect(fs.readdirSync(require('../src/config/paths').paths.backups).filter((n) => !antes.has(n))).toEqual([]);
  });

  it('D-005: auditor permanece estritamente read-only', () => {
    const fonte = fs.readFileSync('scripts/audit-api-surface.js', 'utf8');
    expect(fonte).toContain("new Set(['get'])");
  });

  it('B-012: marcador velho é invalidado antes de uma prova reprovada', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sage-r0-05-'));
    const dump = path.join(dir, 'sage-backup-x.sql');
    fs.writeFileSync(dump, 'dump');
    fs.writeFileSync(`${dump}.verified.json`, JSON.stringify({ bytes: 4, modificadoEm: fs.statSync(dump).mtime.toISOString() }));
    await backupBanco.invalidarProva(dump);
    const antigo = process.env.BACKUP_DIR; process.env.BACKUP_DIR = dir;
    expect((await backupBanco.listarBackups())[0].verificado).toBe(false);
    if (antigo === undefined) delete process.env.BACKUP_DIR; else process.env.BACKUP_DIR = antigo;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('B-012: alteração com mesmo tamanho invalida a prova por hash', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sage-r0-05-')), dump = path.join(dir, 'sage-backup-y.sql');
    fs.writeFileSync(dump, 'aaaa'); const st = fs.statSync(dump);
    fs.writeFileSync(`${dump}.verified.json`, JSON.stringify({ bytes: 4, modificadoEm: st.mtime.toISOString(), hash: crypto.createHash('sha256').update('aaaa').digest('hex') }));
    fs.writeFileSync(dump, 'bbbb'); const antigo = process.env.BACKUP_DIR; process.env.BACKUP_DIR = dir;
    expect((await backupBanco.listarBackups())[0].verificado).toBe(false);
    if (antigo === undefined) delete process.env.BACKUP_DIR; else process.env.BACKUP_DIR = antigo; fs.rmSync(dir, { recursive: true, force: true });
  });

  it('D-004: contagens divergentes impedem remover a original', () => {
    expect(compararContagens({ Pessoa: 2, Acesso: 4 }, { Pessoa: 2, Acesso: 3 })).toBe(false);
    expect(compararContagens({ Pessoa: 2 }, { Pessoa: 2 })).toBe(true);
    expect(compararContagens({ Pessoa: 2 }, { Pessoa: 2, Extra: 0 })).toBe(false);
  });

  it('A-004: gates e falha local não confirmam nem preservam deletes parciais', async () => {
    let backups = 0, zeragens = 0, restores = 0, commits = 0, rollbacks = 0;
    const conexao = { beginTransaction: async () => {}, commit: async () => { commits++; }, rollback: async () => { rollbacks++; }, release() {}, query: async (sql) => { if (sql.includes('DELETE FROM Acesso')) throw new Error('falha local'); return [{ affectedRows: 0 }]; } };
    const db = { query: async () => [[{ id: 1 }]], getConnection: async () => conexao };
    const device = { gerarBackupCompletoCatraca: async () => ({ filePath: 'x' }), zerarTudoNaCatraca: async () => { zeragens++; return { ok: true }; }, restaurarBackupCompletoCatraca: async () => { restores++; } };
    const backup = { gerarBackup: async () => { backups++; return { caminho: 'x' }; }, verificarBackup: async () => ({ ok: true }) };
    const noop = {};
    await comFakes([
      ['../src/config/database', db], ['../src/services/deviceService', device], ['../src/services/backupBanco', backup], ['../src/controllers/genericControllerFactory', () => ({})], ['../src/config/logger', { info() {}, error() {}, warn() {} }], ['../src/utils/generic-db-utils', { buscarTodos: async () => [], criarRegistro: async () => {} }], ['../src/services/networkDiscoveryService', noop], ['../src/cache/helpers', noop], ['../src/services/notificationService', noop], ['../src/utils/syncFlags', { isSyncEnabled: () => true }], ['../src/utils/controlId-utils', noop], ['../src/state/globalState', noop], ['../src/services/catracaImportService', noop], ['../src/services/protecaoLogs', noop]
    ], async (controller) => {
      const resposta = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn() });
      let res = resposta(); await controller.comecarDoZero({ params: { id: '1' }, body: {}, user: null }, res); expect(backups + zeragens).toBe(0); expect(res.status).toHaveBeenCalledWith(403);
      backup.verificarBackup = async () => ({ ok: false }); res = resposta(); await controller.comecarDoZero({ params: { id: '1' }, body: { confirmacao: 'APAGAR TUDO' }, user: { usuario_id: 7 } }, res); expect(zeragens).toBe(0);
      backup.verificarBackup = async () => ({ ok: true }); res = resposta(); await controller.comecarDoZero({ params: { id: '1' }, body: { confirmacao: 'APAGAR TUDO', apagarAcessosNoSistema: true }, user: { usuario_id: 7 } }, res); expect({ commits, rollbacks, restores }).toEqual({ commits: 2, rollbacks: 1, restores: 1 }); expect(res.status).toHaveBeenCalledWith(500);
      device.zerarTudoNaCatraca = async () => ({ ok: false }); res = resposta(); await controller.comecarDoZero({ params: { id: '1' }, body: { confirmacao: 'APAGAR TUDO' }, user: { usuario_id: 7 } }, res); expect(restores).toBe(2);
      device.zerarTudoNaCatraca = async () => ({ ok: true }); db.getConnection = async () => { throw new Error('conexão falhou'); }; res = resposta(); await controller.comecarDoZero({ params: { id: '1' }, body: { confirmacao: 'APAGAR TUDO' }, user: { usuario_id: 7 } }, res); expect(restores).toBe(2);
      const boa = { ...conexao, query: async () => [{ affectedRows: 0 }] }; db.getConnection = async () => boa; device.zerarTudoNaCatraca = async () => ({ ok: true, summary: { users: 1 } }); res = resposta(); await controller.comecarDoZero({ params: { id: '1' }, body: { confirmacao: 'APAGAR TUDO' }, user: { usuario_id: 7 } }, res); expect(commits).toBe(6); expect(rollbacks).toBe(1); expect(restores).toBe(2); expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ catraca: { users: 1 } }));
    });
  });
});
