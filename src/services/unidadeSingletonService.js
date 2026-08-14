const db = require('../config/database');

const ERRO_UNIDADE_SINGLETON = 'UNIDADE_ESCOLAR_SINGLETON_INVALIDA';

class ErroUnidadeSingleton extends Error {
  constructor() {
    super('A instalação deve conter exatamente uma unidade escolar.');
    this.name = 'ErroUnidadeSingleton';
    this.code = ERRO_UNIDADE_SINGLETON;
  }
}

async function buscarUnidadeSingleton(campos = ['id']) {
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
