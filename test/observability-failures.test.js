const axios = require('axios');
const { criarGrupo } = require('../src/utils/controlId-utils');

describe('falhas observáveis', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('preserva a causa ao falhar ao criar grupo', async () => {
    vi.spyOn(axios, 'post').mockRejectedValueOnce(new Error('grupo indisponível'));

    await expect(criarGrupo(1, 'host', 'sessao', {}, []))
      .rejects.toThrow('grupo indisponível');
  });
});
