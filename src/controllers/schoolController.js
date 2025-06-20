const gerarController = require('./genericControllerFactory');

const tabela = 'UnidadeEscolar';
const campos = ['id', 'login', 'senha', 'cnpj', 'nome', 'numero', 'endereco', 'logo'];

module.exports = gerarController(tabela, campos, 'escola');
