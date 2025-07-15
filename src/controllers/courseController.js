const gerarController = require('./genericControllerFactory');

const tabela = 'Curso';
const campos = ['id', 'nome'];

module.exports = gerarController(tabela, campos, 'curso');
