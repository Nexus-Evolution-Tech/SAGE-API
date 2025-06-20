const gerarController = require('./genericControllerFactory');

const tabela = 'Responsavel';
const campos = ['id', 'nome', 'rg', 'cpf', 'email', 'telefone'];

module.exports = gerarController(tabela, campos, 'responsavel');
