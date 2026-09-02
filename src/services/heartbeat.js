/**
 * Heartbeat outboundo (R3-02).
 *
 * Telemetria é opcional: sem URL configurada este módulo não cria conexão nem altera o fluxo
 * local. Quando configurado, só aceita HTTPS na porta 443 e toda falha é absorvida.
 */
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_CATARACA_AGE_SECONDS = 30 * 60;

const NOMES = Object.freeze({ vivo: 'HC_URL_VIVO', boot: 'HC_URL_BOOT', sync: 'HC_URL_SYNC' });

function obterUrl(nome, env = process.env) {
  return String(env[NOMES[nome]] || '').trim();
}

function validarUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && (!parsed.port || parsed.port === '443');
  } catch {
    return false;
  }
}

function temConfiguracao(env = process.env) {
  return Object.keys(NOMES).some((nome) => obterUrl(nome, env));
}

function urlComStatus(url, status) {
  if (!status) return url;
  const parsed = new URL(url);
  parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}${status}`;
  return parsed.toString();
}

async function ping(nome, { status = '', env = process.env, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const url = obterUrl(nome, env);
  if (!url) return { nome, configurado: false, enviado: false, motivo: 'nao_configurado' };
  if (!validarUrl(url)) return { nome, configurado: true, enviado: false, motivo: 'url_invalida' };
  if (typeof fetchImpl !== 'function') return { nome, configurado: true, enviado: false, motivo: 'fetch_indisponivel' };

  try {
    await fetchImpl(urlComStatus(url, status), {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs)
    });
    return { nome, configurado: true, enviado: true };
  } catch {
    // Falha de observabilidade não pode virar falha de negócio nem ruído com dados da rede.
    return { nome, configurado: true, enviado: false, motivo: 'indisponivel' };
  }
}

async function estadoLocal({ db, saude, agora = new Date(), maxCatracaAgeSeconds = DEFAULT_MAX_CATARACA_AGE_SECONDS } = {}) {
  let banco = false;
  try {
    banco = typeof db?.healthCheck === 'function'
      ? await db.healthCheck()
      : Boolean(await db?.query?.('SELECT 1'));
  } catch {
    banco = false;
  }

  const dispositivos = typeof saude?.todos === 'function' ? saude.todos() : [];
  const limite = maxCatracaAgeSeconds * 1000;
  const catraca = dispositivos.some((dispositivo) => {
    if (dispositivo.alcancavel !== true || !dispositivo.ultimoSucessoEm) return false;
    return agora.getTime() - new Date(dispositivo.ultimoSucessoEm).getTime() <= limite;
  });

  return { processo: true, banco, catraca };
}

async function enviarHeartbeat(deps = {}) {
  const { env = process.env } = deps;
  if (!temConfiguracao(env)) return { configurado: false, estado: null, pings: [] };
  const estado = await estadoLocal(deps);
  const [vivo, sync] = await Promise.all([
    ping('vivo', { ...deps, status: estado.banco ? '' : '/fail' }),
    ping('sync', { ...deps, status: estado.catraca ? '' : '/fail' })
  ]);
  return { configurado: true, estado, pings: [vivo, sync] };
}

function iniciarHeartbeat({ intervalMs = DEFAULT_INTERVAL_MS, ...deps } = {}) {
  if (!temConfiguracao(deps.env)) return null;

  let executando = false;
  let bootEnviado = false;
  const executar = async () => {
    if (executando) return;
    executando = true;
    try {
      if (!bootEnviado) {
        await ping('boot', deps);
        bootEnviado = true;
      }
      await enviarHeartbeat(deps);
    } finally {
      executando = false;
    }
  };

  void executar();
  return setInterval(() => { void executar(); }, intervalMs);
}

module.exports = {
  DEFAULT_INTERVAL_MS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_CATARACA_AGE_SECONDS,
  validarUrl,
  temConfiguracao,
  ping,
  estadoLocal,
  enviarHeartbeat,
  iniciarHeartbeat
};
