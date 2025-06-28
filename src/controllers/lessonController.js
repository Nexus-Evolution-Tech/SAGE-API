const gerarController = require('./genericControllerFactory');

const tabela = 'Aula';
const campos = ['id', 'nome', 'professor_id', 'turma_id', 'materia_id', 'inicio', 'fim', 'dia_semana'];

module.exports = gerarController(tabela, campos, 'aula');
