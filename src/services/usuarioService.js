const db = require('../config/database');
const { compararHash } = require('../utils/criptografia');
const logger = require('../config/logger');

const LIMITE_FALHAS = 5;
const BLOQUEIO_MS = 15 * 60 * 1000;
const CAMPOS_SESSAO = `id, login, nome_exibicao, papel, ativo, pessoa_id,
  precisa_trocar_senha, falhas_login, bloqueado_ate, ultimo_acesso`;

async function autenticar(login, senha) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [[usuario]] = await connection.query(
      `SELECT *, (bloqueado_ate IS NOT NULL AND bloqueado_ate <= NOW()) AS bloqueio_expirado
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
    return { ok: true, usuario };
  } catch (error) {
    await connection.rollback().catch(() => logger.warn('[AUTH] codigo=ROLLBACK_FALHOU'));
    throw error;
  } finally {
    connection.release();
  }
}

async function buscarParaSessao(usuarioId) {
  const [[usuario]] = await db.query(
    `SELECT ${CAMPOS_SESSAO} FROM Usuario WHERE id = ? AND ativo = TRUE LIMIT 1`, [usuarioId]
  );
  return usuario;
}

module.exports = { LIMITE_FALHAS, BLOQUEIO_MS, autenticar, buscarParaSessao };
