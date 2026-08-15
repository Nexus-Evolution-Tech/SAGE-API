require('./config/env');
const express = require("express");
const cors = require("cors");
const compression = require("compression");
const loadRoutes = require("./config/loadRoutes");
const { publica, assertArvoreExpress, instrumentarAplicacao } = require('./middlewares/autorizacao');
const logger = require("./config/logger");
const { globalDB, db } = require("./config/queryBuilder");
global.db = globalDB;
const path = require("path");
const fs = require("fs");
const { paths, ensureDataDirs } = require("./config/paths");
const { webDir, indexFile, webBuildAvailable, isSpaNavigation } = require("./config/web");
const {
  createReadinessChecker,
  createReadinessHandler
} = require("./services/readinessService");
const { version: packageVersion } = require("../package.json");
const { responderErroInterno } = require('./utils/responderErroInterno');

const swaggerUi = require("swagger-ui-express");
const YAML = require("yaml");
// Resolve a especificação a partir deste módulo; serviços Windows não garantem o cwd do processo.
const swaggerDocument = YAML.parse(
  fs.readFileSync(path.join(__dirname, "docs", "swagger.yml"), "utf8")
);

const app = express();
instrumentarAplicacao(app);
const webBuildIsAvailable = webBuildAvailable();

function rotaDeLog(req) {
  if (req.route?.path) return req.route.path;
  try {
    return new URL(req.originalUrl || req.url || '/', 'http://sage.local').pathname || '/';
  } catch {
    return '/';
  }
}

function serveSpaNavigation(req, res, next) {
  if (!isSpaNavigation(req)) return next();
  return res.sendFile(indexFile);
}

// Rate limiting removido em dev para evitar 429; se precisar em prod, reativar aqui.

// Compressão de respostas
app.use(compression());

// Configuração de CORS dinâmica
const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').map(o => o.trim());
const allowAllOrigins = allowedOrigins.includes('*') || process.env.CORS_ALLOW_ALL === 'true';
const localSageOrigins = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://[::1]:3000'
]);

const corsOptions = {
  origin: function (origin, callback) {
    // Permitir requisições sem origin (Postman, curl, etc.)
    if (!origin) return callback(null, true);

    if (allowAllOrigins || allowedOrigins.includes(origin) || localSageOrigins.has(origin)) {
      callback(null, true);
    } else {
      logger.warn(`CORS bloqueado: ${origin}`);
      callback(new Error(`CORS policy: Origin not allowed: ${origin}`));
    }
  },
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"],
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Timeout global para requisições (evita requests travados)
app.use((req, res, next) => {
  req.setTimeout(parseInt(process.env.REQUEST_TIMEOUT || '30000')); // 30s
  res.setTimeout(parseInt(process.env.REQUEST_TIMEOUT || '30000'));
  next();
});

// Middleware de logging de requisições
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const linha = `${req.method} ${rotaDeLog(req)} ${res.statusCode} - ${duration}ms`;
    if (duration > 1000) {
      logger.warn(`⚠ SLOW REQUEST: ${linha}`);
    } else {
      logger.http(linha);
    }
  });
  next();
});

// Log em INFO de qualquer requisição para o Monitor (catraca) — para debugar se o POST chega
app.use((req, res, next) => {
  if (req.path.toLowerCase().startsWith('/api/notifications')) {
    logger.info(`[MONITOR] Requisição recebida: ${req.method} ${req.path}`);
  }
  next();
});

// Garante que todo estado gravável existe fora do release quando SAGE_DATA_DIR está configurado.
try {
  ensureDataDirs();
} catch (e) {
  logger.warn(`Não foi possível garantir diretórios de dados: ${e.message}`);
}

// Rota para Swagger:
app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
logger.info("Documentação Swagger disponível em: /docs");

// Serve arquivos estáticos da pasta "upload"
app.use("/uploads", express.static(paths.uploads));
logger.info("Arquivos estáticos disponíveis em: /uploads");

// Algumas rotas do BrowserRouter também existem na API. Navegação HTML precisa vencer essas
// rotas; fetches sem Accept: text/html continuam seguindo para a API logo abaixo.
if (webBuildIsAvailable) app.use(serveSpaNavigation);

// Rotas da aplicação (com tratamento de erro)
// Normaliza respostas 500 legadas para o contrato publico unico.
app.use((req, res, next) => {
  const statusOriginal = res.status.bind(res);
  const jsonOriginal = res.json.bind(res);
  let statusAtual = res.statusCode;
  res.status = (status) => {
    statusAtual = status;
    return statusOriginal(status);
  };
  res.json = (body) => {
    if (statusAtual === 500 && !res.locals?.sageErroInterno) {
      const detalhe = body?.detalhe || body?.stack || body?.error || { message: 'resposta 500 legada' };
      return responderErroInterno(res, detalhe, 'Erro interno no servidor');
    }
    return jsonOriginal(body);
  };
  next();
});

let routesReady = false;
try {
  const loadedRoutes = loadRoutes(app);
  const essentialRoutes = [
    'accessRoutes.js',
    'deviceRoutes.js',
    'notificationRoutes.js',
    'peopleRoutes.js',
    'schoolRoutes.js'
  ];
  const falhaEssencial = loadedRoutes.failures?.find(({ file }) => essentialRoutes.includes(file));
  if (falhaEssencial || !essentialRoutes.every((route) => loadedRoutes.includes(route))) {
    const rota = falhaEssencial?.file || 'desconhecida';
    logger.error('[BOOT] codigo=ROTAS_ESSENCIAIS_INDISPONIVEIS', { rota, detalhe: falhaEssencial?.error });
    process.exitCode = 1;
    throw new Error(`Falha ao carregar rota essencial: ${rota}`);
  }
  routesReady = (loadedRoutes.failures?.length || 0) === 0;
  for (const { file, error } of loadedRoutes.failures || []) {
    logger.error('[BOOT] codigo=ROTA_NAO_ESSENCIAL_INDISPONIVEL', { rota: file, detalhe: error });
  }
  logger[loadedRoutes.failures?.length ? 'warn' : 'info'](loadedRoutes.failures?.length
    ? '[BOOT] codigo=ROTAS_NAO_ESSENCIAIS_INDISPONIVEIS' : '✓ Rotas carregadas com sucesso');
} catch (error) {
  logger.error('[BOOT] codigo=FALHA_CARREGAMENTO_ROTAS', { detalhe: error });
  throw error;
}

// Middleware de tratamento de erros para evitar conexões fechadas sem resposta
app.use((err, req, res, next) => {
  try {
    if (!res.headersSent) {
      responderErroInterno(res, err);
    } else {
      // Se headers já foram enviados, delega para Express encerrar
      next(err);
    }
  } catch (e) {
    // Último recurso: fechar com 500
    try { res.status(500).end(); } catch { logger.error('[HTTP] codigo=RESPOSTA_ERRO_NAO_ENVIADA'); }
  }
});

// Health check endpoint
app.get('/health', publica(), (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

const checkReadiness = createReadinessChecker({
  db,
  dataDirectories: [
    paths.apiLogs,
    paths.uploads,
    paths.exports,
    paths.backups
  ],
  routesReady: () => routesReady,
  webReady: webBuildAvailable,
  requireWeb: process.env.NODE_ENV === 'production' || process.env.SAGE_REQUIRE_WEB === 'true'
});
app.get(
  '/ready',
  publica(),
  createReadinessHandler(checkReadiness, process.env.API_VERSION || packageVersion)
);

assertArvoreExpress(app);

// Assets são resolvidos depois da infraestrutura. O fallback repete a lista explícita de rotas
// do painel, para não transformar endpoints desconhecidos da API em index.html.
if (webBuildIsAvailable) {
  app.use(express.static(webDir, { index: false }));
  app.use(serveSpaNavigation);
  logger.info(`Painel web disponível em: ${webDir}`);
} else {
  logger.warn(`Build web indisponível em: ${webDir}`);
}

// 404 handler (após todas as rotas)
app.use((req, res) => {
  res.status(404).json({ error: 'Rota não encontrada' });
});

// Middleware de erro global
app.use((err, req, res, next) => {
  // Se já foi enviado response, não faz nada
  if (res.headersSent) {
    return next(err);
  }
  
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  return responderErroInterno(res, err);
});

module.exports = app;
