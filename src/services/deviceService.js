const axios = require('axios');
const { verificarSyncPendentes } = require('./syncService');

async function listarTodos() {
  try {
    const dispositivos = await global.db('Dispositivo').select('*');
    return dispositivos;
  } catch (error) {
    console.error('❌ Erro ao listar dispositivos:', error.message);
    return [];
  }
}

// **NEW**: BUSCAR O NÚMERO TOTAL DE GIROS
function linkCatraca(dispositivo) {
  return `${dispositivo.endereco}:${dispositivo.porta}`;
}

async function obterSessao(linkCatraca, dispositivo) {
  try {
    const response = await axios.post(`http://${linkCatraca}/login.fcgi`, {
      login: dispositivo.usuario,
      password: dispositivo.senha
    });
    console.log(`Sessão obtida para ${dispositivo.nome}:`, response.data.session);
    await verificarSyncPendentes(dispositivo); // TODA VEZ QUE EU OBTER UMA SESSÃO NOVA DE CONEXÃO, VOU CHECAR SE TODOS OS REGISTROS PENDENTES JÁ ESTÃO SINCRONIZADOS, ALÉM DISSO É PRECISO FAZER ISSO PRA CADA DISPOSITIVO INDIVIDUALMENTE
    return response.data.session;
  } catch (error) {
    console.error(`Erro ao obter sessão para ${dispositivo?.nome}:`, error.message);
    return null;
  }
}

async function verificarSessao(session, linkCatraca) {
  try {
    const response = await axios.post(`http://${linkCatraca}/session_is_valid.fcgi?session=${session}`);
    return response.data.session_is_valid;
  } catch (error) {
    console.error('Erro ao verificar sessão:', error.message);
    return false;
  }
}

async function obterLogsCatraca(session, linkCatraca, timestampInicial = 0) {
  try {
    const response = await axios.post(
      `http://${linkCatraca}/load_objects.fcgi?session=${session}`,
      {
        object: 'access_logs'
      }
    );

    const logs = response.data.access_logs || [];

    // Filtra logs com timestamp maior que timestampInicial
    const logsFiltrados = logs.filter(log => log.time > timestampInicial);

    return logsFiltrados;
  } catch (error) {
    console.error('Erro ao obter logs da catraca:', error.message);
    return [];
  }
}

async function testarConexaoCatraca(dispositivo) {
  const link = linkCatraca(dispositivo);
  
  // Verificar se o dispositivo está acessível
  try {
    // Passo 1: Verificar se o dispositivo está na lista
    const dispositivos = await listarTodos();
    if (!dispositivos.some(d => d.endereco === dispositivo.endereco && d.porta === dispositivo.porta)) {
      console.log('Dispositivo não encontrado na base de dados.');
      return false;
    }
  
    // Passo 2: Tentar obter a sessão
    const session = await obterSessao(link, dispositivo);
    if (!session) {
      console.log('Falha ao obter sessão.');
      return false;
    }
  
    // Passo 3: Verificar se a sessão é válida
    const sessaoValida = await verificarSessao(session, link);
    if (!sessaoValida) {
      console.log('Sessão inválida.');
      return false;
    }
  
    console.log('Conexão com a catraca bem-sucedida!');
    return true;
  } catch (error) {
    console.error('Erro ao testar conexão com catraca:', error.message);
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