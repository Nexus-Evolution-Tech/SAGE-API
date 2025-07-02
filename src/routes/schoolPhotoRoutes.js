const gerarRotas = require('./genericRoutesFactory');
const schoolPhotoController = require('../controllers/schoolPhotoController');
const express = require('express');

const router = gerarRotas(schoolPhotoController, 'foto_escolas');

const routerExtra = express.Router();
routerExtra.get('/foto_escolas/url/:id', schoolPhotoController.getUrlById);

routerExtra.use(router);

module.exports = routerExtra;
