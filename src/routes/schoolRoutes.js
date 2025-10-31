const express = require('express');
const gerarRotas = require('./genericRoutesFactory');
const schoolController = require('../controllers/schoolController');

const router = gerarRotas(schoolController, 'escolas', { autenticarTodas: false });

const routerExtra = express.Router();

// 👉 Adiciona primeiro a rota específica - essa primeiro pra não entrar em conflito com /dispositivos/:id
routerExtra.post('/escolas/login/:id', schoolController.login);

// 👉 Depois monta o restante das rotas (inclui /:id, etc.)
routerExtra.use(router);

module.exports = routerExtra;
