const gerarController = require('./genericControllerFactory');

const tabela = 'Empresa';
const campos = ['id', 'nome', 'cnpj', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'estado', 'cep', 'telefone_contato'];

module.exports = gerarController(tabela, campos, 'empresa');
