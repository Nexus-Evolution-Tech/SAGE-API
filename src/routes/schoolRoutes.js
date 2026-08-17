const express = require('express');
const gerarRotas = require('./genericRoutesFactory');
const schoolController = require('../controllers/schoolController');
const autenticar = require('../middlewares/autorizacao').exige('ADMINISTRADOR');
const upload = require('../middlewares/uploadFoto');
const { preAutenticacao } = require('../middlewares/autorizacao');

const router = gerarRotas(schoolController, 'escolas', {
  listar: false,
  autenticarTodas: false,
  autorizacao: 'ADMINISTRADOR',
  autenticarReqs: {
    listar: false,
    criar: true,
    listarPorId: true,
    editar: true,
    deletar: true
  }
});

const routerExtra = express.Router();

routerExtra.get('/setup/status', preAutenticacao('bootstrap e estado de instalação'), schoolController.bootstrapStatus);
routerExtra.post('/setup/initialize', preAutenticacao('criação inicial do administrador'), schoolController.bootstrapInitialize);

// Recuperação de senha (público)
routerExtra.post('/escolas/recuperar-acesso', preAutenticacao('recuperação local da conta'), schoolController.recuperarAcesso);

// Configuração do sistema (modo Monitor vs Polling) — para Ferramentas na interface
routerExtra.get('/config', autenticar, schoolController.getConfig);

// Rotas da unidade logada (configurações) — devem vir antes das genéricas
routerExtra.get('/unidade', autenticar, schoolController.obterUnidadeAtual);
routerExtra.patch('/unidade', autenticar, schoolController.atualizarUnidadeAtual);
routerExtra.patch('/unidade/trocar-senha', autenticar, schoolController.trocarSenha);
routerExtra.post('/unidade/upload-logo', autenticar, upload.single('logo'), schoolController.uploadLogo);

// Login (público)
routerExtra.post('/escolas/login/:id', preAutenticacao('obtenção de sessão'), schoolController.login);

// CRUD escolas (listar, criar, por id, editar, deletar)
routerExtra.use(router);
routerExtra.get('/escolas', autenticar, schoolController.listar);

module.exports = routerExtra;
