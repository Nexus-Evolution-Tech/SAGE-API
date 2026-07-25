const http = require('http');
const axios = require('axios');
const { createCatracaSimulator } = require('./fakes/controlid');

/**
 * Modos de falha injetáveis do simulador.
 * Sem estes, todo teste de sincronização é teste de caminho feliz — e o caminho feliz
 * nunca foi o problema da integração com a Control iD.
 */

let sim;

const login = () => axios.post(`http://${sim.url}/login.fcgi`, { login: 'admin', password: 'admin' }).then((r) => r.data.session);

const post = (endpoint, session, corpo, opcoes = {}) =>
  axios.post(`http://${sim.url}/${endpoint}?session=${session}`, corpo, {
    headers: { 'Content-Type': 'application/json' },
    ...opcoes
  });

beforeEach(async () => {
  sim = await createCatracaSimulator();
});

afterEach(async () => {
  await sim.stop();
});

describe('modo de falha: offline', () => {
  it('derruba a conexão sem responder — o cliente recebe erro de rede, sem response', async () => {
    const session = await login();
    sim.setFailureMode('offline');
    let capturado = null;
    try {
      await post('load_objects.fcgi', session, { object: 'users' });
    } catch (err) {
      capturado = err;
    }
    expect(capturado).toBeTruthy();
    expect(capturado.response).toBeUndefined();
  });

  it('voltar para failureMode null restabelece a catraca', async () => {
    const session = await login();
    sim.setFailureMode('offline', { vezes: 1 });
    await expect(post('load_objects.fcgi', session, { object: 'users' })).rejects.toBeTruthy();
    const res = await post('load_objects.fcgi', session, { object: 'users' });
    expect(res.status).toBe(200);
  });
});

describe('modo de falha: timeout', () => {
  it('nunca responde: o cliente estoura o próprio timeout', async () => {
    const session = await login();
    sim.setFailureMode('timeout');
    await expect(
      post('load_objects.fcgi', session, { object: 'access_logs' }, { timeout: 200 })
    ).rejects.toMatchObject({ code: 'ECONNABORTED' });
  });
});

describe('modo de falha: sessaoExpirada (no meio de uma sequência de operações)', () => {
  it('a primeira operação passa e a seguinte devolve 401 — a sessão morre no meio do lote', async () => {
    const session = await login();
    sim.setFailureMode('sessaoExpirada', { aposOperacoes: 2 });

    const primeira = await post('create_objects.fcgi', session, {
      object: 'users',
      values: [{ id: 111000001, name: 'Pessoa Teste 1', registration: '' }]
    });
    expect(primeira.status).toBe(200);

    await expect(
      post('create_objects.fcgi', session, {
        object: 'cards',
        values: [{ user_id: 111000001, value: 12345678 }]
      })
    ).rejects.toMatchObject({ response: { status: 401 } });

    // Estado parcial: usuário criado, cartão não. É este meio-caminho que a produção precisa tolerar.
    expect(sim.store.tabela('users')).toHaveLength(1);
    expect(sim.store.tabela('cards')).toHaveLength(0);
  });

  it('um novo login gera sessão válida e a operação recomeça', async () => {
    const session = await login();
    sim.setFailureMode('sessaoExpirada', { aposOperacoes: 1 });
    await expect(post('load_objects.fcgi', session, { object: 'users' })).rejects.toMatchObject({
      response: { status: 401 }
    });
    sim.setFailureMode(null);
    const novaSessao = await login();
    const res = await post('load_objects.fcgi', novaSessao, { object: 'users' });
    expect(res.status).toBe(200);
  });
});

describe('modo de falha: respostaParcial (JSON truncado)', () => {
  it('o corpo chega cortado e o cliente falha ao ler a resposta', async () => {
    sim.seedAccessLogs(50, { idInicial: 1 });
    const session = await login();
    sim.setFailureMode('respostaParcial');
    let capturado = null;
    try {
      await post('load_objects.fcgi', session, { object: 'access_logs' });
    } catch (err) {
      capturado = err;
    }
    expect(capturado).toBeTruthy();
    // Não há resposta utilizável: nem JSON válido, nem status aproveitável.
    expect(capturado.response?.data).not.toEqual(expect.objectContaining({ access_logs: expect.anything() }));
  });
});

describe('modo de falha: perdeRespostaAposProcessar (prova de idempotência)', () => {
  it('a catraca PROCESSA a requisição e some: o cliente vê erro, mas o efeito já aconteceu', async () => {
    const session = await login();
    sim.setFailureMode('perdeRespostaAposProcessar', { vezes: 1 });

    await expect(
      post('create_objects.fcgi', session, {
        object: 'users',
        values: [{ id: 111000001, name: 'Pessoa Teste 1', registration: '' }]
      })
    ).rejects.toBeTruthy();

    // O usuário ESTÁ na catraca, apesar do erro visto pelo cliente.
    expect(sim.store.tabela('users')).toHaveLength(1);
    expect(sim.store.tabela('users')[0].id).toBe(111000001);
    expect(sim.contarRequisicoes('/create_objects.fcgi')).toBe(1);
  });

  it('a retentativa ingênua do MESMO create falha com "já existe" — é isto que exige idempotência', async () => {
    const session = await login();
    sim.setFailureMode('perdeRespostaAposProcessar', { vezes: 1 });
    const payload = {
      object: 'users',
      values: [{ id: 111000001, name: 'Pessoa Teste 1', registration: '' }]
    };

    await expect(post('create_objects.fcgi', session, payload)).rejects.toBeTruthy();
    await expect(post('create_objects.fcgi', session, payload)).rejects.toMatchObject({
      response: { status: 400, data: { error: expect.anything() } }
    });
    expect(sim.store.tabela('users')).toHaveLength(1);
  });

  it('um destroy retentado é naturalmente idempotente (changes=0 na segunda vez)', async () => {
    const session = await login();
    await post('create_objects.fcgi', session, {
      object: 'users',
      values: [{ id: 111000001, name: 'Pessoa Teste 1', registration: '' }]
    });
    sim.setFailureMode('perdeRespostaAposProcessar', { vezes: 1 });
    const where = { users: { id: 111000001 } };

    await expect(post('destroy_objects.fcgi', session, { object: 'users', where })).rejects.toBeTruthy();
    const segunda = await post('destroy_objects.fcgi', session, { object: 'users', where });
    expect(segunda.data.changes).toBe(0);
    expect(sim.store.tabela('users')).toHaveLength(0);
  });
});

describe('modo de falha: lentidao (ms configurável)', () => {
  it('atrasa a resposta pelo tempo pedido, sem falhar', async () => {
    const session = await login();
    sim.setFailureMode('lentidao', { ms: 300 });
    const inicio = Date.now();
    const res = await post('load_objects.fcgi', session, { object: 'users' });
    expect(Date.now() - inicio).toBeGreaterThanOrEqual(290);
    expect(res.status).toBe(200);
  });
});

describe('modo de falha: perdeEventoPush', () => {
  /** Servidor que faz o papel do POST /api/notifications/dao da SAGE-API. */
  async function subirCallback(recebidos) {
    const servidor = http.createServer((req, res) => {
      const partes = [];
      req.on('data', (c) => partes.push(c));
      req.on('end', () => {
        recebidos.push(JSON.parse(Buffer.concat(partes).toString('utf8')));
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': 2 });
        res.end('{}');
      });
    });
    await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
    return { servidor, porta: servidor.address().port };
  }

  it('o evento push chega no callback configurado quando não há falha', async () => {
    const recebidos = [];
    const { servidor, porta } = await subirCallback(recebidos);
    const session = await login();
    await post('set_configuration.fcgi', session, {
      monitor: { request_timeout: '5000', hostname: '127.0.0.1', port: String(porta), path: 'api/notifications/dao' }
    });

    const resultado = await sim.emitirEventoPush({
      id: 1,
      time: Math.floor(Date.now() / 1000),
      user_id: 111000001,
      portal_id: 1,
      card_value: '12345678'
    });
    expect(resultado.enviado).toBe(true);
    expect(recebidos).toHaveLength(1);
    expect(recebidos[0]).toMatchObject({
      device_id: 1,
      object_changes: [{ object: 'access_logs', type: 'inserted' }]
    });
    await new Promise((r) => servidor.close(r));
  });

  it('com perdeEventoPush o evento NUNCA chega ao servidor — só o polling recupera o acesso', async () => {
    const recebidos = [];
    const { servidor, porta } = await subirCallback(recebidos);
    const session = await login();
    await post('set_configuration.fcgi', session, {
      monitor: { request_timeout: '5000', hostname: '127.0.0.1', port: String(porta), path: 'api/notifications/dao' }
    });

    sim.setFailureMode('perdeEventoPush');
    const resultado = await sim.emitirEventoPush({
      id: 2,
      time: Math.floor(Date.now() / 1000),
      user_id: 111000002,
      portal_id: 1,
      card_value: '12345678'
    });
    expect(resultado).toEqual({ enviado: false, motivo: 'perdeEventoPush' });
    expect(recebidos).toHaveLength(0);
    // O simulador guarda o que foi perdido para o teste poder afirmar o que ficou faltando.
    expect(sim.eventosPushPerdidos).toHaveLength(1);
    expect(sim.eventosPushPerdidos[0].object_changes[0].values.user_id).toBe(111000002);
    await new Promise((r) => servidor.close(r));
  });
});
