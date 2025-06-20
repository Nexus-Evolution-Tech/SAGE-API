const gerarController = require('./genericControllerFactory');

const tabela = 'Empresa';
const campos = ['id', 'nome', 'cnpj'];

module.exports = gerarController(tabela, campos, 'empresa');
