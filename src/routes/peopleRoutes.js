const gerarRotas = require('./genericRoutesFactory');
const peopleController = require('../controllers/peopleController');

const router = gerarRotas(peopleController, 'pessoas');
module.exports = router;

