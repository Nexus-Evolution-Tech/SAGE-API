const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');
const db = require('../src/config/database');
const logger = require('../src/config/logger');
const { paths } = require('../src/config/paths');
const projecoes = require('../src/config/projecoes');
const peopleService = require('../src/services/peopleService');
const peopleController = require('../src/controllers/peopleController');
const { exportarDados } = require('../src/services/exportService');
const { importarPlanilha } = require('../src/services/importService');

const resposta = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn() });

describe('R1-04E - filesystem de fotos e segredos de catraca', () => {
  afterEach(() => vi.restoreAllMocks());

  it('remove traversal externo sem apagar o alvo e registra o código', async () => {
    const fora = fs.mkdtempSync(path.join(os.tmpdir(), 'sage-r1-04e-'));
    const alvo = path.join(fora, 'nao-apagar.txt');
    fs.writeFileSync(alvo, 'intacto');
    const foto = path.relative(path.join(paths.uploads, 'pessoas'), alvo);
    vi.spyOn(db, 'query').mockResolvedValueOnce([[{ foto }]]);
    const erro = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const res = resposta();

    await peopleService.removerFotoPessoa({ params: { pessoa_id: '901' } }, res);

    expect(fs.readFileSync(alvo, 'utf8')).toBe('intacto');
    expect(res.status).toHaveBeenCalledWith(400);
    expect(erro).toHaveBeenCalledWith(expect.stringContaining('PESSOA_FOTO_CAMINHO_FORA_UPLOADS'));
    fs.rmSync(fora, { recursive: true, force: true });
  });

  it('recusa symlink em uploads que aponta para fora', async () => {
    const fora = fs.mkdtempSync(path.join(os.tmpdir(), 'sage-r1-04e-'));
    const alvo = path.join(fora, 'nao-apagar.txt');
    const link = path.join(paths.uploads, 'pessoas', `r1-04e-link-${process.pid}`);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.writeFileSync(alvo, 'intacto');
    fs.symlinkSync(alvo, link, 'file');
    vi.spyOn(db, 'query').mockResolvedValueOnce([[{ foto: path.basename(link) }]]);
    const erro = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const res = resposta();

    await peopleService.removerFotoPessoa({ params: { pessoa_id: '902' } }, res);

    expect(fs.readFileSync(alvo, 'utf8')).toBe('intacto');
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(erro).toHaveBeenCalledWith(expect.stringContaining('PESSOA_FOTO_CAMINHO_FORA_UPLOADS'));
    fs.unlinkSync(link);
    fs.rmSync(fora, { recursive: true, force: true });
  });

  it('rejeita PATCH de foto e não altera a coluna', async () => {
    const connection = { beginTransaction: vi.fn(), rollback: vi.fn().mockResolvedValue(), release: vi.fn(), query: vi.fn() };
    vi.spyOn(db, 'getConnection').mockResolvedValue(connection);
    const res = resposta();

    await peopleController.editar({ params: { id: '903' }, body: { foto: 'pessoa_903.png' }, user: { usuario_id: 1 } }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].ignorados).toContain('foto');
    expect(connection.query).not.toHaveBeenCalled();
  });

  it('upload normal substitui a foto anterior com caminho persistido seguro', async () => {
    const id = `904-${process.pid}`;
    const fotoDir = path.join(paths.uploads, 'pessoas');
    const antigo = path.join(fotoDir, `pessoa_${id}.png`);
    const temporario = `r1-04e-temp-${process.pid}.png`;
    const temporarioPath = path.join(paths.uploads, temporario);
    fs.mkdirSync(fotoDir, { recursive: true });
    fs.writeFileSync(antigo, 'anterior');
    fs.writeFileSync(temporarioPath, 'nova');
    vi.spyOn(db, 'query')
      .mockResolvedValueOnce([[{ id }]])
      .mockResolvedValueOnce([[{ foto: `pessoa_${id}.png` }]])
      .mockResolvedValueOnce([{}]);
    const res = resposta();

    await peopleService.uploadFotoPessoa({ params: { id }, file: { filename: temporario } }, res);

    const novoNome = db.query.mock.calls[2][1][0];
    expect(novoNome).toMatch(/^[a-f0-9]{64}\.png$/);
    expect(db.query.mock.calls[2][1][1]).toBe(id);
    expect(fs.readFileSync(path.join(fotoDir, novoNome), 'utf8')).toBe('nova');
    expect(fs.existsSync(antigo)).toBe(false);
    expect(res.status).toHaveBeenCalledWith(200);
    fs.rmSync(antigo, { force: true });
  });

  it('exporta Catracas sem cabeçalhos de usuário e senha', async () => {
    const saidas = [];
    vi.spyOn(db, 'query').mockImplementation(async (sql) => {
      saidas.push(sql);
      return [sql.includes('FROM Dispositivo') ? [{ Nome: 'Catraca', Modelo: 'M', Endereço: 'host', Porta: '80', 'Número Serial': 'S' }] : []];
    });
    const output = path.join(os.tmpdir(), `sage-r1-04e-export-${process.pid}.xlsx`);
    await exportarDados(output);
    const workbook = XLSX.readFile(output);
    const cabecalho = XLSX.utils.sheet_to_json(workbook.Sheets.Catracas, { header: 1 })[0];

    expect(cabecalho).toEqual(['Nome', 'Modelo', 'Endereço', 'Porta', 'Número Serial']);
    expect(saidas.find((sql) => sql.includes('FROM Dispositivo'))).not.toMatch(/usuario|senha/i);
    fs.rmSync(output, { force: true });
  });

  it('importa colunas de credencial sem ecoar valores em resumo ou logs', async () => {
    const segredoUsuario = 'usuario-importado-nao-ecoar';
    const segredoSenha = 'senha-importada-nao-ecoar';
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet([{
      Nome: 'Catraca Import', Modelo: 'M', Endereço: 'host', Porta: '80',
      Usuário: segredoUsuario, Senha: segredoSenha, 'Número Serial': 'S'
    }]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Catracas');
    const input = path.join(os.tmpdir(), `sage-r1-04e-import-${process.pid}.xlsx`);
    XLSX.writeFile(workbook, input);
    const antigoGlobalDb = global.db;
    global.db = () => ({ select: () => ({ get: vi.fn().mockResolvedValue([]) }) });
    vi.spyOn(db, 'query').mockImplementation(async (sql) => {
      if (sql.includes('SELECT id FROM Dispositivo')) return [[]];
      return [{ insertId: 905 }];
    });
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {});
    const resultado = await importarPlanilha(input);

    expect(resultado.catracas.criados).toBe(1);
    expect(JSON.stringify(resultado)).not.toContain(segredoUsuario);
    expect(JSON.stringify(resultado)).not.toContain(segredoSenha);
    expect(JSON.stringify(info.mock.calls)).not.toContain(segredoUsuario);
    expect(JSON.stringify(info.mock.calls)).not.toContain(segredoSenha);
    global.db = antigoGlobalDb;
    fs.rmSync(input, { force: true });
  });

  it('mantém foto somente como leitura na projeção', () => {
    expect(projecoes.Pessoa.leitura).toContain('foto');
    expect(projecoes.Pessoa.escrita).not.toContain('foto');
  });
});
