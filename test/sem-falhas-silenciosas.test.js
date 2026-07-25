/**
 * Fase 2 — RNF-4: nenhuma falha silenciosa.
 *
 * O sistema não pode reportar sucesso quando falhou. Em particular, **falha de rede não pode ser
 * indistinguível de "nada novo"**.
 *
 * Antes desta correção, `deviceService.obterLogsCatraca` tinha `catch { return [] }`. Uma catraca
 * offline, um timeout ou uma sessão expirada produziam exatamente o mesmo resultado que uma
 * catraca saudável sem acessos novos: lista vazia. O sistema seguia adiante "com sucesso" enquanto
 * perdia dados, e ninguém tinha como saber.
 *
 * Este padrão é, provavelmente, a maior fonte isolada de desconfiança no software — e é o motivo
 * de a Fase 2 existir.
 *
 * Contrato novo:
 *   - lista vazia significa, sem ambiguidade, "a catraca respondeu e não há logs novos";
 *   - falha lança `ErroDispositivo`, com `dispositivoAlcancavel` para o chamador distinguir
 *     "não deu para falar com o equipamento" de "o equipamento recusou".
 */
const axios = require('axios');
const { createCatracaSimulator } = require('./fakes/controlid');
const { obterLogsCatraca, ErroDispositivo } = require('../src/services/deviceService');

/** Obtém sessão pelo caminho real (login.fcgi), como a produção faz. */
async function comSessao(sim) {
  const res = await axios.post(`http://${sim.url}/login.fcgi`, { login: 'admin', password: 'admin' });
  return res.data.session;
}

describe('RNF-4 — falha de dispositivo nunca vira lista vazia', () => {
  let sim;

  afterEach(async () => {
    if (sim) await sim.stop().catch(() => {});
    sim = null;
  });

  it('catraca saudável sem logs novos devolve lista vazia (e isso é sucesso)', async () => {
    sim = await createCatracaSimulator({ seed: 42 });
    const sessao = await comSessao(sim);

    const logs = await obterLogsCatraca(sessao, sim.url, 0, {});

    expect(Array.isArray(logs)).toBe(true);
    expect(logs).toHaveLength(0);
  });

  it('catraca offline LANÇA, em vez de devolver lista vazia', async () => {
    sim = await createCatracaSimulator({ seed: 42 });
    const sessao = await comSessao(sim);
    sim.setFailureMode('offline');

    await expect(obterLogsCatraca(sessao, sim.url, 0, {})).rejects.toThrow(ErroDispositivo);
  });

  it('timeout LANÇA, em vez de devolver lista vazia', async () => {
    sim = await createCatracaSimulator({ seed: 42 });
    const sessao = await comSessao(sim);
    sim.setFailureMode('lentidao', { ms: 500 });

    const anterior = process.env.CATRACA_LOAD_LOGS_TIMEOUT;
    process.env.CATRACA_LOAD_LOGS_TIMEOUT = '100';
    try {
      await expect(obterLogsCatraca(sessao, sim.url, 0, {})).rejects.toThrow(ErroDispositivo);
    } finally {
      if (anterior === undefined) delete process.env.CATRACA_LOAD_LOGS_TIMEOUT;
      else process.env.CATRACA_LOAD_LOGS_TIMEOUT = anterior;
    }
  });

  it('o erro diz se o equipamento estava alcançável — para o chamador decidir retry', async () => {
    sim = await createCatracaSimulator({ seed: 42 });
    const sessao = await comSessao(sim);
    sim.setFailureMode('offline');

    await obterLogsCatraca(sessao, sim.url, 0, {}).then(
      () => { throw new Error('deveria ter lançado'); },
      (erro) => {
        expect(erro).toBeInstanceOf(ErroDispositivo);
        expect(erro.dispositivoAlcancavel).toBe(false);
        expect(String(erro.message)).toMatch(/logs/i);
      }
    );
  });

  it('logs de verdade continuam sendo devolvidos normalmente', async () => {
    sim = await createCatracaSimulator({ seed: 42 });
    sim.seedAccessLogs(25);
    const sessao = await comSessao(sim);

    const logs = await obterLogsCatraca(sessao, sim.url, 0, {});

    expect(logs.length).toBe(25);
  });
});
