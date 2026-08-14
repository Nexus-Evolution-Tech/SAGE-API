const express = require('express');
const http = require('http');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'teste-r1-02a-autorizacao-32-caracteres';

function requisitar(porta, caminho, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port: porta, path: caminho, headers }, (response) => {
      const partes = [];
      response.on('data', (parte) => partes.push(parte));
      response.on('end', () => resolve({
        status: response.statusCode,
        body: JSON.parse(Buffer.concat(partes).toString('utf8'))
      }));
    });
    request.on('error', reject);
    request.end();
  });
}

describe('R1-02A — primitivas de autorização', () => {
  let server;
  let porta;
  let gerarToken;
  let usuarioService;
  let buscarParaSessaoOriginal;
  let obterDeclaracaoAutorizacao;

  beforeAll(async () => {
    usuarioService = require('../src/services/usuarioService');
    buscarParaSessaoOriginal = usuarioService.buscarParaSessao;
    usuarioService.buscarParaSessao = async (id) => ({
      1: { id: 1, ativo: true, papel: 'ADMINISTRADOR', precisa_trocar_senha: false },
      2: { id: 2, ativo: true, papel: 'SECRETARIA', precisa_trocar_senha: false },
      3: { id: 3, ativo: true, papel: 'DESCONHECIDO', precisa_trocar_senha: false },
      4: { id: 4, ativo: true, precisa_trocar_senha: false }
    }[id]);

    delete require.cache[require.resolve('../src/middlewares/autenticar')];
    delete require.cache[require.resolve('../src/middlewares/autorizacao')];
    const autorizacao = require('../src/middlewares/autorizacao');
    ({ gerarToken } = require('../src/utils/jwt'));
    ({ obterDeclaracaoAutorizacao } = autorizacao);

    const app = express();
    const router = express.Router();
    router.get('/admin', autorizacao.exige('ADMINISTRADOR'), (_req, res) => res.json({ ok: true }));
    router.get('/secretaria', autorizacao.exige('SECRETARIA'), (_req, res) => res.json({ ok: true }));
    router.get('/publica', autorizacao.publica(), (_req, res) => res.json({ ok: true }));
    router.get('/sem-declaracao', (_req, res) => res.json({ ok: true }));
    app.use(router);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    porta = server.address().port;

    const adminLayer = router.stack.find((layer) => layer.route?.path === '/admin');
    const secretariaLayer = router.stack.find((layer) => layer.route?.path === '/secretaria');
    const publicaLayer = router.stack.find((layer) => layer.route?.path === '/publica');
    const semDeclaracaoLayer = router.stack.find((layer) => layer.route?.path === '/sem-declaracao');
    expect(obterDeclaracaoAutorizacao(adminLayer.route.stack[0].handle)).toEqual({ tipo: 'papel', papel: 'ADMINISTRADOR' });
    expect(obterDeclaracaoAutorizacao(secretariaLayer.route.stack[0].handle)).toEqual({ tipo: 'papel', papel: 'SECRETARIA' });
    expect(obterDeclaracaoAutorizacao(publicaLayer.route.stack[0].handle)).toEqual({ tipo: 'publica' });
    expect(obterDeclaracaoAutorizacao(semDeclaracaoLayer.route.stack[0].handle)).toBeNull();
  });

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    usuarioService.buscarParaSessao = buscarParaSessaoOriginal;
    delete require.cache[require.resolve('../src/middlewares/autenticar')];
    delete require.cache[require.resolve('../src/middlewares/autorizacao')];
  });

  it('distingue autenticação de autorização e aplica hierarquia de papéis', async () => {
    const tokenAdmin = gerarToken({ usuario_id: 1, papel: 'ADMINISTRADOR', emitido_em: new Date().toISOString() });
    const tokenSecretaria = gerarToken({ usuario_id: 2, papel: 'SECRETARIA', emitido_em: new Date().toISOString() });

    expect((await requisitar(porta, '/admin')).status).toBe(401);
    expect((await requisitar(porta, '/admin', { authorization: 'Bearer invalido' })).status).toBe(401);
    expect((await requisitar(porta, '/admin', { authorization: `Bearer ${tokenAdmin}` })).status).toBe(200);
    expect((await requisitar(porta, '/admin', { authorization: `Bearer ${tokenSecretaria}` })).status).toBe(403);
    expect((await requisitar(porta, '/secretaria', { authorization: `Bearer ${tokenSecretaria}` })).status).toBe(200);
    expect((await requisitar(porta, '/secretaria', { authorization: `Bearer ${tokenAdmin}` })).status).toBe(200);
    expect((await requisitar(porta, '/admin?papel=ADMINISTRADOR')).status).toBe(401);
  });

  it('recusa papel ausente ou desconhecido e libera pública somente por declaração explícita', async () => {
    const tokenPapelDesconhecido = gerarToken({ usuario_id: 3, papel: 'SECRETARIA', emitido_em: new Date().toISOString() });
    const tokenSemPapel = gerarToken({ usuario_id: 4, papel: 'SECRETARIA', emitido_em: new Date().toISOString() });

    expect((await requisitar(porta, '/secretaria', { authorization: `Bearer ${tokenPapelDesconhecido}` })).status).toBe(401);
    expect((await requisitar(porta, '/secretaria', { authorization: `Bearer ${tokenSemPapel}` })).status).toBe(401);
    expect((await requisitar(porta, '/publica')).status).toBe(200);
  });

  it('não cria declaração para papel arbitrário', () => {
    expect(() => require('../src/middlewares/autorizacao').exige('DIRECAO')).toThrow(TypeError);
  });
});
