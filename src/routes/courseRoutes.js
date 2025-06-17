const express = require('express');
const router = express.Router();
const courseController = require('../controllers/courseController');

router.get('/cursos', courseController.getCursos);
router.post('/cursos', courseController.postCurso);
router.patch('/cursos/:id', courseController.patchCurso);
router.delete('/cursos/:id', courseController.deleteCurso);

module.exports = router;
