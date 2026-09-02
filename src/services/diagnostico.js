/**
 * Bundle de diagnóstico (Fase 2, E7 / RNF-12).
 *
 * O sistema roda numa escola onde não convivemos. O que chega é feedback humano e log.
 *
 * Este é o **cavalo de batalha da manutenção remota**: um clique gera um arquivo que a secretaria
 * envia por e-mail ou WhatsApp. Funciona **sem internet** — por isso não é plano B, é o alicerce:
 * telemetria depende de conectividade, isto não.
 *
 * Meta declarada: o bundle deve responder 80% dos chamados **sem uma segunda pergunta**. Cada vez
 * que precisarmos pedir informação adicional, isso é bug DO BUNDLE, e vira item de melhoria dele.
 *
 * Tudo passa pelo sanitizador (services/sanitizador.js). São dados de menores: nada pessoal sai.
 */
const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const { randomUUID } = require('crypto');
const { sanitizar, sanitizarConfiguracao } = require('./sanitizador');
const saudeDispositivos = require('./saudeDispositivos');
const logger = require('../config/logger');
const { paths } = require('../config/paths');

const RAIZ = path.join(__dirname, '..', '..');

async function versaoPacote() {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(RAIZ, 'package.json'), 'utf8'));
    return { pacote: pkg.name, versao: pkg.version };
  } catch {
    return { pacote: null, versao: null };
  }
}

/** Espaço livre em disco — em HD de escola, disco cheio é causa real e frequente. */
async function espacoEmDisco() {
  try {
    const st = await fs.statfs(paths.dataRoot);
    const totalBytes = st.blocks * st.bsize;
    const livreBytes = st.bavail * st.bsize;
    return {
      totalGB: +(totalBytes / 1e9).toFixed(1),
      livreGB: +(livreBytes / 1e9).toFixed(1),
      percentualLivre: totalBytes > 0 ? Math.round((livreBytes / totalBytes) * 100) : null
    };
  } catch (erro) {
    return { erro: erro.message };
  }
}

/**
 * Auto-diagnóstico: responde as perguntas que a gente faria por telefone.
 * Cada item é uma pergunta de suporte que deixa de precisar ser feita.
 */
async function autoDiagnostico(db) {
  const itens = {};

  // Banco responde?
  try {
    const inicio = Date.now();
    await db.query('SELECT 1');
    itens.banco = { ok: true, latenciaMs: Date.now() - inicio };
  } catch (erro) {
    itens.banco = { ok: false, motivo: erro.message };
  }

  // Tabelas essenciais existem? (pega instalação incompleta — achado A-2)
  try {
    const [linhas] = await db.query(
      'SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?',
      [process.env.DB_NAME || 'sage']
    );
    itens.tabelas = { total: linhas[0].n, ok: linhas[0].n >= 20 };
  } catch (erro) {
    itens.tabelas = { ok: false, motivo: erro.message };
  }

  // Volume de dados — contexto para queixa de lentidão em HD mecânico
  for (const tabela of ['Pessoa', 'Acesso', 'sync_pendente']) {
    try {
      const [[linha]] = await db.query(`SELECT COUNT(*) AS n FROM \`${tabela}\``);
      itens[`linhas_${tabela}`] = linha.n;
    } catch {
      itens[`linhas_${tabela}`] = null;
    }
  }

  // Buffer pool: se estiver no padrão de 128 MB, boa parte da lentidão é config, não código
  try {
    const [[v]] = await db.query("SHOW VARIABLES LIKE 'innodb_buffer_pool_size'");
    const bytes = Number(v?.Value || 0);
    itens.innodb_buffer_pool = {
      MB: Math.round(bytes / 1048576),
      // 134217728 = 128 MB = padrão do MySQL. Vale sinalizar explicitamente.
      noPadrao: bytes === 134217728
    };
  } catch {
    itens.innodb_buffer_pool = null;
  }

  return itens;
}

/**
 * Monta o bundle completo.
 * @param {object} deps { db, backupBanco }
 */
async function gerarBundle({ db, backupBanco } = {}) {
  const pacote = await versaoPacote();

  let backups = null;
  if (backupBanco) {
    try {
      const arquivos = await backupBanco.listarBackups();
      backups = {
        total: arquivos.length,
        maisRecente: arquivos[0]
          ? {
              geradoEm: arquivos[0].modificadoEm,
              bytes: arquivos[0].bytes,
              horasAtras: Math.round((Date.now() - new Date(arquivos[0].modificadoEm).getTime()) / 3600000)
            }
          : null
      };
    } catch (erro) {
      backups = { erro: erro.message };
    }
  }

  const bruto = {
    manifesto: {
      schemaVersion: 1,
      tipo: 'diagnostico-sage',
      id: randomUUID(),
      secoes: ['manifesto', 'aplicacao', 'ambiente', 'disco', 'autoDiagnostico', 'dispositivos', 'backups', 'configuracao']
    },
    geradoEm: new Date().toISOString(),
    aplicacao: pacote,
    ambiente: {
      node: process.version,
      plataforma: `${os.platform()} ${os.release()}`,
      arquitetura: os.arch(),
      cpus: os.cpus().length,
      memoriaTotalGB: +(os.totalmem() / 1e9).toFixed(1),
      memoriaLivreGB: +(os.freemem() / 1e9).toFixed(1),
      // Quanto o processo está consumindo: responde "o Node está estourando a memória?"
      memoriaProcessoMB: Math.round(process.memoryUsage().rss / 1048576),
      uptimeSegundos: Math.round(process.uptime()),
      uptimeMaquinaSegundos: Math.round(os.uptime()),
      fusoDoSistema: Intl.DateTimeFormat().resolvedOptions().timeZone,
      // O desvio de 3h no round-trip de DATETIME depende disto (ver test/fuso-horario.test.js)
      offsetMinutos: new Date().getTimezoneOffset()
    },
    disco: await espacoEmDisco(),
    autoDiagnostico: db ? await autoDiagnostico(db) : null,
    dispositivos: saudeDispositivos.todos().map((d) => ({
      dispositivo_id: d.dispositivo_id,
      nivel: saudeDispositivos.descreverParaOperador(d).nivel,
      falhasConsecutivas: d.falhasConsecutivas,
      alcancavel: d.alcancavel,
      ultimoSucessoEm: d.ultimoSucessoEm,
      ultimaFalhaEm: d.ultimaFalhaEm,
      // `motivoTecnico`: string da pilha de rede (ECONNREFUSED, ETIMEDOUT), não texto humano.
      // O nome da chave é o que autoriza o sanitizador a preservá-la.
      motivoTecnico: d.ultimoMotivo,
      historico: (d.historico || []).map((h) => ({
        em: h.em, operacao: h.operacao, motivoTecnico: h.motivo
      }))
    })),
    backups
  };

  // Passagem obrigatória pelo sanitizador. Mesmo que cada parte acima pareça segura, a garantia
  // tem de estar em UM lugar só — senão a próxima pessoa que adicionar uma seção esquece.
  const seguro = sanitizar(bruto);

  // A configuração é anexada DEPOIS, de propósito.
  //
  // `sanitizarConfiguracao` já é uma lista de permissão: só emite variáveis conhecidas e troca
  // segredo por [DEFINIDO]/[NAO_DEFINIDO]. Passá-la pelo sanitizador genérico redigia tudo —
  // inclusive DB_HOST e CATRACA_TIMEOUT — porque a regra de "falhar fechado em chave desconhecida"
  // não sabe que aquela subárvore já foi tratada.
  //
  // Um bundle seguro mas vazio não é seguro: é inútil, e força a ligação telefônica que ele
  // deveria evitar. Aqui a garantia vem da própria construção por lista de permissão, coberta por
  // test/sanitizador.test.js.
  seguro.configuracao = sanitizarConfiguracao();

  return seguro;
}

/** Nome de arquivo que já identifica a escola e o momento, sem conter dado pessoal. */
function nomeArquivoBundle(referencia = new Date()) {
  const iso = referencia.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `sage-diagnostico-${iso}.json`;
}

module.exports = { gerarBundle, nomeArquivoBundle, autoDiagnostico, espacoEmDisco };
