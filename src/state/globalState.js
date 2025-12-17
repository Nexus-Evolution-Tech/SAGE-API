/**
 * Estado Global da Aplicação
 * Mantém sincronizações, fila, status das catracas e estatísticas
 */

const logger = require('../config/logger');

class GlobalState {
  constructor() {
    this.state = {
      // Sincronizações em andamento
      syncInProgress: new Map(),

      // Fila de sincronizações pendentes
      syncQueue: [],

      // Status das catracas (cache atualizado)
      deviceStatus: new Map(),

      // Sessões ativas das catracas com timeout
      catracaSessions: new Map(),

      // Usuários conectados ao WebSocket
      connectedUsers: new Map(),

      // Estatísticas em tempo real
      stats: {
        acessos_hoje: 0,
        acessos_negados_hoje: 0,
        sincronizacoes_concluidas: 0,
        sincronizacoes_falhadas: 0,
        catracas_online: 0,
        catracas_offline: 0,
        pessoas_ativas: 0,
        uptime_inicio: new Date(),
      }
    };

    // Limpar sessões expiradas a cada 5 minutos
    this.startSessionCleanup();
  }

  // ==================== SINCRONIZAÇÕES ====================

  /**
   * Iniciar sincronização de um dispositivo
   */
  addSyncInProgress(dispositivoId, pessoasCount) {
    this.state.syncInProgress.set(dispositivoId, {
      started: new Date(),
      pessoasCount,
      processadas: 0
    });
    logger.info(`[STATE] Sincronização iniciada: dispositivo ${dispositivoId} (${pessoasCount} pessoas)`);
  }

  /**
   * Remover sincronização (concluída ou com erro)
   */
  removeSyncInProgress(dispositivoId) {
    const sync = this.state.syncInProgress.get(dispositivoId);
    if (sync) {
      const duracao = new Date() - sync.started;
      this.state.syncInProgress.delete(dispositivoId);
      logger.info(`[STATE] Sincronização concluída: dispositivo ${dispositivoId} (${duracao}ms)`);
    }
  }

  /**
   * Obter sincronizações em andamento
   */
  getSyncInProgress() {
    return Array.from(this.state.syncInProgress.entries()).map(([id, info]) => ({
      dispositivoId: id,
      ...info,
      duracao: new Date() - info.started
    }));
  }

  // ==================== FILA DE SINCRONIZAÇÃO ====================

  /**
   * Adicionar à fila de sincronização
   */
  addToQueue(pendingSync) {
    this.state.syncQueue.push({
      ...pendingSync,
      adicionado_em: new Date(),
      tentativas: 0
    });
    logger.info(`[STATE] Adicionado à fila: pessoa ${pendingSync.pessoa_id}, ação ${pendingSync.action}`);
  }

  /**
   * Remover de fila
   */
  removeFromQueue(syncId) {
    const index = this.state.syncQueue.findIndex(s => s.id === syncId);
    if (index !== -1) {
      this.state.syncQueue.splice(index, 1);
    }
  }

  /**
   * Obter fila de sincronizações
   */
  getQueue() {
    return this.state.syncQueue;
  }

  /**
   * Incrementar tentativas de um item da fila
   */
  incrementQueueRetries(syncId) {
    const item = this.state.syncQueue.find(s => s.id === syncId);
    if (item) {
      item.tentativas++;
      item.ultima_tentativa = new Date();
    }
  }

  // ==================== STATUS DAS CATRACAS ====================

  /**
   * Atualizar status de uma catraca
   */
  setDeviceStatus(dispositivoId, status, lastCheck = null) {
    this.state.deviceStatus.set(dispositivoId, {
      status, // 'ONLINE', 'OFFLINE', 'ERROR'
      lastCheck: lastCheck || new Date(),
      lastError: null
    });

    // Atualizar contadores
    const online = Array.from(this.state.deviceStatus.values()).filter(d => d.status === 'ONLINE').length;
    const offline = Array.from(this.state.deviceStatus.values()).filter(d => d.status === 'OFFLINE').length;
    this.state.stats.catracas_online = online;
    this.state.stats.catracas_offline = offline;

    logger.debug(`[STATE] Dispositivo ${dispositivoId}: ${status}`);
  }

  /**
   * Obter status de uma catraca
   */
  getDeviceStatus(dispositivoId) {
    return this.state.deviceStatus.get(dispositivoId);
  }

  /**
   * Obter todas as catracas
   */
  getAllDeviceStatuses() {
    return Array.from(this.state.deviceStatus.entries()).map(([id, info]) => ({
      dispositivoId: id,
      ...info
    }));
  }

  // ==================== SESSÕES DAS CATRACAS ====================

  /**
   * Salvar sessão de catraca com timeout
   */
  setCatracaSession(dispositivoId, sessionId, expiresIn = 1800) {
    this.state.catracaSessions.set(dispositivoId, {
      sessionId,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + expiresIn * 1000)
    });
    logger.debug(`[STATE] Sessão catraca ${dispositivoId} salva (expires em ${expiresIn}s)`);
  }

  /**
   * Obter sessão de catraca
   */
  getCatracaSession(dispositivoId) {
    const session = this.state.catracaSessions.get(dispositivoId);
    
    if (!session) return null;
    
    // Verificar se expirou
    if (new Date() > session.expiresAt) {
      this.state.catracaSessions.delete(dispositivoId);
      return null;
    }

    return session.sessionId;
  }

  /**
   * Limpar sessão expirada manualmente
   */
  removeCatracaSession(dispositivoId) {
    this.state.catracaSessions.delete(dispositivoId);
  }

  // ==================== USUÁRIOS CONECTADOS ====================

  /**
   * Registrar usuário conectado via WebSocket
   */
  addConnectedUser(userId, socketId) {
    this.state.connectedUsers.set(userId, {
      socketId,
      connectedAt: new Date(),
      lastActivity: new Date()
    });
  }

  /**
   * Remover usuário desconectado
   */
  removeConnectedUser(userId) {
    this.state.connectedUsers.delete(userId);
  }

  /**
   * Obter usuários conectados
   */
  getConnectedUsers() {
    return Array.from(this.state.connectedUsers.entries()).map(([id, info]) => ({
      userId: id,
      ...info
    }));
  }

  // ==================== ESTATÍSTICAS ====================

  /**
   * Incrementar acesso bem-sucedido
   */
  incrementAcessoTodiaSuccesso() {
    this.state.stats.acessos_hoje++;
  }

  /**
   * Incrementar acesso negado
   */
  incrementAcessoTodayNegado() {
    this.state.stats.acessos_negados_hoje++;
  }

  /**
   * Incrementar sincronização concluída
   */
  incrementSincronizacaoConcluida() {
    this.state.stats.sincronizacoes_concluidas++;
  }

  /**
   * Incrementar sincronização falhada
   */
  incrementSincronizacaoFalhada() {
    this.state.stats.sincronizacoes_falhadas++;
  }

  /**
   * Obter estatísticas
   */
  getStats() {
    const uptime = new Date() - this.state.stats.uptime_inicio;
    return {
      ...this.state.stats,
      uptime,
      usuariosConectados: this.state.connectedUsers.size,
      filaSincronizacao: this.state.syncQueue.length,
      sincronizacoesEmAndamento: this.state.syncInProgress.size
    };
  }

  /**
   * Resetar estatísticas diárias (call a meia-noite)
   */
  resetDailyStats() {
    this.state.stats.acessos_hoje = 0;
    this.state.stats.acessos_negados_hoje = 0;
    this.state.stats.sincronizacoes_concluidas = 0;
    this.state.stats.sincronizacoes_falhadas = 0;
    logger.info('[STATE] Estatísticas diárias resetadas');
  }

  // ==================== LIMPEZA ====================

  /**
   * Limpar sessões expiradas periodicamente
   */
  startSessionCleanup() {
    setInterval(() => {
      let removed = 0;
      for (const [dispositivoId, session] of this.state.catracaSessions) {
        if (new Date() > session.expiresAt) {
          this.state.catracaSessions.delete(dispositivoId);
          removed++;
        }
      }
      if (removed > 0) {
        logger.debug(`[STATE] ${removed} sessões de catraca expiradas removidas`);
      }
    }, 5 * 60 * 1000); // A cada 5 minutos
  }

  /**
   * Resetar estado (para testes)
   */
  reset() {
    this.state.syncInProgress.clear();
    this.state.syncQueue = [];
    this.state.deviceStatus.clear();
    this.state.catracaSessions.clear();
    this.state.connectedUsers.clear();
    logger.info('[STATE] Estado resetado');
  }

  /**
   * Obter snapshot completo do estado
   */
  getSnapshot() {
    return {
      syncInProgress: this.getSyncInProgress(),
      syncQueue: this.getQueue(),
      deviceStatuses: this.getAllDeviceStatuses(),
      connectedUsers: this.getConnectedUsers(),
      stats: this.getStats()
    };
  }
}

// Singleton
module.exports = new GlobalState();
