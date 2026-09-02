function dataISO(valor) {
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor)) return valor;
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return null;
  return data.toISOString().slice(0, 10);
}

function aplicaExcecao(excecao, alvo) {
  const data = dataISO(alvo.data);
  if (!data || data < excecao.data_inicio || data > excecao.data_fim) return false;
  if (excecao.escopo === 'TODOS') return true;
  if (excecao.escopo === 'PESSOA') return Number(alvo.pessoa_id) === Number(excecao.alvo_id);
  return Number(alvo.turma_id) === Number(excecao.alvo_id);
}

function aplicarExcecoes(slots, excecoes = []) {
  return (slots || []).filter((slot) => !excecoes.some((excecao) => (
    excecao.efeito === 'REMOVER_EXPECTATIVA' && aplicaExcecao(excecao, slot)
  )));
}

module.exports = { dataISO, aplicaExcecao, aplicarExcecoes };
