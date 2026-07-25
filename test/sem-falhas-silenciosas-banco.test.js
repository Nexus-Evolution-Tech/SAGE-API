/**
 * Fase 2 — RNF-4, continuação: falha de BANCO também não pode virar "vazio".
 *
 * `deviceService.listarTodos()` tinha `catch { return [] }`. Se a consulta ao banco falhasse
 * (conexão caiu, pool esgotado, tabela travada), o sistema enxergava **"nenhuma catraca
 * cadastrada"** e simplesmente não fazia nada — sem erro, sem alerta, sem sincronizar ninguém.
 *
 * É pior que a falha de rede da catraca: aqui o sistema inteiro vira um no-op silencioso. Numa
 * escola isso significa um dia inteiro sem registrar acesso, descoberto só quando alguém for
 * procurar o relatório de frequência.
 */
const deviceService = require('../src/services/deviceService');

describe('RNF-4 — falha de banco não pode virar "nenhum dispositivo"', () => {
  let dbOriginal;

  beforeEach(() => {
    dbOriginal = global.db;
  });

  afterEach(() => {
    global.db = dbOriginal;
  });

  it('erro do banco LANÇA, em vez de devolver lista vazia', async () => {
    global.db = () => ({
      select: () => ({
        get: async () => {
          throw new Error('ECONNREFUSED: conexão com o banco recusada');
        }
      })
    });

    await expect(deviceService.listarTodos()).rejects.toThrow(/banco|ECONNREFUSED/i);
  });

  it('banco sem dispositivos cadastrados devolve lista vazia (e isso é sucesso legítimo)', async () => {
    global.db = () => ({ select: () => ({ get: async () => [] }) });

    const dispositivos = await deviceService.listarTodos();

    expect(dispositivos).toEqual([]);
  });

  it('dispositivos cadastrados são devolvidos normalmente', async () => {
    global.db = () => ({
      select: () => ({ get: async () => [{ id: 1, nome: 'Catraca Teste' }] })
    });

    const dispositivos = await deviceService.listarTodos();

    expect(dispositivos).toHaveLength(1);
    expect(dispositivos[0].nome).toBe('Catraca Teste');
  });
});
