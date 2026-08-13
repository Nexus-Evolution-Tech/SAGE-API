const noopLogger = { debug() {}, info() {}, warn() {}, error() {}, errorWithStack() {} };
async function comModulosFalsos(falsos, alvo, executar) {
  const restaurar = falsos.map(([modulo, exports]) => {
    const resolvido = require.resolve(modulo), anterior = require.cache[resolvido];
    require.cache[resolvido] = { id: resolvido, filename: resolvido, loaded: true, exports };
    return () => anterior ? require.cache[resolvido] = anterior : delete require.cache[resolvido];
  });
  const resolvido = require.resolve(alvo), anterior = require.cache[resolvido];
  delete require.cache[resolvido];
  try { return await executar(require(alvo)); } finally {
    if (anterior) require.cache[resolvido] = anterior; else delete require.cache[resolvido];
    restaurar.reverse().forEach((fn) => fn());
  }
}
function configJobs() {
  return { config: { jobs: { catracaSyncEnabled: true, syncCheckInterval: '* * * * *', syncBatchSize: 50,
    monitorPollingIntervalMs: 20000, healthCheckIntervalMs: 60000, promocaoCron: 'false', backupCron: 'false' } } };
}
describe('R0-04 — falhas parciais não são sucesso', () => {
  it('A-012: não confirma acesso quando a derivação de presença falha', async () => {
    let commits = 0; let rollbacks = 0; let liberadas = 0;
    const db = { query: vi.fn(async (sql) => {
      if (sql.includes('control_id_device_id')) return [[{ id: 7, nome: 'D1' }]];
      if (sql.includes('FROM Pessoa WHERE id IN')) return [[{ id: 1, nome: 'P1' }]];
      if (sql.includes('FROM Pessoa WHERE id =')) return [[{ id: 1, nome: 'P1' }]];
      if (sql.includes('FROM Acesso WHERE pessoa_id')) return [[]];
      if (sql.includes('LAST_INSERT_ID')) return [[{ id: 1, permitido: true }]];
      if (sql.includes('INSERT INTO Acesso')) return [{ insertId: 1 }];
      throw new Error(`consulta inesperada: ${sql}`);
    }) };
    db.getConnection = async () => ({ query: db.query, beginTransaction: async () => {},
      commit: async () => { commits++; }, rollback: async () => { rollbacks++; }, release: () => { liberadas++; } });
    await comModulosFalsos([
      ['../src/config/database', db], ['../src/services/presenceService', async () => { throw new Error('presença falhou'); }],
      ['../src/services/deviceService', { linkCatraca: () => 'http://fake', obterSessao: async () => ({}),
        obterLogsCatraca: async () => [{ id: 13, time: Math.floor(Date.now() / 1000), user_id: 111000001, portal_id: 1, card_value: '12345678' }] }],
      ['../src/config/logger', noopLogger]
    ], '../src/services/accessService', async (service) => {
      const resultado = await service.processarNotificacaoMonitorDao({ device_id: 77,
        object_changes: [{ object: 'access_logs', type: 'inserted', values: { id: 12,
          time: Math.floor(Date.now() / 1000), user_id: 111000001, portal_id: 1, card_value: '12345678' } }] });
      expect(resultado).toMatchObject({ processados: 0, erros: ['presença falhou'] });
      await expect(service.sincronizarAcessos({ id: 7, nome: 'D1', sync_enabled: 1 }, { monitorOnly: true })).rejects.toThrow('presença falhou');
      await expect(service.criarAcesso({ pessoa_id: 1, dispositivo_id: 7, status: 'ENTRADA', metodo_auth: 'QR_CODE' })).rejects.toThrow('presença falhou');
      expect({ commits, rollbacks, liberadas }).toEqual({ commits: 0, rollbacks: 3, liberadas: 3 });
    });
  });
  it('A-014: propaga a falha ao registrar a outbox', async () => {
    await comModulosFalsos([['../src/config/database', { execute: vi.fn() }],
      ['../src/services/deviceService', { listarTodos: async () => { throw new Error('banco indisponível'); } }],
      ['../src/config/logger', noopLogger]], '../src/services/sync', async (registrar) => {
      await expect(registrar(1, 'UPDATE')).rejects.toThrow('banco indisponível');
    });
  });
  it('B-003: update parcial retorna falha para preservar a pendência', async () => {
    await comModulosFalsos([
      ['../src/services/deviceService', { listarTodos: async () => [{ id: 1, nome: 'D1', sync_enabled: 1 }],
        obterSessao: async () => ({}), linkCatraca: () => 'http://fake' }],
      ['../src/utils/controlId-utils', { editarUsuario: async () => { throw new Error('remoto falhou'); } }],
      ['../src/config/logger', noopLogger]
    ], '../src/services/controlIdService', async (service) => {
      await expect(service.editarPessoaNasCatracas(1, 'P1', null, '12345678', { dispositivoId: 1 }))
        .resolves.toEqual([expect.objectContaining({ sucesso: false })]);
    });
  });
  it('B-004: delete remoto sem confirmação não remove a pendência', async () => {
    let removidos = 0; let exclusoesRemotas = 0; const pendente = { id: 1, pessoa_id: 1, dispositivo_id: 1, operation: 'DELETE' };
    const db = { query: vi.fn(async (sql) => {
      if (sql.includes('DELETE FROM sync_pendente')) { removidos++; return [{}]; }
      if (sql.includes('FROM sync_pendente')) return [[pendente]];
      if (sql.includes('FROM Dispositivo')) return [[{ id: 1, nome: 'D1', sync_enabled: 1 }]];
      if (sql.includes('FROM Pessoa')) return [[]];
      return [{}];
    }) };
    await comModulosFalsos([
      ['../src/services/deviceService', { testarConexaoCatraca: async () => true,
        listarTodos: async () => [{ id: 1, nome: 'D1', sync_enabled: 1 }], obterSessao: async () => ({}), linkCatraca: () => 'http://fake' }],
      ['../src/utils/controlId-utils', { deletarUsuario: async () => { exclusoesRemotas++; return false; } }],
      ['../src/utils/photo-user-utils', { verificaSeFotoUserExiste: async () => false, deletarFotoUserPorId: async () => {} }],
      ['../src/config/logger', noopLogger]
    ], '../src/services/controlIdService', async () => {
      await comModulosFalsos([['node-cron', { schedule: (_cron, executar) => ({ execute: executar, stop() {} }) }],
        ['../src/config/env', configJobs()], ['../src/config/database', db], ['../src/config/logger', noopLogger]
      ], '../src/jobs/scheduledJobs', async (jobs) => {
        await jobs.verificarSyncPendentesJob().execute();
        expect(exclusoesRemotas).toBe(1); expect(removidos).toBe(0);
      });
    });
  });
  it('B-005: pendências offline não impedem o dispositivo seguinte no lote', async () => {
    const processados = []; let rodada = 0;
    const offline = { id: 1, pessoa_id: 1, dispositivo_id: 1, operation: 'CREATE' },
      online = { id: 2, pessoa_id: 2, dispositivo_id: 2, operation: 'CREATE' };
    const db = { query: vi.fn(async (sql, valores = []) => {
      if (sql.includes('FROM sync_pendente')) return sql.includes('ORDER BY last_attempt') && ++rodada > 1
        ? [[online]] : [Array.from({ length: 50 }, () => offline)];
      const id = Array.isArray(valores[0]) ? valores[0][0] : valores[0];
      if (sql.includes('FROM Dispositivo')) return [[{ id, nome: `D${id}`, sync_enabled: 1 }]];
      if (sql.includes('FROM Pessoa')) return [[{ id, nome: `P${id}` }]];
      return [{}];
    }) };
    await comModulosFalsos([
      ['node-cron', { schedule: (_cron, executar) => ({ execute: executar, stop() {} }) }], ['../src/config/env', configJobs()],
      ['../src/config/database', db], ['../src/services/deviceService', { testarConexaoCatraca: async (d) => d.id === 2 }],
      ['../src/services/controlIdService', { criarNovaPessoaNasCatracas: async (_p, opt) => { processados.push(opt.dispositivoId); return [{ sucesso: true }]; } }],
      ['../src/config/logger', noopLogger]
    ], '../src/jobs/scheduledJobs', async (jobs) => {
      const job = jobs.verificarSyncPendentesJob(); await job.execute(); await job.execute();
      expect(processados).toEqual([2]);
    });
  });
  it('C-007: callback parcial ou total responde fora de 2xx', async () => {
    const processar = vi.fn().mockResolvedValueOnce({ processados: 1, ignorados: 0, erros: ['falha parcial'] })
      .mockRejectedValueOnce(new Error('falha total'));
    await comModulosFalsos([['../src/services/accessService', { processarNotificacaoMonitorDao: processar }],
      ['../src/config/logger', noopLogger]], '../src/routes/notificationRoutes', async (router) => {
      const handler = router.stack.find((layer) => layer.route?.path === '/api/notifications/dao').route.stack.at(-1).handle;
      for (const resposta of [{ status: vi.fn().mockReturnThis(), json: vi.fn() }, { status: vi.fn().mockReturnThis(), json: vi.fn() }]) {
        await handler({ body: {}, query: {}, headers: {} }, resposta);
        expect(resposta.status.mock.calls[0][0]).toBeGreaterThanOrEqual(400);
      }
    });
  });
});
