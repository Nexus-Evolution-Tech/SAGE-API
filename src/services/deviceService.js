const axiosInstance = require('../config/axios');
const logger = require('../config/logger');

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

async function obterLogsCatraca(session, linkCatraca, timestampInicial = 0) {
  try {
    // load_objects sem filtro na API = catraca envia TODOS os access_logs (milhares). Timeout maior evita falha.
    const loadLogsTimeoutMs = parseInt(process.env.CATRACA_LOAD_LOGS_TIMEOUT || '60000', 10);
    const response = await axiosInstance.post(
      `http://${linkCatraca}/load_objects.fcgi?session=${session}`,
      { object: 'access_logs' },
      { timeout: loadLogsTimeoutMs }
    );

    const logs = response.data.access_logs || [];

    // Filtra logs com timestamp maior que timestampInicial
    const logsFiltrados = logs.filter(log => log.time > timestampInicial);

    logger.debug(`${logsFiltrados.length} logs obtidos da catraca`);
    return logsFiltrados;
  } catch (error) {
    logger.errorWithStack('Erro ao obter logs da catraca', error);
    return [];
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

  const monitorConfig = {
    request_timeout: '5000',
    hostname,
    port,
    path: 'api/notifications/dao'
  };

  try {
    await axiosInstance.post(
      `http://${link}/set_configuration.fcgi?session=${session}`,
      { monitor: monitorConfig },
      { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
    );
    logger.info(`[MONITOR] Monitor configurado em ${dispositivo.nome} -> ${hostname}:${port}/api/notifications/dao`);
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
  testarConexaoCatraca,
  configurarMonitorNaCatraca,
  getMonitorCallbackAddress
};