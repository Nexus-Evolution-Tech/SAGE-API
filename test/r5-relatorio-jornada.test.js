const { agruparEventosParaRelatorio } = require('../src/controllers/jornadaController');

describe('R5-03 — relatório de jornada baseado em fatos vigentes', () => {
  it('agrupa por pessoa e dia e preserva pendência sem inventar saída', () => {
    const jornadas = agruparEventosParaRelatorio([
      { id: 1, pessoa_id: 7, nome: 'Ana', momento: '2026-09-02T08:00:00-03:00', sentido: 'ENTRADA', origem: 'CATRACA' },
      { id: 2, pessoa_id: 7, nome: 'Ana', momento: '2026-09-02T17:00:00-03:00', sentido: 'SAIDA', origem: 'CATRACA' },
      { id: 3, pessoa_id: 8, nome: 'Bia', momento: '2026-09-02T08:10:00-03:00', sentido: 'ENTRADA', origem: 'CATRACA' }
    ]);

    expect(jornadas).toHaveLength(2);
    expect(jornadas[0].pares[0]).toMatchObject({ pessoa_id: 7 });
    expect(jornadas[1].pendencias).toEqual([
      expect.objectContaining({ tipo: 'ENTRADA_SEM_SAIDA' })
    ]);
    expect(jornadas[1].pendencias[0].evento).toMatchObject({ momento: '2026-09-02T08:10:00-03:00' });
  });

  it('mantém o registro de correção como fato vigente no agrupamento', () => {
    const [jornada] = agruparEventosParaRelatorio([
      { id: 11, pessoa_id: 2, nome: 'Carlos', momento: '2026-09-02T08:15:00-03:00', sentido: 'ENTRADA', origem: 'CORRECAO', registro_corrigido_id: 4 }
    ]);
    expect(jornada.eventos).toBeUndefined();
    expect(jornada.pendencias[0].evento).toMatchObject({ id: 11, origem: 'CORRECAO' });
  });
});
