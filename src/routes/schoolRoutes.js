const express = require('express');
const router = express.Router();
const schoolController = require('../controllers/schoolController');

router.get('/escolas', schoolController.getEscolas);
router.post('/escolas', schoolController.postEscola);
router.patch('/escolas/:id', schoolController.patchEscola);
router.delete('/escolas/:id', schoolController.deleteEscola);

module.exports = router;
