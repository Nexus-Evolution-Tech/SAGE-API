const axiosInstance = require('../config/axios');
const fs = require('fs');
const path = require('path');
const logger = require('../config/logger');

const CHUNK_SIZE = parseInt(process.env.CATRACA_BACKUP_CHUNK_SIZE || '2000', 10);

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
    // Criar nova sessão (sem cache, performance aceitável)
    logger.debug(` Criando nova sessão: ${dispositivo.nome}`);
    const response = await axiosInstance.post(`http://${linkCatraca}/login.fcgi`, {
      login: dispositivo.usuario,
      password: dispositivo.senha
    });

    const session = response.data?.session;
    if (!session) {
      throw new Error('Sessão não retornada pela catraca');
    }

    logger.info(` Sessão criada para ${dispositivo.nome}: ${session}`);
    
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
 * @param {object} dispositivo - Dispositivo do banco
 * @returns {Promise<{ ok: boolean, changes?: number, message?: string }>}
 */
async function zerarAccessLogsCatraca(dispositivo) {
  const link = linkCatraca(dispositivo);
  const session = await obterSessao(link, dispositivo);
  if (!session) {
    return { ok: false, message: 'Sessão não obtida na catraca' };
  }
  try {
    const body = {
      object: 'access_logs',
      where: { access_logs: { id: { '>=': 0 } } }
    };
    const response = await axiosInstance.post(
      `http://${link}/destroy_objects.fcgi?session=${session}`,
      body,
      { headers: { 'Content-Type': 'application/json' }, timeout: 60000 }
    );
    const changes = response.data?.changes;
    logger.info(`[ZERAR] ${dispositivo.nome}: access_logs zerados (changes=${changes ?? 'n/a'})`);
    return { ok: true, changes };
  } catch (error) {
    logger.errorWithStack(`Erro ao zerar access_logs na catraca ${dispositivo.nome}`, error);
    return { ok: false, message: error.message };
  }
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
  gerarBackupLogsCatraca,
  zerarAccessLogsCatraca,
  testarConexaoCatraca,
  configurarMonitorNaCatraca,
  getMonitorCallbackAddress
};