const db = require('../config/database');
const logger = require('../config/logger');
const { verificarDiaLetivo, obterConfiguracaoTempo, calcularAtraso } = require('./calendarioEscolar');

// Converte "HH:mm" para minutos
function horaParaMinutos(horaStr) {
  const [hora, minuto] = horaStr.split(':').map(Number);
  return hora * 60 + minuto;
}

// Define horário Date a partir de "HH:mm"
function definirHorario(horaStr) {
  const [hora, minuto] = horaStr.split(':').map(Number);
  const data = new Date();
  data.setHours(hora, minuto, 0, 0);
  return data;
}

// Formata hora para string SQL "HH:MM:SS"
function formatarHoraParaSQL(date) {
  return date.toTimeString().slice(0, 8);
}

// Formata hora para exibição em "pt-BR"
function formatarHora(date) {
  return date.toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

// Calcula quantas aulas foram perdidas com base na hora de entrada
function calcularAulasPerdidas(aulas, entradaDate) {
  const minutosEntrada = entradaDate.getHours() * 60 + entradaDate.getMinutes();
  return aulas.filter(aula => {
    const inicio = aula.inicio; // já está separado
    const minutosAula = horaParaMinutos(inicio);
    return minutosAula < minutosEntrada;
  }).length;
}

/** Retorna YYYY-MM-DD e dia da semana no fuso de São Paulo (relatório e Presenca usam o mesmo dia). */
function dataEDiaBrasil(date) {
  const str = new Date(date.getTime()).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const [y, m, d] = str.split('-').map(Number);
  const diasSemanaEnum = ['DOMINGO','SEGUNDA','TERCA','QUARTA','QUINTA','SEXTA','SABADO'];
  const diaLocal = new Date(y, m - 1, d).getDay();
  return { dataStr: str, diaSemana: diasSemanaEnum[diaLocal] };
}

async function verificarEAtribuirPresenca(pessoa_id, dataHoraAcesso, executor = db) {
  if (!pessoa_id || !dataHoraAcesso) return;

  const [pessoas] = await executor.query('SELECT id, tipo FROM Pessoa WHERE id = ?', [pessoa_id]);
  const pessoa = pessoas[0];
  if (!pessoa) return;

  const { dataStr: dataAcesso, diaSemana } = dataEDiaBrasil(dataHoraAcesso instanceof Date ? dataHoraAcesso : new Date(dataHoraAcesso));
  const calendario = await verificarDiaLetivo(dataHoraAcesso, executor);
  if (!calendario.letivo) {
    return {
      pessoa_id,
      ignorado: 'DIA_NAO_LETIVO',
      data: calendario.data,
      tipoCalendario: calendario.tipo
    };
  }
  // HorarioAula no banco usa 'TERÇA' (com cedilha); Presenca usa 'TERCA'
  const diaSemanaHorarioAula = diaSemana === 'TERCA' ? 'TERÇA' : diaSemana;
  const configuracaoTempo = await obterConfiguracaoTempo(executor);

  let aulasHoje = [];

  // BUSCA AULAS/HORÁRIO DO DIA
  if (['ADMINISTRADOR', 'TERCEIRIZADO'].includes(pessoa.tipo)) {
    try {
      const [horarios] = await executor.query(
        `SELECT dia_semana, hora_entrada, hora_saida FROM FuncionarioHorario WHERE funcionario_id = ? AND dia_semana = ?`,
        [pessoa.id, diaSemana]
      );
      if (horarios && horarios.length > 0) {
        const h = horarios[0];
        const entradaStr = h.hora_entrada ? String(h.hora_entrada).slice(0, 5) : null;
        if (entradaStr) {
          aulasHoje = [{ inicio: entradaStr, fim: h.hora_saida ? String(h.hora_saida).slice(0, 5) : entradaStr }];
        }
      }
    } catch (e) {
      if (!e.message || !e.message.includes("doesn't exist")) throw e;
    }
  } else if (pessoa.tipo === 'ALUNO') {
    const [alunos] = await executor.query('SELECT turma_id, divisao FROM Aluno WHERE id = ?', [pessoa.id]);
    const aluno = alunos[0];
    if (!aluno || !aluno.turma_id) return;

    const [horarios] = await executor.query(`
      SELECT ha.horario
      FROM HorarioAula ha
      JOIN Aula a ON ha.aula_id = a.id
      WHERE ha.turma_id = ? AND ha.dia_semana = ? AND ha.divisao IN (?, 'INT')
      ORDER BY ha.horario ASC
    `, [aluno.turma_id, diaSemanaHorarioAula, aluno.divisao || 'INT']);
    aulasHoje = horarios.map(h => {
      const [inicio, fim] = h.horario.split('-');
      return { inicio, fim };
    });

  } else if (['PROFESSOR','PROFADM'].includes(pessoa.tipo)) {
    let usarHorarioFixo = false;
    try {
      const [profRow] = await executor.query('SELECT usar_horario_fixo FROM Professor WHERE id = ?', [pessoa.id]);
      usarHorarioFixo = !!(profRow && profRow[0] && profRow[0].usar_horario_fixo);
    } catch (e) { logger.debug('[PRESENCA] codigo=CAMPO_HORARIO_FIXO_INDISPONIVEL'); }

    if (usarHorarioFixo) {
      try {
        const [horarios] = await executor.query(
          `SELECT hora_entrada, hora_saida FROM FuncionarioHorario WHERE funcionario_id = ? AND dia_semana = ?`,
          [pessoa.id, diaSemana]
        );
        if (horarios && horarios.length > 0) {
          const h = horarios[0];
          const entradaStr = h.hora_entrada ? String(h.hora_entrada).slice(0, 5) : null;
          if (entradaStr) {
            aulasHoje = [{ inicio: entradaStr, fim: h.hora_saida ? String(h.hora_saida).slice(0, 5) : entradaStr }];
          }
        }
      } catch (e) {
        if (!e.message || !e.message.includes("doesn't exist")) throw e;
      }
    } else {
      const [horarios] = await executor.query(`
        SELECT ha.horario
        FROM HorarioAula ha
        JOIN Aula a ON ha.aula_id = a.id
        WHERE a.professor_id = ? AND ha.dia_semana = ?
        ORDER BY ha.horario ASC
      `, [pessoa.id, diaSemanaHorarioAula]);
      aulasHoje = (horarios || []).map(h => {
        const [inicio, fim] = (h.horario || '').split('-');
        return { inicio, fim };
      });
    }
  }

  let entradaPrevista = null;
  let aulasPerdidas = 0;
  let atrasado = false;

  if (aulasHoje.length > 0) {
    entradaPrevista = definirHorario(aulasHoje[0].inicio);
    atrasado = calcularAtraso({
      horarioPrevisto: entradaStrFromDate(entradaPrevista),
      horarioChegada: formatarHoraCurta(dataHoraAcesso),
      toleranciaAtrasoMinutos: configuracaoTempo.toleranciaAtrasoMinutos
    });
    aulasPerdidas = calcularAulasPerdidas(aulasHoje, dataHoraAcesso);
  }

  const horarioChegada = dataHoraAcesso;
  const horarioPrevistoSql = entradaPrevista ? formatarHoraParaSQL(entradaPrevista) : null;
  const horarioChegadaSql = formatarHoraParaSQL(horarioChegada);

  const [registros] = await executor.query('SELECT id FROM Presenca WHERE pessoa_id = ? AND data = ?', [pessoa_id, dataAcesso]);
  const registroExistente = registros[0];

  if (!registroExistente) {
    await executor.query(`
      INSERT INTO Presenca
      (pessoa_id, data, dia_semana, aulas_perdidas, horario_previsto, horario_chegada, atrasado)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      pessoa_id,
      dataAcesso,
      diaSemana,
      aulasPerdidas,
      horarioPrevistoSql,
      horarioChegadaSql,
      atrasado
    ]);
  } else {
    await executor.query(`
      UPDATE Presenca
      SET dia_semana = ?, aulas_perdidas = ?, horario_previsto = ?, horario_chegada = ?, atrasado = ?
      WHERE id = ?
    `, [
      diaSemana,
      aulasPerdidas,
      horarioPrevistoSql,
      horarioChegadaSql,
      atrasado,
      registroExistente.id
    ]);
  }

  return {
    pessoa_id,
    aulas_perdidas: aulasPerdidas,
    horario_entrada_prevista: entradaPrevista ? formatarHora(entradaPrevista) : null,
    horario_entrada_real: formatarHora(horarioChegada),
    atrasado: atrasado,
  };
}

function formatarHoraCurta(date) {
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function entradaStrFromDate(date) {
  return formatarHoraCurta(date);
}

module.exports = verificarEAtribuirPresenca;
