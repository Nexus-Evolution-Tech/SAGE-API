const controller = require('../src/controllers/deviceController');
const deviceService = require('../src/services/deviceService');
const backupBanco = require('../src/services/backupBanco');
const auditoria = require('../src/services/auditoriaService');
const db = require('../src/config/database');
function resposta() { const res = { statusCode: 200, body: null };
  res.status = (status) => { res.statusCode = status; return res; };
  res.json = (body) => { res.body = body; return res; }; return res; }
function conexaoAuditoria({ falhar = false } = {}) { const detalhes = [];
  return { detalhes, async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async query(sql, values) { if (sql.startsWith('INSERT INTO TrilhaAuditoria')) {
      if (falhar) throw new Error('falha de auditoria controlada'); detalhes.push(JSON.parse(values[4])); }
      return [{ affectedRows: 0 }]; } }; }
const dispositivo = { id: 7, endereco: '127.0.0.1', porta: 80, usuario: 'u', senha: 's' };
describe('R1-03C - auditoria de destruicao e zeragem', () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.spyOn(db, 'query').mockResolvedValue([[dispositivo]]); });
  it('audita tentativa e sucesso de apagar objeto sem dados sensiveis', async () => {
    const conexao = conexaoAuditoria(); vi.spyOn(db, 'getConnection').mockResolvedValue(conexao);
    vi.spyOn(deviceService, 'backupPorTipo').mockResolvedValue({ filePath: 'backup' });
    vi.spyOn(deviceService, 'destroyObjectsOnCatraca').mockResolvedValue({ ok: true, changes: 1 }); const res = resposta();
    await controller.deletarObjetoCatraca({ params: { id: '7', objectType: 'users', objectId: '12' }, user: { usuario_id: 21 } }, res);
    expect(res.statusCode).toBe(200); expect(conexao.detalhes).toEqual([
      { dispositivo_id: 7, tipo_objeto: 'users', objeto_id: 12, resultado: 'TENTATIVA' },
      { dispositivo_id: 7, tipo_objeto: 'users', objeto_id: 12, resultado: 'SUCESSO', alteracoes: 1 }]);
  });
  it('registra falha remota e nunca responde sucesso', async () => {
    const conexao = conexaoAuditoria(); vi.spyOn(db, 'getConnection').mockResolvedValue(conexao);
    vi.spyOn(deviceService, 'gerarBackupCompletoCatraca').mockResolvedValue({ filePath: 'backup' });
    vi.spyOn(deviceService, 'gerarBackupLogsCatraca').mockResolvedValue({ filePath: 'logs' });
    vi.spyOn(deviceService, 'zerarTudoNaCatraca').mockResolvedValue({ ok: false, message: 'indisponivel' }); const res = resposta();
    await controller.zerarTudo({ params: { id: '7' }, body: { confirmacao: 'APAGAR TUDO' }, user: { usuario_id: 21 } }, res);
    expect(res.statusCode).toBe(502); expect(conexao.detalhes.map(({ resultado }) => resultado)).toEqual(['TENTATIVA', 'FALHA']);
  });
  it('recusa zeragem total e por tipo sem backup e não chama o remoto', async () => {
    const remotoTotal = vi.spyOn(deviceService, 'zerarTudoNaCatraca');
    const semConfirmacao = resposta(); await controller.zerarTudo({ params: { id: '7' }, body: {}, user: { usuario_id: 21 } }, semConfirmacao); expect(semConfirmacao.statusCode).toBe(403);
    vi.spyOn(deviceService, 'gerarBackupCompletoCatraca').mockRejectedValue(new Error('backup incompleto'));
    const total = resposta(); await controller.zerarTudo({ params: { id: '7' }, body: { confirmacao: 'APAGAR TUDO' }, user: { usuario_id: 21 } }, total);
    expect(total.statusCode).toBe(500); expect(remotoTotal).not.toHaveBeenCalled(); vi.restoreAllMocks();
    vi.spyOn(db, 'query').mockResolvedValue([[dispositivo]]); const remotoTipo = vi.spyOn(deviceService, 'zerarPorTipo');
    vi.spyOn(deviceService, 'backupPorTipo').mockRejectedValue(new Error('backup falhou')); const tipo = resposta();
    await controller.zerarPorTipo({ params: { id: '7', objectType: 'users' }, user: { usuario_id: 21 } }, tipo);
    expect(tipo.statusCode).toBe(500); expect(remotoTipo).not.toHaveBeenCalled();
  });
  it('exige confirmacao e backup verificado antes de comecar do zero', async () => {
    const remoto = vi.spyOn(deviceService, 'zerarTudoNaCatraca'); const resSemConfirmacao = resposta();
    await controller.comecarDoZero({ params: { id: '7' }, body: {}, user: { usuario_id: 21 } }, resSemConfirmacao);
    expect(resSemConfirmacao.statusCode).toBe(403); vi.spyOn(backupBanco, 'gerarBackup').mockResolvedValue({ caminho: 'backup.sql' });
    vi.spyOn(backupBanco, 'verificarBackup').mockResolvedValue({ ok: false }); const resSemBackup = resposta();
    await controller.comecarDoZero({ params: { id: '7' }, body: { confirmacao: 'APAGAR TUDO' }, user: { usuario_id: 21 } }, resSemBackup);
    expect(resSemBackup.statusCode).toBe(502); expect(remoto).not.toHaveBeenCalled();
  });
  it('recusa autor ausente e falha de auditoria antes do efeito remoto', async () => {
    const resSemAutor = resposta(); const remoto = vi.spyOn(deviceService, 'destroyObjectsOnCatraca').mockResolvedValue({ ok: true });
    await controller.deletarObjetoCatraca({ params: { id: '7', objectType: 'users', objectId: '12' } }, resSemAutor);
    expect(resSemAutor.statusCode).toBe(500); expect(remoto).not.toHaveBeenCalled();
    const conexao = conexaoAuditoria({ falhar: true }); vi.spyOn(db, 'getConnection').mockResolvedValue(conexao); const resFalhaAuditoria = resposta();
    vi.spyOn(deviceService, 'backupPorTipo').mockResolvedValue({ filePath: 'backup' });
    await controller.deletarObjetoCatraca({ params: { id: '7', objectType: 'users', objectId: '12' }, user: { usuario_id: 21 } }, resFalhaAuditoria);
    expect(resFalhaAuditoria.statusCode).toBe(500); expect(remoto).not.toHaveBeenCalled();
  });
  it('mantem acao fechada, redacao e inventario permitido', async () => {
    const conexao = conexaoAuditoria(); await expect(auditoria.registrarAuditoria(conexao, {
      autorId: 21, acao: 'CATRACA_APAGADA', entidadeId: 7
    })).rejects.toMatchObject({ code: 'AUDITORIA_ACAO_INVALIDA' });
    await expect(auditoria.registrarAuditoria(conexao, { autorId: 21, acao: auditoria.ACOES.CATRACA_TUDO_ZERADO,
      entidadeId: 7, detalhe: { dispositivo_id: 7, token: 'token-sintetico' }
    })).rejects.toMatchObject({ code: 'AUDITORIA_DETALHE_SENSIVEL' });
    expect(deviceService.OBJETOS_CATRACA_FERRAMENTAS).toContain('access_logs'); const res = resposta();
    await controller.deletarObjetoCatraca({ params: { id: '7', objectType: 'user_images', objectId: '12' }, user: { usuario_id: 21 } }, res);
    expect(res.statusCode).toBe(400);
  });
});
