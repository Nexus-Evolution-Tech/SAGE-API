const cron = require('node-cron');
const logger = require('../config/logger');
const deviceService = require('../services/deviceService');
const promocaoAlunosService = require('../services/promocaoAlunosService');
const { emitNotification } = require('../services/notificationService');
const db = require('../config/database');
const { isSyncEnabled } = require('../utils/syncFlags');

const listarTodos = async () => {
  const [result] = await db.query('SELECT * FROM Dispositivo');
  return result;
};

const CATRACA_SYNC_ENABLED = (process.env.CATRACA_SYNC_ENABLED || 'true').toLowerCase() !== 'false';

// Job de sincronização de acessos (a cada 10 min — backup)
const sincronizarAcessosJob = () => {
  if (!CATRACA_SYNC_ENABLED) return null;
  const cronExpression = '*/10 * * * *'; // a cada 10 minutos

  return cron.schedule(cronExpression, async () => {
    try {
      if (!CATRACA_SYNC_ENABLED) return;
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
  if (!CATRACA_SYNC_ENABLED || MONITOR_POLLING_INTERVAL_MS <= 0) return null;
  return setInterval(async () => {
    if (!CATRACA_SYNC_ENABLED) return;
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
  if (!CATRACA_SYNC_ENABLED) return null;
  const intervalMs = parseInt(process.env.HEALTH_CHECK_INTERVAL || '60000'); // 1 min

  return setInterval(async () => {
    try {
      const dispositivos = await listarTodos();

      for (const dispositivo of dispositivos) {
        if (!isSyncEnabled(dispositivo?.sync_enabled)) {
          logger.debug(`Health check ignorado para ${dispositivo.nome}: sincronização desativada`);
          continue;
        }
        try {
          const statusAnterior = (dispositivo.status || '').toUpperCase();
          const isOnline = await deviceService.testarConexaoCatraca(dispositivo);
          const novoStatus = isOnline ? 'ONLINE' : 'OFFLINE';
          await db.query(
            'UPDATE Dispositivo SET status = ?, last_health_check = ? WHERE id = ?',
            [novoStatus, new Date(), dispositivo.id]
          );
          if (statusAnterior === 'ONLINE' && novoStatus === 'OFFLINE') {
            emitNotification({
              title: 'Catraca offline',
              message: `O dispositivo "${dispositivo.nome}" está offline. Verifique a conexão.`,
              type: 'warning',
            });
          }
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
  if (!CATRACA_SYNC_ENABLED) return null;
  const cronExpression = process.env.SYNC_CHECK_INTERVAL || '*/1 * * * *';

  return cron.schedule(cronExpression, async () => {
    if (!CATRACA_SYNC_ENABLED) return;
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
      const disabledDevices = new Set();
      const dispositivosUnicos = [...new Set(pendentes.map(p => p.dispositivo_id).filter(Boolean))];

      for (const dispositivoId of dispositivosUnicos) {
        try {
          const [dispositivoResult] = await db.query('SELECT * FROM Dispositivo WHERE id = ? LIMIT 1', [dispositivoId]);
          const dispositivo = dispositivoResult?.[0];
          if (!dispositivo) continue;

          if (!isSyncEnabled(dispositivo?.sync_enabled)) {
            disabledDevices.add(dispositivoId);
            logger.info(`Sincronização pendente ignorada: ${dispositivo.nome} com sync desativada`);
            continue;
          }

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
          if (registro.dispositivo_id && disabledDevices.has(registro.dispositivo_id)) {
            await db.query(
              'UPDATE sync_pendente SET last_attempt = ?, error_message = ? WHERE id = ?',
              [new Date(), 'Sincronização desativada para o dispositivo', registro.id]
            );
            continue;
          }

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

// Job de promoção automática de alunos (horário configurável via PROMOCAO_CRON)
// Verifica se o ano mudou desde a última execução; se sim, roda a promoção.
// Não depende de estar ligado em 1º de janeiro: ao subir em qualquer dia, executa se necessário.
// Usa RM (ano matrícula) ou created_at para elegibilidade: anos_na_escola >= 1
// Padrão: 08:10 (PC desligado à meia-noite). PROMOCAO_CRON= ou false = desabilita o job
const promocaoAlunosJob = () => {
  const cronVal = (process.env.PROMOCAO_CRON || '').trim();
  if (!cronVal || cronVal === 'false' || cronVal === '0') {
    return null;
  }
  const cronExpression = cronVal;

  return cron.schedule(cronExpression, async () => {
    try {
      const { executado, anoAtual, resultado } = await promocaoAlunosService.executarPromocaoSeAnoMudou({ apenasSimulacao: false });

      if (executado && resultado) {
        logger.info(
          `[PROMOÇÃO] Ano ${anoAtual}: ${resultado.promovidos} promovidos, ${resultado.finalizados} finalizados, ${resultado.erros} erros`
        );
        emitNotification({
          title: 'Promoção automática executada',
          message: `Ano ${anoAtual}: ${resultado.promovidos} aluno(s) promovido(s), ${resultado.finalizados} finalizado(s).`,
          type: 'info',
        });
      }
    } catch (error) {
      logger.error(`[PROMOÇÃO] Erro na promoção automática: ${error.message}`);
      emitNotification({
        title: 'Erro na promoção automática',
        message: error.message,
        type: 'error',
      });
    }
  }, { scheduled: true, timezone: 'America/Sao_Paulo' });
};

// Iniciar todos os jobs
const iniciarJobs = () => {
  logger.info('Iniciando jobs agendados...');
  if (!CATRACA_SYNC_ENABLED) {
    logger.warn('⚠ Sincronização com catracas desabilitada (CATRACA_SYNC_ENABLED=false)');
  }
  const jobs = {
    syncPendentes: verificarSyncPendentesJob(),
    healthCheck: healthCheckCatracasJob(),
    syncAcessos: sincronizarAcessosJob(),
    monitorPolling: pollingMonitoramentoJob(),
    promocaoAlunos: promocaoAlunosJob()
  };
  if (jobs.monitorPolling) {
    logger.info(`[MONITOR] Polling de acessos a cada ${MONITOR_POLLING_INTERVAL_MS / 1000}s (tempo quase real)`);
  }
  if (jobs.promocaoAlunos) {
    logger.info(`[PROMOÇÃO] Verificação diária em: ${process.env.PROMOCAO_CRON || '10 8 * * *'} (PROMOCAO_CRON no .env)`);
  }
  return jobs;
};

// Parar todos os jobs
const pararJobs = (jobs) => {
  if (jobs.syncPendentes) jobs.syncPendentes.stop();
  if (jobs.healthCheck) clearInterval(jobs.healthCheck);
  if (jobs.syncAcessos) jobs.syncAcessos.stop();
  if (jobs.monitorPolling) clearInterval(jobs.monitorPolling);
  if (jobs.promocaoAlunos) jobs.promocaoAlunos.stop();
};

module.exports = {
  iniciarJobs,
  pararJobs,
  verificarSyncPendentesJob,
  healthCheckCatracasJob,
  sincronizarAcessosJob,
  pollingMonitoramentoJob,
  promocaoAlunosJob
};
