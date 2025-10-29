const gerarController = require('./genericControllerFactory');

const tabela = 'Curso';
const campos = ['id', 'nome', 'duracao'];

module.exports = gerarController(tabela, campos, 'curso');
