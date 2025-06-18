const gerarRotas = require('./genericRoutesFactory');
const courseController = require('../controllers/courseController');

const router = gerarRotas(courseController, 'cursos');
module.exports = router;
