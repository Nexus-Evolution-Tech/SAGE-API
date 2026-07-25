const axiosInstance = require('../config/axios');
const fs = require('fs');
const path = require('path');
const logger = require('../config/logger');
const { ORDEM_ZERAR_CATRACA } = require('../config/syncOrder');

const CHUNK_SIZE = parseInt(process.env.CATRACA_BACKUP_CHUNK_SIZE || '2000', 10);

/** Tipos de objeto Control iD que entram no backup completo (users, areas, groups, etc.). */
const OBJETOS_CATRACA_BACKUP = [
  'users', 'areas', 'groups', 'user_groups', 'portals', 'access_rules',
  'cards', 'qrcodes', 'time_zones', 'time_spans',
  'group_access_rules', 'user_access_rules', 'portal_access_rules',
  'user_roles', 'scheduled_unlocks', 'actions'
];
const OBJETOS_CATRACA_LISTAVEIS = [...OBJETOS_CATRACA_BACKUP];

/** Lista única de tipos para ferramentas (backup/zerar por tipo): backup + access_logs + ordem zerar. */
const OBJETOS_CATRACA_FERRAMENTAS = [...new Set([...OBJETOS_CATRACA_BACKUP, 'access_logs', ...ORDEM_ZERAR_CATRACA])].sort();

/** Status HTTP que indicam "tente de novo" (serviço indisponível / overload) */
const RETRY_STATUSES = [502, 503, 504];
/** Atrasos em ms antes de cada nova tentativa (até 3 retentativas) */
const RETRY_DELAYS_MS = [
  parseInt(process.env.CATRACA_RETRY_DELAY_1_MS || '2000', 10),
  parseInt(process.env.CATRACA_RETRY_DELAY_2_MS || '5000', 10),
  parseInt(process.env.CATRACA_RETRY_DELAY_3_MS || '10000', 10)
];

/**
 * Executa uma requisição assíncrona e, em caso de 502/503/504, refaz até 3 vezes com backoff.
 * @param {() => Promise<T>} fn - Função que faz a requisição (ex.: () => axios.post(...))
 * @param {string} context - Texto para log (ex.: nome da catraca + operação)
 * @returns {Promise<T>}
 */
async function withRetryOnUnavailable(fn, context = '') {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      const willRetry = status && RETRY_STATUSES.includes(status) && attempt < 4;
      if (willRetry) {
        const delay = RETRY_DELAYS_MS[attempt - 1];
        logger.warn(`[CATRACA] ${context}: HTTP ${status}, nova tentativa em ${delay / 1000}s (${attempt}/3)`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
  throw lastError;
}

async function listarTodos() {
  try {
    const dispositivos = await global.db('Dispositivo').select('*').get();
    logger.debug(`${dispositivos.length} dispositivos encontrados`);
    return dispositivos;
  } catch (error) {
    logger.errorWithStack('Erro ao listar dispositivos', error);
    return [];
  }
}

function linkCatraca(dispositivo) {
  return `${dispositivo.endereco}:${dispositivo.porta}`;
}

async function obterSessao(linkCatraca, dispositivo, forceNew = false) {
  try {
    const session = await withRetryOnUnavailable(async () => {
      logger.debug(` Criando nova sessão: ${dispositivo.nome}`);
      const response = await axiosInstance.post(`http://${linkCatraca}/login.fcgi`, {
        login: dispositivo.usuario,
        password: dispositivo.senha
      });
      const s = response.data?.session;
      if (!s) throw new Error('Sessão não retornada pela catraca');
      logger.info(` Sessão criada para ${dispositivo.nome}: ${s}`);
      return s;
    }, `${dispositivo.nome} login`);
    return session;
  } catch (error) {
    logger.error(` Erro ao obter sessão ${dispositivo.nome}: ${error.message}`);
    return null;
  }
}

async function verificarSessao(session, linkCatraca) {
  try {
    const response = await axiosInstance.post(
      `http://${linkCatraca}/session_is_valid.fcgi?session=${session}`
    );
    return response.data?.session_is_valid === true;
  } catch (error) {
    logger.debug(`Erro ao verificar sessão: ${error.message}`);
    return false;
  }
}

/**
 * Obtém logs de acesso da catraca (load_objects).
 * @param {string} session - Sessão Control iD
 * @param {string} linkCatraca - endereco:porta
 * @param {number} timestampInicial - Filtrar em JS logs com time > timestampInicial (legado)
 * @param {object} options - Opcional: { lastLogId, limit, offset } para reduzir payload
 *   - lastLogId: pedir só access_logs com id > lastLogId (where na API)
 *   - limit, offset: paginação na API
 * @returns {Promise<Array>} access_logs
 */
async function obterLogsCatraca(session, linkCatraca, timestampInicial = 0, options = {}) {
  try {
    const loadLogsTimeoutMs = parseInt(process.env.CATRACA_LOAD_LOGS_TIMEOUT || '60000', 10);
    const body = { object: 'access_logs' };

    if (options.lastLogId != null && Number(options.lastLogId) >= 0) {
      body.where = { access_logs: { id: { '>': Number(options.lastLogId) } } };
    }
    if (options.limit != null && options.limit > 0) {
      body.limit = options.limit;
    }
    if (options.offset != null && options.offset >= 0 && body.limit != null) {
      body.offset = options.offset;
    }
    if (options.order != null) {
      body.order = options.order;
    }

    const response = await axiosInstance.post(
      `http://${linkCatraca}/load_objects.fcgi?session=${session}`,
      body,
      { timeout: loadLogsTimeoutMs }
    );

    const logs = response.data.access_logs || [];
    const logsFiltrados = timestampInicial > 0
      ? logs.filter(log => log.time > timestampInicial)
      : logs;

    if (logs.length !== logsFiltrados.length || logsFiltrados.length === 0) {
      logger.info(`[load_objects] catraca retornou ${logs.length} logs, após filtro time>${timestampInicial} restaram ${logsFiltrados.length}`);
    }
    return logsFiltrados;
  } catch (error) {
    logger.errorWithStack('Erro ao obter logs da catraca', error);
    return [];
  }
}

/**
 * Verifica se a catraca tem muitos logs (amostra leve para decidir "zerar ou continuar").
 * Chama load_objects com limit para não trazer os 49k.
 * @param {object} dispositivo - Dispositivo do banco
 * @param {object} options - { limit?: number } (default 5000). Se a resposta tiver length >= limit, considera "muitos dados antigos".
 * @returns {Promise<{ hasManyOldLogs: boolean, estimatedCount?: number, error?: string }>}
 */
async function obterQuantidadeOuAmostraLogsCatraca(dispositivo, options = {}) {
  const threshold = options.limit ?? parseInt(process.env.CATRACA_LOGS_INFO_THRESHOLD || '5000', 10);
  const link = linkCatraca(dispositivo);
  const session = await obterSessao(link, dispositivo);
  if (!session) {
    return { hasManyOldLogs: false, error: 'Sessão não obtida' };
  }
  try {
    const loadLogsTimeoutMs = parseInt(process.env.CATRACA_LOAD_LOGS_TIMEOUT || '60000', 10);
    const body = {
      object: 'access_logs',
      limit: threshold,
      offset: 0,
      order: ['descending', 'id']
    };
    const response = await axiosInstance.post(
      `http://${link}/load_objects.fcgi?session=${session}`,
      body,
      { timeout: loadLogsTimeoutMs }
    );
    const logs = response.data.access_logs || [];
    const hasManyOldLogs = logs.length >= threshold;
    return {
      hasManyOldLogs,
      estimatedCount: hasManyOldLogs ? Math.max(logs.length, threshold) : logs.length
    };
  } catch (error) {
    logger.errorWithStack('Erro ao obter amostra de logs da catraca', error);
    return { hasManyOldLogs: false, error: error.message };
  }
}

/**
 * Carrega um tipo de objeto da catraca (load_objects) — users, areas, groups, etc.
 * @param {object} dispositivo - Dispositivo do banco
 * @param {string} objectType - Nome do objeto na API (users, areas, groups, user_groups, portals, ...)
 * @param {object} options - { limit?: number, offset?: number, where?: object }
 * @returns {Promise<{ data: Array, total?: number }>}
 */
async function loadObjectsFromCatraca(dispositivo, objectType, options = {}) {
  const link = linkCatraca(dispositivo);
  const session = await obterSessao(link, dispositivo);
  if (!session) {
    throw new Error('Sessão não obtida na catraca');
  }
  const timeoutMs = parseInt(process.env.CATRACA_LOAD_LOGS_TIMEOUT || '60000', 10);
  const body = { object: objectType };
  if (options.limit != null && options.limit > 0) body.limit = options.limit;
  if (options.offset != null && options.offset >= 0 && body.limit != null) body.offset = options.offset;
  if (options.where != null && typeof options.where === 'object') body.where = options.where;

  const response = await axiosInstance.post(
    `http://${link}/load_objects.fcgi?session=${session}`,
    body,
    { headers: { 'Content-Type': 'application/json' }, timeout: timeoutMs }
  );
  const data = response.data[objectType];
  const arr = Array.isArray(data) ? data : [];
  logger.debug(`[CATRACA] ${dispositivo.nome}: load_objects ${objectType} → ${arr.length} itens`);
  return { data: arr };
}

/**
 * Destrói objetos na catraca (destroy_objects). Ex.: usuário, área, grupo por id.
 * @param {object} dispositivo - Dispositivo do banco
 * @param {string} objectType - users, areas, groups, cards, qrcodes, etc.
 * @param {object} where - Filtro no formato da API, ex.: { users: { id: 123 } }
 * @returns {Promise<{ ok: boolean, changes?: number, message?: string }>}
 */
async function destroyObjectsOnCatraca(dispositivo, objectType, where) {
  const link = linkCatraca(dispositivo);
  const session = await obterSessao(link, dispositivo);
  if (!session) {
    return { ok: false, message: 'Sessão não obtida na catraca' };
  }
  const url = `http://${link}/destroy_objects.fcgi?session=${session}`;
  const body = { object: objectType, where };
  try {
    const response = await axiosInstance.post(url, body, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    });
    const d = response.data;
    if (d && typeof d.error !== 'undefined' && d.error !== null) {
      return { ok: false, message: d.error.message || d.error.msg || JSON.stringify(d.error) };
    }
    const changes = d?.changes ?? 0;
    logger.info(`[CATRACA] ${dispositivo.nome}: destroy_objects ${objectType} → changes=${changes}`);
    return { ok: true, changes };
  } catch (error) {
    const msg = error.response?.data?.error?.message || error.response?.data?.error?.msg || error.message;
    logger.errorWithStack(`Erro ao destruir ${objectType} na catraca ${dispositivo.nome}`, error);
    return { ok: false, message: msg };
  }
}

/** Onde "delete all" por tipo: a maioria usa id >= 0; alguns usam user_id ou outro campo. */
function getWhereDeleteAll(objectType) {
  const byField = {
    user_groups: { user_id: { '>=': 0 } },
    user_roles: { user_id: { '>=': 0 } },
    user_access_rules: { user_id: { '>=': 0 } },
    group_access_rules: { group_id: { '>=': 0 } },
    portal_access_rules: { portal_id: { '>=': 0 } },
    access_rule_time_zones: { access_rule_id: { '>=': 0 } },
    scheduled_unlock_access_rules: { scheduled_unlock_id: { '>=': 0 } },
    portal_actions: { portal_id: { '>=': 0 } }
  };
  const field = byField[objectType];
  if (field) return { [objectType]: field };
  return { [objectType]: { id: { '>=': 0 } } };
}

/**
 * Apaga todos os objetos na catraca na ordem inversa das dependências (user_groups → … → areas → access_logs).
 * Deixa a catraca vazia para você recolocar só os dados do SAGE e manter sincronia.
 * @param {object} dispositivo - Dispositivo do banco
 * @returns {Promise<{ ok: boolean, summary: object, erros: string[], message?: string }>}
 */
async function zerarTudoNaCatraca(dispositivo) {
  const summary = {};
  const erros = [];
  for (const objectType of ORDEM_ZERAR_CATRACA) {
    if (objectType === 'access_logs') {
      const res = await zerarAccessLogsCatraca(dispositivo);
      summary.access_logs = res.ok ? (res.changes ?? 'ok') : 0;
      if (!res.ok) erros.push(`access_logs: ${res.message}`);
      continue;
    }
    const where = getWhereDeleteAll(objectType);
    const res = await destroyObjectsOnCatraca(dispositivo, objectType, where);
    summary[objectType] = res.ok ? (res.changes ?? 0) : 0;
    if (!res.ok) erros.push(`${objectType}: ${res.message}`);
    if (res.ok && (res.changes ?? 0) > 0) {
      logger.info(`[ZERAR TUDO] ${dispositivo.nome}: ${objectType} → ${res.changes} removidos`);
    }
  }
  const ok = erros.length === 0;
  logger.info(`[ZERAR TUDO] ${dispositivo.nome}: concluído`, summary);
  return { ok, summary, erros, message: ok ? 'Catraca zerada (todos os objetos apagados).' : `Alguns tipos falharam: ${erros.join('; ')}` };
}

/**
 * Gera backup completo da configuração da catraca (users, areas, groups, portals, etc.) em um único JSON.
 * @param {object} dispositivo - Dispositivo do banco
 * @returns {Promise<{ filePath: string, filename: string, summary: object }>}
 */
async function gerarBackupCompletoCatraca(dispositivo) {
  const link = linkCatraca(dispositivo);
  const session = await obterSessao(link, dispositivo);
  if (!session) {
    throw new Error('Sessão não obtida na catraca');
  }
  const backupsDir = path.resolve(process.cwd(), 'backups');
  if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `catraca_${dispositivo.id}_completo_${timestamp}.json`;
  const filePath = path.join(backupsDir, filename);
  const timeoutMs = parseInt(process.env.CATRACA_LOAD_LOGS_TIMEOUT || '60000', 10);
  const url = `http://${link}/load_objects.fcgi?session=${session}`;
  const opts = { headers: { 'Content-Type': 'application/json' }, timeout: timeoutMs };
  const result = { dispositivo_id: dispositivo.id, dispositivo_nome: dispositivo.nome, exportado_em: new Date().toISOString(), dados: {} };
  const summary = {};

  for (const objectType of OBJETOS_CATRACA_BACKUP) {
    try {
      const res = await axiosInstance.post(url, { object: objectType }, opts);
      const arr = Array.isArray(res.data[objectType]) ? res.data[objectType] : [];
      result.dados[objectType] = arr;
      summary[objectType] = arr.length;
      logger.debug(`[BACKUP COMPLETO] ${dispositivo.nome}: ${objectType} = ${arr.length}`);
    } catch (err) {
      logger.warn(`[BACKUP COMPLETO] ${dispositivo.nome}: ${objectType} falhou: ${err.message}`);
      result.dados[objectType] = [];
      result.erros = result.erros || {};
      result.erros[objectType] = err.message;
      summary[objectType] = 0;
    }
  }

  fs.writeFileSync(filePath, JSON.stringify(result, null, 2), 'utf8');
  logger.info(`[BACKUP COMPLETO] ${dispositivo.nome}: ${filename}`, summary);
  return { filePath, filename, summary };
}

/**
 * Gera backup dos access_logs da catraca em chunks (JSONL).
 * @param {object} dispositivo - Dispositivo do banco
 * @returns {Promise<{ filePath: string, filename: string, totalLines: number }>}
 */
async function gerarBackupLogsCatraca(dispositivo) {
  const link = linkCatraca(dispositivo);
  const session = await obterSessao(link, dispositivo);
  if (!session) {
    throw new Error('Sessão não obtida na catraca');
  }

  const backupsDir = path.resolve(process.cwd(), 'backups');
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `acessos_catraca_${dispositivo.id}_${timestamp}.jsonl`;
  const filePath = path.join(backupsDir, filename);

  const loadLogsTimeoutMs = parseInt(process.env.CATRACA_LOAD_LOGS_TIMEOUT || '60000', 10);
  let offset = 0;
  let totalLines = 0;
  const writeStream = fs.createWriteStream(filePath, { flags: 'a' });

  try {
    while (true) {
      const body = {
        object: 'access_logs',
        limit: CHUNK_SIZE,
        offset
      };
      const response = await axiosInstance.post(
        `http://${link}/load_objects.fcgi?session=${session}`,
        body,
        { timeout: loadLogsTimeoutMs }
      );
      const logs = response.data.access_logs || [];
      for (const log of logs) {
        writeStream.write(JSON.stringify(log) + '\n');
        totalLines++;
      }
      logger.debug(`[BACKUP] ${dispositivo.nome}: chunk offset=${offset}, got ${logs.length}, total=${totalLines}`);
      if (logs.length < CHUNK_SIZE) break;
      offset += CHUNK_SIZE;
    }
    return new Promise((resolve, reject) => {
      writeStream.on('finish', () => resolve({ filePath, filename, totalLines }));
      writeStream.on('error', reject);
      writeStream.end();
    });
  } catch (error) {
    writeStream.destroy();
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    throw error;
  }
}

/**
 * Zera (apaga) todos os access_logs na catraca Control iD.
 * Documentação: https://www.controlid.com.br/docs/access-api-pt/objetos/destruir-objetos/
 * Tenta primeiro formato moderno (where objeto); se falhar, tenta formato em array (firmware antigo).
 * @param {object} dispositivo - Dispositivo do banco
 * @returns {Promise<{ ok: boolean, changes?: number, message?: string }>}
 */
async function zerarAccessLogsCatraca(dispositivo) {
  const link = linkCatraca(dispositivo);
  const session = await obterSessao(link, dispositivo);
  if (!session) {
    return { ok: false, message: 'Sessão não obtida na catraca' };
  }

  const url = `http://${link}/destroy_objects.fcgi?session=${session}`;
  // Catraca pode demorar muito para apagar 70k+ logs; timeout alto e configurável (padrão 3 min)
  const zerarTimeoutMs = parseInt(process.env.CATRACA_ZERAR_LOGS_TIMEOUT_MS || '180000', 10);
  const opts = { headers: { 'Content-Type': 'application/json' }, timeout: zerarTimeoutMs };

  // Formato 1: where como objeto (API moderna) — id >= 0 = todos os logs
  const bodyObjeto = {
    object: 'access_logs',
    where: { access_logs: { id: { '>=': 0 } } }
  };

  // Formato 2: where como array (alguns firmware antigos Control iD)
  const bodyArray = {
    object: 'access_logs',
    where: [
      { object: 'access_logs', field: 'id', operator: '>=', value: 0 }
    ]
  };

  logger.info(`[ZERAR] ${dispositivo.nome}: enviando destroy_objects com object="access_logs", where id>=0 (timeout=${zerarTimeoutMs / 1000}s)`);

  const tryRequest = async (body) => {
    const data = await withRetryOnUnavailable(async () => {
      const response = await axiosInstance.post(url, body, opts);
      const d = response.data;
      if (d && typeof d.error !== 'undefined' && d.error !== null) {
        logger.warn(`[ZERAR] ${dispositivo.nome}: catraca retornou error no body`, d.error);
        throw new Error(d.error.message || d.error.msg || JSON.stringify(d.error));
      }
      return d;
    }, `${dispositivo.nome} destroy_objects`);
    return data;
  };

  const buildMessage = (err) => {
    const status = err.response?.status;
    const friendly503 = (status === 503 || status === 502 || status === 504)
      ? 'Catraca retornou serviço indisponível (HTTP ' + status + '). Pode ser sobrecarga ou dispositivo ocupado; tente novamente em alguns segundos ou reinicie a catraca. '
      : '';
    const msg = err.response?.data?.error?.message
      || err.response?.data?.error?.msg
      || err.response?.data?.message
      || (typeof err.response?.data === 'string' ? err.response.data : null);
    const extra = msg ? ` Resposta da catraca: ${msg}` : '';
    return friendly503 + err.message + extra;
  };

  try {
    let data;
    try {
      data = await tryRequest(bodyObjeto);
    } catch (firstErr) {
      const code = firstErr.response?.status;
      const bodyErr = firstErr.response?.data;
      logger.warn(`[ZERAR] ${dispositivo.nome}: formato objeto falhou (status=${code})`, bodyErr ? JSON.stringify(bodyErr).slice(0, 200) : firstErr.message);
      data = await tryRequest(bodyArray);
      logger.info(`[ZERAR] ${dispositivo.nome}: usado formato array (compatível com firmware antigo)`);
    }
    const changes = data?.changes;
    logger.info(`[ZERAR] ${dispositivo.nome}: access_logs zerados (changes=${changes ?? 'n/a'})`);
    return { ok: true, changes };
  } catch (error) {
    const status = error.response?.status;
    const body = error.response?.data;
    if (status && status >= 400 && body != null && typeof body === 'object' && !body.type?.includes?.('html')) {
      logger.warn(`[ZERAR] ${dispositivo.nome}: resposta da catraca (HTTP ${status})`, JSON.stringify(body).slice(0, 500));
    } else if (status && typeof body === 'string' && body.length < 300 && !body.includes('<!DOCTYPE')) {
      logger.warn(`[ZERAR] ${dispositivo.nome}: resposta da catraca (HTTP ${status})`, body);
    }
    const message = buildMessage(error);
    logger.errorWithStack(`Erro ao zerar access_logs na catraca ${dispositivo.nome}`, error);
    return { ok: false, message };
  }
}

/**
 * Gera backup de um único tipo de objeto na catraca (download por tipo).
 * access_logs → JSONL em chunks; outros tipos → load_objects paginado em um JSON.
 * @param {object} dispositivo - Dispositivo do banco
 * @param {string} objectType - users, areas, access_logs, etc.
 * @returns {Promise<{ filePath: string, filename: string, totalLines?: number, totalItems?: number }>}
 */
async function backupPorTipo(dispositivo, objectType) {
  const tipo = (objectType || '').toLowerCase().trim();
  if (!OBJETOS_CATRACA_FERRAMENTAS.includes(tipo)) {
    throw new Error(`Tipo inválido. Permitidos: ${OBJETOS_CATRACA_FERRAMENTAS.join(', ')}`);
  }
  if (tipo === 'access_logs') {
    return gerarBackupLogsCatraca(dispositivo);
  }
  if (!OBJETOS_CATRACA_BACKUP.includes(tipo)) {
    throw new Error(`Backup por tipo não suportado para "${tipo}". Use um dos tipos do backup completo.`);
  }
  const backupsDir = path.resolve(process.cwd(), 'backups');
  if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `catraca_${dispositivo.id}_${tipo}_${timestamp}.json`;
  const filePath = path.join(backupsDir, filename);
  const limit = CHUNK_SIZE;
  let offset = 0;
  const all = [];
  while (true) {
    const { data } = await loadObjectsFromCatraca(dispositivo, tipo, { limit, offset });
    all.push(...data);
    logger.debug(`[BACKUP POR TIPO] ${dispositivo.nome}: ${tipo} offset=${offset} got ${data.length}`);
    if (data.length < limit) break;
    offset += limit;
  }
  fs.writeFileSync(filePath, JSON.stringify({ objectType: tipo, dispositivo_id: dispositivo.id, exportado_em: new Date().toISOString(), data: all }, null, 2), 'utf8');
  logger.info(`[BACKUP POR TIPO] ${dispositivo.nome}: ${filename} (${all.length} itens)`);
  return { filePath, filename, totalItems: all.length };
}

/**
 * Zera (apaga) todos os objetos de um único tipo na catraca.
 * access_logs usa zerarAccessLogsCatraca; outros usam destroy_objects com where "todos".
 * @param {object} dispositivo - Dispositivo do banco
 * @param {string} objectType - access_logs, users, areas, etc.
 * @returns {Promise<{ ok: boolean, changes?: number, message?: string }>}
 */
async function zerarPorTipo(dispositivo, objectType) {
  const tipo = (objectType || '').toLowerCase().trim();
  if (!OBJETOS_CATRACA_FERRAMENTAS.includes(tipo)) {
    return { ok: false, message: `Tipo inválido. Permitidos: ${OBJETOS_CATRACA_FERRAMENTAS.join(', ')}` };
  }
  if (tipo === 'access_logs') {
    return zerarAccessLogsCatraca(dispositivo);
  }
  if (!ORDEM_ZERAR_CATRACA.includes(tipo)) {
    return { ok: false, message: `Zerar por tipo não permitido para "${tipo}".` };
  }
  const where = getWhereDeleteAll(tipo);
  return destroyObjectsOnCatraca(dispositivo, tipo, where);
}

async function testarConexaoCatraca(dispositivo) {
  const link = linkCatraca(dispositivo);
  
  try {
    // Verificar se o dispositivo está na lista
    const dispositivos = await listarTodos();
    if (!dispositivos.some(d => d.endereco === dispositivo.endereco && d.porta === dispositivo.porta)) {
      logger.warn('Dispositivo não encontrado na base de dados');
      return false;
    }
  
    // Tentar obter a sessão
    const session = await obterSessao(link, dispositivo);
    if (!session) {
      logger.warn('Falha ao obter sessão');
      return false;
    }
  
    // Verificar se a sessão é válida
    const sessaoValida = await verificarSessao(session, link);
    if (!sessaoValida) {
      logger.warn('Sessão inválida');
      return false;
    }
  
    logger.info(` Conexão com catraca ${dispositivo.nome} bem-sucedida`);
    return true;
  } catch (error) {
    logger.errorWithStack('Erro ao testar conexão com catraca', error);
    return false;
  }
}

/**
 * Obtém hostname e porta do servidor para onde a catraca deve enviar eventos do Monitor.
 * Usado ao configurar o Monitor na catraca (set_configuration).
 * Configure MONITOR_CALLBACK_HOST e MONITOR_CALLBACK_PORT no .env (IP/host acessível pela rede da catraca).
 */
function getMonitorCallbackAddress() {
  const url = process.env.MONITOR_CALLBACK_URL;
  if (url) {
    try {
      const u = new URL(url.startsWith('http') ? url : `http://${url}`);
      return { hostname: u.hostname, port: u.port || '80' };
    } catch (e) {
      logger.warn('[MONITOR] MONITOR_CALLBACK_URL inválido, usando HOST/PORT');
    }
  }
  const hostname = process.env.MONITOR_CALLBACK_HOST || process.env.HOST || 'localhost';
  const port = process.env.MONITOR_CALLBACK_PORT || process.env.PORT || '3000';
  return { hostname, port: String(port) };
}

/**
 * Configura o Monitor na catraca Control iD para enviar eventos (acessos) para este servidor.
 * Deve ser chamado ao cadastrar dispositivo ou ao testar conexão, para que o monitoramento em tempo real funcione.
 * Documentação: https://www.controlid.com.br/docs/access-api-pt/monitor/introducao-ao-monitor/
 * @param {object} dispositivo - { nome, endereco, porta, usuario, senha, ... }
 * @returns {Promise<{ ok: boolean, message?: string }>}
 */
async function configurarMonitorNaCatraca(dispositivo) {
  // Modo apenas polling: não configurar push na catraca (cliente não abre porta)
  if (process.env.MONITOR_USE_PUSH !== 'true') {
    logger.debug('[MONITOR] MONITOR_USE_PUSH não está true; não configurando callback na catraca (modo polling)');
    return { ok: false, message: 'Sistema configurado apenas para polling. Para usar Monitor (push), defina MONITOR_USE_PUSH=true no .env e abra a porta no firewall.' };
  }
  const link = linkCatraca(dispositivo);
  const session = await obterSessao(link, dispositivo);
  if (!session) {
    logger.warn(`[MONITOR] Não foi possível obter sessão em ${dispositivo.nome} para configurar Monitor`);
    return { ok: false, message: 'Sessão não obtida' };
  }

  const { hostname, port } = getMonitorCallbackAddress();
  if (!hostname || hostname === 'localhost') {
    logger.warn('[MONITOR] Configure MONITOR_CALLBACK_HOST (ou MONITOR_CALLBACK_URL) no .env com o IP/host acessível pela catraca');
  }

  let pathMonitor = 'api/notifications/dao';
  const secretToken = process.env.MONITOR_CALLBACK_TOKEN;
  if (secretToken && secretToken.length > 0) {
    pathMonitor = `api/notifications/dao?token=${encodeURIComponent(secretToken)}`;
    logger.info('[MONITOR] URL do callback configurada com token (segurança)');
  }

  const monitorConfig = {
    request_timeout: '5000',
    hostname,
    port,
    path: pathMonitor
  };

  try {
    await axiosInstance.post(
      `http://${link}/set_configuration.fcgi?session=${session}`,
      { monitor: monitorConfig },
      { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
    );
    logger.info(`[MONITOR] Monitor configurado em ${dispositivo.nome} -> ${hostname}:${port}/${pathMonitor}`);
    return { ok: true };
  } catch (error) {
    logger.error(`[MONITOR] Erro ao configurar Monitor em ${dispositivo.nome}: ${error.message}`);
    return { ok: false, message: error.message };
  }
}

module.exports = {
  listarTodos,
  linkCatraca,
  obterSessao,
  verificarSessao,
  obterLogsCatraca,
  obterQuantidadeOuAmostraLogsCatraca,
  loadObjectsFromCatraca,
  gerarBackupCompletoCatraca,
  destroyObjectsOnCatraca,
  zerarTudoNaCatraca,
  gerarBackupLogsCatraca,
  zerarAccessLogsCatraca,
  testarConexaoCatraca,
  configurarMonitorNaCatraca,
  getMonitorCallbackAddress,
  OBJETOS_CATRACA_LISTAVEIS,
  OBJETOS_CATRACA_FERRAMENTAS,
  backupPorTipo,
  zerarPorTipo
};