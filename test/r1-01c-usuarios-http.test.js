const crypto = require('crypto');
const http = require('http');
const bcrypt = require('bcrypt');
const { criarBancoDeTeste, temBancoDisponivel } = require('./helpers/banco');

const descreveMySql = await temBancoDisponivel() ? describe : describe.skip;
process.env.JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
process.env.NODE_ENV = 'test';

function requisitar(porta, metodo, caminho, corpo, token) {
  return new Promise((resolve, reject) => {
    const payload = corpo === undefined ? null : Buffer.from(JSON.stringify(corpo));
    const request = http.request({
      hostname: '127.0.0.1', port: porta, method: metodo, path: caminho,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    }, (response) => {
      const partes = [];
      response.on('data', (parte) => partes.push(parte));
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(partes).toString()) }));
    });
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

descreveMySql('R1-01C — criar, listar e obter usuários', () => {
  let banco;
  let db;
  let server;
  let porta;
  let token;
  let pessoaId;
  let atorId;
  let gerarToken;

  beforeAll(async () => {
    banco = await criarBancoDeTeste('r1_01c_usuarios');
    process.env.DB_NAME = banco.nome;
    db = require('../src/config/database');
    ({ gerarToken } = require('../src/utils/jwt'));
    const [pessoa] = await banco.pool.query(
      "INSERT INTO Pessoa (nome, tipo) VALUES ('Pessoa de teste R1-01C', 'ADMINISTRADOR')"
    );
    pessoaId = pessoa.insertId;
    const [ator] = await banco.pool.query(
      `INSERT INTO Usuario (login, senha_hash, nome_exibicao, papel, pessoa_id)
       VALUES (?, ?, ?, 'ADMINISTRADOR', ?)`,
      [`ator.r1c.${process.pid}`, await bcrypt.hash('senha-ator-8', 10), 'Ator R1-01C', pessoaId]
    );
    atorId = ator.insertId;
    token = gerarToken({ usuario_id: atorId, papel: 'ADMINISTRADOR', emitido_em: new Date().toISOString() });
    const app = require('../src/app');
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    porta = server.address().port;
  }, 120000);

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (db) await new Promise((resolve) => db.end(resolve));
    if (banco) await banco.destruir();
  });

  it('exige token e sessão ativa nas três rotas', async () => {
    const semToken = await Promise.all([
      requisitar(porta, 'POST', '/usuarios', {}),
      requisitar(porta, 'GET', '/usuarios'),
      requisitar(porta, 'GET', '/usuarios/1')
    ]);
    expect(semToken.map((resposta) => resposta.status)).toEqual([401, 401, 401]);

    await banco.pool.query('UPDATE Usuario SET ativo = FALSE WHERE id = ?', [atorId]);
    expect((await requisitar(porta, 'GET', '/usuarios', undefined, token)).status).toBe(401);
    await banco.pool.query('UPDATE Usuario SET ativo = TRUE WHERE id = ?', [atorId]);
  });

  it('cria dois usuários, lista e obtém ambos com projeção segura', async () => {
    const primeiro = await requisitar(porta, 'POST', '/usuarios', {
      login: 'secretaria.r1c.1', nome_exibicao: 'Secretaria R1C 1', papel: 'SECRETARIA', senha: 'senha-segura-1'
    }, token);
    const segundo = await requisitar(porta, 'POST', '/usuarios', {
      login: 'secretaria.r1c.2', nome_exibicao: 'Secretaria R1C 2', papel: 'SECRETARIA', senha: 'senha-segura-2', pessoa_id: pessoaId
    }, token);

    expect(primeiro.status).toBe(201);
    expect(segundo.status).toBe(201);
    const ids = [primeiro.body.data.id, segundo.body.data.id];
    expect(new Set(ids).size).toBe(2);
    const lista = await requisitar(porta, 'GET', '/usuarios', undefined, token);
    expect(lista.status).toBe(200);
    expect(lista.body.data.map(({ id }) => id)).toEqual(expect.arrayContaining(ids));

    const respostas = [primeiro.body, segundo.body, lista.body];
    for (const id of ids) {
      const obtido = await requisitar(porta, 'GET', `/usuarios/${id}`, undefined, token);
      expect(obtido.status).toBe(200);
      expect(obtido.body.data).toEqual(expect.objectContaining({ id }));
      expect(obtido.body.data).not.toHaveProperty('senha_hash');
      expect(obtido.body.data).not.toHaveProperty('falhas_login');
      expect(obtido.body.data).not.toHaveProperty('bloqueado_ate');
      expect(obtido.body.data).not.toHaveProperty('ultimo_acesso');
      respostas.push(obtido.body);
    }
    const inexistente = Math.max(...ids) + 100;
    expect((await requisitar(porta, 'GET', `/usuarios/${inexistente}`, undefined, token)).status).toBe(404);
    const respostasJson = JSON.stringify(respostas);
    expect(respostasJson).not.toContain(token);
    for (const segredo of ['senha-segura-1', 'senha-segura-2', 'senha_hash', 'falhas_login', 'bloqueado_ate', 'ultimo_acesso']) {
      expect(respostasJson).not.toContain(segredo);
    }
  });

  it('recusa login duplicado e pessoa_id inexistente sem detalhe do banco', async () => {
    const duplicado = await requisitar(porta, 'POST', '/usuarios', {
      login: 'secretaria.r1c.1', nome_exibicao: 'Outro nome', papel: 'SECRETARIA', senha: 'outra-senha-8'
    }, token);
    expect(duplicado.status).toBe(409);
    expect(JSON.stringify(duplicado.body)).not.toMatch(/ER_DUP_ENTRY|Duplicate entry|secretaria\.r1c\.1/i);

    const pessoaInvalida = await requisitar(porta, 'POST', '/usuarios', {
      login: 'secretaria.r1c.3', nome_exibicao: 'Secretaria R1C 3', papel: 'SECRETARIA', senha: 'senha-segura-3', pessoa_id: 999999999
    }, token);
    expect(pessoaInvalida).toMatchObject({ status: 400, body: { message: 'pessoa_id inválido' } });
  });

  it('recusa campos desconhecidos e entradas hostis', async () => {
    const base = { login: 'secretaria.r1c.4', nome_exibicao: 'Secretaria R1C 4', papel: 'SECRETARIA', senha: 'senha-segura-4' };
    const casos = [
      { ...base, login: 'login com espaço' },
      { ...base, nome_exibicao: '' },
      { ...base, nome_exibicao: 'x'.repeat(101) },
      { ...base, papel: 'GESTOR' },
      { ...base, senha: 'curta' },
      { ...base, pessoa_id: 0 },
      { ...base, pessoa_id: '1' },
      { ...base, segredo: 'mass-assignment' },
      {}
    ];
    for (const corpo of casos) {
      expect((await requisitar(porta, 'POST', '/usuarios', corpo, token)).status).toBe(400);
    }
    for (const id of ['0', '-1', '1.5', 'abc', '01']) {
      expect((await requisitar(porta, 'GET', `/usuarios/${id}`, undefined, token)).status).toBe(400);
    }
  });
});
