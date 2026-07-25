const deviceService = require('./deviceService');
const verificarEAtribuirPresenca = require('./presenceService');
const db = require('../config/database');
const { isSyncEnabled } = require('../utils/syncFlags');
const globalState = require('../state/globalState');

// Deve ser o MESMO valor do controlIdService (catracaUserId = offset + pessoa.id)
const USER_ID_OFFSET = parseInt(process.env.CATRACA_USER_ID_OFFSET || '111000000');

// Mapeamento portal_id → entrada/saída. Na catraca, o sentido do giro é configurado por portal:
// normalmente giro à esquerda = portal de entrada, giro à direita = portal de saída (ou o contrário).
const ENTRADA_PORTAL_ID = parseInt(process.env.CATRACA_ENTRADA_PORTAL_ID || '1', 10);
const SAIDA_PORTAL_ID = parseInt(process.env.CATRACA_SAIDA_PORTAL_ID || '2', 10);

function formatarUserId(user_id) {
  const str = String(user_id).replace(/^0+/, '');
  return parseInt(str.slice(-7), 10);
}

/** user_id da catraca → nosso pessoa_id. Aceita: offset+id (SAGE) ou id direto (software oficial). */
function userIdCatracaParaPessoaId(user_id) {
  const n = Number(user_id);
  if (n >= USER_ID_OFFSET) {
    return formatarUserId(n - USER_ID_OFFSET);
  }
  return formatarUserId(n);
}

// Determina o tipo de autenticação pelo valor lido
// ATENÇÃO: os valores devolvidos aqui vão direto para Acesso.metodo_auth, que é
// ENUM('QR_CODE', 'CARTAO_RFID', 'SENHA', 'BIOMETRIA'). Antes esta função devolvia 'QRCODE',
// sem underscore — e com o MySQL em STRICT_TRANS_TABLES o INSERT FALHAVA, abortando a
// sincronização inteira. Como o ponteiro só avança no fim do laço, a sync rebuscava o mesmo lote
// e travava de novo no mesmo log: paralisia permanente. Ver test/regressao-metodo-auth.test.js.
function mapearMetodo(value) {
  return String(value).length === 8 ? 'QR_CODE' : 'CARTAO_RFID';
}

// Determina se é entrada ou saída pelo portal_id (sentido do giro na catraca: esquerda/direita).
// Portal de entrada = normalmente giro à esquerda; portal de saída = giro à direita (configurável no equipamento).
function identificarAcesso(portal_id) {
  const pid = portal_id != null ? Number(portal_id) : ENTRADA_PORTAL_ID;
  if (pid === SAIDA_PORTAL_ID) return 'SAIDA';
  if (pid === ENTRADA_PORTAL_ID) return 'ENTRADA';
  // Fallback: portal_id 1 = entrada (comportamento antigo)
  return pid === 1 ? 'ENTRADA' : 'SAIDA';
}

// Converte timestamp Unix (UTC) da catraca para Date em UTC (guardamos UTC no banco; o frontend exibe em horário local)
function timestampParaData(time) {
  return new Date(time * 1000); // timestamp Unix em segundos → Date UTC
}

// Converte data_hora do banco para Unix seconds (UTC), para comparar com log.time da catraca.
// String "YYYY-MM-DD HH:mm:ss" sem Z: tratar como UTC. Date (MySQL driver): pode vir em local;
// usar getTime() direto (instante absoluto) — a margem de 1h no timestampInicial cobre diferenças.
function dataHoraParaTimestampUnix(dataHora) {
  if (dataHora == null) return 0;
  if (typeof dataHora === 'string' && !/Z|[+-]\d{2}:?\d{2}$/.test(dataHora)) {
    return Math.floor(new Date(dataHora.replace(' ', 'T') + 'Z').getTime() / 1000);
  }
  const d = dataHora instanceof Date ? dataHora : new Date(dataHora);
  return Math.floor(d.getTime() / 1000);
}

// Calcula idade
function calcularIdade(dataNascimento) {
  const hoje = new Date();
  const nascimento = new Date(dataNascimento);
  let idade = hoje.getFullYear() - nascimento.getFullYear();
  const mes = hoje.getMonth() - nascimento.getMonth();
  if (mes < 0 || (mes === 0 && hoje.getDate() < nascimento.getDate())) idade--;
  return idade;
}

// Sincroniza acessos de um dispositivo.
// options.monitorOnly = true: busca só os últimos N logs (monitoramento leve, não atualiza ultimo_log_id_sincronizado).
async function sincronizarAcessos(dispositivo, options = {}) {
  const MIN_ID = parseInt(process.env.CATRACA_MIN_LOG_ID || '0', 10); // 0 = não filtrar por id (só por timestamp)
  const logger = require('../config/logger');
  const monitorOnly = options.monitorOnly === true;
  const monitorLimit = parseInt(process.env.MONITOR_SYNC_LIMIT || '200', 10);

  if (MIN_ID > 0 && !monitorOnly) {
    logger.debug(`[SYNC] ${dispositivo.nome}: ignorando logs da catraca com id <= ${MIN_ID} (CATRACA_MIN_LOG_ID)`);
  }

  if (!isSyncEnabled(dispositivo?.sync_enabled)) {
    logger.info(`[SYNC] ${dispositivo.nome}: sincronização desativada (flag no dispositivo)`);
    return {
      sucesso: false,
      message: `Sincronização desativada para ${dispositivo.nome}`,
      dispositivo_id: dispositivo.id,
      nome: dispositivo.nome,
      acessosSincronizados: 0,
      sincronizacaoDesativada: true
    };
  }

  const link = deviceService.linkCatraca(dispositivo);
  const session = await deviceService.obterSessao(link, dispositivo);

  if (!session) {
    return { sucesso: false, message: `Erro ao obter sessão com a catraca ${dispositivo.nome}` };
  }

  // Modo monitor: só os últimos N logs (ordem descendente), sem puxar histórico pesado
  let loadOptions = {};
  let timestampInicial = 0;
  if (monitorOnly) {
    loadOptions = { limit: Math.max(50, Math.min(monitorLimit, 500)), order: ['descending', 'id'] };
  } else {
    // Último acesso sincronizado: usar id DESC (mesmo critério da tela) e recuar 1h para não perder logs por fuso/relógio
    const [ultimoAcessoResult] = await db.query(
      'SELECT * FROM Acesso WHERE dispositivo_id = ? ORDER BY id DESC LIMIT 1',
      [dispositivo.id]
    );
    const ultimoAcesso = ultimoAcessoResult[0];
    const ts = ultimoAcesso ? dataHoraParaTimestampUnix(ultimoAcesso.data_hora) : 0;
    const MARGEM_SEGUNDOS = 3600; // 1 hora: evita perder logs recentes por diferença de fuso/relógio
    timestampInicial = Math.max(0, ts - MARGEM_SEGUNDOS);

    // Opção de pedir só logs com id > ultimo_log_id_sincronizado (reduz carga quando há muitos registros na catraca)
    const lastLogId = dispositivo.ultimo_log_id_sincronizado != null ? Number(dispositivo.ultimo_log_id_sincronizado) : null;
    loadOptions = lastLogId != null && lastLogId >= 0 ? { lastLogId } : {};

    // 🔴 Quando temos ponteiro, o filtro por timestamp é DESLIGADO — ele é uma heurística, e aqui
    // era ativamente nocivo.
    //
    // Provado por execução: o pool usa `timezone: '-03:00'`, então o driver interpreta o DATETIME
    // (que gravamos em UTC) como se fosse -03:00 e devolve um instante 3h NO FUTURO. Logo:
    //   timestampInicial = tempoReal + 10800 − 3600 = tempoReal + 7200
    // ou seja, a janela de retomada pulava 2 horas de logs, permanentemente. Com logs a cada 90s,
    // isso descartava 80 de 120 acessos. Ver test/recuperacao-apos-queda.test.js.
    //
    // O ponteiro por id é exato e não depende de fuso. O timestamp segue valendo apenas na
    // PRIMEIRA sincronização (quando não há ponteiro), onde ele é 0 e não filtra nada.
    //
    // A causa raiz (round-trip de DATETIME com 3h de desvio) afeta também exibição e relatório, e
    // é tratada na Fase 6 (armazenar em UTC, converter só na borda). Ver test/fuso-horario.test.js.
    if (lastLogId != null && lastLogId >= 0) {
      timestampInicial = 0;
    }
  }

  // Uma requisição à catraca por dispositivo (load_objects); depois só processamos a lista em memória e gravamos no nosso banco (sem nova chamada à catraca por pessoa).
  // RNF-4: obterLogsCatraca agora LANÇA em caso de falha, em vez de devolver [] — antes era
  // impossível distinguir "catraca offline" de "sem acessos novos". Aqui a falha vira um
  // resultado explícito, para o chamador e a tela de status saberem o que aconteceu.
  let logs;
  try {
    logs = await deviceService.obterLogsCatraca(session, link, timestampInicial, loadOptions);
  } catch (erro) {
    logger.error(`[SYNC] ${dispositivo.nome}: falha ao obter logs — ${erro.message}`);
    return {
      sucesso: false,
      message: `Falha ao obter logs de ${dispositivo.nome}: ${erro.message}`,
      dispositivo_id: dispositivo.id,
      nome: dispositivo.nome,
      acessosSincronizados: 0,
      falhaDispositivo: true,
      dispositivoAlcancavel: erro.dispositivoAlcancavel === true,
      diagnostico: typeof erro.paraDiagnostico === 'function' ? erro.paraDiagnostico() : undefined
    };
  }

  // Proteção: se a API da catraca ignorar limit e devolver 49k, em modo monitor processamos só os primeiros N para não travar
  const maxProcessarMonitor = Math.max(50, Math.min(monitorLimit, 500));
  if (monitorOnly && logs.length > maxProcessarMonitor) {
    logger.debug(`[MONITOR] ${dispositivo.nome}: API devolveu ${logs.length} logs; processando só os ${maxProcessarMonitor} mais recentes`);
    logs = logs.slice(0, maxProcessarMonitor);
  }

  // Se não veio nenhum log mas temos último acesso, pode ser timestamp errado: buscar últimas 24h (mais uma requisição, só em modo full)
  if (!monitorOnly && logs.length === 0) {
    const [ultimoAcessoResult2] = await db.query(
      'SELECT * FROM Acesso WHERE dispositivo_id = ? ORDER BY id DESC LIMIT 1',
      [dispositivo.id]
    );
    const ultimoAcesso = ultimoAcessoResult2[0];
    const lastLogId = dispositivo.ultimo_log_id_sincronizado != null ? Number(dispositivo.ultimo_log_id_sincronizado) : null;
    if (ultimoAcesso && lastLogId == null) {
      const fallbackTs = Math.max(0, Math.floor(Date.now() / 1000) - 24 * 3600);
      logger.info(`[SYNC] ${dispositivo.nome}: 0 logs com timestampInicial=${timestampInicial}; tentando desde ${fallbackTs} (24h atrás)`);
      try {
        logs = await deviceService.obterLogsCatraca(session, link, fallbackTs, {});
      } catch (erro) {
        // O fallback é uma tentativa extra e best-effort: se falhar, mantemos a lista vazia da
        // primeira chamada (que teve sucesso) e seguimos. Registrado, nunca engolido.
        logger.warn(`[SYNC] ${dispositivo.nome}: fallback de 24h também falhou — ${erro.message}`);
      }
    }
    // TODO(F2b): a versão de `nao-funcional` fazia este fallback SEMPRE que logs.length === 0,
    // sem exigir `lastLogId == null`. Ela cobre um modo de falha real e já observado: se
    // `ultimo_log_id_sincronizado` ficar alto demais, o filtro exclui tudo e a sync trava em 0
    // logs para sempre (ver docs/ANALISE_SYNC_CONTROL_ID.md: 48.057 logs → 0 inseridos).
    // Mantida a versão da ponta aqui por ser consolidação (preserva comportamento) e por ela ter
    // a proteção de `maxProcessarMonitor` que a outra não tinha. Decidir com teste na Fase 2b.
  }

  // Diagnóstico e ajuste: se o último acesso no banco está à frente do relógio da catraca, nenhum log passaria. Processar TODOS os logs já trazidos (ex.: fallback 24h) para não perder acesso de hoje (ex.: 13h).
  let effectiveTimestampInicial = timestampInicial;
  if (logs.length > 0) {
    const ids = logs.map((l) => (l.id != null ? Number(l.id) : NaN)).filter((n) => !isNaN(n));
    const times = logs.map((l) => (l.time != null ? Number(l.time) : NaN)).filter((n) => !isNaN(n));
    const minId = ids.length ? Math.min(...ids) : null;
    const maxId = ids.length ? Math.max(...ids) : null;
    const minTime = times.length ? Math.min(...times) : null;
    const maxTime = times.length ? Math.max(...times) : null;
    if (maxTime != null && timestampInicial > maxTime) {
      effectiveTimestampInicial = Math.max(0, (minTime != null ? minTime - 1 : 0));
      logger.warn(
        `[SYNC] ${dispositivo.nome}: timestampInicial (${timestampInicial}) à frente do max time da catraca (${maxTime}). Processando todos os ${logs.length} logs já trazidos (effectiveTimestampInicial=${effectiveTimestampInicial}) para incluir acessos de hoje (ex.: 13h).`
      );
    }
    const passamPrimeiroFiltro = logs.filter((l) => (l.id != null && Number(l.id) > MIN_ID) && (l.time != null && Number(l.time) > effectiveTimestampInicial)).length;
    logger.info(
      `[SYNC] ${dispositivo.nome}: diagnóstico catraca → id [${minId}, ${maxId}], time [${minTime}, ${maxTime}], effectiveTimestampInicial=${effectiveTimestampInicial}, MIN_ID=${MIN_ID}, passam 1º filtro=${passamPrimeiroFiltro}/${logs.length}`
    );
    if (passamPrimeiroFiltro === 0 && MIN_ID > 0 && maxId != null && maxId < MIN_ID) {
      logger.warn(
        `[SYNC] ${dispositivo.nome}: CATRACA_MIN_LOG_ID=${MIN_ID} é maior que o maior id da catraca (${maxId}). Nenhum log será processado. Use CATRACA_MIN_LOG_ID=0 ou um valor <= ${maxId}.`
      );
    }
  }

  // Ordem de processamento — a escolha aqui tem consequência de PERDA DE DADOS, não só de UX.
  //
  // Monitor (monitorOnly): do mais recente ao mais antigo. É o que a pessoa vê na tela ao ligar o
  // computador, e é onde a percepção de rapidez importa. Este caminho não move o ponteiro.
  //
  // Full sync: do MAIS ANTIGO ao mais recente, por id. Antes era decrescente aqui também, e isso
  // criava um buraco permanente: uma queda no meio gravava os acessos NOVOS e deixava os VELHOS,
  // e o resume seguinte partia do último acesso gravado menos 1h — excluindo os antigos para
  // sempre. Com os logs cobrindo mais de 1h, havia perda silenciosa garantida.
  // Provado em test/recuperacao-apos-queda.test.js (120 logs em 148 min → 3 perdidos).
  //
  // Em ordem crescente, o ponteiro avança junto com o progresso real e a retomada é exata.
  if (monitorOnly) {
    logs.sort((a, b) => (Number(b?.time) || 0) - (Number(a?.time) || 0));
  } else {
    logs.sort((a, b) => (Number(a?.id) || 0) - (Number(b?.id) || 0));
  }

  let acessosSincronizados = 0;
  // Maior id de log EFETIVAMENTE gravado — diferente do maior id buscado. O ponteiro tem de
  // refletir o que entrou no banco, não o que veio da catraca.
  let maiorLogIdGravado = 0;
  const PASSO_PONTEIRO = parseInt(process.env.SYNC_PASSO_PONTEIRO || '25', 10);
  let ignoradosPessoa = 0;
  let ignoradosDuplicata = 0;
  const globalState = require('../state/globalState');
  const { emitToRoom } = require('../websocket/wsServer');
  const { cacheMutation, invalidateMultiple, CACHE_KEYS } = require('../cache/helpers');
  const { emitNotification } = require('./notificationService');

  // Processar lista em memória: só MySQL (SELECT/INSERT); nenhuma nova requisição à catraca.
  for (const log of logs) {
    if (log.id <= MIN_ID || log.time <= effectiveTimestampInicial) continue;
    if (log.user_id == null || log.user_id === 0 || String(log.user_id).trim() === '') continue;

    const pessoa_id = userIdCatracaParaPessoaId(log.user_id);
    if (pessoa_id == null || isNaN(pessoa_id) || pessoa_id < 1) continue;

    const [pessoaResult] = await db.query('SELECT * FROM Pessoa WHERE id = ? LIMIT 1', [pessoa_id]);
    const pessoa = pessoaResult[0];
    if (!pessoa) {
      ignoradosPessoa++;
      logger.debug(`[SYNC] Ignorando: user_id=${log.user_id} → pessoa_id=${pessoa_id} não existe`);
      continue;
    }
    const dispositivo_id = dispositivo.id;
    const data_hora = timestampParaData(log.time);
    // Guardar em UTC como string para ORDER BY data_hora DESC mostrar o mais recente (conexão MySQL usa -03:00)
    const data_hora_utc = data_hora.toISOString().slice(0, 19).replace('T', ' ');
    const status = identificarAcesso(log.portal_id);
    const metodo_auth = mapearMetodo(log.card_value);
    const permitido = true;

    // Verifica se já existe: tenta por UTC e por Date (registros antigos podem estar em horário Brasil)
    let [acessoExistenteResult] = await db.query(
      'SELECT * FROM Acesso WHERE pessoa_id = ? AND dispositivo_id = ? AND data_hora = ? LIMIT 1',
      [pessoa_id, dispositivo_id, data_hora_utc]
    );
    if (!acessoExistenteResult[0]) {
      [acessoExistenteResult] = await db.query(
        'SELECT * FROM Acesso WHERE pessoa_id = ? AND dispositivo_id = ? AND data_hora = ? LIMIT 1',
        [pessoa_id, dispositivo_id, data_hora]
      );
    }
    const acessoExistente = acessoExistenteResult[0];
    if (acessoExistente) ignoradosDuplicata++;

    if (!acessoExistente) {
      await db.query(
        `INSERT INTO Acesso (pessoa_id, dispositivo_id, status, permitido, metodo_auth, data_hora, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [pessoa_id, dispositivo_id, status, permitido, metodo_auth, data_hora_utc, new Date()]
      );
      acessosSincronizados++;

      // Avanço PROGRESSIVO do ponteiro (só no full sync, e só em ordem crescente de id).
      // Se o processo morrer agora, a retomada começa exatamente daqui — em vez de depender do
      // filtro por timestamp, que já provocou perda permanente de acessos antigos.
      // A cada N para não transformar isto em uma escrita por linha (HD mecânico).
      if (!monitorOnly && Number.isFinite(Number(log.id))) {
        maiorLogIdGravado = Math.max(maiorLogIdGravado, Number(log.id));
        if (acessosSincronizados % PASSO_PONTEIRO === 0) {
          try {
            await db.query(
              'UPDATE Dispositivo SET ultimo_log_id_sincronizado = ? WHERE id = ?',
              [maiorLogIdGravado, dispositivo.id]
            );
          } catch (e) {
            logger.error(`[SYNC] ${dispositivo.nome}: falha ao avançar ponteiro: ${e.message}`);
          }
        }
      }

      try {
        globalState.incrementAcessoTodiaSuccesso();
        emitToRoom('acessos', 'acesso:novo', {
          pessoa_id,
          dispositivo_id,
          status,
          permitido: true,
          data_hora: data_hora.toISOString(),
          pessoa_nome: pessoa?.nome
        });
        emitToRoom('stats', 'stats:update', globalState.getStats());
      } catch (e) {
        // não falhar a sync por causa de WebSocket
      }

      await verificarEAtribuirPresenca(pessoa_id, data_hora);
      logger.debug(`[SYNC] Acesso registrado: ${pessoa.nome} (pessoa_id=${pessoa_id}) em ${dispositivo.nome}`);
      // Invalidar cache logo após inserir para F5 na tela de monitoramento mostrar o novo acesso
      try {
        await invalidateMultiple([CACHE_KEYS.INVALIDATE_ACESSOS, CACHE_KEYS.ACESSOS_HOJE]);
      } catch (e) { /* ignorar */ }
    }
  }

  logger.info(
    `[SYNC] ${dispositivo.nome}: effectiveTimestampInicial=${effectiveTimestampInicial}, logs=${logs.length}, ` +
    `inseridos=${acessosSincronizados}, ignorados(pessoa)=${ignoradosPessoa}, ignorados(duplicata)=${ignoradosDuplicata}`
  );

  // Persistir maior log.id da catraca para próxima sync pedir só id > ultimo_log_id_sincronizado (apenas em sync full, não em monitor)
  if (!monitorOnly) {
    const logIds = logs.map((l) => (l.id != null ? Number(l.id) : NaN)).filter((n) => !isNaN(n));
    if (logIds.length > 0) {
      const maxLogId = Math.max(...logIds);
      const currentMax = dispositivo.ultimo_log_id_sincronizado != null ? Number(dispositivo.ultimo_log_id_sincronizado) : 0;
      const newMax = Math.max(maxLogId, currentMax);
      try {
        await db.query(
          'UPDATE Dispositivo SET ultimo_log_id_sincronizado = ? WHERE id = ?',
          [newMax, dispositivo.id]
        );
        logger.debug(`[SYNC] ${dispositivo.nome}: ultimo_log_id_sincronizado = ${newMax}`);
      } catch (e) {
        logger.debug(`[SYNC] Não foi possível atualizar ultimo_log_id_sincronizado: ${e.message}`);
      }
    }
  }

  // Invalidar cache da lista sempre que rodar sync (para GET /acessos devolver dados frescos)
  try {
    await cacheMutation(() => {}, [CACHE_KEYS.INVALIDATE_ACESSOS, CACHE_KEYS.ACESSOS_HOJE]);
  } catch (e) { /* ignorar */ }
  if (acessosSincronizados > 0) {
    logger.info(`[SYNC] ${dispositivo.nome}: ${acessosSincronizados} novo(s) acesso(s) inserido(s)`);
    try {
      emitNotification({
        title: 'Sincronização de acessos concluída',
        message: `${acessosSincronizados} acesso(s) sincronizado(s) para ${dispositivo.nome}.`,
        type: 'info',
      });
    } catch (e) { /* ignorar */ }
  }

  return {
    message: `${acessosSincronizados} acessos sincronizados para ${dispositivo.nome}`,
    dispositivo_id: dispositivo.id,
    nome: dispositivo.nome,
    sucesso: true,
    acessosSincronizados
  };
}

// Sincroniza todos os dispositivos com sincronizar = 1 (sync pesada: boot + cron 10min)
async function sincronizarTodosAcessos() {
  const [dispositivos] = await db.query(
    "SELECT * FROM Dispositivo WHERE COALESCE(sync_enabled, 1) = 1"
  );
  const resultados = [];

  if (!dispositivos || dispositivos.length === 0) return resultados;

  for (const dispositivo of dispositivos) {
    if (globalState.isDeviceZerando(dispositivo.id)) {
      resultados.push({ dispositivo: dispositivo.nome, acessosSincronizados: 0, ignorado: true, motivo: 'zerando logs' });
      continue;
    }
    const resultado = await sincronizarAcessos(dispositivo);
    resultados.push(resultado);
  }

  return resultados;
}

// Monitoramento leve: últimos N logs de TODOS os dispositivos (polling 20s). Não atualiza ultimo_log_id_sincronizado.
async function sincronizarTodosAcessosMonitor() {
  const [dispositivos] = await db.query('SELECT * FROM Dispositivo');
  const resultados = [];

  if (!dispositivos || dispositivos.length === 0) return resultados;

  for (const dispositivo of dispositivos) {
    // D-5: guardas complementares, ambas mantidas. A de nao-funcional (sync desativada) vem de
    // `sync_ativo`, renomeada para `sync_enabled` pela decisão D-1.
    if (!isSyncEnabled(dispositivo?.sync_enabled)) {
      logger.debug(`[SYNC] Sync desativado para dispositivo ${dispositivo.nome}, pulando sincronização de acessos`);
      resultados.push({ sucesso: false, message: `Sincronização desativada para ${dispositivo.nome}`, dispositivoId: dispositivo.id });
      continue;
    }

    const resultado = await sincronizarAcessos(dispositivo, { monitorOnly: true });
    resultados.push(resultado);
  }

  return resultados;
}

// Criar acesso manual
async function criarAcesso(dados) {
  let { pessoa_id, dispositivo_id, status, permitido, metodo_auth } = dados;

  // Pessoa existe?
  const [pessoaResult] = await db.query('SELECT * FROM Pessoa WHERE id = ? LIMIT 1', [pessoa_id]);
  const pessoa = pessoaResult[0];
  if (!pessoa) return { message: 'Pessoa não encontrada', error: 'PESSOA_INEXISTENTE' };

  // Calcula idade
  const idadePessoa = calcularIdade(pessoa.data_nascimento || new Date());

  // Último acesso
  const [ultimoAcessoResult] = await db.query(
    'SELECT * FROM Acesso WHERE pessoa_id = ? ORDER BY data_hora DESC LIMIT 1',
    [pessoa.id]
  );
  const ultimoAcesso = ultimoAcessoResult[0];

  if (status === 'ENTRADA' && ultimoAcesso?.status === 'ENTRADA') {
    return { message: 'Usuário já está dentro, não pode entrar novamente sem sair' };
  }
  if (status === 'SAIDA' && (!ultimoAcesso || ultimoAcesso.status !== 'ENTRADA')) {
    return { message: 'Usuário não está dentro, não pode sair sem entrar antes' };
  }

  // Permissão básica
  permitido = true;
  let mensagem = `Acesso autorizado para ${pessoa.nome}`;

  // Insere acesso
  await db.query(
    `INSERT INTO Acesso (pessoa_id, dispositivo_id, status, permitido, metodo_auth, data_hora, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [pessoa_id, dispositivo_id, status, permitido, metodo_auth, new Date(), new Date()]
  );

  const [acessoResult] = await db.query('SELECT * FROM Acesso WHERE id = LAST_INSERT_ID() LIMIT 1');
  const acesso = acessoResult[0];

  return { message: mensagem, acesso };
}

/**
 * Processa o payload POST /api/notifications/dao enviado pelo Monitor da Control iD.
 * Documentação: https://www.controlid.com.br/docs/access-api-pt/monitor/introducao-ao-monitor/
 * @param {object} payload - { object_changes: [{ object, type, values }], device_id }
 * @returns {Promise<{ processados: number, ignorados: number, erros: string[] }>}
 */
async function processarNotificacaoMonitorDao(payload) {
  const logger = require('../config/logger');
  const { emitToRoom } = require('../websocket/wsServer');
  const globalState = require('../state/globalState');
  const { cacheMutation, invalidateMultiple, CACHE_KEYS } = require('../cache/helpers');

  const result = { processados: 0, ignorados: 0, erros: [] };
  // Contador de tentativas com identificação não cadastrada. Era usado nas linhas abaixo sem
  // nunca ter sido declarado, o que lançava ReferenceError (o `++` lê antes de escrever, então
  // falha inclusive em modo não-strict). Coberto por test/regressao-monitor-dao.test.js.
  let tentativasNegadas = 0;
  const deviceIdControlId = payload.device_id != null ? Number(payload.device_id) : null;
  const objectChanges = Array.isArray(payload.object_changes) ? payload.object_changes : [];

  if (objectChanges.length === 0) {
    return result;
  }

  if (deviceIdControlId == null) {
    logger.warn('[MONITOR DAO] Payload sem device_id');
    result.erros.push('device_id ausente');
    return result;
  }

  // Resolve nosso dispositivo: por control_id_device_id ou fallback único dispositivo
  let dispositivo_id = null;
  try {
    const [dispositivosRows] = await db.query(
      'SELECT id, nome FROM Dispositivo WHERE control_id_device_id = ? LIMIT 1',
      [deviceIdControlId]
    );
    dispositivo_id = dispositivosRows[0]?.id;
  } catch (e) {
    if (e.code === 'ER_BAD_FIELD_ERROR') {
      logger.warn('[MONITOR DAO] Coluna control_id_device_id não existe. Execute database/migration_control_id_device_id.sql');
    }
  }
  if (!dispositivo_id) {
    const [todos] = await db.query('SELECT id, nome FROM Dispositivo');
    if (todos.length === 1) {
      dispositivo_id = todos[0].id;
      logger.debug(`[MONITOR DAO] device_id ${deviceIdControlId} mapeado para único dispositivo id ${dispositivo_id}`);
    } else {
      const total = todos.length;
      logger.warn(
        `[MONITOR DAO] Você tem ${total} dispositivo(s) cadastrado(s). O device_id ${deviceIdControlId} da catraca não está mapeado. ` +
          'Rode database/migration_control_id_device_id.sql e preencha control_id_device_id em cada Dispositivo (use o device_id que aparece neste log).'
      );
      result.erros.push(`Dispositivo não mapeado para device_id ${deviceIdControlId}`);
      return result;
    }
  }

  const maxEventAgeSeconds = parseInt(process.env.MONITOR_MAX_EVENT_AGE_SECONDS || '300', 10); // 5 min padrão (proteção replay)
  const nowUnix = Math.floor(Date.now() / 1000);

  for (const change of objectChanges) {
    if (change.object !== 'access_logs' || change.type !== 'inserted' || !change.values) {
      result.ignorados++;
      continue;
    }

    const v = change.values;
    const time = v.time != null ? Number(v.time) : null;
    const user_id_catraca = v.user_id != null ? Number(v.user_id) : null;
    const portal_id = v.portal_id != null ? Number(v.portal_id) : 1;
    let card_value = String(v.card_value != null ? v.card_value : '');
    if (card_value.length > 64) card_value = card_value.slice(0, 64);

    if (time == null || Number.isNaN(time)) {
      result.ignorados++;
      continue;
    }

    if (maxEventAgeSeconds > 0 && (nowUnix - time > maxEventAgeSeconds || time > nowUnix + 60)) {
      logger.debug(`[MONITOR DAO] Evento ignorado (replay/antigo): time=${time}, now=${nowUnix}, maxAge=${maxEventAgeSeconds}s`);
      result.ignorados++;
      continue;
    }

    const pessoa_id = userIdCatracaParaPessoaId(user_id_catraca);
    if (pessoa_id == null || !Number.isInteger(pessoa_id) || pessoa_id < 1) {
      tentativasNegadas++;
      result.ignorados++;
      continue;
    }
    const data_hora = timestampParaData(time);
    const status = identificarAcesso(portal_id);
    const metodo_auth = mapearMetodo(card_value);
    const permitido = true;

    const [pessoaResult] = await db.query('SELECT id, nome FROM Pessoa WHERE id = ? LIMIT 1', [pessoa_id]);
    const pessoa = pessoaResult[0];
    if (!pessoa) {
      tentativasNegadas++;
      logger.debug(`[MONITOR DAO] Pessoa id ${pessoa_id} não existe, ignorando log`);
      result.ignorados++;
      continue;
    }

    const [acessoExistenteResult] = await db.query(
      'SELECT id FROM Acesso WHERE pessoa_id = ? AND dispositivo_id = ? AND data_hora = ? LIMIT 1',
      [pessoa_id, dispositivo_id, data_hora]
    );
    if (acessoExistenteResult[0]) {
      result.ignorados++;
      continue;
    }

    try {
      await db.query(
        `INSERT INTO Acesso (pessoa_id, dispositivo_id, status, permitido, metodo_auth, data_hora, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [pessoa_id, dispositivo_id, status, permitido, metodo_auth, data_hora, new Date()]
      );
      result.processados++;

      globalState.incrementAcessoTodiaSuccesso();
      emitToRoom('acessos', 'acesso:novo', {
        pessoa_id,
        dispositivo_id,
        status,
        permitido: true,
        data_hora: data_hora.toISOString(),
        pessoa_nome: pessoa.nome
      });
      emitToRoom('stats', 'stats:update', globalState.getStats());

      await verificarEAtribuirPresenca(pessoa_id, data_hora);
      logger.debug(`[MONITOR DAO] Acesso registrado: pessoa ${pessoa_id}, dispositivo ${dispositivo_id}`);
    } catch (err) {
      logger.error(`[MONITOR DAO] Erro ao inserir acesso: ${err.message}`);
      result.erros.push(err.message);
    }
  }

  if (result.processados > 0) {
    try {
      await cacheMutation(() => {}, [CACHE_KEYS.INVALIDATE_ACESSOS, CACHE_KEYS.ACESSOS_HOJE]);
      emitNotification({
        title: 'Sincronização de acessos concluída',
        message: `${result.processados} acesso(s) registrado(s) via Monitor (catraca).`,
        type: 'info',
      });
    } catch (e) { /* ignorar */ }
  }
  if (tentativasNegadas > 0) {
    try {
      emitNotification({
        title: 'Acesso negado / tentativa inválida',
        message: `${tentativasNegadas} tentativa(s) de acesso com identificação não cadastrada.`,
        type: 'warning',
      });
    } catch (e) { /* ignorar */ }
  }

  return result;
}

module.exports = {
  sincronizarAcessos,
  sincronizarTodosAcessos,
  sincronizarTodosAcessosMonitor,
  criarAcesso,
  processarNotificacaoMonitorDao
};
