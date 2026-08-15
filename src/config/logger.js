const fs = require('fs');
const path = require('path');
const winston = require('winston');
const { paths } = require('./paths');
const { sanitizar, sanitizarTexto } = require('../services/sanitizador');

const MAXSIZE = 10 * 1024 * 1024;
const MAXFILES = 8;
const LIMITE_TOTAL_BYTES = MAXSIZE * MAXFILES * 2; // app + WinSW
const levels = { error: 0, warn: 1, info: 2, http: 3, debug: 4 };

winston.addColors({ error: 'red', warn: 'yellow', info: 'green', http: 'magenta', debug: 'white' });

function avisarFalhaTransporte(erro) {
  const codigo = erro?.code === 'ENOSPC' ? 'SAGE-LOG-ENOSPC' : 'SAGE-LOG-TRANSPORT-ERRO';
  process.stderr.write(`[${codigo}] O registro em arquivo falhou; libere espaço em disco.\n`);
}

const sanitizarNoTransport = winston.format((info) => {
  const nivel = info.level;
  const timestamp = info.timestamp;
  const mensagem = info.message;
  const seguro = sanitizar(Object.fromEntries(Object.entries(info)));

  for (const chave of Object.keys(info)) delete info[chave];
  Object.assign(info, seguro, { level: nivel });
  if (timestamp !== undefined) info.timestamp = timestamp;
  if (typeof mensagem === 'string') info.message = sanitizarTexto(mensagem);
  return info;
});

function criarLogger({ diretorio = paths.apiLogs, maxsize = MAXSIZE, maxFiles = MAXFILES } = {}) {
  fs.mkdirSync(diretorio, { recursive: true });
  const arquivo = new winston.transports.File({ filename: path.join(diretorio, 'api.log'), maxsize, maxFiles, tailable: true, format: winston.format.combine(winston.format.timestamp(), sanitizarNoTransport(), winston.format.json()) });
  arquivo.on('error', avisarFalhaTransporte);
  const logger = winston.createLogger({ level: process.env.LOG_LEVEL || 'info', levels, transports: [
    new winston.transports.Console({ format: winston.format.combine(winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }), sanitizarNoTransport(), winston.format.colorize({ all: true }), winston.format.printf((info) => `${info.timestamp} ${info.level}: ${info.message}`)) }),
    arquivo
  ] });
  logger.http = (message, meta = {}) => logger.log('http', message, meta);
  logger.errorWithStack = (message, error, meta = {}) => logger.error(message, { ...meta, stack: error?.stack });
  return logger;
}

const logger = criarLogger();
module.exports = Object.assign(logger, { criarLogger, avisarFalhaTransporte, MAXSIZE, MAXFILES, LIMITE_TOTAL_BYTES });
