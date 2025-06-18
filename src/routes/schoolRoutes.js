const gerarRotas = require('./genericRoutesFactory');
const schoolController = require('../controllers/schoolController');

const router = gerarRotas(schoolController, 'escolas');
module.exports = router;
