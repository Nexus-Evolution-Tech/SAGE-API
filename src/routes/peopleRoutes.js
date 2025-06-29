const express = require('express');
const gerarRotas = require('./genericRoutesFactory');
const peopleController = require('../controllers/peopleController');

const router = gerarRotas(peopleController, 'pessoas');

const routerExtra = express.Router();

routerExtra.get('/pessoas/status', peopleController.getStatus);
routerExtra.get('/pessoas/:id/status', peopleController.getStatusId);

routerExtra.use(router);

module.exports = routerExtra;

