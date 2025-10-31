const gerarController = require('./genericControllerFactory');

const tabela = 'Atraso';
const campos = ['id', 'pessoa_id', 'data', 'dia_semana', 'status', 'aulas_perdidas', 'horario_previsto', 'horario_chegada', 'atrasado'];

module.exports = gerarController(tabela, campos, 'atraso');
