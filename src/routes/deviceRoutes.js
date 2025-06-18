const gerarRotas = require('./genericRoutesFactory');
const dispositivosController = require('../controllers/deviceController');

const router = gerarRotas(dispositivosController, 'dispositivos');
router.get('/dispositivos/status', dispositivosController.getStatus);

module.exports = router;