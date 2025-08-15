const gerarRotas = require('./genericRoutesFactory');
const delayController = require('../controllers/delayController');

const router = gerarRotas(delayController, 'atrasos', { criar: false, editar: false });
module.exports = router;
