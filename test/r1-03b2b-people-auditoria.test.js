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
      response.on('end', () => {
        const texto = Buffer.concat(partes).toString();
        resolve({ status: response.statusCode, body: texto ? JSON.parse(texto) : null });
      });
    });
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

function respostaMock() {
  const resposta = { statusCode: 200, body: null };
  resposta.status = (status) => { resposta.statusCode = status; return resposta; };
  resposta.json = (body) => { resposta.body = body; return resposta; };
  return resposta;
}

descreveMySql('R1-03B2b — auditoria transacional de people', () => {
  let banco;
  let db;
  let server;
  let porta;
  let autores;
  let tokens;
  let pessoaEditar;
  let pessoaDeletar;
  let pessoaRollback;

  beforeAll(async () => {
    banco = await criarBancoDeTeste('r1_03b2b_people');
    process.env.DB_NAME = banco.nome;
    db = require('../src/config/database');
    const { gerarToken } = require('../src/utils/jwt');

    autores = [];
    for (const sufixo of ['um', 'dois']) {
      const [insert] = await banco.pool.query(
        `INSERT INTO Usuario (login, senha_hash, nome_exibicao, papel)
         VALUES (?, ?, ?, 'SECRETARIA')`,
        [`autor.r1_03b2b.${sufixo}`, await bcrypt.hash(`senha-${sufixo}-8`, 10), `Autor ${sufixo}`]
      );
      autores.push(insert.insertId);
    }
    tokens = autores.map((usuario_id) => gerarToken({
      usuario_id, papel: 'SECRETARIA', emitido_em: new Date().toISOString()
    }));

    const pessoas = [];
    for (const nome of ['Pessoa edição R1-03B2b', 'Pessoa exclusão R1-03B2b', 'Pessoa rollback R1-03B2b']) {
      const [insert] = await banco.pool.query(
        "INSERT INTO Pessoa (nome, tipo) VALUES (?, 'ALUNO')", [nome]
      );
      pessoas.push(insert.insertId);
      await banco.pool.query('INSERT INTO Aluno (id, status) VALUES (?, \'EM CURSO\')', [insert.insertId]);
    }
    [pessoaEditar, pessoaDeletar, pessoaRollback] = pessoas;
    await banco.pool.query("INSERT INTO Dispositivo (nome, modelo) VALUES ('Dispositivo sintético R1-03B2b', 'IDBlock')");

    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use('/', require('../src/routes/peopleRoutes'));
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    porta = server.address().port;
  }, 120000);

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (db) await new Promise((resolve) => db.end(resolve));
    if (banco) await banco.destruir();
  });

  it('audita atualização e desativação com autores distintos e fila na mesma operação', async () => {
    expect((await requisitar(porta, 'PATCH', `/pessoas/${pessoaEditar}`, {
      nome: 'Pessoa edição R1-03B2b atualizada'
    }, tokens[0])).status).toBe(200);
    expect((await requisitar(porta, 'DELETE', `/pessoas/${pessoaDeletar}`, undefined, tokens[1])).status).toBe(200);

    const [eventos] = await banco.pool.query(
      `SELECT usuario_id, acao, entidade, entidade_id, detalhe
       FROM TrilhaAuditoria WHERE entidade = 'Pessoa' ORDER BY id`
    );
    expect(eventos).toEqual([
      { usuario_id: autores[0], acao: 'REGISTRO_EDITADO', entidade: 'Pessoa', entidade_id: pessoaEditar, detalhe: null },
      { usuario_id: autores[1], acao: 'REGISTRO_DELETADO', entidade: 'Pessoa', entidade_id: pessoaDeletar, detalhe: null }
    ]);

    const [pendentes] = await banco.pool.query(
      'SELECT pessoa_id, operation FROM sync_pendente WHERE pessoa_id IN (?, ?) ORDER BY pessoa_id',
      [pessoaEditar, pessoaDeletar]
    );
    expect(pendentes).toEqual([
      { pessoa_id: pessoaEditar, operation: 'UPDATE' },
      { pessoa_id: pessoaDeletar, operation: 'DELETE' }
    ]);
  });

  it('faz rollback do negócio e da fila quando a auditoria falha', async () => {
    const trigger = `tr_r1_03b2b_auditoria_falha_${process.pid}`;
    await banco.pool.query(`CREATE TRIGGER ${trigger}
      BEFORE INSERT ON TrilhaAuditoria FOR EACH ROW
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'falha de auditoria controlada'`);
    try {
      const resposta = await requisitar(porta, 'PATCH', `/pessoas/${pessoaRollback}`, {
        nome: 'Nome que não deve persistir'
      }, tokens[0]);
      expect(resposta.status).toBe(500);
    } finally {
      await banco.pool.query(`DROP TRIGGER ${trigger}`);
    }
    const [[pessoa]] = await banco.pool.query('SELECT nome FROM Pessoa WHERE id = ?', [pessoaRollback]);
    const [[fila]] = await banco.pool.query(
      "SELECT COUNT(*) AS total FROM sync_pendente WHERE pessoa_id = ?", [pessoaRollback]
    );
    expect(pessoa.nome).toBe('Pessoa rollback R1-03B2b');
    expect(Number(fila.total)).toBe(0);
  });

  it('recusa ausência de autor antes de persistir', async () => {
    const controller = require('../src/controllers/peopleController');
    const response = respostaMock();
    await controller.editar({ params: { id: pessoaRollback }, body: { nome: 'Sem autor' } }, response);
    expect(response.statusCode).toBe(500);
    const [[pessoa]] = await banco.pool.query('SELECT nome FROM Pessoa WHERE id = ?', [pessoaRollback]);
    expect(pessoa.nome).toBe('Pessoa rollback R1-03B2b');
  });
});
