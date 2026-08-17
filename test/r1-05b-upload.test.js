const fs = require('fs').promises;
const http = require('http');
const os = require('os');
const path = require('path');
const express = require('express');
const multer = require('multer');

const ambienteAnterior = {
  SAGE_DATA_DIR: process.env.SAGE_DATA_DIR,
  UPLOAD_MAX_SIZE_MB: process.env.UPLOAD_MAX_SIZE_MB,
  JWT_SECRET: process.env.JWT_SECRET
};
const dataDir = path.join(os.tmpdir(), `sage-r1-05b-${process.pid}`);
process.env.SAGE_DATA_DIR = dataDir;
process.env.UPLOAD_MAX_SIZE_MB = '1';
process.env.JWT_SECRET = 'teste-r1-05b-jwt-secret-32-caracteres';

const upload = require('../src/middlewares/uploadFoto');
const { exige, inspecionarArvoreExpress } = require('../src/middlewares/autorizacao');
const { paths } = require('../src/config/paths');
const dataRoutes = require('../src/routes/dataRoutes');
const uploadPlanilha = dataRoutes.stack.find((layer) => layer.route?.path === '/dados/importar/ping').route.stack[1].handle;

const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');

function iniciar(app) {
  const server = http.createServer(app);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function enviar(server, caminho, campo, conteudo = png, nome = 'foto.png', tipo = 'image/png') {
  const form = new FormData();
  form.append(campo, new Blob([conteudo], { type: tipo }), nome);
  const resposta = await fetch(`http://127.0.0.1:${server.address().port}${caminho}`, {
    method: 'POST', body: form
  });
  return { status: resposta.status, body: await resposta.text() };
}

async function temporarios() {
  return (await fs.readdir(paths.uploads)).filter((nome) => nome.startsWith('temp_'));
}

describe('R1-05B — upload fechado antes da gravação', () => {
  let server;

  beforeEach(async () => {
    await fs.mkdir(paths.uploads, { recursive: true });
  });

  afterEach(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    server = undefined;
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  afterAll(() => {
    for (const [nome, valor] of Object.entries(ambienteAnterior)) {
      if (valor === undefined) delete process.env[nome];
      else process.env[nome] = valor;
    }
  });

  it('recusa multipart anônimo nas cinco superfícies sem criar arquivo', async () => {
    const app = express();
    const autenticar = exige('SECRETARIA');
    for (const [caminho, campo] of [
      ['/pessoas/upload/1', 'foto'], ['/areas/upload/1', 'foto'],
      ['/unidade/upload-logo', 'logo'], ['/foto_escolas', 'foto'], ['/dados/importar', 'planilha']
    ]) app.post(caminho, autenticar, upload.single(campo), (_req, res) => res.sendStatus(204));
    server = await iniciar(app);

    for (const [caminho, campo] of [
      ['/pessoas/upload/1', 'foto'], ['/areas/upload/1', 'foto'],
      ['/unidade/upload-logo', 'logo'], ['/foto_escolas', 'foto'], ['/dados/importar', 'planilha']
    ]) await expect(enviar(server, caminho, campo)).resolves.toMatchObject({ status: 401 });
    expect(await temporarios()).toEqual([]);
  });

  it('responde 413 e remove o temporário quando o arquivo excede o limite', async () => {
    const app = express();
    app.post('/upload', upload.single('foto'), (_req, res) => res.sendStatus(204));
    server = await iniciar(app);
    const resposta = await enviar(server, '/upload', 'foto', Buffer.alloc(1024 * 1024 + 1), 'foto.png');
    expect(resposta.status).toBe(413);
    expect(await temporarios()).toEqual([]);
  });

  it('responde 415 e remove o temporário quando a assinatura não corresponde', async () => {
    const app = express();
    app.post('/upload', upload.single('foto'), (_req, res) => res.sendStatus(204));
    server = await iniciar(app);
    const resposta = await enviar(server, '/upload', 'foto', Buffer.from('MZ-executavel'), 'foto.png');
    expect(resposta.status).toBe(415);
    expect(await temporarios()).toEqual([]);
  });

  it('mantém upload legítimo e limpa apenas o temporário após a resposta', async () => {
    const app = express();
    app.post('/upload', upload.single('foto'), (req, res) => res.json({ ok: Boolean(req.file) }));
    server = await iniciar(app);
    await expect(enviar(server, '/upload', 'foto')).resolves.toMatchObject({ status: 200 });
    expect(await temporarios()).toEqual([]);
  });

  it('limpa temporário após sucesso de planilha', async () => {
    const app = express(); app.post('/planilha', uploadPlanilha, (_req, res) => res.sendStatus(200)); server = await iniciar(app);
    const resposta = await enviar(server, '/planilha', 'planilha', Buffer.from('504b0304', 'hex'),
      'dados.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(resposta.status).toBe(200); expect(await temporarios()).toEqual([]);
  });

  it('guard reprova multer antes da autorização', () => {
    const app = express();
    const autenticar = exige('SECRETARIA');
    app.post('/rota-segura', autenticar, upload.single('foto'), (_req, res) => res.end());
    app.post('/rota-insegura', multer().single('foto'), autenticar, (_req, res) => res.end());
    const resultado = inspecionarArvoreExpress(app);
    expect(resultado.falhas).toContain('POST /rota-insegura: multer deve vir depois da autorização');
    expect(resultado.falhas).not.toContain('POST /rota-segura: multer deve vir depois da autorização');
  });
});
