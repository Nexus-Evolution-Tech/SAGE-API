const gerarController = require('./genericControllerFactory');

const tabela = 'UnidadeEscolar';
const campos = ['id', 'nome', 'numero_unidade', 'cnpj', 'login', 'senha', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'estado', 'cep', 'telefone_contato', 'logo'];

module.exports = gerarController(tabela, campos, 'escola');
