const db = require('../src/config/database');
const logger = require('../src/config/logger');
const controlId = require('../src/services/controlIdService');
const axios = require('axios');
const { sincronizarTodasPessoasNasCatracas } = require('../src/utils/sync_catracas');
const { criarImagemUser, deletarCartao } = require('../src/utils/controlId-utils');
describe('falhas observáveis', () => {
  beforeEach(() => vi.restoreAllMocks());
  it('propaga falha essencial de sincronização', async () => {
    vi.spyOn(db, 'query').mockResolvedValue([[{ id: 1 }]]);
    vi.spyOn(controlId, 'criarNovaPessoaNasCatracas').mockRejectedValue(new Error('falha interna'));
    const erro = vi.spyOn(logger, 'error').mockImplementation(() => {});
    await expect(sincronizarTodasPessoasNasCatracas()).rejects.toThrow('falha interna');
    expect(erro).toHaveBeenCalledWith('[SYNC-CATRACA] codigo=SYNC_PESSOA_FALHOU');
  });
  it('mantém fallback de foto e registra código sem PII', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    await expect(criarImagemUser(-1, 'host', 'sessao', {}, [])).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('[CATRACA] codigo=CATRACA_FOTO_INDISPONIVEL');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('Ana Silva');
  });
  it('propaga falha essencial ao excluir cartão', async () => {
    vi.spyOn(axios, 'post').mockResolvedValueOnce({ data: { cards: [{ id: 2, value: '12345678' }] } }).mockRejectedValueOnce(new Error('falha'));
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    await expect(deletarCartao(1, 'host', 'sessao', {}, 'QRCODE')).rejects.toThrow('falha');
    expect(warn).toHaveBeenCalledWith('[CATRACA] codigo=CATRACA_CARTAO_EXCLUIR_FALHOU');
  });
});
