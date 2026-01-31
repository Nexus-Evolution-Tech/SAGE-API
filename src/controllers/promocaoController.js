/**
 * Controller para execução da promoção automática de alunos.
 * Permite rodar manualmente (admin) ou via job agendado.
 */

const promocaoAlunosService = require('../services/promocaoAlunosService');
const logger = require('../config/logger');

/**
 * POST /promocao/executar
 * Executa a promoção de alunos (ano virou, mover 1º→2º, 2º→3º, ou finalizar).
 * Query params:
 *   - simulacao=true  → apenas simula, não aplica alterações
 *   - unidade_id=1    → filtrar por unidade (opcional)
 */
const executar = async (req, res) => {
  try {
    const apenasSimulacao = req.query.simulacao === 'true' || req.query.simulacao === '1';
    const unidadeId = req.query.unidade_id ? parseInt(req.query.unidade_id, 10) : null;

    const resultado = await promocaoAlunosService.executarPromocao({
      apenasSimulacao,
      unidadeId
    });

    res.json({
      message: apenasSimulacao
        ? 'Simulação concluída - nenhuma alteração foi aplicada'
        : 'Promoção executada com sucesso',
      resultado
    });
  } catch (error) {
    logger.error(`[PROMOÇÃO] Erro no controller: ${error.message}`);
    res.status(500).json({
      message: 'Erro ao executar promoção',
      error: error.message
    });
  }
};

module.exports = {
  executar
};
