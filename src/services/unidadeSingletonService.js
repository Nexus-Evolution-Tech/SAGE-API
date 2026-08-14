const db = require('../config/database');

const ERRO_UNIDADE_SINGLETON = 'UNIDADE_ESCOLAR_SINGLETON_INVALIDA';
const CAMPOS_UNIDADE_SINGLETON = new Set([
  'id', 'nome', 'numero_unidade', 'cnpj', 'login', 'logradouro', 'numero',
  'complemento', 'bairro', 'cidade', 'estado', 'cep', 'telefone_contato', 'email', 'logo'
]);

function validarCampos(campos) {
  if (!Array.isArray(campos) || campos.length === 0 ||
      campos.some((campo) => !CAMPOS_UNIDADE_SINGLETON.has(campo))) {
    const erro = new Error('Campos da unidade não permitidos.');
    erro.code = 'UNIDADE_SINGLETON_CAMPOS_INVALIDOS';
    throw erro;
  }
}

class ErroUnidadeSingleton extends Error {
  constructor() {
    super('A instalação deve conter exatamente uma unidade escolar.');
    this.name = 'ErroUnidadeSingleton';
    this.code = ERRO_UNIDADE_SINGLETON;
  }
}

async function buscarUnidadeSingleton(campos = ['id']) {
  validarCampos(campos);
  const [unidades] = await db.query(
    `SELECT ${campos.join(', ')} FROM UnidadeEscolar ORDER BY id`
  );

  if (unidades.length !== 1) throw new ErroUnidadeSingleton();
  return unidades[0];
}

module.exports = {
  ERRO_UNIDADE_SINGLETON,
  buscarUnidadeSingleton
};
