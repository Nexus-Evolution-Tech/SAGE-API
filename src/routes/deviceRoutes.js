const express = require('express');
const gerarRotas = require('./genericRoutesFactory');
const dispositivosController = require('../controllers/deviceController');

const router = gerarRotas(dispositivosController, 'dispositivos');

const routerExtra = express.Router();
// 👉 Adiciona primeiro a rota específica - essa primeiro pra não entrar em conflito com /dispositivos/:id
routerExtra.get('/dispositivos/status', dispositivosController.getStatus);

// 👉 Depois monta o restante das rotas (inclui /:id, etc.)
routerExtra.use(router);

module.exports = routerExtra;