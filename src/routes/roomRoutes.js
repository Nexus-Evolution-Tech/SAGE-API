const gerarRotas = require('./genericRoutesFactory');
const roomController = require('../controllers/roomController');

const router = gerarRotas(roomController, 'sala');
module.exports = router;
