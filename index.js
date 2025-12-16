// index.js
require('dotenv').config({ debug: false });

// Verificar se é primeira execução e rodar setup
const fs = require('fs');
const path = require('path');

async function iniciarServidor() {
  const app = require('./src/app');
  const logger = require('./src/config/logger');
  const { iniciarJobs, pararJobs } = require('./src/jobs/scheduledJobs');

  const PORT = process.env.PORT || 3000;
  const NODE_ENV = process.env.NODE_ENV || 'development';

  // Verificar se banco está configurado
  try {
    const db = require('./src/config/knex');
    await db.raw('SELECT 1');
    logger.info(' Conexão com banco de dados verificada');
  } catch (error) {
    logger.error(' Erro ao conectar no banco de dados');
    logger.error('   Execute: npm run setup');
    process.exit(1);
  }

  // Iniciar servidor
  const server = app.listen(PORT, () => {
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info(' Servidor SAGE-API iniciado');
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info(` Porta: ${PORT}`);
    logger.info(` Ambiente: ${NODE_ENV}`);
    logger.info(` Documentação: http://localhost:${PORT}/docs`);
    logger.info(` Health Check: http://localhost:${PORT}/health`);
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  });

  // Iniciar jobs agendados
  let jobs;
  try {
    jobs = iniciarJobs();
    logger.info(' Jobs agendados iniciados');
  } catch (error) {
    logger.error(` Erro ao iniciar jobs: ${error.message}`);
  }

  // Graceful shutdown
  const shutdown = (signal) => {
    logger.info(`\n${signal} recebido. Encerrando gracefully...`);

    // Parar de aceitar novas conexões
    server.close(() => {
      logger.info(' Servidor HTTP fechado');

      // Parar jobs
      if (jobs) {
        pararJobs(jobs);
      }

      // Fechar pool de conexões do banco
      global.db.destroy().then(() => {
        logger.info(' Pool de conexões do banco fechado');
        process.exit(0);
      });
    });

    // Force shutdown após 10 segundos
    setTimeout(() => {
      logger.error(' Forçando encerramento após timeout');
      process.exit(1);
    }, 10000);
  };

  // Capturar sinais de término
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Capturar erros não tratados
  process.on('uncaughtException', (error) => {
    logger.errorWithStack(' Uncaught Exception', error);
    shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error(` Unhandled Rejection at: ${promise}, reason: ${reason}`);
  });
}

// Executar
iniciarServidor().catch((error) => {
  console.error(' Erro fatal ao iniciar servidor:', error);
  process.exit(1);
});