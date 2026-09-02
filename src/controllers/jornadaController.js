const db = require('../config/database');
const logger = require('../config/logger');
const { parearPorPessoa, resumirPendencias } = require('../services/jornadaService');
const responderErroInterno = require('../utils/responderErroInterno');

function dataLocal(valor) {
  const data = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(data.getTime())) return null;
  return data.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

function intervalo(req) {
  const hoje = dataLocal(new Date());
  const inicio = req.query.data_inicio || hoje;
  const fim = req.query.data_fim || inicio;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fim) || inicio > fim) {
    const erro = new Error('JORNADA_PERIODO_INVALIDO');
    erro.status = 400;
    throw erro;
  }
  return { inicio, fim };
}

function agruparEventosParaRelatorio(eventos) {
  const porPessoaData = new Map();
  for (const evento of eventos || []) {
    const data = dataLocal(evento.momento);
    if (!data) continue;
    const chave = `${evento.pessoa_id}:${data}`;
    const grupo = porPessoaData.get(chave) || {
      pessoa_id: evento.pessoa_id,
      nome: evento.nome,
      turma: evento.turma || null,
      data,
      eventos: []
    };
    grupo.eventos.push({
      id: evento.id,
      pessoa_id: evento.pessoa_id,
      momento: evento.momento,
      sentido: evento.sentido,
      origem: evento.origem,
      registro_corrigido_id: evento.registro_corrigido_id
    });
    porPessoaData.set(chave, grupo);
  }

  return [...porPessoaData.values()].map((grupo) => {
    const pareamento = parearPorPessoa(grupo.eventos);
    return {
      pessoa_id: grupo.pessoa_id,
      nome: grupo.nome,
      turma: grupo.turma,
      data: grupo.data,
      pares: pareamento.pares,
      pendencias: pareamento.pendencias
    };
  });
}

async function relatorio(req, res) {
  try {
    const { inicio, fim } = intervalo(req);
    const params = [`${inicio} 00:00:00`, `${fim} 23:59:59`];
    let sql = `
      SELECT r.id, r.pessoa_id, r.momento, r.sentido, r.origem, r.registro_corrigido_id,
             p.nome, t.nome AS turma
        FROM RegistroPresencaVigente r
        INNER JOIN Pessoa p ON p.id = r.pessoa_id
        LEFT JOIN Aluno al ON al.id = p.id
        LEFT JOIN Turma t ON t.id = al.turma_id
       WHERE r.momento >= ? AND r.momento <= ?`;
    if (req.query.pessoa_id) {
      sql += ' AND r.pessoa_id = ?';
      params.push(Number(req.query.pessoa_id));
    }
    if (req.query.turma_id && req.query.turma_id !== 'TODOS') {
      sql += ' AND al.turma_id = ?';
      params.push(Number(req.query.turma_id));
    }
    if (req.query.grupo === 'ALUNOS') sql += " AND p.tipo = 'ALUNO'";
    if (req.query.grupo === 'FUNCIONARIOS') sql += " AND p.tipo <> 'ALUNO'";
    sql += ' ORDER BY r.momento ASC, r.id ASC';

    const [eventos] = await db.query(sql, params);
    const jornadas = agruparEventosParaRelatorio(eventos);
    const pendencias = jornadas.flatMap((jornada) => jornada.pendencias.map((item) => ({
      ...item,
      data: jornada.data,
      nome: jornada.nome,
      turma: jornada.turma
    })));
    res.json({
      periodo: { inicio, fim },
      jornadas,
      pendencias,
      resumo_pendencias: resumirPendencias(pendencias)
    });
  } catch (err) {
    logger.error('[JORNADA] relatorio:', err.message);
    if (err.status) return res.status(err.status).json({ error: 'Período inválido' });
    responderErroInterno(res, err, 'Erro ao reconstruir jornada');
  }
}

async function pendencias(req, res) {
  return relatorio(req, res);
}

module.exports = { dataLocal, agruparEventosParaRelatorio, relatorio, pendencias };
