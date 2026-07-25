/**
 * Fase 2 — E3: durabilidade e recuperação.
 *
 * O PC da escola é desligado, inclusive no meio de operações — isso é o caso NORMAL, não a
 * exceção (ver .env.example: "PC desligado à meia-noite?"). Queda de energia, usuário apertando o
 * botão, Windows atualizando.
 *
 * A pergunta que este arquivo responde não é "o código parece certo?", e sim:
 *
 *   Se eu MATAR o processo no meio de uma sincronização, ele converge ao subir,
 *   sem perder acesso e sem duplicar?
 *
 * A resposta depende de uma ordem específica: `ultimo_log_id_sincronizado` só avança DEPOIS do
 * laço de inserção completo. Se avançasse antes, ou a cada item, uma queda no meio pularia
 * permanentemente os logs não gravados — perda silenciosa de acesso, sem nada no log.
 *
 * O teste mata com SIGKILL de propósito: SIGTERM daria chance ao shutdown gracioso, que é
 * justamente o que NÃO acontece numa queda de energia.
 */
const { spawn } = require('child_process');
const path = require('path');
const { temBancoDisponivel, criarBancoDeTeste, configConexao } = require('./helpers/banco');
const { createCatracaSimulator } = require('./fakes/controlid');

const RAIZ = path.join(__dirname, '..');
const TOTAL_LOGS = 120;

let banco = null;
let temBanco = false;
let sim = null;
let dispositivoId = null;

/** Roda uma sincronização num processo SEPARADO, para podermos matá-lo de verdade. */
function rodarSyncEmProcessoSeparado({ matarAposMs = null } = {}) {
  const cfg = configConexao();
  const script = `
    process.env.CATRACA_MIN_LOG_ID = '0';
    const db = require('./src/config/database');
    (async () => {
      const [[disp]] = await db.query('SELECT * FROM Dispositivo WHERE id = ?', [${dispositivoId}]);
      const accessService = require('./src/services/accessService');
      const r = await accessService.sincronizarAcessos(disp);
      console.log('SYNC-FIM:' + JSON.stringify({ acessos: r.acessosSincronizados, sucesso: r.sucesso }));
      process.exit(0);
    })().catch((e) => { console.error('SYNC-ERRO:' + e.message); process.exit(1); });
  `;

  return new Promise((resolve) => {
    const proc = spawn(process.execPath, ['-e', script], {
      cwd: RAIZ,
      env: {
        ...process.env,
        DB_HOST: cfg.host, DB_PORT: String(cfg.port), DB_USER: cfg.user,
        DB_PASSWORD: cfg.password, DB_NAME: banco.nome,
        JWT_SECRET: 'chave_de_teste_com_mais_de_32_caracteres_ok',
        LOG_LEVEL: 'error', NODE_ENV: 'test'
      }
    });

    let saida = '';
    proc.stdout.on('data', (d) => { saida += d.toString(); });
    proc.stderr.on('data', (d) => { saida += d.toString(); });

    let matado = false;
    if (matarAposMs != null) {
      setTimeout(() => {
        matado = true;
        proc.kill('SIGKILL'); // queda de energia: sem shutdown gracioso
      }, matarAposMs);
    }

    proc.on('close', (code, signal) => resolve({ code, signal, saida, matado }));
  });
}

async function contarAcessos() {
  const [[linha]] = await banco.pool.query('SELECT COUNT(*) AS n FROM Acesso');
  return linha.n;
}

async function contarDuplicatas() {
  const [linhas] = await banco.pool.query(
    `SELECT pessoa_id, dispositivo_id, data_hora, COUNT(*) AS n
     FROM Acesso GROUP BY pessoa_id, dispositivo_id, data_hora HAVING n > 1`
  );
  return linhas.length;
}

async function ponteiro() {
  const [[linha]] = await banco.pool.query(
    'SELECT ultimo_log_id_sincronizado AS p FROM Dispositivo WHERE id = ?', [dispositivoId]
  );
  return linha.p;
}

beforeAll(async () => {
  temBanco = await temBancoDisponivel();
  if (!temBanco) return;

  banco = await criarBancoDeTeste('queda');

  sim = await createCatracaSimulator({ seed: 7 });

  // Dataset explícito em vez de seedAccessLogs: o gerador emite propositalmente alguns logs com
  // usuário inválido (tentativa negada), o que é realista mas torna a contagem esperada ambígua.
  // Aqui queremos medir UMA coisa só — perda por queda —, então todos os logs são válidos.
  // Espaçados 90s: cobrem mais de 1h de propósito, que é a condição em que o resume por
  // timestamp (com margem de 1h) perdia acessos antigos.
  const inicio = Math.floor(Date.now() / 1000) - TOTAL_LOGS * 90 - 600;
  const logs = [];
  for (let i = 1; i <= TOTAL_LOGS; i++) {
    logs.push({
      id: i,
      time: inicio + i * 90,
      user_id: 111000000 + ((i % 150) + 1),
      portal_id: (i % 2) + 1,
      card_value: String(100000000 + i), // 9 dígitos = RFID
      event: 7,
      device_id: 1
    });
  }
  const tabela = sim.store.tabela('access_logs');
  tabela.length = 0;
  for (const l of logs) tabela.push(l);

  // O gerador do simulador distribui os logs entre várias pessoas (user_id = OFFSET + pessoa_id).
  // Sem essas pessoas cadastradas, a sync descarta TUDO por "pessoa inexistente" — foi o que
  // aconteceu na primeira execução deste teste, e o sintoma (0 acessos) não dizia o motivo.
  const pessoas = [];
  for (let i = 1; i <= 200; i++) pessoas.push([i, `Pessoa Teste ${i}`, 'ALUNO', 1]);
  await banco.pool.query(
    'INSERT INTO Pessoa (id, nome, tipo, visivel) VALUES ?', [pessoas]
  );

  const [endereco, porta] = sim.url.split(':');
  const [res] = await banco.pool.query(
    `INSERT INTO Dispositivo (nome, modelo, endereco, porta, usuario, senha)
     VALUES ('Catraca Simulada', 'IDBlock', ?, ?, 'admin', 'admin')`,
    [endereco, porta]
  );
  dispositivoId = res.insertId;
}, 240000);

afterAll(async () => {
  if (sim) await sim.stop().catch(() => {});
  if (banco) await banco.destruir();
});

describe('E3 — matar o processo no meio da sync e convergir ao subir', () => {
  it('não perde nem duplica acesso quando o processo morre no meio', async () => {
    if (!temBanco) {
      console.warn('[SKIP] MySQL indisponível');
      return;
    }

    // 1) Sincronização interrompida por SIGKILL
    const primeira = await rodarSyncEmProcessoSeparado({ matarAposMs: 700 });

    const aposQueda = await contarAcessos();
    const ponteiroAposQueda = await ponteiro();

    // Se o processo terminou sozinho antes de morrermos, o teste não exercita o que queria.
    // Isso não é falha do sistema, é falha do teste — e precisa ser dito, não escondido.
    if (!primeira.matado || primeira.signal !== 'SIGKILL') {
      console.warn(
        `[AVISO] A sync terminou antes do SIGKILL (${aposQueda} acessos). ` +
        'O cenário de queda no meio não foi exercitado nesta execução.'
      );
    }

    // 2) O ponteiro NÃO pode ter avançado numa sync interrompida. Se tivesse avançado, os logs
    //    não gravados seriam pulados para sempre — perda silenciosa.
    if (primeira.matado && primeira.signal === 'SIGKILL') {
      expect(ponteiroAposQueda == null || ponteiroAposQueda === 0).toBe(true);
    }

    // 3) Sobe de novo e deixa terminar
    const segunda = await rodarSyncEmProcessoSeparado();
    if (segunda.code !== 0 || process.env.DEBUG_QUEDA) console.log('[2a SYNC]', segunda.saida);
    expect(segunda.code).toBe(0);

    const total = await contarAcessos();
    const duplicatas = await contarDuplicatas();

    // Convergiu: todos os logs viraram acesso...
    expect(total).toBe(TOTAL_LOGS);
    // ...e reprocessar o que já havia sido gravado não duplicou nada.
    expect(duplicatas).toBe(0);
    // ...e agora sim o ponteiro avançou.
    expect(Number(await ponteiro())).toBe(TOTAL_LOGS);
  }, 240000);

  it('sincronizar de novo, já convergido, é idempotente (não cria nada)', async () => {
    if (!temBanco) return;

    const antes = await contarAcessos();

    const r = await rodarSyncEmProcessoSeparado();
    expect(r.code).toBe(0);

    expect(await contarAcessos()).toBe(antes);
    expect(await contarDuplicatas()).toBe(0);
  }, 240000);
});
