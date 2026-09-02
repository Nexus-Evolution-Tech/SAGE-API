const calendario = require('../src/services/calendarioEscolar');
const verificarEAtribuirPresenca = require('../src/services/presenceService');
const expectativa = require('../src/services/expectativaPresencaService');

describe('R4 — calendário escolar e tempo', () => {
  it('usa dia útil por padrão e exceções explícitas para feriado/recesso/sábado letivo', async () => {
    const excecoes = new Map([
      ['2026-09-07', { tipo: 'FERIADO', descricao: 'Independência' }],
      ['2026-09-12', { tipo: 'SABADO_LETIVO', descricao: 'Reposição' }]
    ]);
    const executor = { query: vi.fn(async (_sql, [data]) => [[excecoes.get(data)].filter(Boolean)]) };

    await expect(calendario.verificarDiaLetivo('2026-09-08T12:00:00-03:00', executor)).resolves.toMatchObject({ letivo: true, tipo: 'DIA_LETIVO' });
    await expect(calendario.verificarDiaLetivo('2026-09-07T12:00:00-03:00', executor)).resolves.toMatchObject({ letivo: false, tipo: 'FERIADO' });
    await expect(calendario.verificarDiaLetivo('2026-09-12T12:00:00-03:00', executor)).resolves.toMatchObject({ letivo: true, tipo: 'SABADO_LETIVO' });
  });

  it('aplica tolerância configurável e horário global de funcionamento', () => {
    const config = calendario.parseConfig([
      { chave: 'tempo_horario_abertura', valor: '07:00' },
      { chave: 'tempo_horario_fechamento', valor: '18:00' },
      { chave: 'tempo_tolerancia_atraso_minutos', valor: '10' }
    ]);

    expect(calendario.calcularAtraso({ horarioPrevisto: '07:30', horarioChegada: '07:40', toleranciaAtrasoMinutos: config.toleranciaAtrasoMinutos })).toBe(false);
    expect(calendario.calcularAtraso({ horarioPrevisto: '07:30', horarioChegada: '07:41', toleranciaAtrasoMinutos: config.toleranciaAtrasoMinutos })).toBe(true);
    expect(calendario.dentroHorarioFuncionamento('07:00', config)).toBe(true);
    expect(calendario.dentroHorarioFuncionamento('18:01', config)).toBe(false);
  });

  it('cai em defaults seguros para configuração ausente ou inválida', () => {
    expect(calendario.parseConfig([{ chave: 'tempo_tolerancia_atraso_minutos', valor: '999' }])).toEqual(calendario.DEFAULT_TEMPO);
  });

  it('não cria presença em feriado, mesmo que exista uma entrada na catraca', async () => {
    const executor = { query: vi.fn()
      .mockResolvedValueOnce([[{ id: 42, tipo: 'ALUNO' }]])
      .mockResolvedValueOnce([[{ tipo: 'FERIADO', descricao: 'Feriado municipal' }]]) };

    const resultado = await verificarEAtribuirPresenca(42, new Date('2026-09-07T08:00:00-03:00'), executor);

    expect(resultado).toMatchObject({ pessoa_id: 42, ignorado: 'DIA_NAO_LETIVO', tipoCalendario: 'FERIADO' });
    expect(executor.query).toHaveBeenCalledTimes(2);
  });

  it('gera slots futuros de forma determinística e não recompõe o passado', () => {
    const inicioMedicao = performance.now();
    const slots = expectativa.gerarSlots({
      pessoas: Array.from({ length: 500 }, (_, i) => ({ pessoa_id: i + 1 })),
      inicio: '2026-09-01',
      fim: '2027-03-19',
      hoje: '2026-09-01',
      agendas: Array.from({ length: 500 }, (_, i) => ['SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA']
        .map((dia_semana) => ({ pessoa_id: i + 1, dia_semana, horario: '07:30-08:20', aula_id: 10 }))
      ).flat()
    });
    expect(performance.now() - inicioMedicao).toBeLessThan(1000);

    expect(slots).toEqual(expect.arrayContaining([expect.objectContaining({
      pessoa_id: 1, data: '2026-09-01', faixa_inicio: '07:30', faixa_fim: '08:20', origem: 'GRADE', origem_id: 10
    })]));
    expect(slots.every((slot) => slot.data >= '2026-09-01')).toBe(true);
    expect(expectativa.gerarSlots({
      pessoas: [{ pessoa_id: 1 }], inicio: '2026-08-01', fim: '2026-08-31', hoje: '2026-09-01', agendas: []
    })).toEqual([]);
  });
});
