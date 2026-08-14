const express = require('express');
const gerarRotas = require('./genericRoutesFactory');
const peopleController = require('../controllers/peopleController');
const upload = require('../middlewares/uploadFoto');
const autenticar = require('../middlewares/autorizacao').exige('SECRETARIA');

const router = gerarRotas(peopleController, 'pessoas');

const routerExtra = express.Router();

routerExtra.get('/pessoas/url', autenticar, peopleController.getUrls); // Sem barra no final
routerExtra.get('/pessoas/url/:id', autenticar, peopleController.getUrlById);
routerExtra.post('/pessoas/upload/:id', upload.single('foto'), autenticar, peopleController.uploadFoto);
routerExtra.get('/pessoas/tipo/:tipo', autenticar, peopleController.listarPorTipo);
routerExtra.post('/pessoas/gerar_qrcode/:id', autenticar, peopleController.gerarQrCode);
routerExtra.post('/pessoas/sincronizar-banco', autenticar, peopleController.sincronizarBanco);

routerExtra.use(router);

module.exports = routerExtra;

