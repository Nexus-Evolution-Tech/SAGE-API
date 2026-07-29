/**
 * Backup do banco, com restauração VERIFICADA (Fase 2, E4).
 *
 * Princípio que guia este módulo: **backup não verificado não é backup.** Um arquivo que ninguém
 * nunca restaurou é uma promessa, não uma garantia — e a hora de descobrir que ele está corrompido,
 * truncado ou vazio não pode ser a hora em que a escola precisa dele.
 *
 * Por isso a verificação aqui não olha tamanho de arquivo nem código de saída do mysqldump: ela
 * **restaura de verdade** num banco temporário e confere que as tabelas essenciais existem e que a
 * contagem de linhas bate com a origem. Depois, apaga o banco temporário.
 *
 * Cuidados com o hardware alvo (HD mecânico, 8 GB):
 *   - `--single-transaction` para não travar tabela durante o dump;
 *   - `--quick` para não carregar tabelas inteiras em memória;
 *   - a verificação é cara (restaura tudo), então roda com frequência menor que o backup.
 */
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const mysql = require('mysql2/promise');
const logger = require('../config/logger');
const { paths } = require('../config/paths');
const execFileAsync = promisify(execFile);

function config() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'sage',
    diretorio: process.env.BACKUP_DIR || paths.backups,
    // No Windows o instalador conhece o caminho do MySQL que ele mesmo instalou.
    mysqldump: process.env.MYSQLDUMP_PATH || 'mysqldump',
    mysql: process.env.MYSQL_PATH || 'mysql',
    reterDias: parseInt(process.env.BACKUP_RETER_DIAS || '14', 10),
    reterMinimo: parseInt(process.env.BACKUP_RETER_MINIMO || '3', 10)
  };
}

/** Tabelas cuja ausência significa backup inútil. */
const TABELAS_ESSENCIAIS = ['UnidadeEscolar', 'Pessoa', 'Dispositivo', 'Acesso', 'Turma'];

function nomeArquivo(referencia = new Date()) {
  const iso = referencia.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `sage-backup-${iso}.sql`;
}

/**
 * Decide quais backups apagar.
 *
 * Função pura, separada do disco de propósito: política de retenção é exatamente o tipo de código
 * onde um erro apaga o que não devia, em silêncio, e só aparece quando alguém precisa restaurar.
 *
 * Regra: apaga o que passou de `reterDias`, MAS nunca deixa menos que `reterMinimo` arquivos.
 * A segunda parte importa: uma máquina com relógio errado (comum em PC de escola sem NTP) poderia
 * considerar todos os backups antigos e apagar tudo.
 */
function selecionarParaRemover(arquivos, { reterDias, reterMinimo }, agora = new Date()) {
  const limite = agora.getTime() - reterDias * 24 * 3600 * 1000;
  // Candidatos ordenados do MAIS ANTIGO para o mais novo: se só podemos remover alguns, os que
  // saem primeiro têm de ser os mais velhos. (Bug pego no teste: antes ordenava do mais novo,
  // e portanto removia o backup mais recente entre os vencidos, guardando o mais velho.)
  const candidatos = arquivos
    .filter((a) => new Date(a.modificadoEm).getTime() < limite)
    .sort((a, b) => new Date(a.modificadoEm) - new Date(b.modificadoEm));
  const podeRemover = Math.max(0, arquivos.length - reterMinimo);
  return candidatos.slice(0, podeRemover).map((a) => a.nome);
}

async function listarBackups() {
  const cfg = config();
  await fs.mkdir(cfg.diretorio, { recursive: true });
  const nomes = await fs.readdir(cfg.diretorio);
  const arquivos = [];
  for (const nome of nomes) {
    if (!nome.startsWith('sage-backup-') || !nome.endsWith('.sql')) continue;
    const st = await fs.stat(path.join(cfg.diretorio, nome));
    arquivos.push({ nome, caminho: path.join(cfg.diretorio, nome), bytes: st.size, modificadoEm: st.mtime });
  }
  return arquivos.sort((a, b) => b.modificadoEm - a.modificadoEm);
}

/** Gera o dump. Lança em caso de falha — nunca devolve "ok" sem arquivo (RNF-4). */
async function gerarBackup() {
  const cfg = config();
  await fs.mkdir(cfg.diretorio, { recursive: true });
  const destino = path.join(cfg.diretorio, nomeArquivo());

  const args = [
    `--host=${cfg.host}`, `--port=${cfg.port}`, `--user=${cfg.user}`,
    '--single-transaction', '--quick', '--routines', '--events',
    '--default-character-set=utf8mb4',
    // Sem isto o mysqldump emite um aviso sobre GTIDs e SAI COM CÓDIGO 2 — ou seja, o backup
    // falharia em produção por causa de um aviso, e a mensagem não deixa isso óbvio.
    // Descoberto ao rodar contra MySQL real; é também o que se quer para restaurar noutro banco.
    '--set-gtid-purged=OFF',
    cfg.database
  ];

  await new Promise((resolve, reject) => {
    const saida = fsSync.createWriteStream(destino);
    const proc = spawn(cfg.mysqldump, args, {
      env: { ...process.env, MYSQL_PWD: cfg.password }
    });
    let stderr = '';
    proc.stdout.pipe(saida);
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      saida.end();
      if (code !== 0) return reject(new Error(`mysqldump falhou (código ${code}): ${stderr.slice(0, 500)}`));
      resolve();
    });
  });

  const st = await fs.stat(destino);
  if (st.size === 0) {
    await fs.unlink(destino).catch(() => {});
    throw new Error('Backup gerado com 0 bytes — arquivo descartado');
  }

  logger.info(`[BACKUP] Gerado: ${path.basename(destino)} (${Math.round(st.size / 1024)} KB)`);
  return { caminho: destino, nome: path.basename(destino), bytes: st.size, geradoEm: new Date() };
}

/**
 * Restaura o backup num banco temporário e confere que ele serve.
 *
 * Este é o coração do módulo. Verificar tamanho de arquivo ou exit code não prova nada: um dump
 * pode terminar com sucesso e estar truncado, ou conter só a estrutura sem os dados.
 */
async function verificarBackup(caminhoArquivo) {
  const cfg = config();
  const bancoTemp = `sage_verif_${process.pid}_${Date.now()}`;
  const conexaoAdmin = { host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password };

  const problemas = [];
  let contagens = {};
  let admin;

  try {
    admin = await mysql.createConnection(conexaoAdmin);
    await admin.query(`CREATE DATABASE \`${bancoTemp}\` CHARACTER SET utf8mb4`);

    // Restaura de verdade
    await new Promise((resolve, reject) => {
      const proc = spawn(cfg.mysql, [
        `--host=${cfg.host}`, `--port=${cfg.port}`, `--user=${cfg.user}`, bancoTemp
      ], { env: { ...process.env, MYSQL_PWD: cfg.password } });
      let stderr = '';
      fsSync.createReadStream(caminhoArquivo).pipe(proc.stdin);
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code !== 0) return reject(new Error(`restauração falhou (código ${code}): ${stderr.slice(0, 500)}`));
        resolve();
      });
    });

    const restaurado = await mysql.createConnection({ ...conexaoAdmin, database: bancoTemp });
    const origem = await mysql.createConnection({ ...conexaoAdmin, database: cfg.database });

    try {
      const [tabelas] = await restaurado.query(
        'SELECT LOWER(TABLE_NAME) AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?',
        [bancoTemp]
      );
      const existentes = new Set(tabelas.map((l) => l.t));
      for (const t of TABELAS_ESSENCIAIS) {
        if (!existentes.has(t.toLowerCase())) problemas.push(`tabela essencial ausente no backup: ${t}`);
      }

      // Contagem comparada com a origem — é o que pega dump truncado.
      for (const t of TABELAS_ESSENCIAIS) {
        if (!existentes.has(t.toLowerCase())) continue;
        const [[a]] = await origem.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
        const [[b]] = await restaurado.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
        contagens[t] = { origem: a.n, backup: b.n };
        if (b.n < a.n) {
          problemas.push(`${t}: backup tem ${b.n} linha(s), origem tem ${a.n} — backup incompleto`);
        }
      }
    } finally {
      await restaurado.end().catch(() => {});
      await origem.end().catch(() => {});
    }
  } catch (erro) {
    problemas.push(erro.message);
  } finally {
    try {
      if (!admin) admin = await mysql.createConnection(conexaoAdmin);
      await admin.query(`DROP DATABASE IF EXISTS \`${bancoTemp}\``);
      await admin.end();
    } catch (erro) {
      logger.error(`[BACKUP] Falha ao remover banco temporário ${bancoTemp}: ${erro.message}`);
    }
  }

  const ok = problemas.length === 0;
  if (ok) logger.info(`[BACKUP] Restauração verificada com sucesso: ${path.basename(caminhoArquivo)}`);
  else logger.error(`[BACKUP] VERIFICAÇÃO FALHOU em ${path.basename(caminhoArquivo)}: ${problemas.join('; ')}`);

  return { ok, problemas, contagens, verificadoEm: new Date() };
}

async function aplicarRetencao() {
  const cfg = config();
  const arquivos = await listarBackups();
  const remover = selecionarParaRemover(arquivos, cfg);
  for (const nome of remover) {
    await fs.unlink(path.join(cfg.diretorio, nome)).catch((e) =>
      logger.error(`[BACKUP] Falha ao remover ${nome}: ${e.message}`)
    );
  }
  if (remover.length) logger.info(`[BACKUP] Retenção: ${remover.length} arquivo(s) antigo(s) removido(s)`);
  return remover;
}

module.exports = {
  gerarBackup,
  verificarBackup,
  listarBackups,
  aplicarRetencao,
  selecionarParaRemover,
  nomeArquivo,
  TABELAS_ESSENCIAIS
};
