const db = require('../config/database');
const logger = require('../config/logger');
const { hashSenha, compararHash } = require('../utils/criptografia');

const CAMPOS_PUBLICOS = 'id, login, nome_exibicao, papel, ativo, pessoa_id, precisa_trocar_senha, falhas_login, bloqueado_ate, ultimo_acesso, created_at, updated_at';
const PAPEIS = new Set(['ADMINISTRADOR', 'SECRETARIA']);
const LIMITE_FALHAS = 5;
const BLOQUEIO_MS = 15 * 60 * 1000;

function senhaValida(senha) {
  return typeof senha === 'string' && senha.length >= 8;
}

function dadosPublicos(usuario) {
  if (!usuario) return null;
  const resultado = { ...usuario };
  delete resultado.senha_hash;
  return resultado;
}

function validarEntrada(body, parcial = false) {
  const dados = {};
  if (!parcial || body.login !== undefined) {
    const login = String(body.login || '').trim();
    if (!/^[A-Za-z0-9._-]{3,100}$/.test(login)) throw new Error('Login inválido');
    dados.login = login;
  }
  if (!parcial || body.nome_exibicao !== undefined) {
    const nome = String(body.nome_exibicao || '').trim();
    if (nome.length < 1 || nome.length > 100) throw new Error('Nome de exibição inválido');
    dados.nome_exibicao = nome;
  }
  if (!parcial || body.papel !== undefined) {
    if (!PAPEIS.has(body.papel)) throw new Error('Papel inválido');
    dados.papel = body.papel;
  }
  if (body.pessoa_id !== undefined) dados.pessoa_id = body.pessoa_id === null ? null : Number(body.pessoa_id);
  return dados;
}

async function listar(req, res) {
  try {
    const [rows] = await db.query(`SELECT ${CAMPOS_PUBLICOS} FROM Usuario ORDER BY id`);
    res.json({ data: rows });
  } catch (error) {
    logger.error('[USUARIO] codigo=LISTAR_FALHOU');
    res.status(500).json({ message: 'Não foi possível listar usuários' });
  }
}

async function obter(req, res) {
  try {
    const [[usuario]] = await db.query(`SELECT ${CAMPOS_PUBLICOS} FROM Usuario WHERE id = ?`, [req.params.id]);
    if (!usuario) return res.status(404).json({ message: 'Usuário não encontrado' });
    res.json(dadosPublicos(usuario));
  } catch (error) {
    logger.error('[USUARIO] codigo=OBTER_FALHOU');
    res.status(500).json({ message: 'Não foi possível consultar usuário' });
  }
}

async function criar(req, res) {
  try {
    const dados = validarEntrada(req.body);
    if (!senhaValida(req.body.senha)) return res.status(400).json({ message: 'A senha deve ter ao menos 8 caracteres' });
    dados.senha_hash = await hashSenha(req.body.senha);
    const [result] = await db.query(
      `INSERT INTO Usuario (login, senha_hash, nome_exibicao, papel, pessoa_id)
       VALUES (?, ?, ?, ?, ?)`,
      [dados.login, dados.senha_hash, dados.nome_exibicao, dados.papel, dados.pessoa_id ?? null]
    );
    const [[usuario]] = await db.query(`SELECT ${CAMPOS_PUBLICOS} FROM Usuario WHERE id = ?`, [result.insertId]);
    res.status(201).json(dadosPublicos(usuario));
  } catch (error) {
    if (error.message === 'Login inválido' || error.message === 'Nome de exibição inválido' || error.message === 'Papel inválido') {
      return res.status(400).json({ message: error.message });
    }
    logger.error('[USUARIO] codigo=CRIAR_FALHOU');
    res.status(error.code === 'ER_DUP_ENTRY' ? 409 : 500).json({ message: error.code === 'ER_DUP_ENTRY' ? 'Login já existe' : 'Não foi possível criar usuário' });
  }
}

async function editar(req, res) {
  try {
    const dados = validarEntrada(req.body, true);
    if (!Object.keys(dados).length) return res.status(400).json({ message: 'Nenhum campo válido' });
    const [result] = await db.query(
      `UPDATE Usuario SET ${Object.keys(dados).map((campo) => `${campo} = ?`).join(', ')} WHERE id = ?`,
      [...Object.values(dados), req.params.id]
    );
    if (!result.affectedRows) return res.status(404).json({ message: 'Usuário não encontrado' });
    return obter(req, res);
  } catch (error) {
    if (/inválido|Login/.test(error.message)) return res.status(400).json({ message: error.message });
    logger.error('[USUARIO] codigo=EDITAR_FALHOU');
    res.status(error.code === 'ER_DUP_ENTRY' ? 409 : 500).json({ message: error.code === 'ER_DUP_ENTRY' ? 'Login já existe' : 'Não foi possível editar usuário' });
  }
}

async function desativar(req, res) {
  try {
    const [result] = await db.query('UPDATE Usuario SET ativo = FALSE WHERE id = ?', [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ message: 'Usuário não encontrado' });
    res.json({ message: 'Usuário desativado' });
  } catch (error) {
    logger.error('[USUARIO] codigo=DESATIVAR_FALHOU');
    res.status(500).json({ message: 'Não foi possível desativar usuário' });
  }
}

async function redefinirSenha(req, res) {
  if (!senhaValida(req.body.senha)) return res.status(400).json({ message: 'A senha deve ter ao menos 8 caracteres' });
  try {
    const [result] = await db.query(
      'UPDATE Usuario SET senha_hash = ?, precisa_trocar_senha = TRUE, falhas_login = 0, bloqueado_ate = NULL WHERE id = ?',
      [await hashSenha(req.body.senha), req.params.id]
    );
    if (!result.affectedRows) return res.status(404).json({ message: 'Usuário não encontrado' });
    res.json({ message: 'Senha redefinida' });
  } catch (error) {
    logger.error('[USUARIO] codigo=REDEFINIR_SENHA_FALHOU');
    res.status(500).json({ message: 'Não foi possível redefinir a senha' });
  }
}

async function autenticar(login, senha) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [[usuario]] = await connection.query('SELECT * FROM Usuario WHERE login = ? LIMIT 1 FOR UPDATE', [login]);
    const bloqueado = usuario?.bloqueado_ate && new Date(usuario.bloqueado_ate).getTime() > Date.now();
    if (!usuario || !usuario.ativo || bloqueado) {
      await connection.rollback();
      return { ok: false, bloqueado: Boolean(bloqueado) };
    }
    if (!(await compararHash(senha, usuario.senha_hash))) {
      const falhas = Number(usuario.falhas_login || 0) + 1;
      await connection.query('UPDATE Usuario SET falhas_login = ?, bloqueado_ate = ? WHERE id = ?', [falhas, falhas >= LIMITE_FALHAS ? new Date(Date.now() + BLOQUEIO_MS) : null, usuario.id]);
      await connection.commit();
      return { ok: false, bloqueado: falhas >= LIMITE_FALHAS };
    }
    await connection.query('UPDATE Usuario SET falhas_login = 0, bloqueado_ate = NULL, ultimo_acesso = NOW() WHERE id = ?', [usuario.id]);
    await connection.commit();
    return { ok: true, usuario };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { listar, obter, criar, editar, desativar, redefinirSenha, autenticar, dadosPublicos };
