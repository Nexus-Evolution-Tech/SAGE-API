const express = require('express');
const promocaoController = require('../controllers/promocaoController');
const autenticar = require('../middlewares/autorizacao').exige('ADMINISTRADOR');

const router = express.Router();

// POST /promocao/executar - Executa a promoção automática de alunos
// Query: ?simulacao=true (apenas simula) | ?unidade_id=1 (filtrar unidade)
router.post('/promocao/executar', autenticar, promocaoController.executar);

// POST /promocao/reverter - Reverte alunos finalizados por engano (CONCLUIDO → EM CURSO, turma_id → null)
// Query: ?confirmar=sim (obrigatório para aplicar)
router.post('/promocao/reverter', autenticar, promocaoController.reverter);

module.exports = router;
