const express = require('express');
const relatorioController = require('../controllers/relatorioController');
const jornadaController = require('../controllers/jornadaController');
const folhaController = require('../controllers/folhaController');
const autenticar = require('../middlewares/autorizacao').exige('SECRETARIA');

const router = express.Router();

router.get('/relatorios/turmas', autenticar, relatorioController.turmas);
router.get('/relatorios/jornada', autenticar, jornadaController.relatorio);
router.get('/presenca/pendencias', autenticar, jornadaController.pendencias);
router.get('/relatorios/folha-presenca', autenticar, folhaController.folhaPresenca);
router.get('/relatorios/folha-ponto', autenticar, folhaController.folhaPonto);
router.get('/relatorios/acesso/resumo', autenticar, relatorioController.resumo);
router.get('/relatorios/acesso/detalhes', autenticar, relatorioController.detalhes);
router.get('/relatorios/pessoa/:id/historico', autenticar, relatorioController.historicoPessoa);
router.post('/relatorios/acesso/backfill-presenca', autenticar, relatorioController.backfillPresenca);

module.exports = router;
