const express = require('express');
const horarioController = require('../controllers/horarioController');
const autenticar = require('../middlewares/autenticar');

const router = express.Router();

router.use('/horarios', autenticar, horarioController.descontinuado);

module.exports = router;
