const { estaNoSlot } = require('../src/controllers/folhaController');

describe('R6 — folhas de presença e ponto', () => {
  it('classifica presença apenas quando há entrada real dentro do slot', () => {
    expect(estaNoSlot('2026-09-02T07:45:00-03:00', '07:30:00', '08:20:00')).toBe(true);
    expect(estaNoSlot('2026-09-02T09:00:00-03:00', '07:30:00', '08:20:00')).toBe(false);
  });

  it('suporta faixa que atravessa meia-noite', () => {
    expect(estaNoSlot('2026-09-02T23:50:00-03:00', '23:00:00', '01:00:00')).toBe(true);
    expect(estaNoSlot('2026-09-02T12:00:00-03:00', '23:00:00', '01:00:00')).toBe(false);
  });
});
