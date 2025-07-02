const gerarRotas = require('./genericRoutesFactory');
const schoolPhotoController = require('../controllers/schoolPhotoController');

const router = gerarRotas(schoolPhotoController, 'foto_escolas');
module.exports = router;
