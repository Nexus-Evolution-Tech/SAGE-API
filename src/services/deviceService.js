const axios = require('axios');

async function listarTodos() {
  try {
    // global.db é o Knex, então podemos fazer:
    const dispositivos = await global.db('Dispositivo').select('*');
    return dispositivos; // retorna array de objetos
  } catch (error) {
    console.error('Erro ao listar dispositivos:', error.message);
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

async function obterLogsCatraca(session, linkCatraca) {
  try {
    const response = await axios.post(`http://${linkCatraca}/load_objects.fcgi?session=${session}`, {
      object: 'access_logs'
    });
    return response.data.objects || [];
  } catch (error) {
    console.error('Erro ao obter logs da catraca:', error.message);
    return [];
  }
}

module.exports = {
  listarTodos,
  linkCatraca,
  obterSessao,
  verificarSessao,
  obterLogsCatraca
};