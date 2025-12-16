require('dotenv').config();
const express = require("express");
const cors = require("cors");
const compression = require("compression");
const loadRoutes = require("./config/loadRoutes");
const logger = require("./config/logger");
global.db = require("./config/knex");
const path = require("path");

const swaggerUi = require("swagger-ui-express");
const YAML = require("yamljs");
const swaggerDocument = YAML.load("./src/docs/swagger.yml");

const app = express();

// Inicializar sincronização de pendências ao ligar o servidor
const inicializarSincronizacao = async () => {
  try {
    const { sincronizarTodasPessoasNasCatracas } = require('./utils/sync_catracas');
    logger.info('Iniciando sincronização de pessoas pendentes...');
    
    // Aguarda um pouco para garantir que a conexão com o BD está pronta
    setTimeout(async () => {
      try {
        await sincronizarTodasPessoasNasCatracas();
        logger.info('Sincronização de pendências concluída com sucesso');
      } catch (erro) {
        logger.error('Erro ao sincronizar pendências: ' + erro.message);
      }
    }, 2000);
  } catch (erro) {
    logger.error('Erro ao inicializar sincronização: ' + erro.message);
  }
};

// Chamar ao inicializar
inicializarSincronizacao();

// Compressão de respostas
app.use(compression());

// Configuração de CORS dinâmica
const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').map(o => o.trim());

const corsOptions = {
  origin: function (origin, callback) {
    // Permitir requisições sem origin (Postman, curl, etc.)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
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

// Middleware de logging de requisições
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.http(`${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`);
  });
  next();
});

// Rota para Swagger:
app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
logger.info("Documentação Swagger disponível em: /docs");

// Serve arquivos estáticos da pasta "upload"
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
logger.info("Arquivos estáticos disponíveis em: /uploads");

// Rotas da aplicação
loadRoutes(app);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
    version: process.env.API_VERSION
  });
});

// Middleware de erro global
app.use((err, req, res, next) => {
  logger.errorWithStack('Erro não tratado', err);
  
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Erro interno do servidor' : err.message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

module.exports = app;
