/**
 * Serviço de envio de e-mail (nodemailer).
 * Configure SMTP no .env para ativar recuperação de senha.
 */
const nodemailer = require('nodemailer');
const logger = require('../config/logger');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const secure = process.env.SMTP_SECURE === 'true';

  if (!host || !user || !pass) {
    logger.warn('[EMAIL] SMTP não configurado (SMTP_HOST, SMTP_USER, SMTP_PASS). Recuperação de senha por email desativada.');
    return null;
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
  return transporter;
}

/**
 * Envia e-mail. Retorna true se enviou, false se SMTP não configurado ou falha.
 * @param {string} to - Email do destinatário
 * @param {string} subject - Assunto
 * @param {string} html - Corpo HTML
 * @param {string} [text] - Corpo texto plano (opcional)
 */
async function enviarEmail(to, subject, html, text = null) {
  const trans = getTransporter();
  if (!trans) return false;

  const from = process.env.EMAIL_FROM || process.env.SMTP_USER || 'noreply@sage.local';

  try {
    await trans.sendMail({
      from,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]+>/g, ''),
    });
    logger.info(`[EMAIL] Enviado para ${to}: ${subject}`);
    return true;
  } catch (err) {
    logger.error(`[EMAIL] Erro ao enviar para ${to}: ${err.message}`);
    return false;
  }
}

/**
 * Envia e-mail de recuperação de senha com o link para redefinir.
 * @param {string} to - Email da unidade
 * @param {string} nomeUnidade - Nome da unidade (para personalizar)
 * @param {string} token - Token único (será incluído no link)
 */
async function enviarEmailRecuperacaoSenha(to, nomeUnidade, token) {
  const baseUrl = (process.env.FRONTEND_URL || process.env.CORS_ORIGINS || 'http://localhost:3001').split(',')[0].trim();
  const link = `${baseUrl.replace(/\/$/, '')}/redefinir-senha?token=${encodeURIComponent(token)}`;
  const validade = '1 hora';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: sans-serif; line-height: 1.5; color: #333; max-width: 520px; margin: 0 auto; padding: 1rem; }
    .box { background: #f5f5f5; border-radius: 8px; padding: 1.5rem; margin: 1rem 0; }
    .btn { display: inline-block; background: #021932; color: #fff !important; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600; margin: 0.5rem 0; }
    .muted { font-size: 0.9rem; color: #666; }
    .footer { margin-top: 1.5rem; font-size: 0.85rem; color: #888; }
  </style>
</head>
<body>
  <p>Olá${nomeUnidade ? `, <strong>${nomeUnidade}</strong>` : ''},</p>
  <p>Foi solicitada a redefinição de senha do sistema SAGE para este e-mail.</p>
  <div class="box">
    <p>Clique no botão abaixo para definir uma nova senha:</p>
    <p><a href="${link}" class="btn">Redefinir senha</a></p>
    <p class="muted">Ou copie e cole no navegador: ${link}</p>
    <p class="muted">Este link é válido por ${validade}. Após esse prazo, será necessário solicitar novamente.</p>
  </div>
  <p>Se você não solicitou essa alteração, ignore este e-mail. Sua senha permanecerá a mesma.</p>
  <p class="footer">SAGE — Sistema de Automação e Gerenciamento Escolar</p>
</body>
</html>`;

  return enviarEmail(to, 'Redefinição de senha — SAGE', html);
}

module.exports = {
  enviarEmail,
  enviarEmailRecuperacaoSenha,
  getTransporter,
};
