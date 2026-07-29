const db = require('../src/config/database');
const lessonController = require('../src/controllers/lessonController');

function response() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis()
  };
}

describe('F8 — uma única agenda canônica', () => {
  afterEach(() => vi.restoreAllMocks());

  it('traduz HorarioAula.horario no endpoint compatível sem ler colunas legadas', async () => {
    const query = vi.spyOn(db, 'query').mockResolvedValueOnce([[
      { aulaId: 12, nome: 'Matemática', diaSemana: 'TERÇA', horario: '07:30-08:20' }
    ]]);
    const res = response();
    await lessonController.getHorariosPorTurma(
      { params: { turma_id: '7', divisao: 'DIV A' } },
      res
    );

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('h.horario');
    expect(sql).toContain("h.divisao IN (?, 'INT')");
    expect(sql).not.toMatch(/h\.(inicio|fim)/);
    expect(params).toEqual([7, 'DIV A']);
    expect(res.json).toHaveBeenCalledWith([{
      aulaId: 12,
      nome: 'Matemática',
      diaSemana: 'TERÇA',
      inicio: '07:30',
      fim: '08:20'
    }]);
  });

  it('rejeita divisão fora do schema antes de consultar o banco', async () => {
    const query = vi.spyOn(db, 'query');
    const res = response();
    await lessonController.getHorariosPorTurma(
      { params: { turma_id: '7', divisao: 'DIV A/B' } },
      res
    );

    expect(query).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
