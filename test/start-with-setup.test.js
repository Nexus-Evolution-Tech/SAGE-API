const {
  DEFAULT_RETRY_ATTEMPTS,
  isTransientMySqlError,
  verificarESetupComRetry
} = require('../scripts/start-with-setup');

describe('pré-boot do runtime schema gate', () => {
  it('repete erro transitório até o MySQL ficar pronto', async () => {
    const verify = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('recusou conexão'), { code: 'ECONNREFUSED' }))
      .mockResolvedValueOnce('schema-verificado');
    const sleep = vi.fn().mockResolvedValue();

    await expect(verificarESetupComRetry({ verify, retryAttempts: 2, retryDelayMs: 1, sleep }))
      .resolves.toBe('schema-verificado');
    expect(verify).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1);
  });

  it('não repete falha permanente de schema ou ledger', async () => {
    const error = Object.assign(new Error('schema incompatível'), { code: 'SCHEMA_INCOMPATIBLE' });
    const verify = vi.fn().mockRejectedValue(error);
    const sleep = vi.fn();

    await expect(verificarESetupComRetry({ verify, sleep })).rejects.toBe(error);
    expect(verify).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('encerra depois do número limitado de tentativas transitórias', async () => {
    const error = Object.assign(new Error('banco indisponível'), { code: 'ECONNREFUSED' });
    const verify = vi.fn().mockRejectedValue(error);
    const sleep = vi.fn().mockResolvedValue();

    await expect(verificarESetupComRetry({ verify, retryAttempts: 2, sleep })).rejects.toBe(error);
    expect(verify).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(DEFAULT_RETRY_ATTEMPTS).toBe(10);
  });

  it('classifica somente códigos de conexão conhecidos como transitórios', () => {
    expect(isTransientMySqlError({ code: 'PROTOCOL_CONNECTION_LOST' })).toBe(true);
    expect(isTransientMySqlError({ code: 'SCHEMA_INCOMPATIBLE' })).toBe(false);
    expect(isTransientMySqlError(new Error('sem código'))).toBe(false);
  });
});
