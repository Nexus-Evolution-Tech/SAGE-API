const http = require('http');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { criarBancoDeTeste, temBancoDisponivel } = require('./helpers/banco');

const LIMITE_ORIGEM = 30;
// Limite deliberadamente amplo: compara as medianas de várias amostras sem exigir igualdade
// de latência, mas reprova o retorno imediato de login inexistente contra bcrypt.
const LIMIAR_DIFERENCA_TIMING_MS = 250;
const descreveMySql = await temBancoDisponivel() ? describe : describe.skip;

function requisitar(porta, origem, corpo) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(corpo));
    const request = http.request({
      hostname: '127.0.0.1',
      localAddress: origem,
      port: porta,
      method: 'POST',
      path: '/escolas/login/1',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': payload.length
      }
    }, (response) => {
      const partes = [];
      response.on('data', (parte) => partes.push(parte));
      response.on('end', () => resolve({
        status: response.statusCode,
        body: JSON.parse(Buffer.concat(partes).toString())
      }));
    });
    request.on('error', reject);
    request.end(payload);
  });
}

function mediana(amostras) {
  const ordenadas = [...amostras].sort((a, b) => a - b);
  return ordenadas[Math.floor(ordenadas.length / 2)];
}

descreveMySql('R1-05C — limite por origem e login uniforme', () => {
  let banco;
  let db;
  let app;
  let usuarioService;
  let server;
  let porta;
  let loginExistente;
  const senhaCorreta = `senha-teste-${crypto.randomBytes(12).toString('hex')}`;

  beforeAll(async () => {
    banco = await criarBancoDeTeste('r1_05c_rate_limit');
    process.env.DB_NAME = banco.nome;
    process.env.JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
    process.env.NODE_ENV = 'test';
    db = require('../src/config/database');
    usuarioService = require('../src/services/usuarioService');
    loginExistente = `usuario.r1c.${process.pid}`;
    await banco.pool.query(
      `INSERT INTO Usuario (login, senha_hash, nome_exibicao, papel)
       VALUES (?, ?, ?, 'SECRETARIA')`,
      [loginExistente, await bcrypt.hash(senhaCorreta, 10), 'Usuário R1-05C']
    );
    app = require('../src/app');
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '0.0.0.0', resolve));
    porta = server.address().port;
  }, 120000);

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (db) await new Promise((resolve) => db.end(resolve));
    if (banco) await banco.destruir();
  });

  it('bloqueia N+1 tentativas da origem A sem bloquear a origem B', async () => {
    const tentativas = [];
    for (let i = 0; i < LIMITE_ORIGEM; i++) {
      tentativas.push(await requisitar(porta, '127.0.0.1', {
        usuario: `inexistente.r1c.${i}`,
        senha: 'senha-incorreta'
      }));
    }

    expect(tentativas.every(({ status }) => status === 401)).toBe(true);
    const excedente = await requisitar(porta, '127.0.0.1', {
      usuario: 'inexistente.r1c.excedente', senha: 'senha-incorreta'
    });
    expect(excedente).toMatchObject({
      status: 429,
      body: { message: 'Muitas tentativas. Tente novamente mais tarde.' }
    });

    const outraOrigem = await requisitar(porta, '127.0.0.2', {
      usuario: 'inexistente.r1c.outra-origem', senha: 'senha-incorreta'
    });
    expect(outraOrigem.status).toBe(401);
  }, 30000);

  it('mantém status e corpo iguais para conta inexistente, senha errada e conta bloqueada', async () => {
    await banco.pool.query(
      'UPDATE Usuario SET falhas_login = 0, bloqueado_ate = NULL WHERE login = ?', [loginExistente]
    );
    const inexistente = await requisitar(porta, '127.0.0.3', {
      usuario: 'conta-que-nao-existe.r1c', senha: 'senha-incorreta'
    });
    const senhaErrada = await requisitar(porta, '127.0.0.3', {
      usuario: loginExistente, senha: 'senha-incorreta'
    });
    await banco.pool.query(
      'UPDATE Usuario SET falhas_login = 5, bloqueado_ate = DATE_ADD(NOW(), INTERVAL 15 MINUTE) WHERE login = ?',
      [loginExistente]
    );
    const bloqueada = await requisitar(porta, '127.0.0.3', {
      usuario: loginExistente, senha: senhaCorreta
    });

    expect(inexistente.status).toBe(401);
    expect(senhaErrada).toEqual(inexistente);
    expect(bloqueada).toEqual(inexistente);
  });

  it('equaliza o tempo do login inexistente e da senha errada em várias amostras', async () => {
    const amostrasInexistente = [];
    const amostrasSenhaErrada = [];
    const medir = async (login, senha) => {
      const inicio = process.hrtime.bigint();
      const resultado = await usuarioService.autenticar(login, senha);
      expect(resultado.ok).toBe(false);
      return Number(process.hrtime.bigint() - inicio) / 1e6;
    };

    for (let i = 0; i < 7; i++) {
      await banco.pool.query(
        'UPDATE Usuario SET falhas_login = 0, bloqueado_ate = NULL WHERE login = ?', [loginExistente]
      );
      amostrasInexistente.push(await medir(`inexistente.timing.r1c.${i}`, 'senha-incorreta'));
      await banco.pool.query(
        'UPDATE Usuario SET falhas_login = 0, bloqueado_ate = NULL WHERE login = ?', [loginExistente]
      );
      amostrasSenhaErrada.push(await medir(loginExistente, 'senha-incorreta'));
    }

    const diferenca = Math.abs(mediana(amostrasInexistente) - mediana(amostrasSenhaErrada));
    expect(amostrasInexistente).toHaveLength(7);
    expect(amostrasSenhaErrada).toHaveLength(7);
    expect(diferenca).toBeLessThan(LIMIAR_DIFERENCA_TIMING_MS);
  }, 30000);
});
