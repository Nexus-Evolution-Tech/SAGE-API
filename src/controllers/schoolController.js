const path = require('path');
const fs = require('fs');
const gerarController = require('./genericControllerFactory');
const { gerarToken } = require('../utils/jwt');
const db = require('../config/database');
const { compararHash, hashSenha } = require('../utils/criptografia');
const crud = require('../utils/generic-db-utils');
const logger = require('../config/logger');
const { emitNotification, emitNotificationToUser } = require('../services/notificationService');
const { paths } = require('../config/paths');

const tabela = 'UnidadeEscolar';
const campos = ['id', 'nome', 'numero_unidade', 'cnpj', 'login', 'senha', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'estado', 'cep', 'telefone_contato', 'email', 'logo'];

/** Campos permitidos para atualização da unidade (sem senha) */
const camposAtualizaveis = campos.filter((c) => c !== 'senha' && c !== 'id');

const login = async (req, res) => {
  try {
    const unidade_id = req.params.id;
    const { usuario, senha } = req.body;

    const query = `SELECT * FROM UnidadeEscolar WHERE id = ?`;
    const [rows] = await db.query(query, [unidade_id]);
    const unidade = rows[0];

    if (!unidade) return res.status(401).json({ message: 'Usuário não encontrado' });

    const senhaCorreta = await compararHash(senha, unidade.senha);
    if (!senhaCorreta || unidade.login !== usuario)
      return res.status(401).json({ message: 'Credenciais inválidas' });

    // gera o token válido por 1h
    const token = gerarToken({ id: unidade.id, nome: unidade.nome });

    emitNotificationToUser(unidade.id, {
      title: 'Novo login na sua conta',
      message: 'Sua conta foi acessada em outro dispositivo ou aba. Se não foi você, altere sua senha.',
      type: 'info',
    });

    res.status(200).json({ message: 'Logado com sucesso', token });
  } catch (error) {
    res.status(500).json({ message: 'Erro interno', error: error.message });
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
    const id = req.user?.id;
    if (!id) return res.status(401).json({ message: 'Não autorizado' });
    const { senha_atual, nova_senha } = req.body;
    if (!senha_atual || !nova_senha) {
      return res.status(400).json({ message: 'Informe a senha atual e a nova senha' });
    }
    if (nova_senha.length < 6) {
      return res.status(400).json({ message: 'A nova senha deve ter no mínimo 6 caracteres' });
    }
    const [rows] = await db.query('SELECT senha FROM UnidadeEscolar WHERE id = ?', [id]);
    const unidade = rows[0];
    if (!unidade) return res.status(404).json({ message: 'Unidade não encontrada' });
    const senhaCorreta = await compararHash(senha_atual, unidade.senha);
    if (!senhaCorreta) {
      return res.status(401).json({ message: 'Senha atual incorreta' });
    }
    const senhaHash = await hashSenha(nova_senha);
    await db.query('UPDATE UnidadeEscolar SET senha = ? WHERE id = ?', [senhaHash, id]);
    emitNotificationToUser(id, {
      title: 'Alteração de senha',
      message: 'Sua senha foi alterada com sucesso.',
      type: 'success',
    });
    res.json({ message: 'Senha alterada com sucesso' });
  } catch (error) {
    logger.error(`Erro ao trocar senha: ${error.message}`);
    res.status(500).json({ message: 'Erro ao alterar senha', error: error.message });
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
  uploadLogo
};
