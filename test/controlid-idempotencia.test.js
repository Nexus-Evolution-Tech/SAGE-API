const axios = require('axios');
const { createCatracaSimulator } = require('./fakes/controlid');
const {
  criarUsuario,
  criarCartao,
  criarGrupo
} = require('../src/utils/controlId-utils');

const pessoa = { id: 1, nome: 'Pessoa Teste 1' };
const dispositivo = { nome: 'Catraca Simulada' };

async function login(sim) {
  const resposta = await axios.post(`http://${sim.url}/login.fcgi`, {
    login: 'admin',
    password: 'admin'
  });
  return resposta.data.session;
}

describe('escritas de provisionamento da Control iD', () => {
  let sim;

  beforeEach(async () => {
    sim = await createCatracaSimulator();
  });

  afterEach(async () => {
    await sim.stop();
  });

  it('usa create_or_update_objects nos três fluxos de provisionamento', async () => {
    const session = await login(sim);
    const resultados = [];

    await criarUsuario(111000001, pessoa, sim.url, session, dispositivo, resultados);
    await criarCartao(111000001, 123456789, sim.url, session, dispositivo, resultados);
    await criarGrupo(111000001, sim.url, session, dispositivo, resultados);

    expect(sim.requisicoes.filter((requisicao) => requisicao.object).map((requisicao) => [
      requisicao.endpoint,
      requisicao.object
    ])).toEqual([
      ['/create_or_update_objects.fcgi', 'users'],
      ['/create_or_update_objects.fcgi', 'cards'],
      ['/create_or_update_objects.fcgi', 'user_groups']
    ]);
  });

  it('permite retentar usuário depois de perder a resposta após o processamento', async () => {
    const session = await login(sim);
    sim.setFailureMode('perdeRespostaAposProcessar', { vezes: 1 });
    const resultados = [];

    await expect(
      criarUsuario(111000001, pessoa, sim.url, session, dispositivo, resultados)
    ).rejects.toBeTruthy();

    await expect(
      criarUsuario(111000001, pessoa, sim.url, session, dispositivo, resultados)
    ).resolves.toBeUndefined();

    expect(sim.store.tabela('users')).toHaveLength(1);
    expect(sim.store.tabela('users')[0]).toEqual(expect.objectContaining({
      id: 111000001,
      name: 'Pessoa Teste 1'
    }));
    expect(sim.contarRequisicoes('/create_or_update_objects.fcgi')).toBe(2);
  });
});
