const gerarRotas = require('./genericRoutesFactory');
const classController = require('../controllers/classController');

const router = gerarRotas(classController, 'turmas');
module.exports = router;
