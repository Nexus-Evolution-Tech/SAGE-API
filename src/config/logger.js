const winston = require('winston');
const path = require('path');

// Níveis de log customizados
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Cores para cada nível (console)
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

winston.addColors(colors);

// Formato customizado
const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}`,
  ),
);

// Transports - apenas console
const transports = [
  new winston.transports.Console({
    format,
  }),
];

// Criar logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  levels,
  transports,
});

// Helper para logging de requisições HTTP
logger.http = (message, meta = {}) => {
  logger.log('http', message, meta);
};

// Helper para logging de erros com stack trace
logger.errorWithStack = (message, error) => {
  logger.error(`${message}: ${error.message}`, {
    stack: error.stack,
    ...error,
  });
};

module.exports = logger;
