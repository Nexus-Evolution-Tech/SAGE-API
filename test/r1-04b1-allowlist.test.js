const { criarRegistro, atualizarRegistro, filtrarDadosDeEscrita } = require('../src/utils/generic-db-utils');
const { globalDB } = require('../src/config/queryBuilder');
const { filtrarDadosPessoa, CAMPOS_FILHOS_PESSOA } = require('../src/utils/people-db-utils');

describe('R1-04B1 - allowlist de escrita', () => {
  it('rejeita chave desconhecida/maliciosa antes de mutar', async () => {
    const connection = { query: vi.fn() };
    await expect(atualizarRegistro('Curso', 7, { "nome = 'x' --": 'x' }, connection))
      .rejects.toMatchObject({ code: 'ESCRITA_CHAVE_NAO_DECLARADA', chaves: ["nome = 'x' --"] });
    expect(connection.query).not.toHaveBeenCalled();
  });

  it('aplica escrita e nomeia id/timestamps ignorados', async () => {
    const connection = { query: vi.fn(async () => [{}]) };
    const resultado = await atualizarRegistro('Curso', 7, { id: 2, created_at: 'x', updated_at: 'y', nome: 'novo' }, connection);
    expect(connection.query.mock.calls[0][0]).toContain('SET nome = ?');
    expect(resultado.ignorados).toEqual(['id', 'created_at', 'updated_at']);
  });

  it('rejeita somente read-only e mantém comparação case-sensitive', async () => {
    await expect(criarRegistro('Curso', { id: 2, created_at: 'x' }, { query: vi.fn() }))
      .rejects.toMatchObject({ code: 'ESCRITA_NENHUM_CAMPO_APLICAVEL', ignorados: ['id', 'created_at'] });
    expect(() => filtrarDadosDeEscrita('Curso', { Nome: 'x' }))
      .toThrow(/ESCRITA_CHAVE_NAO_DECLARADA/);
  });

  it('cobre Pessoa sem incluir senha_acesso na leitura', () => {
    expect(filtrarDadosPessoa({ nome: 'x', senha_acesso: 'hash', id: 2 }).dados)
      .toEqual({ nome: 'x', senha_acesso: 'hash' });
    expect(filtrarDadosPessoa({ nome: 'x', id: 2 }).ignorados).toEqual(['id']);
    expect(filtrarDadosPessoa({ ra: '123', id: 2 })).toEqual({ dados: { ra: '123' }, ignorados: ['id'] });
    expect(CAMPOS_FILHOS_PESSOA).toContain('ra');
    expect(CAMPOS_FILHOS_PESSOA).not.toContain('campo_inventado');
    expect(() => filtrarDadosPessoa({ campo_inventado: 'x' })).toThrow(/ESCRITA_CHAVE_NAO_DECLARADA/);
  });

  it('valida tabela, coluna/direção de ORDER BY e limites', () => {
    expect(globalDB('Curso').orderBy('nome', 'DESC').limit('2').offset(1).buildQuery().sql)
      .toContain('ORDER BY nome DESC LIMIT 2 OFFSET 1');
    expect(() => globalDB('Curso').orderBy('nao_existe').buildQuery()).toThrow(/QUERY_ORDER_BY_INVALIDO/);
    expect(() => globalDB('Curso').orderBy('nome', 'DROP').buildQuery()).toThrow(/QUERY_ORDER_BY_INVALIDO/);
    expect(() => globalDB('Curso').where('nao_existe', 'x').buildQuery()).toThrow(/QUERY_IDENTIFICADOR_INVALIDO/);
    expect(() => globalDB('Curso').select(['nao_existe']).buildQuery()).toThrow(/QUERY_IDENTIFICADOR_INVALIDO/);
    expect(globalDB('Curso').select('*').buildQuery().sql).toContain('SELECT * FROM Curso');
    expect(() => globalDB('Curso').limit('2; DROP TABLE Curso').buildQuery()).toThrow(/QUERY_LIMITE_INVALIDO/);
    expect(() => globalDB('nao_declarada').buildQuery()).toThrow(/QUERY_IDENTIFICADOR_INVALIDO/);
  });
});
