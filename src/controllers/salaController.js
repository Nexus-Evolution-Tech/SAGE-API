const gerarController = require('./genericControllerFactory');

const tabela = 'Sala';
const campos = ['id', 'numero', 'nome', 'capacidade', 'tipo', 'ativo', 'observacao', 'created_at', 'updated_at'];

module.exports = gerarController(tabela, campos, 'sala');
