const gerarController = require('./genericControllerFactory');

const tabela = 'UnidadeFoto';
const campos = ['id', 'unidade_id', 'tipo', 'caminho', 'descricao'];

module.exports = gerarController(tabela, campos, 'foto da escola');
