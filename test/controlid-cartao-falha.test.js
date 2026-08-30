const axios = require('axios');
const { createCatracaSimulator } = require('./fakes/controlid');
const logger = require('../src/config/logger');
const { obterCartaoPorTipo } = require('../src/utils/controlId-utils');

async function login(sim) {
  const resposta = await axios.post(`http://${sim.url}/login.fcgi`, {
    login: 'admin',
    password: 'admin'
  });
  return resposta.data.session;
}

describe('consulta de cartão na Control iD', () => {
  let sim;

  beforeEach(async () => {
    sim = await createCatracaSimulator();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await sim.stop();
  });

  it('propaga falha remota e registra somente contexto técnico seguro', async () => {
    const session = await login(sim);
    const erroLog = vi.spyOn(logger, 'error').mockImplementation(() => {});
    sim.setFailureMode('offline', { vezes: 1 });

    await expect(
      obterCartaoPorTipo(17, 'RFID', session, sim.url)
    ).rejects.toBeTruthy();

    expect(erroLog).toHaveBeenCalledWith(
      '[CATRACA] codigo=CATRACA_CARTAO_CONSULTA_FALHOU',
      { operacao: 'obterCartaoPorTipo', pessoa_id: 17 }
    );
    expect(JSON.stringify(erroLog.mock.calls)).not.toContain('Pessoa Teste');
    expect(JSON.stringify(erroLog.mock.calls)).not.toMatch(/cpf|rg|email|telefone|token|password/i);
  });

  it('retorna null quando a consulta conclui sem cartão', async () => {
    const session = await login(sim);
    const erroLog = vi.spyOn(logger, 'error').mockImplementation(() => {});

    await expect(
      obterCartaoPorTipo(17, 'RFID', session, sim.url)
    ).resolves.toBeNull();
    expect(erroLog).not.toHaveBeenCalled();
  });
});
