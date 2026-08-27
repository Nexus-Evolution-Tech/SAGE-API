const logger = require('../config/logger');
const service = require('../services/assistentePrimeiraExecucaoService');
const STATUS = { ONBOARDING_PAYLOAD_INVALIDO: 400, ONBOARDING_PASSO_INVALIDO: 400, ONBOARDING_IF_MATCH_INVALIDO: 400, ONBOARDING_IF_MATCH_AUSENTE: 428, ONBOARDING_VERSION_OBSOLETA: 412, ONBOARDING_PASSO_FORA_DE_ORDEM: 409, ONBOARDING_PRE_CONDICAO_AUSENTE: 409, ONBOARDING_CONCORRENCIA: 409, ONBOARDING_ESTADO_INDISPONIVEL: 503, ONBOARDING_ESTADO_INVALIDO: 503 };
const MENSAGENS = { ONBOARDING_PAYLOAD_INVALIDO: 'Dados de retomada inválidos', ONBOARDING_PASSO_INVALIDO: 'Passo inválido', ONBOARDING_IF_MATCH_INVALIDO: 'If-Match inválido', ONBOARDING_IF_MATCH_AUSENTE: 'If-Match obrigatório', ONBOARDING_VERSION_OBSOLETA: 'Versão do estado obsoleta', ONBOARDING_PASSO_FORA_DE_ORDEM: 'Passo fora de ordem', ONBOARDING_PRE_CONDICAO_AUSENTE: 'Pré-condição do passo não atendida', ONBOARDING_CONCORRENCIA: 'Transição concorrente rejeitada', ONBOARDING_ESTADO_INDISPONIVEL: 'Estado do assistente indisponível', ONBOARDING_ESTADO_INVALIDO: 'Estado do assistente indisponível' };
const falha = (code) => { throw new service.ErroOnboarding(code); };
function validarSemPayload(req) {
  if (Object.keys(req.query || {}).length > 0) falha('ONBOARDING_PAYLOAD_INVALIDO');
  const body = req.body;
  if (body !== undefined && (body === null || Array.isArray(body) || typeof body !== 'object' || Object.getPrototypeOf(body) !== Object.prototype || Object.keys(body).length > 0)) falha('ONBOARDING_PAYLOAD_INVALIDO');
}
function versaoDoCabecalho(req) {
  const header = req.get('If-Match');
  if (header === undefined) falha('ONBOARDING_IF_MATCH_AUSENTE');
  const match = /^"(0|[1-9][0-9]*)"$/.exec(header);
  const version = match ? Number(match[1]) : NaN;
  if (!Number.isSafeInteger(version)) falha('ONBOARDING_IF_MATCH_INVALIDO');
  return version;
}
function responderErro(res, error, operacao) {
  const code = error?.code;
  if (!STATUS[code]) logger.error('[ONBOARDING] codigo=ERRO_NAO_CLASSIFICADO', { operacao });
  const publicCode = STATUS[code] ? code : 'ONBOARDING_ESTADO_INDISPONIVEL';
  return res.status(STATUS[publicCode]).json({ message: MENSAGENS[publicCode], code: publicCode });
}
async function obterEstado(_req, res) { try { return res.json(await service.obterEstado()); } catch (error) { return responderErro(res, error, 'leitura'); } }
async function retomarPasso(req, res) {
  try { validarSemPayload(req); return res.json(await service.retomarPasso(req.params.step, versaoDoCabecalho(req))); }
  catch (error) { return responderErro(res, error, 'retomar'); }
}
module.exports = { obterEstado, retomarPasso };
