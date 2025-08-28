const express = require('express');
const gerarRotas = require('./genericRoutesFactory');
const lessonController = require('../controllers/lessonController');
const autenticar = require('../middlewares/autenticar');

const router = gerarRotas(lessonController, 'aulas');

const routerExtra = express.Router();

// 👉 Adiciona primeiro a rota específica - essa primeiro pra não entrar em conflito com /dispositivos/:id
routerExtra.get('/aulas/horarios/:turma_id/:divisao', autenticar, lessonController.getHorariosPorTurma);

// 👉 Depois monta o restante das rotas (inclui /:id, etc.)
routerExtra.use(router);

module.exports = routerExtra;
