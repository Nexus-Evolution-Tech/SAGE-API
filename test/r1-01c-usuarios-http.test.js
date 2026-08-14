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
  let ids;

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

  it('exige token e sessão ativa em todas as rotas de usuário', async () => {
    const semToken = await Promise.all([
      requisitar(porta, 'POST', '/usuarios', {}),
      requisitar(porta, 'GET', '/usuarios'),
      requisitar(porta, 'GET', '/usuarios/1'),
      requisitar(porta, 'PATCH', '/usuarios/1', {}),
      requisitar(porta, 'PATCH', '/usuarios/1/desativar'),
      requisitar(porta, 'PATCH', '/usuarios/1/redefinir-senha', {})
    ]);
    expect(semToken.map((resposta) => resposta.status)).toEqual([401, 401, 401, 401, 401, 401]);

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
    ids = [primeiro.body.data.id, segundo.body.data.id];
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

  it('edita somente os quatro campos permitidos e preserva o hash', async () => {
    const id = ids[0];
    const [[antes]] = await banco.pool.query('SELECT senha_hash FROM Usuario WHERE id = ?', [id]);
    const resposta = await requisitar(porta, 'PATCH', `/usuarios/${id}`, {
      login: 'secretaria.r1c.editada', nome_exibicao: 'Nome editado',
      papel: 'ADMINISTRADOR', pessoa_id: null
    }, token);
    expect(resposta.status).toBe(200);
    expect(resposta.body.data).toMatchObject({ id, login: 'secretaria.r1c.editada', nome_exibicao: 'Nome editado', papel: 'ADMINISTRADOR', pessoa_id: null });
    expect(resposta.body.data).not.toHaveProperty('senha_hash');
    const [[depois]] = await banco.pool.query(
      'SELECT login, nome_exibicao, papel, pessoa_id, senha_hash, ativo FROM Usuario WHERE id = ?', [id]
    );
    expect(depois).toMatchObject({ login: 'secretaria.r1c.editada', nome_exibicao: 'Nome editado', papel: 'ADMINISTRADOR', pessoa_id: null, ativo: 1 });
    expect(depois.senha_hash).toBe(antes.senha_hash);

    for (const corpo of [
      {}, [], { senha_hash: 'nao-pode' }, { senha: 'nao-pode' }, { ativo: false },
      { falhas_login: 0 }, { login: 'x' }, { nome_exibicao: '\u0000' },
      { pessoa_id: '1' }, { papel: 'GESTOR' }
    ]) {
      expect((await requisitar(porta, 'PATCH', `/usuarios/${id}`, corpo, token)).status).toBe(400);
    }
  });

  it('desativa sem excluir e recusa a sessão na requisição seguinte', async () => {
    const id = ids[1];
    const tokenDoAlvo = gerarToken({ usuario_id: id, papel: 'SECRETARIA', emitido_em: new Date().toISOString() });
    const resposta = await requisitar(porta, 'PATCH', `/usuarios/${id}/desativar`, undefined, token);
    expect(resposta.status).toBe(200);
    expect(resposta.body.data).toMatchObject({ id, ativo: 0 });
    expect((await requisitar(porta, 'GET', `/usuarios/${id}`, undefined, tokenDoAlvo)).status).toBe(401);
    const [[persistido]] = await banco.pool.query('SELECT id, ativo FROM Usuario WHERE id = ?', [id]);
    expect(persistido).toEqual({ id, ativo: 0 });
    expect((await requisitar(porta, 'PATCH', `/usuarios/${id}/desativar`, {}, token)).status).toBe(200);
    expect((await requisitar(porta, 'PATCH', `/usuarios/${id}/desativar`, { ativo: true }, token)).status).toBe(400);
    expect((await requisitar(porta, 'PATCH', `/usuarios/${id}/desativar`, [], token)).status).toBe(400);
  });

  it('redefine a senha, exige troca e limpa falhas e bloqueio', async () => {
    const id = ids[0];
    await banco.pool.query(
      'UPDATE Usuario SET precisa_trocar_senha = FALSE, falhas_login = 4, bloqueado_ate = DATE_ADD(NOW(), INTERVAL 15 MINUTE) WHERE id = ?', [id]
    );
    const novaSenha = 'senha-redefinida-8';
    const resposta = await requisitar(porta, 'PATCH', `/usuarios/${id}/redefinir-senha`, { nova_senha: novaSenha }, token);
    expect(resposta.status).toBe(200);
    expect(resposta.body.data).not.toHaveProperty('senha_hash');
    const [[usuario]] = await banco.pool.query(
      'SELECT senha_hash, precisa_trocar_senha, falhas_login, bloqueado_ate FROM Usuario WHERE id = ?', [id]
    );
    expect(await bcrypt.compare(novaSenha, usuario.senha_hash)).toBe(true);
    expect(usuario).toMatchObject({ precisa_trocar_senha: 1, falhas_login: 0, bloqueado_ate: null });
    const login = await requisitar(porta, 'POST', '/escolas/login/1', { usuario: 'secretaria.r1c.editada', senha: novaSenha });
    expect(login.status).toBe(200);
    expect(login.body.precisa_trocar_senha).toBe(true);
    expect(login.body.token).toEqual(expect.any(String));
    expect((await requisitar(porta, 'GET', '/usuarios', undefined, login.body.token)).status).toBe(428);
    for (const corpo of [{}, { senha_hash: 'nao-pode' }, { nova_senha: 'curta' }, { nova_senha: novaSenha, extra: true }, { nova_senha: 12345678 }, { nova_senha: 'x'.repeat(73) }]) {
      expect((await requisitar(porta, 'PATCH', `/usuarios/${id}/redefinir-senha`, corpo, token)).status).toBe(400);
    }
  });

  it('faz rollback da redefinição quando o update falha', async () => {
    const id = ids[0];
    await banco.pool.query(
      'UPDATE Usuario SET precisa_trocar_senha = FALSE, falhas_login = 3, bloqueado_ate = DATE_ADD(NOW(), INTERVAL 10 MINUTE) WHERE id = ?', [id]
    );
    const [[antes]] = await banco.pool.query(
      'SELECT senha_hash, precisa_trocar_senha, falhas_login, bloqueado_ate FROM Usuario WHERE id = ?', [id]
    );
    const trigger = `tr_r1_01c_reset_${process.pid}`;
    await banco.pool.query(`CREATE TRIGGER ${trigger} BEFORE UPDATE ON Usuario FOR EACH ROW
      BEGIN IF NEW.id = ${id} AND NEW.precisa_trocar_senha = TRUE THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'falha controlada';
      END IF; END`);
    try {
      const resposta = await requisitar(porta, 'PATCH', `/usuarios/${id}/redefinir-senha`, { nova_senha: 'outra-senha-8' }, token);
      expect(resposta.status).toBe(503);
      expect(JSON.stringify(resposta.body)).not.toMatch(/falha controlada|outra-senha-8|senha_hash/i);
    } finally {
      await banco.pool.query(`DROP TRIGGER ${trigger}`);
    }
    const [[depois]] = await banco.pool.query(
      'SELECT senha_hash, precisa_trocar_senha, falhas_login, bloqueado_ate FROM Usuario WHERE id = ?', [id]
    );
    expect(depois).toEqual(antes);
  });

  it('não oferece DELETE de usuário e preserva a linha', async () => {
    const resposta = await requisitar(porta, 'DELETE', `/usuarios/${ids[0]}`, undefined, token);
    expect(resposta.status).toBe(404);
    const [[usuario]] = await banco.pool.query('SELECT id FROM Usuario WHERE id = ?', [ids[0]]);
    expect(usuario).toEqual({ id: ids[0] });
  });
});
