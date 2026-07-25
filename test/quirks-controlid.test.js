const axios = require('axios');
const { createCatracaSimulator } = require('./fakes/controlid');
const { PRESETS_FAIXA } = require('./fakes/controlid/geradorLogs');

/**
 * Q1–Q7: comportamentos ESTRANHOS e REAIS da IDBlock antiga.
 *
 * Cada teste aqui é uma trava: se alguém "consertar" o quirk no simulador achando que é bug,
 * o teste correspondente QUEBRA e o nome dele explica por quê.
 * Documentação completa: test/fakes/controlid/README.md
 */

async function comSessao(sim) {
  const res = await axios.post(`http://${sim.url}/login.fcgi`, { login: 'admin', password: 'admin' });
  return res.data.session;
}

const post = (sim, endpoint, session, corpo, opcoes = {}) =>
  axios.post(`http://${sim.url}/${endpoint}?session=${session}`, corpo, {
    headers: { 'Content-Type': 'application/json' },
    ...opcoes
  });

// ───────────────────────────── Q1 ─────────────────────────────

describe('Q1 — modify_objects responde HTTP 400 com corpo VAZIO quando teve SUCESSO', () => {
  let sim;
  beforeEach(async () => {
    sim = await createCatracaSimulator();
  });
  afterEach(async () => {
    await sim.stop();
  });

  it('QUEBRARIA se o simulador passasse a responder 200: a produção depende do 400 vazio (controlId-utils.js:125)', async () => {
    const session = await comSessao(sim);
    await post(sim, 'create_objects.fcgi', session, {
      object: 'users',
      values: [{ id: 111000001, name: 'Pessoa Teste 1', registration: '' }]
    });

    let capturado = null;
    try {
      await post(sim, 'modify_objects.fcgi', session, {
        object: 'users',
        values: { name: 'Pessoa Teste 1 Editada' },
        where: { users: { id: 111000001 } }
      });
      throw new Error('não deveria resolver: o equipamento responde 400 no sucesso');
    } catch (err) {
      capturado = err;
    }

    expect(capturado.response.status).toBe(400);
    // O corpo é VAZIO: é exatamente isso que `status === 400 && !apiError?.error` reconhece como sucesso.
    expect(capturado.response.data).toBe('');
    expect(capturado.response.data?.error).toBeUndefined();

    // E o efeito FOI aplicado, apesar do 400.
    expect(sim.store.tabela('users')[0].name).toBe('Pessoa Teste 1 Editada');
  });

  it('a produção (editarUsuario) trata esse 400 de corpo vazio como sucesso e NÃO lança', async () => {
    const { editarUsuario } = require('../src/utils/controlId-utils');
    const session = await comSessao(sim);
    await post(sim, 'create_objects.fcgi', session, {
      object: 'users',
      values: [{ id: 111000001, name: 'Pessoa Teste 1', registration: '' }]
    });

    const resultados = [];
    await expect(
      editarUsuario(111000001, 'Pessoa Teste 1 Editada', sim.url, session, { nome: 'Catraca Simulada' }, resultados)
    ).resolves.toBeUndefined();
    expect(resultados).toEqual([{ dispositivo: 'Catraca Simulada', sucesso: true }]);
  });

  it('quando o modify falha DE VERDADE o corpo traz `error` — é o que distingue erro de sucesso', async () => {
    const session = await comSessao(sim);
    await expect(
      post(sim, 'modify_objects.fcgi', session, {
        object: 'users',
        values: { name: 'Ninguem' },
        where: { users: { id: 999999999 } }
      })
    ).rejects.toMatchObject({ response: { status: 400, data: { error: expect.anything() } } });
  });

  it('com modifyRetorna400NoSucesso=false o simulador responde 200 — modo só para comparação, NÃO é o equipamento real', async () => {
    sim.setQuirk('modifyRetorna400NoSucesso', false);
    const session = await comSessao(sim);
    await post(sim, 'create_objects.fcgi', session, {
      object: 'users',
      values: [{ id: 111000001, name: 'Pessoa Teste 1', registration: '' }]
    });
    const res = await post(sim, 'modify_objects.fcgi', session, {
      object: 'users',
      values: { name: 'Pessoa Teste 1 Editada' },
      where: { users: { id: 111000001 } }
    });
    expect(res.status).toBe(200);
    expect(res.data.changes).toBe(1);
  });
});

// ───────────────────────────── Q2 ─────────────────────────────

describe('Q2 — catraca sem módulo facial REJEITA user_images', () => {
  it('QUEBRARIA se o simulador aceitasse foto por padrão: é por isso que existe CATRACA_SKIP_USER_IMAGE', async () => {
    const sim = await createCatracaSimulator(); // moduloFacial: false é o PADRÃO (parque instalado é antigo)
    const session = await comSessao(sim);
    expect(sim.quirks.moduloFacial).toBe(false);

    await expect(
      post(sim, 'user_set_image_list.fcgi', session, {
        user_images: [{ user_id: 111000001, image: 'base64ficticio' }]
      })
    ).rejects.toMatchObject({ response: { status: 400 } });

    await expect(
      post(sim, 'create_objects.fcgi', session, {
        object: 'user_images',
        values: [{ user_id: 111000001, image: 'base64ficticio' }]
      })
    ).rejects.toMatchObject({ response: { status: 400 } });

    expect(sim.store.tabela('user_images')).toHaveLength(0);
    await sim.stop();
  });

  it('com moduloFacial=true a mesma chamada é aceita (catraca nova)', async () => {
    const sim = await createCatracaSimulator({ quirks: { moduloFacial: true } });
    const session = await comSessao(sim);
    const res = await post(sim, 'user_set_image_list.fcgi', session, {
      user_images: [{ user_id: 111000001, image: 'base64ficticio' }]
    });
    expect(res.status).toBe(200);
    expect(sim.store.tabela('user_images')).toHaveLength(1);
    await sim.stop();
  });
});

// ───────────────────────────── Q3 ─────────────────────────────

describe('Q3 — load_objects de access_logs devolve TODOS os logs e demora', () => {
  it('QUEBRARIA se o simulador respeitasse `limit`: com ignoraLimitEmAccessLogs a catraca despeja os 48.057', async () => {
    const sim = await createCatracaSimulator({ quirks: { ignoraLimitEmAccessLogs: true } });
    sim.seedAccessLogs(48057, { idInicial: PRESETS_FAIXA.instanciaA.idInicial });
    const session = await comSessao(sim);

    const res = await post(sim, 'load_objects.fcgi', session, {
      object: 'access_logs',
      limit: 200,
      offset: 0,
      order: ['descending', 'id']
    });
    // Pedimos 200; vieram 48.057. É este comportamento que justifica a proteção
    // `maxProcessarMonitor` em accessService.sincronizarAcessos.
    expect(res.data.access_logs).toHaveLength(48057);
    await sim.stop();
  });

  it('a latência de access_logs é observável — justifica CATRACA_LOAD_LOGS_TIMEOUT=60000', async () => {
    const sim = await createCatracaSimulator({ quirks: { latenciaAccessLogsMs: 250 } });
    sim.seedAccessLogs(100, { idInicial: 1 });
    const session = await comSessao(sim);

    const inicio = Date.now();
    await post(sim, 'load_objects.fcgi', session, { object: 'access_logs' });
    expect(Date.now() - inicio).toBeGreaterThanOrEqual(240);

    // A latência é EXCLUSIVA de access_logs: users responde rápido.
    const inicioUsers = Date.now();
    await post(sim, 'load_objects.fcgi', session, { object: 'users' });
    expect(Date.now() - inicioUsers).toBeLessThan(240);
    await sim.stop();
  });

  it('com latência acima do timeout do cliente, obterLogsCatraca degrada para lista vazia (não estoura)', async () => {
    const sim = await createCatracaSimulator({ quirks: { latenciaAccessLogsMs: 800 } });
    sim.seedAccessLogs(50, { idInicial: 1 });
    const session = await comSessao(sim);
    process.env.CATRACA_LOAD_LOGS_TIMEOUT = '150';
    process.env.CATRACA_RETRY_ATTEMPTS = '0';
    const { obterLogsCatraca } = require('../src/services/deviceService');
    const logs = await obterLogsCatraca(session, sim.url, 0, {});
    expect(logs).toEqual([]);
    delete process.env.CATRACA_LOAD_LOGS_TIMEOUT;
    delete process.env.CATRACA_RETRY_ATTEMPTS;
    await sim.stop();
  });
});

// ───────────────────────────── Q4 ─────────────────────────────

describe("Q4 — filtro where { access_logs: { id: { '>': X } } }: DOIS modos, porque o real é desconhecido (B-2)", () => {
  it('modo (a) honorsWhereFilter=true: devolve só os logs com id > X', async () => {
    const sim = await createCatracaSimulator({ quirks: { honorsWhereFilter: true } });
    sim.seedAccessLogs(1000, { idInicial: 1 });
    const session = await comSessao(sim);
    const corte = sim.store.tabela('access_logs')[499].id;

    const res = await post(sim, 'load_objects.fcgi', session, {
      object: 'access_logs',
      where: { access_logs: { id: { '>': corte } } }
    });
    expect(res.data.access_logs.length).toBeLessThan(1000);
    expect(res.data.access_logs.every((l) => l.id > corte)).toBe(true);
    await sim.stop();
  });

  it('modo (b) honorsWhereFilter=false: IGNORA o where em silêncio e devolve TUDO — não é bug do simulador', async () => {
    const sim = await createCatracaSimulator({ quirks: { honorsWhereFilter: false } });
    sim.seedAccessLogs(1000, { idInicial: 1 });
    const session = await comSessao(sim);
    const corte = sim.store.tabela('access_logs')[499].id;

    const res = await post(sim, 'load_objects.fcgi', session, {
      object: 'access_logs',
      where: { access_logs: { id: { '>': corte } } }
    });
    // Nenhum erro, nenhum aviso: só vem tudo. Este é o cenário que derruba a premissa
    // de "reduzir payload com lastLogId" em deviceService.obterLogsCatraca.
    expect(res.data.access_logs).toHaveLength(1000);
    expect(res.data.access_logs.some((l) => l.id <= corte)).toBe(true);
    await sim.stop();
  });

  it('os dois modos existem de propósito: o where só é honrado quando honorsWhereFilter=true', async () => {
    const honra = await createCatracaSimulator({ quirks: { honorsWhereFilter: true } });
    const ignora = await createCatracaSimulator({ quirks: { honorsWhereFilter: false } });
    honra.seedAccessLogs(100, { idInicial: 1, seed: 5 });
    ignora.seedAccessLogs(100, { idInicial: 1, seed: 5 });
    const corpo = { object: 'access_logs', where: { access_logs: { id: { '>': 1000000 } } } };

    const a = await post(honra, 'load_objects.fcgi', await comSessao(honra), corpo);
    const b = await post(ignora, 'load_objects.fcgi', await comSessao(ignora), corpo);
    expect(a.data.access_logs).toHaveLength(0);
    expect(b.data.access_logs).toHaveLength(100);
    await honra.stop();
    await ignora.stop();
  });
});

// ───────────────────────────── Q5 ─────────────────────────────

describe('Q5 — ids de access_logs são POR DISPOSITIVO: faixas diferentes por instância', () => {
  it('duas instâncias têm faixas de id disjuntas — um MIN_ID global não pode servir para as duas', async () => {
    const catracaA = await createCatracaSimulator({ deviceId: 1 });
    const catracaB = await createCatracaSimulator({ deviceId: 2 });
    const logsA = catracaA.seedAccessLogs(PRESETS_FAIXA.instanciaA.quantidade, {
      idInicial: PRESETS_FAIXA.instanciaA.idInicial
    });
    const logsB = catracaB.seedAccessLogs(PRESETS_FAIXA.instanciaB.quantidade, {
      idInicial: PRESETS_FAIXA.instanciaB.idInicial
    });

    const maxB = Math.max(...logsB.map((l) => l.id));
    const minA = Math.min(...logsA.map((l) => l.id));
    expect(logsB).toHaveLength(5);
    expect(minA).toBe(6169);
    expect(maxB).toBeLessThan(minA); // faixas não se sobrepõem
    await catracaA.stop();
    await catracaB.stop();
  });

  it('reproduz o bug documentado: CATRACA_MIN_LOG_ID=73975 global descarta TODOS os 48.057 logs', async () => {
    const sim = await createCatracaSimulator();
    const logs = sim.seedAccessLogs(48057, { idInicial: 6169 });
    const MIN_ID_GLOBAL = 73975; // valor que estava em produção (docs/ANALISE_SYNC_CONTROL_ID.md)

    const maiorId = Math.max(...logs.map((l) => l.id));
    expect(maiorId).toBeLessThan(MIN_ID_GLOBAL);
    // Primeiro filtro de accessService: `if (log.id <= MIN_ID) continue`
    const sobreviventes = logs.filter((l) => l.id > MIN_ID_GLOBAL);
    expect(sobreviventes).toHaveLength(0);
    await sim.stop();
  });

  it('com corte POR DISPOSITIVO (ultimo_log_id_sincronizado) os logs novos passam', async () => {
    const sim = await createCatracaSimulator();
    const logs = sim.seedAccessLogs(1000, { idInicial: 6169 });
    const ultimoSincronizado = logs[499].id;
    const sobreviventes = logs.filter((l) => l.id > ultimoSincronizado);
    expect(sobreviventes).toHaveLength(500);
    await sim.stop();
  });
});

// ───────────────────────────── Q6 ─────────────────────────────

describe('Q6 — user_id na catraca = OFFSET + pessoa.id, e a base real tem DOIS offsets', () => {
  it('offset configurável: o mesmo pessoa.id vira user_id diferente em cada offset', async () => {
    const sim = await createCatracaSimulator({ quirks: { userIdOffset: 111000000 } });
    sim.seedUsuarios([1, 2, 3], [111000000]);
    const ids = sim.store.tabela('users').map((u) => u.id);
    expect(ids).toEqual([111000001, 111000002, 111000003]);
    await sim.stop();
  });

  it('QUEBRARIA se o simulador normalizasse os offsets: usuários gravados em 110000000 E 111000000 coexistem', async () => {
    const sim = await createCatracaSimulator({ quirks: { userIdOffset: 111000000 } });
    // controlIdService usa default 110000000; accessService usa default 111000000.
    // A base real acumulou usuários dos dois lados dessa divergência.
    sim.seedUsuarios([1, 2, 3], [110000000, 111000000]);
    const session = await comSessao(sim);
    const res = await post(sim, 'load_objects.fcgi', session, { object: 'users' });
    expect(res.data.users).toHaveLength(6);

    const OFFSET_EM_USO = 111000000;
    const orfaos = res.data.users.filter((u) => u.id < OFFSET_EM_USO);
    // Estes 3 nunca serão encontrados por quem calcula OFFSET_EM_USO + pessoa.id: são órfãos.
    expect(orfaos.map((u) => u.id)).toEqual([110000001, 110000002, 110000003]);
    await sim.stop();
  });

  it('logs gerados com offsets mistos produzem user_id que a conversão de produção resolve ou descarta', async () => {
    const sim = await createCatracaSimulator();
    const logs = sim.seedAccessLogs(500, {
      idInicial: 1,
      userIdOffset: 111000000,
      offsetsExtras: [110000000],
      pessoaIds: [1, 2, 3]
    });
    const comOffsetAntigo = logs.filter((l) => l.user_id > 0 && l.user_id < 111000000);
    const comOffsetNovo = logs.filter((l) => l.user_id >= 111000000);
    expect(comOffsetAntigo.length).toBeGreaterThan(0);
    expect(comOffsetNovo.length).toBeGreaterThan(0);

    // userIdCatracaParaPessoaId (accessService) subtrai o offset só se user_id >= OFFSET;
    // abaixo disso ele usa os 7 últimos dígitos, e 110000001 → 0000001 → pessoa 1 por acidente.
    const resolvido = Number(String(comOffsetAntigo[0].user_id).slice(-7));
    expect([1, 2, 3]).toContain(resolvido);
    await sim.stop();
  });
});

// ───────────────────────────── Q7 ─────────────────────────────

describe('Q7 — vínculo por `registration` além de `id`', () => {
  it('load/modify/destroy de users aceitam where por registration', async () => {
    const sim = await createCatracaSimulator();
    const session = await comSessao(sim);
    await post(sim, 'create_objects.fcgi', session, {
      object: 'users',
      values: [{ id: 111000001, name: 'Pessoa Teste 1', registration: '1' }]
    });

    const load = await post(sim, 'load_objects.fcgi', session, {
      object: 'users',
      where: { users: { registration: '1' } }
    });
    expect(load.data.users).toHaveLength(1);

    // modify por registration: sucesso ainda respeita o Q1 (400 de corpo vazio)
    await expect(
      post(sim, 'modify_objects.fcgi', session, {
        object: 'users',
        values: { name: 'Pessoa Teste 1 Editada' },
        where: { users: { registration: '1' } }
      })
    ).rejects.toMatchObject({ response: { status: 400, data: '' } });
    expect(sim.store.tabela('users')[0].name).toBe('Pessoa Teste 1 Editada');

    const del = await post(sim, 'destroy_objects.fcgi', session, {
      object: 'users',
      where: { users: { registration: '1' } }
    });
    expect(del.data.changes).toBe(1);
    await sim.stop();
  });

  it('com aceitaVinculoPorRegistration=false o firmware recusa o filtro — modo para avaliar risco da migração', async () => {
    const sim = await createCatracaSimulator({ quirks: { aceitaVinculoPorRegistration: false } });
    const session = await comSessao(sim);
    await post(sim, 'create_objects.fcgi', session, {
      object: 'users',
      values: [{ id: 111000001, name: 'Pessoa Teste 1', registration: '1' }]
    });
    await expect(
      post(sim, 'load_objects.fcgi', session, { object: 'users', where: { users: { registration: '1' } } })
    ).rejects.toMatchObject({ response: { status: 400 } });
    // Por id continua funcionando: é o único vínculo garantido hoje.
    const porId = await post(sim, 'load_objects.fcgi', session, {
      object: 'users',
      where: { users: { id: 111000001 } }
    });
    expect(porId.data.users).toHaveLength(1);
    await sim.stop();
  });
});
