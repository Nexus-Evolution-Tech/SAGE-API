/**
 * Registro de saúde dos dispositivos (Fase 2, E6).
 *
 * Existe para fechar a última lacuna do RNF-4. Corrigimos os pontos em que o sistema **perdia** a
 * informação de falha (`return []`, `logger.debug`), mas em `obterSessao` e `verificarSessao` o
 * contrato de devolver `null`/`false` é legítimo — os chamadores já o tratam. O que se perdia ali
 * era a **razão**: "não deu para falar com a catraca" e "a catraca recusou a senha" viravam o
 * mesmo `null`.
 *
 * Aqui a razão é guardada, para a tela de status poder dizer o que houve, em português de
 * secretaria — e não em código de erro.
 *
 * NOTA DE ARQUITETURA: este estado é em memória, de propósito. É estado **derivado** e barato de
 * reconstruir (a primeira tentativa de sync já o repovoa), então não vale o custo de escrever no
 * banco a cada tentativa — o que num HD mecânico seria I/O aleatório contínuo. Diferente da fila
 * de sincronização, que é estado **de trabalho** e precisa sobreviver a desligamento (Fase 5).
 */

const { sanitizarTexto } = require('./sanitizador');

/** @type {Map<number, object>} */
const registro = new Map();

const MAX_HISTORICO = 5;

function agora() {
  return new Date();
}

function registrarSucesso(dispositivoId, { nome, operacao } = {}) {
  const atual = registro.get(dispositivoId) || novoRegistro(nome);
  atual.nome = nome || atual.nome;
  atual.ultimoSucessoEm = agora();
  atual.ultimaOperacaoOk = operacao || null;
  atual.falhasConsecutivas = 0;
  atual.alcancavel = true;
  registro.set(dispositivoId, atual);
  return atual;
}

function registrarFalha(dispositivoId, { nome, operacao, motivo, alcancavel } = {}) {
  const atual = registro.get(dispositivoId) || novoRegistro(nome);
  atual.nome = nome || atual.nome;
  atual.ultimaFalhaEm = agora();
  atual.ultimoMotivo = motivo || 'motivo não informado';
  atual.ultimaOperacaoFalha = operacao || null;
  atual.falhasConsecutivas = (atual.falhasConsecutivas || 0) + 1;
  atual.alcancavel = alcancavel === true;
  atual.historico.unshift({ em: atual.ultimaFalhaEm, operacao, motivo });
  if (atual.historico.length > MAX_HISTORICO) atual.historico.length = MAX_HISTORICO;
  registro.set(dispositivoId, atual);
  return atual;
}

function novoRegistro(nome) {
  return {
    nome: nome || null,
    ultimoSucessoEm: null,
    ultimaFalhaEm: null,
    ultimoMotivo: null,
    ultimaOperacaoOk: null,
    ultimaOperacaoFalha: null,
    falhasConsecutivas: 0,
    alcancavel: null,
    historico: []
  };
}

function obter(dispositivoId) {
  return registro.get(dispositivoId) || null;
}

function todos() {
  return Array.from(registro.entries()).map(([id, dados]) => ({ dispositivo_id: id, ...dados }));
}

function limpar() {
  registro.clear();
}

/**
 * Converte o estado técnico em uma frase que a secretaria entende — e que já diz o que fazer,
 * ou que tranquiliza quando não há nada a fazer.
 *
 * Regra de redação: nunca deixar a pessoa sem saber se precisa agir. Em especial, quando a
 * catraca está fora do ar, é essencial dizer que os acessos **continuam sendo registrados no
 * equipamento** — senão a reação natural é achar que se perdeu o dia.
 *
 * @param {object} saude registro de um dispositivo (pode ser null)
 * @param {Date} [referencia] "agora", injetável para teste
 */
function descreverParaOperador(saude, referencia = new Date()) {
  if (!saude) {
    return {
      nivel: 'desconhecido',
      texto: 'Ainda não houve nenhuma tentativa de comunicação com esta catraca desde que o sistema ligou.'
    };
  }

  const nome = sanitizarTexto(saude.nome || 'Catraca');

  if (saude.falhasConsecutivas === 0 && saude.ultimoSucessoEm) {
    return { nivel: 'ok', texto: `${nome}: funcionando normalmente.` };
  }

  if (saude.falhasConsecutivas > 0) {
    const desde = saude.ultimaFalhaEm ? formatarHora(saude.ultimaFalhaEm) : 'há pouco';
    if (saude.alcancavel === false) {
      return {
        nivel: 'erro',
        texto:
          `${nome}: sem comunicação desde ${desde}. ` +
          'Os acessos continuam sendo registrados no equipamento e serão importados quando ela voltar. ' +
          'Verifique se a catraca está ligada e conectada à rede.'
      };
    }
    return {
      nivel: 'atencao',
      texto:
        `${nome}: respondeu, mas recusou a operação desde ${desde}. ` +
        `Motivo técnico informado: ${sanitizarTexto(saude.ultimoMotivo)}. ` +
        'Normalmente isso é usuário ou senha da catraca incorretos no cadastro do dispositivo.'
    };
  }

  return { nivel: 'desconhecido', texto: `${nome}: estado desconhecido.` };
}

function formatarHora(data) {
  const d = data instanceof Date ? data : new Date(data);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

module.exports = {
  registrarSucesso,
  registrarFalha,
  obter,
  todos,
  limpar,
  descreverParaOperador
};
