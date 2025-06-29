const express = require('express');
const gerarRotas = require('./genericRoutesFactory');
const accessController = require('../controllers/accessController');

const router = gerarRotas(accessController, 'acessos');
const routerExtra = express.Router();

routerExtra.post('/acessos', accessController.criar);
routerExtra.use(router);

module.exports = routerExtra;
