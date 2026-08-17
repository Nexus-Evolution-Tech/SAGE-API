const fs = require('fs');
const fsp = require('fs/promises');
const http = require('http');
const os = require('os');
const path = require('path');
const express = require('express');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'teste-r1-05d-jwt-secret-32-caracteres';

const { exige, inspecionarArvoreExpress } = require('../src/middlewares/autorizacao');
const peopleRoutes = require('../src/routes/peopleRoutes');
const {
  gerarNomeFotoOpaco,
  migrarFotosExistentes,
  resolverFotoExistente,
  servirFotoPessoa
} = require('../src/services/peopleService');

function iniciar(app) {
  const server = http.createServer(app);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

describe('R1-05D1 - fotos de pessoa', () => {
  let base;

  beforeEach(async () => {
    base = await fsp.mkdtemp(path.join(os.tmpdir(), 'sage-r1-05d-'));
    await fsp.mkdir(path.join(base, 'pessoas'));
  });

  afterEach(async () => fsp.rm(base, { recursive: true, force: true }));

  it('recusa anônimo e declara leitura com exige(SECRETARIA)', async () => {
    const app = express();
    app.use('/', peopleRoutes);
    const resultado = inspecionarArvoreExpress(app);
    const rota = resultado.rotas.find((item) => item.metodo === 'GET' && item.caminho === '/pessoas/:id/foto');
    expect(rota.declaracoes).toEqual([{ tipo: 'papel', papel: 'SECRETARIA' }]);

    const server = await iniciar(app);
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/pessoas/1/foto`);
      expect(response.status).toBe(401);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('gera nome CSPRNG opaco e preserva contenção de caminho', () => {
    const nome = gerarNomeFotoOpaco('.png', path.join(base, 'pessoas'));
    expect(nome).toMatch(/^[a-f0-9]{64}\.png$/);
    expect(nome).not.toMatch(/^pessoa_1/);
    expect(() => resolverFotoExistente('../../fora.png', base)).toThrow('Caminho de foto fora de uploads');
  });

  it('handler autorizado envia mídia sem cache', async () => {
    const nome = 'a'.repeat(64) + '.png';
    await fsp.writeFile(path.join(base, 'pessoas', nome), Buffer.from('foto autorizada'));
    const database = { query: vi.fn(async () => [[{ foto: nome }]]) };
    const response = {
      headersSent: false,
      set: vi.fn(),
      sendFile: vi.fn((_arquivo, _opcoes, callback) => callback()),
      status: vi.fn(function status(code) { this.statusCode = code; return this; }),
      end: vi.fn(),
      json: vi.fn()
    };
    await servirFotoPessoa({ params: { id: 7 } }, response, { database, baseUploads: base });
    expect(response.set).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(response.sendFile).toHaveBeenCalledWith(
      path.join(base, 'pessoas', nome), { cacheControl: false, lastModified: false }, expect.any(Function)
    );
  });

  it('migra arquivo legado sem perder o original quando a atualização falha', async () => {
    const origem = path.join(base, 'pessoas', 'pessoa_7.png');
    await fsp.writeFile(origem, Buffer.from('foto de teste'));
    const atualizacoes = [];
    const database = {
      query: vi.fn(async (sql, params) => {
        if (sql.startsWith('SELECT')) return [[{ id: 7, foto: 'pessoa_7.png' }]];
        atualizacoes.push(params);
        return [{ affectedRows: 1 }];
      })
    };
    const resultado = await migrarFotosExistentes({ database, baseUploads: base });
    expect(resultado).toEqual({ migrados: 1, ignorados: 0, falhas: 0 });
    expect(atualizacoes[0][0]).toMatch(/^[a-f0-9]{64}\.png$/);
    expect(fs.existsSync(origem)).toBe(false);

    const origemFalha = path.join(base, 'pessoas', 'pessoa_8.png');
    await fsp.writeFile(origemFalha, Buffer.from('foto preservada'));
    const falha = { query: vi.fn(async (sql) => {
      if (sql.startsWith('SELECT')) return [[{ id: 8, foto: 'pessoa_8.png' }]];
      throw new Error('falha de banco');
    }) };
    const resultadoFalha = await migrarFotosExistentes({ database: falha, baseUploads: base });
    expect(resultadoFalha.falhas).toBe(1);
    expect(fs.existsSync(origemFalha)).toBe(true);
  });
});
