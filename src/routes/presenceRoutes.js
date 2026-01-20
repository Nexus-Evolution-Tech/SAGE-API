const gerarRotas = require('./genericRoutesFactory');
const presenceController = require('../controllers/presenceController');

const router = gerarRotas(presenceController, 'presencas', { criar: false, editar: false });
module.exports = router;
