const gerarController = require('./genericControllerFactory');

const tabela = 'Atraso';
const campos = ['id', 'pessoa_id', 'data', 'horario_previsto', 'horario_chegada'];

module.exports = gerarController(tabela, campos, 'atraso');
