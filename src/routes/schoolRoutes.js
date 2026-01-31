const express = require('express');
const gerarRotas = require('./genericRoutesFactory');
const schoolController = require('../controllers/schoolController');
const recuperacaoSenhaController = require('../controllers/recuperacaoSenhaController');
const autenticar = require('../middlewares/autenticar');

const router = gerarRotas(schoolController, 'escolas', { autenticarTodas: false });

const routerExtra = express.Router();

// Recuperação de senha (público)
routerExtra.post('/escolas/esqueci-senha', recuperacaoSenhaController.solicitarRecuperacao);
routerExtra.post('/escolas/redefinir-senha', recuperacaoSenhaController.redefinirSenha);

// Rotas da unidade logada (configurações) — devem vir antes das genéricas
routerExtra.get('/unidade', autenticar, schoolController.obterUnidadeAtual);
routerExtra.patch('/unidade', autenticar, schoolController.atualizarUnidadeAtual);
routerExtra.patch('/unidade/trocar-senha', autenticar, schoolController.trocarSenha);

// Login (público)
routerExtra.post('/escolas/login/:id', schoolController.login);

// CRUD escolas (listar, criar, por id, editar, deletar)
routerExtra.use(router);

module.exports = routerExtra;
