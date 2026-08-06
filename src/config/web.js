const fs = require('fs');
const path = require('path');
const { appRoot } = require('./env');

const configuredWebDir = process.env.SAGE_WEB_DIR;
if (configuredWebDir && !path.isAbsolute(configuredWebDir)) {
  throw new Error('SAGE_WEB_DIR deve ser um caminho absoluto');
}

// No pacote instalado, api/ e web/ são irmãos dentro de releases/<versão>/.
const webDir = path.resolve(configuredWebDir || path.join(appRoot, '..', 'web'));
const indexFile = path.join(webDir, 'index.html');

// Espelha as rotas declaradas em SAGE/src/App.js. Rotas não listadas continuam sendo da API.
const spaRoutePatterns = Object.freeze([
  /^\/$/,
  /^\/(?:login|cadastro|esqueci-senha|pessoas|inicio|departamentos|dispositivos|monitoramento|turmas|regras|horarios|relatorios|configuracoes|aulas|areas|dados|monitoring)\/?$/,
  /^\/tabelas\/[^/]+(?:\/[^/]+)?\/?$/,
  /^\/formulario\/[^/]+\/[^/]+\/?$/,
  /^\/adicionar\/[^/]+\/?$/,
  /^\/relatorios\/pessoa\/[^/]+\/?$/
]);

function webBuildAvailable() {
  try {
    return fs.statSync(indexFile).isFile();
  } catch {
    return false;
  }
}

function isInfrastructurePath(requestPath) {
  return ['/api', '/socket.io', '/uploads', '/docs'].some(
    (prefix) => requestPath === prefix || requestPath.startsWith(`${prefix}/`)
  );
}

function isSpaRoute(requestPath) {
  return spaRoutePatterns.some((pattern) => pattern.test(requestPath));
}

function isSpaNavigation(req) {
  const accept = req.get('accept');
  return ['GET', 'HEAD'].includes(req.method)
    && /(?:^|,)\s*text\/html(?:\s*;|,|$)/i.test(accept || '')
    && req.accepts(['html', 'json']) === 'html'
    && !isInfrastructurePath(req.path)
    && isSpaRoute(req.path);
}

module.exports = { webDir, indexFile, webBuildAvailable, isInfrastructurePath, isSpaNavigation };
