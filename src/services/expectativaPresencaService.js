const { dataISO, diaSemana } = require('./calendarioEscolar');

function normalizarDia(valor) {
  const dia = String(valor || '').toUpperCase();
  return dia.startsWith('TER') && dia !== 'TERCA' ? 'TERCA' : dia;
}

function normalizarAgenda(agenda) {
  let inicio = agenda.faixa_inicio || agenda.inicio;
  let fim = agenda.faixa_fim || agenda.fim;
  if ((!inicio || !fim) && typeof agenda.horario === 'string') {
    [inicio, fim] = agenda.horario.split('-');
  }
  return {
    pessoa_id: Number(agenda.pessoa_id),
    dia_semana: normalizarDia(agenda.dia_semana),
    faixa_inicio: String(inicio || '').slice(0, 5),
    faixa_fim: String(fim || '').slice(0, 5),
    origem: agenda.origem === 'FUNCIONARIO' ? 'FUNCIONARIO' : 'GRADE',
    origem_id: Number(agenda.origem_id || agenda.aula_id || 0)
  };
}

function datasEntre(inicio, fim) {
  const atual = new Date(`${dataISO(inicio)}T12:00:00-03:00`);
  const limite = new Date(`${dataISO(fim)}T12:00:00-03:00`);
  const saida = [];
  while (atual <= limite) {
    saida.push(dataISO(atual));
    atual.setUTCDate(atual.getUTCDate() + 1);
  }
  return saida;
}

/**
 * Gera a expectativa por slot em ordem determinística. O limite "hoje" impede recomposição
 * retroativa: mudanças na grade só alteram o futuro.
 */
function gerarSlots({ pessoas, inicio, fim, agendas, hoje = new Date() }) {
  const aPartirDe = dataISO(hoje);
  const porPessoaDia = new Map();
  for (const agendaBruta of agendas || []) {
    const agenda = normalizarAgenda(agendaBruta);
    if (!Number.isSafeInteger(agenda.pessoa_id) || !agenda.faixa_inicio || !agenda.faixa_fim) continue;
    const chave = `${agenda.pessoa_id}:${agenda.dia_semana}`;
    const lista = porPessoaDia.get(chave) || [];
    lista.push(agenda);
    porPessoaDia.set(chave, lista);
  }

  const slots = [];
  for (const data of datasEntre(inicio, fim)) {
    if (data < aPartirDe) continue;
    const dia = diaSemana(`${data}T12:00:00-03:00`);
    for (const pessoa of pessoas || []) {
      const pessoaId = Number(pessoa.pessoa_id ?? pessoa.id);
      if (!Number.isSafeInteger(pessoaId)) continue;
      for (const agenda of porPessoaDia.get(`${pessoaId}:${dia}`) || []) {
        slots.push({ ...agenda, pessoa_id: pessoaId, data });
      }
    }
  }

  return slots.sort((a, b) => (
    a.data.localeCompare(b.data)
    || a.pessoa_id - b.pessoa_id
    || a.faixa_inicio.localeCompare(b.faixa_inicio)
    || a.faixa_fim.localeCompare(b.faixa_fim)
    || a.origem.localeCompare(b.origem)
    || a.origem_id - b.origem_id
  ));
}

async function recomporSlotsFuturos({ executor, pessoas, inicio, fim, agendas, hoje = new Date() }) {
  if (!executor?.query) throw new TypeError('executor é obrigatório');
  const ids = [...new Set((pessoas || []).map((pessoa) => Number(pessoa.pessoa_id ?? pessoa.id)).filter(Number.isSafeInteger))];
  if (ids.length === 0) return [];

  const slots = gerarSlots({ pessoas: ids.map((pessoa_id) => ({ pessoa_id })), inicio, fim, agendas, hoje });
  const placeholders = ids.map(() => '?').join(',');
  const dataInicial = dataISO(hoje) > dataISO(inicio) ? dataISO(hoje) : dataISO(inicio);
  await executor.query(
    `DELETE FROM ExpectativaPresencaSlot WHERE pessoa_id IN (${placeholders}) AND data >= ? AND data <= ?`,
    [...ids, dataInicial, dataISO(fim)]
  );
  if (!slots.length) return slots;

  const valores = slots.flatMap((slot) => [
    slot.pessoa_id, slot.data, `${slot.faixa_inicio}:00`, `${slot.faixa_fim}:00`, slot.origem, slot.origem_id
  ]);
  await executor.query(
    `INSERT INTO ExpectativaPresencaSlot
      (pessoa_id, data, faixa_inicio, faixa_fim, origem, origem_id)
     VALUES ${slots.map(() => '(?, ?, ?, ?, ?, ?)').join(', ')}
     ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP`,
    valores
  );
  return slots;
}

module.exports = { normalizarAgenda, datasEntre, gerarSlots, recomporSlotsFuturos };
