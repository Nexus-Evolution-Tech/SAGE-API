const gerarRotas = require('./genericRoutesFactory');
const salaController = require('../controllers/salaController');

const router = gerarRotas(salaController, 'salas');
module.exports = router;
