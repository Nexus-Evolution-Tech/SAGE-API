const express = require('express');
const autenticarMiddleware = require('../middlewares/autenticar');
const controller = require('../controllers/usuarioController');

const router = express.Router();
router.use('/usuarios', autenticarMiddleware);
router.get('/usuarios', controller.listar);
router.post('/usuarios', controller.criar);
router.get('/usuarios/:id', controller.obter);
router.patch('/usuarios/:id', controller.editar);
router.post('/usuarios/:id/desativar', controller.desativar);
router.post('/usuarios/:id/redefinir-senha', controller.redefinirSenha);

module.exports = router;
