const express = require('express');
const router = express.Router();
const dispositivosController = require('../controllers/deviceController');

router.get('/dispositivos', dispositivosController.getDispositivos);
router.get('/dispositivos/status', dispositivosController.getStatus);

router.post('/dispositivos', dispositivosController.postDispositivos);
router.patch('/dispositivos/:id', dispositivosController.patchDispositivos); // mudar apenas as especificações informadas sem alterar o resto
router.delete('/dispositivos/:id', dispositivosController.deleteDispositivos);

module.exports = router;