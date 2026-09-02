const db = require('../config/database');
const logger = require('../config/logger');
const { agruparEventosParaRelatorio } = require('./jornadaController');
const responderErroInterno = require('../utils/responderErroInterno');

function validarPeriodo(req) {
  const inicio = req.query.data_inicio;
  const fim = req.query.data_fim || inicio;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio || '') || !/^\d{4}-\d{2}-\d{2}$/.test(fim || '') || inicio > fim) {
    const erro = new Error('FOLHA_PERIODO_INVALIDO');
    erro.status = 400;
    throw erro;
  }
  return { inicio, fim };
}

function horaLocal(valor) {
  const data = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(data.getTime())) return null;
  return data.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false });
}

function estaNoSlot(momento, inicio, fim) {
  const hora = horaLocal(momento);
  if (!hora || !inicio || !fim) return false;
  const valor = Number(hora.replace(':', ''));
  const primeiro = Number(String(inicio).slice(0, 5).replace(':', ''));
  const ultimo = Number(String(fim).slice(0, 5).replace(':', ''));
  return primeiro <= ultimo ? valor >= primeiro && valor <= ultimo : valor >= primeiro || valor <= ultimo;
}

async function folhaPresenca(req, res) {
  try {
    const { inicio, fim } = validarPeriodo(req);
    const params = [inicio, fim];
    let slotSql = `
      SELECT s.pessoa_id, s.data, s.faixa_inicio, s.faixa_fim, s.origem, s.origem_id,
             p.nome, t.nome AS turma
        FROM ExpectativaPresencaSlot s
        INNER JOIN Pessoa p ON p.id = s.pessoa_id
        LEFT JOIN Aluno al ON al.id = p.id
        LEFT JOIN Turma t ON t.id = al.turma_id
       WHERE s.data >= ? AND s.data <= ?`;
    if (req.query.turma_id && req.query.turma_id !== 'TODOS') {
      slotSql += ' AND al.turma_id = ?';
      params.push(Number(req.query.turma_id));
    }
    const [slots] = await db.query(slotSql, params);
    const [eventos] = await db.query(
      `SELECT id, pessoa_id, momento, sentido, origem
         FROM RegistroPresencaVigente
        WHERE momento >= ? AND momento <= ?
        ORDER BY momento ASC, id ASC`,
      [`${inicio} 00:00:00`, `${fim} 23:59:59`]
    );
    const porPessoaData = new Map();
    for (const evento of eventos || []) {
      const data = evento.momento instanceof Date
        ? evento.momento.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
        : String(evento.momento).slice(0, 10);
      const chave = `${evento.pessoa_id}:${data}`;
      const lista = porPessoaData.get(chave) || [];
      lista.push(evento);
      porPessoaData.set(chave, lista);
    }
    const linhas = (slots || []).map((slot) => {
      const data = String(slot.data).slice(0, 10);
      const eventosDaPessoa = porPessoaData.get(`${slot.pessoa_id}:${data}`) || [];
      const presente = eventosDaPessoa.some((evento) => evento.sentido === 'ENTRADA' && estaNoSlot(evento.momento, slot.faixa_inicio, slot.faixa_fim));
      return {
        pessoa_id: slot.pessoa_id,
        nome: slot.nome,
        turma: slot.turma || null,
        data,
        faixa_inicio: String(slot.faixa_inicio).slice(0, 5),
        faixa_fim: String(slot.faixa_fim).slice(0, 5),
        origem: slot.origem,
        origem_id: slot.origem_id,
        status: presente ? 'PRESENTE' : 'FALTANTE'
      };
    });
    res.json({ periodo: { inicio, fim }, linhas, total: linhas.length });
  } catch (err) {
    logger.error('[FOLHA] presenca:', err.message);
    if (err.status) return res.status(err.status).json({ error: 'Período inválido' });
    responderErroInterno(res, err, 'Erro ao gerar folha de presença');
  }
}

async function folhaPonto(req, res) {
  try {
    const { inicio, fim } = validarPeriodo(req);
    const [eventos] = await db.query(
      `SELECT r.id, r.pessoa_id, r.momento, r.sentido, r.origem, r.registro_corrigido_id,
              p.nome, t.nome AS turma
         FROM RegistroPresencaVigente r
         INNER JOIN Pessoa p ON p.id = r.pessoa_id
         LEFT JOIN Aluno al ON al.id = p.id
         LEFT JOIN Turma t ON t.id = al.turma_id
        WHERE r.momento >= ? AND r.momento <= ?
        ORDER BY r.momento ASC, r.id ASC`,
      [`${inicio} 00:00:00`, `${fim} 23:59:59`]
    );
    const jornadas = agruparEventosParaRelatorio(eventos);
    const linhas = jornadas.map((jornada) => ({
      pessoa_id: jornada.pessoa_id,
      nome: jornada.nome,
      turma: jornada.turma,
      data: jornada.data,
      pares: jornada.pares.map((par) => ({ entrada: par.entradaEm, saida: par.saidaEm, duracao_ms: par.duracaoMs })),
      total_ms: jornada.pares.reduce((total, par) => total + par.duracaoMs, 0),
      pendencias: jornada.pendencias
    }));
    const pendencias = linhas.flatMap((linha) => linha.pendencias);
    res.json({
      periodo: { inicio, fim },
      linhas,
      total: linhas.length,
      pode_fechar: pendencias.length === 0,
      pendencias
    });
  } catch (err) {
    logger.error('[FOLHA] ponto:', err.message);
    if (err.status) return res.status(err.status).json({ error: 'Período inválido' });
    responderErroInterno(res, err, 'Erro ao gerar folha de ponto');
  }
}

module.exports = { horaLocal, estaNoSlot, folhaPresenca, folhaPonto };
