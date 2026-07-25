/**
 * Fase 2 — E6: o sistema precisa saber E MOSTRAR seu estado real (RNF-4).
 *
 * Quem opera o sistema é a secretaria, não a TI. Uma mensagem como "ECONNREFUSED 192.168.0.126:81"
 * é tecnicamente correta e operacionalmente inútil: não diz se precisa agir, nem se perdeu dado.
 *
 * O teste mais importante deste arquivo é o que verifica que, com a catraca fora do ar, a mensagem
 * diz que **os acessos continuam sendo registrados no equipamento**. Sem isso, a reação natural de
 * quem lê é achar que perdeu o dia — e a segunda reação é ligar para o suporte.
 */
const saude = require('../src/services/saudeDispositivos');

describe('E6 — estado do dispositivo em português de secretaria', () => {
  beforeEach(() => saude.limpar());

  it('dispositivo nunca contactado não finge estar bem', () => {
    const d = saude.descreverParaOperador(saude.obter(1));

    expect(d.nivel).toBe('desconhecido');
    expect(d.texto).toMatch(/nenhuma tentativa/i);
  });

  it('dispositivo saudável diz que está normal', () => {
    saude.registrarSucesso(1, { nome: 'Catraca da entrada', operacao: 'obterSessao' });

    const d = saude.descreverParaOperador(saude.obter(1));

    expect(d.nivel).toBe('ok');
    expect(d.texto).toMatch(/Catraca da entrada/);
    expect(d.texto).toMatch(/normalmente/i);
  });

  it('catraca inalcançável: avisa que NÃO se perdeu acesso — o ponto mais importante', () => {
    saude.registrarFalha(1, {
      nome: 'Catraca da entrada',
      operacao: 'obterSessao',
      motivo: 'ECONNREFUSED',
      alcancavel: false
    });

    const d = saude.descreverParaOperador(saude.obter(1));

    expect(d.nivel).toBe('erro');
    expect(d.texto).toMatch(/sem comunicação/i);
    // A parte que evita o pânico e a ligação para o suporte:
    expect(d.texto).toMatch(/continuam sendo registrados no equipamento/i);
    expect(d.texto).toMatch(/serão importados quando ela voltar/i);
    // E diz o que fazer:
    expect(d.texto).toMatch(/ligada e conectada/i);
  });

  it('catraca respondeu mas recusou: aponta a causa provável, sem jargão', () => {
    saude.registrarFalha(1, {
      nome: 'Catraca 02',
      operacao: 'obterSessao',
      motivo: 'senha inválida',
      alcancavel: true
    });

    const d = saude.descreverParaOperador(saude.obter(1));

    expect(d.nivel).toBe('atencao');
    expect(d.texto).toMatch(/recusou/i);
    expect(d.texto).toMatch(/senha inválida/);
    expect(d.texto).toMatch(/usuário ou senha da catraca/i);
  });

  it('sucesso depois de falhas zera o contador e volta a dizer que está normal', () => {
    saude.registrarFalha(1, { nome: 'C1', motivo: 'timeout', alcancavel: false });
    saude.registrarFalha(1, { nome: 'C1', motivo: 'timeout', alcancavel: false });
    expect(saude.obter(1).falhasConsecutivas).toBe(2);

    saude.registrarSucesso(1, { nome: 'C1', operacao: 'obterSessao' });

    expect(saude.obter(1).falhasConsecutivas).toBe(0);
    expect(saude.descreverParaOperador(saude.obter(1)).nivel).toBe('ok');
  });

  it('guarda histórico curto das últimas falhas, para diagnóstico remoto', () => {
    for (let i = 1; i <= 8; i++) {
      saude.registrarFalha(1, { nome: 'C1', motivo: `falha ${i}`, alcancavel: false });
    }

    const h = saude.obter(1).historico;
    expect(h).toHaveLength(5); // limitado, para não crescer sem controle na memória
    expect(h[0].motivo).toBe('falha 8'); // mais recente primeiro
  });

  it('lista todos os dispositivos com estado conhecido', () => {
    saude.registrarSucesso(1, { nome: 'C1' });
    saude.registrarFalha(2, { nome: 'C2', motivo: 'offline', alcancavel: false });

    const lista = saude.todos();

    expect(lista).toHaveLength(2);
    expect(lista.map((d) => d.dispositivo_id).sort()).toEqual([1, 2]);
  });
});
