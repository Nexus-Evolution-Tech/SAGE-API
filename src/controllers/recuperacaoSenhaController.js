const crypto = require('crypto');
const db = require('../config/database');
const logger = require('../config/logger');
const { hashSenha } = require('../utils/criptografia');
const { enviarEmailRecuperacaoSenha } = require('../services/emailService');

const TOKEN_BYTES = 32;
const EXPIRACAO_HORAS = 1;

/**
 * POST /escolas/esqueci-senha
 * Body: { email }
 * Busca UnidadeEscolar pelo email; se existir e tiver email cadastrado, gera token, salva hash e envia email.
 * Resposta genérica para não revelar se o email existe ou não.
 */
async function solicitarRecuperacao(req, res) {
  try {
    const { email } = req.body || {};
    const emailNorm = typeof email === 'string' ? email.trim().toLowerCase() : '';

    if (!emailNorm) {
      return res.status(400).json({ message: 'Informe o e-mail cadastrado na unidade.' });
    }

    const [rows] = await db.query(
      'SELECT id, nome, email FROM UnidadeEscolar WHERE LOWER(TRIM(email)) = ? AND email IS NOT NULL AND email != "" LIMIT 1',
      [emailNorm]
    );
    const unidade = rows[0];

    if (!unidade) {
      // Mesma resposta para não revelar existência do email (segurança)
      return res.status(200).json({
        message: 'Se o e-mail estiver cadastrado em uma unidade, você receberá um link para redefinir a senha. Verifique sua caixa de entrada e o spam.',
      });
    }

    const token = crypto.randomBytes(TOKEN_BYTES).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + EXPIRACAO_HORAS * 60 * 60 * 1000);

    await db.query(
      'INSERT INTO RecuperacaoSenha (unidade_id, token_hash, expires_at) VALUES (?, ?, ?)',
      [unidade.id, tokenHash, expiresAt]
    );

    const enviado = await enviarEmailRecuperacaoSenha(unidade.email, unidade.nome, token);

    if (!enviado) {
      logger.warn('[RECUPERACAO] Unidade encontrada mas e-mail não enviado (SMTP não configurado ou falha).');
      return res.status(503).json({
        message: 'Não foi possível enviar o e-mail no momento. Verifique se o servidor está configurado para envio de e-mails (SMTP) ou tente mais tarde.',
      });
    }

    return res.status(200).json({
      message: 'Se o e-mail estiver cadastrado em uma unidade, você receberá um link para redefinir a senha. Verifique sua caixa de entrada e o spam.',
    });
  } catch (err) {
    logger.error(`[RECUPERACAO] Erro ao solicitar recuperação: ${err.message}`);
    return res.status(500).json({ message: 'Erro interno. Tente novamente mais tarde.' });
  }
}

/**
 * POST /escolas/redefinir-senha
 * Body: { token, nova_senha }
 * Valida token (hash, não expirado, não usado), atualiza senha e invalida o token.
 */
async function redefinirSenha(req, res) {
  try {
    const { token, nova_senha } = req.body || {};

    if (!token || typeof token !== 'string' || !token.trim()) {
      return res.status(400).json({ message: 'Token inválido ou ausente.' });
    }
    if (!nova_senha || nova_senha.length < 6) {
      return res.status(400).json({ message: 'A nova senha deve ter no mínimo 6 caracteres.' });
    }

    const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');

    const [rows] = await db.query(
      'SELECT id, unidade_id FROM RecuperacaoSenha WHERE token_hash = ? AND expires_at > NOW() AND used_at IS NULL LIMIT 1',
      [tokenHash]
    );
    const registro = rows[0];

    if (!registro) {
      return res.status(400).json({
        message: 'Link inválido ou expirado. Solicite uma nova redefinição de senha na tela de login.',
      });
    }

    const senhaHash = await hashSenha(nova_senha);

    await db.query('UPDATE UnidadeEscolar SET senha = ? WHERE id = ?', [senhaHash, registro.unidade_id]);
    await db.query('UPDATE RecuperacaoSenha SET used_at = NOW() WHERE id = ?', [registro.id]);

    return res.status(200).json({
      message: 'Senha alterada com sucesso. Faça login com a nova senha.',
    });
  } catch (err) {
    logger.error(`[RECUPERACAO] Erro ao redefinir senha: ${err.message}`);
    return res.status(500).json({ message: 'Erro interno. Tente novamente mais tarde.' });
  }
}

module.exports = {
  solicitarRecuperacao,
  redefinirSenha,
};
