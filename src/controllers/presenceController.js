const gerarController = require('./genericControllerFactory');

const tabela = 'Presenca';
const campos = ['id', 'pessoa_id', 'data', 'dia_semana', 'status', 'aulas_perdidas', 'horario_previsto', 'horario_chegada'];

module.exports = gerarController(tabela, campos, 'presenca');
