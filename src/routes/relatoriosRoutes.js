/**
 * Rotas para Relatórios de Acesso & Presença
 * DEBUG: Sem autenticação temporariamente
 */

const express = require('express');
const router = express.Router();
const relatorioAcessoController = require('../controllers/relatorioAcessoController');

// Aliases para evitar 404 em clientes que usam /resumo ou /detalhes
router.get('/api/relatorios/acesso/resumo', relatorioAcessoController.getDados);
router.get('/api/relatorios/acesso/detalhes', relatorioAcessoController.getDados);

// GET /api/relatorios/acesso - Novo endpoint com suporte a períodos
router.get('/api/relatorios/acesso', relatorioAcessoController.getDados);

// GET /api/relatorios/turmas - Lista todas as turmas
router.get('/api/relatorios/turmas', relatorioAcessoController.getTurmas);

module.exports = router;
