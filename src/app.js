require('dotenv').config();
const express = require("express");
const cors = require("cors");
const compression = require("compression");
const loadRoutes = require("./config/loadRoutes");
const logger = require("./config/logger");
const { globalDB, db } = require("./config/queryBuilder");
global.db = globalDB;
const path = require("path");

const swaggerUi = require("swagger-ui-express");
const YAML = require("yamljs");
const swaggerDocument = YAML.load("./src/docs/swagger.yml");
const fs = require('fs');

const app = express();

// Rate limiting removido em dev para evitar 429; se precisar em prod, reativar aqui.

// Compressão de respostas
app.use(compression());

// Configuração de CORS dinâmica
const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').map(o => o.trim());
const allowAllOrigins = allowedOrigins.includes('*') || process.env.CORS_ALLOW_ALL === 'true';

const corsOptions = {
  origin: function (origin, callback) {
    // Permitir requisições sem origin (Postman, curl, etc.)
    if (!origin) return callback(null, true);

    if (allowAllOrigins || allowedOrigins.includes(origin)) {
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
    if (duration > 1000) {
      logger.warn(`⚠ SLOW REQUEST: ${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`);
    } else {
      logger.http(`${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`);
    }
  });
  next();
});

// Rotas de monitoramento (sem autenticação para simplificar)
const monitoringRoutes = require('./routes/monitoringRoutes');
app.use('/monitoring', monitoringRoutes);
logger.info("Monitoramento disponível em: /monitoring/*");
console.log('[BOOT-APP] monitoring routes pronta');

// Garante diretório base de uploads na inicialização
try {
  const baseUploads = path.join(__dirname, 'uploads');
  if (!fs.existsSync(baseUploads)) {
    fs.mkdirSync(baseUploads, { recursive: true });
    logger.info('Criado diretório de uploads base: src/uploads');
  }
} catch (e) {
  logger.warn(`Não foi possível garantir diretório de uploads: ${e.message}`);
}

// Rota para Swagger:
app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
logger.info("Documentação Swagger disponível em: /docs");

// Serve arquivos estáticos da pasta "upload"
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
logger.info("Arquivos estáticos disponíveis em: /uploads");

// Rotas da aplicação (com tratamento de erro)
try {
  loadRoutes(app);
  logger.info('✓ Rotas carregadas com sucesso');
} catch (error) {
  logger.error(`✗ Erro ao carregar rotas: ${error.message}`);
  // Continuar mesmo com erro de rotas
}

// Health check endpoint
app.get('/health', (req, res) => {
  const redis = require('./config/redis');
  const globalState = require('./state/globalState');

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
    version: process.env.API_VERSION,
    cache: redis.getStats(),
    stats: globalState.getStats(),
    connections: {
      websocket: global.io ? global.io.engine.clientsCount : 0
    }
  });
});

// Middleware de erro global
app.use((err, req, res, next) => {
  // Se já foi enviado response, não faz nada
  if (res.headersSent) {
    return next(err);
  }
  
  logger.errorWithStack('Erro não tratado', err);
  
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Erro interno do servidor' : err.message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

module.exports = app;
