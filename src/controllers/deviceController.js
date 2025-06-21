const deviceService = require('../services/deviceService');
const gerarController = require('./genericControllerFactory');
const { buscarTodos } = require('../utils/generic-db-utils');

const tabela = 'Dispositivo';
const campos = ['id', 'nome', 'modelo', 'endereco', 'porta', 'usuario', 'senha', 'area_id', 'numero_serial'];

const getStatus = async (req, res) => {
    const statusDispositivos = [];
    const dispositivos = await buscarTodos(tabela, campos);

    if (!dispositivos) {
      return res.status(500).json({ message: 'Erro ao buscar dispositivos do banco de dados' });
    }

    for (const dispositivo of dispositivos) {
      const link = deviceService.linkCatraca(dispositivo);
      const session = await deviceService.obterSessao(link, dispositivo);

      if (!session) {
        statusDispositivos.push({ id: dispositivo.id, nome: dispositivo.nome, status: 'Erro ao obter sessão' });
        continue;
      }

      const sessaoValida = await deviceService.verificarSessao(session, link);
      if (sessaoValida) {
        statusDispositivos.push({ id: dispositivo.id, nome: dispositivo.nome, status: 'Conectado com sucesso' });
      } else {
        statusDispositivos.push({ id: dispositivo.id, nome: dispositivo.nome, status: 'Sessão inválida' });
      }
    }

    res.json(statusDispositivos);
};

const controllerGenerico = gerarController(tabela, campos, 'dispositivo');
module.exports = {
  ...controllerGenerico,
  getStatus
}