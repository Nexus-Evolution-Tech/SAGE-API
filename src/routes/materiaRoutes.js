const express = require('express');
const materiaController = require('../controllers/materiaController');
const autenticar = require('../middlewares/autenticar');

const router = express.Router();

// GET /materias - Lista todas as matérias
router.get('/materias', autenticar, materiaController.listar);

// POST /materias - Cria nova matéria
router.post('/materias', autenticar, materiaController.criar);

// DELETE /materias/:id - Remove matéria
router.delete('/materias/:id', autenticar, materiaController.deletar);

module.exports = router;
