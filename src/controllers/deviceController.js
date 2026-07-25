const path = require('path');
const deviceService = require('../services/deviceService');
const gerarController = require('./genericControllerFactory');
const { buscarTodos } = require('../utils/generic-db-utils');
const { discoverControlId, getLocalPrivateCidrs } = require('../services/networkDiscoveryService');
const { criarRegistro } = require('../utils/generic-db-utils');
const db = require('../config/database');
const { cacheMutation } = require('../cache/helpers');
const logger = require('../config/logger');
const { emitNotification } = require('../services/notificationService');
const { isSyncEnabled } = require('../utils/syncFlags');
const { limparUsuariosPorPrefixo11 } = require('../utils/controlId-utils');
const globalState = require('../state/globalState');
const catracaImportService = require('../services/catracaImportService');

const tabela = 'Dispositivo';

/** Valida id de dispositivo (params): deve ser inteiro positivo. Retorna id numérico ou null. */
function parseDispositivoId(idParam) {
  const n = parseInt(idParam, 10);
  if (Number.isNaN(n) || n < 1) return null;
  return n;
}
// Colunas conforme o banco (control_id_device_id e ultimo_log_id_sincronizado vêm de migrations; para sync usamos SELECT * em accessService)
const campos = ['id', 'nome', 'modelo', 'endereco', 'porta', 'usuario', 'senha', 'status', 'sync_enabled', 'last_health_check', 'area_id', 'numero_serial', 'created_at', 'updated_at'];
const camposInsert = campos.filter((c) => c !== 'id');

const getStatus = async (req, res) => {
  const statusDispositivos = [];
  const dispositivos = await buscarTodos(tabela, campos);

  if (!dispositivos) {
    return res.status(500).json({ message: 'Erro ao buscar dispositivos do banco de dados' });
  }

  for (const dispositivo of dispositivos) {
    if (!isSyncEnabled(dispositivo.sync_enabled)) {
      statusDispositivos.push({ id: dispositivo.id, nome: dispositivo.nome, status: 'SYNC_DESATIVADA' });
      continue;
    }

    const link = deviceService.linkCatraca(dispositivo);
    const session = await deviceService.obterSessao(link, dispositivo);

    if (!session) {
      statusDispositivos.push({ id: dispositivo.id, nome: dispositivo.nome, status: 'OFFLINE' });
      continue;
    }

    const sessaoValida = await deviceService.verificarSessao(session, link);
    if (sessaoValida) {
      statusDispositivos.push({ id: dispositivo.id, nome: dispositivo.nome, status: 'ONLINE' });
      deviceService.configurarMonitorNaCatraca(dispositivo).catch((err) =>
        logger.debug(`[MONITOR] Config ao listar status ${dispositivo.nome}: ${err.message}`)
      );
    } else {
      statusDispositivos.push({ id: dispositivo.id, nome: dispositivo.nome, status: 'Sessão inválida' });
    }
  }

  res.json(statusDispositivos);
};

const getStatusId = async (req, res) => {
  const id = parseDispositivoId(req.params.id);
  if (id == null) {
    return res.status(400).json({ message: 'ID do dispositivo inválido' });
  }
  const dispositivos = await buscarTodos(tabela, campos);

  if (!dispositivos) {
    return res.status(500).json({ message: 'Erro ao buscar dispositivos do banco de dados' });
  }

  const dispositivo = dispositivos.find(d => d.id == id);

  if (!dispositivo) {
    return res.status(404).json({ message: 'Dispositivo não encontrado' });
  }

  if (!isSyncEnabled(dispositivo.sync_enabled)) {
    return res.json({ id: dispositivo.id, nome: dispositivo.nome, status: 'SYNC_DESATIVADA' });
  }

  const link = deviceService.linkCatraca(dispositivo);
  const session = await deviceService.obterSessao(link, dispositivo);

  if (!session) {
    return res.json({ id: dispositivo.id, nome: dispositivo.nome, status: 'OFFLINE' });
  }

  const sessaoValida = await deviceService.verificarSessao(session, link);
  if (sessaoValida) {
    deviceService.configurarMonitorNaCatraca(dispositivo).catch((err) =>
      logger.debug(`[MONITOR] Config ao verificar status ${dispositivo.nome}: ${err.message}`)
    );
    return res.json({ id: dispositivo.id, nome: dispositivo.nome, status: 'ONLINE' });
  } else {
    return res.json({ id: dispositivo.id, nome: dispositivo.nome, status: 'Sessão inválida' });
  }
};

const USER_ID_OFFSET = parseInt(process.env.CATRACA_USER_ID_OFFSET || '111000000');

function formatarUserId(user_id) {
  const str = String(user_id).replace(/^0+/, '');
  return parseInt(str.slice(-7), 10);
}

/** Diagnóstico: compara logs da catraca com Acesso no banco (últimas 24h). */
async function diagnosticoAcessos(req, res) {
  try {
    const id = parseDispositivoId(req.params.id);
    if (id == null) {
      return res.status(400).json({ message: 'ID do dispositivo inválido' });
    }
    const [[dispositivo]] = await db.query(`SELECT ${campos.join(', ')} FROM ${tabela} WHERE id = ?`, [id]);
    if (!dispositivo) {
      return res.status(404).json({ message: 'Dispositivo não encontrado' });
    }
    const link = deviceService.linkCatraca(dispositivo);
    const session = await deviceService.obterSessao(link, dispositivo);
    if (!session) {
      return res.status(502).json({ message: 'Não foi possível obter sessão na catraca' });
    }
    const ts24h = Math.floor(Date.now() / 1000) - 86400;
    // RNF-4: falha ao falar com a catraca agora lança. Num endpoint de DIAGNÓSTICO, devolver
    // "0 logs" quando na verdade não deu para conversar com o equipamento seria o pior resultado
    // possível — é justamente aqui que a pessoa vem para descobrir o que está errado.
    let logsCatraca;
    try {
      logsCatraca = await deviceService.obterLogsCatraca(session, link, ts24h);
    } catch (erro) {
      logger.error(`[DIAGNOSTICO] ${dispositivo.nome}: falha ao obter logs — ${erro.message}`);
      return res.status(502).json({
        message: `Não foi possível obter os logs da catraca ${dispositivo.nome}`,
        dispositivo_id: id,
        dispositivo_nome: dispositivo.nome,
        dispositivoAlcancavel: erro.dispositivoAlcancavel === true,
        detalhe: typeof erro.paraDiagnostico === 'function' ? erro.paraDiagnostico() : String(erro.message)
      });
    }
    const [acessosNosso] = await db.query(
      `SELECT a.id, a.pessoa_id, a.dispositivo_id, a.status, a.data_hora, p.nome AS pessoa_nome
       FROM Acesso a LEFT JOIN Pessoa p ON p.id = a.pessoa_id
       WHERE a.dispositivo_id = ? ORDER BY a.id DESC LIMIT 50`,
      [id]
    );
    const [pessoas] = await db.query('SELECT id, nome FROM Pessoa');
    const idsPessoa = new Set(pessoas.map((p) => p.id));
    const catracaComPessoaId = logsCatraca.slice(0, 50).map((log) => {
      const n = Number(log.user_id);
      const pessoa_id = (n >= USER_ID_OFFSET ? formatarUserId(n - USER_ID_OFFSET) : formatarUserId(n));
      const valid = pessoa_id != null && !isNaN(pessoa_id) && pessoa_id >= 1;
      return {
        id_log: log.id,
        time: log.time,
        user_id_catraca: log.user_id,
        pessoa_id_calculado: valid ? pessoa_id : null,
        portal_id: log.portal_id,
        card_value: log.card_value,
        pessoa_existe: valid ? idsPessoa.has(pessoa_id) : false
      };
    });
    return res.json({
      dispositivo_id: id,
      dispositivo_nome: dispositivo.nome,
      offset_usado: USER_ID_OFFSET,
      ultimas_24h: {
        na_catraca: logsCatraca.length,
        no_nosso_banco: acessosNosso.length
      },
      logs_catraca_amostra: catracaComPessoaId,
      nosso_banco_amostra: acessosNosso,
      pessoas_cadastradas: pessoas.length
    });
  } catch (error) {
    logger.error(`Erro no diagnóstico: ${error.message}`);
    return res.status(500).json({ message: 'Erro no diagnóstico', error: error.message });
  }
}

/** Retorna se a catraca tem muitos logs antigos (para exibir modal "zerar ou continuar"). */
async function logsInfo(req, res) {
  try {
    const id = parseDispositivoId(req.params.id);
    if (id == null) {
      return res.status(400).json({ message: 'ID do dispositivo inválido' });
    }
    const [[dispositivo]] = await db.query(`SELECT ${campos.join(', ')} FROM ${tabela} WHERE id = ?`, [id]);
    if (!dispositivo) {
      return res.status(404).json({ message: 'Dispositivo não encontrado' });
    }
    const result = await deviceService.obterQuantidadeOuAmostraLogsCatraca(dispositivo);
    if (result.error) {
      return res.status(502).json({ hasManyOldLogs: false, error: result.error });
    }
    if (result.hasManyOldLogs) {
      emitNotification({
        title: 'Muitos logs na catraca',
        message: `"${dispositivo.nome}" possui muitos logs antigos (estimativa: ${result.estimatedCount ?? 'alta'}). Considere fazer backup e zerar para melhor desempenho.`,
        type: 'warning',
      });
    }
    return res.json({
      hasManyOldLogs: result.hasManyOldLogs,
      estimatedCount: result.estimatedCount
    });
  } catch (error) {
    logger.error(`Erro ao obter logs-info: ${error.message}`);
    return res.status(500).json({ message: 'Erro ao obter informações de logs', error: error.message });
  }
}

/** Zera os access_logs na catraca (faz backup antes, opcionalmente apaga acessos no sistema e reseta ultimo_log_id_sincronizado). */
async function zerarLogs(req, res) {
  const id = parseDispositivoId(req.params.id);
  if (id == null) {
    return res.status(400).json({ message: 'ID do dispositivo inválido' });
  }
  try {
    const apagarAcessosNoSistema = req.body?.apagarAcessosNoSistema === true;
    const [[dispositivo]] = await db.query(`SELECT ${campos.join(', ')} FROM ${tabela} WHERE id = ?`, [id]);
    if (!dispositivo) {
      return res.status(404).json({ message: 'Dispositivo não encontrado' });
    }

    // 1) Backup antes de zerar
    let backupResult;
    try {
      backupResult = await deviceService.gerarBackupLogsCatraca(dispositivo);
      logger.info(`[ZERAR] Backup gerado: ${backupResult.filename} (${backupResult.totalLines} linhas)`);
    } catch (backupErr) {
      logger.error(`[ZERAR] Falha no backup: ${backupErr.message}`);
      return res.status(502).json({ message: 'Falha ao gerar backup antes de zerar. Operação cancelada.', error: backupErr.message });
    }

    // Marcar dispositivo como "zerando" para sync/polling não bater na mesma catraca durante o delete
    globalState.setZerandoDispositivo(id, true);
    try {
      // 1.5) Aguardar a catraca se recuperar do backup (evita 503 por sobrecarga)
      const delayAposBackupMs = parseInt(process.env.CATRACA_DELAY_APOS_BACKUP_MS || '15000', 10);
      if (delayAposBackupMs > 0) {
        logger.info(`[ZERAR] Aguardando ${delayAposBackupMs / 1000}s antes de zerar (CATRACA_DELAY_APOS_BACKUP_MS)`);
        await new Promise((r) => setTimeout(r, delayAposBackupMs));
      }

      // 2) Zerar na catraca (pode demorar até CATRACA_ZERAR_LOGS_TIMEOUT_MS, ex. 3 min)
      const zerarResult = await deviceService.zerarAccessLogsCatraca(dispositivo);
      if (!zerarResult.ok) {
        return res.status(502).json({ message: zerarResult.message || 'Falha ao zerar logs na catraca' });
      }

      // 3) Opcional: apagar acessos desse dispositivo no SAGE
      if (apagarAcessosNoSistema) {
        const [deleteResult] = await db.query('DELETE FROM Acesso WHERE dispositivo_id = ?', [id]);
        logger.info(`[ZERAR] Acessos do dispositivo ${id} apagados no sistema: ${deleteResult.affectedRows} registros`);
      }

      // 4) Resetar ultimo_log_id_sincronizado para próxima sync começar do zero
      await db.query('UPDATE Dispositivo SET ultimo_log_id_sincronizado = NULL WHERE id = ?', [id]);

      return res.json({
        message: 'Logs da catraca zerados com sucesso. Backup gerado antes da operação.',
        backup: { filename: backupResult.filename, totalLines: backupResult.totalLines },
        apagarAcessosNoSistema
      });
    } finally {
      globalState.setZerandoDispositivo(id, false);
    }
  } catch (error) {
    if (id != null) globalState.setZerandoDispositivo(id, false);
    logger.error(`Erro ao zerar logs: ${error.message}`);
    return res.status(500).json({ message: 'Erro ao zerar logs', error: error.message });
  }
}

/** Lista um tipo de objeto da catraca (users, areas, groups, etc.) — somente leitura. */
async function listarObjetosCatraca(req, res) {
  try {
    const id = parseDispositivoId(req.params.id);
    const objectType = (req.params.objectType || '').toLowerCase().trim();
    if (id == null) {
      return res.status(400).json({ message: 'ID do dispositivo inválido' });
    }
    if (!deviceService.OBJETOS_CATRACA_LISTAVEIS.includes(objectType)) {
      return res.status(400).json({
        message: `Tipo de objeto inválido. Permitidos: ${deviceService.OBJETOS_CATRACA_LISTAVEIS.join(', ')}`
      });
    }
    const [[dispositivo]] = await db.query(`SELECT ${campos.join(', ')} FROM ${tabela} WHERE id = ?`, [id]);
    if (!dispositivo) {
      return res.status(404).json({ message: 'Dispositivo não encontrado' });
    }
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset, 10) : undefined;
    const { data } = await deviceService.loadObjectsFromCatraca(dispositivo, objectType, { limit, offset });
    return res.json({ objectType, data, total: data.length });
  } catch (error) {
    logger.error(`Erro ao listar objetos da catraca: ${error.message}`);
    return res.status(500).json({ message: 'Erro ao listar objetos da catraca', error: error.message });
  }
}

/** Remove um objeto na catraca por id (ex.: usuário, área, grupo). DELETE /dispositivos/:id/catraca/objetos/:objectType/:objectId */
async function deletarObjetoCatraca(req, res) {
  try {
    const id = parseDispositivoId(req.params.id);
    const objectType = (req.params.objectType || '').toLowerCase().trim();
    const objectIdRaw = req.params.objectId;
    if (id == null) {
      return res.status(400).json({ message: 'ID do dispositivo inválido' });
    }
    const objectId = objectIdRaw ? parseInt(objectIdRaw, 10) : NaN;
    if (!Number.isInteger(objectId)) {
      return res.status(400).json({ message: 'ID do objeto inválido' });
    }
    const allowedForDelete = ['users', 'areas', 'groups', 'cards', 'qrcodes', 'access_rules', 'portals', 'time_zones', 'time_spans', 'scheduled_unlocks'];
    if (!allowedForDelete.includes(objectType)) {
      return res.status(400).json({ message: `Tipo não permitido para exclusão. Permitidos: ${allowedForDelete.join(', ')}` });
    }
    const [[dispositivo]] = await db.query(`SELECT ${campos.join(', ')} FROM ${tabela} WHERE id = ?`, [id]);
    if (!dispositivo) {
      return res.status(404).json({ message: 'Dispositivo não encontrado' });
    }
    const where = { [objectType]: { id: objectId } };
    const result = await deviceService.destroyObjectsOnCatraca(dispositivo, objectType, where);
    if (!result.ok) {
      return res.status(502).json({ message: result.message || 'Falha ao remover objeto na catraca' });
    }
    return res.json({ message: `${objectType} removido na catraca`, changes: result.changes });
  } catch (error) {
    logger.error(`Erro ao deletar objeto na catraca: ${error.message}`);
    return res.status(500).json({ message: 'Erro ao deletar objeto na catraca', error: error.message });
  }
}

/** Lista os tipos de objeto da catraca disponíveis para backup/zerar por tipo (ferramentas). */
async function listarTiposObjetosCatraca(req, res) {
  try {
    return res.json({ objectTypes: deviceService.OBJETOS_CATRACA_FERRAMENTAS });
  } catch (error) {
    logger.error(`Erro ao listar tipos de objetos: ${error.message}`);
    return res.status(500).json({ message: 'Erro ao listar tipos', error: error.message });
  }
}

/** Gera backup de um único tipo de objeto na catraca e devolve o arquivo para download. */
async function backupPorTipo(req, res) {
  try {
    const id = parseDispositivoId(req.params.id);
    const objectType = (req.params.objectType || '').toLowerCase().trim();
    if (id == null) return res.status(400).json({ message: 'ID do dispositivo inválido' });
    if (!objectType) return res.status(400).json({ message: 'Tipo de objeto é obrigatório' });
    const [[dispositivo]] = await db.query(`SELECT ${campos.join(', ')} FROM ${tabela} WHERE id = ?`, [id]);
    if (!dispositivo) return res.status(404).json({ message: 'Dispositivo não encontrado' });
    const result = await deviceService.backupPorTipo(dispositivo, objectType);
    const backupsDir = path.resolve(process.cwd(), 'backups');
    const resolvedPath = path.resolve(result.filePath);
    if (!resolvedPath.startsWith(backupsDir) || resolvedPath.includes('..')) {
      logger.warn(`[BACKUP POR TIPO] Path fora de backups: ${resolvedPath}`);
      return res.status(403).json({ message: 'Caminho do backup inválido' });
    }
    const isJsonl = result.filename.endsWith('.jsonl');
    res.setHeader('Content-Type', isJsonl ? 'application/x-ndjson' : 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.download(result.filePath, result.filename, (err) => {
      if (err) logger.debug(`Download backup ${result.filename}: ${err.message}`);
    });
  } catch (error) {
    if (error.message && (error.message.includes('Tipo inválido') || error.message.includes('não suportado') || error.message.includes('não permitido'))) {
      return res.status(400).json({ message: error.message });
    }
    logger.error(`Erro ao gerar backup por tipo: ${error.message}`);
    return res.status(500).json({ message: 'Erro ao gerar backup', error: error.message });
  }
}

/** Zera (apaga) todos os objetos de um único tipo na catraca. Para access_logs usa delay e bloqueio de sync. */
async function zerarPorTipo(req, res) {
  const id = parseDispositivoId(req.params.id);
  const objectType = (req.params.objectType || '').toLowerCase().trim();
  if (id == null) return res.status(400).json({ message: 'ID do dispositivo inválido' });
  if (!objectType) return res.status(400).json({ message: 'Tipo de objeto é obrigatório' });
  try {
    const [[dispositivo]] = await db.query(`SELECT ${campos.join(', ')} FROM ${tabela} WHERE id = ?`, [id]);
    if (!dispositivo) return res.status(404).json({ message: 'Dispositivo não encontrado' });
    if (objectType === 'access_logs') {
      globalState.setZerandoDispositivo(id, true);
      try {
        const delayAposBackupMs = parseInt(process.env.CATRACA_DELAY_APOS_BACKUP_MS || '15000', 10);
        if (delayAposBackupMs > 0) {
          logger.info(`[ZERAR POR TIPO] Aguardando ${delayAposBackupMs / 1000}s antes de zerar access_logs`);
          await new Promise((r) => setTimeout(r, delayAposBackupMs));
        }
        const result = await deviceService.zerarPorTipo(dispositivo, objectType);
        if (!result.ok) return res.status(502).json({ message: result.message || 'Falha ao zerar' });
        await db.query('UPDATE Dispositivo SET ultimo_log_id_sincronizado = NULL WHERE id = ?', [id]);
        return res.json({ message: 'Logs da catraca zerados.', changes: result.changes });
      } finally {
        globalState.setZerandoDispositivo(id, false);
      }
    }
    const result = await deviceService.zerarPorTipo(dispositivo, objectType);
    if (!result.ok) return res.status(502).json({ message: result.message || 'Falha ao zerar' });
    return res.json({ message: `${objectType} zerado na catraca.`, changes: result.changes });
  } catch (error) {
    if (id != null && objectType === 'access_logs') globalState.setZerandoDispositivo(id, false);
    logger.error(`Erro ao zerar por tipo: ${error.message}`);
    return res.status(500).json({ message: 'Erro ao zerar', error: error.message });
  }
}

/** Importa áreas e usuários da catraca para o SAGE na ordem correta (Area → Pessoa). Body: { unidade_id?: number, skipAreas?: boolean, skipUsers?: boolean, tipo_pessoa?: string } */
async function importFromCatraca(req, res) {
  try {
    const id = parseDispositivoId(req.params.id);
    if (id == null) {
      return res.status(400).json({ message: 'ID do dispositivo inválido' });
    }
    const [[dispositivo]] = await db.query(`SELECT ${campos.join(', ')} FROM ${tabela} WHERE id = ?`, [id]);
    if (!dispositivo) {
      return res.status(404).json({ message: 'Dispositivo não encontrado' });
    }
    const { unidade_id, skipAreas, skipUsers, tipo_pessoa } = req.body || {};
    const result = await catracaImportService.importarDaCatracaParaSage(dispositivo, {
      unidade_id,
      skipAreas: !!skipAreas,
      skipUsers: !!skipUsers,
      tipo_pessoa: tipo_pessoa || 'ALUNO'
    });
    return res.json({
      message: 'Importação da catraca para o SAGE concluída (ordem: Area → Pessoa).',
      ...result,
      ordem: catracaImportService.getOrdemImportacaoSage()
    });
  } catch (error) {
    logger.error(`Erro ao importar da catraca: ${error.message}`);
    return res.status(500).json({ message: 'Erro ao importar da catraca', error: error.message });
  }
}

/** Apaga todos os objetos na catraca (usuários, áreas, grupos, logs). Use após backup para deixar a catraca vazia. */
async function zerarTudo(req, res) {
  try {
    const id = parseDispositivoId(req.params.id);
    if (id == null) return res.status(400).json({ message: 'ID do dispositivo inválido' });
    const [[dispositivo]] = await db.query(`SELECT ${campos.join(', ')} FROM ${tabela} WHERE id = ?`, [id]);
    if (!dispositivo) return res.status(404).json({ message: 'Dispositivo não encontrado' });
    const result = await deviceService.zerarTudoNaCatraca(dispositivo);
    if (!result.ok) return res.status(502).json({ message: result.message, summary: result.summary, erros: result.erros });
    return res.json({ message: result.message || 'Catraca zerada.', summary: result.summary });
  } catch (error) {
    logger.error(`Erro ao zerar catraca: ${error.message}`);
    return res.status(500).json({ message: 'Erro ao zerar catraca', error: error.message });
  }
}

/**
 * Começar do zero: zera a catraca e, opcionalmente, dados no SAGE (acessos, áreas, pessoas).
 * Body: { apagarAcessosNoSistema?: boolean, apagarAreasNoSistema?: boolean, apagarPessoasNoSistema?: boolean }
 */
async function comecarDoZero(req, res) {
  try {
    const id = parseDispositivoId(req.params.id);
    if (id == null) return res.status(400).json({ message: 'ID do dispositivo inválido' });
    const [[dispositivo]] = await db.query(`SELECT ${campos.join(', ')} FROM ${tabela} WHERE id = ?`, [id]);
    if (!dispositivo) return res.status(404).json({ message: 'Dispositivo não encontrado' });
    const { apagarAcessosNoSistema, apagarAreasNoSistema, apagarPessoasNoSistema } = req.body || {};

    const result = await deviceService.zerarTudoNaCatraca(dispositivo);
    if (!result.ok) return res.status(502).json({ message: result.message, summary: result.summary, erros: result.erros });

    const sageRemovidos = { acessos: 0, areas: 0, pessoas: 0 };
    await db.query('UPDATE Dispositivo SET ultimo_log_id_sincronizado = NULL WHERE id = ?', [id]);

    if (apagarAcessosNoSistema) {
      const [r] = await db.query('DELETE FROM Acesso WHERE dispositivo_id = ?', [id]);
      sageRemovidos.acessos = r.affectedRows;
    }
    if (apagarAreasNoSistema) {
      await db.query('UPDATE Dispositivo SET area_id = NULL');
      const [r] = await db.query('DELETE FROM Area');
      sageRemovidos.areas = r.affectedRows;
    }
    if (apagarPessoasNoSistema) {
      await db.query('DELETE FROM Presenca');
      await db.query('DELETE FROM SolicitacaoAcesso');
      await db.query('DELETE FROM HorarioAula');
      await db.query('DELETE FROM Aula');
      await db.query('DELETE FROM Professor');
      await db.query('DELETE FROM Administrador');
      await db.query('DELETE FROM Terceirizado');
      await db.query('DELETE FROM Funcionario');
      await db.query('DELETE FROM Aluno');
      await db.query('DELETE FROM Responsavel');
      await db.query('DELETE FROM Acesso');
      try { await db.query('DELETE FROM sync_pendente'); } catch (_) {}
      const [r] = await db.query('DELETE FROM Pessoa');
      sageRemovidos.pessoas = r.affectedRows;
    }

    return res.json({
      message: 'Catraca zerada e, no SAGE, os dados selecionados foram apagados. Cadastre do zero.',
      catraca: result.summary,
      sageRemovidos
    });
  } catch (error) {
    logger.error(`Erro ao começar do zero: ${error.message}`);
    return res.status(500).json({ message: 'Erro ao começar do zero', error: error.message });
  }
}

/** Gera backup completo da catraca (users, areas, groups, portals, etc.) em um JSON para download. */
async function backupCompleto(req, res) {
  try {
    const id = parseDispositivoId(req.params.id);
    if (id == null) {
      return res.status(400).json({ message: 'ID do dispositivo inválido' });
    }
    const [[dispositivo]] = await db.query(`SELECT ${campos.join(', ')} FROM ${tabela} WHERE id = ?`, [id]);
    if (!dispositivo) {
      return res.status(404).json({ message: 'Dispositivo não encontrado' });
    }
    const { filePath, filename, summary } = await deviceService.gerarBackupCompletoCatraca(dispositivo);
    const backupsDir = path.resolve(process.cwd(), 'backups');
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(backupsDir) || resolvedPath.includes('..')) {
      logger.warn(`[BACKUP COMPLETO] Path fora de backups: ${resolvedPath}`);
      return res.status(403).json({ message: 'Caminho do backup inválido' });
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.download(filePath, filename, (err) => {
      if (err) logger.debug(`Download backup completo ${filename}: ${err.message}`);
    });
  } catch (error) {
    logger.error(`Erro ao gerar backup completo: ${error.message}`);
    return res.status(500).json({ message: 'Erro ao gerar backup completo', error: error.message });
  }
}

/** Gera backup dos access_logs da catraca (chunks em JSONL) e devolve o arquivo para download. */
async function backupLogs(req, res) {
  try {
    const id = parseDispositivoId(req.params.id);
    if (id == null) {
      return res.status(400).json({ message: 'ID do dispositivo inválido' });
    }
    const [[dispositivo]] = await db.query(`SELECT ${campos.join(', ')} FROM ${tabela} WHERE id = ?`, [id]);
    if (!dispositivo) {
      return res.status(404).json({ message: 'Dispositivo não encontrado' });
    }
    const { filePath, filename } = await deviceService.gerarBackupLogsCatraca(dispositivo);
    const backupsDir = path.resolve(process.cwd(), 'backups');
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(backupsDir) || resolvedPath.includes('..')) {
      logger.warn(`[BACKUP] Tentativa de download com path fora de backups: ${resolvedPath}`);
      return res.status(403).json({ message: 'Caminho do backup inválido' });
    }
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.download(filePath, filename, (err) => {
      if (err) logger.debug(`Download backup ${filename}: ${err.message}`);
    });
  } catch (error) {
    logger.error(`Erro ao gerar backup de logs: ${error.message}`);
    return res.status(500).json({ message: 'Erro ao gerar backup', error: error.message });
  }
}

/** Configura o Monitor na catraca (para dispositivos já cadastrados). */
async function configurarMonitor(req, res) {
  try {
    const id = parseDispositivoId(req.params.id);
    if (id == null) {
      return res.status(400).json({ message: 'ID do dispositivo inválido' });
    }
    const [[dispositivo]] = await db.query(`SELECT ${campos.join(', ')} FROM ${tabela} WHERE id = ?`, [id]);
    if (!dispositivo) {
      return res.status(404).json({ message: 'Dispositivo não encontrado' });
    }
    const result = await deviceService.configurarMonitorNaCatraca(dispositivo);
    if (result.ok) {
      return res.json({ message: 'Monitor configurado na catraca', dispositivo: dispositivo.nome });
    }
    emitNotification({
      title: 'Falha ao configurar Monitor',
      message: `${dispositivo.nome}: ${result.message || 'Não foi possível configurar o callback na catraca.'}`,
      type: 'error',
    });
    return res.status(502).json({ message: result.message || 'Falha ao configurar Monitor' });
  } catch (error) {
    logger.error(`Erro ao configurar Monitor: ${error.message}`);
    emitNotification({
      title: 'Falha ao configurar Monitor',
      message: `${error.message}`,
      type: 'error',
    });
    return res.status(500).json({ message: 'Erro ao configurar Monitor', error: error.message });
  }
}

/** Ativa ou desativa a sincronização automática para um dispositivo específico */
async function toggleSync(req, res) {
  try {
    const id = parseDispositivoId(req.params.id);
    if (id == null) {
      return res.status(400).json({ message: 'ID do dispositivo inválido' });
    }
    
    const { sync_enabled } = req.body;
    if (sync_enabled === undefined || typeof sync_enabled !== 'boolean') {
      return res.status(400).json({ message: 'Campo sync_enabled é obrigatório e deve ser booleano (true/false)' });
    }
    
    const [[dispositivo]] = await db.query(`SELECT ${campos.join(', ')} FROM ${tabela} WHERE id = ?`, [id]);
    if (!dispositivo) {
      return res.status(404).json({ message: 'Dispositivo não encontrado' });
    }
    
    await db.query(`UPDATE ${tabela} SET sync_enabled = ? WHERE id = ?`, [sync_enabled, id]);
    await cacheMutation(async () => null, [`${tabela}:*`]);
    
    const statusMsg = sync_enabled ? 'ativada' : 'desativada';
    logger.info(`Sincronização ${statusMsg} para dispositivo ${dispositivo.nome} (ID: ${id})`);
    
    emitNotification({
      title: `Sincronização ${statusMsg}`,
      message: `A sincronização automática foi ${statusMsg} para o dispositivo "${dispositivo.nome}"`,
      type: 'success',
    });
    
    return res.json({ 
      message: `Sincronização ${statusMsg} com sucesso`,
      dispositivo: dispositivo.nome,
      sync_enabled 
    });
  } catch (error) {
    logger.error(`Erro ao alterar sincronização: ${error.message}`);
    return res.status(500).json({ message: 'Erro ao alterar sincronização', error: error.message });
  }
}

const controllerGenerico = gerarController(tabela, campos, 'dispositivo');

/** Criar dispositivo e já configurar o Monitor na catraca para monitoramento em tempo real */
async function criar(req, res) {
  try {
    const dados = { ...req.body };
    const cols = camposInsert.filter((c) => dados[c] !== undefined);
    const values = cols.map((c) => dados[c]);
    const placeholders = cols.map(() => '?').join(', ');
    await db.query(`INSERT INTO ${tabela} (${cols.join(', ')}) VALUES (${placeholders})`, values);
    const [[{ id: insertId }]] = await db.query('SELECT LAST_INSERT_ID() AS id');
    const [[dispositivo]] = await db.query(`SELECT ${campos.join(', ')} FROM ${tabela} WHERE id = ?`, [insertId]);
    if (!dispositivo) {
      return res.status(500).json({ message: 'Erro ao criar dispositivo' });
    }
    await cacheMutation(async () => null, [`${tabela}:*`]);
    const monitorResult = await deviceService.configurarMonitorNaCatraca(dispositivo);
    if (!monitorResult.ok) {
      logger.warn(`Dispositivo criado mas Monitor não configurado: ${monitorResult.message}`);
    }
    res.status(201).json({
      message: 'Dispositivo criado com sucesso',
      data: dispositivo
    });
  } catch (error) {
    logger.error(`Erro ao criar dispositivo: ${error.message}`);
    res.status(500).json({ message: 'Erro ao criar dispositivo', error: error.message });
  }
}

async function limparUsuarios(req, res){
  try {
    await limparUsuariosPorPrefixo11();
    res.status(204).json({
      message: 'Usuários removidos com sucesso',
    });
  } catch (error) {
    logger.error(`Erro ao remover usuários: ${error.message}`);
    res.status(500).json({ message: 'Erro ao remover usuários', error: error.message });
  }
}

module.exports = {
  ...controllerGenerico,
  criar,
  getStatus,
  getStatusId,
  logsInfo,
  backupLogs,
  backupCompleto,
  zerarLogs,
  listarObjetosCatraca,
  deletarObjetoCatraca,
  listarTiposObjetosCatraca,
  backupPorTipo,
  zerarPorTipo,
  importFromCatraca,
  zerarTudo,
  comecarDoZero,
  configurarMonitor,
  toggleSync,
  diagnosticoAcessos,
  limparUsuarios,
  async discover(req, res) {
    try {
      const { cidr, ports, timeout, concurrency } = req.query;
      const parsedPorts = ports ? String(ports).split(',').map(p => parseInt(p.trim(), 10)).filter(Boolean) : [80, 82];
      const result = await discoverControlId({
        cidr: cidr || undefined,
        ports: parsedPorts,
        timeoutMs: timeout ? parseInt(timeout, 10) : 1200,
        concurrency: concurrency ? parseInt(concurrency, 10) : 64
      });
      res.json({ cidrs: result.cidrs, found: result.found });
    } catch (error) {
      res.status(500).json({ message: 'Erro ao descobrir dispositivos na rede', error: error.message });
    }
  },
  async quickAdd(req, res) {
    try {
      const { ip, port, usuario, senha, nome, area_id, modelo, numero_serial } = req.body;
      if (!ip || !port || !usuario || !senha) {
        return res.status(400).json({ message: 'ip, port, usuario e senha são obrigatórios' });
      }

      const payload = {
        nome: nome || `Catraca ${ip}:${port}`,
        modelo: modelo || 'IDAccess',
        endereco: ip,
        porta: String(port),
        usuario,
        senha,
        area_id: area_id || null,
        numero_serial: numero_serial || null,
        // D-1: coluna renomeada de `sincronizar` para `sync_enabled`.
        // Semântica preservada da ponta: no quick-add, sync fica desligado salvo pedido explícito.
        // TODO(F0): divergente do DEFAULT 1 da coluna — confirmar qual é o comportamento desejado.
        sync_enabled: (req.body.sync_enabled === true || req.body.sync_enabled === 1) ? 1 : 0
      };

      await criarRegistro(tabela, payload);

      const [[dispositivo]] = await db.query(
        `SELECT ${campos.join(', ')} FROM ${tabela} WHERE endereco = ? AND porta = ? ORDER BY id DESC LIMIT 1`,
        [payload.endereco, payload.porta]
      );
      if (dispositivo) {
        const monitorResult = await deviceService.configurarMonitorNaCatraca(dispositivo);
        if (!monitorResult.ok) {
          logger.warn(`QuickAdd: Monitor não configurado em ${dispositivo.nome}: ${monitorResult.message}`);
        }
      }

      const ok = await deviceService.testarConexaoCatraca({
        nome: payload.nome,
        endereco: payload.endereco,
        porta: payload.porta,
        usuario: payload.usuario,
        senha: payload.senha
      });

      res.status(201).json({
        message: 'Dispositivo criado',
        data: dispositivo || payload,
        conectado: !!ok
      });
    } catch (error) {
      res.status(500).json({ message: 'Erro ao criar dispositivo', error: error.message });
    }
  }
}