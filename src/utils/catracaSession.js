const axios = require('axios');

async function obterSessao(linkCatraca, dispositivo) {
  try {
    const response = await axios.post(`http://${linkCatraca}/login.fcgi`, {
      login: dispositivo.usuario,
      password: dispositivo.senha
    });

    return response.data.session;
  } catch (error) {
    return null;
  }
}

module.exports = { obterSessao };
