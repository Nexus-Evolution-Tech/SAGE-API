/**
 * Controller de relatórios de acesso e presença.
 * Consome Presenca, Acesso (fallback), Pessoa, Aluno, Turma, HorarioAula.
 * Quando Presenca está vazio, usa primeira ENTRADA de Acesso para calcular presença/atraso.
 */

const db = require('../config/database');
const logger = require('../config/logger');

const TOLERANCIA_ATRASO_MINUTOS = 15;

const DIAS_SEMANA = ['DOMINGO', 'SEGUNDA', 'TERCA', 'QUARTA', 'QUINTA', 'SEXTA', 'SABADO'];
// HorarioAula no banco usa 'TERÇA'; Presenca usa 'TERCA'
const DIA_PARA_HORARIO_AULA = { ...Object.fromEntries(DIAS_SEMANA.map(d => [d, d])), TERCA: 'TERÇA' };

function getDiaSemana(date) {
  const d = new Date(date);
  return DIAS_SEMANA[d.getDay()];
}

/** Dia da semana no fuso de São Paulo (para a "data" em que o usuário está). */
function getDiaSemanaBrasil(date) {
  const dataStr = formatDataBrasil(date);
  const noonBrasil = new Date(dataStr + 'T12:00:00-03:00');
  return DIAS_SEMANA[noonBrasil.getDay()];
}

function getDiaSemanaHorarioAula(date) {
  return DIA_PARA_HORARIO_AULA[getDiaSemanaBrasil(date)] || getDiaSemanaBrasil(date);
}

/**
 * Retorna "hoje" no fuso de São Paulo (mesmo dia que o usuário vê no filtro "Hoje").
 */
function getHojeBrasil() {
  const str = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const [y, m, d] = str.split('-').map(Number);
  const hoje = new Date(y, m - 1, d);
  hoje.setHours(0, 0, 0, 0);
  return hoje;
}

/**
 * Retorna intervalo de datas [inicio, fim] (objetos Date) conforme periodo e filtros.
 */
function getIntervaloDatas(periodo, data_inicio, data_fim) {
  const hoje = getHojeBrasil();

  if (periodo === 'TODAY') {
    return [hoje, new Date(hoje.getTime())];
  }
  if (periodo === 'WEEK') {
    const inicio = new Date(hoje);
    inicio.setDate(inicio.getDate() - 6);
    return [inicio, new Date(hoje.getTime())];
  }
  if (periodo === 'MONTH') {
    const inicio = new Date(hoje);
    inicio.setDate(inicio.getDate() - 29);
    return [inicio, new Date(hoje.getTime())];
  }
  if (periodo === 'CUSTOM' && data_inicio && data_fim) {
    const inicio = new Date(data_inicio);
    const fim = new Date(data_fim);
    inicio.setHours(0, 0, 0, 0);
    fim.setHours(23, 59, 59, 999);
    return [inicio, fim];
  }
  return [hoje, new Date(hoje.getTime())];
}

function iterarDatas(inicio, fim, fn) {
  const list = [];
  const cur = new Date(inicio);
  cur.setHours(0, 0, 0, 0);
  const end = new Date(fim);
  end.setHours(0, 0, 0, 0);
  while (cur <= end) {
    list.push(fn(new Date(cur)));
    cur.setDate(cur.getDate() + 1);
  }
  return list;
}

/** Retorna YYYY-MM-DD no fuso de São Paulo para um Date. */
function formatDataBrasil(date) {
  return new Date(date.getTime()).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

/**
 * GET /relatorios/turmas -> [{ id, nome }]
 */
async function turmas(req, res) {
  try {
    const [rows] = await db.query(
      'SELECT id, nome FROM Turma WHERE nome IS NOT NULL ORDER BY nome'
    );
    res.json(Array.isArray(rows) ? rows : []);
  } catch (err) {
    logger.error('[RELATORIO] turmas:', err.message);
    res.status(500).json({ message: 'Erro ao listar turmas', error: err.message });
  }
}

/**
 * Retorna lista de pessoa_id esperados no dia (têm aula nesse dia).
 * grupo: ALUNOS | FUNCIONARIOS
 * turma_id: número ou 'TODOS'
 * funcionario_tipo: TODOS | PROFESSOR | ADMINISTRADOR | TERCEIRIZADO (só professores têm aula no HorarioAula)
 */
async function getEsperadosNoDia(dataStr, diaSemana, diaSemanaHA, grupo, turma_id, funcionario_tipo) {
  if (grupo === 'ALUNOS') {
    try {
      let sql = `
        SELECT DISTINCT a.id AS pessoa_id
        FROM Aluno a
        INNER JOIN Pessoa p ON p.id = a.id
        INNER JOIN HorarioAula ha ON ha.turma_id = a.turma_id AND ha.dia_semana = ?
        WHERE p.tipo = 'ALUNO' AND p.visivel = 1
      `;
      const params = [diaSemanaHA];
      if (turma_id && turma_id !== 'TODOS') {
        sql += ' AND a.turma_id = ?';
        params.push(Number(turma_id));
      }
      const [rows] = await db.query(sql, params);
      if (rows.length > 0) return rows.map(r => r.pessoa_id);
    } catch (e) {
      logger.debug('[RELATORIO] getEsperadosNoDia HorarioAula falhou, usando fallback Alunos:', e.message);
    }
    const [fallback] = await db.query(
      `SELECT a.id AS pessoa_id FROM Aluno a INNER JOIN Pessoa p ON p.id = a.id
       WHERE p.tipo = 'ALUNO' AND p.visivel = 1 AND a.turma_id IS NOT NULL
       ${turma_id && turma_id !== 'TODOS' ? ' AND a.turma_id = ?' : ''}`,
      turma_id && turma_id !== 'TODOS' ? [Number(turma_id)] : []
    );
    return (fallback || []).map(r => r.pessoa_id);
  }

  if (grupo === 'FUNCIONARIOS') {
    if (funcionario_tipo === 'ADMINISTRADOR') {
      const [rows] = await db.query(
        'SELECT ad.id AS pessoa_id FROM Administrador ad INNER JOIN Pessoa p ON p.id = ad.id WHERE p.visivel = 1'
      );
      return (rows || []).map(r => r.pessoa_id);
    }
    if (funcionario_tipo === 'TERCEIRIZADO') {
      const [rows] = await db.query(
        'SELECT t.id AS pessoa_id FROM Terceirizado t INNER JOIN Pessoa p ON p.id = t.id WHERE p.visivel = 1'
      );
      return (rows || []).map(r => r.pessoa_id);
    }
    if (funcionario_tipo === 'PROFESSOR' || funcionario_tipo === 'TODOS') {
      let professores = [];
      try {
        const sql = `
          SELECT DISTINCT pr.id AS pessoa_id
          FROM Professor pr
          INNER JOIN Aula a ON a.professor_id = pr.id
          INNER JOIN HorarioAula ha ON ha.aula_id = a.id AND ha.dia_semana = ?
          INNER JOIN Pessoa p ON p.id = pr.id AND p.visivel = 1
        `;
        const [rows] = await db.query(sql, [diaSemanaHA]);
        professores = (rows || []).map(r => r.pessoa_id);
      } catch (e) {
        logger.debug('[RELATORIO] getEsperadosNoDia HorarioAula prof falhou:', e.message);
      }
      if (professores.length === 0) {
        const [fallback] = await db.query(
          'SELECT pr.id AS pessoa_id FROM Professor pr INNER JOIN Pessoa p ON p.id = pr.id WHERE p.visivel = 1'
        );
        professores = (fallback || []).map(r => r.pessoa_id);
      }
      if (funcionario_tipo === 'PROFESSOR') return professores;
      const [admRows] = await db.query('SELECT ad.id AS pessoa_id FROM Administrador ad INNER JOIN Pessoa p ON p.id = ad.id WHERE p.visivel = 1');
      const [tercRows] = await db.query('SELECT t.id AS pessoa_id FROM Terceirizado t INNER JOIN Pessoa p ON p.id = t.id WHERE p.visivel = 1');
      const admIds = (admRows || []).map(r => r.pessoa_id);
      const tercIds = (tercRows || []).map(r => r.pessoa_id);
      return [...new Set([...professores, ...admIds, ...tercIds])];
    }
  }

  return [];
}

/**
 * Para um dia, retorna mapa slot (ex: "07:30") -> lista de pessoa_id esperados naquele slot (primeira aula do dia).
 * Suporta HorarioAula com coluna horario (VARCHAR "07:30-08:20") ou inicio (TIME) quando horario não existe.
 */
async function getEsperadosPorSlot(dataStr, diaSemanaHA, grupo, turma_id, funcionario_tipo) {
  const slotToPessoas = {};
  const parseSlot = (r) => {
    const s = (r.primeiro_horario || '').toString().trim();
    return s.length >= 4 ? s.slice(0, 5) : null;
  };

  const runAlunos = async (sql, params) => {
    const [rows] = await db.query(sql, params);
    for (const r of rows) {
      const slot = parseSlot(r);
      if (slot) {
        if (!slotToPessoas[slot]) slotToPessoas[slot] = [];
        slotToPessoas[slot].push(r.pessoa_id);
      }
    }
  };

  const runProfessores = async (sql, params) => {
    const [rows] = await db.query(sql, params);
    for (const r of rows) {
      const slot = parseSlot(r);
      if (slot) {
        if (!slotToPessoas[slot]) slotToPessoas[slot] = [];
        slotToPessoas[slot].push(r.pessoa_id);
      }
    }
  };

  if (grupo === 'ALUNOS') {
    const params = [diaSemanaHA];
    if (turma_id && turma_id !== 'TODOS') params.push(Number(turma_id));
    try {
      await runAlunos(`
        SELECT a.id AS pessoa_id, SUBSTRING_INDEX(MIN(ha.horario), '-', 1) AS primeiro_horario
        FROM Aluno a INNER JOIN Pessoa p ON p.id = a.id
        INNER JOIN HorarioAula ha ON ha.turma_id = a.turma_id AND ha.dia_semana = ?
        WHERE p.tipo = 'ALUNO' AND p.visivel = 1 ${turma_id && turma_id !== 'TODOS' ? ' AND a.turma_id = ?' : ''}
        GROUP BY a.id
      `, params);
    } catch (e) {
      if (e.message && e.message.includes('horario')) {
        await runAlunos(`
          SELECT a.id AS pessoa_id, TIME_FORMAT(MIN(ha.inicio), '%H:%i') AS primeiro_horario
          FROM Aluno a INNER JOIN Pessoa p ON p.id = a.id
          INNER JOIN HorarioAula ha ON ha.turma_id = a.turma_id AND ha.dia_semana = ?
          WHERE p.tipo = 'ALUNO' AND p.visivel = 1 ${turma_id && turma_id !== 'TODOS' ? ' AND a.turma_id = ?' : ''}
          GROUP BY a.id
        `, params);
      } else throw e;
    }
  } else if (grupo === 'FUNCIONARIOS' && (!funcionario_tipo || funcionario_tipo === 'TODOS' || funcionario_tipo === 'PROFESSOR')) {
    try {
      await runProfessores(`
        SELECT pr.id AS pessoa_id, SUBSTRING_INDEX(MIN(ha.horario), '-', 1) AS primeiro_horario
        FROM Professor pr INNER JOIN Aula a ON a.professor_id = pr.id
        INNER JOIN HorarioAula ha ON ha.aula_id = a.id AND ha.dia_semana = ?
        GROUP BY pr.id
      `, [diaSemanaHA]);
    } catch (e) {
      if (e.message && e.message.includes('horario')) {
        await runProfessores(`
          SELECT pr.id AS pessoa_id, TIME_FORMAT(MIN(ha.inicio), '%H:%i') AS primeiro_horario
          FROM Professor pr INNER JOIN Aula a ON a.professor_id = pr.id
          INNER JOIN HorarioAula ha ON ha.aula_id = a.id AND ha.dia_semana = ?
          GROUP BY pr.id
        `, [diaSemanaHA]);
      } else throw e;
    }
  }

  return slotToPessoas;
}

/**
 * Retorna mapa pessoa_id -> { horario_previsto: "07:30" } para os esperados no dia.
 */
async function getHorarioPrevistoPorPessoa(diaSemanaHA, grupo, turma_id, funcionario_tipo, pessoaIds) {
  if (!pessoaIds || pessoaIds.length === 0) return {};
  const placeholders = pessoaIds.map(() => '?').join(',');
  const map = {};
  const paramsBase = [diaSemanaHA];
  if (turma_id && turma_id !== 'TODOS') paramsBase.push(Number(turma_id));
  paramsBase.push(...pessoaIds);

  const run = async (sql, params) => {
    const [rows] = await db.query(sql, params);
    for (const r of rows) {
      const hp = (r.hp || '').toString().trim().slice(0, 5);
      if (hp) map[r.pessoa_id] = { horario_previsto: hp };
    }
  };

  if (grupo === 'ALUNOS') {
    try {
      await run(`
        SELECT a.id AS pessoa_id, SUBSTRING_INDEX(MIN(ha.horario), '-', 1) AS hp
        FROM Aluno a INNER JOIN Pessoa p ON p.id = a.id
        INNER JOIN HorarioAula ha ON ha.turma_id = a.turma_id AND ha.dia_semana = ?
        WHERE p.tipo = 'ALUNO' AND p.visivel = 1 ${turma_id && turma_id !== 'TODOS' ? ' AND a.turma_id = ?' : ''} AND a.id IN (${placeholders})
        GROUP BY a.id
      `, paramsBase);
    } catch (e) {
      if (e.message && e.message.includes('horario')) {
        await run(`
          SELECT a.id AS pessoa_id, TIME_FORMAT(MIN(ha.inicio), '%H:%i') AS hp
          FROM Aluno a INNER JOIN Pessoa p ON p.id = a.id
          INNER JOIN HorarioAula ha ON ha.turma_id = a.turma_id AND ha.dia_semana = ?
          WHERE p.tipo = 'ALUNO' AND p.visivel = 1 ${turma_id && turma_id !== 'TODOS' ? ' AND a.turma_id = ?' : ''} AND a.id IN (${placeholders})
          GROUP BY a.id
        `, paramsBase);
      } else throw e;
    }
  } else if (grupo === 'FUNCIONARIOS') {
    try {
      const diaFh = diaSemanaHA === 'TERÇA' ? 'TERCA' : diaSemanaHA;
      const [fhRows] = await db.query(
        `SELECT fh.funcionario_id AS pessoa_id, TIME_FORMAT(fh.hora_entrada, '%H:%i') AS hp
         FROM FuncionarioHorario fh
         WHERE fh.funcionario_id IN (${placeholders}) AND fh.dia_semana = ?`,
        [...pessoaIds, diaFh]
      );
      for (const r of fhRows || []) {
        const hp = (r.hp || '').toString().trim().slice(0, 5);
        if (hp) map[r.pessoa_id] = { horario_previsto: hp };
      }

      const idsComHorarioFixo = Object.keys(map).map(Number);
      const idsRestantes = pessoaIds.filter((id) => !idsComHorarioFixo.includes(Number(id)));

      if (idsRestantes.length > 0) {
        const phPlaceholders = idsRestantes.map(() => '?').join(',');
        const [profsComFixo] = await db.query(
          'SELECT id FROM Professor WHERE id IN (' + phPlaceholders + ') AND usar_horario_fixo = 1',
          idsRestantes
        );
        const idsUsarAula = idsRestantes.filter((id) => !(profsComFixo || []).some((p) => p.id === id));

        if (idsUsarAula.length > 0) {
          const auPlaceholders = idsUsarAula.map(() => '?').join(',');
          try {
            const [rows] = await db.query(`
              SELECT pr.id AS pessoa_id, SUBSTRING_INDEX(MIN(ha.horario), '-', 1) AS hp
              FROM Professor pr INNER JOIN Aula a ON a.professor_id = pr.id
              INNER JOIN HorarioAula ha ON ha.aula_id = a.id AND ha.dia_semana = ?
              WHERE pr.id IN (${auPlaceholders})
              GROUP BY pr.id
            `, [diaSemanaHA, ...idsUsarAula]);
            for (const r of rows || []) {
              const hp = (r.hp || '').toString().trim().slice(0, 5);
              if (hp && !map[r.pessoa_id]) map[r.pessoa_id] = { horario_previsto: hp };
            }
          } catch (e) {
            if (e.message && e.message.includes('horario')) {
              const [rows] = await db.query(`
                SELECT pr.id AS pessoa_id, TIME_FORMAT(MIN(ha.inicio), '%H:%i') AS hp
                FROM Professor pr INNER JOIN Aula a ON a.professor_id = pr.id
                INNER JOIN HorarioAula ha ON ha.aula_id = a.id AND ha.dia_semana = ?
                WHERE pr.id IN (${auPlaceholders})
                GROUP BY pr.id
              `, [diaSemanaHA, ...idsUsarAula]);
              for (const r of rows || []) {
                const hp = (r.hp || '').toString().trim().slice(0, 5);
                if (hp && !map[r.pessoa_id]) map[r.pessoa_id] = { horario_previsto: hp };
              }
            }
          }
        }
      }
    } catch (e) {
      if (!e.message || !e.message.includes("doesn't exist")) throw e;
    }
  }
  return map;
}

/**
 * Para pessoas sem Presenca, busca primeira ENTRADA em Acesso no dia e calcula atrasado.
 * Retorna mapa pessoa_id -> { atrasado, horario_previsto }.
 */
async function getPresencaFromAcesso(dataStr, esperados, presencaByPessoa, diaSemanaHA, grupo, turma_id, funcionario_tipo) {
  const faltantes = esperados.filter((pid) => !presencaByPessoa[pid]);
  if (faltantes.length === 0) return presencaByPessoa;

  const dataInicio = dataStr + ' 00:00:00';
  const dataFim = dataStr + ' 23:59:59';
  const placeholders = faltantes.map(() => '?').join(',');

  const [primeirasEntradas] = await db.query(
    `SELECT a.pessoa_id, MIN(a.data_hora) AS data_hora
     FROM Acesso a
     WHERE a.pessoa_id IN (${placeholders}) AND a.status = 'ENTRADA'
       AND a.data_hora >= ? AND a.data_hora <= ?
     GROUP BY a.pessoa_id`,
    [...faltantes, dataInicio, dataFim]
  );

  const horarioPrevistoMap = await getHorarioPrevistoPorPessoa(diaSemanaHA, grupo, turma_id, funcionario_tipo, faltantes);

  for (const row of primeirasEntradas || []) {
    const pid = row.pessoa_id;
    const dataHora = row.data_hora instanceof Date ? row.data_hora : new Date(row.data_hora);
    const info = horarioPrevistoMap[pid];
    let atrasado = false;
    let horarioPrevisto = null;

    if (info && info.horario_previsto) {
      horarioPrevisto = info.horario_previsto;
      const [h, m] = info.horario_previsto.split(':').map(Number);
      const ano = dataHora.getFullYear();
      const mes = dataHora.getMonth();
      const dia = dataHora.getDate();
      const limite = new Date(ano, mes, dia, h, m + TOLERANCIA_ATRASO_MINUTOS, 0, 0);
      atrasado = dataHora > limite;
    }

    presencaByPessoa[pid] = { atrasado, horario_previsto };
  }

  return presencaByPessoa;
}

/** Retorna mapa pessoa_id -> { horario_saida_previsto: "15:30" } (última aula do dia) */
async function getHorarioSaidaPrevistoPorPessoa(diaSemanaHA, grupo, turma_id, funcionario_tipo, pessoaIds) {
  if (!pessoaIds || pessoaIds.length === 0) return {};
  const placeholders = pessoaIds.map(() => '?').join(',');
  const map = {};
  const paramsBase = [diaSemanaHA];
  if (turma_id && turma_id !== 'TODOS') paramsBase.push(Number(turma_id));
  paramsBase.push(...pessoaIds);
  const diaFh = diaSemanaHA === 'TERÇA' ? 'TERCA' : diaSemanaHA;

  if (grupo === 'FUNCIONARIOS') {
    try {
      const [fhRows] = await db.query(
        `SELECT fh.funcionario_id AS pessoa_id, TIME_FORMAT(fh.hora_saida, '%H:%i') AS hp
         FROM FuncionarioHorario fh
         WHERE fh.funcionario_id IN (${placeholders}) AND fh.dia_semana = ?`,
        [...pessoaIds, diaFh]
      );
      for (const r of fhRows || []) {
        const hp = (r.hp || '').toString().trim().slice(0, 5);
        if (hp) map[r.pessoa_id] = { horario_saida_previsto: hp };
      }
      const idsComFixo = Object.keys(map).map(Number);
      const idsRestantes = pessoaIds.filter((id) => !idsComFixo.includes(Number(id)));
      if (idsRestantes.length === 0) return map;
      const [profsFixo] = await db.query(
        'SELECT id FROM Professor WHERE id IN (' + idsRestantes.map(() => '?').join(',') + ') AND usar_horario_fixo = 1',
        idsRestantes
      );
      const idsUsarAula = idsRestantes.filter((id) => !(profsFixo || []).some((p) => p.id === id));
      pessoaIds = idsUsarAula;
      if (pessoaIds.length === 0) return map;
    } catch (e) {
      if (!e.message || !e.message.includes("doesn't exist")) throw e;
    }
  }

  if (grupo === 'ALUNOS') {
    try {
      const [rows] = await db.query(`
        SELECT a.id AS pessoa_id, SUBSTRING_INDEX(MAX(CONCAT(SUBSTRING_INDEX(ha.horario, '-', -1), '|', ha.horario)), '-', -1) AS hp
        FROM Aluno a INNER JOIN Pessoa p ON p.id = a.id
        INNER JOIN HorarioAula ha ON ha.turma_id = a.turma_id AND ha.dia_semana = ?
        WHERE p.tipo = 'ALUNO' AND p.visivel = 1 ${turma_id && turma_id !== 'TODOS' ? ' AND a.turma_id = ?' : ''} AND a.id IN (${placeholders})
        GROUP BY a.id
      `, paramsBase);
      for (const r of rows || []) {
        const hp = (r.hp || '').toString().trim().slice(0, 5);
        if (hp) map[r.pessoa_id] = { horario_saida_previsto: hp };
      }
    } catch (e) {
      if (e.message && e.message.includes('horario')) {
        const [rows] = await db.query(`
          SELECT a.id AS pessoa_id, TIME_FORMAT(MAX(ha.fim), '%H:%i') AS hp
          FROM Aluno a INNER JOIN Pessoa p ON p.id = a.id
          INNER JOIN HorarioAula ha ON ha.turma_id = a.turma_id AND ha.dia_semana = ?
          WHERE p.tipo = 'ALUNO' AND p.visivel = 1 ${turma_id && turma_id !== 'TODOS' ? ' AND a.turma_id = ?' : ''} AND a.id IN (${placeholders})
          GROUP BY a.id
        `, paramsBase);
        for (const r of rows || []) {
          const hp = (r.hp || '').toString().trim().slice(0, 5);
          if (hp) map[r.pessoa_id] = { horario_saida_previsto: hp };
        }
      }
    }
  } else if (grupo === 'FUNCIONARIOS' && pessoaIds.length > 0) {
    const ph = pessoaIds.map(() => '?').join(',');
    try {
      const [rows] = await db.query(`
        SELECT pr.id AS pessoa_id, SUBSTRING_INDEX(MAX(CONCAT(SUBSTRING_INDEX(ha.horario, '-', -1), '|', ha.horario)), '-', -1) AS hp
        FROM Professor pr INNER JOIN Aula a ON a.professor_id = pr.id
        INNER JOIN HorarioAula ha ON ha.aula_id = a.id AND ha.dia_semana = ?
        WHERE pr.id IN (${ph})
        GROUP BY pr.id
      `, [diaSemanaHA, ...pessoaIds]);
      for (const r of rows || []) {
        const hp = (r.hp || '').toString().trim().slice(0, 5);
        if (hp && !map[r.pessoa_id]) map[r.pessoa_id] = { horario_saida_previsto: hp };
      }
    } catch (e) {
      if (e.message && e.message.includes('horario')) {
        const [rows] = await db.query(`
          SELECT pr.id AS pessoa_id, TIME_FORMAT(MAX(ha.fim), '%H:%i') AS hp
          FROM Professor pr INNER JOIN Aula a ON a.professor_id = pr.id
          INNER JOIN HorarioAula ha ON ha.aula_id = a.id AND ha.dia_semana = ?
          WHERE pr.id IN (${ph})
          GROUP BY pr.id
        `, [diaSemanaHA, ...pessoaIds]);
        for (const r of rows || []) {
          const hp = (r.hp || '').toString().trim().slice(0, 5);
          if (hp && !map[r.pessoa_id]) map[r.pessoa_id] = { horario_saida_previsto: hp };
        }
      }
    }
  }

  return map;
}

/**
 * GET /relatorios/acesso/resumo
 * Query: grupo, turma_id, periodo, data_inicio, data_fim, tipo_movimento (ENTRADA|SAIDA|AMBOS)
 */
async function resumo(req, res) {
  try {
    const { grupo = 'ALUNOS', turma_id = 'TODOS', funcionario_tipo = 'TODOS', periodo = 'TODAY', data_inicio, data_fim, tipo_movimento = 'ENTRADA' } = req.query;
    const [inicio, fim] = getIntervaloDatas(periodo, data_inicio, data_fim);

    let total = 0;
    let no_horario = 0;
    let atrasados = 0;
    let faltantes = 0;
    let saida_no_horario = 0;
    let saida_antes = 0;
    let saida_depois = 0;
    const linhaPorSlot = {}; // slot -> { no_horario, atrasados, faltantes }

    const datas = iterarDatas(inicio, fim, d => d);
    for (const data of datas) {
      const dataStr = formatDataBrasil(data);
      const diaSemana = getDiaSemanaBrasil(data);
      const diaSemanaHA = getDiaSemanaHorarioAula(data);

      const esperados = await getEsperadosNoDia(dataStr, diaSemana, diaSemanaHA, grupo, turma_id, funcionario_tipo);
      if (esperados.length === 0) continue;

      const placeholders = esperados.map(() => '?').join(',');
      const [presencas] = await db.query(
        `SELECT pessoa_id, atrasado, TIME_FORMAT(horario_previsto, "%H:%i") AS horario_previsto FROM Presenca WHERE data = ? AND pessoa_id IN (${placeholders})`,
        [dataStr, ...esperados]
      );
      const presencaByPessoa = {};
      for (const pr of (presencas || [])) {
        const pid = pr.pessoa_id;
        if (pid != null) {
          presencaByPessoa[pid] = { atrasado: !!pr.atrasado, horario_previsto: pr.horario_previsto };
        }
      }

      await getPresencaFromAcesso(dataStr, esperados, presencaByPessoa, diaSemanaHA, grupo, turma_id, funcionario_tipo);

      for (const pid of esperados) {
        total += 1;
        const pr = presencaByPessoa[pid];
        if (!pr) {
          faltantes += 1;
        } else if (pr.atrasado) {
          atrasados += 1;
        } else {
          no_horario += 1;
        }
      }

      const slotToPessoas = await getEsperadosPorSlot(dataStr, diaSemanaHA, grupo, turma_id, funcionario_tipo);
      for (const [slot, pessoaIds] of Object.entries(slotToPessoas)) {
        if (!linhaPorSlot[slot]) linhaPorSlot[slot] = { no_horario: 0, atrasados: 0, faltantes: 0 };
        let nh = 0, at = 0;
        for (const pid of pessoaIds) {
          const pr = presencaByPessoa[pid];
          if (!pr) linhaPorSlot[slot].faltantes += 1;
          else if (pr.atrasado) at += 1;
          else nh += 1;
        }
        linhaPorSlot[slot].no_horario += nh;
        linhaPorSlot[slot].atrasados += at;
      }
    }

    if (tipo_movimento === 'SAIDA') {
      total = 0;
      no_horario = 0;
      atrasados = 0;
      faltantes = 0;
      for (const data of iterarDatas(inicio, fim, d => d)) {
        const dataStr = formatDataBrasil(data);
        const diaSemanaHA = getDiaSemanaHorarioAula(data);
        const esperados = await getEsperadosNoDia(dataStr, getDiaSemanaBrasil(data), diaSemanaHA, grupo, turma_id, funcionario_tipo);
        if (esperados.length === 0) continue;

        const placeholders = esperados.map(() => '?').join(',');
        const [ultimasSaidas] = await db.query(
          `SELECT pessoa_id, MAX(data_hora) AS data_hora
           FROM Acesso WHERE pessoa_id IN (${placeholders}) AND status = 'SAIDA'
             AND data_hora >= ? AND data_hora <= ?
           GROUP BY pessoa_id`,
          [...esperados, dataStr + ' 00:00:00', dataStr + ' 23:59:59']
        );

        const saidaByPessoa = {};
        for (const row of ultimasSaidas || []) {
          const dataHora = row.data_hora instanceof Date ? row.data_hora : new Date(row.data_hora);
          saidaByPessoa[row.pessoa_id] = dataHora;
        }

        const saidaPrevistoMap = await getHorarioSaidaPrevistoPorPessoa(diaSemanaHA, grupo, turma_id, funcionario_tipo, esperados);

        for (const pid of esperados) {
          total += 1;
          const saidaHora = saidaByPessoa[pid];
          if (!saidaHora) { faltantes += 1; continue; }

          const info = saidaPrevistoMap[pid];
          if (!info?.horario_saida_previsto) {
            saida_no_horario += 1;
            continue;
          }

          const [h, m] = info.horario_saida_previsto.split(':').map(Number);
          const ano = saidaHora.getFullYear();
          const mes = saidaHora.getMonth();
          const dia = saidaHora.getDate();
          const previsto = new Date(ano, mes, dia, h, m, 0, 0);
          const toleranciaAntes = new Date(previsto.getTime() - TOLERANCIA_ATRASO_MINUTOS * 60000);
          const toleranciaDepois = new Date(previsto.getTime() + TOLERANCIA_ATRASO_MINUTOS * 60000);

          if (saidaHora < toleranciaAntes) saida_antes += 1;
          else if (saidaHora > toleranciaDepois) saida_depois += 1;
          else saida_no_horario += 1;
        }
      }

      const dados_pizza = [
        { label: 'Saiu no horário', value: saida_no_horario, color: '#4CAF50' },
        { label: 'Saiu antes', value: saida_antes, color: '#94a3b8' },
        { label: 'Saiu depois', value: saida_depois, color: '#FFC107' },
        { label: 'Sem saída registrada', value: faltantes, color: '#F44336' },
      ];

      return res.json({
        metricas: {
          total,
          no_horario: saida_no_horario,
          atrasados: saida_depois,
          faltantes: saida_antes + faltantes,
          saida_no_horario,
          saida_antes,
          saida_depois,
          percentual_presenca: total > 0 ? Math.round((saida_no_horario / total) * 1000) / 10 : 0,
        },
        dados_pizza,
        dados_linha: [],
        tipo_movimento: 'SAIDA',
      });
    }

    const percentual_presenca = total > 0 ? Math.round(((no_horario + atrasados) / total) * 1000) / 10 : 0;

    const dados_pizza = [
      { label: 'No Horário', value: no_horario, color: '#4CAF50' },
      { label: 'Atrasados', value: atrasados, color: '#FFC107' },
      { label: 'Faltantes', value: faltantes, color: '#F44336' },
    ];

    const slotsOrdenados = Object.keys(linhaPorSlot).sort();
    const dados_linha = slotsOrdenados.map(slot => ({
      label: slot,
      horario: slot,
      no_horario: linhaPorSlot[slot].no_horario,
      atrasados: linhaPorSlot[slot].atrasados,
      faltantes: linhaPorSlot[slot].faltantes,
    }));

    res.json({
      metricas: {
        total,
        no_horario,
        atrasados,
        faltantes,
        percentual_presenca,
      },
      dados_pizza,
      dados_linha,
    });
  } catch (err) {
    logger.error('[RELATORIO] resumo:', err.message);
    res.status(500).json({ message: 'Erro ao gerar resumo', error: err.message });
  }
}

/**
 * GET /relatorios/acesso/detalhes
 * Query: grupo, turma_id, funcionario_tipo, periodo, data_inicio, data_fim, limit, offset, tipo_movimento
 */
async function detalhes(req, res) {
  try {
    const { grupo = 'ALUNOS', turma_id = 'TODOS', funcionario_tipo = 'TODOS', periodo = 'TODAY', data_inicio, data_fim, limit = 20, offset = 0, tipo_movimento = 'ENTRADA' } = req.query;
    const [inicio, fim] = getIntervaloDatas(periodo, data_inicio, data_fim);
    const dataStrInicio = formatDataBrasil(inicio);
    const dataStrFim = formatDataBrasil(fim);

    const byPessoa = {};

    // 1) Presenca
    let sql = `
      SELECT p.id AS pessoa_id, p.nome, p.tipo, pr.data, pr.atrasado, pr.horario_previsto, pr.horario_chegada,
             t.nome AS turma_nome
      FROM Presenca pr
      INNER JOIN Pessoa p ON p.id = pr.pessoa_id
      LEFT JOIN Aluno al ON al.id = p.id
      LEFT JOIN Turma t ON t.id = al.turma_id
      WHERE pr.data >= ? AND pr.data <= ?
    `;
    const params = [dataStrInicio, dataStrFim];
    if (grupo === 'ALUNOS') {
      sql += ` AND p.tipo = 'ALUNO'`;
      if (turma_id && turma_id !== 'TODOS') { sql += ` AND al.turma_id = ?`; params.push(Number(turma_id)); }
    } else if (grupo === 'FUNCIONARIOS') {
      sql += ` AND EXISTS (SELECT 1 FROM Funcionario f WHERE f.id = p.id)`;
      if (funcionario_tipo && funcionario_tipo !== 'TODOS') {
        if (funcionario_tipo === 'PROFESSOR') sql += ` AND EXISTS (SELECT 1 FROM Professor pr2 WHERE pr2.id = p.id)`;
        else if (funcionario_tipo === 'ADMINISTRADOR') sql += ` AND EXISTS (SELECT 1 FROM Administrador ad WHERE ad.id = p.id)`;
        else if (funcionario_tipo === 'TERCEIRIZADO') sql += ` AND EXISTS (SELECT 1 FROM Terceirizado t WHERE t.id = p.id)`;
      }
    }
    sql += ` ORDER BY pr.data DESC, pr.horario_chegada DESC`;
    const [presencas] = await db.query(sql, params);

    for (const row of presencas || []) {
      const key = row.pessoa_id;
      if (!byPessoa[key]) {
        const horarioPrevisto = row.horario_previsto != null ? String(row.horario_previsto).slice(0, 5) : null;
        const horarioChegada = row.horario_chegada != null ? String(row.horario_chegada).slice(0, 5) : null;
        byPessoa[key] = {
          id: row.pessoa_id,
          nome: row.nome,
          tipo: row.tipo || (grupo === 'ALUNOS' ? 'ALUNO' : 'FUNCIONARIO'),
          turma: row.turma_nome || null,
          status: row.atrasado ? 'ATRASADO' : 'NO_HORARIO',
          horario_previsto: horarioPrevisto,
          horario_chegada: horarioChegada,
        };
      }
    }

    // 2) Fallback: Acesso ENTRADA (quem bateu ponto mas não tem Presenca) — mais recente por pessoa
    let sqlAcesso = `
      SELECT p.id AS pessoa_id, p.nome, p.tipo, t.nome AS turma_nome,
             TIME_FORMAT(sub.primeira_entrada, '%H:%i') AS horario_chegada
      FROM (
        SELECT pessoa_id, MIN(data_hora) AS primeira_entrada
        FROM Acesso
        WHERE status = 'ENTRADA' AND DATE(data_hora) >= ? AND DATE(data_hora) <= ?
        GROUP BY pessoa_id
      ) sub
      INNER JOIN Pessoa p ON p.id = sub.pessoa_id
      LEFT JOIN Aluno al ON al.id = p.id
      LEFT JOIN Turma t ON t.id = al.turma_id
      WHERE 1=1
    `;
    const paramsAcesso = [dataStrInicio, dataStrFim];
    if (grupo === 'ALUNOS') {
      sqlAcesso += ` AND p.tipo = 'ALUNO'`;
      if (turma_id && turma_id !== 'TODOS') { sqlAcesso += ` AND al.turma_id = ?`; paramsAcesso.push(Number(turma_id)); }
    } else if (grupo === 'FUNCIONARIOS') {
      sqlAcesso += ` AND EXISTS (SELECT 1 FROM Funcionario f WHERE f.id = p.id)`;
      if (funcionario_tipo && funcionario_tipo !== 'TODOS') {
        if (funcionario_tipo === 'PROFESSOR') sqlAcesso += ` AND EXISTS (SELECT 1 FROM Professor pr2 WHERE pr2.id = p.id)`;
        else if (funcionario_tipo === 'ADMINISTRADOR') sqlAcesso += ` AND EXISTS (SELECT 1 FROM Administrador ad WHERE ad.id = p.id)`;
        else if (funcionario_tipo === 'TERCEIRIZADO') sqlAcesso += ` AND EXISTS (SELECT 1 FROM Terceirizado t WHERE t.id = p.id)`;
      }
    }

    const [acessos] = await db.query(sqlAcesso, paramsAcesso);
    for (const row of acessos || []) {
      const key = row.pessoa_id;
      if (!byPessoa[key]) {
        byPessoa[key] = {
          id: row.pessoa_id,
          nome: row.nome,
          tipo: row.tipo || (grupo === 'ALUNOS' ? 'ALUNO' : 'FUNCIONARIO'),
          turma: row.turma_nome || null,
          status: 'NO_HORARIO',
          horario_previsto: null,
          horario_chegada: row.horario_chegada ? String(row.horario_chegada).slice(0, 5) : null,
        };
      }
    }

    let lista = Object.values(byPessoa);
    lista.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
    const total = lista.length;
    const limitNum = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const offsetNum = Math.max(Number(offset) || 0, 0);
    lista = lista.slice(offsetNum, offsetNum + limitNum);

    res.json({ dados: lista, total });
  } catch (err) {
    logger.error('[RELATORIO] detalhes:', err.message);
    res.status(500).json({ message: 'Erro ao gerar detalhes', error: err.message });
  }
}

/**
 * POST /relatorios/acesso/backfill-presenca
 * Sincroniza Presenca a partir de Acesso (primeira ENTRADA por pessoa por dia).
 * Útil quando há Acesso histórico mas Presenca estava vazio.
 */
async function backfillPresenca(req, res) {
  try {
    const verificarEAtribuirPresenca = require('../services/presenceService');
    const { data_inicio, data_fim } = req.body || req.query || {};

    const hoje = getHojeBrasil();
    const fim = data_fim ? new Date(data_fim) : new Date(hoje);
    const inicio = data_inicio ? new Date(data_inicio) : (() => {
      const d = new Date(hoje);
      d.setDate(d.getDate() - 7);
      return d;
    })();

    const [acessos] = await db.query(
      `SELECT pessoa_id, MIN(data_hora) AS data_hora
       FROM Acesso
       WHERE status = 'ENTRADA' AND DATE(data_hora) >= ? AND DATE(data_hora) <= ?
       GROUP BY pessoa_id, DATE(data_hora)
       ORDER BY data_hora ASC`,
      [formatDataBrasil(inicio), formatDataBrasil(fim)]
    );

    let processados = 0;
    for (const row of acessos || []) {
      const dataHora = row.data_hora instanceof Date ? row.data_hora : new Date(row.data_hora);
      await verificarEAtribuirPresenca(row.pessoa_id, dataHora);
      processados++;
    }

    res.json({
      message: `Backfill concluído: ${processados} registros de presença criados/atualizados`,
      processados,
      periodo: { inicio: formatDataBrasil(inicio), fim: formatDataBrasil(fim) },
    });
  } catch (err) {
    logger.error('[RELATORIO] backfillPresenca:', err.message);
    res.status(500).json({ message: 'Erro ao fazer backfill', error: err.message });
  }
}

/**
 * GET /relatorios/pessoa/:id/historico
 * Histórico completo de presença e acessos de uma pessoa.
 * Query: data_inicio, data_fim, limit, offset
 */
async function historicoPessoa(req, res) {
  try {
    const pessoaId = Number(req.params.id);
    const { data_inicio, data_fim, limit = 50, offset = 0 } = req.query;

    if (!pessoaId || isNaN(pessoaId)) {
      return res.status(400).json({ message: 'ID da pessoa inválido' });
    }

    const [pessoas] = await db.query(
      `SELECT p.id, p.nome, p.tipo, t.nome AS turma_nome
       FROM Pessoa p
       LEFT JOIN Aluno al ON al.id = p.id
       LEFT JOIN Turma t ON t.id = al.turma_id
       WHERE p.id = ?`,
      [pessoaId]
    );
    const pessoa = pessoas && pessoas[0];
    if (!pessoa) {
      return res.status(404).json({ message: 'Pessoa não encontrada' });
    }

    const hoje = getHojeBrasil();
    const dataFim = data_fim ? new Date(data_fim) : new Date(hoje);
    const dataInicio = data_inicio ? new Date(data_inicio) : (() => {
      const d = new Date(hoje);
      d.setDate(d.getDate() - 30);
      return d;
    })();
    const dataStrInicio = formatDataBrasil(dataInicio);
    const dataStrFim = formatDataBrasil(dataFim);

    const limitNum = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const offsetNum = Math.max(Number(offset) || 0, 0);

    const [presencas] = await db.query(
      `SELECT data, atrasado, horario_previsto, horario_chegada, aulas_perdidas
       FROM Presenca WHERE pessoa_id = ? AND data >= ? AND data <= ?
       ORDER BY data DESC, horario_chegada DESC`,
      [pessoaId, dataStrInicio, dataStrFim]
    );

    const [acessos] = await db.query(
      `SELECT a.id, a.data_hora, a.status, a.permitido, a.metodo_auth, d.nome AS dispositivo_nome
       FROM Acesso a
       LEFT JOIN Dispositivo d ON d.id = a.dispositivo_id
       WHERE a.pessoa_id = ? AND DATE(a.data_hora) >= ? AND DATE(a.data_hora) <= ?
       ORDER BY a.data_hora ASC`,
      [pessoaId, dataStrInicio, dataStrFim]
    );

    const toDataStr = (val) => {
      if (!val) return null;
      if (val instanceof Date) return formatDataBrasil(val);
      if (typeof val === 'string' && val.length >= 10) return val.slice(0, 10);
      return String(val).slice(0, 10);
    };

    const toHora = (val) => {
      if (!val) return null;
      const d = val instanceof Date ? val : new Date(val);
      return Number.isNaN(d.getTime()) ? null : d.toTimeString().slice(0, 5);
    };

    const presencaPorData = {};
    for (const pr of presencas || []) {
      const ds = toDataStr(pr.data);
      if (ds) presencaPorData[ds] = {
        atrasado: !!pr.atrasado,
        horario_previsto: pr.horario_previsto ? String(pr.horario_previsto).slice(0, 5) : null,
        horario_chegada: pr.horario_chegada ? String(pr.horario_chegada).slice(0, 5) : null,
        aulas_perdidas: pr.aulas_perdidas || 0,
      };
    }

    const acessosPorData = {};
    for (const ac of acessos || []) {
      const ds = formatDataBrasil(ac.data_hora);
      if (!acessosPorData[ds]) acessosPorData[ds] = { entradas: [], saidas: [] };
      const hora = toHora(ac.data_hora);
      if (ac.status === 'ENTRADA') acessosPorData[ds].entradas.push(hora);
      else if (ac.status === 'SAIDA') acessosPorData[ds].saidas.push(hora);
    }

    const datasUnicas = new Set([...Object.keys(presencaPorData), ...Object.keys(acessosPorData)]);
    const historico = [];
    for (const dataStr of [...datasUnicas].sort().reverse()) {
      const pr = presencaPorData[dataStr];
      const ac = acessosPorData[dataStr];
      const entrada = ac?.entradas?.[0] ?? pr?.horario_chegada ?? null;
      const saida = ac?.saidas?.length ? ac.saidas[ac.saidas.length - 1] : null;
      const status = pr ? (pr.atrasado ? 'ATRASADO' : 'NO_HORARIO') : (entrada ? 'NO_HORARIO' : null);
      const observacoes = [];
      if (pr && !pr.atrasado && status) observacoes.push('No horário');
      if (pr && pr.atrasado) observacoes.push('Atrasado');
      if (pr && pr.aulas_perdidas > 0) observacoes.push(`${pr.aulas_perdidas} aula(s) perdida(s)`);
      historico.push({
        data: dataStr,
        horario_entrada: entrada,
        horario_saida: saida,
        status,
        observacoes: observacoes.join('; ') || null,
        _sort: new Date(dataStr).getTime(),
      });
    }
    historico.sort((a, b) => (b._sort || 0) - (a._sort || 0));
    historico.forEach((h) => delete h._sort);

    const total = historico.length;
    const historicoPaginado = historico.slice(offsetNum, offsetNum + limitNum);

    const dadosLinha = historico.map((h) => ({
      data: h.data,
      label: h.data,
      no_horario: h.status === 'NO_HORARIO' ? 1 : 0,
      atrasados: h.status === 'ATRASADO' ? 1 : 0,
      faltantes: !h.status && !h.horario_entrada ? 1 : 0,
    }));

    res.json({
      pessoa: {
        id: pessoa.id,
        nome: pessoa.nome,
        tipo: pessoa.tipo,
        turma: pessoa.turma_nome,
      },
      historico: historicoPaginado,
      dados_linha: dadosLinha,
      total,
      periodo: { inicio: dataStrInicio, fim: dataStrFim },
    });
  } catch (err) {
    logger.error('[RELATORIO] historicoPessoa:', err.message);
    res.status(500).json({ message: 'Erro ao buscar histórico', error: err.message });
  }
}

module.exports = {
  turmas,
  resumo,
  detalhes,
  backfillPresenca,
  historicoPessoa,
};
