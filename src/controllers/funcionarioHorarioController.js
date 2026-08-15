/**
 * Horário fixo de entrada/saída por dia da semana (Administrador, Terceirizado, Professor+Admin)
 */
const db = require('../config/database');
const logger = require('../config/logger');
const { ACOES, executarOperacaoAuditada, validarAutor } = require('../services/auditoriaService');
const { responderErroInterno } = require('../utils/responderErroInterno');

const DIAS_SEMANA = ['SEGUNDA', 'TERCA', 'QUARTA', 'QUINTA', 'SEXTA', 'SABADO'];

function toHoraSql(val) {
  if (!val) return null;
  const s = String(val).trim();
  if (/^\d{1,2}:\d{2}$/.test(s)) return s + ':00';
  if (/^\d{1,2}:\d{2}:\d{2}$/.test(s)) return s;
  return null;
}

/** GET /funcionarios/:id/horario - lista horários do funcionário */
async function listar(req, res) {
  try {
    const funcionarioId = Number(req.params.id);
    if (!funcionarioId || isNaN(funcionarioId)) {
      return res.status(400).json({ message: 'ID inválido' });
    }

    const [rows] = await db.query(
      `SELECT id, funcionario_id, dia_semana, hora_entrada, hora_saida
       FROM FuncionarioHorario
       WHERE funcionario_id = ?
       ORDER BY FIELD(dia_semana, 'SEGUNDA', 'TERCA', 'QUARTA', 'QUINTA', 'SEXTA', 'SABADO')`,
      [funcionarioId]
    );

    const horarios = (rows || []).map((r) => ({
      id: r.id,
      dia_semana: r.dia_semana,
      hora_entrada: r.hora_entrada ? String(r.hora_entrada).slice(0, 5) : null,
      hora_saida: r.hora_saida ? String(r.hora_saida).slice(0, 5) : null,
    }));

    let usar_horario_fixo = false;
    try {
      const [prof] = await db.query('SELECT usar_horario_fixo FROM Professor WHERE id = ?', [funcionarioId]);
      usar_horario_fixo = !!(prof && prof[0] && prof[0].usar_horario_fixo);
    } catch (e) { logger.debug('[FUNCIONARIO-HORARIO] codigo=CAMPO_HORARIO_FIXO_INDISPONIVEL'); }

    res.json({ horarios, usar_horario_fixo });
  } catch (err) {
    logger.error('[FuncionarioHorario] listar:', err.message);
    responderErroInterno(res, err, 'Erro ao listar horários');
  }
}

/** PUT /funcionarios/:id/horario - substitui todos os horários do funcionário */
async function salvar(req, res) {
  try {
    validarAutor(req?.user?.usuario_id);
    const funcionarioId = Number(req.params.id);
    const { horarios = [], usar_horario_fixo } = req.body || {};

    if (!funcionarioId || isNaN(funcionarioId)) {
      return res.status(400).json({ message: 'ID inválido' });
    }

    const [func] = await db.query('SELECT id FROM Funcionario WHERE id = ?', [funcionarioId]);
    if (!func || !func[0]) {
      return res.status(404).json({ message: 'Funcionário não encontrado' });
    }

    const resposta = await executarOperacaoAuditada({
      req, acao: ACOES.REGISTRO_EDITADO, entidade: 'FuncionarioHorario', entidadeId: funcionarioId,
      operacao: async (connection) => {
        await connection.query('DELETE FROM FuncionarioHorario WHERE funcionario_id = ?', [funcionarioId]);

    for (const h of horarios) {
      const dia = (h.dia_semana || '').toUpperCase();
      if (!DIAS_SEMANA.includes(dia)) continue;

      const entrada = toHoraSql(h.hora_entrada);
      const saida = toHoraSql(h.hora_saida);
      if (!entrada || !saida) continue;

      await connection.query(
        `INSERT INTO FuncionarioHorario (funcionario_id, dia_semana, hora_entrada, hora_saida)
         VALUES (?, ?, ?, ?)`,
        [funcionarioId, dia, entrada, saida]
      );
    }

    try {
      const [prof] = await connection.query('SELECT id FROM Professor WHERE id = ?', [funcionarioId]);
      if (prof && prof[0]) {
        await connection.query('UPDATE Professor SET usar_horario_fixo = ? WHERE id = ?', [!!usar_horario_fixo, funcionarioId]);
      }
    } catch (e) {
      if (!e.message || !e.message.includes('usar_horario_fixo')) throw e;
    }

    const [rows] = await connection.query(
      'SELECT id, dia_semana, hora_entrada, hora_saida FROM FuncionarioHorario WHERE funcionario_id = ?',
      [funcionarioId]
    );

    return {
      message: 'Horários salvos com sucesso',
      horarios: (rows || []).map((r) => ({
        id: r.id,
        dia_semana: r.dia_semana,
        hora_entrada: r.hora_entrada ? String(r.hora_entrada).slice(0, 5) : null,
        hora_saida: r.hora_saida ? String(r.hora_saida).slice(0, 5) : null,
      })),
      usar_horario_fixo: !!usar_horario_fixo,
    };
      }
    });
    res.json(resposta);
  } catch (err) {
    logger.error('[FuncionarioHorario] salvar:', err.message);
    responderErroInterno(res, err, 'Erro ao salvar horários');
  }
}

module.exports = { listar, salvar };
