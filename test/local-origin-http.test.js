const http = require('http');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'teste-local-origin-sage-32-caracteres';

const app = require('../src/app');

function request(port, method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({
      hostname: '127.0.0.1', port, method, path,
      headers: {
        Origin: 'http://localhost:3000',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {})
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('chamadas HTTP da configuração inicial local', () => {
  let server;
  let port;

  beforeAll(async () => {
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('aceita preflight e devolve erro específico de campo', async () => {
    const started = Date.now();
    const preflight = await request(port, 'OPTIONS', '/setup/initialize');
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('http://localhost:3000');

    const response = await request(port, 'POST', '/setup/initialize', {
      nome: '', login: '', senha: ''
    });
    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toEqual(expect.objectContaining({
      field: 'nome', message: expect.stringContaining('nome da unidade')
    }));
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
