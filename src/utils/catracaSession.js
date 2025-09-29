const axios = require('axios');

async function obterSessao(linkCatraca, dispositivo) {
  try {
    const response = await axios.post(`http://${linkCatraca}/login.fcgi`, {
      login: dispositivo.usuario,
      password: dispositivo.senha
    });

    console.log(`Sessão obtida para ${dispositivo.nome}:`, response.data.session);
    return response.data.session;
  } catch (error) {
    console.error(`Erro ao obter sessão para ${dispositivo.nome}:`, error.message);
    return null;
  }
}

module.exports = { obterSessao };
