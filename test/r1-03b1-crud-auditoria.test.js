const http = require('http');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
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

descreveMySql('R1-03B1 — auditoria transacional dos CRUDs gerados', () => {
  let banco;
  let db;
  let server;
  let porta;
  let autores;
  let tokens;

  beforeAll(async () => {
    banco = await criarBancoDeTeste('r1_03b1_crud');
    process.env.DB_NAME = banco.nome;
    db = require('../src/config/database');
    const { gerarToken } = require('../src/utils/jwt');
    autores = [];
    for (const sufixo of ['um', 'dois']) {
      const [insert] = await banco.pool.query(
        `INSERT INTO Usuario (login, senha_hash, nome_exibicao, papel)
         VALUES (?, ?, ?, 'SECRETARIA')`,
        [`autor.r1_03b1.${sufixo}`, await bcrypt.hash(`senha-${sufixo}-8`, 10), `Autor ${sufixo}`]
      );
      autores.push(insert.insertId);
    }
    tokens = autores.map((usuario_id) => gerarToken({
      usuario_id, papel: 'SECRETARIA', emitido_em: new Date().toISOString()
    }));
    const app = require('express')();
    app.use('/', require('../src/routes/courseRoutes'));
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    porta = server.address().port;
  }, 120000);

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (db) await new Promise((resolve) => db.end(resolve));
    if (banco) await banco.destruir();
  });

  it('audita criar, editar e deletar com dois autores; leitura não cria evento', async () => {
    const criado = await requisitar(porta, 'POST', '/cursos', { nome: 'Curso R1-03B1', duracao: 3 }, tokens[0]);
    expect(criado.status).toBe(201);
    const id = criado.body.data.id;

    const antesDaLeitura = await banco.pool.query('SELECT COUNT(*) AS total FROM TrilhaAuditoria');
    expect((await requisitar(porta, 'GET', `/cursos/${id}`, undefined, tokens[1])).status).toBe(200);
    expect((await banco.pool.query('SELECT COUNT(*) AS total FROM TrilhaAuditoria'))[0][0].total)
      .toBe(antesDaLeitura[0][0].total);

    expect((await requisitar(porta, 'PATCH', `/cursos/${id}`, { duracao: 4 }, tokens[1])).status).toBe(200);
    expect((await requisitar(porta, 'DELETE', `/cursos/${id}`, undefined, tokens[0])).status).toBe(200);

    const [eventos] = await banco.pool.query(
      `SELECT usuario_id, acao, entidade, entidade_id, detalhe
         FROM TrilhaAuditoria WHERE entidade = 'Curso' AND entidade_id = ? ORDER BY id`, [id]
    );
    expect(eventos).toEqual([
      { usuario_id: autores[0], acao: 'REGISTRO_CRIADO', entidade: 'Curso', entidade_id: id, detalhe: null },
      { usuario_id: autores[1], acao: 'REGISTRO_EDITADO', entidade: 'Curso', entidade_id: id, detalhe: null },
      { usuario_id: autores[0], acao: 'REGISTRO_DELETADO', entidade: 'Curso', entidade_id: id, detalhe: null }
    ]);
  });

  it('recusa autor ausente antes do negócio', async () => {
    const controller = require('../src/controllers/genericControllerFactory')('Curso', ['id', 'nome'], 'curso');
    let statusCode;
    const response = {
      status: (code) => { statusCode = code; return response; },
      json: () => response
    };
    await expect(controller.criar({ body: { nome: 'Sem autor' } }, response))
      .resolves.toBeUndefined();
    expect(statusCode).toBe(500);
    const [[resultado]] = await banco.pool.query("SELECT COUNT(*) AS total FROM Curso WHERE nome = 'Sem autor'");
    expect(Number(resultado.total)).toBe(0);
  });

  it('faz rollback do negócio quando a auditoria falha', async () => {
    const trigger = `tr_r1_03b1_auditoria_falha_${process.pid}`;
    await banco.pool.query(`CREATE TRIGGER ${trigger}
      BEFORE INSERT ON TrilhaAuditoria FOR EACH ROW
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'falha de auditoria controlada'`);
    try {
      const resposta = await requisitar(porta, 'POST', '/cursos', { nome: 'Rollback R1-03B1', duracao: 1 }, tokens[0]);
      expect(resposta.status).toBe(500);
    } finally {
      await banco.pool.query(`DROP TRIGGER ${trigger}`);
    }
    const [[resultado]] = await banco.pool.query("SELECT COUNT(*) AS total FROM Curso WHERE nome = 'Rollback R1-03B1'");
    expect(Number(resultado.total)).toBe(0);
  });
});
