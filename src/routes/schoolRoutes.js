const express = require('express');
const gerarRotas = require('./genericRoutesFactory');
const schoolController = require('../controllers/schoolController');
const recuperacaoSenhaController = require('../controllers/recuperacaoSenhaController');
const autenticar = require('../middlewares/autenticar');
const upload = require('../middlewares/uploadFoto');

const router = gerarRotas(schoolController, 'escolas', {
  autenticarTodas: false,
  autenticarReqs: {
    listar: false,
    criar: true,
    listarPorId: true,
    editar: true,
    deletar: true
  }
});

const routerExtra = express.Router();

routerExtra.get('/setup/status', schoolController.bootstrapStatus);
routerExtra.post('/setup/initialize', schoolController.bootstrapInitialize);

// Recuperação de senha (público)
routerExtra.post('/escolas/esqueci-senha', recuperacaoSenhaController.solicitarRecuperacao);
routerExtra.post('/escolas/redefinir-senha', recuperacaoSenhaController.redefinirSenha);

// Configuração do sistema (modo Monitor vs Polling) — para Ferramentas na interface
routerExtra.get('/config', autenticar, schoolController.getConfig);

// Rotas da unidade logada (configurações) — devem vir antes das genéricas
routerExtra.get('/unidade', autenticar, schoolController.obterUnidadeAtual);
routerExtra.patch('/unidade', autenticar, schoolController.atualizarUnidadeAtual);
routerExtra.patch('/unidade/trocar-senha', autenticar, schoolController.trocarSenha);
routerExtra.post('/unidade/upload-logo', upload.single('logo'), autenticar, schoolController.uploadLogo);

// Login (público)
routerExtra.post('/escolas/login/:id', schoolController.login);

// CRUD escolas (listar, criar, por id, editar, deletar)
routerExtra.use(router);

module.exports = routerExtra;
