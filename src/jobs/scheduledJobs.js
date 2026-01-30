const cron = require('node-cron');
const logger = require('../config/logger');
const deviceService = require('../services/deviceService');
const db = require('../config/database');

const listarTodos = async () => {
  const [result] = await db.query('SELECT * FROM Dispositivo');
  return result;
};

// Job de sincronização de acessos (a cada 10 min — backup)
const sincronizarAcessosJob = () => {
  const cronExpression = '*/10 * * * *'; // a cada 10 minutos

  return cron.schedule(cronExpression, async () => {
    try {
      logger.info('Iniciando sincronização automática de acessos');

      const accessService = require('../services/accessService');
      const resultados = await accessService.sincronizarTodosAcessos();

      const totalSync = resultados.reduce((acc, r) => acc + (r.acessosSincronizados || 0), 0);
      logger.info(`${totalSync} acessos sincronizados`);
    } catch (error) {
      logger.error(`Erro na sincronização de acessos: ${error.message}`);
    }
  }, { scheduled: true, timezone: 'America/Sao_Paulo' });
};

// Polling de acessos para monitoramento em tempo quase real (igual ao software oficial Control iD)
// O servidor consulta as catracas periodicamente; não precisa da catraca enviar POST nem abrir firewall.
const MONITOR_POLLING_INTERVAL_MS = parseInt(process.env.MONITOR_POLLING_INTERVAL_MS || '20000', 10); // 20 s

const pollingMonitoramentoJob = () => {
  if (MONITOR_POLLING_INTERVAL_MS <= 0) return null;
  return setInterval(async () => {
    try {
      const accessService = require('../services/accessService');
      await accessService.sincronizarTodosAcessos();
    } catch (error) {
      logger.debug(`[MONITOR POLLING] Erro: ${error.message}`);
    }
  }, MONITOR_POLLING_INTERVAL_MS);
};

// Job de health check das catracas
const healthCheckCatracasJob = () => {
  const intervalMs = parseInt(process.env.HEALTH_CHECK_INTERVAL || '60000'); // 1 min

  return setInterval(async () => {
    try {
      const dispositivos = await listarTodos();

      for (const dispositivo of dispositivos) {
        try {
          const isOnline = await deviceService.testarConexaoCatraca(dispositivo);
          await db.query(
            'UPDATE Dispositivo SET status = ?, last_health_check = ? WHERE id = ?',
            [isOnline ? 'ONLINE' : 'OFFLINE', new Date(), dispositivo.id]
          );
        } catch (err) {
          logger.debug(`Health check falhou para ${dispositivo.nome}: ${err.message}`);
        }
      }
    } catch (error) {
      logger.debug(`Erro no health check: ${error.message}`);
    }
  }, intervalMs);
};

// Job de sincronizações pendentes
const verificarSyncPendentesJob = () => {
  const cronExpression = process.env.SYNC_CHECK_INTERVAL || '*/1 * * * *';

  return cron.schedule(cronExpression, async () => {
    logger.info('Iniciando job de verificação de sincronizações pendentes');

    try {
      const [pendentesResult] = await db.query(
        'SELECT * FROM sync_pendente ORDER BY data_tentativa ASC LIMIT ?',
        [parseInt(process.env.SYNC_BATCH_SIZE || '50')]
      );
      const pendentes = pendentesResult;

      if (!pendentes.length) {
        logger.debug('Nenhuma sincronização pendente');
        return;
      }

      const offlineDevices = new Set();
      const dispositivosUnicos = [...new Set(pendentes.map(p => p.dispositivo_id).filter(Boolean))];

      for (const dispositivoId of dispositivosUnicos) {
        try {
          const [dispositivoResult] = await db.query('SELECT * FROM Dispositivo WHERE id = ? LIMIT 1', [dispositivoId]);
          const dispositivo = dispositivoResult?.[0];
          if (!dispositivo) continue;

          const isOnline = await deviceService.testarConexaoCatraca(dispositivo);
          if (!isOnline) {
            offlineDevices.add(dispositivoId);
            logger.warn(`Catraca ${dispositivo.nome || dispositivoId} offline`);
          }
        } catch (err) {
          offlineDevices.add(dispositivoId);
          logger.warn(`Falha ao testar catraca ${dispositivoId}: ${err.message}`);
        }
      }

      const controlIdService = require('../services/controlIdService');

      for (const registro of pendentes) {
        try {
          if (offlineDevices.has(registro.dispositivo_id)) {
            await db.query(
              'UPDATE sync_pendente SET retry_count = retry_count + 1, last_attempt = ? WHERE id = ?',
              [new Date(), registro.id]
            );
            continue;
          }

          const [pessoaResult] = await db.query('SELECT * FROM Pessoa WHERE id = ? LIMIT 1', [registro.pessoa_id]);
          const pessoa = pessoaResult?.[0];
          if (!pessoa) {
            await db.query('DELETE FROM sync_pendente WHERE id = ?', [registro.id]);
            continue;
          }

          if (registro.operation === 'CREATE') {
            await controlIdService.criarNovaPessoaNasCatracas(pessoa, { dispositivoId: registro.dispositivo_id });
          } else if (registro.operation === 'UPDATE') {
            await controlIdService.editarPessoaNasCatracas(
              pessoa.id, pessoa.nome, pessoa.cartao_rfid, pessoa.qr_code,
              { dispositivoId: registro.dispositivo_id }
            );
          } else if (registro.operation === 'DELETE') {
            await controlIdService.deletarPessoaDasCatracas(pessoa.id, { dispositivoId: registro.dispositivo_id });
          }

          await db.query('DELETE FROM sync_pendente WHERE id = ?', [registro.id]);

        } catch (error) {
          logger.error(`Erro ao processar pendente ID ${registro.id}: ${error.message}`);
          await db.query(
            'UPDATE sync_pendente SET retry_count = retry_count + 1, last_attempt = ?, error_message = ? WHERE id = ?',
            [new Date(), error.message?.slice(0, 255) || null, registro.id]
          );
        }
      }

      logger.info('Job de sync pendentes concluído');
    } catch (error) {
      logger.error(`Erro no job de sync pendentes: ${error.message}`);
    }
  }, { scheduled: true, timezone: 'America/Sao_Paulo' });
};

// Iniciar todos os jobs
const iniciarJobs = () => {
  logger.info('Iniciando jobs agendados...');
  const jobs = {
    syncPendentes: verificarSyncPendentesJob(),
    healthCheck: healthCheckCatracasJob(),
    syncAcessos: sincronizarAcessosJob(),
    monitorPolling: pollingMonitoramentoJob()
  };
  if (jobs.monitorPolling) {
    logger.info(`[MONITOR] Polling de acessos a cada ${MONITOR_POLLING_INTERVAL_MS / 1000}s (tempo quase real)`);
  }
  return jobs;
};

// Parar todos os jobs
const pararJobs = (jobs) => {
  if (jobs.syncPendentes) jobs.syncPendentes.stop();
  if (jobs.healthCheck) clearInterval(jobs.healthCheck);
  if (jobs.syncAcessos) jobs.syncAcessos.stop();
  if (jobs.monitorPolling) clearInterval(jobs.monitorPolling);
};

module.exports = {
  iniciarJobs,
  pararJobs,
  verificarSyncPendentesJob,
  healthCheckCatracasJob,
  sincronizarAcessosJob,
  pollingMonitoramentoJob
};
