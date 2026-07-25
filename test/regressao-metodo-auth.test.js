/**
 * Regressão: acesso por QR Code trava a sincronização inteira, para sempre.
 *
 * BUG: o schema define `Acesso.metodo_auth ENUM('QR_CODE', 'CARTAO_RFID', 'SENHA', 'BIOMETRIA')`
 * — com underscore. Mas `accessService.mapearMetodo()` devolvia `'QRCODE'`, sem underscore.
 *
 * Com o MySQL em STRICT_TRANS_TABLES (o padrão), o INSERT não é truncado em silêncio: ele
 * **falha**. E como não há try/catch em volta do INSERT dentro do laço, a exceção sobe e
 * **aborta a sincronização inteira**.
 *
 * O efeito é pior do que perder um registro: como o `ultimo_log_id_sincronizado` só avança ao
 * final do laço, a próxima sync rebusca o mesmo lote, chega no mesmo log de QR Code e falha de
 * novo. A sincronização fica **permanentemente travada** naquele ponto, e todo acesso posterior
 * — de qualquer método — deixa de ser registrado.
 *
 * QR Code é um dos dois métodos de autenticação previstos no produto ("RFID (cartão estudantil)
 * ou QR Code"), então isto não é caso de borda: é o caminho principal de metade dos usuários.
 */
const { temBancoDisponivel, criarBancoDeTeste } = require('./helpers/banco');
const { createCatracaSimulator } = require('./fakes/controlid');

/** Substitui os access_logs do simulador por um conjunto controlado. */
function definirLogs(sim, logs) {
  const tabela = sim.store.tabela('access_logs');
  tabela.length = 0;
  for (const l of logs) tabela.push(l);
}

let banco = null;
let temBanco = false;
let sim = null;
let dispositivoId = null;

beforeAll(async () => {
  temBanco = await temBancoDisponivel();
  if (!temBanco) return;

  banco = await criarBancoDeTeste('metodoauth');
  sim = await createCatracaSimulator({ seed: 3 });

  await banco.pool.query(
    `INSERT INTO Pessoa (id, nome, tipo, visivel) VALUES (1, 'Pessoa Teste 1', 'ALUNO', 1)`
  );

  const [endereco, porta] = sim.url.split(':');
  const [res] = await banco.pool.query(
    `INSERT INTO Dispositivo (nome, modelo, endereco, porta, usuario, senha)
     VALUES ('Catraca Simulada', 'IDBlock', ?, ?, 'admin', 'admin')`,
    [endereco, porta]
  );
  dispositivoId = res.insertId;

  process.env.DB_NAME = banco.nome;
  process.env.CATRACA_MIN_LOG_ID = '0';
}, 240000);

afterAll(async () => {
  if (sim) await sim.stop().catch(() => {});
  if (banco) await banco.destruir();
});

describe('Regressão — acesso por QR Code não pode travar a sincronização', () => {
  it('grava o acesso de QR Code com o valor que o schema aceita', async () => {
    if (!temBanco) {
      console.warn('[SKIP] MySQL indisponível');
      return;
    }

    // card_value de 8 dígitos = QR Code, conforme mapearMetodo()
    definirLogs(sim, [
      { id: 1, time: Math.floor(Date.now() / 1000) - 120, user_id: 111000001, portal_id: 1, card_value: '12345678', event: 7, device_id: 1 }
    ]);

    const accessService = require('../src/services/accessService');
    const [[dispositivo]] = await banco.pool.query('SELECT * FROM Dispositivo WHERE id = ?', [dispositivoId]);

    // Antes da correção isto lança: "Data truncated for column 'metodo_auth' at row 1"
    const resultado = await accessService.sincronizarAcessos(dispositivo);

    expect(resultado.sucesso).not.toBe(false);

    const [linhas] = await banco.pool.query('SELECT metodo_auth FROM Acesso');
    expect(linhas).toHaveLength(1);
    expect(linhas[0].metodo_auth).toBe('QR_CODE');
  }, 120000);

  it('um QR Code no meio do lote não impede os demais acessos de serem gravados', async () => {
    if (!temBanco) return;

    await banco.pool.query('DELETE FROM Acesso');
    await banco.pool.query('UPDATE Dispositivo SET ultimo_log_id_sincronizado = NULL WHERE id = ?', [dispositivoId]);

    const base = Math.floor(Date.now() / 1000) - 3600;
    definirLogs(sim, [
      { id: 10, time: base + 1, user_id: 111000001, portal_id: 1, card_value: '123456789', event: 7, device_id: 1 }, // RFID
      { id: 11, time: base + 2, user_id: 111000001, portal_id: 2, card_value: '87654321', event: 7, device_id: 1 },  // QR Code
      { id: 12, time: base + 3, user_id: 111000001, portal_id: 1, card_value: '987654321', event: 7, device_id: 1 }  // RFID
    ]);

    const accessService = require('../src/services/accessService');
    const [[dispositivo]] = await banco.pool.query('SELECT * FROM Dispositivo WHERE id = ?', [dispositivoId]);
    await accessService.sincronizarAcessos(dispositivo);

    const [linhas] = await banco.pool.query('SELECT metodo_auth FROM Acesso ORDER BY data_hora');
    // Os três precisam estar lá. Antes, o do meio abortava o laço e o terceiro nunca entrava.
    expect(linhas).toHaveLength(3);
    expect(linhas.map((l) => l.metodo_auth)).toEqual(['CARTAO_RFID', 'QR_CODE', 'CARTAO_RFID']);
  }, 120000);
});
