function linkCatraca(dispositivo) {
  return `${dispositivo.endereco}:${dispositivo.porta}`;
}

async function listarTodos() {
  return await global.db('Dispositivo').select('*');
}

module.exports = {
  linkCatraca,
  listarTodos
};
