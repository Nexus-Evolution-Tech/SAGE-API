/**
 * Ajusta campos de data/hora do UTC para horário do Brasil (UTC-3)
 * Verifica se o campo existe e é uma data válida antes de converter
 */
function ajustarFusoHorarioBrasil(dados) {
  if (!dados) return dados;
  
  // Campos que podem conter datas
  const camposData = ['created_at', 'updated_at', 'data_nascimento', 'data_inicio', 'data_fim', 'data_hora', 'data_cadastro', 'data'];
  
  // Se é um array, aplica recursivamente
  if (Array.isArray(dados)) {
    return dados.map(item => ajustarFusoHorarioBrasil(item));
  }
  
  // Se é um objeto, verifica cada campo
  if (typeof dados === 'object' && dados !== null) {
    const dadosAjustados = { ...dados };
    
    for (const campo of camposData) {
      if (dadosAjustados[campo]) {
        const valor = dadosAjustados[campo];
        
        // Verifica se é uma data válida (string ISO ou objeto Date)
        const data = new Date(valor);
        if (!isNaN(data.getTime())) {
          // Converte UTC para horário do Brasil (UTC-3)
          const dataLocal = new Date(data.getTime() - (3 * 60 * 60 * 1000));
          dadosAjustados[campo] = dataLocal.toISOString().replace('T', ' ').substring(0, 19);
        }
      }
    }
    
    return dadosAjustados;
  }
  
  return dados;
}

module.exports = ajustarFusoHorarioBrasil;