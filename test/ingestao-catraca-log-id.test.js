/**
 * PR #3 — a identidade de um acesso é (dispositivo_id, access_logs.id), nunca o horário.
 *
 * Exercita polling e Monitor contra a mesma catraca simulada: duas passagens no mesmo segundo,
 * resync com o relógio deslocado e um log sem pessoa não podem causar perda ou duplicação.
 */
const { temBancoDisponivel, criarBancoDeTeste } = require('./helpers/banco');
const { createCatracaSimulator } = require('./fakes/controlid');
const globalState = require('../src/state/globalState');

let banco = null;
let sim = null;
let accessService = null;
let db = null;
let temBanco = false;
let dispositivoId = null;

const agora = Math.floor(Date.now() / 1000);
const logsIniciais = [
  { id: 101, time: agora - 120, user_id: 111000001, portal_id: 1, card_value: '123456789' },
  { id: 102, time: agora - 120, user_id: 111000001, portal_id: 1, card_value: '12345678' },
  { id: 103, time: agora - 119, user_id: 0, portal_id: 1, card_value: '123456789' },
  { id: 104, time: agora - 118, user_id: 111000001, portal_id: 2, card_value: '87654321' },
  { id: 105, time: agora - 117, user_id: 111999999, portal_id: 1, card_value: '123456789' },
  { id: 106, time: agora - 116, user_id: 111000001, portal_id: 1, card_value: '987654321' }
].map((log) => ({ ...log, event: 7, device_id: 9001 }));

function definirLogs(logs) {
  const tabela = sim.store.tabela('access_logs');
  tabela.length = 0;
  tabela.push(...logs);
}

async function dispositivoAtual() {
  const [[dispositivo]] = await banco.pool.query('SELECT * FROM Dispositivo WHERE id = ?', [dispositivoId]);
  return dispositivo;
}

async function acessosDaCatraca() {
  const [linhas] = await banco.pool.query(
    `SELECT catraca_log_id, metodo_auth,
            DATE_FORMAT(data_hora, '%Y-%m-%d %H:%i:%s') AS data_hora
       FROM Acesso
      WHERE dispositivo_id = ?
      ORDER BY catraca_log_id`,
    [dispositivoId]
  );
  return linhas;
}

async function presencaDaPessoa() {
  const [[linha]] = await banco.pool.query(
    'SELECT data, horario_chegada, atrasado FROM Presenca WHERE pessoa_id = 1'
  );
  return linha;
}

beforeAll(async () => {
  temBanco = await temBancoDisponivel();
  if (!temBanco) return;

  banco = await criarBancoDeTeste('ingestao_log_id');
  sim = await createCatracaSimulator({ deviceId: 9001 });
  await banco.pool.query("INSERT INTO Pessoa (id, nome, tipo, visivel) VALUES (1, 'Pessoa Teste', 'ADMINISTRADOR', 1)");

  const [endereco, porta] = sim.url.split(':');
  const [res] = await banco.pool.query(
    `INSERT INTO Dispositivo
       (nome, modelo, endereco, porta, usuario, senha, control_id_device_id)
     VALUES ('Catraca Ingestão', 'IDBlock', ?, ?, 'admin', 'admin', 9001)`,
    [endereco, porta]
  );
  dispositivoId = res.insertId;

  process.env.DB_NAME = banco.nome;
  process.env.CATRACA_MIN_LOG_ID = '0';
  db = require('../src/config/database');
  accessService = require('../src/services/accessService');
}, 180000);

afterAll(async () => {
  if (sim) await sim.stop().catch(() => {});
  if (banco) await banco.destruir();
});

describe('PR #3 — ingestão idempotente pelo id do log da catraca', () => {
  it('full/polling usa a identidade da catraca, sem confundir identidade com horário', async ({ skip }) => {
    skip(!temBanco, 'MySQL indisponível');

    const statsAntes = globalState.getStats().acessos_hoje;
    definirLogs(logsIniciais);
    const queryOriginal = db.query;
    let consultasPessoasEmLote = 0;
    let consultasDeduplicacaoAntiga = 0;
    db.query = function (sql, ...args) {
      const texto = String(sql);
      if (texto.includes('SELECT id, nome FROM Pessoa WHERE id IN')) consultasPessoasEmLote++;
      if (texto.includes('WHERE pessoa_id = ? AND dispositivo_id = ? AND data_hora = ?')) {
        consultasDeduplicacaoAntiga++;
      }
      return queryOriginal.call(db, sql, ...args);
    };
    let primeiraSync;
    try {
      primeiraSync = await accessService.sincronizarAcessos(await dispositivoAtual());
    } finally {
      db.query = queryOriginal;
    }
    expect(primeiraSync.acessosSincronizados).toBe(4);
    expect(consultasPessoasEmLote).toBe(1);
    expect(consultasDeduplicacaoAntiga).toBe(0);
    expect(globalState.getStats().acessos_hoje - statsAntes).toBe(4);

    const primeiraLeitura = await acessosDaCatraca();
    const primeiraPresenca = await presencaDaPessoa();
    expect(primeiraLeitura.map((l) => Number(l.catraca_log_id))).toEqual([101, 102, 104, 106]);
    expect(primeiraLeitura.filter((l) => l.data_hora === primeiraLeitura[0].data_hora)).toHaveLength(2);
    expect(primeiraLeitura.find((l) => Number(l.catraca_log_id) === 102)?.metodo_auth).toBe('QR_CODE');

    // Reapresenta os mesmos logs após o round-trip que hoje desloca DATETIME em +3h.
    // O resync não pode criar outra linha, nem reescrever o horário já registrado.
    definirLogs(logsIniciais.map((log) => ({ ...log, time: log.time + 3 * 3600 })));
    await banco.pool.query('UPDATE Dispositivo SET ultimo_log_id_sincronizado = NULL WHERE id = ?', [dispositivoId]);
    await accessService.sincronizarAcessos(await dispositivoAtual());
    expect(await acessosDaCatraca()).toEqual(primeiraLeitura);
    expect(await presencaDaPessoa()).toEqual(primeiraPresenca);
    expect(globalState.getStats().acessos_hoje - statsAntes).toBe(4);
  }, 120000);

  it('faz Monitor e polling concorrentes convergirem sem duplicar efeitos', async ({ skip }) => {
    skip(!temBanco, 'MySQL indisponível');

    await banco.pool.query('DELETE FROM Presenca');
    await banco.pool.query('DELETE FROM Acesso');
    await banco.pool.query(
      'UPDATE Dispositivo SET ultimo_log_id_sincronizado = NULL WHERE id = ?',
      [dispositivoId]
    );
    const statsAntes = globalState.getStats().acessos_hoje;

    // Monitor e polling disputam o mesmo log; o UNIQUE precisa resolver a corrida sem duplicar efeito.
    const logMonitor = {
      id: 107,
      time: agora - 110,
      user_id: 111000001,
      portal_id: 1,
      card_value: '12345678',
      event: 7,
      device_id: 9001
    };
    definirLogs([logMonitor]);
    const getConnectionAntesDaCorrida = db.getConnection;
    let insertsAguardando = 0;
    let liberarInserts;
    const barreira = new Promise((resolve) => { liberarInserts = resolve; });
    const timeoutBarreira = setTimeout(liberarInserts, 2000);
    db.getConnection = async function () {
      const conexao = await getConnectionAntesDaCorrida.call(db);
      const queryAntesDaCorrida = conexao.query.bind(conexao);
      conexao.query = function (sql, ...args) {
        if (String(sql).includes('INSERT INTO Acesso') && String(sql).includes('catraca_log_id')) {
          insertsAguardando++;
          if (insertsAguardando === 2) liberarInserts();
          return barreira.then(() => queryAntesDaCorrida(sql, ...args));
        }
        return queryAntesDaCorrida(sql, ...args);
      };
      return conexao;
    };
    let viaMonitor;
    let viaPolling;
    try {
      [viaMonitor, viaPolling] = await Promise.all([
        accessService.processarNotificacaoMonitorDao({
          device_id: 9001,
          object_changes: [{ object: 'access_logs', type: 'inserted', values: logMonitor }]
        }),
        accessService.sincronizarAcessos(await dispositivoAtual(), { monitorOnly: true })
      ]);
    } finally {
      clearTimeout(timeoutBarreira);
      db.getConnection = getConnectionAntesDaCorrida;
    }
    expect(insertsAguardando).toBe(2);
    expect(viaMonitor.erros).toEqual([]);
    expect(viaMonitor.processados + viaPolling.acessosSincronizados).toBe(1);
    expect(viaMonitor.processados + viaMonitor.ignorados).toBe(1);

    const final = await acessosDaCatraca();
    expect(final.map((l) => Number(l.catraca_log_id))).toEqual([107]);
    expect(final.find((l) => Number(l.catraca_log_id) === 107)?.metodo_auth).toBe('QR_CODE');
    expect(final.find((l) => Number(l.catraca_log_id) === 107)?.data_hora).toBe(
      new Date(logMonitor.time * 1000).toISOString().slice(0, 19).replace('T', ' ')
    );
    expect(globalState.getStats().acessos_hoje - statsAntes).toBe(1);
  }, 120000);
});
