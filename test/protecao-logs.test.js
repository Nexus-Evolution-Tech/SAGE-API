/**
 * Fase 2 — E5: trava contra perda de logs (RNF-3, zero perda).
 *
 * Zerar os logs da catraca é a única operação capaz de destruir acesso de forma irreversível.
 * O fluxo já fazia backup em arquivo antes de apagar — mas backup em arquivo não é o mesmo que
 * "os acessos entraram no sistema". Se a sincronização estiver falhando, os acessos nunca vão
 * aparecer em nenhum relatório de frequência, e o arquivo de backup não conserta isso.
 *
 * O cenário não é hipotético: docs/ANALISE_SYNC_CONTROL_ID.md registra 48.057 logs na catraca com
 * ZERO inseridos no banco — e uma catraca cheia fica lenta, que é justamente quando alguém pensa
 * em zerar.
 */
const { avaliarPerdaDeLogs } = require('../src/services/protecaoLogs');

describe('E5 — não zerar logs que ainda não entraram no sistema', () => {
  it('bloqueia quando existem logs não sincronizados', () => {
    const r = avaliarPerdaDeLogs({ maiorLogIdNaCatraca: 5000, ultimoLogIdSincronizado: 4000 });

    expect(r.seguro).toBe(false);
    expect(r.naoSincronizados).toBe(1000);
    expect(r.exigeConfirmacao).toBe(true);
    expect(r.motivo).toMatch(/1000/);
  });

  it('libera quando tudo já foi sincronizado', () => {
    const r = avaliarPerdaDeLogs({ maiorLogIdNaCatraca: 5000, ultimoLogIdSincronizado: 5000 });

    expect(r.seguro).toBe(true);
    expect(r.naoSincronizados).toBe(0);
    expect(r.exigeConfirmacao).toBe(false);
  });

  it('libera quando a catraca está vazia', () => {
    const r = avaliarPerdaDeLogs({ maiorLogIdNaCatraca: 0, ultimoLogIdSincronizado: null });

    expect(r.seguro).toBe(true);
    expect(r.naoSincronizados).toBe(0);
  });

  it('BLOQUEIA o cenário real de 48.057 logs com nada sincronizado', () => {
    const r = avaliarPerdaDeLogs({ maiorLogIdNaCatraca: 48057, ultimoLogIdSincronizado: null });

    expect(r.seguro).toBe(false);
    expect(r.naoSincronizados).toBe(48057);
    expect(r.motivo).toMatch(/TODOS/);
  });

  it('na dúvida, não destrói: sem saber o estado da catraca, bloqueia', () => {
    const r = avaliarPerdaDeLogs({ maiorLogIdNaCatraca: null, ultimoLogIdSincronizado: 100 });

    expect(r.seguro).toBe(false);
    expect(r.naoSincronizados).toBeNull();
    expect(r.motivo).toMatch(/não foi possível determinar/i);
  });

  it('confirmação explícita do operador libera — mas o motivo continua registrado', () => {
    const r = avaliarPerdaDeLogs({
      maiorLogIdNaCatraca: 48057,
      ultimoLogIdSincronizado: null,
      confirmadoPeloOperador: true
    });

    expect(r.seguro).toBe(true);
    expect(r.naoSincronizados).toBe(48057);
    // A confirmação não apaga a razão: ela precisa ir para o log/auditoria.
    expect(r.motivo).toMatch(/TODOS/);
  });

  it('confirmação NÃO libera quando o estado da catraca é desconhecido', () => {
    const r = avaliarPerdaDeLogs({
      maiorLogIdNaCatraca: null,
      ultimoLogIdSincronizado: 10,
      confirmadoPeloOperador: true
    });

    // Confirmar "eu aceito perder" só faz sentido sabendo o que se perde.
    expect(r.seguro).toBe(false);
  });

  it('catraca com id menor que o sincronizado (logs já zerados antes) não acusa perda', () => {
    const r = avaliarPerdaDeLogs({ maiorLogIdNaCatraca: 50, ultimoLogIdSincronizado: 48057 });

    expect(r.seguro).toBe(true);
    expect(r.naoSincronizados).toBe(0);
  });
});
