const express = require('express');
const gerarRotas = require('./genericRoutesFactory');
const accessController = require('../controllers/accessController');
const { sincronizarAcessos, sincronizarTodosAcessos } = require('../services/accessService');

const router = gerarRotas(accessController, 'acessos');
const routerExtra = express.Router();

routerExtra.post('/acessos', accessController.criar);
router.post('/acessos/sincronizar/:dispositivo_id', async (req, res) => {
  try {
    const dispositivo = await global.db('Dispositivo').where('id', req.params.dispositivo_id).first();

    if (!dispositivo) {
      return res.status(404).json({ message: 'Dispositivo não encontrado' });
    }

    const resultado = await sincronizarAcessos(dispositivo);
    res.json(resultado);
  } catch (error) {
    console.error('Erro ao sincronizar acessos:', error);
    res.status(500).json({ message: 'Erro ao sincronizar acessos' });
  }
});
router.post('/acessos/sincronizar-todos', async (req, res) => {
  try {
    const resultados = await sincronizarTodosAcessos();
    res.json({ message: 'Sincronização concluída', resultados });
  } catch (error) {
    console.error('Erro ao sincronizar todos os acessos:', error);
    res.status(500).json({ message: 'Erro ao sincronizar todos os acessos' });
  }
});
routerExtra.use(router);

module.exports = routerExtra;
