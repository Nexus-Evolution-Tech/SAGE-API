const METADADO_AUTORIZACAO = 'autorizacao';
const MARCA_DECLARACAO = Symbol('declaracao-autorizacao-sage');
const PROPRIETARIO_DECLARACAO = Symbol('proprietario-declaracao-autorizacao-sage');
const CAMINHO_MONTAGEM = Symbol('caminho-montagem-autorizacao-sage');
const APLICACAO_INSTRUMENTADA = Symbol('aplicacao-instrumentada-autorizacao-sage');
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
  if (declaracao.tipo === 'preAutenticacao'
    && Object.keys(declaracao).length === 2
    && typeof declaracao.motivo === 'string'
    && declaracao.motivo.length > 0) {
    return declaracao;
  }
  if (declaracao.tipo === 'autenticacaoPropria'
    && Object.keys(declaracao).length === 3
    && typeof declaracao.nome === 'string'
    && declaracao.nome.length > 0
    && declaracao.issue === 67) {
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
  const autenticar = require('./autenticar');

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

function preAutenticacao(motivo) {
  if (typeof motivo !== 'string' || motivo.trim().length === 0) {
    throw new TypeError('Motivo de pre-autenticação inválido');
  }
  return anexarDeclaracao(function rotaPreAutenticacao(_req, _res, next) {
    return next();
  }, { tipo: 'preAutenticacao', motivo: motivo.trim() });
}

function autenticacaoPropria(nome) {
  if (nome !== 'monitorCallbackAuth') {
    throw new TypeError('Autenticação própria desconhecida');
  }
  return anexarDeclaracao(function autenticacaoPropriaDeclarada(_req, _res, next) {
    return next();
  }, { tipo: 'autenticacaoPropria', nome, issue: 67 });
}

const PUBLICAS_FECHADAS = new Set(['GET /health', 'GET /ready', 'GET /status', 'GET /diagnostico']);
const PRE_AUTENTICACAO = new Set(['GET /setup/status', 'POST /setup/initialize', 'POST /escolas/login/:id', 'POST /escolas/recuperar-acesso']);

function unirCaminhos(prefixo, caminho) {
  const partes = [prefixo, caminho].filter((parte) => parte && parte !== '/');
  const resultado = `/${partes.join('/').replace(/^\/+|\/+$/g, '')}`;
  return resultado === '/' ? '/' : resultado.replace(/\/+/g, '/');
}

function nomesDeMetodos(route) {
  return Object.keys(route.methods || {}).filter((metodo) => route.methods[metodo]);
}

function ehMulter(handler) {
  return handler?.isMulterMiddleware === true || handler?.name === 'multerMiddleware';
}

function coletarRotas(stack, prefixo = '', herdadas = [], rotas = []) {
  for (const layer of stack || []) {
    if (layer.route) {
      const caminho = unirCaminhos(prefixo, layer.route.path);
      const handlers = (layer.route.stack || []).map((item) => item.handle);
      const declaracoes = [
        ...herdadas.filter((herdada) => {
          try { return !herdada.matcher || herdada.matcher(caminho); } catch { return false; }
        }).map((herdada) => herdada.declaracao),
        ...handlers.map(obterDeclaracaoAutorizacao).filter(Boolean)
      ];
      for (const metodo of nomesDeMetodos(layer.route)) {
        rotas.push({ metodo: metodo.toUpperCase(), caminho, handlers, declaracoes });
      }
      continue;
    }

    if (layer.handle?.stack) {
      coletarRotas(
        layer.handle.stack,
        unirCaminhos(prefixo, layer[CAMINHO_MONTAGEM]),
        herdadas,
        rotas
      );
      continue;
    }

    const declaracao = obterDeclaracaoAutorizacao(layer.handle);
    if (declaracao) herdadas = [...herdadas, { declaracao, matcher: layer.matchers?.[0] }];
  }
  return rotas;
}

function inspecionarArvoreExpress(app) {
  const stack = app?.router?.stack || app?._router?.stack || [];
  const rotas = coletarRotas(stack);
  const falhas = [];

  for (const rota of rotas) {
    const indiceAutorizacao = rota.handlers.findIndex(
      (handler) => obterDeclaracaoAutorizacao(handler)?.tipo === 'papel'
    );
    rota.handlers.forEach((handler, indice) => {
      if (ehMulter(handler) && (indiceAutorizacao < 0 || indice < indiceAutorizacao)) {
        falhas.push(`${rota.metodo} ${rota.caminho}: multer deve vir depois da autorização`);
      }
    });
    if (rota.declaracoes.length !== 1) {
      falhas.push(`${rota.metodo} ${rota.caminho}: exige exatamente uma declaração`);
      continue;
    }
    const declaracao = rota.declaracoes[0];
    const chave = `${rota.metodo} ${rota.caminho}`;
    if (declaracao.tipo === 'publica' && !PUBLICAS_FECHADAS.has(chave)) {
      falhas.push(`${chave}: publica() fora da lista fechada`);
    }
    if (declaracao.tipo === 'preAutenticacao' && !PRE_AUTENTICACAO.has(chave)) {
      falhas.push(`${chave}: preAutenticacao() não prevista`);
    }
    if (declaracao.tipo === 'autenticacaoPropria') {
      if (chave !== 'POST /api/notifications/dao' || declaracao.nome !== 'monitorCallbackAuth') {
        falhas.push(`${chave}: autenticacaoPropria() inválida`);
      } else if (!rota.handlers.some((handler) => handler?.name === declaracao.nome)) {
        falhas.push(`${chave}: middleware ${declaracao.nome} ausente da cadeia`);
      }
    }
  }

  return { rotas, falhas };
}

function assertArvoreExpress(app) {
  const resultado = inspecionarArvoreExpress(app);
  if (resultado.falhas.length > 0) {
    throw new Error(`Barreira de autorização reprovada:\n${resultado.falhas.join('\n')}`);
  }
  return resultado.rotas;
}

function instrumentarAplicacao(app) {
  if (!app || app[APLICACAO_INSTRUMENTADA] || typeof app.use !== 'function') return app;
  const useOriginal = app.use;
  Object.defineProperty(app, APLICACAO_INSTRUMENTADA, { value: true });
  app.use = function useComCaminho(...args) {
    const caminho = typeof args[0] === 'string' ? args[0] : '/';
    const stackAntes = this.router?.stack || this._router?.stack || [];
    const tamanhoAnterior = stackAntes.length;
    const resultado = useOriginal.apply(this, args);
    const stackDepois = this.router?.stack || this._router?.stack || [];
    for (const layer of stackDepois.slice(tamanhoAnterior)) {
      if (!layer[CAMINHO_MONTAGEM]) {
        Object.defineProperty(layer, CAMINHO_MONTAGEM, { value: caminho });
      }
    }
    return resultado;
  };
  return app;
}

module.exports = {
  METADADO_AUTORIZACAO,
  CAMINHO_MONTAGEM,
  barreiraAutorizacao,
  exige,
  publica,
  preAutenticacao,
  autenticacaoPropria,
  inspecionarArvoreExpress,
  assertArvoreExpress,
  instrumentarAplicacao,
  obterDeclaracaoAutorizacao
};
