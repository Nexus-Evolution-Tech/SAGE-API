const gerarController = require('./genericControllerFactory');

const tabela = 'Sala';
const campos = ['id', 'unidade_id', 'numero', 'nome', 'capacidade', 'tipo', 'ativo', 'observacao'];

module.exports = gerarController(tabela, campos, 'sala');