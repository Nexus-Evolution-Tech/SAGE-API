const path = require('path');
const fs = require('fs');
const gerarController = require('./genericControllerFactory');
const { gerarToken } = require('../utils/jwt');
const db = require('../config/database');
const { FIRST_RUN_BOOTSTRAP_LOCK } = require('../config/env');
const { compararHash, hashSenha } = require('../utils/criptografia');
const { autenticar: autenticarUsuario } = require('../services/usuarioService');
const crud = require('../utils/generic-db-utils');
const logger = require('../config/logger');
const { emitNotification, emitNotificationToUser } = require('../services/notificationService');
const { paths } = require('../config/paths');
const crypto = require('crypto');

const tabela = 'UnidadeEscolar';
const campos = ['id', 'nome', 'numero_unidade', 'cnpj', 'login', 'senha', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'estado', 'cep', 'telefone_contato', 'email', 'logo'];

/** Campos permitidos para atualização da unidade (sem senha) */
const camposAtualizaveis = campos.filter((c) => c !== 'senha' && c !== 'id');

function gerarChaveRecuperacao() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashChaveRecuperacao(chave) {
  return crypto.createHash('sha256').update(String(chave), 'utf8').digest('hex');
}

function compararChaveRecuperacao(hashArmazenado, chave) {
  const recebido = Buffer.from(hashChaveRecuperacao(chave), 'hex');
  const esperado = Buffer.alloc(recebido.length);
  const hashValido = typeof hashArmazenado === 'string' && /^[a-f0-9]{64}$/i.test(hashArmazenado);
  if (hashValido) Buffer.from(hashArmazenado, 'hex').copy(esperado);
  return crypto.timingSafeEqual(esperado, recebido) && hashValido;
}

function isLoopbackRequest(req) {
  const address = req.socket?.remoteAddress || req.connection?.remoteAddress || req.ip || '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

const bootstrapStatus = async (_req, res) => {
  try {
    const [[row]] = await db.query('SELECT COUNT(*) AS total FROM UnidadeEscolar');
    res.json({ required: Number(row.total) === 0 });
  } catch (error) {
    logger.error(`Erro ao consultar onboarding: ${error.message}`);
    res.status(503).json({ message: 'Configuração inicial indisponível' });
  }
};

const bootstrapInitialize = async (req, res) => {
  if (!isLoopbackRequest(req)) {
    return res.status(403).json({ message: 'A configuração inicial só pode ser feita neste computador' });
  }
  const nome = String(req.body?.nome || '').trim();
  const loginInicial = String(req.body?.login || '').trim();
  const senha = String(req.body?.senha || '');
  if (nome.length < 3 || nome.length > 255) {
    return res.status(400).json({ field: 'nome', message: 'O nome da unidade deve ter entre 3 e 255 caracteres' });
  }
  if (!/^[A-Za-z0-9._-]{3,100}$/.test(loginInicial)) {
    return res.status(400).json({ field: 'login', message: 'O login deve ter entre 3 e 100 caracteres e usar apenas letras, números, ponto, hífen ou sublinhado' });
  }
  if (senha.length < 8) {
    return res.status(400).json({ field: 'senha', message: 'A senha deve ter ao menos 8 caracteres' });
  }

  const connection = await db.getConnection();
  let lockAcquired = false;
  try {
    const [[lock]] = await connection.query(
      'SELECT GET_LOCK(?, 5) AS acquired', [FIRST_RUN_BOOTSTRAP_LOCK]
    );
    lockAcquired = Number(lock.acquired) === 1;
    if (!lockAcquired) return res.status(503).json({ message: 'Outra configuração está em andamento' });
    await connection.beginTransaction();
    const [[existing]] = await connection.query('SELECT COUNT(*) AS total FROM UnidadeEscolar');
    if (Number(existing.total) !== 0) {
      await connection.rollback();
      return res.status(409).json({ message: 'O SAGE já foi configurado' });
    }
    const senhaHash = await hashSenha(senha);
    const chaveRecuperacao = gerarChaveRecuperacao();
    await connection.query(
      `INSERT INTO UnidadeEscolar
       (nome, login, senha, recuperacao_chave_hash, recuperacao_falhas, recuperacao_gerada_em)
       VALUES (?, ?, ?, ?, 0, NOW())`,
      [nome, loginInicial, senhaHash, hashChaveRecuperacao(chaveRecuperacao)]
    );
    await connection.query(
      `INSERT INTO Usuario
       (login, senha_hash, nome_exibicao, papel, ativo, precisa_trocar_senha)
       VALUES (?, ?, ?, 'ADMINISTRADOR', TRUE, FALSE)`,
      [loginInicial, senhaHash, nome]
    );
    await connection.commit();
    return res.status(201).json({ initialized: true, recoveryKey: chaveRecuperacao });
  } catch (error) {
    await connection.rollback().catch(() => logger.warn('[ONBOARDING] codigo=ROLLBACK_FALHOU'));
    logger.error('[ONBOARDING] codigo=ONBOARDING_INICIAL_FALHOU');
    return res.status(500).json({ message: 'Não foi possível concluir a configuração inicial' });
  } finally {
    if (lockAcquired) {
      await connection.query(
        'SELECT RELEASE_LOCK(?)', [FIRST_RUN_BOOTSTRAP_LOCK]
      ).catch(() => logger.warn('[ONBOARDING] codigo=LOCK_RELEASE_FALHOU'));
    }
    connection.release();
  }
};

/** Recuperação exclusivamente local por chave; a chave nunca é armazenada em texto puro. */
const recuperarAcesso = async (req, res) => {
  if (!isLoopbackRequest(req)) return res.status(403).json({ message: 'A recuperação só pode ser feita neste computador.' });
  const login = String(req.body?.login || '').trim();
  const chave = String(req.body?.chave_recuperacao || '').trim();
  const novaSenha = String(req.body?.nova_senha || '');
  const confirmacao = String(req.body?.confirmacao_nova_senha || '');
  if (!login || !chave) return res.status(400).json({ message: 'Informe o login e a chave de recuperação.' });
  if (novaSenha.length < 8) return res.status(400).json({ message: 'A nova senha deve ter ao menos 8 caracteres.' });
  if (novaSenha !== confirmacao) return res.status(400).json({ message: 'A confirmação da nova senha não confere.' });
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [unidades] = await connection.query(
      `SELECT id, recuperacao_chave_hash, recuperacao_falhas, recuperacao_bloqueada_ate
       FROM UnidadeEscolar ORDER BY id FOR UPDATE`
    );
    const unidade = unidades.length === 1 ? unidades[0] : undefined;
    const bloqueada = unidade?.recuperacao_bloqueada_ate && new Date(unidade.recuperacao_bloqueada_ate).getTime() > Date.now();
    const chaveCorreta = compararChaveRecuperacao(unidade?.recuperacao_chave_hash, chave);
    if (bloqueada) {
      await connection.rollback();
      return res.status(429).json({ message: 'Chave inválida ou temporariamente bloqueada. Tente novamente mais tarde.' });
    }
    if (!unidade || !chaveCorreta) {
      if (!unidade) {
        await connection.rollback();
        return res.status(401).json({ message: 'Chave inválida ou login não autorizado.' });
      }
      const falhas = Number(unidade.recuperacao_falhas || 0) + 1;
      await connection.query(
        'UPDATE UnidadeEscolar SET recuperacao_falhas = ?, recuperacao_bloqueada_ate = ? WHERE id = ?',
        [falhas, falhas >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null, unidade.id]
      );
      await connection.commit();
      return res.status(falhas >= 5 ? 429 : 401).json({ message: 'Chave inválida ou login não autorizado.' });
    }
    const [[usuario]] = await connection.query(
      `SELECT id FROM Usuario
       WHERE login = ? AND papel = 'ADMINISTRADOR' LIMIT 1 FOR UPDATE`, [login]
    );
    if (!usuario) {
      const falhas = Number(unidade.recuperacao_falhas || 0) + 1;
      await connection.query(
        'UPDATE UnidadeEscolar SET recuperacao_falhas = ?, recuperacao_bloqueada_ate = ? WHERE id = ?',
        [falhas, falhas >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null, unidade.id]
      );
      await connection.commit();
      return res.status(falhas >= 5 ? 429 : 401).json({ message: 'Chave inválida ou login não autorizado.' });
    }
    const senhaHash = await hashSenha(novaSenha);
    const novaChave = gerarChaveRecuperacao();
    await connection.query(
      `UPDATE Usuario SET senha_hash = ?, precisa_trocar_senha = FALSE,
       falhas_login = 0, bloqueado_ate = NULL WHERE id = ?`,
      [senhaHash, usuario.id]
    );
    await connection.query(
      `UPDATE UnidadeEscolar SET recuperacao_chave_hash = ?, recuperacao_falhas = 0,
       recuperacao_bloqueada_ate = NULL, recuperacao_gerada_em = NOW() WHERE id = ?`,
      [hashChaveRecuperacao(novaChave), unidade.id]
    );
    await connection.commit();
    return res.json({ message: 'Senha alterada com sucesso.' });
  } catch (error) {
    await connection.rollback().catch(() => logger.warn('[RECUPERACAO] codigo=ROLLBACK_FALHOU'));
    logger.error('[RECUPERACAO] codigo=RECUPERACAO_LOCAL_FALHOU');
    return res.status(500).json({ message: 'Não foi possível recuperar o acesso.' });
  } finally {
    connection.release();
  }
};

const login = async (req, res) => {
  try {
    const { usuario, senha } = req.body;
    const resultado = await autenticarUsuario(String(usuario || '').trim(), senha);
    if (!resultado.ok) return res.status(resultado.bloqueado ? 429 : 401).json({ message: 'Credenciais inválidas' });
    const conta = resultado.usuario;
    const token = gerarToken({
      usuario_id: conta.id, papel: conta.papel, emitido_em: new Date().toISOString()
    });

    emitNotificationToUser(conta.id, {
      title: 'Novo login na sua conta',
      message: 'Sua conta foi acessada em outro dispositivo ou aba. Se não foi você, altere sua senha.',
      type: 'info',
    });

    res.status(200).json({ message: 'Logado com sucesso', token, precisa_trocar_senha: Boolean(conta.precisa_trocar_senha) });
  } catch (error) {
    logger.error('[AUTH] codigo=LOGIN_FALHOU');
    res.status(503).json({ message: 'Autenticação indisponível' });
  }
};

/** GET /unidade — retorna a unidade do usuário logado (sem senha) */
const obterUnidadeAtual = async (req, res) => {
  try {
    const id = req.user?.id;
    if (!id) return res.status(401).json({ message: 'Não autorizado' });
    const camposSemSenha = campos.filter((c) => c !== 'senha');
    const [registros] = await crud.buscarPorId(id, tabela, camposSemSenha);
    const unidade = Array.isArray(registros) ? registros[0] : registros;
    if (!unidade) return res.status(404).json({ message: 'Unidade não encontrada' });
    res.json(unidade);
  } catch (error) {
    logger.error(`Erro ao obter unidade atual: ${error.message}`);
    res.status(500).json({ message: 'Erro ao carregar dados da unidade', error: error.message });
  }
};

/** PATCH /unidade — atualiza a unidade do usuário logado (senha não é alterada aqui) */
const atualizarUnidadeAtual = async (req, res) => {
  try {
    const id = req.user?.id;
    if (!id) return res.status(401).json({ message: 'Não autorizado' });
    const body = { ...req.body };
    delete body.senha;
    const updates = {};
    camposAtualizaveis.forEach((c) => {
      if (body[c] !== undefined) updates[c] = body[c];
    });
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'Nenhum campo válido para atualizar' });
    }
    await crud.atualizarRegistro(tabela, id, updates);
    res.json({ message: 'Dados da unidade atualizados com sucesso' });
  } catch (error) {
    logger.error(`Erro ao atualizar unidade: ${error.message}`);
    res.status(500).json({ message: 'Erro ao atualizar dados', error: error.message });
  }
};

/** PATCH /unidade/trocar-senha — altera a senha (exige senha atual) */
const trocarSenha = async (req, res) => {
  try {
    const id = req.user?.usuario_id;
    if (!id) return res.status(401).json({ message: 'Não autorizado' });
    const { senha_atual, nova_senha } = req.body;
    if (typeof senha_atual !== 'string' || typeof nova_senha !== 'string' || !senha_atual || !nova_senha) {
      return res.status(400).json({ message: 'Informe a senha atual e a nova senha' });
    }
    if (nova_senha.length < 8) {
      return res.status(400).json({ message: 'A nova senha deve ter no mínimo 8 caracteres' });
    }
    const [[usuario]] = await db.query('SELECT senha_hash FROM Usuario WHERE id = ?', [id]);
    if (!usuario) return res.status(404).json({ message: 'Usuário não encontrado' });
    const senhaCorreta = await compararHash(senha_atual, usuario.senha_hash);
    if (!senhaCorreta) {
      return res.status(401).json({ message: 'Senha atual incorreta' });
    }
    const senhaHash = await hashSenha(nova_senha);
    await db.query(
      'UPDATE Usuario SET senha_hash = ?, precisa_trocar_senha = FALSE, falhas_login = 0, bloqueado_ate = NULL WHERE id = ?',
      [senhaHash, id]
    );
    emitNotificationToUser(id, {
      title: 'Alteração de senha',
      message: 'Sua senha foi alterada com sucesso.',
      type: 'success',
    });
    res.json({ message: 'Senha alterada com sucesso' });
  } catch (error) {
    logger.error('[AUTH] codigo=TROCA_SENHA_FALHOU');
    res.status(503).json({ message: 'Não foi possível alterar a senha' });
  }
};

/** GET /config — modo de sync (Monitor push vs Polling) para a interface */
const getConfig = async (req, res) => {
  try {
    const monitorUsePush = process.env.MONITOR_USE_PUSH === 'true';
    const monitorPollingIntervalMs = parseInt(process.env.MONITOR_POLLING_INTERVAL_MS || '20000', 10);
    res.json({
      monitorUsePush,
      monitorPollingIntervalMs,
      monitorPollingEnabled: monitorPollingIntervalMs > 0
    });
  } catch (error) {
    logger.error(`Erro ao obter config: ${error.message}`);
    res.status(500).json({ message: 'Erro ao carregar configuração', error: error.message });
  }
};

/** POST /unidade/upload-logo — upload da logo da escola (unidade logada) */
const uploadLogo = async (req, res) => {
  try {
    const id = req.user?.id;
    if (!id) return res.status(401).json({ message: 'Não autorizado' });
    if (!req.file) return res.status(400).json({ message: 'Arquivo de logo não enviado' });

    const baseUploads = paths.uploads;
    const pastaDestino = path.join(baseUploads, 'unidade');
    if (!fs.existsSync(pastaDestino)) fs.mkdirSync(pastaDestino, { recursive: true });

    const [rows] = await db.query('SELECT logo FROM UnidadeEscolar WHERE id = ?', [id]);
    if (rows.length > 0 && rows[0].logo) {
      const antigoCaminho = path.join(baseUploads, rows[0].logo);
      if (fs.existsSync(antigoCaminho)) fs.unlinkSync(antigoCaminho);
    }

    const novoNome = `logo_${id}.png`;
    const antigoCaminho = path.join(baseUploads, req.file.filename);
    const novoCaminho = path.join(pastaDestino, novoNome);
    fs.renameSync(antigoCaminho, novoCaminho);

    const caminhoRelativo = `unidade/${novoNome}`.replace(/\\/g, '/');
    await db.query('UPDATE UnidadeEscolar SET logo = ? WHERE id = ?', [caminhoRelativo, id]);

    res.json({ message: 'Logo atualizada com sucesso', logo: caminhoRelativo });
  } catch (error) {
    logger.error(`Erro ao fazer upload da logo: ${error.message}`);
    res.status(500).json({ message: 'Erro ao salvar a logo', error: error.message });
  }
};

const controllerGerado = gerarController(tabela, campos, 'escola');

module.exports = {
  ...controllerGerado,
  login,
  obterUnidadeAtual,
  atualizarUnidadeAtual,
  trocarSenha,
  getConfig,
  uploadLogo,
  bootstrapStatus,
  bootstrapInitialize,
  recuperarAcesso
};
