/**
 * Erro de comunicação com um dispositivo (catraca).
 *
 * Existe para atender ao RNF-4 (nenhuma falha silenciosa): o sistema precisa sempre saber e poder
 * mostrar seu estado real. Um `return []` num catch destrói essa informação — a partir dali é
 * impossível distinguir "não há nada novo" de "não consegui falar com o equipamento".
 *
 * O campo `dispositivoAlcancavel` é a distinção que mais importa na prática:
 *   - false → problema de rede/energia/cabo. Retry faz sentido; o equipamento pode voltar sozinho.
 *             Na tela de status: "sem comunicação desde HH:MM".
 *   - true  → o equipamento respondeu, mas recusou (sessão expirada, payload rejeitado, 4xx).
 *             Retry cego provavelmente não resolve; normalmente exige ação.
 */
class ErroDispositivo extends Error {
  /**
   * @param {string} mensagem
   * @param {object} [opcoes]
   * @param {boolean} [opcoes.dispositivoAlcancavel]
   * @param {number|null} [opcoes.statusHttp]
   * @param {string|null} [opcoes.codigo] código de rede do Node (ECONNREFUSED, ETIMEDOUT, ...)
   * @param {Error|null} [opcoes.causa]
   * @param {object} [opcoes.contexto]
   */
  constructor(mensagem, opcoes = {}) {
    super(mensagem);
    this.name = 'ErroDispositivo';
    this.dispositivoAlcancavel = opcoes.dispositivoAlcancavel === true;
    this.statusHttp = opcoes.statusHttp ?? null;
    this.codigo = opcoes.codigo ?? null;
    this.causa = opcoes.causa ?? null;
    this.contexto = opcoes.contexto ?? {};
    if (Error.captureStackTrace) Error.captureStackTrace(this, ErroDispositivo);
  }

  /**
   * Constrói a partir de um erro do axios, inferindo se o equipamento chegou a responder.
   * Sem resposta HTTP = não alcançável (rede, timeout, recusa de conexão).
   */
  static deErroHttp(mensagem, erro, contexto = {}) {
    const temResposta = Boolean(erro && erro.response);
    return new ErroDispositivo(`${mensagem}: ${erro?.message || 'erro desconhecido'}`, {
      dispositivoAlcancavel: temResposta,
      statusHttp: temResposta ? erro.response.status : null,
      codigo: erro?.code ?? null,
      causa: erro,
      contexto
    });
  }

  /** Forma segura para log/telemetria: sem dado pessoal, só o que ajuda a diagnosticar. */
  paraDiagnostico() {
    return {
      erro: this.name,
      mensagem: this.message,
      dispositivoAlcancavel: this.dispositivoAlcancavel,
      statusHttp: this.statusHttp,
      codigo: this.codigo
    };
  }
}

module.exports = ErroDispositivo;
