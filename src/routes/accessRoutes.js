console.log('[BOOT-ACCESS] require start');
const express = require('express');
console.log('[BOOT-ACCESS] express ok');
const gerarRotas = require('./genericRoutesFactory');
console.log('[BOOT-ACCESS] factory ok');
const accessController = require('../controllers/accessController');
console.log('[BOOT-ACCESS] controller ok');
const { sincronizarAcessos, sincronizarTodosAcessos } = require('../services/accessService');
console.log('[BOOT-ACCESS] service ok');
const autenticar = require('../middlewares/autenticar');
console.log('[BOOT-ACCESS] middleware ok');

const router = gerarRotas(accessController, 'acessos');
const routerExtra = express.Router();
console.log('[BOOT-ACCESS] routers criados');

routerExtra.post('/acessos', autenticar, accessController.criar);
router.post('/acessos/sincronizar/:dispositivo_id', autenticar, async (req, res) => {
  try {
    const dispositivo = await global.db('Dispositivo').where('id', req.params.dispositivo_id).first();

    if (!dispositivo) {
      return res.status(404).json({ message: 'Dispositivo não encontrado' });
    }

    const resultado = await sincronizarAcessos(dispositivo);
    res.json(resultado);
  } catch (error) {

    res.status(500).json({ message: 'Erro ao sincronizar acessos' });
  }
});
router.post('/acessos/sincronizar-todos', autenticar, async (req, res) => {
  try {
    const resultados = await sincronizarTodosAcessos();
    res.json({ message: 'Sincronização concluída', resultados });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao sincronizar todos os acessos' });
  }
});
routerExtra.use(router);

module.exports = routerExtra;
