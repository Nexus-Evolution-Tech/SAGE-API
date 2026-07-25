/**
 * Fuso horário — dívida documentada, a ser paga na Fase 6.
 *
 * Este arquivo NÃO conserta nada. Ele **registra em teste** um defeito real, medido, para que:
 *   1. ninguém precise redescobrir o número na próxima vez que algo de horário parecer errado;
 *   2. a correção da Fase 6 tenha um alvo objetivo em vez de "arrumar o fuso".
 *
 * O DEFEITO: o pool é configurado com `timezone: '-03:00'` (src/config/database.js). O código de
 * sincronização grava `data_hora` como **string UTC** (`accessService`, `data_hora_utc`). Na
 * leitura, o driver interpreta o DATETIME armazenado como se estivesse em -03:00 e o converte para
 * um `Date` — devolvendo um instante **3 horas no futuro** em relação ao que foi gravado.
 *
 * ONDE ISSO JÁ CAUSOU DANO: a retomada da sincronização usava `data_hora` do último acesso para
 * calcular a janela de busca. Com o desvio de +3h e margem de 1h, a janela pulava 2 horas de logs
 * — perda permanente e silenciosa de acessos (80 de 120 num teste com logs a cada 90s).
 * Mitigado em `sincronizarAcessos` desligando o filtro por timestamp quando há ponteiro por id.
 *
 * ONDE AINDA PODE CAUSAR DANO (não mitigado): qualquer exibição, filtro por data ou relatório que
 * leia `Acesso.data_hora` pelo driver. Um relatório de frequência com 3h de deslocamento pode
 * mudar o dia de um acesso perto da meia-noite, e portanto a falta de um aluno.
 */
const { temBancoDisponivel, criarBancoDeTeste } = require('./helpers/banco');

let banco = null;
let temBanco = false;

beforeAll(async () => {
  temBanco = await temBancoDisponivel();
  if (!temBanco) return;
  banco = await criarBancoDeTeste('fuso');
}, 180000);

afterAll(async () => {
  if (banco) await banco.destruir();
});

describe('Fuso horário — desvio no round-trip de DATETIME (dívida da Fase 6)', () => {
  it('DOCUMENTA: gravar string UTC e ler pelo driver desloca o instante em 3 horas', async () => {
    if (!temBanco) {
      console.warn('[SKIP] MySQL indisponível');
      return;
    }

    await banco.pool.query(
      `INSERT INTO Pessoa (id, nome, tipo, visivel) VALUES (1, 'Pessoa Teste 1', 'ALUNO', 1)`
    );
    const [d] = await banco.pool.query(
      `INSERT INTO Dispositivo (nome, modelo, endereco, porta, usuario, senha)
       VALUES ('Catraca Teste', 'IDBlock', '127.0.0.1', '80', 'admin', 'admin')`
    );

    // Grava exatamente como a sincronização faz: string UTC "YYYY-MM-DD HH:mm:ss"
    const agora = new Date();
    const utcString = agora.toISOString().slice(0, 19).replace('T', ' ');
    await banco.pool.query(
      `INSERT INTO Acesso (pessoa_id, dispositivo_id, status, permitido, metodo_auth, data_hora)
       VALUES (1, ?, 'ENTRADA', 1, 'CARTAO_RFID', ?)`,
      [d.insertId, utcString]
    );

    const [[linha]] = await banco.pool.query('SELECT data_hora FROM Acesso LIMIT 1');

    const instanteGravado = Math.floor(new Date(utcString + 'Z').getTime() / 1000);
    const instanteLido = Math.floor(new Date(linha.data_hora).getTime() / 1000);
    const desvioHoras = (instanteLido - instanteGravado) / 3600;

    // Este é o defeito, medido. Quando a Fase 6 corrigir (armazenar/ler em UTC de forma
    // consistente), este teste vai FALHAR — e é esse o sinal de que a correção funcionou.
    // Nesse momento, troque a expectativa para 0 e remova este comentário.
    expect(desvioHoras).toBe(3);
  }, 120000);
});
