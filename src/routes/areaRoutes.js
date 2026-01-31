const express = require('express');
const gerarRotas = require('./genericRoutesFactory');
const areaController = require('../controllers/areaController');
const upload = require('../middlewares/uploadFoto');
const autenticar = require('../middlewares/autenticar');

const router = express.Router();
router.post('/areas/upload/:id', upload.single('foto'), autenticar, areaController.uploadFoto);
router.use(gerarRotas(areaController, 'areas'));
module.exports = router;
