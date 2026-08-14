const express = require('express');
const lessonController = require('../controllers/lessonController');
const autenticar = require('../middlewares/autorizacao').exige('SECRETARIA');

const router = express.Router();

// Rotas de aulas (catalogo)
router.get('/aulas', autenticar, lessonController.listar);
router.post('/aulas', autenticar, lessonController.criar);
router.put('/aulas/:id', autenticar, lessonController.editar);
router.delete('/aulas/:id', autenticar, lessonController.deletar);

// Rota especifica de horarios por turma (compatibilidade)
router.get('/aulas/horarios/:turma_id/:divisao', autenticar, lessonController.getHorariosPorTurma);

module.exports = router;
