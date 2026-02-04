/**
 * Ordem correta de criação para manter foreign keys e dependências da API Control iD.
 * Usado por: importação catraca → SAGE, provisionamento SAGE → catraca, scripts de backup/restore.
 */

/** Ordem ao criar objetos NA CATRACA (SAGE → catraca). Quem não tem dependência vem primeiro. */
const ORDEM_CRIACAO_NA_CATRACA = [
  'time_zones',
  'time_spans',
  'areas',
  'groups',
  'access_rules',
  'access_rule_time_zones',
  'portals',
  'portal_access_rules',
  'group_access_rules',
  'users',
  'user_groups',
  'user_access_rules',
  'cards',
  'qrcodes',
  'user_roles'
];

/** Ordem ao importar da catraca para o SAGE (catraca → SAGE). Respeita FK do banco. */
const ORDEM_IMPORT_PARA_SAGE = [
  'UnidadeEscolar', // deve já existir
  'Area',           // areas (catraca) → Area (SAGE)
  'Dispositivo',    // já existe; opcional atualizar area_id
  'Pessoa',         // users (catraca) → Pessoa
  'Aluno',          // ou Funcionario, etc., conforme tipo
  'Acesso'          // preenchido pela sync de access_logs
];

/**
 * Ordem para APAGAR tudo na catraca (reverse dependency: filhos antes de pais).
 * Assim a catraca fica vazia e o SAGE pode recolocar só os dados do sistema.
 */
const ORDEM_ZERAR_CATRACA = [
  'user_groups',
  'user_access_rules',
  'group_access_rules',
  'portal_access_rules',
  'access_rule_time_zones',
  'scheduled_unlock_access_rules',
  'portal_actions',
  'cards',
  'qrcodes',
  'user_roles',
  'users',
  'portals',
  'group_access_rules',
  'access_rules',
  'time_spans',
  'time_zones',
  'groups',
  'areas',
  'access_logs'
];

module.exports = {
  ORDEM_CRIACAO_NA_CATRACA,
  ORDEM_IMPORT_PARA_SAGE,
  ORDEM_ZERAR_CATRACA
};
