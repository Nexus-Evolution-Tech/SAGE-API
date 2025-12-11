// sync_catracas.js
// Mantido para compatibilidade retroativa
// Delega para syncService

const { verificarSyncPendentes: verificarSyncPendentesImpl, sincronizarTodasPessoasNasCatracas: sincronizarTodasImpl } = require('../services/syncService');

async function sincronizarTodasPessoasNasCatracas() {
  return await sincronizarTodasImpl();
}

async function verificarSyncPendentes(dispositivo) {
  return await verificarSyncPendentesImpl(dispositivo);
}

module.exports = {
  sincronizarTodasPessoasNasCatracas,
  verificarSyncPendentes
};
