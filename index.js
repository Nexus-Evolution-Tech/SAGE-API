// index.js
require('dotenv').config({ debug: false });

async function iniciarServidor() {
  console.log('[BOOT] iniciarServidor()');
  const app = require('./src/app');
  const logger = require('./src/config/logger');
  const { db } = require('./src/config/queryBuilder');
  const { iniciarJobs, pararJobs } = require('./src/jobs/scheduledJobs');
  const redis = require('./src/config/redis');
  const { initWebSocket } = require('./src/websocket/wsServer');
  const globalState = require('./src/state/globalState');

  const PORT = process.env.PORT || 3000;
  const NODE_ENV = process.env.NODE_ENV || 'development';
  console.log(`[BOOT] PORT=${PORT} NODE_ENV=${NODE_ENV}`);
  
  // Flag de shutdown para parar requisições pendentes
  global.isShuttingDown = false;

  // Inicializar Redis (async, não bloqueia)
  console.log('[BOOT] inicializando Redis...');
  await redis.initRedis();
  console.log('[BOOT] Redis inicializado');

  // Iniciar servidor em 0.0.0.0 para aceitar conexões da rede (catraca, outros PCs)
  const HOST = process.env.HOST || '0.0.0.0';
  const server = app.listen(PORT, HOST, () => {
    console.log('[BOOT] app.listen callback');
    
    // Inicializar WebSocket após servidor estar listening
    console.log('[BOOT] inicializando WebSocket...');
    initWebSocket(server);
    global.io = require('./src/websocket/wsServer').getIO();
    console.log('[BOOT] WebSocket inicializado');

    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info('✓ Servidor SAGE-API iniciado');
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info(`  Escutando em: ${HOST}:${PORT}`);
    logger.info(`  Ambiente: ${NODE_ENV}`);
    logger.info(`  Documentação: http://localhost:${PORT}/docs`);
    logger.info(`  Health Check: http://localhost:${PORT}/health`);
    logger.info(`  WebSocket: ws://localhost:${PORT}`);
    logger.info(`  Cache: ${redis.isEnabled() ? 'Redis' : 'LRU (in-memory)'}`);
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  });

  // Health check em background (pode ser cancelado no shutdown)
  let healthCheckTimeout;
  healthCheckTimeout = setTimeout(async () => {
    try {
      const isHealthy = await db.healthCheck();
      if (isHealthy) {
        logger.info('✓ Banco de dados verificado e operacional');
      } else {
        logger.warn('⚠ Banco de dados indisponível');
        logger.warn('  Execute: npm run setup:db');
      }
    } catch (error) {
      logger.debug(`Health check error (ignorado): ${error.message}`);
    }
  }, 2000);

  // Iniciar jobs agendados
  let jobs;
  try {
    if (process.env.JOBS_ENABLED !== 'false') {
      jobs = iniciarJobs();
      logger.info('✓ Jobs agendados iniciados');

      // Verificar promoção na subida: se ano mudou e sistema estava desligado, executa agora
      const promocaoAlunosService = require('./src/services/promocaoAlunosService');
      promocaoAlunosService.executarPromocaoSeAnoMudou({ apenasSimulacao: false })
        .then(({ executado, resultado }) => {
          if (executado && resultado) {
            logger.info(`[PROMOÇÃO] Executado na subida: ${resultado.promovidos} promovidos, ${resultado.finalizados} finalizados`);
          }
        })
        .catch((err) => logger.debug(`[PROMOÇÃO] Verificação na subida: ${err.message}`));

      // Sync imediata no boot: puxar da catraca tudo que acumulou enquanto o sistema estava desligado
      const accessService = require('./src/services/accessService');
      setImmediate(() => {
        accessService.sincronizarTodosAcessos()
          .then((resultados) => {
            const total = resultados.reduce((acc, r) => acc + (r.acessosSincronizados || 0), 0);
            if (total > 0) logger.info(`[BOOT] Sync inicial: ${total} acessos sincronizados`);
          })
          .catch((err) => logger.debug(`[BOOT] Sync inicial: ${err.message}`));
      });
    } else {
      logger.warn('⚠ Jobs desabilitados (JOBS_ENABLED=false)');
    }
  } catch (error) {
    logger.error(`⚠ Erro ao iniciar jobs: ${error.message}`);
  }

  // Graceful shutdown
  const shutdown = (signal) => {
    logger.info(`\n⚠ ${signal} recebido. Encerrando gracefully...`);
    
    // Sinalizar que está encerrando (para requisições param)
    global.isShuttingDown = true;

    // Cancelar health check em background
    if (healthCheckTimeout) {
      clearTimeout(healthCheckTimeout);
    }

    // Parar de aceitar novas conexões
    server.close(async () => {
      logger.info('✓ Servidor HTTP fechado');

      // Parar jobs (para de agendar novas tasks)
      if (jobs) {
        pararJobs(jobs);
        logger.info('✓ Jobs agendados parados');
      }

      // Dar tempo mínimo para requisições em voo (200ms ao invés de 500ms)
      await new Promise(resolve => setTimeout(resolve, 200));

      // Fechar pool de conexões
      db.end((err) => {
        if (err) {
          logger.error(`✗ Erro ao fechar conexões: ${err.message}`);
          process.exit(1);
        } else {
          logger.info('✓ Pool de conexões fechado');
          
          // Fechar Redis (se conectado)
          const redisClient = redis.client();
          if (redisClient) {
            redisClient.quit(() => {
              logger.info('✓ Conexão Redis fechada');
              process.exit(0);
            });
          } else {
            process.exit(0);
          }
        }
      });
    });

    // Force shutdown após 5 segundos (reduzido de 10s)
    setTimeout(() => {
      logger.error('✗ Forçando encerramento (timeout de 5s excedido)');
      process.exit(1);
    }, 5000);
  };

  // Capturar sinais de término
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Capturar erros não tratados (log apenas, não mata o processo)
  process.on('uncaughtException', (error) => {
    logger.errorWithStack('✗ Uncaught Exception', error);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.debug(`✗ Unhandled Rejection (ignorada): ${reason}`);
  });
}

// Executar
iniciarServidor().catch((error) => {
  console.error('✗ Erro fatal ao iniciar servidor:', error.message);
  process.exit(1);
});