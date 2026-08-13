const db = require('../src/config/database');
const logger = require('../src/config/logger');
const controlId = require('../src/services/controlIdService');
const axios = require('axios');
const { sincronizarTodasPessoasNasCatracas } = require('../src/utils/sync_catracas');
const { criarImagemUser, deletarCartao, criarGrupo } = require('../src/utils/controlId-utils');

describe('falhas observaveis', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('propaga falha essencial de sincronizacao', async () => {
    vi.spyOn(db, 'query').mockResolvedValue([[{ id: 1 }]]);
    vi.spyOn(controlId, 'criarNovaPessoaNasCatracas').mockRejectedValue(new Error('falha interna'));
    const erro = vi.spyOn(logger, 'error').mockImplementation(() => {});
    await expect(sincronizarTodasPessoasNasCatracas()).rejects.toThrow('falha interna');
    expect(erro).toHaveBeenCalledWith('[SYNC-CATRACA] codigo=SYNC_PESSOA_FALHOU');
  });

  it('mantem fallback de foto e registra codigo sem PII', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    await expect(criarImagemUser(-1, 'host', 'sessao', {}, [])).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('[CATRACA] codigo=CATRACA_FOTO_INDISPONIVEL');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('Ana Silva');
  });

  it('propaga falha essencial ao excluir cartao', async () => {
    vi.spyOn(axios, 'post').mockResolvedValueOnce({ data: { cards: [{ id: 2, value: '12345678' }] } }).mockRejectedValueOnce(new Error('falha'));
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    await expect(deletarCartao(1, 'host', 'sessao', {}, 'QRCODE')).rejects.toThrow('falha');
    expect(warn).toHaveBeenCalledWith('[CATRACA] codigo=CATRACA_CARTAO_EXCLUIR_FALHOU');
  });

  it('preserva a causa ao falhar ao criar grupo', async () => {
    vi.spyOn(axios, 'post').mockRejectedValueOnce(new Error('grupo indisponivel'));
    await expect(criarGrupo(1, 'host', 'sessao', {}, [])).rejects.toThrow('grupo indisponivel');
  });
});
