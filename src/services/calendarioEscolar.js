const DIAS_UTEIS = new Set(['SEGUNDA', 'TERCA', 'QUARTA', 'QUINTA', 'SEXTA']);
const TIPOS_NAO_LETIVOS = new Set(['FERIADO', 'RECESSO']);
const DEFAULT_TEMPO = Object.freeze({
  horarioAbertura: '06:00',
  horarioFechamento: '23:00',
  toleranciaAtrasoMinutos: 15
});

function dataISO(data) {
  if (typeof data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data)) return data;
  const date = data instanceof Date ? data : new Date(data);
  if (Number.isNaN(date.getTime())) throw new Error('CALENDARIO_DATA_INVALIDA');
  return date.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

function diaSemana(data) {
  const iso = dataISO(data);
  const [ano, mes, dia] = iso.split('-').map(Number);
  return ['DOMINGO', 'SEGUNDA', 'TERCA', 'QUARTA', 'QUINTA', 'SEXTA', 'SABADO'][new Date(ano, mes - 1, dia).getDay()];
}

function minutosHora(hora) {
  if (typeof hora !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) return null;
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}

function parseConfig(rows = []) {
  const mapa = Object.fromEntries(rows.map(({ chave, valor }) => [chave, valor]));
  const abertura = minutosHora(mapa.tempo_horario_abertura) === null ? DEFAULT_TEMPO.horarioAbertura : mapa.tempo_horario_abertura;
  const fechamento = minutosHora(mapa.tempo_horario_fechamento) === null ? DEFAULT_TEMPO.horarioFechamento : mapa.tempo_horario_fechamento;
  const tolerancia = Number(mapa.tempo_tolerancia_atraso_minutos);
  return {
    horarioAbertura: abertura,
    horarioFechamento: fechamento,
    toleranciaAtrasoMinutos: Number.isInteger(tolerancia) && tolerancia >= 0 && tolerancia <= 240
      ? tolerancia : DEFAULT_TEMPO.toleranciaAtrasoMinutos
  };
}

async function obterConfiguracaoTempo(executor) {
  try {
    const [rows] = await executor.query(
      `SELECT chave, valor FROM ConfigSistema
       WHERE chave IN ('tempo_horario_abertura', 'tempo_horario_fechamento', 'tempo_tolerancia_atraso_minutos')`
    );
    return parseConfig(rows);
  } catch (erro) {
    if (String(erro?.message || '').includes("doesn't exist")) return DEFAULT_TEMPO;
    throw erro;
  }
}

/**
 * Retorna a regra efetiva: dias úteis são letivos por padrão; a tabela sobrescreve a exceção.
 */
async function verificarDiaLetivo(data, executor) {
  const dataStr = dataISO(data);
  let excecao = null;
  try {
    const [rows] = await executor.query('SELECT tipo, descricao FROM CalendarioEscolar WHERE data = ? LIMIT 1', [dataStr]);
    excecao = rows?.[0] || null;
  } catch (erro) {
    if (!String(erro?.message || '').includes("doesn't exist")) throw erro;
  }

  if (excecao) {
    return {
      data: dataStr,
      diaSemana: diaSemana(data),
      letivo: !TIPOS_NAO_LETIVOS.has(excecao.tipo),
      tipo: excecao.tipo,
      descricao: excecao.descricao || null
    };
  }

  const semana = diaSemana(data);
  return {
    data: dataStr,
    diaSemana: semana,
    letivo: DIAS_UTEIS.has(semana),
    tipo: DIAS_UTEIS.has(semana) ? 'DIA_LETIVO' : 'FIM_DE_SEMANA',
    descricao: null
  };
}

function calcularAtraso({ horarioPrevisto, horarioChegada, toleranciaAtrasoMinutos = DEFAULT_TEMPO.toleranciaAtrasoMinutos }) {
  const previsto = minutosHora(horarioPrevisto);
  const chegada = minutosHora(horarioChegada);
  if (previsto === null || chegada === null) return false;
  return chegada > previsto + toleranciaAtrasoMinutos;
}

function dentroHorarioFuncionamento(horario, configuracao = DEFAULT_TEMPO) {
  const atual = minutosHora(horario);
  const abertura = minutosHora(configuracao.horarioAbertura);
  const fechamento = minutosHora(configuracao.horarioFechamento);
  return atual !== null && abertura !== null && fechamento !== null && atual >= abertura && atual <= fechamento;
}

module.exports = {
  DEFAULT_TEMPO,
  dataISO,
  diaSemana,
  minutosHora,
  parseConfig,
  obterConfiguracaoTempo,
  verificarDiaLetivo,
  calcularAtraso,
  dentroHorarioFuncionamento
};
