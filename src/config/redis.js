/**
 * Cliente Redis com fallback para LRU Cache em memória
 * Se Redis não estiver disponível, funciona com LRU local
 */

const logger = require('./logger');
const LRU = require('lru-cache').LRUCache;

let redisClient = null;
let isRedisEnabled = false;

// Tentar conectar com Redis (ioredis para melhor performance)
const initRedis = async () => {
  if (process.env.REDIS_ENABLED === 'false') {
    logger.info('Redis desativado (.env REDIS_ENABLED=false)');
    return false;
  }

  try {
    const Redis = require('ioredis');
    
    redisClient = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0'),
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      connectTimeout: 5000,
      maxRetriesPerRequest: 3
    });

    redisClient.on('connect', () => {
      logger.info('✓ Redis conectado');
      isRedisEnabled = true;
    });

    redisClient.on('error', (err) => {
      logger.warn(`⚠ Redis erro: ${err.message}. Usando LRU cache em memória.`);
      isRedisEnabled = false;
    });

    // Testar conexão
    await redisClient.ping();
    isRedisEnabled = true;
    return true;
  } catch (error) {
    logger.warn(`⚠ Redis não disponível: ${error.message}. Usando LRU cache em memória.`);
    isRedisEnabled = false;
    return false;
  }
};

// Fallback: LRU Cache em memória (máx 1000 itens, 1 hora de TTL padrão)
const lruCache = new LRU({
  max: 1000,
  maxSize: 50000000, // 50MB
  ttl: 1000 * 60 * 60 // 1 hora padrão
});

/**
 * Get value from cache
 */
async function get(key) {
  try {
    if (isRedisEnabled && redisClient) {
      const value = await redisClient.get(key);
      return value ? JSON.parse(value) : null;
    } else {
      return lruCache.get(key);
    }
  } catch (error) {
    logger.debug(`Cache GET error para ${key}: ${error.message}`);
    return null;
  }
}

/**
 * Set value in cache with TTL (in seconds)
 */
async function set(key, value, ttl = 300) {
  try {
    const jsonValue = JSON.stringify(value);
    
    if (isRedisEnabled && redisClient) {
      if (ttl) {
        await redisClient.setex(key, ttl, jsonValue);
      } else {
        await redisClient.set(key, jsonValue);
      }
    } else {
      // LRU com TTL em milissegundos
      lruCache.set(key, value, { ttl: ttl ? ttl * 1000 : undefined });
    }
    
    return true;
  } catch (error) {
    logger.debug(`Cache SET error para ${key}: ${error.message}`);
    return false;
  }
}

/**
 * Delete key from cache
 */
async function del(key) {
  try {
    if (isRedisEnabled && redisClient) {
      await redisClient.del(key);
    } else {
      lruCache.delete(key);
    }
    return true;
  } catch (error) {
    logger.debug(`Cache DEL error para ${key}: ${error.message}`);
    return false;
  }
}

/**
 * Delete multiple keys by pattern (Redis only, LRU não suporta)
 */
async function delPattern(pattern) {
  try {
    if (isRedisEnabled && redisClient) {
      const keys = await redisClient.keys(pattern);
      if (keys.length > 0) {
        await redisClient.del(...keys);
      }
      return keys.length;
    } else {
      // LRU: deletar manualmente fazendo scan
      let count = 0;
      const regex = new RegExp(pattern.replace('*', '.*'));
      for (const key of lruCache.keys()) {
        if (regex.test(key)) {
          lruCache.delete(key);
          count++;
        }
      }
      return count;
    }
  } catch (error) {
    logger.debug(`Cache DELPATTERN error para ${pattern}: ${error.message}`);
    return 0;
  }
}

/**
 * Get all cache stats
 */
function getStats() {
  if (isRedisEnabled && redisClient) {
    return {
      backend: 'Redis',
      enabled: true
    };
  } else {
    return {
      backend: 'LRU (in-memory)',
      enabled: true,
      size: lruCache.size,
      maxSize: 1000
    };
  }
}

/**
 * Clear entire cache
 */
async function flush() {
  try {
    if (isRedisEnabled && redisClient) {
      await redisClient.flushdb();
    } else {
      lruCache.clear();
    }
    logger.info('✓ Cache limpado');
    return true;
  } catch (error) {
    logger.error(`Erro ao limpar cache: ${error.message}`);
    return false;
  }
}

/**
 * Health check
 */
async function healthCheck() {
  if (isRedisEnabled && redisClient) {
    try {
      await redisClient.ping();
      return true;
    } catch {
      return false;
    }
  }
  return true; // LRU sempre está disponível
}

module.exports = {
  initRedis,
  get,
  set,
  del,
  delPattern,
  getStats,
  flush,
  healthCheck,
  isEnabled: () => isRedisEnabled,
  client: () => redisClient
};
