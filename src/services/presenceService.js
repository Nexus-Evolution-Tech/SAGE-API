const db = require('../config/database');

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

async function verificarEAtribuirPresenca(pessoa_id, dataHoraAcesso) {
  if (!pessoa_id || !dataHoraAcesso) return;

  const [pessoas] = await db.query('SELECT id, tipo FROM Pessoa WHERE id = ?', [pessoa_id]);
  const pessoa = pessoas[0];
  if (!pessoa) return;

  const dataAcesso = dataHoraAcesso.toISOString().slice(0, 10); // YYYY-MM-DD
  const diasSemanaEnum = ['DOMINGO','SEGUNDA','TERCA','QUARTA','QUINTA','SEXTA','SABADO'];
  const diaSemana = diasSemanaEnum[dataHoraAcesso.getDay()];
  const toleranciaMinutos = 15;

  let aulasHoje = [];

  // BUSCA AULAS DO DIA
  if (pessoa.tipo === 'ALUNO') {
    const [alunos] = await db.query('SELECT turma_id, divisao FROM Aluno WHERE id = ?', [pessoa.id]);
    const aluno = alunos[0];
    if (!aluno || !aluno.turma_id) return;

    const [horarios] = await db.query(`
      SELECT ha.horario
      FROM HorarioAula ha
      JOIN Aula a ON ha.aula_id = a.id
      WHERE ha.turma_id = ? AND ha.dia_semana = ? AND ha.divisao IN (?, 'INT')
      ORDER BY ha.horario ASC
    `, [aluno.turma_id, diaSemana, aluno.divisao]);
    aulasHoje = horarios.map(h => {
      const [inicio, fim] = h.horario.split('-');
      return { inicio, fim };
    });

  } else if (['PROFESSOR','PROFADM'].includes(pessoa.tipo)) {
    const [horarios] = await db.query(`
      SELECT ha.horario
      FROM HorarioAula ha
      JOIN Aula a ON ha.aula_id = a.id
      WHERE a.professor_id = ? AND ha.dia_semana = ?
      ORDER BY ha.horario ASC
    `, [pessoa.id, diaSemana]);
    aulasHoje = horarios.map(h => {
      const [inicio, fim] = h.horario.split('-');
      return { inicio, fim };
    });
  }

  if (aulasHoje.length === 0) return; // Sem aula, não registra

  // PRIMEIRO HORÁRIO DO DIA
  const entradaPrevista = definirHorario(aulasHoje[0].inicio);
  const horarioChegada = dataHoraAcesso;

  // Calcula atraso e aulas perdidas
  const tolerancia = new Date(entradaPrevista.getTime() + toleranciaMinutos * 60000);
  const atrasado = horarioChegada > tolerancia;
  const aulasPerdidas = calcularAulasPerdidas(aulasHoje, horarioChegada);

  const status = atrasado ? 'ATRASADO' : 'PRESENTE';

  // Checa se já existe registro
  const [registros] = await db.query('SELECT id FROM Presenca WHERE pessoa_id = ? AND data = ?', [pessoa_id, dataAcesso]);
  const registroExistente = registros[0];

  if (!registroExistente) {
    // Inserir
    await db.query(`
      INSERT INTO Presenca
      (pessoa_id, data, dia_semana, status, aulas_perdidas, horario_previsto, horario_chegada)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      pessoa_id,
      dataAcesso,
      diaSemana,
      status,
      aulasPerdidas,
      formatarHoraParaSQL(entradaPrevista),
      formatarHoraParaSQL(horarioChegada)
    ]);
  } else {
    // Atualiza registro existente
    await db.query(`
      UPDATE Presenca
      SET dia_semana = ?, status = ?, aulas_perdidas = ?, horario_previsto = ?, horario_chegada = ?
      WHERE id = ?
    `, [
      diaSemana,
      status,
      aulasPerdidas,
      formatarHoraParaSQL(entradaPrevista),
      formatarHoraParaSQL(horarioChegada),
      registroExistente.id
    ]);
  }

  return {
    pessoa_id,
    status,
    aulas_perdidas: aulasPerdidas,
    horario_entrada_prevista: formatarHora(entradaPrevista),
    horario_entrada_real: formatarHora(horarioChegada),
    atrasado
  };
}

module.exports = verificarEAtribuirPresenca;
