const db = require('../config/database');
const { listarTodos } = require('./deviceService');
const logger = require('../config/logger');

const registrarSyncPendente = async (pessoaId, operation, connection) => {
  try {
    const consultar = connection ? connection.query.bind(connection) : db.execute.bind(db);
    const dispositivos = connection
      ? (await connection.query('SELECT * FROM Dispositivo'))[0]
      : await listarTodos();

    // Busca todos os CREATEs e UPDATEs pendentes da pessoa
    const [pendentes] = await consultar(
      `SELECT id, dispositivo_id, operation FROM sync_pendente WHERE pessoa_id = ? AND operation IN ('CREATE', 'UPDATE')`,
      [pessoaId]
    );

    // Mapas para fácil lookup
    const mapCreate = new Map();
    const mapUpdate = new Map();
    for (const r of pendentes) {
      if (r.operation === 'CREATE') mapCreate.set(r.dispositivo_id, r.id);
      if (r.operation === 'UPDATE') mapUpdate.set(r.dispositivo_id, r.id);
    }

    for (let dispositivo of dispositivos) {
      // Pula dispositivos com sincronização desativada
      if (dispositivo.sync_enabled === false || dispositivo.sync_enabled === 0) {
        logger.debug(`Sync desativado para dispositivo ${dispositivo.id} (${dispositivo.nome}), ignorando operação ${operation}`);
        continue;
      }
      if (!pessoaId || !dispositivo?.id) {
        logger.error(`IDs inválidos: pessoaId=${pessoaId}, dispositivoId=${dispositivo?.id}`);
        continue;
      }

      const dispositivoId = dispositivo.id;

      if (operation === 'DELETE') {
        // 1️⃣ Remove CREATE pendente, não insere DELETE
        if (mapCreate.has(dispositivoId)) {
          const createId = mapCreate.get(dispositivoId);
          await consultar(`DELETE FROM sync_pendente WHERE id = ?`, [createId]);
          logger.debug(`Removido CREATE pendente do dispositivo ${dispositivoId}, DELETE não inserido`);
          continue;
        }

        // 2️⃣ Remove UPDATE pendente, insere DELETE
        if (mapUpdate.has(dispositivoId)) {
          const updateId = mapUpdate.get(dispositivoId);
          await consultar(`DELETE FROM sync_pendente WHERE id = ?`, [updateId]);
          logger.debug(`Removido UPDATE pendente do dispositivo ${dispositivoId}`);
        }

        // 3️⃣ Insere DELETE (mesmo que não houvesse CREATE/UPDATE, significa que já sincronizou antes)
        await consultar(
          `INSERT INTO sync_pendente (pessoa_id, dispositivo_id, operation, data_tentativa)
           VALUES (?, ?, 'DELETE', ?)`,
          [pessoaId, dispositivoId, new Date()]
        );
        logger.debug(`Sync DELETE registrado: pessoa ${pessoaId}, dispositivo ${dispositivoId}`);
        continue;
      }

      // --- Para CREATE ou UPDATE --- (mesma lógica anterior)
      // Se já tem CREATE pendente nesse dispositivo, ignora UPDATE
      if (mapCreate.has(dispositivoId) && operation === 'UPDATE') {
        logger.debug(`Ignorando UPDATE para dispositivo ${dispositivoId} porque já existe CREATE`);
        continue;
      }

      // Se já existe UPDATE para esse dispositivo, ignora duplicado
      if (mapUpdate.has(dispositivoId) && operation === 'UPDATE') {
        logger.debug(`Ignorando UPDATE duplicado para dispositivo ${dispositivoId}`);
        continue;
      }

      // Insere CREATE ou UPDATE
      await consultar(
        `INSERT INTO sync_pendente (pessoa_id, dispositivo_id, operation, data_tentativa)
         VALUES (?, ?, ?, ?)`,
        [pessoaId, dispositivoId, operation, new Date()]
      );

      logger.debug(
        `Sync pendente registrado: pessoa ${pessoaId}, dispositivo ${dispositivoId}, operation ${operation}`
      );
    }
  } catch (err) {
    logger.errorWithStack('Erro ao registrar sync pendente', err);
    throw err;
  }
};

module.exports = registrarSyncPendente;
