const express = require('express');
const gerarRotas = require('./genericRoutesFactory');
const accessSolicitationController = require('../controllers/accessSolicitationController');
const autenticar = require('../middlewares/autenticar');

const router = gerarRotas(accessSolicitationController, 'solicitacoes-acessos', { criar: false, editar: false });

const routerExtra = express.Router();
routerExtra.patch('/solicitacoes-acessos/aprovar/:id', autenticar, accessSolicitationController.aprovarSolicitacao);
routerExtra.patch('/solicitacoes-acessos/negar/:id', autenticar, accessSolicitationController.negarSolicitacao);

routerExtra.use(router);

module.exports = routerExtra;