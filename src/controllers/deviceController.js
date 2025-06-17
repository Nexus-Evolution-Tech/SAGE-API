// controllers/statusController.js
const deviceService = require('../services/deviceService');
const { buscarTodosDispositivos, criarNovoDispositivo, atualizarDispositivo, removerDispositivo } = require('../config/device-db-utils');

const getDispositivos = async (req, res) => {
  const dadosDispositivos = [];
  const dispositivos = await buscarTodosDispositivos();

  if (!dispositivos) {
    return res.status(500).json({ message: 'Erro ao buscar dispositivos do banco de dados' });
  }

  for (const dispositivo of dispositivos) {
    dadosDispositivos.push({ id: dispositivo.id, nome: dispositivo.nome, modelo: dispositivo.modelo, endereco: dispositivo.endereco, porta: dispositivo.porta, usuario: dispositivo.usuario, senha: dispositivo.senha });
  }

  res.json(dadosDispositivos);
};

const getStatus = async (req, res) => {
    const statusDispositivos = [];
    const dispositivos = await buscarTodosDispositivos();

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

const postDispositivos = async (req, res) => {
  try {
    const dados = req.body;
    criarNovoDispositivo(dados.nome, dados.modelo, dados.endereco, dados.porta, dados.usuario, dados.senha);

    return res.status(201).json({ message: "Dispositivo adicionado com sucesso" });
  } catch (err){
    return res.status(500).json({ message: 'Erro ao adicionar dispositivo no banco de dados' });
  }
}

const patchDispositivos = (req, res) => {
  try {
    const id = req.params.id;
    const dados = req.body;
    atualizarDispositivo(id, dados);

    return res.status(200).json({ message: "Dispositivo atualizado com sucesso" });
  } catch (err) {
    return res.status(500).json({ message: 'Erro ao atualizar dispositivo no banco de dados' });
  }
}

const deleteDispositivos = (req, res) => {
  try {
    const id = req.params.id;
    removerDispositivo(id);

    return res.status(201).json({ message: "Dispositivo removido com sucesso" });
  } catch (err){
    return res.status(500).json({ message: 'Erro ao adicionar dispositivo no banco de dados' });
  }
}

module.exports = {
  getDispositivos,
  getStatus,
  postDispositivos,
  patchDispositivos,
  deleteDispositivos
}