const express = require('express');
const router = express.Router();
const peopleController = require('../controllers/peopleController');

router.get('/pessoas', peopleController.getPessoas);
router.post('/pessoas', peopleController.postPessoa);
router.patch('/pessoas/:id', peopleController.patchPessoa);
router.delete('/pessoas/:id', peopleController.deletePessoa);

module.exports = router;
