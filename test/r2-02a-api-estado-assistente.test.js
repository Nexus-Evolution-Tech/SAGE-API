const http = require('http');
const bcrypt = require('bcrypt');
const { criarBancoDeTeste } = require('./helpers/banco');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'teste-r2-02a-segredo-sintetico-32';
process.env.NODE_ENV = 'test';

let banco;
let app;
let server;
let porta;
let adminToken;
let secretariaToken;

function requisitar(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({ hostname: '127.0.0.1', port: porta, method, path,
      headers: { ...headers, ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}) } }, (res) => {
      const partes = [];
      res.on('data', (parte) => partes.push(parte));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(partes).toString()) }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const admin = () => ({ Authorization: `Bearer ${adminToken}` });
const secretaria = () => ({ Authorization: `Bearer ${secretariaToken}` });
const versao = (n) => ({ ...admin(), 'If-Match': `"${n}"` });
const retomar = (step, n, body, headers = {}) => requisitar('POST', `/onboarding/steps/${step}/resume`, body, { ...versao(n), ...headers });

beforeAll(async () => {
  banco = await criarBancoDeTeste('r2_02a_estado_assistente');
  process.env.DB_NAME = banco.nome;
  app = require('../src/app');
  const [usuarios] = await banco.pool.query(
    `INSERT INTO Usuario (login, senha_hash, nome_exibicao, papel, ativo, precisa_trocar_senha)
     VALUES (?, ?, ?, 'ADMINISTRADOR', TRUE, FALSE), (?, ?, ?, 'SECRETARIA', TRUE, FALSE)`,
    ['r2_admin_sintetico', await bcrypt.hash('senha-admin-sintetica', 4), 'Admin de teste',
      'r2_secretaria_sintetica', await bcrypt.hash('senha-secretaria-sintetica', 4), 'Secretaria de teste']
  );
  const { gerarToken } = require('../src/utils/jwt');
  adminToken = gerarToken({ usuario_id: usuarios.insertId, papel: 'ADMINISTRADOR', emitido_em: new Date().toISOString() });
  secretariaToken = gerarToken({ usuario_id: usuarios.insertId + 1, papel: 'SECRETARIA', emitido_em: new Date().toISOString() });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  porta = server.address().port;
}, 120000);

beforeEach(async () => { await banco.pool.query('DELETE FROM onboarding_state'); });

afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (banco) await banco.destruir();
});

it('1. GET inicial sem linha retorna a projeção exata', async () => {
  const resposta = await requisitar('GET', '/onboarding', undefined, admin());
  expect(resposta.status).toBe(200);
  expect(Object.keys(resposta.body)).toEqual(['status', 'current_step', 'completed_steps', 'next_step', 'version']);
  expect(resposta.body).toEqual({ status: 'NAO_INICIADO', current_step: null, completed_steps: [], next_step: 'ESCOLA_CONTA_ADMINISTRADOR', version: 0 });
});

it('2. migration cria estrutura e restringe escopo a uma linha', async () => {
  const [[tabela]] = await banco.pool.query('SHOW CREATE TABLE onboarding_state');
  const ddl = Object.values(tabela).join(' ');
  expect(ddl).toMatch(/PRIMARY KEY \(`id`\)/i);
  expect(ddl).toMatch(/CHECK\s+\(\s*\(?\s*`id`\s*=\s*1\s*\)?\s*\)/i);
  expect(ddl).not.toMatch(/school_id|cpf|senha|token|endereco/i);
  await expect(banco.pool.query('INSERT INTO onboarding_state (id, completed_steps) VALUES (2, JSON_ARRAY())')).rejects.toThrow();
  await banco.pool.query('INSERT INTO onboarding_state (id, completed_steps) VALUES (1, JSON_ARRAY())');
  await expect(banco.pool.query('INSERT INTO onboarding_state (id, completed_steps) VALUES (1, JSON_ARRAY())')).rejects.toThrow();
});

it('3. primeiro resume inicia o passo um e incrementa uma vez', async () => {
  const resposta = await retomar('escola-conta-administrador', 0);
  expect(resposta.status).toBe(200);
  expect(resposta.body).toEqual({ status: 'EM_ANDAMENTO', current_step: 'ESCOLA_CONTA_ADMINISTRADOR', completed_steps: [], next_step: 'ESCOLA_CONTA_ADMINISTRADOR', version: 1 });
});

it('4. repetição idempotente preserva a linha e a versão', async () => {
  const primeira = await retomar('escola-conta-administrador', 0);
  const segunda = await retomar('escola-conta-administrador', 1);
  const [[estado]] = await banco.pool.query('SELECT COUNT(*) AS linhas, MAX(version) AS version FROM onboarding_state WHERE id = 1');
  expect(segunda).toEqual(primeira);
  expect(estado).toEqual({ linhas: 1, version: 1 });
});

it('5. rejeita passo inválido, fora de ordem e pré-condição ausente', async () => {
  expect((await retomar('inexistente', 0)).status).toBe(400);
  expect((await retomar('area', 0)).status).toBe(409);
  await retomar('escola-conta-administrador', 0);
  const foraDeOrdem = await retomar('area', 1);
  expect(foraDeOrdem.status).toBe(409);
  const [[estado]] = await banco.pool.query('SELECT status, current_step, version FROM onboarding_state WHERE id = 1');
  expect(estado).toEqual({ status: 'EM_ANDAMENTO', current_step: 'ESCOLA_CONTA_ADMINISTRADOR', version: 1 });
});

it('6. If-Match ausente, malformado e stale não mutam o estado', async () => {
  expect((await requisitar('POST', '/onboarding/steps/escola-conta-administrador/resume', undefined, admin())).status).toBe(428);
  expect((await retomar('escola-conta-administrador', 0, undefined, { 'If-Match': '0' })).status).toBe(400);
  expect((await retomar('escola-conta-administrador', 0)).status).toBe(200);
  expect((await retomar('escola-conta-administrador', 0)).status).toBe(412);
  const [[estado]] = await banco.pool.query('SELECT version FROM onboarding_state WHERE id = 1');
  expect(estado.version).toBe(1);
});

it('7. concorrência com a mesma versão aceita no máximo uma escrita', async () => {
  const respostas = await Promise.all([
    retomar('escola-conta-administrador', 0), retomar('escola-conta-administrador', 0)
  ]);
  expect(respostas.filter(({ status }) => status === 200)).toHaveLength(1);
  const [[estado]] = await banco.pool.query('SELECT COUNT(*) AS linhas, MAX(version) AS version FROM onboarding_state');
  expect(estado).toEqual({ linhas: 1, version: 1 });
});

it('8. ACL permite ADMINISTRADOR e falha fechado para anônimo e SECRETARIA', async () => {
  expect((await requisitar('GET', '/onboarding')).status).toBe(401);
  expect((await requisitar('POST', '/onboarding/steps/escola-conta-administrador/resume', undefined, { 'If-Match': '"0"' })).status).toBe(401);
  expect((await requisitar('GET', '/onboarding', undefined, secretaria())).status).toBe(403);
  expect((await retomar('escola-conta-administrador', 0, undefined, secretaria())).status).toBe(403);
  expect((await requisitar('GET', '/onboarding', undefined, admin())).status).toBe(200);
});

it('9. estado persistido sobrevive ao reinício do servidor', async () => {
  await retomar('escola-conta-administrador', 0);
  await new Promise((resolve) => server.close(resolve));
  server = http.createServer(require('../src/app'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  porta = server.address().port;
  const resposta = await requisitar('GET', '/onboarding', undefined, admin());
  expect(resposta.body.version).toBe(1);
  expect(resposta.body.current_step).toBe('ESCOLA_CONTA_ADMINISTRADOR');
});

it('10. banco, resposta e logs não contêm campos proibidos nem PII', async () => {
  const logger = require('../src/config/logger');
  const log = vi.spyOn(logger, 'http');
  const segredo = 'senha-sintetica-cpf-00000000000-token';
  const resposta = await retomar('escola-conta-administrador', 0, { school_id: segredo, cpf: segredo, senha: segredo, token: segredo });
  const leitura = await requisitar('GET', '/onboarding', undefined, admin());
  const [[estado]] = await banco.pool.query('SELECT * FROM onboarding_state WHERE id = 1');
  expect(resposta.status).toBe(400);
  expect(JSON.stringify({ resposta, leitura, estado, logs: log.mock.calls })).not.toContain(segredo);
  expect(Object.keys(leitura.body)).toEqual(['status', 'current_step', 'completed_steps', 'next_step', 'version']);
  log.mockRestore();
});
