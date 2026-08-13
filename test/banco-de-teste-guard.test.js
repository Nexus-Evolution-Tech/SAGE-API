const { assertBancoDeTeste } = require('./helpers/banco');

describe('guarda do banco descartável', () => {
  it('recusa qualquer banco fora do namespace de teste', () => {
    for (const nome of [undefined, '', 'sage', 'sage_teste_copia']) {
      expect(() => assertBancoDeTeste(nome)).toThrow(/_teste/);
    }
  });

  it('aceita somente nome terminado em _teste', () => {
    expect(assertBancoDeTeste('sage_integracao_teste')).toBe('sage_integracao_teste');
  });
});
