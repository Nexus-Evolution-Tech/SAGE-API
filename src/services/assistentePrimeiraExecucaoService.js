const db = require('../config/database');
const logger = require('../config/logger');
const PASSOS = Object.freeze(['escola-conta-administrador', 'area', 'catraca', 'curso', 'turma', 'empresa', 'sala', 'pessoas']);
const VALORES_PASSOS = Object.freeze(['ESCOLA_CONTA_ADMINISTRADOR', 'AREA', 'CATRACA', 'CURSO', 'TURMA', 'EMPRESA', 'SALA', 'PESSOAS']);
const STATUS_VALIDOS = new Set(['NAO_INICIADO', 'EM_ANDAMENTO', 'PARCIAL', 'BLOQUEADO', 'PRONTO_LOGICO', 'CONCLUIDO']);
const COLUNAS = 'id, status, current_step, completed_steps, version';
class ErroOnboarding extends Error {
  constructor(code) { super(code); this.name = 'ErroOnboarding'; this.code = code; }
}
const erro = (code) => new ErroOnboarding(code);
function indiceDoPasso(step) {
  const index = PASSOS.indexOf(step);
  if (index < 0) throw erro('ONBOARDING_PASSO_INVALIDO');
  return index;
}
function passosConcluidos(valor) {
  let passos = valor;
  if (typeof passos === 'string') {
    try { passos = JSON.parse(passos); }
    catch { logger.error('[ONBOARDING] codigo=ESTADO_JSON_INVALIDO'); throw erro('ONBOARDING_ESTADO_INVALIDO'); }
  }
  if (!Array.isArray(passos) || passos.some((passo) => !VALORES_PASSOS.includes(passo)) || new Set(passos).size !== passos.length) throw erro('ONBOARDING_ESTADO_INVALIDO');
  return VALORES_PASSOS.filter((passo) => passos.includes(passo));
}
function projetar(row) {
  const completed = passosConcluidos(row.completed_steps);
  const version = Number(row.version);
  if ((row.current_step !== null && !VALORES_PASSOS.includes(row.current_step)) || !STATUS_VALIDOS.has(row.status) || !Number.isSafeInteger(version) || version < 0) throw erro('ONBOARDING_ESTADO_INVALIDO');
  const nextIndex = VALORES_PASSOS.findIndex((passo) => !completed.includes(passo));
  return { status: row.status, current_step: row.current_step, completed_steps: completed, next_step: nextIndex < 0 ? null : VALORES_PASSOS[nextIndex], version };
}
async function obterEstado() {
  try {
    const [rows] = await db.query(`SELECT ${COLUNAS} FROM onboarding_state WHERE id = 1`);
    return rows.length ? projetar(rows[0]) : { status: 'NAO_INICIADO', current_step: null, completed_steps: [], next_step: 'ESCOLA_CONTA_ADMINISTRADOR', version: 0 };
  } catch (error) {
    logger.error('[ONBOARDING] codigo=LEITURA_FALHOU');
    throw erro('ONBOARDING_ESTADO_INDISPONIVEL');
  }
}
async function retomarPasso(step, expectedVersion) {
  const index = indiceDoPasso(step);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw erro('ONBOARDING_IF_MATCH_INVALIDO');
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [rows] = await connection.query(`SELECT ${COLUNAS} FROM onboarding_state WHERE id = 1 FOR UPDATE`);
    if (rows.length === 0) {
      if (expectedVersion !== 0) throw erro('ONBOARDING_VERSION_OBSOLETA');
      if (index !== 0) throw erro('ONBOARDING_PRE_CONDICAO_AUSENTE');
      const row = { id: 1, status: 'EM_ANDAMENTO', current_step: VALORES_PASSOS[0], completed_steps: [], version: 1 };
      try {
        await connection.query(`INSERT INTO onboarding_state (id, status, current_step, completed_steps, version) VALUES (?, ?, ?, ?, ?)`, [1, row.status, row.current_step, '[]', 1]);
      } catch (error) {
        // Duas primeiras retomadas podem observar a ausência da linha antes de qualquer commit.
        // A colisão da chave significa que esta versão já foi consumida pela outra requisição.
        if (error.code === 'ER_DUP_ENTRY') throw erro('ONBOARDING_VERSION_OBSOLETA');
        throw error;
      }
      await connection.commit();
      return projetar(row);
    }
    const row = rows[0];
    const projection = projetar(row);
    if (projection.version !== expectedVersion) throw erro('ONBOARDING_VERSION_OBSOLETA');
    const value = VALORES_PASSOS[index];
    if (projection.completed_steps.includes(value)) { await connection.commit(); return projection; }
    const nextIndex = VALORES_PASSOS.findIndex((passo) => !projection.completed_steps.includes(passo));
    if (row.current_step === value && index === nextIndex) { await connection.commit(); return projection; }
    if (row.current_step === value) throw erro('ONBOARDING_PRE_CONDICAO_AUSENTE');
    if (index !== nextIndex) throw erro('ONBOARDING_PASSO_FORA_DE_ORDEM');
    const [result] = await connection.query(`UPDATE onboarding_state SET status = 'EM_ANDAMENTO', current_step = ?, version = version + 1 WHERE id = 1 AND version = ?`, [value, expectedVersion]);
    if (result.affectedRows !== 1) throw erro('ONBOARDING_CONCORRENCIA');
    row.status = 'EM_ANDAMENTO'; row.current_step = value; row.version = expectedVersion + 1;
    await connection.commit();
    return projetar(row);
  } catch (error) {
    if (connection) await connection.rollback().catch(() => logger.error('[ONBOARDING] codigo=ROLLBACK_FALHOU'));
    const conhecido = error instanceof ErroOnboarding;
    logger.error(`[ONBOARDING] codigo=${conhecido ? error.code : 'TRANSICAO_FALHOU'}`, { operacao: 'retomar', passo: step });
    if (conhecido) throw error;
    if (error.code === 'ER_DUP_ENTRY' || error.code === 'ER_LOCK_DEADLOCK') throw erro('ONBOARDING_VERSION_OBSOLETA');
    throw erro('ONBOARDING_ESTADO_INDISPONIVEL');
  } finally { if (connection) connection.release(); }
}
module.exports = { ErroOnboarding, PASSOS, obterEstado, retomarPasso };
