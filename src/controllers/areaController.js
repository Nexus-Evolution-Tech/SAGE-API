const gerarController = require('./genericControllerFactory');

const tabela = 'Area';
const campos = ['id', 'nome', 'unidade_id'];

module.exports = gerarController(tabela, campos, 'área');
