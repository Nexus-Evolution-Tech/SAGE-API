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
        const body = Buffer.concat(partes).toString();
        resolve({ status: response.statusCode, body: body ? JSON.parse(body) : null });
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
  resposta.send = (body) => { resposta.body = body; return resposta; };
  return resposta;
}

descreveMySql('R1-03B2a2 — auditoria das mutações explícitas', () => {
  let banco;
  let db;
  let server;
  let porta;
  let autores;
  let tokens;
  let funcionarioId;
  let pessoaId;
  let dispositivoId;
  let solicitacoes;

  beforeAll(async () => {
    banco = await criarBancoDeTeste('r1_03b2a2_explicitas');
    process.env.DB_NAME = banco.nome;
    db = require('../src/config/database');
    const { gerarToken } = require('../src/utils/jwt');

    autores = [];
    for (const sufixo of ['um', 'dois']) {
      const [insert] = await banco.pool.query(
        `INSERT INTO Usuario (login, senha_hash, nome_exibicao, papel)
         VALUES (?, ?, ?, 'SECRETARIA')`,
        [`autor.r1_03b2a2.${sufixo}`, await bcrypt.hash(`senha-${sufixo}-8`, 10), `Autor ${sufixo}`]
      );
      autores.push(insert.insertId);
    }
    tokens = autores.map((usuario_id) => gerarToken({
      usuario_id, papel: 'SECRETARIA', emitido_em: new Date().toISOString()
    }));

    const [pessoa] = await banco.pool.query(
      "INSERT INTO Pessoa (nome, tipo) VALUES ('Professor sintético R1-03B2a2', 'PROFESSOR')"
    );
    pessoaId = pessoa.insertId;
    await banco.pool.query(
      "INSERT INTO Funcionario (id, matricula, tipo_contrato) VALUES (?, '12345', 'INDETERMINADO')",
      [pessoaId]
    );
    await banco.pool.query('INSERT INTO Professor (id) VALUES (?)', [pessoaId]);
    funcionarioId = pessoaId;

    const [dispositivo] = await banco.pool.query(
      "INSERT INTO Dispositivo (nome, modelo) VALUES ('Dispositivo sintético R1-03B2a2', 'IDBlock')"
    );
    dispositivoId = dispositivo.insertId;

    const [aluno] = await banco.pool.query(
      "INSERT INTO Pessoa (nome, tipo) VALUES ('Aluno sintético R1-03B2a2', 'ALUNO')"
    );
    await banco.pool.query(
      "INSERT INTO Aluno (id, ra, status) VALUES (?, '1234567890', 'EM CURSO')", [aluno.insertId]
    );
    const ids = [];
    for (const motivo of ['motivo sintético A', 'motivo sintético B']) {
      const [solicitacao] = await banco.pool.query(
        "INSERT INTO SolicitacaoAcesso (aluno_id, motivo, status) VALUES (?, ?, 'PENDENTE')",
        [aluno.insertId, motivo]
      );
      ids.push(solicitacao.insertId);
    }
    solicitacoes = ids;

    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use('/', require('../src/routes/materiaRoutes'));
    app.use('/', require('../src/routes/funcionarioHorarioRoutes'));
    app.use('/', require('../src/routes/acessSolicitationRoutes'));
    app.use('/', require('../src/routes/accessRoutes'));
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    porta = server.address().port;
  }, 120000);

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (db) await new Promise((resolve) => db.end(resolve));
    if (banco) await banco.destruir();
  });

  it('audita mutações cobertas com autores distintos e detalhe nulo', async () => {
    const materia = await requisitar(porta, 'POST', '/materias', { nome: 'Matéria sintética R1-03B2a2' }, tokens[0]);
    expect(materia.status).toBe(201);
    expect((await requisitar(porta, 'DELETE', `/materias/${materia.body.id}`, undefined, tokens[1])).status).toBe(204);

    expect((await requisitar(porta, 'PUT', `/pessoas/${funcionarioId}/horario-fixo`, {
      horarios: [{ dia_semana: 'SEGUNDA', hora_entrada: '07:30', hora_saida: '16:30' }],
      usar_horario_fixo: true
    }, tokens[0])).status).toBe(200);

    expect((await requisitar(porta, 'PATCH', `/solicitacoes-acessos/aprovar/${solicitacoes[0]}`, {}, tokens[1])).status).toBe(200);
    expect((await requisitar(porta, 'PATCH', `/solicitacoes-acessos/negar/${solicitacoes[1]}`, {}, tokens[0])).status).toBe(200);

    expect((await requisitar(porta, 'POST', '/acessos', {
      pessoa_id: pessoaId, dispositivo_id: dispositivoId, status: 'ENTRADA', metodo_auth: 'QR_CODE'
    }, tokens[0])).status).toBe(201);
    expect((await requisitar(porta, 'POST', '/acessos', {
      pessoa_id: pessoaId, dispositivo_id: dispositivoId, status: 'SAIDA', metodo_auth: 'QR_CODE'
    }, tokens[1])).status).toBe(201);

    const [eventos] = await banco.pool.query(
      `SELECT usuario_id, acao, entidade, entidade_id, detalhe
       FROM TrilhaAuditoria WHERE entidade IN ('Materia', 'FuncionarioHorario', 'SolicitacaoAcesso', 'Acesso')
       ORDER BY id`
    );
    expect(eventos).toEqual(expect.arrayContaining([
      expect.objectContaining({ usuario_id: autores[0], acao: 'REGISTRO_CRIADO', entidade: 'Materia', detalhe: null }),
      expect.objectContaining({ usuario_id: autores[1], acao: 'REGISTRO_DELETADO', entidade: 'Materia', detalhe: null }),
      expect.objectContaining({ usuario_id: autores[0], acao: 'REGISTRO_EDITADO', entidade: 'FuncionarioHorario', detalhe: null }),
      expect.objectContaining({ usuario_id: autores[1], acao: 'REGISTRO_EDITADO', entidade: 'SolicitacaoAcesso', detalhe: null }),
      expect.objectContaining({ usuario_id: autores[0], acao: 'REGISTRO_EDITADO', entidade: 'SolicitacaoAcesso', detalhe: null }),
      expect.objectContaining({ usuario_id: autores[0], acao: 'REGISTRO_CRIADO', entidade: 'Acesso', detalhe: null }),
      expect.objectContaining({ usuario_id: autores[1], acao: 'REGISTRO_CRIADO', entidade: 'Acesso', detalhe: null })
    ]));
  });

  it('faz rollback do negócio quando a auditoria falha', async () => {
    const trigger = `tr_r1_03b2a2_auditoria_falha_${process.pid}`;
    await banco.pool.query(`CREATE TRIGGER ${trigger}
      BEFORE INSERT ON TrilhaAuditoria FOR EACH ROW
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'falha de auditoria controlada'`);
    try {
      const resposta = await requisitar(porta, 'POST', '/materias', { nome: 'Matéria rollback R1-03B2a2' }, tokens[0]);
      expect(resposta.status).toBe(500);
    } finally {
      await banco.pool.query(`DROP TRIGGER ${trigger}`);
    }
    const [[resultado]] = await banco.pool.query('SELECT COUNT(*) AS total FROM Materia WHERE nome = ?', ['Matéria rollback R1-03B2a2']);
    expect(Number(resultado.total)).toBe(0);
  });

  it('recusa ausência de autor antes de persistir', async () => {
    const controller = require('../src/controllers/materiaController');
    const response = respostaMock();
    await controller.criar({ body: { nome: 'Matéria sem autor R1-03B2a2' } }, response);
    expect(response.statusCode).toBe(500);
    const [[resultado]] = await banco.pool.query('SELECT COUNT(*) AS total FROM Materia WHERE nome = ?', ['Matéria sem autor R1-03B2a2']);
    expect(Number(resultado.total)).toBe(0);
  });
});
