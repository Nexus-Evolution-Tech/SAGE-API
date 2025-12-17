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

    logger.info(` Sessão criada: ${dispositivo.nome}`);
    
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
    const response = await axiosInstance.post(
      `http://${linkCatraca}/load_objects.fcgi?session=${session}`,
      {
        object: 'access_logs'
      }
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

module.exports = {
  listarTodos,
  linkCatraca,
  obterSessao,
  verificarSessao,
  obterLogsCatraca,
  testarConexaoCatraca
};