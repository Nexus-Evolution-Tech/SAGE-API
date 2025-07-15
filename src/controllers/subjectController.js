const gerarController = require('./genericControllerFactory');

const tabela = 'Materia';
const campos = ['id', 'nome', 'sigla', 'professor_id', 'curso_id'];

module.exports = gerarController(tabela, campos, 'materia');
