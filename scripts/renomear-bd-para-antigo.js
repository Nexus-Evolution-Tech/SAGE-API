/**
 * Renomeia o banco atual (ex: sage) para sage_antigo e deixa um banco sage vazio
 * para você subir o npm start zerado.
 *
 * Uso: node scripts/renomear-bd-para-antigo.js
 *
 * Requer: mysqldump e mysql no PATH (vêm com o MySQL).
 * Usa as credenciais do .env (DB_HOST, DB_USER, DB_PASSWORD, DB_NAME).
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { execSync } = require('child_process');

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = process.env.DB_PORT || '3306';
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || 'sage';

const DB_ANTIGO = `${DB_NAME}_antigo`;
const DUMP_FILE = path.resolve(__dirname, '..', `dump_${DB_NAME}_para_antigo.sql`);

function run(cmd, env = {}) {
  const fullEnv = { ...process.env, ...env };
  if (DB_PASSWORD) fullEnv.MYSQL_PWD = DB_PASSWORD;
  execSync(cmd, { stdio: 'inherit', shell: true, env: fullEnv });
}

function mysqlCmd(db = '') {
  const dbPart = db ? ` ${db}` : '';
  return `mysql -h "${DB_HOST}" -P ${DB_PORT} -u "${DB_USER}"${dbPart}`;
}

function mysqldumpCmd() {
  return `mysqldump -h "${DB_HOST}" -P ${DB_PORT} -u "${DB_USER}" --single-transaction --routines --triggers "${DB_NAME}"`;
}

function compararContagens(origem, destino) {
  const chaves = Object.keys(origem).sort();
  if (chaves.join(',') !== Object.keys(destino).sort().join(',')) return false;
  return chaves.every((tabela) => Number(origem[tabela]) === Number(destino[tabela]));
}

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Renomear BD atual para', DB_ANTIGO);
  console.log('  e deixar', DB_NAME, 'zerado para npm start');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (!DB_PASSWORD && process.platform === 'win32') {
    console.error('No Windows, defina DB_PASSWORD no .env para este script funcionar sem pedir senha.');
    process.exit(1);
  }

  try {
    console.log('1. Criando banco', DB_ANTIGO, '...');
    run(`${mysqlCmd()} -e "CREATE DATABASE IF NOT EXISTS \`${DB_ANTIGO}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"`);

    console.log('2. Exportando', DB_NAME, 'para arquivo...');
    const dumpQuoted = DUMP_FILE.includes(' ') ? `"${DUMP_FILE}"` : DUMP_FILE;
    run(`${mysqldumpCmd()} > ${dumpQuoted}`);

    console.log('3. Importando no banco', DB_ANTIGO, '...');
    run(`${mysqlCmd(DB_ANTIGO)} < ${dumpQuoted}`);

    console.log('3.1 Validando cópia restaurada...');
    const listarTabelas = (banco) => execSync(`${mysqlCmd()} -N -e "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='${banco}';"`, { shell: true, env: { ...process.env, MYSQL_PWD: DB_PASSWORD } }).toString().trim().split(/\r?\n/).filter(Boolean);
    const contar = (banco, tabelas) => Object.fromEntries(tabelas.map((tabela) => { const segura = tabela.replace(/`/g, '``'); return [tabela, execSync(`${mysqlCmd(banco)} -N -e "SELECT COUNT(*) FROM \`${segura}\`;"`, { shell: true, env: { ...process.env, MYSQL_PWD: DB_PASSWORD } }).toString().trim()]; }));
    const origem = listarTabelas(DB_NAME), destino = listarTabelas(DB_ANTIGO);
    if (!compararContagens(contar(DB_NAME, origem), contar(DB_ANTIGO, destino))) throw new Error('Cópia restaurada não confere com o banco original');

    console.log('4. Removendo banco', DB_NAME, '...');
    run(`${mysqlCmd()} -e "DROP DATABASE IF EXISTS \`${DB_NAME}\`;"`);

    console.log('5. Criando banco', DB_NAME, 'vazio...');
    run(`${mysqlCmd()} -e "CREATE DATABASE \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"`);

    console.log('6. Removendo arquivo de dump...');
    try { fs.unlinkSync(DUMP_FILE); } catch (_) {}

    console.log('\n✓ Pronto. Banco atual está em', DB_ANTIGO + '.');
    console.log('  Banco', DB_NAME, 'está vazio.');
    console.log('\n  Agora rode: npm run setup:db   (para criar tabelas)');
    console.log('  Ou rode: npm start   (que já chama o setup se precisar)\n');
  } catch (err) {
    console.error('\nErro:', err.message);
    if (fs.existsSync(DUMP_FILE)) {
      console.error('Arquivo de dump mantido em:', DUMP_FILE);
    }
    process.exit(1);
  }
}

if (require.main === module) main();
module.exports = { compararContagens };
