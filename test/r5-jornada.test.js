const jornada = require('../src/services/jornadaService');
const excecao = require('../src/services/excecaoService');

function evento(sentido, hora, extra = {}) {
  return { sentido, dataHora: `2026-09-08T${hora}:00-03:00`, ...extra };
}

describe('R5 — interpretação de jornada', () => {
  it('pareia entrada e saída preservando os horários originais', () => {
    const entrada = evento('ENTRADA', '07:30');
    const saida = evento('SAIDA', '16:45');
    const resultado = jornada.parearEventos([saida, entrada]);

    expect(resultado.pares).toHaveLength(1);
    expect(resultado.pares[0].entrada).toBe(entrada);
    expect(resultado.pares[0].saida).toBe(saida);
    expect(resultado.pendencias).toEqual([]);
  });

  it.each([
    ['entrada sem saída', [evento('ENTRADA', '07:30')], 'ENTRADA_SEM_SAIDA'],
    ['saída sem entrada', [evento('SAIDA', '16:45')], 'SAIDA_SEM_ENTRADA'],
    ['entrada duplicada', [evento('ENTRADA', '07:30'), evento('ENTRADA', '07:31'), evento('SAIDA', '16:45')], 'ENTRADA_DUPLICADA'],
    ['saída duplicada', [evento('ENTRADA', '07:30'), evento('SAIDA', '16:45'), evento('SAIDA', '16:46')], 'SAIDA_SEM_ENTRADA']
  ])('registra pendência no caso degenerado: %s', (_nome, eventos, tipo) => {
    const resultado = jornada.parearEventos(eventos);
    expect(resultado.pendencias.map(({ tipo: atual }) => atual)).toContain(tipo);
  });

  it('não inventa horário no intervalo implausível', () => {
    const entrada = evento('ENTRADA', '07:30');
    const saida = evento('SAIDA', '08:00');
    const resultado = jornada.parearEventos([entrada, saida], { maxIntervaloMs: 1 });

    expect(resultado.pares).toEqual([]);
    expect(resultado.pendencias[0]).toMatchObject({ tipo: 'INTERVALO_IMPLAUSIVEL', entrada, evento: saida });
    expect(resultado.pendencias[0].intervaloMs).toBeGreaterThan(0);
  });

  it('pareia 200 pessoas e 600 eventos em menos de dois segundos', () => {
    const eventos = Array.from({ length: 200 }, (_, pessoa_id) => [
      evento('ENTRADA', '07:30', { pessoa_id }),
      evento('SAIDA', '12:00', { pessoa_id }),
      evento('ENTRADA', '13:00', { pessoa_id })
    ]).flat();
    const inicio = performance.now();
    const resultado = jornada.parearPorPessoa(eventos);

    expect(performance.now() - inicio).toBeLessThan(2000);
    expect(resultado.pares).toHaveLength(200);
    expect(jornada.resumirPendencias(resultado.pendencias).total).toBe(200);
  });

  it('exceção de passeio da turma remove slots sem afetar outra turma', () => {
    const slots = [
      { pessoa_id: 1, turma_id: 10, data: '2026-09-08' },
      { pessoa_id: 2, turma_id: 11, data: '2026-09-08' }
    ];
    const passeio = {
      escopo: 'TURMA', alvo_id: 10, efeito: 'REMOVER_EXPECTATIVA',
      data_inicio: '2026-09-08', data_fim: '2026-09-08'
    };

    expect(excecao.aplicarExcecoes(slots, [passeio])).toEqual([slots[1]]);
  });
});
