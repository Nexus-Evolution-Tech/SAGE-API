/**
 * Proteção contra perda de logs de acesso (RNF-3: zero perda de log).
 *
 * Zerar os logs de uma catraca é a ÚNICA operação do sistema capaz de destruir acesso de forma
 * irreversível. O fluxo atual já faz backup em arquivo antes de apagar — o que é bom, mas não
 * suficiente: o backup é um arquivo no PC da escola, e **não significa que os acessos entraram no
 * banco do sistema**. Se a sincronização estiver falhando, aqueles acessos nunca vão aparecer em
 * nenhum relatório de frequência.
 *
 * Isso não é hipotético: `docs/ANALISE_SYNC_CONTROL_ID.md` registra 48.057 logs na catraca com
 * ZERO inseridos no banco. Se alguém clicasse "zerar logs" naquele estado — o que é tentador,
 * porque a catraca fica lenta com muitos logs — o histórico sumiria do sistema para sempre.
 *
 * Este módulo é uma função pura de decisão, separada de HTTP e de banco justamente para poder ser
 * testada exaustivamente.
 */

/**
 * Avalia se é seguro zerar os logs de uma catraca.
 *
 * @param {object} params
 * @param {number|null} params.maiorLogIdNaCatraca  Maior `id` de access_log presente no equipamento.
 * @param {number|null} params.ultimoLogIdSincronizado  `Dispositivo.ultimo_log_id_sincronizado`.
 * @param {boolean} [params.confirmadoPeloOperador]  Operador confirmou explicitamente a perda.
 * @returns {{ seguro: boolean, naoSincronizados: number|null, motivo: string, exigeConfirmacao: boolean }}
 */
function avaliarPerdaDeLogs({
  maiorLogIdNaCatraca,
  ultimoLogIdSincronizado,
  confirmadoPeloOperador = false
} = {}) {
  const maior = maiorLogIdNaCatraca == null ? null : Number(maiorLogIdNaCatraca);
  const ultimo = ultimoLogIdSincronizado == null ? null : Number(ultimoLogIdSincronizado);

  // Não conseguimos saber o estado do equipamento. Na dúvida, NÃO destrua.
  if (maior == null || Number.isNaN(maior)) {
    return {
      seguro: false,
      naoSincronizados: null,
      exigeConfirmacao: true,
      motivo:
        'Não foi possível determinar quantos logs existem na catraca. ' +
        'Zerar sem essa informação pode apagar acessos que nunca entraram no sistema.'
    };
  }

  // Catraca vazia: nada a perder.
  if (maior <= 0) {
    return { seguro: true, naoSincronizados: 0, exigeConfirmacao: false, motivo: 'A catraca não tem logs.' };
  }

  // Nunca sincronizou nada deste dispositivo — o caso mais perigoso de todos.
  if (ultimo == null || Number.isNaN(ultimo)) {
    const resultado = {
      seguro: false,
      naoSincronizados: maior,
      exigeConfirmacao: true,
      motivo:
        `Nenhum log deste dispositivo foi sincronizado ainda, e a catraca tem registros até o ` +
        `id ${maior}. Zerar agora apagaria TODOS esses acessos do sistema — eles não apareceriam ` +
        `em nenhum relatório de frequência.`
    };
    return confirmadoPeloOperador ? { ...resultado, seguro: true } : resultado;
  }

  const naoSincronizados = Math.max(0, maior - ultimo);

  if (naoSincronizados === 0) {
    return {
      seguro: true,
      naoSincronizados: 0,
      exigeConfirmacao: false,
      motivo: 'Todos os logs da catraca já foram sincronizados para o sistema.'
    };
  }

  const resultado = {
    seguro: false,
    naoSincronizados,
    exigeConfirmacao: true,
    motivo:
      `Existem aproximadamente ${naoSincronizados} acesso(s) na catraca que ainda NÃO foram ` +
      `sincronizados para o sistema (último sincronizado: ${ultimo}; na catraca: ${maior}). ` +
      `Sincronize antes de zerar, ou esses acessos não aparecerão em nenhum relatório.`
  };

  return confirmadoPeloOperador ? { ...resultado, seguro: true } : resultado;
}

module.exports = { avaliarPerdaDeLogs };
