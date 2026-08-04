/**
 * Harness de banco para testes de integração.
 *
 * Provisiona um banco MySQL ISOLADO (nome próprio, prefixo `sage_verif_`), aplica o schema pelo
 * caminho real de instalação (`scripts/setup-database.js`) e derruba tudo no final.
 *
 * Usar o instalador de verdade em vez de um dump paralelo é deliberado: assim o próprio caminho de
 * instalação fica sob teste. Foi exatamente assim que os achados A-1/A-2 apareceram
 * (ver docs/ACHADOS-INSTALADOR.md).
 *
 * NOTA: isto só funciona porque o achado A-1 foi corrigido. Antes, `sage.sql` tinha
 * `USE sage` fixo e ignorava DB_NAME — era impossível isolar banco de teste.
 *
 * Se não houver MySQL acessível, os testes que dependem disto devem ser PULADOS, não falhados:
 * use `descrebeSeTemBanco` para isso. Credenciais vêm do ambiente (ou do .env), nunca do código.
 */
const mysql = require('mysql2/promise');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const RAIZ = path.join(__dirname, '..', '..');

function configConexao() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    // Constante do contrato de produção; o teste de fuso não pode herdar o timezone da máquina.
    timezone: '-03:00',
    multipleStatements: true
  };
}

/** Testa se há MySQL acessível. Retorna true/false, nunca lança. */
async function temBancoDisponivel() {
  let conexao;
  try {
    conexao = await mysql.createConnection({ ...configConexao(), connectTimeout: 3000 });
    await conexao.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    if (conexao) await conexao.end().catch(() => {});
  }
}

/**
 * Cria um banco isolado e aplica o schema completo pelo instalador real.
 * @returns {{ nome: string, pool: import('mysql2/promise').Pool, destruir: () => Promise<void> }}
 */
async function criarBancoDeTeste(sufixo = '') {
  // A conta de manutenção do instalador recebe DDL somente neste namespace. Isso permite que
  // a mesma suíte prove o pacote real sem ampliar seus privilégios para bancos arbitrários.
  const nome = `sage_verif_${process.pid}${sufixo ? '_' + sufixo : ''}`;
  const admin = await mysql.createConnection(configConexao());
  await admin.query(`DROP DATABASE IF EXISTS \`${nome}\``);
  await admin.end();

  // Aplica o schema rodando o instalador REAL, em processo separado, com DB_NAME apontando
  // para o banco isolado. Se o instalador quebrar, o teste quebra — é o que queremos.
  const cfg = configConexao();
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [path.join(RAIZ, 'scripts', 'setup-database.js')],
    {
      cwd: RAIZ,
      timeout: 120000,
      env: {
        ...process.env,
        DB_HOST: cfg.host,
        DB_PORT: String(cfg.port),
        DB_USER: cfg.user,
        DB_PASSWORD: cfg.password,
        DB_NAME: nome,
        NODE_ENV: 'test',
        LOG_LEVEL: 'error',
        JWT_SECRET: process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex'),
        SAGE_INITIAL_ADMIN_LOGIN: `teste_${process.pid}`,
        SAGE_INITIAL_ADMIN_PASSWORD: crypto.randomBytes(24).toString('base64url'),
        SAGE_INITIAL_SCHOOL_NAME: 'Unidade de teste'
      }
    }
  );

  const pool = mysql.createPool({ ...configConexao(), database: nome, connectionLimit: 4 });

  // O instalador pode terminar com exit 0 mesmo falhando (achado A-2, ainda aberto).
  // Então validamos aqui, explicitamente, em vez de confiar no código de saída.
  const [tabelas] = await pool.query(
    'SELECT COUNT(*) AS total FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?',
    [nome]
  );
  if (tabelas[0].total === 0) {
    await pool.end();
    throw new Error(
      `Instalador nao criou nenhuma tabela em ${nome}.\nstdout: ${stdout}\nstderr: ${stderr}`
    );
  }

  return {
    nome,
    pool,
    async destruir() {
      await pool.end().catch(() => {});
      const adm = await mysql.createConnection(configConexao());
      await adm.query(`DROP DATABASE IF EXISTS \`${nome}\``);
      await adm.end();
    }
  };
}

module.exports = { temBancoDisponivel, criarBancoDeTeste, configConexao };
