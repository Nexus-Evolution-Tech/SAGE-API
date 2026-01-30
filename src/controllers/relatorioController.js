/**
 * Controller de relatórios de acesso e presença.
 * Consome Presenca, Pessoa, Aluno, Turma, HorarioAula.
 */

const db = require('../config/database');
const logger = require('../config/logger');

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
      'SELECT id, nome FROM Turma ORDER BY nome'
    );
    res.json(rows || []);
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
    return rows.map(r => r.pessoa_id);
  }

  if (grupo === 'FUNCIONARIOS') {
    // Apenas professores têm aula no HorarioAula; filtro por tipo reduz ao subconjunto
    let sql = `
      SELECT DISTINCT pr.id AS pessoa_id
      FROM Professor pr
      INNER JOIN Aula a ON a.professor_id = pr.id
      INNER JOIN HorarioAula ha ON ha.aula_id = a.id AND ha.dia_semana = ?
      WHERE 1=1
    `;
    const params = [diaSemanaHA];
    if (funcionario_tipo && funcionario_tipo !== 'TODOS' && funcionario_tipo === 'PROFESSOR') {
      // já estamos em Professor
    } else if (funcionario_tipo && funcionario_tipo !== 'TODOS') {
      // ADMINISTRADOR ou TERCEIRIZADO não têm aula; retorna vazio para "esperados"
      return [];
    }
    const [rows] = await db.query(sql, params);
    return rows.map(r => r.pessoa_id);
  }

  return [];
}

/**
 * Para um dia, retorna mapa slot (ex: "07:30") -> lista de pessoa_id esperados naquele slot (primeira aula do dia).
 */
async function getEsperadosPorSlot(dataStr, diaSemanaHA, grupo, turma_id, funcionario_tipo) {
  const slotToPessoas = {};

  if (grupo === 'ALUNOS') {
    let sql = `
      SELECT a.id AS pessoa_id,
             SUBSTRING_INDEX(MIN(ha.horario), '-', 1) AS primeiro_horario
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
    sql += ' GROUP BY a.id';
    const [rows] = await db.query(sql, params);
    for (const r of rows) {
      const slot = (r.primeiro_horario || '').trim();
      if (slot) {
        if (!slotToPessoas[slot]) slotToPessoas[slot] = [];
        slotToPessoas[slot].push(r.pessoa_id);
      }
    }
  } else if (grupo === 'FUNCIONARIOS' && (!funcionario_tipo || funcionario_tipo === 'TODOS' || funcionario_tipo === 'PROFESSOR')) {
    const [rows] = await db.query(`
      SELECT pr.id AS pessoa_id,
             SUBSTRING_INDEX(MIN(ha.horario), '-', 1) AS primeiro_horario
      FROM Professor pr
      INNER JOIN Aula a ON a.professor_id = pr.id
      INNER JOIN HorarioAula ha ON ha.aula_id = a.id AND ha.dia_semana = ?
      GROUP BY pr.id
    `, [diaSemanaHA]);
    for (const r of rows) {
      const slot = (r.primeiro_horario || '').trim();
      if (slot) {
        if (!slotToPessoas[slot]) slotToPessoas[slot] = [];
        slotToPessoas[slot].push(r.pessoa_id);
      }
    }
  }

  return slotToPessoas;
}

/**
 * GET /relatorios/acesso/resumo
 * Query: grupo, turma_id, periodo, data_inicio, data_fim
 */
async function resumo(req, res) {
  try {
    const { grupo = 'ALUNOS', turma_id = 'TODOS', funcionario_tipo = 'TODOS', periodo = 'TODAY', data_inicio, data_fim } = req.query;
    const [inicio, fim] = getIntervaloDatas(periodo, data_inicio, data_fim);

    let total = 0;
    let no_horario = 0;
    let atrasados = 0;
    let faltantes = 0;
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
      for (const pr of presencas) {
        presencaByPessoa[pr.pessoa_id] = { atrasado: !!pr.atrasado, horario_previsto: pr.horario_previsto };
      }

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
 * Query: grupo, turma_id, funcionario_tipo, periodo, data_inicio, data_fim, limit, offset
 * Lista quem tem Presenca no período, filtrado por grupo/turma/tipo de funcionário.
 */
async function detalhes(req, res) {
  try {
    const { grupo = 'ALUNOS', turma_id = 'TODOS', funcionario_tipo = 'TODOS', periodo = 'TODAY', data_inicio, data_fim, limit = 20, offset = 0 } = req.query;
    const [inicio, fim] = getIntervaloDatas(periodo, data_inicio, data_fim);
    const dataStrInicio = formatDataBrasil(inicio);
    const dataStrFim = formatDataBrasil(fim);

    let sql = `
      SELECT p.id AS pessoa_id, p.nome, p.tipo, pr.data, pr.atrasado, pr.horario_previsto, pr.horario_chegada
      FROM Presenca pr
      INNER JOIN Pessoa p ON p.id = pr.pessoa_id
      WHERE pr.data >= ? AND pr.data <= ?
    `;
    const params = [dataStrInicio, dataStrFim];

    if (grupo === 'ALUNOS') {
      sql += ` AND p.tipo = 'ALUNO'`;
      if (turma_id && turma_id !== 'TODOS') {
        sql += ` AND EXISTS (SELECT 1 FROM Aluno a WHERE a.id = p.id AND a.turma_id = ?)`;
        params.push(Number(turma_id));
      }
    } else if (grupo === 'FUNCIONARIOS') {
      sql += ` AND EXISTS (SELECT 1 FROM Funcionario f WHERE f.id = p.id)`;
      if (funcionario_tipo && funcionario_tipo !== 'TODOS') {
        if (funcionario_tipo === 'PROFESSOR') {
          sql += ` AND EXISTS (SELECT 1 FROM Professor pr2 WHERE pr2.id = p.id)`;
        } else if (funcionario_tipo === 'ADMINISTRADOR') {
          sql += ` AND EXISTS (SELECT 1 FROM Administrador ad WHERE ad.id = p.id)`;
        } else if (funcionario_tipo === 'TERCEIRIZADO') {
          sql += ` AND EXISTS (SELECT 1 FROM Terceirizado t WHERE t.id = p.id)`;
        }
      }
    }

    sql += ` ORDER BY pr.data DESC, pr.horario_chegada DESC`;

    const [presencas] = await db.query(sql, params);

    const byPessoa = {};
    for (const row of presencas) {
      const key = row.pessoa_id;
      if (!byPessoa[key]) {
        byPessoa[key] = {
          id: row.pessoa_id,
          nome: row.nome,
          status: row.atrasado ? 'ATRASADO' : 'NO_HORARIO',
          horario_previsto: row.horario_previsto ? String(row.horario_previsto).slice(0, 5) : null,
          horario_chegada: row.horario_chegada ? String(row.horario_chegada).slice(0, 5) : null,
        };
      }
    }

    let lista = Object.values(byPessoa);
    lista.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
    const total = lista.length;
    lista = lista.slice(Number(offset), Number(offset) + Number(limit));

    res.json({ dados: lista, total });
  } catch (err) {
    logger.error('[RELATORIO] detalhes:', err.message);
    res.status(500).json({ message: 'Erro ao gerar detalhes', error: err.message });
  }
}

module.exports = {
  turmas,
  resumo,
  detalhes,
};
