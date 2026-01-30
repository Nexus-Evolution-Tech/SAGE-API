const express = require('express');
const relatorioController = require('../controllers/relatorioController');
const autenticar = require('../middlewares/autenticar');

const router = express.Router();

router.get('/relatorios/turmas', autenticar, relatorioController.turmas);
router.get('/relatorios/acesso/resumo', autenticar, relatorioController.resumo);
router.get('/relatorios/acesso/detalhes', autenticar, relatorioController.detalhes);

module.exports = router;
