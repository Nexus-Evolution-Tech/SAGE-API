const { criarPrng, inteiroEntre } = require('./prng');

/**
 * Presets de faixa de id por instância — reproduz o Q5 (id de access_logs é POR DISPOSITIVO).
 * Números vindos de docs/ANALISE_SYNC_CONTROL_ID.md (Catraca 02 x Catraca 01).
 */
const PRESETS_FAIXA = {
  instanciaA: { idInicial: 6169, quantidade: 48057 },
  instanciaB: { idInicial: 1, quantidade: 5 }
};

/**
 * Gera access_logs determinísticos (mesma seed → exatamente os mesmos registros).
 *
 * Formato do registro espelha o que o código de produção lê
 * (accessService.sincronizarAcessos / processarNotificacaoMonitorDao):
 *   { id, time, user_id, portal_id, card_value, event, device_id }
 *
 * @param {object} opcoes
 * @param {number} opcoes.quantidade - quantos logs gerar
 * @param {number} opcoes.idInicial - primeiro id (Q5: faixa por dispositivo)
 * @param {number} [opcoes.seed=42]
 * @param {number} [opcoes.userIdOffset=111000000] - Q6: user_id = offset + pessoa.id
 * @param {number[]} [opcoes.pessoaIds] - pool de pessoa.id usados nos logs
 * @param {number} [opcoes.timeInicial] - timestamp Unix (segundos) do log mais antigo
 * @param {number} [opcoes.deviceId=1]
 * @param {number} [opcoes.proporcaoUserIdZero=0.01] - fração de logs com user_id 0 (acesso não identificado)
 * @param {number[]} [opcoes.offsetsExtras] - Q6 modo órfão: outros offsets usados em parte dos logs
 * @returns {Array<object>} logs em ordem crescente de id (e de time)
 */
function gerarAccessLogs(opcoes = {}) {
  const {
    quantidade = 48057,
    idInicial = 6169,
    seed = 42,
    userIdOffset = 111000000,
    pessoaIds = null,
    timeInicial = 1704067200, // 2024-01-01T00:00:00Z — fixo para o dataset ser determinístico
    deviceId = 1,
    proporcaoUserIdZero = 0.01,
    offsetsExtras = []
  } = opcoes;

  const prng = criarPrng(seed);
  const pool = pessoaIds && pessoaIds.length > 0
    ? pessoaIds
    : Array.from({ length: 200 }, (_, i) => i + 1);

  const logs = new Array(quantidade);
  let id = idInicial;
  let time = timeInicial;

  for (let i = 0; i < quantidade; i++) {
    // Gap ocasional nos ids: a catraca apaga registros e a sequência não é contígua.
    if (i > 0) id += prng() < 0.02 ? 2 : 1;
    time += inteiroEntre(prng, 30, 120);

    const pessoaId = pool[inteiroEntre(prng, 0, pool.length - 1)];
    const semUsuario = prng() < proporcaoUserIdZero;

    let offset = userIdOffset;
    if (offsetsExtras.length > 0 && prng() < 0.5) {
      offset = offsetsExtras[inteiroEntre(prng, 0, offsetsExtras.length - 1)];
    }

    const ehQrCode = prng() < 0.6;
    const cardValue = ehQrCode
      ? String(inteiroEntre(prng, 10000000, 99999999)) // 8 dígitos → QRCODE (mapearMetodo)
      : String(inteiroEntre(prng, 100000000, 999999999)); // 9 dígitos → CARTAO_RFID

    logs[i] = {
      id,
      time,
      user_id: semUsuario ? 0 : offset + pessoaId,
      portal_id: prng() < 0.5 ? 1 : 2,
      card_value: cardValue,
      event: 7, // 7 = acesso concedido na Control iD
      device_id: deviceId
    };
  }

  return logs;
}

module.exports = { gerarAccessLogs, PRESETS_FAIXA };
