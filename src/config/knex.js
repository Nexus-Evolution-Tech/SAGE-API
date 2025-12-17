/**
 * ⚠️ ARQUIVO DESCONTINUADO
 * 
 * Este arquivo foi substituído por:
 * - src/config/database.js      (pool de conexões MySQL2)
 * - src/config/queryBuilder.js  (query builder compatível)
 * 
 * PROBLEMAS DO CÓDIGO LEGADO:
 * ❌ Stub retorna dados FAKE nos primeiros segundos
 * ❌ Race conditions críticas
 * ❌ Lazy loading anti-padrão
 * ❌ Sem validação adequada de pool
 * ❌ Múltiplas exportações (linha 90-92)
 * 
 * O arquivo agora joga erro para forçar migração
 */

const logger = require('./logger');

logger.error('❌ knex.js foi descontinuado');
logger.error('Use src/config/database.js + src/config/queryBuilder.js');

throw new Error(
  'Erro: knex.js descontinuado. Veja docs/MIGRATION_KNEX_TO_MYSQL2.md'
);
