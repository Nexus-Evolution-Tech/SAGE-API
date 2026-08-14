const db = require('../config/database');
const { compararHash, hashSenha } = require('../utils/criptografia');
const logger = require('../config/logger');

const LIMITE_FALHAS = 5;
const BLOQUEIO_MS = 15 * 60 * 1000;
const CAMPOS_SESSAO = [
  'id', 'login', 'nome_exibicao', 'papel', 'ativo', 'pessoa_id',
  'precisa_trocar_senha', 'falhas_login', 'bloqueado_ate', 'ultimo_acesso'
];
const CAMPOS_SESSAO_SQL = CAMPOS_SESSAO.join(', ');
const CAMPOS_USUARIO = ['id', 'login', 'nome_exibicao', 'papel', 'ativo', 'pessoa_id'];
const CAMPOS_USUARIO_SQL = CAMPOS_USUARIO.join(', ');
const CAMPOS_CRIACAO = new Set(['login', 'nome_exibicao', 'papel', 'senha', 'pessoa_id']);
const CAMPOS_EDICAO = new Set(['login', 'nome_exibicao', 'papel', 'pessoa_id']);
const COLUNAS_EDICAO = Object.freeze({
  login: 'login',
  nome_exibicao: 'nome_exibicao',
  papel: 'papel',
  pessoa_id: 'pessoa_id'
});
const PAPEIS = new Set(['ADMINISTRADOR', 'SECRETARIA']);

class ErroUsuario extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function validarId(id) {
  return Number.isSafeInteger(id) && id > 0 && id <= 2147483647;
}

function objetoPlano(dados) {
  return dados !== null && typeof dados === 'object' && !Array.isArray(dados)
    && Object.getPrototypeOf(dados) === Object.prototype;
}

function textoExibicaoValido(valor) {
  return typeof valor === 'string' && valor.trim().length >= 1 && valor.length <= 100
    && !/[\u0000-\u001F\u007F]/.test(valor);
}

function senhaValida(valor) {
  return typeof valor === 'string' && valor.length >= 8
    && Buffer.byteLength(valor, 'utf8') <= 72;
}

function validarCriacao(dados) {
  if (!objetoPlano(dados)) return false;
  const campos = Object.keys(dados);
  if (campos.some((campo) => !CAMPOS_CRIACAO.has(campo))) return false;
  if (typeof dados.login !== 'string' || !/^[A-Za-z0-9._-]{3,100}$/.test(dados.login)) return false;
  if (!textoExibicaoValido(dados.nome_exibicao)) return false;
  if (!PAPEIS.has(dados.papel)) return false;
  if (!senhaValida(dados.senha)) return false;
  return dados.pessoa_id === undefined || dados.pessoa_id === null || validarId(dados.pessoa_id);
}

function validarEdicao(dados) {
  if (!objetoPlano(dados)) return false;
  const campos = Object.keys(dados);
  if (!campos.length || campos.some((campo) => !CAMPOS_EDICAO.has(campo))) return false;
  if (dados.login !== undefined && (typeof dados.login !== 'string' || !/^[A-Za-z0-9._-]{3,100}$/.test(dados.login))) return false;
  if (dados.nome_exibicao !== undefined && !textoExibicaoValido(dados.nome_exibicao)) return false;
  if (dados.papel !== undefined && !PAPEIS.has(dados.papel)) return false;
  return dados.pessoa_id === undefined || dados.pessoa_id === null || validarId(dados.pessoa_id);
}

function validarRedefinicao(dados) {
  return objetoPlano(dados) && Object.keys(dados).length === 1
    && Object.keys(dados)[0] === 'nova_senha' && senhaValida(dados.nova_senha);
}

function projetarSessao(usuario) {
  return Object.fromEntries(CAMPOS_SESSAO.map((campo) => [campo, usuario[campo]]));
}

function projetarUsuario(usuario) {
  return Object.fromEntries(CAMPOS_USUARIO.map((campo) => [campo, usuario[campo]]));
}

async function criarUsuario(dados) {
  if (!validarCriacao(dados)) throw new ErroUsuario('USUARIO_DADOS_INVALIDOS');

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const pessoaId = dados.pessoa_id ?? null;
    if (pessoaId !== null) {
      const [[pessoa]] = await connection.query('SELECT id FROM Pessoa WHERE id = ? LIMIT 1', [pessoaId]);
      if (!pessoa) throw new ErroUsuario('USUARIO_PESSOA_INVALIDA');
    }

    const senhaHash = await hashSenha(dados.senha);
    const [resultado] = await connection.query(
      `INSERT INTO Usuario (login, senha_hash, nome_exibicao, papel, pessoa_id)
       VALUES (?, ?, ?, ?, ?)`,
      [dados.login, senhaHash, dados.nome_exibicao.trim(), dados.papel, pessoaId]
    );
    const [[usuario]] = await connection.query(
      `SELECT ${CAMPOS_USUARIO_SQL} FROM Usuario WHERE id = ?`, [resultado.insertId]
    );
    await connection.commit();
    return projetarUsuario(usuario);
  } catch (error) {
    await connection.rollback().catch(() => logger.error('[USUARIOS] codigo=ROLLBACK_FALHOU'));
    if (error.code === 'ER_DUP_ENTRY') throw new ErroUsuario('USUARIO_LOGIN_DUPLICADO');
    if (error.code === 'ER_NO_REFERENCED_ROW_2') throw new ErroUsuario('USUARIO_PESSOA_INVALIDA');
    if (typeof error.code === 'string' && error.code.startsWith('USUARIO_')) throw error;
    logger.error('[USUARIOS] codigo=CRIACAO_FALHOU');
    throw new ErroUsuario('USUARIOS_INDISPONIVEIS');
  } finally {
    connection.release();
  }
}

async function listarUsuarios() {
  const [usuarios] = await db.query(`SELECT ${CAMPOS_USUARIO_SQL} FROM Usuario ORDER BY id ASC`);
  return usuarios.map(projetarUsuario);
}

async function buscarUsuarioPorId(id) {
  const [[usuario]] = await db.query(
    `SELECT ${CAMPOS_USUARIO_SQL} FROM Usuario WHERE id = ? LIMIT 1`, [id]
  );
  return usuario ? projetarUsuario(usuario) : undefined;
}

async function atualizarUsuario(id, dados) {
  if (!validarId(id)) throw new ErroUsuario('USUARIO_ID_INVALIDO');
  if (!validarEdicao(dados)) throw new ErroUsuario('USUARIO_DADOS_INVALIDOS');
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [[existente]] = await connection.query('SELECT id FROM Usuario WHERE id = ? FOR UPDATE', [id]);
    if (!existente) {
      await connection.rollback();
      return undefined;
    }
    if (dados.pessoa_id !== undefined && dados.pessoa_id !== null) {
      const [[pessoa]] = await connection.query('SELECT id FROM Pessoa WHERE id = ? LIMIT 1', [dados.pessoa_id]);
      if (!pessoa) throw new ErroUsuario('USUARIO_PESSOA_INVALIDA');
    }
    const campos = Object.keys(dados);
    const valores = campos.map((campo) => campo === 'nome_exibicao' ? dados[campo].trim() : dados[campo]);
    await connection.query(
      `UPDATE Usuario SET ${campos.map((campo) => `${COLUNAS_EDICAO[campo]} = ?`).join(', ')} WHERE id = ?`,
      [...valores, id]
    );
    const [[usuario]] = await connection.query(
      `SELECT ${CAMPOS_USUARIO_SQL} FROM Usuario WHERE id = ?`, [id]
    );
    await connection.commit();
    return projetarUsuario(usuario);
  } catch (error) {
    await connection.rollback().catch(() => logger.error('[USUARIOS] codigo=ROLLBACK_FALHOU'));
    if (error.code === 'ER_DUP_ENTRY') throw new ErroUsuario('USUARIO_LOGIN_DUPLICADO');
    if (error.code === 'ER_NO_REFERENCED_ROW_2') throw new ErroUsuario('USUARIO_PESSOA_INVALIDA');
    if (typeof error.code === 'string' && error.code.startsWith('USUARIO_')) throw error;
    logger.error('[USUARIOS] codigo=EDICAO_FALHOU');
    throw new ErroUsuario('USUARIOS_INDISPONIVEIS');
  } finally {
    connection.release();
  }
}

async function desativarUsuario(id) {
  if (!validarId(id)) throw new ErroUsuario('USUARIO_ID_INVALIDO');
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [[existente]] = await connection.query('SELECT id FROM Usuario WHERE id = ? FOR UPDATE', [id]);
    if (!existente) {
      await connection.rollback();
      return undefined;
    }
    await connection.query('UPDATE Usuario SET ativo = FALSE WHERE id = ?', [id]);
    const [[usuario]] = await connection.query(`SELECT ${CAMPOS_USUARIO_SQL} FROM Usuario WHERE id = ?`, [id]);
    await connection.commit();
    return projetarUsuario(usuario);
  } catch (error) {
    await connection.rollback().catch(() => logger.error('[USUARIOS] codigo=ROLLBACK_FALHOU'));
    logger.error('[USUARIOS] codigo=DESATIVACAO_FALHOU');
    throw new ErroUsuario('USUARIOS_INDISPONIVEIS');
  } finally {
    connection.release();
  }
}

async function redefinirSenha(id, dados) {
  if (!validarId(id)) throw new ErroUsuario('USUARIO_ID_INVALIDO');
  if (!validarRedefinicao(dados)) throw new ErroUsuario('USUARIO_SENHA_INVALIDA');
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [[existente]] = await connection.query('SELECT id FROM Usuario WHERE id = ? FOR UPDATE', [id]);
    if (!existente) {
      await connection.rollback();
      return undefined;
    }
    const senhaHash = await hashSenha(dados.nova_senha);
    await connection.query(
      `UPDATE Usuario SET senha_hash = ?, precisa_trocar_senha = TRUE,
       falhas_login = 0, bloqueado_ate = NULL WHERE id = ?`,
      [senhaHash, id]
    );
    const [[usuario]] = await connection.query(`SELECT ${CAMPOS_USUARIO_SQL} FROM Usuario WHERE id = ?`, [id]);
    await connection.commit();
    return projetarUsuario(usuario);
  } catch (error) {
    await connection.rollback().catch(() => logger.error('[USUARIOS] codigo=ROLLBACK_FALHOU'));
    logger.error('[USUARIOS] codigo=REDEFINICAO_SENHA_FALHOU');
    throw new ErroUsuario('USUARIOS_INDISPONIVEIS');
  } finally {
    connection.release();
  }
}

async function autenticar(login, senha) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [[usuario]] = await connection.query(
      `SELECT ${CAMPOS_SESSAO_SQL}, senha_hash,
              (bloqueado_ate IS NOT NULL AND bloqueado_ate <= NOW()) AS bloqueio_expirado
       FROM Usuario WHERE login = ? LIMIT 1 FOR UPDATE`, [login]
    );
    const bloqueioExpirado = Boolean(usuario?.bloqueio_expirado);
    const bloqueado = Boolean(usuario?.bloqueado_ate && !bloqueioExpirado);
    if (!usuario || !usuario.ativo || bloqueado) {
      await connection.rollback();
      return { ok: false, bloqueado };
    }

    if (bloqueioExpirado) {
      await connection.query(
        'UPDATE Usuario SET falhas_login = 0, bloqueado_ate = NULL WHERE id = ?', [usuario.id]
      );
    }

    const falhasAnteriores = bloqueioExpirado ? 0 : Number(usuario.falhas_login || 0);
    const senhaCorreta = typeof senha === 'string' && senha.length > 0
      ? await compararHash(senha, usuario.senha_hash)
      : false;
    delete usuario.senha_hash;
    delete usuario.bloqueio_expirado;
    if (!senhaCorreta) {
      const falhas = falhasAnteriores + 1;
      await connection.query(
        'UPDATE Usuario SET falhas_login = ?, bloqueado_ate = ? WHERE id = ?',
        [falhas, falhas >= LIMITE_FALHAS ? new Date(Date.now() + BLOQUEIO_MS) : null, usuario.id]
      );
      await connection.commit();
      return { ok: false, bloqueado: falhas >= LIMITE_FALHAS };
    }

    await connection.query(
      'UPDATE Usuario SET falhas_login = 0, bloqueado_ate = NULL, ultimo_acesso = NOW() WHERE id = ?',
      [usuario.id]
    );
    await connection.commit();
    return { ok: true, usuario: projetarSessao(usuario) };
  } catch (error) {
    await connection.rollback().catch(() => logger.warn('[AUTH] codigo=ROLLBACK_FALHOU'));
    throw error;
  } finally {
    connection.release();
  }
}

async function buscarParaSessao(usuarioId) {
  const [[usuario]] = await db.query(
    `SELECT ${CAMPOS_SESSAO_SQL} FROM Usuario WHERE id = ? AND ativo = TRUE LIMIT 1`, [usuarioId]
  );
  return usuario ? projetarSessao(usuario) : usuario;
}

module.exports = {
  LIMITE_FALHAS,
  BLOQUEIO_MS,
  ErroUsuario,
  validarId,
  validarCriacao,
  projetarUsuario,
  criarUsuario,
  listarUsuarios,
  buscarUsuarioPorId,
  validarEdicao,
  validarRedefinicao,
  atualizarUsuario,
  desativarUsuario,
  redefinirSenha,
  autenticar,
  buscarParaSessao
};
