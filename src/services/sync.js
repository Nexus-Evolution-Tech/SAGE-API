const logger = require('../config/logger');
const { listarTodos } = require('./deviceService');
const verificarSyncPendentes = require('../utils/sync_catracas');

/**
 * Registra sync pendente para todos os dispositivos,
 * evitando duplicar por pessoa + dispositivo
 */
const registrarSyncPendente = async (pessoaId, operation) => {
  try {
    const dispositivos = await listarTodos();

    for (let i = 0; i < dispositivos.length; i++) {
      const dispositivo = dispositivos[i];

      await global.db('sync_pendente').insert({
        pessoa_id: pessoaId,
        dispositivo_id: dispositivo.id,
        operation,
        data_tentativa: new Date()
      });

      logger.debug(
        `Sync pendente registrado: pessoa ${pessoaId}, dispositivo ${dispositivo.id}, operation ${operation}`
      );
    }
  } catch (err) {
    logger.errorWithStack('Erro ao registrar sync pendente', err);
  }
};

// Inserção em lote na tabela sync_pendente (com IGNORE para evitar falhas por duplicidade)
// const registrarSyncPendentesEmLote = async (pessoaId, dispositivos, action, errorMsg = null) => {
//   try {
//     if (!Array.isArray(dispositivos) || dispositivos.length === 0) return;
//     const db = require('../config/database');

//     const now = new Date();
//     const columns = ['pessoa_id', 'dispositivo_id', 'operation', 'error_message', 'data_tentativa'];
//     const valuesTuples = dispositivos.map(d => [pessoaId, d.id, action, errorMsg, now]);

//     const placeholders = valuesTuples.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ');
//     const flatValues = valuesTuples.flat();

//     const sql = `INSERT IGNORE INTO sync_pendente (${columns.join(', ')}) VALUES ${placeholders}`;
//     await db.query(sql, flatValues);
//     logger.debug(` Sync pendente em lote: pessoa ${pessoaId}, dispositivos ${dispositivos.length}, action ${action}`);
//   } catch (err) {
//     logger.errorWithStack('Erro ao registrar sync pendentes em lote', err);
//   }
// };

// module.exports = {
//   registrarSyncPendente,
//   registrarSyncPendentesEmLote
// };
module.exports = registrarSyncPendente;