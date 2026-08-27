const express = require('express');
const { exige } = require('../middlewares/autorizacao');
const controller = require('../controllers/assistentePrimeiraExecucaoController');

const router = express.Router();
const exigirAdministrador = exige('ADMINISTRADOR');

router.get('/onboarding', exigirAdministrador, controller.obterEstado);
router.post('/onboarding/steps/:step/resume', exigirAdministrador, controller.retomarPasso);

module.exports = router;
