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
      response.on('end', () => resolve({
        status: response.statusCode,
        body: Buffer.concat(partes).length ? JSON.parse(Buffer.concat(partes).toString()) : null
      }));
    });
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

function respostaMock() {
  const resposta = { statusCode: 200, body: null };
  resposta.status = (statusCode) => { resposta.statusCode = statusCode; return resposta; };
  resposta.json = (body) => { resposta.body = body; return resposta; };
  return resposta;
}

descreveMySql('R1-03B2a — auditoria explícita de horarioAula e lesson', () => {
  let banco;
  let db;
  let server;
  let porta;
  let autores;
  let tokens;
  let turmaId;
  let aulaIds;
  let professorId;
  let materiaId;

  beforeAll(async () => {
    banco = await criarBancoDeTeste('r1_03b2a_horario_lesson');
    process.env.DB_NAME = banco.nome;
    db = require('../src/config/database');
    const { gerarToken } = require('../src/utils/jwt');
    autores = [];
    for (const sufixo of ['um', 'dois']) {
      const [insert] = await banco.pool.query(
        `INSERT INTO Usuario (login, senha_hash, nome_exibicao, papel)
         VALUES (?, ?, ?, 'SECRETARIA')`,
        [`autor.r1_03b2a.${sufixo}`, await bcrypt.hash(`senha-${sufixo}-8`, 10), `Autor ${sufixo}`]
      );
      autores.push(insert.insertId);
    }
    tokens = autores.map((usuario_id) => gerarToken({
      usuario_id, papel: 'SECRETARIA', emitido_em: new Date().toISOString()
    }));

    const [curso] = await banco.pool.query('INSERT INTO Curso (nome, duracao) VALUES (?, ?)', ['Curso R1-03B2a', 3]);
    const [turma] = await banco.pool.query(
      "INSERT INTO Turma (nome, turno, curso_id) VALUES (?, 'MATUTINO', ?)", ['Turma R1-03B2a', curso.insertId]
    );
    turmaId = turma.insertId;
    const [pessoa] = await banco.pool.query("INSERT INTO Pessoa (nome, tipo) VALUES ('Professor sintético', 'PROFESSOR')");
    professorId = pessoa.insertId;
    await banco.pool.query(
      "INSERT INTO Funcionario (id, matricula, tipo_contrato) VALUES (?, '12345', 'INDETERMINADO')", [pessoa.insertId]
    );
    await banco.pool.query('INSERT INTO Professor (id) VALUES (?)', [pessoa.insertId]);
    const [materia] = await banco.pool.query(
      'INSERT INTO Materia (nome, sigla, professor_id, curso_id) VALUES (?, ?, ?, ?)',
      ['Matéria sintética', 'M-S', pessoa.insertId, curso.insertId]
    );
    materiaId = materia.insertId;

    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use('/', require('../src/routes/lessonRoutes'));
    app.use('/', require('../src/routes/horarioAulaRoutes'));
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    porta = server.address().port;
    aulaIds = [];
    for (const nome of ['Aula R1-03B2a A', 'Aula R1-03B2a B']) {
      const resposta = await requisitar(porta, 'POST', '/aulas', {
        nome, professorId, materiaId
      }, tokens[0]);
      expect(resposta.status).toBe(201);
      aulaIds.push(resposta.body.id);
    }
  }, 120000);

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (db) await new Promise((resolve) => db.end(resolve));
    if (banco) await banco.destruir();
  });

  it('audita as seis mutações com autores distintos e detalhe nulo', async () => {
    const horario = await requisitar(porta, 'POST', '/horarios-aulas', {
      turmaId, aulaId: aulaIds[0], diaSemana: 'SEGUNDA', horario: '07:30-08:20', divisao: 'INT'
    }, tokens[0]);
    expect(horario.status).toBe(201);
    const horarioId = horario.body.id;

    expect((await requisitar(porta, 'PUT', `/aulas/${aulaIds[0]}`, { nome: 'Aula R1-03B2a A editada' }, tokens[1])).status).toBe(200);
    expect((await requisitar(porta, 'PUT', `/horarios-aulas/${horarioId}`, { horario: '08:20-09:10' }, tokens[1])).status).toBe(200);
    expect((await requisitar(porta, 'DELETE', `/horarios-aulas/${horarioId}`, undefined, tokens[0])).status).toBe(204);
    expect((await requisitar(porta, 'DELETE', `/aulas/${aulaIds[1]}`, undefined, tokens[1])).status).toBe(200);

    const [eventos] = await banco.pool.query(
      `SELECT usuario_id, acao, entidade, entidade_id, detalhe
         FROM TrilhaAuditoria WHERE entidade IN ('Aula', 'HorarioAula') ORDER BY id`
    );
    expect(eventos).toEqual(expect.arrayContaining([
      { usuario_id: autores[0], acao: 'REGISTRO_CRIADO', entidade: 'Aula', entidade_id: aulaIds[0], detalhe: null },
      { usuario_id: autores[0], acao: 'REGISTRO_CRIADO', entidade: 'HorarioAula', entidade_id: horarioId, detalhe: null },
      { usuario_id: autores[1], acao: 'REGISTRO_EDITADO', entidade: 'Aula', entidade_id: aulaIds[0], detalhe: null },
      { usuario_id: autores[1], acao: 'REGISTRO_EDITADO', entidade: 'HorarioAula', entidade_id: horarioId, detalhe: null },
      { usuario_id: autores[0], acao: 'REGISTRO_DELETADO', entidade: 'HorarioAula', entidade_id: horarioId, detalhe: null },
      { usuario_id: autores[1], acao: 'REGISTRO_DELETADO', entidade: 'Aula', entidade_id: aulaIds[1], detalhe: null }
    ]));
    expect(eventos.filter((evento) => evento.entidade_id === aulaIds[0]).map((evento) => evento.usuario_id))
      .toEqual([autores[0], autores[1]]);
    expect(new Set(eventos.map((evento) => evento.usuario_id))).toEqual(new Set(autores));
  });

  it('faz rollback da aula quando registrarAuditoria falha', async () => {
    const trigger = `tr_r1_03b2a_auditoria_falha_${process.pid}`;
    await banco.pool.query(`CREATE TRIGGER ${trigger}
      BEFORE INSERT ON TrilhaAuditoria FOR EACH ROW
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'falha de auditoria controlada'`);
    try {
      const resposta = await requisitar(porta, 'POST', '/aulas', {
        nome: 'Aula R1-03B2a rollback', professorId, materiaId
      }, tokens[0]);
      expect(resposta.status).toBe(500);
    } finally {
      await banco.pool.query(`DROP TRIGGER ${trigger}`);
    }
    const [[resultado]] = await banco.pool.query('SELECT COUNT(*) AS total FROM Aula WHERE nome = ?', ['Aula R1-03B2a rollback']);
    expect(Number(resultado.total)).toBe(0);
  });

  it('recusa autor ausente antes de persistir', async () => {
    const controller = require('../src/controllers/lessonController');
    const response = respostaMock();
    await controller.criar({ body: { nome: 'Aula R1-03B2a sem autor', professorId, materiaId } }, response);
    expect(response.statusCode).toBe(500);
    const [[resultado]] = await banco.pool.query('SELECT COUNT(*) AS total FROM Aula WHERE nome = ?', ['Aula R1-03B2a sem autor']);
    expect(Number(resultado.total)).toBe(0);
  });
});
