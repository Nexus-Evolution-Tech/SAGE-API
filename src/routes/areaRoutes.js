const gerarRotas = require('./genericRoutesFactory');
const areaController = require('../controllers/areaController');

const router = gerarRotas(areaController, 'areas');
module.exports = router;
