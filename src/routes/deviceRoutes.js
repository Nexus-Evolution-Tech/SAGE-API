const express = require('express');
const gerarRotas = require('./genericRoutesFactory');
const dispositivosController = require('../controllers/deviceController');
const autenticar = require('../middlewares/autenticar');

const router = gerarRotas(dispositivosController, 'dispositivos');

const routerExtra = express.Router();

// Adiciona primeiro as rotas específicas para evitar conflito com /dispositivos/:id
routerExtra.get('/dispositivos/status', autenticar, dispositivosController.getStatus);
routerExtra.get('/dispositivos/discover', autenticar, dispositivosController.discover);
routerExtra.post('/dispositivos/quick-add', autenticar, dispositivosController.quickAdd);
routerExtra.get('/dispositivos/:id/status', autenticar, dispositivosController.getStatusId);

// Depois monta o restante das rotas (inclui /:id, etc.)
routerExtra.use(router);

module.exports = routerExtra;