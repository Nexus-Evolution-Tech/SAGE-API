const gerarRotas = require('./genericRoutesFactory');
const timeController = require('../controllers/timeController');

const router = gerarRotas(timeController, 'horarios');
module.exports = router;
