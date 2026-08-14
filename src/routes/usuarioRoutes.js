const express = require('express');
const autenticar = require('../middlewares/autenticar');
const usuarioController = require('../controllers/usuarioController');

const router = express.Router();

router.post('/usuarios', autenticar, usuarioController.criar);
router.get('/usuarios', autenticar, usuarioController.listar);
router.get('/usuarios/:id', autenticar, usuarioController.obter);

module.exports = router;
