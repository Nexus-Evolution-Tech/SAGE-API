const express = require('express');
const funcionarioHorarioController = require('../controllers/funcionarioHorarioController');
const autenticar = require('../middlewares/autenticar');

const router = express.Router();

router.get('/pessoas/:id/horario-fixo', autenticar, funcionarioHorarioController.listar);
router.put('/pessoas/:id/horario-fixo', autenticar, funcionarioHorarioController.salvar);

module.exports = router;
