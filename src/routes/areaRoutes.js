const express = require('express');
const gerarRotas = require('./genericRoutesFactory');
const areaController = require('../controllers/areaController');
const upload = require('../middlewares/uploadFoto');
const autenticar = require('../middlewares/autorizacao').exige('SECRETARIA');

const router = express.Router();
router.post('/areas/upload/:id', autenticar, upload.single('foto'), areaController.uploadFoto);
router.use(gerarRotas(areaController, 'areas'));
module.exports = router;
