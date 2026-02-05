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

const tabela = 'Dispositivo';

/** Valida id de dispositivo (params): deve ser inteiro positivo. Retorna id numérico ou null. */
function parseDispositivoId(idParam) {
  const n = parseInt(idParam, 10);
  if (Number.isNaN(n) || n < 1) return null;
  return n;
}
// Colunas conforme o banco (control_id_device_id e ultimo_log_id_sincronizado vêm de migrations; para sync usamos SELECT * em accessService)
const campos = ['id', 'nome', 'modelo', 'endereco', 'porta', 'usuario', 'senha', 'status', 'last_health_check', 'area_id', 'numero_serial', 'sincronizar', 'created_at', 'updated_at'];
const camposInsert = campos.filter((c) => c !== 'id');

const getStatus = async (req, res) => {
  const statusDispositivos = [];
  const dispositivos = await buscarTodos(tabela, campos);

  if (!dispositivos) {
    return res.status(500).json({ message: 'Erro ao buscar dispositivos do banco de dados' });
  }

  for (const dispositivo of dispositivos) {
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
    const logsCatraca = await deviceService.obterLogsCatraca(session, link, ts24h);
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
  try {
    const id = parseDispositivoId(req.params.id);
    if (id == null) {
      return res.status(400).json({ message: 'ID do dispositivo inválido' });
    }
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

    // 2) Zerar na catraca
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
  } catch (error) {
    logger.error(`Erro ao zerar logs: ${error.message}`);
    return res.status(500).json({ message: 'Erro ao zerar logs', error: error.message });
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

module.exports = {
  ...controllerGenerico,
  criar,
  getStatus,
  getStatusId,
  logsInfo,
  backupLogs,
  zerarLogs,
  configurarMonitor,
  diagnosticoAcessos,
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
        sincronizar: (req.body.sincronizar === true || req.body.sincronizar === 1) ? 1 : 0
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