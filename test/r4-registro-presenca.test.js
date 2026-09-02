const registro = require('../src/services/registroPresencaService');

describe('R4-02 — registro de presença imutável', () => {
  it('rejeita correção sem autor, alvo ou justificativa', () => {
    expect(() => registro.validarFato({
      pessoa_id: 1,
      momento: '2026-09-02T08:00:00-03:00',
      sentido: 'ENTRADA',
      origem: 'CORRECAO'
    })).toThrow('REGISTRO_PRESENCA_CORRECAO_SEM_ALVO');

    expect(() => registro.validarFato({
      pessoa_id: 1,
      momento: '2026-09-02T08:00:00-03:00',
      sentido: 'ENTRADA',
      origem: 'CORRECAO',
      registro_corrigido_id: 9,
      criado_por: 4,
      justificativa: 'curta'
    })).toThrow('REGISTRO_PRESENCA_CORRECAO_SEM_JUSTIFICATIVA');
  });

  it('faz uma correção por novo INSERT, sem caminho de mutação', async () => {
    const executor = { query: vi.fn(async () => [{ insertId: 12 }]) };
    const result = await registro.registrarCorrecao({
      pessoa_id: 1,
      momento: '2026-09-02T08:15:00-03:00',
      sentido: 'ENTRADA',
      registro_corrigido_id: 9,
      criado_por: 4,
      justificativa: 'A catraca registrou o horário incorreto.'
    }, executor);

    expect(result.id).toBe(12);
    expect(executor.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO RegistroPresenca'),
      expect.arrayContaining([1, null, '2026-09-02T08:15:00-03:00', 'ENTRADA', 'CORRECAO', 9, 4])
    );
  });

  it('a migration instala a tabela, a view e as travas de UPDATE/DELETE', async () => {
    const fs = require('fs');
    const sql = fs.readFileSync('database/migrations/0009_registro_presenca_imutavel.sql', 'utf8');
    expect(sql).toContain('CREATE TRIGGER trg_registro_presenca_no_update');
    expect(sql).toContain('CREATE TRIGGER trg_registro_presenca_no_delete');
    expect(sql).toContain('CREATE OR REPLACE VIEW RegistroPresencaVigente');
  });
});
