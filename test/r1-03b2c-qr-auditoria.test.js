const http = require('http');
const crypto = require('crypto');
const { criarBancoDeTeste, temBancoDisponivel } = require('./helpers/banco');

const descreveMySql = await temBancoDisponivel() ? describe : describe.skip;
process.env.JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
process.env.NODE_ENV = 'test';

function requisitar(porta, token) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1', port: porta, method: 'POST',
      path: `/pessoas/gerar_qrcode/${token.pessoaId}`,
      headers: { Authorization: `Bearer ${token.jwt}` }
    }, (response) => {
      const partes = [];
      response.on('data', (parte) => partes.push(parte));
      response.on('end', () => {
        const texto = Buffer.concat(partes).toString();
        resolve({ status: response.statusCode, body: texto ? JSON.parse(texto) : null });
      });
    });
    request.on('error', reject);
    request.end();
  });
}

function respostaMock() {
  const resposta = { statusCode: 200, body: null };
  resposta.status = (status) => { resposta.statusCode = status; return resposta; };
  resposta.json = (body) => { resposta.body = body; return resposta; };
  return resposta;
}

descreveMySql('R1-03B2c — auditoria da geração de QR', () => {
  let banco;
  let db;
  let server;
  let porta;
  let pessoaId;
  let pessoaRollbackId;
  let pessoaSemAutorId;
  let autorId;
  let jwt;

  beforeAll(async () => {
    banco = await criarBancoDeTeste('r1_03b2c_qr');
    process.env.DB_NAME = banco.nome;
    db = require('../src/config/database');
    const { gerarToken } = require('../src/utils/jwt');
    const [autor] = await banco.pool.query(
      `INSERT INTO Usuario (login, senha_hash, nome_exibicao, papel)
       VALUES ('autor.r1_03b2c', 'hash-sintetico', 'Autor sintético', 'SECRETARIA')`
    );
    autorId = autor.insertId;
    jwt = gerarToken({ usuario_id: autorId, papel: 'SECRETARIA', emitido_em: new Date().toISOString() });
    const pessoas = [];
    for (const nome of ['Pessoa QR sintética', 'Pessoa rollback QR sintética', 'Pessoa sem autor QR sintética']) {
      const [pessoa] = await banco.pool.query(
        'INSERT INTO Pessoa (nome, tipo, qr_code) VALUES (?, \'ALUNO\', \'11111111\')', [nome]
      );
      pessoas.push(pessoa.insertId);
    }
    [pessoaId, pessoaRollbackId, pessoaSemAutorId] = pessoas;

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

  it('persiste o QR e a trilha com autor, ação fechada e detalhe nulo', async () => {
    const resposta = await requisitar(porta, { pessoaId, jwt });
    expect(resposta.status).toBe(200);
    expect(resposta.body.qr_code).toMatch(/^\d{8}$/);

    const [[pessoa]] = await banco.pool.query('SELECT qr_code FROM Pessoa WHERE id = ?', [pessoaId]);
    const [[evento]] = await banco.pool.query(
      `SELECT usuario_id, acao, entidade, entidade_id, detalhe
       FROM TrilhaAuditoria WHERE entidade = 'Pessoa' AND entidade_id = ?`, [pessoaId]
    );
    expect(pessoa.qr_code).toBe(resposta.body.qr_code);
    expect(evento).toEqual({
      usuario_id: autorId, acao: 'REGISTRO_EDITADO', entidade: 'Pessoa',
      entidade_id: pessoaId, detalhe: null
    });
  });

  it('faz rollback do QR quando a auditoria falha', async () => {
    const trigger = `tr_r1_03b2c_auditoria_falha_${process.pid}`;
    await banco.pool.query(`CREATE TRIGGER ${trigger}
      BEFORE INSERT ON TrilhaAuditoria FOR EACH ROW
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'falha de auditoria controlada'`);
    try {
      const resposta = await requisitar(porta, { pessoaId: pessoaRollbackId, jwt });
      expect(resposta.status).toBe(500);
    } finally {
      await banco.pool.query(`DROP TRIGGER ${trigger}`);
    }
    const [[pessoa]] = await banco.pool.query('SELECT qr_code FROM Pessoa WHERE id = ?', [pessoaRollbackId]);
    expect(pessoa.qr_code).toBe('11111111');
  });

  it('recusa ausência de autor antes de persistir', async () => {
    const controller = require('../src/controllers/peopleController');
    const response = respostaMock();
    await controller.gerarQrCode({ params: { id: pessoaSemAutorId } }, response);
    expect(response.statusCode).toBe(500);
    const [[pessoa]] = await banco.pool.query('SELECT qr_code FROM Pessoa WHERE id = ?', [pessoaSemAutorId]);
    expect(pessoa.qr_code).toBe('11111111');
  });
});
