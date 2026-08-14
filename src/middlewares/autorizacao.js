const autenticar = require('./autenticar');

const METADADO_AUTORIZACAO = 'autorizacao';
const MARCA_DECLARACAO = Symbol('declaracao-autorizacao-sage');
const PROPRIETARIO_DECLARACAO = Symbol('proprietario-declaracao-autorizacao-sage');
const PAPEIS = new Set(['ADMINISTRADOR', 'SECRETARIA']);
const PAPEIS_PERMITIDOS = Object.freeze({
  ADMINISTRADOR: Object.freeze(new Set(['ADMINISTRADOR'])),
  SECRETARIA: Object.freeze(new Set(['ADMINISTRADOR', 'SECRETARIA']))
});

function anexarDeclaracao(middleware, declaracao) {
  const metadado = { ...declaracao };
  Object.defineProperty(metadado, MARCA_DECLARACAO, { value: true });
  Object.defineProperty(metadado, PROPRIETARIO_DECLARACAO, { value: middleware });
  Object.freeze(metadado);
  Object.defineProperty(middleware, METADADO_AUTORIZACAO, {
    value: metadado,
    enumerable: true,
    writable: false,
    configurable: false
  });
  return middleware;
}

function obterDeclaracaoAutorizacao(handler) {
  const declaracao = handler?.[METADADO_AUTORIZACAO];
  if (!declaracao || typeof declaracao !== 'object' || Array.isArray(declaracao)) return null;
  if (declaracao[MARCA_DECLARACAO] !== true || declaracao[PROPRIETARIO_DECLARACAO] !== handler) return null;
  if (declaracao.tipo === 'publica' && Object.keys(declaracao).length === 1) return declaracao;
  if (declaracao.tipo === 'papel' && Object.keys(declaracao).length === 2 && PAPEIS.has(declaracao.papel)) {
    return declaracao;
  }
  return null;
}

function barreiraAutorizacao(handler) {
  return function verificarDeclaracaoAutorizacao(req, res, next) {
    if (typeof handler !== 'function' || !obterDeclaracaoAutorizacao(handler)) {
      return res.status(403).json({ message: 'Declaração de autorização inválida' });
    }
    return handler(req, res, next);
  };
}

function exige(papel) {
  if (!PAPEIS.has(papel)) throw new TypeError('Papel de autorização inválido');

  return anexarDeclaracao(async function exigePapel(req, res, next) {
    return autenticar(req, res, () => {
      const papelUsuario = req.user?.papel;
      if (!PAPEIS.has(papelUsuario)) {
        return res.status(401).json({ message: 'Credencial sem papel válido' });
      }
      if (!PAPEIS_PERMITIDOS[papel].has(papelUsuario)) {
        return res.status(403).json({ message: 'Papel insuficiente' });
      }
      return next();
    });
  }, { tipo: 'papel', papel });
}

function publica() {
  return anexarDeclaracao(function rotaPublica(_req, _res, next) {
    return next();
  }, { tipo: 'publica' });
}

module.exports = {
  METADADO_AUTORIZACAO,
  barreiraAutorizacao,
  exige,
  publica,
  obterDeclaracaoAutorizacao
};
