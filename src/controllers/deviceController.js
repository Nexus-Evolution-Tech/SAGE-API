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
      statusDispositivos.push({ id: dispositivo.id, nome: dispositivo.nome, status: 'OFFLINE' });
      continue;
    }

    const sessaoValida = await deviceService.verificarSessao(session, link);
    if (sessaoValida) {
    statusDispositivos.push({ id: dispositivo.id, nome: dispositivo.nome, status: 'ONLINE' });
    } else {
    statusDispositivos.push({ id: dispositivo.id, nome: dispositivo.nome, status: 'Sessão inválida' });
    }
  }

  res.json(statusDispositivos);
};

const getStatusId = async (req, res) => {
  const { id } = req.params;
  const dispositivos = await buscarTodos(tabela, campos);

  if (!dispositivos) {
    return res.status(500).json({ message: 'Erro ao buscar dispositivos do banco de dados' });
  }

  const dispositivo = dispositivos.find(d => d.id == id);

  if (!dispositivo) {
    return res.status(404).json({ message: 'Dispositivo não encontrado' });
  }

  const link = deviceService.linkCatraca(dispositivo);
  const session = await deviceService.obterSessao(link, dispositivo);

  if (!session) {
    return res.json({ id: dispositivo.id, nome: dispositivo.nome, status: 'OFFLINE' });
  }

  const sessaoValida = await deviceService.verificarSessao(session, link);
  if (sessaoValida) {
    return res.json({ id: dispositivo.id, nome: dispositivo.nome, status: 'ONLINE' });
  } else {
    return res.json({ id: dispositivo.id, nome: dispositivo.nome, status: 'Sessão inválida' });
  }
};

const controllerGenerico = gerarController(tabela, campos, 'dispositivo');
module.exports = {
  ...controllerGenerico,
  getStatus,
  getStatusId
}