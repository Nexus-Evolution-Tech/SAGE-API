const deviceService = require('./deviceService');
const verificarEAtribuirPresenca = require('./presenceService');
const db = require('../config/database')

// Deve ser o MESMO valor do controlIdService (catracaUserId = offset + pessoa.id)
const USER_ID_OFFSET = parseInt(process.env.CATRACA_USER_ID_OFFSET || '111000000');

// Mapeamento portal_id → entrada/saída. Na catraca, o sentido do giro é configurado por portal:
// normalmente giro à esquerda = portal de entrada, giro à direita = portal de saída (ou o contrário).
const ENTRADA_PORTAL_ID = parseInt(process.env.CATRACA_ENTRADA_PORTAL_ID || '1', 10);
const SAIDA_PORTAL_ID = parseInt(process.env.CATRACA_SAIDA_PORTAL_ID || '2', 10);

function formatarUserId(user_id) {
  const str = String(user_id).replace(/^0+/, '');
  return parseInt(str.slice(-7), 10);
}

/** user_id da catraca → nosso pessoa_id. Aceita: offset+id (SAGE) ou id direto (software oficial). */
function userIdCatracaParaPessoaId(user_id) {
  const n = Number(user_id);
  if (n >= USER_ID_OFFSET) {
    return formatarUserId(n - USER_ID_OFFSET);
  }
  return formatarUserId(n);
}

// Determina o tipo de autenticação pelo valor lido
function mapearMetodo(value) {
  return value.length === 8 ? 'QRCODE' : 'CARTAO_RFID';
}

// Determina se é entrada ou saída pelo portal_id (sentido do giro na catraca: esquerda/direita).
// Portal de entrada = normalmente giro à esquerda; portal de saída = giro à direita (configurável no equipamento).
function identificarAcesso(portal_id) {
  const pid = portal_id != null ? Number(portal_id) : ENTRADA_PORTAL_ID;
  if (pid === SAIDA_PORTAL_ID) return 'SAIDA';
  if (pid === ENTRADA_PORTAL_ID) return 'ENTRADA';
  // Fallback: portal_id 1 = entrada (comportamento antigo)
  return pid === 1 ? 'ENTRADA' : 'SAIDA';
}

// Converte timestamp Unix (UTC) da catraca para Date em UTC (guardamos UTC no banco; o frontend exibe em horário local)
function timestampParaData(time) {
  return new Date(time * 1000); // timestamp Unix em segundos → Date UTC
}

// Converte data_hora do banco para Unix seconds (UTC), para comparar com log.time da catraca.
// String "YYYY-MM-DD HH:mm:ss" sem Z: tratar como UTC. Date (MySQL driver): pode vir em local;
// usar getTime() direto (instante absoluto) — a margem de 1h no timestampInicial cobre diferenças.
function dataHoraParaTimestampUnix(dataHora) {
  if (dataHora == null) return 0;
  if (typeof dataHora === 'string' && !/Z|[+-]\d{2}:?\d{2}$/.test(dataHora)) {
    return Math.floor(new Date(dataHora.replace(' ', 'T') + 'Z').getTime() / 1000);
  }
  const d = dataHora instanceof Date ? dataHora : new Date(dataHora);
  return Math.floor(d.getTime() / 1000);
}

// Calcula idade
function calcularIdade(dataNascimento) {
  const hoje = new Date();
  const nascimento = new Date(dataNascimento);
  let idade = hoje.getFullYear() - nascimento.getFullYear();
  const mes = hoje.getMonth() - nascimento.getMonth();
  if (mes < 0 || (mes === 0 && hoje.getDate() < nascimento.getDate())) idade--;
  return idade;
}

// Sincroniza acessos de um dispositivo
async function sincronizarAcessos(dispositivo) {
  const MIN_ID = parseInt(process.env.CATRACA_MIN_LOG_ID || '0', 10); // 0 = não filtrar por id (só por timestamp)
  const logger = require('../config/logger');
  if (MIN_ID > 0) {
    logger.debug(`[SYNC] ${dispositivo.nome}: ignorando logs da catraca com id <= ${MIN_ID} (CATRACA_MIN_LOG_ID)`);
  }

  const link = deviceService.linkCatraca(dispositivo);
  const session = await deviceService.obterSessao(link, dispositivo);

  if (!session) {
    return { sucesso: false, message: `Erro ao obter sessão com a catraca ${dispositivo.nome}` };
  }

  // Último acesso sincronizado: usar id DESC (mesmo critério da tela) e recuar 1h para não perder logs por fuso/relógio
  const [ultimoAcessoResult] = await db.query(
    'SELECT * FROM Acesso WHERE dispositivo_id = ? ORDER BY id DESC LIMIT 1',
    [dispositivo.id]
  );
  const ultimoAcesso = ultimoAcessoResult[0];
  const ts = ultimoAcesso ? dataHoraParaTimestampUnix(ultimoAcesso.data_hora) : 0;
  const MARGEM_SEGUNDOS = 3600; // 1 hora: evita perder logs recentes por diferença de fuso/relógio
  let timestampInicial = Math.max(0, ts - MARGEM_SEGUNDOS);

  // Opção de pedir só logs com id > ultimo_log_id_sincronizado (reduz carga quando há muitos registros na catraca)
  const lastLogId = dispositivo.ultimo_log_id_sincronizado != null ? Number(dispositivo.ultimo_log_id_sincronizado) : null;
  const loadOptions = lastLogId != null && lastLogId >= 0 ? { lastLogId } : {};

  // Uma requisição à catraca por dispositivo (load_objects); depois só processamos a lista em memória e gravamos no nosso banco (sem nova chamada à catraca por pessoa).
  let logs = await deviceService.obterLogsCatraca(session, link, timestampInicial, loadOptions);
  // Se veio 0 logs: pode ser filtro id > lastLogId excluindo tudo, ou relógio da catraca atrás. Tentar sem filtro de id e com janela recente.
  if (logs.length === 0) {
    const fallbackTs = Math.max(0, Math.floor(Date.now() / 1000) - 24 * 3600);
    logger.info(
      `[SYNC] ${dispositivo.nome}: 0 logs (timestampInicial=${timestampInicial}, lastLogId=${lastLogId ?? 'n/a'}); tentando desde ${fallbackTs} (24h) sem filtro de id`
    );
    logs = await deviceService.obterLogsCatraca(session, link, fallbackTs, {});
  }

  // Diagnóstico e ajuste: se o último acesso no banco está à frente do relógio da catraca, nenhum log passaria. Processar TODOS os logs já trazidos (ex.: fallback 24h) para não perder acesso de hoje (ex.: 13h).
  let effectiveTimestampInicial = timestampInicial;
  if (logs.length > 0) {
    const ids = logs.map((l) => (l.id != null ? Number(l.id) : NaN)).filter((n) => !isNaN(n));
    const times = logs.map((l) => (l.time != null ? Number(l.time) : NaN)).filter((n) => !isNaN(n));
    const minId = ids.length ? Math.min(...ids) : null;
    const maxId = ids.length ? Math.max(...ids) : null;
    const minTime = times.length ? Math.min(...times) : null;
    const maxTime = times.length ? Math.max(...times) : null;
    if (maxTime != null && timestampInicial > maxTime) {
      effectiveTimestampInicial = Math.max(0, (minTime != null ? minTime - 1 : 0));
      logger.warn(
        `[SYNC] ${dispositivo.nome}: timestampInicial (${timestampInicial}) à frente do max time da catraca (${maxTime}). Processando todos os ${logs.length} logs já trazidos (effectiveTimestampInicial=${effectiveTimestampInicial}) para incluir acessos de hoje (ex.: 13h).`
      );
    }
    const passamPrimeiroFiltro = logs.filter((l) => (l.id != null && Number(l.id) > MIN_ID) && (l.time != null && Number(l.time) > effectiveTimestampInicial)).length;
    logger.info(
      `[SYNC] ${dispositivo.nome}: diagnóstico catraca → id [${minId}, ${maxId}], time [${minTime}, ${maxTime}], effectiveTimestampInicial=${effectiveTimestampInicial}, MIN_ID=${MIN_ID}, passam 1º filtro=${passamPrimeiroFiltro}/${logs.length}`
    );
    if (passamPrimeiroFiltro === 0 && MIN_ID > 0 && maxId != null && maxId < MIN_ID) {
      logger.warn(
        `[SYNC] ${dispositivo.nome}: CATRACA_MIN_LOG_ID=${MIN_ID} é maior que o maior id da catraca (${maxId}). Nenhum log será processado. Use CATRACA_MIN_LOG_ID=0 ou um valor <= ${maxId}.`
      );
    }
  }

  // Ordenar do mais recente ao mais antigo: usuário vê os últimos acessos em segundos enquanto a sync continua em background
  logs.sort((a, b) => (Number(b?.time) || 0) - (Number(a?.time) || 0));

  let acessosSincronizados = 0;
  let ignoradosPessoa = 0;
  let ignoradosDuplicata = 0;
  const globalState = require('../state/globalState');
  const { emitToRoom } = require('../websocket/wsServer');
  const { cacheMutation, invalidateMultiple, CACHE_KEYS } = require('../cache/helpers');
  const { emitNotification } = require('./notificationService');

  // Processar lista em memória: só MySQL (SELECT/INSERT); nenhuma nova requisição à catraca.
  for (const log of logs) {
    if (log.id <= MIN_ID || log.time <= effectiveTimestampInicial) continue;
    if (log.user_id == null || log.user_id === 0 || String(log.user_id).trim() === '') continue;

    const pessoa_id = userIdCatracaParaPessoaId(log.user_id);
    if (pessoa_id == null || isNaN(pessoa_id) || pessoa_id < 1) continue;

    const [pessoaResult] = await db.query('SELECT * FROM Pessoa WHERE id = ? LIMIT 1', [pessoa_id]);
    const pessoa = pessoaResult[0];
    if (!pessoa) {
      ignoradosPessoa++;
      logger.debug(`[SYNC] Ignorando: user_id=${log.user_id} → pessoa_id=${pessoa_id} não existe`);
      continue;
    }
    const dispositivo_id = dispositivo.id;
    const data_hora = timestampParaData(log.time);
    // Guardar em UTC como string para ORDER BY data_hora DESC mostrar o mais recente (conexão MySQL usa -03:00)
    const data_hora_utc = data_hora.toISOString().slice(0, 19).replace('T', ' ');
    const status = identificarAcesso(log.portal_id);
    const metodo_auth = mapearMetodo(log.card_value);
    const permitido = true;

    // Verifica se já existe: tenta por UTC e por Date (registros antigos podem estar em horário Brasil)
    let [acessoExistenteResult] = await db.query(
      'SELECT * FROM Acesso WHERE pessoa_id = ? AND dispositivo_id = ? AND data_hora = ? LIMIT 1',
      [pessoa_id, dispositivo_id, data_hora_utc]
    );
    if (!acessoExistenteResult[0]) {
      [acessoExistenteResult] = await db.query(
        'SELECT * FROM Acesso WHERE pessoa_id = ? AND dispositivo_id = ? AND data_hora = ? LIMIT 1',
        [pessoa_id, dispositivo_id, data_hora]
      );
    }
    const acessoExistente = acessoExistenteResult[0];
    if (acessoExistente) ignoradosDuplicata++;

    if (!acessoExistente) {
      await db.query(
        `INSERT INTO Acesso (pessoa_id, dispositivo_id, status, permitido, metodo_auth, data_hora, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [pessoa_id, dispositivo_id, status, permitido, metodo_auth, data_hora_utc, new Date()]
      );
      acessosSincronizados++;

      try {
        globalState.incrementAcessoTodiaSuccesso();
        emitToRoom('acessos', 'acesso:novo', {
          pessoa_id,
          dispositivo_id,
          status,
          permitido: true,
          data_hora: data_hora.toISOString(),
          pessoa_nome: pessoa?.nome
        });
        emitToRoom('stats', 'stats:update', globalState.getStats());
      } catch (e) {
        // não falhar a sync por causa de WebSocket
      }

      await verificarEAtribuirPresenca(pessoa_id, data_hora);
      logger.debug(`[SYNC] Acesso registrado: ${pessoa.nome} (pessoa_id=${pessoa_id}) em ${dispositivo.nome}`);
      // Invalidar cache logo após inserir para F5 na tela de monitoramento mostrar o novo acesso
      try {
        await invalidateMultiple([CACHE_KEYS.INVALIDATE_ACESSOS, CACHE_KEYS.ACESSOS_HOJE]);
      } catch (e) { /* ignorar */ }
    }
  }

  logger.info(
    `[SYNC] ${dispositivo.nome}: effectiveTimestampInicial=${effectiveTimestampInicial}, logs=${logs.length}, ` +
    `inseridos=${acessosSincronizados}, ignorados(pessoa)=${ignoradosPessoa}, ignorados(duplicata)=${ignoradosDuplicata}`
  );

  // Persistir maior log.id da catraca para próxima sync pedir só id > ultimo_log_id_sincronizado
  const logIds = logs.map((l) => (l.id != null ? Number(l.id) : NaN)).filter((n) => !isNaN(n));
  if (logIds.length > 0) {
    const maxLogId = Math.max(...logIds);
    const currentMax = dispositivo.ultimo_log_id_sincronizado != null ? Number(dispositivo.ultimo_log_id_sincronizado) : 0;
    const newMax = Math.max(maxLogId, currentMax);
    try {
      await db.query(
        'UPDATE Dispositivo SET ultimo_log_id_sincronizado = ? WHERE id = ?',
        [newMax, dispositivo.id]
      );
      logger.debug(`[SYNC] ${dispositivo.nome}: ultimo_log_id_sincronizado = ${newMax}`);
    } catch (e) {
      logger.debug(`[SYNC] Não foi possível atualizar ultimo_log_id_sincronizado: ${e.message}`);
    }
  }

  // Invalidar cache da lista sempre que rodar sync (para GET /acessos devolver dados frescos)
  try {
    await cacheMutation(() => {}, [CACHE_KEYS.INVALIDATE_ACESSOS, CACHE_KEYS.ACESSOS_HOJE]);
  } catch (e) { /* ignorar */ }
  if (acessosSincronizados > 0) {
    logger.info(`[SYNC] ${dispositivo.nome}: ${acessosSincronizados} novo(s) acesso(s) inserido(s)`);
    try {
      emitNotification({
        title: 'Sincronização de acessos concluída',
        message: `${acessosSincronizados} acesso(s) sincronizado(s) para ${dispositivo.nome}.`,
        type: 'info',
      });
    } catch (e) { /* ignorar */ }
  }

  return {
    message: `${acessosSincronizados} acessos sincronizados para ${dispositivo.nome}`,
    dispositivo_id: dispositivo.id,
    nome: dispositivo.nome,
    sucesso: true,
    acessosSincronizados
  };
}

// Sincroniza todos os dispositivos
async function sincronizarTodosAcessos() {
  const [dispositivos] = await db.query('SELECT * FROM Dispositivo');
  const resultados = [];

  if (!dispositivos || dispositivos.length === 0) return resultados;

  for (const dispositivo of dispositivos) {
    // Verifica se a sincronização está ativa para este dispositivo
    if (dispositivo.sync_ativo === false || dispositivo.sync_ativo === 0) {
      const logger = require('../config/logger');
      logger.debug(`[SYNC] Sync desativado para dispositivo ${dispositivo.nome}, pulando sincronização de acessos`);
      resultados.push({ sucesso: false, message: `Sincronização desativada para ${dispositivo.nome}`, dispositivoId: dispositivo.id });
      continue;
    }
    
    const resultado = await sincronizarAcessos(dispositivo);
    resultados.push(resultado);
  }

  return resultados;
}

// Criar acesso manual
async function criarAcesso(dados) {
  let { pessoa_id, dispositivo_id, status, permitido, metodo_auth } = dados;

  // Pessoa existe?
  const [pessoaResult] = await db.query('SELECT * FROM Pessoa WHERE id = ? LIMIT 1', [pessoa_id]);
  const pessoa = pessoaResult[0];
  if (!pessoa) return { message: 'Pessoa não encontrada', error: 'PESSOA_INEXISTENTE' };

  // Calcula idade
  const idadePessoa = calcularIdade(pessoa.data_nascimento || new Date());

  // Último acesso
  const [ultimoAcessoResult] = await db.query(
    'SELECT * FROM Acesso WHERE pessoa_id = ? ORDER BY data_hora DESC LIMIT 1',
    [pessoa.id]
  );
  const ultimoAcesso = ultimoAcessoResult[0];

  if (status === 'ENTRADA' && ultimoAcesso?.status === 'ENTRADA') {
    return { message: 'Usuário já está dentro, não pode entrar novamente sem sair' };
  }
  if (status === 'SAIDA' && (!ultimoAcesso || ultimoAcesso.status !== 'ENTRADA')) {
    return { message: 'Usuário não está dentro, não pode sair sem entrar antes' };
  }

  // Permissão básica
  permitido = true;
  let mensagem = `Acesso autorizado para ${pessoa.nome}`;

  // Insere acesso
  await db.query(
    `INSERT INTO Acesso (pessoa_id, dispositivo_id, status, permitido, metodo_auth, data_hora, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [pessoa_id, dispositivo_id, status, permitido, metodo_auth, new Date(), new Date()]
  );

  const [acessoResult] = await db.query('SELECT * FROM Acesso WHERE id = LAST_INSERT_ID() LIMIT 1');
  const acesso = acessoResult[0];

  return { message: mensagem, acesso };
}

/**
 * Processa o payload POST /api/notifications/dao enviado pelo Monitor da Control iD.
 * Documentação: https://www.controlid.com.br/docs/access-api-pt/monitor/introducao-ao-monitor/
 * @param {object} payload - { object_changes: [{ object, type, values }], device_id }
 * @returns {Promise<{ processados: number, ignorados: number, erros: string[] }>}
 */
async function processarNotificacaoMonitorDao(payload) {
  const logger = require('../config/logger');
  const { emitToRoom } = require('../websocket/wsServer');
  const globalState = require('../state/globalState');
  const { cacheMutation, invalidateMultiple, CACHE_KEYS } = require('../cache/helpers');

  const result = { processados: 0, ignorados: 0, erros: [] };
  const deviceIdControlId = payload.device_id != null ? Number(payload.device_id) : null;
  const objectChanges = Array.isArray(payload.object_changes) ? payload.object_changes : [];

  if (objectChanges.length === 0) {
    return result;
  }

  if (deviceIdControlId == null) {
    logger.warn('[MONITOR DAO] Payload sem device_id');
    result.erros.push('device_id ausente');
    return result;
  }

  // Resolve nosso dispositivo: por control_id_device_id ou fallback único dispositivo
  let dispositivo_id = null;
  try {
    const [dispositivosRows] = await db.query(
      'SELECT id, nome FROM Dispositivo WHERE control_id_device_id = ? LIMIT 1',
      [deviceIdControlId]
    );
    dispositivo_id = dispositivosRows[0]?.id;
  } catch (e) {
    if (e.code === 'ER_BAD_FIELD_ERROR') {
      logger.warn('[MONITOR DAO] Coluna control_id_device_id não existe. Execute database/migration_control_id_device_id.sql');
    }
  }
  if (!dispositivo_id) {
    const [todos] = await db.query('SELECT id, nome FROM Dispositivo');
    if (todos.length === 1) {
      dispositivo_id = todos[0].id;
      logger.debug(`[MONITOR DAO] device_id ${deviceIdControlId} mapeado para único dispositivo id ${dispositivo_id}`);
    } else {
      const total = todos.length;
      logger.warn(
        `[MONITOR DAO] Você tem ${total} dispositivo(s) cadastrado(s). O device_id ${deviceIdControlId} da catraca não está mapeado. ` +
          'Rode database/migration_control_id_device_id.sql e preencha control_id_device_id em cada Dispositivo (use o device_id que aparece neste log).'
      );
      result.erros.push(`Dispositivo não mapeado para device_id ${deviceIdControlId}`);
      return result;
    }
  }

  const maxEventAgeSeconds = parseInt(process.env.MONITOR_MAX_EVENT_AGE_SECONDS || '300', 10); // 5 min padrão (proteção replay)
  const nowUnix = Math.floor(Date.now() / 1000);

  for (const change of objectChanges) {
    if (change.object !== 'access_logs' || change.type !== 'inserted' || !change.values) {
      result.ignorados++;
      continue;
    }

    const v = change.values;
    const time = v.time != null ? Number(v.time) : null;
    const user_id_catraca = v.user_id != null ? Number(v.user_id) : null;
    const portal_id = v.portal_id != null ? Number(v.portal_id) : 1;
    let card_value = String(v.card_value != null ? v.card_value : '');
    if (card_value.length > 64) card_value = card_value.slice(0, 64);

    if (time == null || Number.isNaN(time)) {
      result.ignorados++;
      continue;
    }

    if (maxEventAgeSeconds > 0 && (nowUnix - time > maxEventAgeSeconds || time > nowUnix + 60)) {
      logger.debug(`[MONITOR DAO] Evento ignorado (replay/antigo): time=${time}, now=${nowUnix}, maxAge=${maxEventAgeSeconds}s`);
      result.ignorados++;
      continue;
    }

    const pessoa_id = userIdCatracaParaPessoaId(user_id_catraca);
    if (pessoa_id == null || !Number.isInteger(pessoa_id) || pessoa_id < 1) {
      tentativasNegadas++;
      result.ignorados++;
      continue;
    }
    const data_hora = timestampParaData(time);
    const status = identificarAcesso(portal_id);
    const metodo_auth = mapearMetodo(card_value);
    const permitido = true;

    const [pessoaResult] = await db.query('SELECT id, nome FROM Pessoa WHERE id = ? LIMIT 1', [pessoa_id]);
    const pessoa = pessoaResult[0];
    if (!pessoa) {
      tentativasNegadas++;
      logger.debug(`[MONITOR DAO] Pessoa id ${pessoa_id} não existe, ignorando log`);
      result.ignorados++;
      continue;
    }

    const [acessoExistenteResult] = await db.query(
      'SELECT id FROM Acesso WHERE pessoa_id = ? AND dispositivo_id = ? AND data_hora = ? LIMIT 1',
      [pessoa_id, dispositivo_id, data_hora]
    );
    if (acessoExistenteResult[0]) {
      result.ignorados++;
      continue;
    }

    try {
      await db.query(
        `INSERT INTO Acesso (pessoa_id, dispositivo_id, status, permitido, metodo_auth, data_hora, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [pessoa_id, dispositivo_id, status, permitido, metodo_auth, data_hora, new Date()]
      );
      result.processados++;

      globalState.incrementAcessoTodiaSuccesso();
      emitToRoom('acessos', 'acesso:novo', {
        pessoa_id,
        dispositivo_id,
        status,
        permitido: true,
        data_hora: data_hora.toISOString(),
        pessoa_nome: pessoa.nome
      });
      emitToRoom('stats', 'stats:update', globalState.getStats());

      await verificarEAtribuirPresenca(pessoa_id, data_hora);
      logger.debug(`[MONITOR DAO] Acesso registrado: pessoa ${pessoa_id}, dispositivo ${dispositivo_id}`);
    } catch (err) {
      logger.error(`[MONITOR DAO] Erro ao inserir acesso: ${err.message}`);
      result.erros.push(err.message);
    }
  }

  if (result.processados > 0) {
    try {
      await cacheMutation(() => {}, [CACHE_KEYS.INVALIDATE_ACESSOS, CACHE_KEYS.ACESSOS_HOJE]);
      emitNotification({
        title: 'Sincronização de acessos concluída',
        message: `${result.processados} acesso(s) registrado(s) via Monitor (catraca).`,
        type: 'info',
      });
    } catch (e) { /* ignorar */ }
  }
  if (tentativasNegadas > 0) {
    try {
      emitNotification({
        title: 'Acesso negado / tentativa inválida',
        message: `${tentativasNegadas} tentativa(s) de acesso com identificação não cadastrada.`,
        type: 'warning',
      });
    } catch (e) { /* ignorar */ }
  }

  return result;
}

module.exports = {
  sincronizarAcessos,
  sincronizarTodosAcessos,
  criarAcesso,
  processarNotificacaoMonitorDao
};
