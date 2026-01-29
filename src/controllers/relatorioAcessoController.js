/**
 * Controller para Relatórios de Acesso & Presença
 * Suporta períodos básicos para o MVP (hoje, semana atual, mês atual, datas específicas)
 */

const db = require('../config/database');
const logger = require('../config/logger');

async function runQuery(sql, params = []) {
  const [rows] = await db.query(sql, params);
  return rows;
}

// Formato de horários esperados (base para classificação simples)
const HORARIOS_ESPERADOS = [
  '07:30', '08:20', '09:10', '10:20', '11:10', '13:00', '13:50', '14:40'
];

// Helpers de data
function toISODate(d) {
  return d.toISOString().split('T')[0];
}

function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day; // segunda-feira como início
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfWeek(date) {
  const start = startOfWeek(date);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return end;
}

function startOfMonth(date) {
  const d = new Date(date);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfMonth(date) {
  const d = startOfMonth(date);
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  return d;
}

function parseTimeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function addMinutesToTimeStr(timeStr, minutes) {
  const total = parseTimeToMinutes(timeStr) + minutes;
  const h = String(Math.floor(total / 60)).padStart(2, '0');
  const m = String(total % 60).padStart(2, '0');
  return `${h}:${m}`;
}

function listarDias(inicio, fim) {
  const dias = [];
  const cursor = new Date(inicio);
  const limite = new Date(fim);
  while (cursor <= limite) {
    dias.push(toISODate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dias;
}

function processarPeriodo(periodo = 'TODAY', payload = {}) {
  const hoje = new Date();
  const normalizado = (periodo || 'TODAY').toUpperCase();

  switch (normalizado) {
    case 'TODAY': {
      const base = payload.data ? new Date(payload.data) : hoje;
      const dia = toISODate(base);
      return { inicio: dia, fim: dia, agrupamento: 'HORA', label: 'Dia' };
    }
    case 'SPECIFIC_DAY': {
      if (!payload.data_inicio) throw new Error('data_inicio obrigatório para SPECIFIC_DAY');
      const dia = toISODate(new Date(payload.data_inicio));
      return { inicio: dia, fim: dia, agrupamento: 'HORA', label: 'Dia' };
    }
    case 'CURRENT_WEEK': {
      const ini = startOfWeek(hoje);
      const fim = endOfWeek(hoje);
      return { inicio: toISODate(ini), fim: toISODate(fim), agrupamento: 'DIA', label: 'Semana' };
    }
    case 'SPECIFIC_WEEK': {
      if (!payload.data_inicio) throw new Error('data_inicio obrigatório para SPECIFIC_WEEK');
      const ini = startOfWeek(new Date(payload.data_inicio));
      const fim = endOfWeek(ini);
      return { inicio: toISODate(ini), fim: toISODate(fim), agrupamento: 'DIA', label: 'Semana' };
    }
    case 'CURRENT_MONTH': {
      const ini = startOfMonth(hoje);
      const fim = endOfMonth(hoje);
      return { inicio: toISODate(ini), fim: toISODate(fim), agrupamento: 'DIA', label: 'Mês' };
    }
    case 'SPECIFIC_MONTH': {
      if (!payload.data_inicio) throw new Error('data_inicio obrigatório para SPECIFIC_MONTH');
      const ini = startOfMonth(new Date(payload.data_inicio));
      const fim = endOfMonth(ini);
      return { inicio: toISODate(ini), fim: toISODate(fim), agrupamento: 'DIA', label: 'Mês' };
    }
    default:
      throw new Error(`Período inválido: ${periodo}`);
  }
}

/**
 * GET /api/relatorios/acesso
 */
exports.getDados = async (req, res) => {
  const { grupo = 'ALUNOS', turma_id = 'TODOS', periodo = 'TODAY', data_inicio, data_fim } = req.query;
  const tipo = req.query.tipo_funcionario || req.query.tipo || 'TODOS';

  try {
    const range = processarPeriodo(periodo, { data_inicio, data_fim });
    const payload = { range, turma_id };
    const dados = grupo === 'ALUNOS'
      ? await buscarDadosAlunos(turma_id, payload)
      : await buscarDadosFuncionarios(tipo, payload);

    res.json({
      periodo: { de: range.inicio, ate: range.fim, tipo: periodo },
      filtro: { grupo, tipo, turma_id },
      metricas: dados.metricas,
      dados_pizza: dados.pizza,
      dados_linha: dados.linha
    });
  } catch (error) {
    logger.error('Erro ao buscar dados do relatório:', error);
    res.status(400).json({ erro: error.message || 'Erro ao carregar dados' });
  }
};

async function buscarDadosAlunos(turmaId, { range }) {
  // Lista alunos considerando turma, se informada
  const paramsPessoas = [];
  let wherePessoas = "WHERE P.tipo = 'ALUNO'";
  if (turmaId && turmaId !== 'TODOS') {
    wherePessoas += ' AND A.turma_id = ?';
    paramsPessoas.push(turmaId);
  }

  const alunos = await runQuery(
    `SELECT P.id, P.nome FROM Pessoa P
     INNER JOIN Aluno A ON A.id = P.id
     ${wherePessoas}`,
    paramsPessoas
  );
  if (!alunos.length) {
    return montarResposta({ no_horario: 0, atrasados: 0, faltantes: 0 }, []);
  }

  // Acessos no range (apenas ENTRADA para contar presença)
  const paramsAcesso = [range.inicio, range.fim];
  let whereAcessos = "WHERE P.tipo = 'ALUNO' AND Ac.status = 'ENTRADA' AND DATE(Ac.data_hora) BETWEEN ? AND ?";
  if (turmaId && turmaId !== 'TODOS') {
    whereAcessos += ' AND Al.turma_id = ?';
    paramsAcesso.push(turmaId);
  }

  const acessos = await runQuery(
    `SELECT Ac.pessoa_id, DATE(Ac.data_hora) AS dia, TIME(Ac.data_hora) AS hora
     FROM Acesso Ac
     INNER JOIN Pessoa P ON P.id = Ac.pessoa_id
     INNER JOIN Aluno Al ON Al.id = P.id
     ${whereAcessos}`,
    paramsAcesso
  );

  logger.info(`[RELATORIO-ALUNOS] Encontrados: ${alunos.length} alunos, ${acessos.length} acessos. Range: ${range.inicio} a ${range.fim}`);

  return calcularPresencas(alunos, acessos, range);
}

async function buscarDadosFuncionarios(tipo, { range }) {
  const paramsPessoas = [];
  let wherePessoas = "WHERE tipo IN ('PROFESSOR', 'ADMINISTRADOR', 'TERCEIRIZADO', 'PROFADM')";
  if (tipo && tipo !== 'TODOS') {
    wherePessoas += ' AND tipo = ?';
    paramsPessoas.push(tipo);
  }

  const funcionarios = await runQuery(`SELECT id, nome FROM Pessoa ${wherePessoas}`, paramsPessoas);
  if (!funcionarios.length) {
    return montarResposta({ no_horario: 0, atrasados: 0, faltantes: 0 }, []);
  }

  const paramsAcesso = [range.inicio, range.fim];
  let whereAcessos = "WHERE P.tipo IN ('PROFESSOR', 'ADMINISTRADOR', 'TERCEIRIZADO', 'PROFADM') AND A.status = 'ENTRADA' AND DATE(A.data_hora) BETWEEN ? AND ?";
  if (tipo && tipo !== 'TODOS') {
    whereAcessos += ' AND P.tipo = ?';
    paramsAcesso.push(tipo);
  }

  const acessos = await runQuery(
    `SELECT A.pessoa_id, DATE(A.data_hora) AS dia, TIME(A.data_hora) AS hora
     FROM Acesso A
     INNER JOIN Pessoa P ON P.id = A.pessoa_id
     ${whereAcessos}`,
    paramsAcesso
  );

  return calcularPresencas(funcionarios, acessos, range);
}

function calcularPresencas(pessoas, acessos, range) {
  const dias = listarDias(range.inicio, range.fim);
  
  // Classificação simplificada para MVP:
  // - No horário: entrada até 08:00 (manhã) ou até 14:00 (tarde)
  // - Atrasado: entrada entre 08:00-09:00 (manhã) ou 14:00-15:00 (tarde)
  // - Faltante: sem registro ou entrada muito tarde (após 15:00 manhã ou 17:00 tarde)
  
  const primeiroAcessoPorDia = new Map();
  acessos.forEach(a => {
    // Garantir que a.dia é string ISO (YYYY-MM-DD)
    const diaStr = typeof a.dia === 'string' ? a.dia : toISODate(new Date(a.dia));
    const key = `${a.pessoa_id}-${diaStr}`;
    const existente = primeiroAcessoPorDia.get(key);
    if (!existente || a.hora < existente) {
      primeiroAcessoPorDia.set(key, a.hora);
      if (acessos.length <= 5) {
        logger.info(`[MAP-ACESSO] Adicionando: ${key} = ${a.hora}`);
      }
    }
  });

  let noHorario = 0;
  let atrasados = 0;
  let faltantes = 0;
  const linha = [];

  dias.forEach(dia => {
    let diaNoHorario = 0;
    let diaAtrasados = 0;
    let diaFaltantes = 0;

    pessoas.forEach(p => {
      const key = `${p.id}-${dia}`;
      const hora = primeiroAcessoPorDia.get(key);
      
      if (hora) {
        // Classifica baseado no horário
        const [h, m] = hora.split(':').map(Number);
        const minutos = h * 60 + m;
        
        // Período manhã: 06:00-09:00
        // Período tarde: 12:00-17:00
        const noHorarioManha = minutos >= 360 && minutos <= 480; // 06:00-08:00
        const atrasadoManha = minutos > 480 && minutos <= 540; // 08:00-09:00
        const noHorarioTarde = minutos >= 720 && minutos <= 840; // 12:00-14:00
        const atrasadoTarde = minutos > 840 && minutos <= 1020; // 14:00-17:00
        
        if (noHorarioManha || noHorarioTarde) {
          noHorario++;
          diaNoHorario++;
        } else if (atrasadoManha || atrasadoTarde) {
          atrasados++;
          diaAtrasados++;
        } else {
          // Fora dos períodos válidos = faltante
          faltantes++;
          diaFaltantes++;
        }
      } else {
        faltantes++;
        diaFaltantes++;
      }
    });

    linha.push({
      dia,
      no_horario: diaNoHorario,
      atrasados: diaAtrasados,
      faltantes: diaFaltantes
    });
  });

  return montarResposta({ no_horario: noHorario, atrasados, faltantes }, linha);
}

function montarResposta(contagem, linha) {
  // Total de pessoas que ACESSARAM (não inclui faltantes)
  const totalAcessos = contagem.no_horario + contagem.atrasados;
  // Total geral incluindo faltantes (para percentuais)
  const totalGeral = totalAcessos + contagem.faltantes;
  
  const pizza = [
    {
      label: 'No Horário',
      value: contagem.no_horario,
      percentual: totalGeral > 0 ? (contagem.no_horario / totalGeral) * 100 : 0,
      color: '#4CAF50'
    },
    {
      label: 'Atrasados',
      value: contagem.atrasados,
      percentual: totalGeral > 0 ? (contagem.atrasados / totalGeral) * 100 : 0,
      color: '#FFC107'
    },
    {
      label: 'Faltantes',
      value: contagem.faltantes,
      percentual: totalGeral > 0 ? (contagem.faltantes / totalGeral) * 100 : 0,
      color: '#F44336'
    }
  ];

  return {
    metricas: {
      total: totalAcessos, // Apenas quem acessou
      no_horario: contagem.no_horario,
      atrasados: contagem.atrasados,
      faltantes: contagem.faltantes,
      percentual_presenca: totalAcessos > 0 ? ((contagem.no_horario / totalAcessos) * 100).toFixed(2) : '0.00'
    },
    pizza,
    linha
  };
}

// Lista turmas para popular o filtro do frontend
exports.getTurmas = (req, res) => {
  runQuery('SELECT id, nome FROM Turma ORDER BY nome ASC')
    .then(results => res.json(results || []))
    .catch(err => {
      logger.error('Erro ao listar turmas:', err);
      res.status(500).json({ erro: 'Erro ao listar turmas' });
    });
};

// Alias para compatibilidade antiga
exports.getDadosHoje = exports.getDados;
