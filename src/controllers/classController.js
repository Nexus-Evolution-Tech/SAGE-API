const gerarController = require('./genericControllerFactory');

const tabela = 'Turma';
const campos = ['id', 'nome', 'turno', 'curso_id', 'unidade_id'];

module.exports = gerarController(tabela, campos, 'turma');
