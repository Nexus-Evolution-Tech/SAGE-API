/**
 * Sanitizador de dados que saem da escola (RNF-11, LGPD).
 *
 * Regra inegociável: **nenhum dado pessoal pode sair da máquina da escola.** São dados de menores
 * de idade. Telemetria, rastreamento de erro e bundle de diagnóstico passam obrigatoriamente por
 * aqui.
 *
 * Por que isso é fácil de errar: um único `logger.error(pessoa)` ou um objeto de erro que carrega
 * o payload da requisição basta para vazar nome e CPF. Por isso o sanitizador precisa ser a única
 * saída possível, e a regra precisa ser verificada por teste automatizado — regra sem teste é
 * decoração.
 *
 * Estratégia: **lista de permissão pela chave, não lista de bloqueio.** Bloqueio falha por omissão
 * — basta alguém adicionar `nome_completo` e o dado escapa. Aqui, chave desconhecida cujo valor
 * seja texto livre é redigida por padrão.
 */

/** Campos sabidamente pessoais. Redigidos sempre, em qualquer profundidade. */
const CAMPOS_PESSOAIS = new Set([
  'nome', 'nome_completo', 'nomecompleto', 'nome_pessoa', 'pessoa_nome', 'nome_aluno',
  'cpf', 'rg', 'orgao_emissor_rg', 'email', 'e_mail', 'telefone', 'celular',
  'foto', 'fotos', 'imagem', 'user_image', 'user_images', 'caminho',
  'ra', 'rm', 'matricula', 'cartao_rfid', 'qr_code', 'qrcode', 'card_value',
  'senha', 'password', 'senha_acesso', 'token', 'token_hash', 'authorization',
  'data_nascimento', 'logradouro', 'endereco_residencial', 'complemento', 'bairro', 'cep',
  'responsavel', 'nome_responsavel', 'observacao', 'observacao_resposta', 'motivo'
]);

/** Campos técnicos seguros: ids, contadores, códigos, estados. */
const CAMPOS_TECNICOS_PERMITIDOS = new Set([
  'id', 'pessoa_id', 'dispositivo_id', 'unidade_id', 'turma_id', 'curso_id', 'area_id', 'schemaVersion',
  'aluno_id', 'professor_id', 'materia_id', 'sala_id', 'aula_id', 'control_id_device_id',
  'status', 'nivel', 'tipo', 'operacao', 'operation', 'metodo_auth', 'permitido',
  'total', 'count', 'n', 'quantidade', 'acessos', 'processados', 'ignorados',
  'falhasConsecutivas', 'retry_count', 'alcancavel', 'dispositivoAlcancavel',
  'statusHttp', 'codigo', 'code', 'errno', 'erro', 'name', 'versao', 'version',
  'ms', 'duracao', 'tempoDeRespostaMs', 'uptime', 'bytes', 'horasAtras',
  'ultimo_log_id_sincronizado', 'sync_enabled', 'porta', 'modelo', 'nivelLog'
]);

/**
 * Chaves cujo valor é texto TÉCNICO: deve ser preservado, mas passando pelos padrões de redação.
 *
 * Existe porque "redigir toda string de chave desconhecida" produzia um bundle seguro e INÚTIL —
 * `plataforma`, `fusoDoSistema` e a mensagem de erro do dispositivo saíam como [REDIGIDO], e sem
 * elas o diagnóstico remoto não responde nada.
 *
 * A distinção que importa: `motivoTecnico` é string gerada pela pilha de rede ("ECONNREFUSED"),
 * enquanto `motivo` é texto escrito por uma PESSOA sobre um aluno (justificativa de acesso) — este
 * segue redigido por inteiro, porque um nome escrito à mão nenhum padrão pega.
 */
const CAMPOS_TEXTO_TECNICO = new Set([
  'mensagem', 'message', 'stack', 'motivotecnico', 'ultimomotivo', 'texto', 'resumo',
  'plataforma', 'arquitetura', 'node', 'fusodosistema', 'pacote',
  'operacao', 'ultimaoperacaook', 'ultimaoperacaofalha', 'geradoem', 'em'
]);

const REDIGIDO = '[REDIGIDO]';

/** Padrões que denunciam dado pessoal dentro de texto livre (mensagem de erro, stack, log). */
const PADROES = [
  { nome: 'cpf', re: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g },
  // RG varia entre estados; só redigimos quando o texto identifica explicitamente o campo.
  { nome: 'rg', re: /\b(?:rg|registro\s+geral)\s*[:#-]?\s*[A-Z0-9.-]{5,14}\b/gi },
  { nome: 'email', re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g },
  { nome: 'telefone', re: /\b\(?\d{2}\)?\s?9?\d{4}-?\d{4}\b/g },
  // JWT aparece com frequência em mensagens de cliente HTTP e stack traces.
  { nome: 'jwt', re: /\bBearer\s+[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gi },
  { nome: 'jwt', re: /\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  // Caminhos de foto guardam o id da pessoa e às vezes o nome do arquivo original
  { nome: 'caminho_foto', re: /uploads[\/\\][\w\/\\.-]+/gi }
];

const QUERY_SECRETA = /([?&](?:token|key|senha|password|secret)=)[^&#\s]*/gi;

/** Redige dado pessoal dentro de uma string, preservando o que ajuda a diagnosticar. */
function sanitizarTexto(texto) {
  if (typeof texto !== 'string') return texto;
  let saida = texto;
  for (const { nome, re } of PADROES) {
    saida = saida.replace(re, `[${nome.toUpperCase()}_REDIGIDO]`);
  }
  return saida.replace(QUERY_SECRETA, '$1[QUERY_REDIGIDA]');
}

/**
 * Sanitiza uma estrutura arbitrária.
 *
 * @param {*} valor
 * @param {object} [opcoes]
 * @param {number} [opcoes.profundidadeMax] proteção contra estrutura cíclica/gigante
 */
function sanitizar(valor, opcoes = {}) {
  const profundidadeMax = opcoes.profundidadeMax ?? 8;
  return interno(valor, 0, profundidadeMax, new WeakSet());
}

function interno(valor, profundidade, profundidadeMax, vistos) {
  if (valor == null) return valor;
  if (profundidade > profundidadeMax) return '[PROFUNDO_DEMAIS]';

  if (typeof valor === 'string') return sanitizarTexto(valor);
  if (typeof valor === 'number' || typeof valor === 'boolean') return valor;
  if (valor instanceof Date) return valor.toISOString();

  if (valor instanceof Error) {
    return {
      name: valor.name,
      mensagem: sanitizarTexto(valor.message),
      // Stack é essencial para diagnóstico remoto, mas pode conter caminhos e valores.
      stack: valor.stack ? sanitizarTexto(String(valor.stack).split('\n').slice(0, 12).join('\n')) : null
    };
  }

  if (Array.isArray(valor)) {
    if (vistos.has(valor)) return '[CICLICO]';
    vistos.add(valor);
    return valor.slice(0, 200).map((v) => interno(v, profundidade + 1, profundidadeMax, vistos));
  }

  if (typeof valor === 'object') {
    if (vistos.has(valor)) return '[CICLICO]';
    vistos.add(valor);
    const saida = {};
    for (const [chave, v] of Object.entries(valor)) {
      const chaveNorm = String(chave).toLowerCase();

      if (CAMPOS_PESSOAIS.has(chaveNorm)) {
        saida[chave] = REDIGIDO;
        continue;
      }
      if (CAMPOS_TECNICOS_PERMITIDOS.has(chave) || CAMPOS_TECNICOS_PERMITIDOS.has(chaveNorm)) {
        saida[chave] = interno(v, profundidade + 1, profundidadeMax, vistos);
        continue;
      }
      if (CAMPOS_TEXTO_TECNICO.has(chaveNorm)) {
        saida[chave] = typeof v === 'string'
          ? sanitizarTexto(v)
          : interno(v, profundidade + 1, profundidadeMax, vistos);
        continue;
      }
      // Chave desconhecida: estrutura pode passar (para não perder diagnóstico), mas TEXTO LIVRE
      // é redigido. Falhar fechado é a única postura defensável com dado de menor de idade.
      if (typeof v === 'string') {
        saida[chave] = REDIGIDO;
      } else {
        saida[chave] = interno(v, profundidade + 1, profundidadeMax, vistos);
      }
    }
    return saida;
  }

  return '[TIPO_NAO_SUPORTADO]';
}

/**
 * Remove segredos da configuração, mantendo o que ajuda a diagnosticar.
 *
 * Para variável secreta NÃO devolvemos o valor nem a omitimos: devolvemos se ela está DEFINIDA.
 * Omitir seria mais seguro, mas destrói informação que resolve chamado — a pergunta mais comum
 * quando o banco não conecta é justamente "a senha está configurada?". `[DEFINIDO]` responde isso
 * sem revelar nada.
 */
function sanitizarConfiguracao(env = process.env) {
  const SEGREDO = /senha|password|secret|token|key|pass|pwd|smtp_user/i;
  const RELEVANTES = /^(NODE_ENV|PORT|HOST|LOG_LEVEL|API_VERSION|DB_|REDIS_|MONITOR_|CATRACA_|SYNC_|HEALTH_|PROMOCAO_|BACKUP_|JWT_|SMTP_|EMAIL_)/;
  const saida = {};
  for (const [chave, valor] of Object.entries(env)) {
    if (!RELEVANTES.test(chave)) continue;
    if (SEGREDO.test(chave)) {
      const texto = valor == null ? '' : String(valor);
      saida[chave] = texto.length > 0 ? '[DEFINIDO]' : '[NAO_DEFINIDO]';
      continue;
    }
    saida[chave] = String(valor);
  }
  return saida;
}

module.exports = {
  sanitizar,
  sanitizarTexto,
  sanitizarConfiguracao,
  CAMPOS_PESSOAIS,
  CAMPOS_TEXTO_TECNICO,
  REDIGIDO
};
