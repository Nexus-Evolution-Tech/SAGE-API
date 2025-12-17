const cron = require('node-cron');
const logger = require('../config/logger');
const deviceService = require('../services/deviceService');
const db = require('../config/database');

// Job para verificar sincronizações pendentes
const verificarSyncPendentesJob = () => {
  const cronExpression = process.env.SYNC_CHECK_INTERVAL || '*/5 * * * *'; // A cada 5 minutos

  return cron.schedule(cronExpression, async () => {
        logger.info('Iniciando job de verificação de sincronizações pendentes');
        
        
    try {
      logger.info('Iniciando job de verificação de sincronizações pendentes');

      const pendentes = await global.db('sync_pendente')
        .select('*')
        .orderBy('data_tentativa', 'asc')
        .limit(parseInt(process.env.SYNC_BATCH_SIZE || '50'))
        .get();

      if (pendentes.length === 0) {
        logger.debug(' Nenhuma sincronização pendente');
        return;
      }

      logger.info(` ${pendentes.length} sincronizações pendentes encontradas`);

      // Checa conectividade das catracas envolvidas neste lote e evita repetir tentativa em catraca offline
      const offlineDevices = new Set();
      const dispositivosUnicos = [...new Set(pendentes.map(p => p.dispositivo_id).filter(Boolean))];
      for (const dispositivoId of dispositivosUnicos) {
        try {
          const dispositivo = await global.db('Dispositivo').where('id', dispositivoId).first();
          if (!dispositivo) continue;
          const isOnline = await deviceService.testarConexaoCatraca(dispositivo);
          if (!isOnline) {
            offlineDevices.add(dispositivoId);
            logger.warn(`Catraca ${dispositivo.nome || dispositivoId} offline, pulando pendentes deste dispositivo neste ciclo`);
          }
        } catch (err) {
          offlineDevices.add(dispositivoId);
          logger.warn(`Falha ao testar catraca ${dispositivoId}, marcando como offline neste ciclo: ${err.message}`);
        }
      }

      // Importação dinâmica para evitar dependência circular
      const controlIdService = require('../services/controlIdService');

      for (const registro of pendentes) {
        try {
          if (offlineDevices.has(registro.dispositivo_id)) {
            // incrementa tentativa e segue para próxima pessoa; evita flood em catraca offline
            await db.query(
              'UPDATE sync_pendente SET retry_count = retry_count + 1, last_attempt = ? WHERE id = ?',
              [new Date(), registro.id]
            );
            logger.warn(`Pendência ${registro.id} pulada (catraca offline: ${registro.dispositivo_id})`);
            continue;
          }

          const pessoa = await global.db('Pessoa')
            .where('id', registro.pessoa_id)
            .first();

          if (!pessoa) {
            logger.warn(` Pessoa ${registro.pessoa_id} não encontrada, removendo pendente`);
            await global.db('sync_pendente').where('id', registro.id).del();
            continue;
          }

          // Processar ação
          if (registro.action === 'CREATE') {
            await controlIdService.criarNovaPessoaNasCatracas(pessoa, { dispositivoId: registro.dispositivo_id });
            logger.info(` Pessoa ${pessoa.nome} criada (sync pendente)`);
          } else if (registro.action === 'UPDATE') {
            await controlIdService.editarPessoaNasCatracas(
              pessoa.id,
              pessoa.nome,
              pessoa.cartao_rfid,
              { dispositivoId: registro.dispositivo_id }
            );
            logger.info(` Pessoa ${pessoa.nome} atualizada (sync pendente)`);
          } else if (registro.action === 'DELETE') {
            await controlIdService.deletarPessoaDasCatracas(pessoa.id, { dispositivoId: registro.dispositivo_id });
            logger.info(` Pessoa ${pessoa.nome} deletada (sync pendente)`);
          }

          // Remover da tabela de pendentes
          await global.db('sync_pendente').where('id', registro.id).del();

        } catch (error) {
          logger.error(` Erro ao processar pendente ID ${registro.id}: ${error.message}`);
          
          // Atualizar contador de tentativas e data da última tentativa
          await db.query(
            'UPDATE sync_pendente SET retry_count = retry_count + 1, last_attempt = ?, error_message = ? WHERE id = ?',
            [new Date(), error.message?.slice(0, 255) || null, registro.id]
          );
        }
      }

      logger.info(' Job de sync pendentes concluído');
    } catch (error) {
      logger.errorWithStack(' Erro no job de sync pendentes', error);
    }
  }, {
    scheduled: true,
    timezone: 'America/Sao_Paulo'
  });
};

// Job para health check das catracas
const healthCheckCatracasJob = () => {
  const intervalMs = parseInt(process.env.HEALTH_CHECK_INTERVAL || '60000'); // 1 minuto
  
  return setInterval(async () => {
    try {
      const dispositivos = await listarTodos();
      
      const deviceService = require('../services/deviceService');
      
      for (const dispositivo of dispositivos) {
        try {
          const isOnline = await deviceService.testarConexaoCatraca(dispositivo);
          
          // Atualizar status no banco
          await global.db('Dispositivo')
            .where('id', dispositivo.id)
            .update({
              status: isOnline ? 'ONLINE' : 'OFFLINE',
              last_health_check: new Date()
            });

        } catch (error) {
          logger.debug(`Health check falhou para ${dispositivo.nome}: ${error.message}`);
        }
      }
    } catch (error) {
      logger.debug(`Erro no health check: ${error.message}`);
    }
  }, intervalMs);
};

// Job para sincronizar logs de acesso
const sincronizarAcessosJob = () => {
  const cronExpression = '*/10 * * * *'; // A cada 10 minutos

  return cron.schedule(cronExpression, async () => {
    try {
      logger.info('Iniciando sincronização automática de acessos');
      
      const accessService = require('../services/accessService');
      const resultados = await accessService.sincronizarTodosAcessos();
      
      const totalSync = resultados.reduce((acc, r) => acc + (r.acessosSincronizados || 0), 0);
      logger.info(` ${totalSync} acessos sincronizados`);
      
    } catch (error) {
      logger.errorWithStack(' Erro na sincronização de acessos', error);
    }
  }, {
    scheduled: true,
    timezone: 'America/Sao_Paulo'
  });
};

// Iniciar todos os jobs
const iniciarJobs = () => {
  logger.info(' Iniciando jobs agendados...');

  const jobs = {
    syncPendentes: verificarSyncPendentesJob(),
    healthCheck: healthCheckCatracasJob(),
    syncAcessos: sincronizarAcessosJob()
  };

  logger.info(' Todos os jobs iniciados com sucesso');
  
  return jobs;
};

// Parar todos os jobs
const pararJobs = (jobs) => {
  logger.info(' Parando jobs agendados...');
  
  if (jobs.syncPendentes) jobs.syncPendentes.stop();
  if (jobs.healthCheck) clearInterval(jobs.healthCheck);
  if (jobs.syncAcessos) jobs.syncAcessos.stop();
  
  logger.info(' Todos os jobs parados');
};

module.exports = {
  iniciarJobs,
  pararJobs,
  verificarSyncPendentesJob,
  healthCheckCatracasJob,
  sincronizarAcessosJob
};
