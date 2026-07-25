const axios = require('axios');
const { createCatracaSimulator } = require('./fakes/controlid');

/**
 * Testes do PRÓPRIO simulador: se estes falharem, os testes de quirk não valem nada.
 * Cobrem login/sessão, CRUD de users/cards/user_groups, paginação e ordenação.
 */

let sim;

async function login() {
  const res = await axios.post(`http://${sim.url}/login.fcgi`, { login: 'admin', password: 'admin' });
  return res.data.session;
}

const post = (endpoint, session, corpo) =>
  axios.post(`http://${sim.url}/${endpoint}?session=${session}`, corpo, {
    headers: { 'Content-Type': 'application/json' }
  });

beforeEach(async () => {
  sim = await createCatracaSimulator({ seed: 42 });
});

afterEach(async () => {
  await sim.stop();
});

describe('simulador Control iD — sessão', () => {
  it('sobe em porta efêmera e expõe url no formato endereco:porta usado por linkCatraca', () => {
    expect(sim.url).toMatch(/^127\.0\.0\.1:\d+$/);
    expect(sim.porta).toBeGreaterThan(0);
    expect(`${sim.dispositivo.endereco}:${sim.dispositivo.porta}`).toBe(sim.url);
  });

  it('login.fcgi devolve um token de sessão', async () => {
    const session = await login();
    expect(typeof session).toBe('string');
    expect(session.length).toBeGreaterThan(0);
  });

  it('requisição sem sessão válida é recusada com HTTP 401', async () => {
    await expect(post('load_objects.fcgi', 'sessao-inexistente', { object: 'users' })).rejects.toMatchObject({
      response: { status: 401 }
    });
  });

  it('sessão expira pelo tempo configurado (sessaoTtlMs)', async () => {
    const curto = await createCatracaSimulator({ sessaoTtlMs: 20 });
    const res = await axios.post(`http://${curto.url}/login.fcgi`, { login: 'a', password: 'b' });
    const session = res.data.session;
    await new Promise((r) => setTimeout(r, 40));
    await expect(
      axios.post(`http://${curto.url}/load_objects.fcgi?session=${session}`, { object: 'users' })
    ).rejects.toMatchObject({ response: { status: 401 } });
    await curto.stop();
  });

  it('valida credenciais quando validaCredenciais=true', async () => {
    const estrito = await createCatracaSimulator({ validaCredenciais: true, usuario: 'admin', senha: 'segredo' });
    await expect(
      axios.post(`http://${estrito.url}/login.fcgi`, { login: 'admin', password: 'errado' })
    ).rejects.toMatchObject({ response: { status: 401 } });
    const ok = await axios.post(`http://${estrito.url}/login.fcgi`, { login: 'admin', password: 'segredo' });
    expect(ok.data.session).toBeTruthy();
    await estrito.stop();
  });
});

describe('simulador Control iD — CRUD de users, cards e user_groups', () => {
  it('create_objects cria usuário e devolve ids (formato lido por criarUsuario)', async () => {
    const session = await login();
    const res = await post('create_objects.fcgi', session, {
      object: 'users',
      values: [{ id: 111000001, name: 'Pessoa Teste 1', registration: '' }]
    });
    expect(res.data.ids).toEqual([111000001]);

    const load = await post('load_objects.fcgi', session, { object: 'users' });
    expect(load.data.users).toHaveLength(1);
    expect(load.data.users[0].name).toBe('Pessoa Teste 1');
  });

  it('create_objects recusa usuário com registration nulo (regra do equipamento)', async () => {
    const session = await login();
    await expect(
      post('create_objects.fcgi', session, { object: 'users', values: [{ id: 5, name: 'Pessoa Teste 5' }] })
    ).rejects.toMatchObject({ response: { status: 400 } });
  });

  it('create_objects recusa id duplicado de usuário', async () => {
    const session = await login();
    const valores = { object: 'users', values: [{ id: 111000002, name: 'Pessoa Teste 2', registration: '' }] };
    await post('create_objects.fcgi', session, valores);
    await expect(post('create_objects.fcgi', session, valores)).rejects.toMatchObject({
      response: { status: 400 }
    });
  });

  it('cards são criados com user_id e value, e load_objects filtra por user_id', async () => {
    const session = await login();
    await post('create_objects.fcgi', session, {
      object: 'users',
      values: [{ id: 111000001, name: 'Pessoa Teste 1', registration: '' }]
    });
    await post('create_objects.fcgi', session, {
      object: 'cards',
      values: [{ user_id: 111000001, value: 12345678 }]
    });
    await post('create_objects.fcgi', session, {
      object: 'cards',
      values: [{ user_id: 111000001, value: 123456789 }]
    });

    const res = await post('load_objects.fcgi', session, {
      object: 'cards',
      where: { cards: { user_id: 111000001 } }
    });
    expect(res.data.cards).toHaveLength(2);
    // obterCartaoPorTipo separa QRCODE (8 dígitos) de RFID (9+ dígitos) pelo value
    const qrcode = res.data.cards.filter((c) => /^\d{8}$/.test(String(c.value)));
    const rfid = res.data.cards.filter((c) => /^\d{9,}$/.test(String(c.value)));
    expect(qrcode).toHaveLength(1);
    expect(rfid).toHaveLength(1);
  });

  it('user_groups vincula usuário ao grupo padrão 1', async () => {
    const session = await login();
    await post('create_objects.fcgi', session, {
      object: 'user_groups',
      values: [{ user_id: 111000001, group_id: 1 }]
    });
    const res = await post('load_objects.fcgi', session, { object: 'user_groups' });
    expect(res.data.user_groups).toEqual([expect.objectContaining({ user_id: 111000001, group_id: 1 })]);
  });

  it('destroy_objects de users remove em cascata cards e user_groups', async () => {
    const session = await login();
    await post('create_objects.fcgi', session, {
      object: 'users',
      values: [{ id: 111000001, name: 'Pessoa Teste 1', registration: '' }]
    });
    await post('create_objects.fcgi', session, { object: 'cards', values: [{ user_id: 111000001, value: 12345678 }] });
    await post('create_objects.fcgi', session, {
      object: 'user_groups',
      values: [{ user_id: 111000001, group_id: 1 }]
    });

    const del = await post('destroy_objects.fcgi', session, {
      object: 'users',
      where: { users: { id: 111000001 } }
    });
    expect(del.data.changes).toBe(1);

    const cards = await post('load_objects.fcgi', session, { object: 'cards' });
    const grupos = await post('load_objects.fcgi', session, { object: 'user_groups' });
    expect(cards.data.cards).toHaveLength(0);
    expect(grupos.data.user_groups).toHaveLength(0);
  });

  it('destroy_objects aceita where no formato array (firmware antigo)', async () => {
    const session = await login();
    sim.seedAccessLogs(10, { idInicial: 1 });
    const res = await post('destroy_objects.fcgi', session, {
      object: 'access_logs',
      where: [{ object: 'access_logs', field: 'id', operator: '>=', value: 0 }]
    });
    expect(res.data.changes).toBe(10);
    expect(sim.store.tabela('access_logs')).toHaveLength(0);
  });

  it('load_objects respeita columns (projeção usada por limparUsuariosPorPrefixo11)', async () => {
    const session = await login();
    await post('create_objects.fcgi', session, {
      object: 'users',
      values: [{ id: 110000001, name: 'Pessoa Teste 1', registration: '' }]
    });
    const res = await post('load_objects.fcgi', session, { object: 'users', columns: ['id'] });
    expect(res.data.users).toEqual([{ id: 110000001 }]);
  });
});

describe('simulador Control iD — paginação e ordenação de load_objects', () => {
  beforeEach(() => {
    sim.seedAccessLogs(100, { idInicial: 1 });
  });

  it('limit e offset paginam access_logs', async () => {
    const session = await login();
    const pagina1 = await post('load_objects.fcgi', session, { object: 'access_logs', limit: 10, offset: 0 });
    const pagina2 = await post('load_objects.fcgi', session, { object: 'access_logs', limit: 10, offset: 10 });
    expect(pagina1.data.access_logs).toHaveLength(10);
    expect(pagina2.data.access_logs).toHaveLength(10);
    expect(pagina1.data.access_logs[0].id).not.toBe(pagina2.data.access_logs[0].id);
  });

  it('paginação em chunks percorre a lista inteira sem repetir nem perder registros', async () => {
    const session = await login();
    const vistos = new Set();
    let offset = 0;
    const chunk = 30;
    while (true) {
      const res = await post('load_objects.fcgi', session, { object: 'access_logs', limit: chunk, offset });
      const logs = res.data.access_logs;
      logs.forEach((l) => vistos.add(l.id));
      if (logs.length < chunk) break;
      offset += chunk;
    }
    expect(vistos.size).toBe(100);
  });

  it("order ['descending','id'] devolve o maior id primeiro", async () => {
    const session = await login();
    const res = await post('load_objects.fcgi', session, {
      object: 'access_logs',
      limit: 5,
      offset: 0,
      order: ['descending', 'id']
    });
    const ids = res.data.access_logs.map((l) => l.id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    expect(ids[0]).toBe(Math.max(...sim.store.tabela('access_logs').map((l) => l.id)));
  });

  it("order ['ascending','id'] devolve o menor id primeiro", async () => {
    const session = await login();
    const res = await post('load_objects.fcgi', session, {
      object: 'access_logs',
      limit: 5,
      order: ['ascending', 'id']
    });
    const ids = res.data.access_logs.map((l) => l.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });
});

describe('simulador Control iD — Monitor (set_configuration e push)', () => {
  it('set_configuration guarda a configuração do Monitor enviada pela produção', async () => {
    const session = await login();
    await post('set_configuration.fcgi', session, {
      monitor: { request_timeout: '5000', hostname: '192.168.0.64', port: '3000', path: 'api/notifications/dao' }
    });
    expect(sim.monitorConfig).toEqual({
      request_timeout: '5000',
      hostname: '192.168.0.64',
      port: '3000',
      path: 'api/notifications/dao'
    });
  });
});

describe('gerador determinístico de access_logs', () => {
  it('a mesma seed produz exatamente o mesmo dataset', async () => {
    const a = await createCatracaSimulator({ seed: 7 });
    const b = await createCatracaSimulator({ seed: 7 });
    const logsA = a.seedAccessLogs(500, { idInicial: 6169 });
    const logsB = b.seedAccessLogs(500, { idInicial: 6169 });
    expect(logsA).toEqual(logsB);
    await a.stop();
    await b.stop();
  });

  it('seeds diferentes produzem datasets diferentes', async () => {
    const a = await createCatracaSimulator({ seed: 7 });
    const b = await createCatracaSimulator({ seed: 8 });
    expect(a.seedAccessLogs(100, { idInicial: 1 })).not.toEqual(b.seedAccessLogs(100, { idInicial: 1 }));
    await a.stop();
    await b.stop();
  });

  it('gera os 48.057 logs do caso real com ids crescentes e time crescente', () => {
    const logs = sim.seedAccessLogs(48057, { idInicial: 6169 });
    expect(logs).toHaveLength(48057);
    expect(logs[0].id).toBe(6169);
    for (let i = 1; i < logs.length; i += 997) {
      expect(logs[i].id).toBeGreaterThan(logs[i - 1].id);
      expect(logs[i].time).toBeGreaterThan(logs[i - 1].time);
    }
  });
});
