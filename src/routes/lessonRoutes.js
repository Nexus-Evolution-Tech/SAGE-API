const gerarRotas = require('./genericRoutesFactory');
const lessonController = require('../controllers/lessonController');

const router = gerarRotas(lessonController, 'aulas');
module.exports = router;
