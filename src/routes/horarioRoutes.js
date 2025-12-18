const express = require('express');
const horarioController = require('../controllers/horarioController');
const autenticar = require('../middlewares/autenticar');

const router = express.Router();

router.get('/horarios', autenticar, horarioController.listar);
router.post('/horarios', autenticar, horarioController.criar);
router.put('/horarios/:id', autenticar, horarioController.editar);
router.delete('/horarios/:id', autenticar, horarioController.deletar);
router.post('/horarios/validar', autenticar, horarioController.validar);

module.exports = router;
