/**
 * Cache Helpers
 * Wrapper automático para queries com invalidação
 */

const cache = require('../config/redis');
const { CACHE_KEYS, CACHE_TTL } = require('./cacheKeys');
const logger = require('../config/logger');

/**
 * Buscar com cache automático
 * Se cache miss, executa query e salva resultado
 */
async function getOrFetch(cacheKey, queryFn, ttl = CACHE_TTL.LONG) {
  try {
    // Tentar buscar do cache
    const cached = await cache.get(cacheKey);
    if (cached) {
      logger.debug(`[CACHE HIT] ${cacheKey}`);
      return cached;
    }

    // Cache miss - executar query
    logger.debug(`[CACHE MISS] ${cacheKey}`);
    const result = await queryFn();

    // Salvar no cache
    if (result) {
      await cache.set(cacheKey, result, ttl);
    }

    return result;
  } catch (error) {
    logger.error(`[CACHE ERROR] ${cacheKey}: ${error.message}`);
    // Não falhar por causa do cache, tentar query direto
    return await queryFn();
  }
}

/**
 * Invalidar chave específica ou padrão
 */
async function invalidate(pattern) {
  try {
    const deleted = await cache.delPattern(pattern);
    logger.info(`[CACHE INVALIDATE] Padrão '${pattern}' - ${deleted} chaves deletadas`);
    return deleted;
  } catch (error) {
    logger.error(`[CACHE ERROR] Erro ao invalidar ${pattern}: ${error.message}`);
  }
}

/**
 * Invalidar múltiplos padrões
 */
async function invalidateMultiple(patterns) {
  let totalDeleted = 0;
  for (const pattern of patterns) {
    const deleted = await invalidate(pattern);
    totalDeleted += deleted;
  }
  return totalDeleted;
}

/**
 * Limpar cache inteiro
 */
async function clearAll() {
  try {
    await cache.flush();
    logger.info('[CACHE] Cache inteiro limpo');
  } catch (error) {
    logger.error(`[CACHE ERROR] Erro ao limpar cache: ${error.message}`);
  }
}

/**
 * Wrapper para operações de leitura com cache
 * Uso: const pessoa = await cacheQuery(CACHE_KEYS.PESSOA(id), () => db.query(...))
 */
async function cacheQuery(cacheKey, queryFn, ttl = CACHE_TTL.LONG) {
  return getOrFetch(cacheKey, queryFn, ttl);
}

/**
 * Wrapper para operações de escrita com invalidação
 * Uso: await cacheMutation(() => db.insert(...), [CACHE_KEYS.INVALIDATE_PESSOAS])
 */
async function cacheMutation(mutationFn, invalidatePatterns = []) {
  try {
    // Executar mutação
    const result = await mutationFn();

    // Invalidar caches afetados
    if (invalidatePatterns.length > 0) {
      await invalidateMultiple(invalidatePatterns);
    }

    return result;
  } catch (error) {
    logger.error(`[CACHE MUTATION ERROR] ${error.message}`);
    throw error;
  }
}

module.exports = {
  getOrFetch,
  cacheQuery,
  cacheMutation,
  invalidate,
  invalidateMultiple,
  clearAll,
  CACHE_KEYS,
  CACHE_TTL
};
