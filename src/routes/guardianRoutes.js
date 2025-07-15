const gerarRotas = require('./genericRoutesFactory');
const guardianController = require('../controllers/guardianController');

const router = gerarRotas(guardianController, 'responsaveis');
module.exports = router;
