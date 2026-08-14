const express = require('express');
const horarioController = require('../controllers/horarioController');
const autenticar = require('../middlewares/autorizacao').exige('SECRETARIA');

const router = express.Router();

router.use('/horarios', autenticar, horarioController.descontinuado);

module.exports = router;
