const express = require('express');
const relatorioController = require('../controllers/relatorioController');
const autenticar = require('../middlewares/autenticar');

const router = express.Router();

router.get('/relatorios/turmas', autenticar, relatorioController.turmas);
router.get('/relatorios/acesso/resumo', autenticar, relatorioController.resumo);
router.get('/relatorios/acesso/detalhes', autenticar, relatorioController.detalhes);
router.get('/relatorios/pessoa/:id/historico', autenticar, relatorioController.historicoPessoa);
router.post('/relatorios/acesso/backfill-presenca', autenticar, relatorioController.backfillPresenca);

module.exports = router;
