const express = require('express');
const gerarRotas = require('./genericRoutesFactory');
const dispositivosController = require('../controllers/deviceController');
const autenticar = require('../middlewares/autenticar');

const router = gerarRotas(dispositivosController, 'dispositivos');

const routerExtra = express.Router();

// Adiciona primeiro as rotas específicas para evitar conflito com /dispositivos/:id
routerExtra.get('/dispositivos/status', autenticar, dispositivosController.getStatus);
routerExtra.get('/dispositivos/discover', autenticar, dispositivosController.discover);
routerExtra.post('/dispositivos/quick-add', autenticar, dispositivosController.quickAdd);
routerExtra.get('/dispositivos/catraca/objetos-tipos', autenticar, dispositivosController.listarTiposObjetosCatraca);
routerExtra.get('/dispositivos/:id/status', autenticar, dispositivosController.getStatusId);
routerExtra.get('/dispositivos/:id/diagnostico-acessos', autenticar, dispositivosController.diagnosticoAcessos);
routerExtra.get('/dispositivos/:id/logs-info', autenticar, dispositivosController.logsInfo);
routerExtra.get('/dispositivos/:id/catraca/objetos/:objectType', autenticar, dispositivosController.listarObjetosCatraca);
routerExtra.delete('/dispositivos/:id/catraca/objetos/:objectType/:objectId', autenticar, dispositivosController.deletarObjetoCatraca);
routerExtra.post('/dispositivos/:id/catraca/backup/:objectType', autenticar, dispositivosController.backupPorTipo);
routerExtra.post('/dispositivos/:id/catraca/zerar/:objectType', autenticar, dispositivosController.zerarPorTipo);
routerExtra.post('/dispositivos/:id/import-from-catraca', autenticar, dispositivosController.importFromCatraca);
routerExtra.post('/dispositivos/:id/zerar-tudo', autenticar, dispositivosController.zerarTudo);
routerExtra.post('/dispositivos/:id/comecar-do-zero', autenticar, dispositivosController.comecarDoZero);
routerExtra.post('/dispositivos/:id/backup-logs', autenticar, dispositivosController.backupLogs);
routerExtra.post('/dispositivos/:id/backup-completo', autenticar, dispositivosController.backupCompleto);
routerExtra.post('/dispositivos/:id/zerar-logs', autenticar, dispositivosController.zerarLogs);
routerExtra.post('/dispositivos/:id/configurar-monitor', autenticar, dispositivosController.configurarMonitor);
// D-4: conflito era apenas posicional — as duas rotas são complementares, ambas mantidas.
routerExtra.delete('/dispositivos', autenticar, dispositivosController.limparUsuarios)
routerExtra.post('/dispositivos/:id/toggle-sync', autenticar, dispositivosController.toggleSync);

// Depois monta o restante das rotas (inclui /:id, etc.)
routerExtra.use(router);

module.exports = routerExtra;