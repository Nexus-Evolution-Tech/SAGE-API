const crypto = require('crypto');

const credenciais = require('../src/utils/credenciaisDispositivo');

describe('credenciais de dispositivos', () => {
  const chaveAtualOriginal = process.env.SAGE_DEVICE_CREDENTIAL_KEY;
  const chaveAnteriorOriginal = process.env.SAGE_DEVICE_CREDENTIAL_KEY_PREVIOUS;

  afterEach(() => {
    process.env.SAGE_DEVICE_CREDENTIAL_KEY = chaveAtualOriginal;
    if (chaveAnteriorOriginal === undefined) delete process.env.SAGE_DEVICE_CREDENTIAL_KEY_PREVIOUS;
    else process.env.SAGE_DEVICE_CREDENTIAL_KEY_PREVIOUS = chaveAnteriorOriginal;
  });

  it('protege e autentica uma credencial sem reutilizar o IV', () => {
    const primeiro = credenciais.criptografarCredencial('admin-sintetico');
    const segundo = credenciais.criptografarCredencial('admin-sintetico');

    expect(primeiro).toMatch(/^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
    expect(primeiro).not.toContain('admin-sintetico');
    expect(segundo).not.toBe(primeiro);
    expect(credenciais.descriptografarCredencial(primeiro)).toBe('admin-sintetico');
  });

  it('recusa envelope adulterado e chave ausente', () => {
    const protegido = credenciais.criptografarCredencial('senha-sintetica');
    const partes = protegido.split(':');
    partes[3] = `${partes[3][0] === 'A' ? 'B' : 'A'}${partes[3].slice(1)}`;
    expect(() => credenciais.descriptografarCredencial(partes.join(':')))
      .toThrow('Não foi possível autenticar');

    delete process.env.SAGE_DEVICE_CREDENTIAL_KEY;
    expect(() => credenciais.criptografarCredencial('falha')).toThrow('SAGE_DEVICE_CREDENTIAL_KEY ausente');
  });

  it('usa a chave anterior somente para leitura durante a rotação', () => {
    const atual = process.env.SAGE_DEVICE_CREDENTIAL_KEY;
    const anterior = crypto.randomBytes(32).toString('base64url');
    process.env.SAGE_DEVICE_CREDENTIAL_KEY = anterior;
    const legado = credenciais.criptografarCredencial('senha-legada');
    process.env.SAGE_DEVICE_CREDENTIAL_KEY = atual;
    process.env.SAGE_DEVICE_CREDENTIAL_KEY_PREVIOUS = anterior;

    expect(credenciais.descriptografarCredencial(legado)).toBe('senha-legada');
    const protegido = credenciais.protegerDadosDispositivo({ usuario: 'novo-admin', senha: legado });
    expect(credenciais.descriptografarCredencial(protegido.usuario)).toBe('novo-admin');
    expect(credenciais.descriptografarCredencial(protegido.senha)).toBe('senha-legada');
  });

  it('migra texto legado e rotaciona envelopes com a chave anterior', async () => {
    const atual = process.env.SAGE_DEVICE_CREDENTIAL_KEY;
    const anterior = crypto.randomBytes(32).toString('base64url');
    process.env.SAGE_DEVICE_CREDENTIAL_KEY = anterior;
    const legadoCriptografado = credenciais.criptografarCredencial('senha-antiga');
    process.env.SAGE_DEVICE_CREDENTIAL_KEY = atual;
    process.env.SAGE_DEVICE_CREDENTIAL_KEY_PREVIOUS = anterior;

    const updates = [];
    const connection = {
      async query(sql, params) {
        if (sql.startsWith('SELECT id, usuario, senha')) {
          return [[
            { id: 1, usuario: 'admin-legado', senha: 'senha-legada' },
            { id: 2, usuario: legadoCriptografado, senha: legadoCriptografado }
          ]];
        }
        updates.push({ sql, params });
        return [{}];
      }
    };

    await expect(credenciais.migrarCredenciaisDispositivos(connection))
      .resolves.toEqual({ migrados: 2, rotacionados: 1 });
    expect(updates).toHaveLength(2);
    expect(credenciais.descriptografarCredencial(updates[0].params[0])).toBe('admin-legado');
    expect(credenciais.descriptografarCredencial(updates[0].params[1])).toBe('senha-legada');
    expect(credenciais.descriptografarCredencial(updates[1].params[0])).toBe('senha-antiga');
    expect(credenciais.descriptografarCredencial(updates[1].params[1])).toBe('senha-antiga');
  });
});
