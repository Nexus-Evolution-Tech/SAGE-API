const gerarRotas = require('./genericRoutesFactory');
const schoolPhotoController = require('../controllers/schoolPhotoController');
const express = require('express');
const upload = require('../middlewares/uploadFoto');

const router = gerarRotas(schoolPhotoController, 'foto_escolas');

const routerExtra = express.Router();
routerExtra.get('/foto_escolas/url/:id', schoolPhotoController.getUrlById);
routerExtra.post('/foto_escolas', upload.single('foto'), schoolPhotoController.uploadFoto);

routerExtra.use(router);

module.exports = routerExtra;
