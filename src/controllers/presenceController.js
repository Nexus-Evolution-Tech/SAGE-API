const gerarController = require('./genericControllerFactory');

const tabela = 'Presenca';
const campos = ['id', 'pessoa_id', 'data', 'dia_semana', 'aulas_perdidas', 'horario_previsto', 'horario_chegada', 'atrasado'];

module.exports = gerarController(tabela, campos, 'presenca');
