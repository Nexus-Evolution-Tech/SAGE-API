const { sanitizarTexto, sanitizar } = require('../src/services/sanitizador');
const heartbeat = require('../src/services/heartbeat');
const diagnostico = require('../src/services/diagnostico');
const logger = require('../src/config/logger');
const { responderErroInterno } = require('../src/utils/responderErroInterno');
const { codigoStatus } = require('../src/routes/statusRoutes');

describe('R3 — observabilidade sem dependência externa', () => {
  it('redige RG e JWT em mensagem de erro adversarial', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhbmEifQ.s3nh4shsynthet1c';
    const texto = sanitizarTexto(
      `Falha para RG: 48.291.375-6, e-mail ana.aluna@escola.test, CPF 398.123.456-78, Bearer ${jwt}`
    );

    expect(texto).not.toContain('48.291.375-6');
    expect(texto).not.toContain('ana.aluna@escola.test');
    expect(texto).not.toContain('398.123.456-78');
    expect(texto).not.toContain(jwt);
    expect(texto).toContain('[RG_REDIGIDO]');
    expect(texto).toContain('[JWT_REDIGIDO]');
  });

  it('redige nome quando chega como campo desconhecido de telemetria', () => {
    const saida = JSON.stringify(sanitizar({ nome: 'Ana Clara Guedes', contexto: 'sync' }));
    expect(saida).not.toContain('Ana Clara Guedes');
  });

  it('heartbeat é inerte sem URL e rejeita endpoint que não seja HTTPS/443', async () => {
    const fetchImpl = vi.fn();
    await expect(heartbeat.ping('vivo', { env: {}, fetchImpl })).resolves.toMatchObject({ enviado: false });
    await expect(heartbeat.ping('vivo', {
      env: { HC_URL_VIVO: 'http://localhost:8080/check' },
      fetchImpl
    })).resolves.toMatchObject({ motivo: 'url_invalida' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('heartbeat envia somente o estado agregado e absorve indisponibilidade da internet', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('sem internet'));
    const resultado = await heartbeat.enviarHeartbeat({
      env: {
        HC_URL_VIVO: 'https://monitor.example/vivo',
        HC_URL_SYNC: 'https://monitor.example/sync'
      },
      fetchImpl,
      db: { healthCheck: vi.fn().mockResolvedValue(true) },
      saude: {
        todos: () => [{ alcancavel: true, ultimoSucessoEm: new Date() }]
      }
    });

    expect(resultado.estado).toEqual({ processo: true, banco: true, catraca: true });
    expect(resultado.pings.every(({ enviado }) => enviado === false)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      'https://monitor.example/vivo',
      'https://monitor.example/sync'
    ]);
  });

  it('erro HTTP devolve código estável e ocorrência sem expor a causa', () => {
    const erroLog = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const resposta = {};
    const res = {
      status: vi.fn(() => res),
      json: vi.fn((body) => { resposta.body = body; return res; }),
      locals: {}
    };

    responderErroInterno(res, Object.assign(new Error('falha com ana.aluna@escola.test'), { code: 'ECONNREFUSED' }));

    expect(resposta.body).toMatchObject({ error: 'Erro interno no servidor', codigo: 'CAT-CONN-03' });
    expect(resposta.body.ocorrencia).toMatch(/^[A-Z0-9_-]{8}$/);
    expect(JSON.stringify(resposta.body)).not.toContain('ana.aluna@escola.test');
    expect(erroLog).toHaveBeenCalled();
    erroLog.mockRestore();
  });

  it('bundle tem manifesto estável de seções e funciona sem banco', async () => {
    const bundle = await diagnostico.gerarBundle({});

    expect(bundle.manifesto).toMatchObject({ schemaVersion: 1, tipo: 'diagnostico-sage' });
    expect(bundle.manifesto.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(bundle.manifesto.secoes).toEqual(expect.arrayContaining(['manifesto', 'configuracao', 'dispositivos']));
  });

  it('status fornece indicador curto legível ao telefone', () => {
    expect(codigoStatus({ banco: { ok: true }, dispositivos: [], pendencias: 0, ultimoBackup: {} })).toBe('OK');
    expect(codigoStatus({ banco: { ok: false }, dispositivos: [], pendencias: 0, ultimoBackup: {} })).toBe('DB');
    expect(codigoStatus({ banco: { ok: true }, dispositivos: [{ nivel: 'erro' }], pendencias: 0, ultimoBackup: {} })).toBe('CT');
    expect(codigoStatus({ banco: { ok: true }, dispositivos: [], pendencias: 2, ultimoBackup: {} })).toBe('SY');
    expect(codigoStatus({ banco: { ok: true }, dispositivos: [], pendencias: 0, ultimoBackup: null })).toBe('BK');
  });
});
