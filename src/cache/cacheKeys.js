/**
 * Chaves de cache (constantes)
 * Facilita invalidação e reutilização
 */

const CACHE_KEYS = {
  // Pessoas
  PESSOA: (id) => `pessoa:${id}`,
  PESSOAS_LISTA: 'pessoas:lista',
  PESSOAS_ATIVAS: 'pessoas:ativas',

  // Dispositivos
  DISPOSITIVO: (id) => `dispositivo:${id}`,
  DISPOSITIVOS_LISTA: 'dispositivos:lista',
  DISPOSITIVOS_STATUS: (id) => `dispositivo:status:${id}`,

  // Aulas
  AULA: (id) => `aula:${id}`,
  AULAS_TURMA: (turmaId) => `aulas:turma:${turmaId}`,
  AULAS_PROFESSOR: (professorId) => `aulas:professor:${professorId}`,
  AULAS_DIA: (dia) => `aulas:dia:${dia}`,

  // Acessos
  ACESSOS_PESSOA: (pessoaId) => `acessos:pessoa:${pessoaId}`,
  ACESSOS_HOJE: 'acessos:hoje',
  ACESSOS_DISPOSITIVO: (dispositivoId) => `acessos:dispositivo:${dispositivoId}`,

  // Turmas
  TURMA: (id) => `turma:${id}`,
  TURMAS_LISTA: 'turmas:lista',
  TURMAS_ALUNOS: (turmaId) => `turma:alunos:${turmaId}`,

  // Horários
  HORARIO_PESSOA: (pessoaId) => `horario:pessoa:${pessoaId}`,
  HORARIOS_LISTA: 'horarios:lista',

  // Sessões Catraca
  SESSAO_CATRACA: (dispositivoId) => `sessao:catraca:${dispositivoId}`,

  // Atrasos
  ATRASOS_PESSOA: (pessoaId) => `atrasos:pessoa:${pessoaId}`,
  ATRASOS_HOJE: 'atrasos:hoje',

  // Padrões para invalidação
  INVALIDATE_PESSOA: 'pessoa:*',
  INVALIDATE_AULAS: 'aulas:*',
  INVALIDATE_ACESSOS: 'acessos:*',
  INVALIDATE_DISPOSITIVOS: 'dispositivo:*',
  INVALIDATE_ALL: '*'
};

const CACHE_TTL = {
  // 1 minuto (dados que mudam frequentemente)
  SHORT: 60,

  // 5 minutos (acessos, status)
  MEDIUM: 5 * 60,

  // 15 minutos (pessoas, dados usuário)
  LONG: 15 * 60,

  // 1 hora (aulas, horários)
  VERY_LONG: 60 * 60,

  // 1 dia (dados estáticos)
  DAILY: 24 * 60 * 60
};

module.exports = {
  CACHE_KEYS,
  CACHE_TTL
};
