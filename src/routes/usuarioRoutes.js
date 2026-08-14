const express = require('express');
const autenticar = require('../middlewares/autorizacao').exige('ADMINISTRADOR');
const usuarioController = require('../controllers/usuarioController');

const router = express.Router();

router.post('/usuarios', autenticar, usuarioController.criar);
router.get('/usuarios', autenticar, usuarioController.listar);
router.get('/usuarios/:id', autenticar, usuarioController.obter);
router.patch('/usuarios/:id', autenticar, usuarioController.editar);
router.patch('/usuarios/:id/desativar', autenticar, usuarioController.desativar);
router.patch('/usuarios/:id/redefinir-senha', autenticar, usuarioController.redefinirSenha);

module.exports = router;
