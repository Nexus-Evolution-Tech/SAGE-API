const express = require('express');
const gerarRotas = require('./genericRoutesFactory');
const peopleController = require('../controllers/peopleController');
const upload = require('../middlewares/uploadFoto');

const router = gerarRotas(peopleController, 'pessoas');

const routerExtra = express.Router();

routerExtra.get('/pessoas/url', peopleController.getUrls); // Sem barra no final
routerExtra.get('/pessoas/url/:id', peopleController.getUrlById);
routerExtra.get('/pessoas/status', peopleController.getStatus);
routerExtra.get('/pessoas/:id/status', peopleController.getStatusId);
routerExtra.post('/pessoas/upload/:id', upload.single('foto'), peopleController.uploadFoto);
routerExtra.get('/pessoas/tipo/:tipo', peopleController.listarPorTipo);
routerExtra.post('/pessoas/gerar_qrcode/:id', peopleController.gerarQrCode);
routerExtra.post('/pessoas/sincronizar-banco', peopleController.sincronizarBanco);

routerExtra.use(router);

module.exports = routerExtra;

