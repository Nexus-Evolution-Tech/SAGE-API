const MAX_INTERVALO_PADRAO_MS = 18 * 60 * 60 * 1000;

function horaDoEvento(evento) {
  const valor = evento?.dataHora ?? evento?.data_hora ?? evento?.momento ?? evento?.timestamp;
  const data = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(data.getTime()) ? null : data;
}

function ordenarEventos(eventos) {
  return [...(eventos || [])]
    .map((evento, ordem) => ({ evento, ordem, data: horaDoEvento(evento) }))
    .sort((a, b) => (a.data?.getTime() ?? Infinity) - (b.data?.getTime() ?? Infinity) || a.ordem - b.ordem)
    .map(({ evento, data }) => ({ evento, data }));
}

function pendencia(tipo, evento, extra = {}) {
  return { tipo, evento: evento || null, ...extra };
}

/** Pareia uma pessoa sem preencher nenhum horário por estimativa. */
function parearEventos(eventos, { maxIntervaloMs = MAX_INTERVALO_PADRAO_MS } = {}) {
  const pares = [];
  const pendencias = [];
  let entradaAberta = null;

  for (const { evento, data } of ordenarEventos(eventos)) {
    const sentido = String(evento?.sentido ?? evento?.status ?? '').toUpperCase();
    if (!data || !['ENTRADA', 'SAIDA'].includes(sentido)) {
      pendencias.push(pendencia('EVENTO_INVALIDO', evento));
      continue;
    }

    if (sentido === 'ENTRADA') {
      if (entradaAberta) pendencias.push(pendencia('ENTRADA_DUPLICADA', evento, { entradaAberta }));
      else entradaAberta = { evento, data };
      continue;
    }

    if (!entradaAberta) {
      pendencias.push(pendencia('SAIDA_SEM_ENTRADA', evento));
      continue;
    }

    const intervaloMs = data.getTime() - entradaAberta.data.getTime();
    if (intervaloMs < 0 || intervaloMs > maxIntervaloMs) {
      pendencias.push(pendencia('INTERVALO_IMPLAUSIVEL', evento, { entrada: entradaAberta.evento, intervaloMs }));
      entradaAberta = null;
      continue;
    }

    pares.push({
      entrada: entradaAberta.evento,
      saida: evento,
      entradaEm: entradaAberta.data,
      saidaEm: data,
      duracaoMs: intervaloMs
    });
    entradaAberta = null;
  }

  if (entradaAberta) pendencias.push(pendencia('ENTRADA_SEM_SAIDA', entradaAberta.evento));
  return { pares, pendencias };
}

function parearPorPessoa(eventos, opcoes = {}) {
  const grupos = new Map();
  for (const evento of eventos || []) {
    const pessoaId = evento?.pessoa_id ?? evento?.pessoaId;
    const lista = grupos.get(pessoaId) || [];
    lista.push(evento);
    grupos.set(pessoaId, lista);
  }

  const resultado = { pares: [], pendencias: [] };
  for (const [pessoa_id, lista] of grupos) {
    const parcial = parearEventos(lista, opcoes);
    resultado.pares.push(...parcial.pares.map((par) => ({ ...par, pessoa_id })));
    resultado.pendencias.push(...parcial.pendencias.map((pendenciaItem) => ({ ...pendenciaItem, pessoa_id })));
  }
  return resultado;
}

function resumirPendencias(pendencias = []) {
  return pendencias.reduce((acc, item) => {
    acc.total += 1;
    acc.porTipo[item.tipo] = (acc.porTipo[item.tipo] || 0) + 1;
    return acc;
  }, { total: 0, porTipo: {} });
}

module.exports = { MAX_INTERVALO_PADRAO_MS, horaDoEvento, parearEventos, parearPorPessoa, resumirPendencias };
