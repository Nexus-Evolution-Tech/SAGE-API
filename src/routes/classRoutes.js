const express = require('express');
const router = express.Router();
const classController = require('../controllers/classController');

router.get('/turmas', classController.getTurmas);
router.post('/turmas', classController.postTurma);
router.patch('/turmas/:id', classController.patchTurma);
router.delete('/turmas/:id', classController.deleteTurma);

module.exports = router;
