const fs = require('fs');
const os = require('os');
const path = require('path');
async function esperar(condicao, limiteMs = 5000) {
  const fim = Date.now() + limiteMs;
  while (Date.now() < fim) {
    if (condicao()) return;
    await new Promise((ok) => setTimeout(ok, 10));
  }
  throw new Error('transporte de log não finalizou no prazo');
}

describe('R0-06 — rotação de logs', () => {
  let logger, criarLogger, dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sage-log-')); ({ criarLogger } = require('../src/config/logger')); });
  afterEach(() => { logger?.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  it('rotaciona com teto pequeno e descarta o arquivo mais velho', async () => {
    logger = criarLogger({ diretorio: dir, maxsize: 80, maxFiles: 3 });
    logger.transports[0].silent = true;
    const bloco = 'x'.repeat(100);
    for (let i = 0; i < 6; i += 1) {
      logger.error(bloco);
      await new Promise((ok) => setTimeout(ok, 10));
    }
    const arquivos = () => fs.readdirSync(dir).filter((n) => /^api\d*\.log$/.test(n));
    await esperar(() => arquivos().length >= 3); logger.close(); logger = null;
    expect(arquivos()).toHaveLength(3);
    expect(arquivos()).not.toContain('api3.log');
  });

  it('preserva metadata e stack no JSON de arquivo', async () => {
    logger = criarLogger({ diretorio: dir }); logger.errorWithStack('falha controlada', new Error('sintético'), { codigo: 'TESTE' });
    await esperar(() => fs.existsSync(path.join(dir, 'api.log')) && fs.readFileSync(path.join(dir, 'api.log'), 'utf8').includes('"codigo":"TESTE"')); logger.close(); logger = null;
    const linha = fs.readFileSync(path.join(dir, 'api.log'), 'utf8'); expect(linha).toContain('"codigo":"TESTE"'); expect(linha).toContain('stack');
  });

  it('ENOSPC em transporte produz aviso estável em stderr', () => {
    const escrita = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    require('../src/config/logger').avisarFalhaTransporte({ code: 'ENOSPC', message: 'segredo-cru' });
    expect(escrita).toHaveBeenCalledWith(expect.stringContaining('SAGE-LOG-ENOSPC'));
    expect(escrita).not.toHaveBeenCalledWith(expect.stringContaining('segredo-cru'));
    escrita.mockRestore();
  });

  it('WinSW mantém a outra metade do teto: 8 × 10 MiB', () => {
    const xml = fs.readFileSync('installer/windows/SAGE-API.xml.template', 'utf8'); expect(xml).toContain('<sizeThreshold>10240</sizeThreshold>'); expect(xml).toContain('<keepFiles>8</keepFiles>');
  });

  it('documenta o teto e a ação para ENOSPC sem prometer redação R3', () => {
    const doc = fs.readFileSync('docs/SYSTEM_OVERVIEW.md', 'utf8');
    expect(doc).toContain('160 MiB'); expect(doc).toContain('SAGE-LOG-ENOSPC'); expect(doc).toContain('R3');
    expect(require('../src/config/logger').MAXSIZE).toBe(10 * 1024 * 1024);
    expect(require('../src/config/logger').MAXFILES).toBe(8);
    expect(require('../src/config/logger').LIMITE_TOTAL_BYTES).toBe(160 * 1024 * 1024);
  });
});
