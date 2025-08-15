const gerarController = require('./genericControllerFactory');

const tabela = 'Horario';
const campos = ['id', 'pessoa_id', 'dia_semana', 'entrada', 'saida', 'created_at', 'updated_at'];

module.exports = gerarController(tabela, campos, 'horário');
