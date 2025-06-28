const gerarRotas = require('./genericRoutesFactory');
const subjectController = require('../controllers/subjectController');

const router = gerarRotas(subjectController, 'materias');
module.exports = router;
