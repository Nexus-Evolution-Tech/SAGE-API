const express = require('express');
const http = require('http');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'teste-r1-02b-autorizacao-32-caracteres';
const db = require('../src/config/database');
const { gerarToken } = require('../src/utils/jwt');
const authz = require('../src/middlewares/autorizacao');

const start = (app) => new Promise((resolve) => {
  const server = http.createServer(app);
  server.listen(0, '127.0.0.1', () => resolve(server));
});
const get = (server, method, path, authorization) => new Promise((resolve, reject) => {
  const request = http.request({ hostname: '127.0.0.1', port: server.address().port, method, path,
    headers: authorization ? { authorization } : {} }, (response) => {
    response.resume(); response.on('end', () => resolve(response.statusCode));
  });
  request.on('error', reject); request.end();
});

describe('R1-02B — barreira da árvore Express', () => {
  let queryOriginal;
  beforeAll(() => {
    queryOriginal = db.query;
    db.query = async (_sql, [id]) => [[{
      id, ativo: true, papel: id === 1 ? 'ADMINISTRADOR' : 'SECRETARIA', precisa_trocar_senha: false
    }]];
  });
  afterAll(() => { db.query = queryOriginal; });

  it('exercita os quatro tipos, 401 e 403 em HTTP', async () => {
    function monitorCallbackAuth(_req, _res, next) { next(); }
    const app = express(); const router = express.Router();
    router.get('/admin', authz.exige('ADMINISTRADOR'), (_req, res) => res.sendStatus(200));
    router.get('/pre', authz.preAutenticacao('bootstrap'), (_req, res) => res.sendStatus(200));
    router.get('/publica', authz.publica(), (_req, res) => res.sendStatus(200));
    router.post('/propria', authz.autenticacaoPropria('monitorCallbackAuth'), monitorCallbackAuth, (_req, res) => res.sendStatus(200));
    app.use(router); const server = await start(app);
    const admin = `Bearer ${gerarToken({ usuario_id: 1, papel: 'ADMINISTRADOR', emitido_em: new Date().toISOString() })}`;
    const secretaria = `Bearer ${gerarToken({ usuario_id: 2, papel: 'SECRETARIA', emitido_em: new Date().toISOString() })}`;
    expect(await get(server, 'GET', '/admin')).toBe(401);
    expect(await get(server, 'GET', '/admin', secretaria)).toBe(403);
    expect(await get(server, 'GET', '/admin', admin)).toBe(200);
    expect(await get(server, 'GET', '/pre')).toBe(200);
    expect(await get(server, 'GET', '/publica')).toBe(200);
    expect(await get(server, 'POST', '/propria')).toBe(200);
    await new Promise((resolve) => server.close(resolve));
  });

  it('reprova ausência, pública extra e middleware próprio ausente', () => {
    const missing = express(); missing.get('/sem-declaracao', (_req, res) => res.sendStatus(200));
    expect(authz.inspecionarArvoreExpress(missing).falhas[0]).toContain('exatamente uma declaração');
    const extra = express(); extra.get('/publica-extra', authz.publica(), (_req, res) => res.sendStatus(200));
    expect(authz.inspecionarArvoreExpress(extra).falhas[0]).toContain('publica() fora da lista fechada');
    const child = express.Router(); child.get('/health', authz.publica(), (_req, res) => res.sendStatus(200));
    const mounted = authz.instrumentarAplicacao(express()); mounted.use('/interno', child);
    expect(authz.inspecionarArvoreExpress(mounted).falhas[0]).toContain('GET /interno/health');
    const callback = express(); callback.post('/api/notifications/dao', authz.autenticacaoPropria('monitorCallbackAuth'), (_req, res) => res.sendStatus(200));
    expect(authz.inspecionarArvoreExpress(callback).falhas[0]).toContain('middleware monitorCallbackAuth ausente');
  });

  it('audita a árvore real, superfícies duplicadas e lista pública fechada', () => {
    const resultado = authz.inspecionarArvoreExpress(require('../src/app'));
    expect(resultado.falhas).toEqual([]);
    expect(resultado.rotas.filter((r) => r.declaracoes[0]?.tipo === 'publica').map((r) => `${r.metodo} ${r.caminho}`).sort())
      .toEqual(['GET /diagnostico', 'GET /health', 'GET /ready', 'GET /status']);
    expect(resultado.rotas.filter((r) => r.caminho === '/diagnostico-acessos/:id')).toHaveLength(0);
    expect(resultado.rotas.filter((r) => r.caminho === '/dispositivos/:id/diagnostico-acessos')[0].declaracoes[0])
      .toEqual({ tipo: 'papel', papel: 'ADMINISTRADOR' });
    expect(resultado.rotas.filter((r) => r.caminho === '/monitoring/state')).toHaveLength(1);
    expect(resultado.rotas.filter((r) => r.caminho === '/monitoring/monitoring/state')).toHaveLength(0);
    expect(resultado.rotas.find((r) => r.caminho === '/api/notifications/dao').declaracoes[0])
      .toEqual({ tipo: 'autenticacaoPropria', nome: 'monitorCallbackAuth', issue: 67 });
    expect(resultado.rotas.find((r) => r.caminho === '/setup/status').declaracoes[0].tipo).toBe('preAutenticacao');
    expect(resultado.rotas.find((r) => r.caminho === '/escolas').declaracoes[0])
      .toEqual({ tipo: 'papel', papel: 'ADMINISTRADOR' });
  });

  it('mantém monitoramento protegido por administrador em HTTP', async () => {
    const server = await start(require('../src/app'));
    const secretaria = `Bearer ${gerarToken({ usuario_id: 2, papel: 'SECRETARIA', emitido_em: new Date().toISOString() })}`;
    expect(await get(server, 'GET', '/monitoring/state')).toBe(401);
    expect(await get(server, 'GET', '/monitoring/state', secretaria)).toBe(403);
    await new Promise((resolve) => server.close(resolve));
  });
});
