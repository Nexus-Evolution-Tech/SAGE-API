const gerarRotas = require('./genericRoutesFactory');
const companyController = require('../controllers/companyController');

const router = gerarRotas(companyController, 'empresas');
module.exports = router;
