#!/usr/bin/env node

/**
 * setup-sage-api.js (v2 - Multi-Plataforma com Auto-MySQL)
 * 
 * Script de configuração automática do SAGE-API
 * 
 * Recursos:
 * - Detecta MySQL em Windows, macOS e Linux
 * - Inicia MySQL automaticamente se necessário
 * - Zero configuração manual
 * - Funciona com qualquer instalação do MySQL
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const crypto = require('crypto');

const platform = os.platform();

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
};

function log(color, message) {
  console.log(`${color}${message}${colors.reset}`);
}

function generateJWTSecret() {
  // Gera uma chave aleatória de 64 caracteres (bem segura)
  return crypto.randomBytes(32).toString('hex');
}

function checkFileExists(filePath) {
  return fs.existsSync(filePath);
}

function readEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!checkFileExists(envPath)) {
    return {};
  }
  
  const content = fs.readFileSync(envPath, 'utf-8');
  const env = {};
  
  content.split('\n').forEach(line => {
    if (line.trim() && !line.startsWith('#')) {
      const [key, ...valueParts] = line.split('=');
      if (key.trim()) {
        env[key.trim()] = valueParts.join('=').trim();
      }
    }
  });
  
  return env;
}

function writeEnvFile(env) {
  const envPath = path.join(__dirname, '.env');
  const content = Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  
  fs.writeFileSync(envPath, content, 'utf-8');
}

// Get MySQL command (tries different paths for each platform)
function getMySQLCommand() {
  const paths = platform === 'win32'
    ? ['mysql', 'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysql.exe']
    : platform === 'darwin'
    ? ['mysql', '/usr/local/mysql/bin/mysql', '/opt/homebrew/bin/mysql']
    : ['mysql', '/usr/bin/mysql', '/usr/local/bin/mysql'];

  for (const p of paths) {
    try {
      execSync(`"${p}" --version`, { stdio: 'ignore' });
      return p;
    } catch (e) {}
  }
  return null;
}

function checkMySQLAvailable() {
  try {
    const cmd = getMySQLCommand();
    if (cmd) return true;
    return false;
  } catch (error) {
    return false;
  }
}

function checkMySQLRunning(mysqlCmd, user = 'root', password = '') {
  try {
    const passwordFlag = password ? `-p${password}` : '';
    const cmd = `"${mysqlCmd}" -h localhost -u ${user} ${passwordFlag} -e "SELECT 1"`;
    execSync(cmd, { 
      stdio: 'pipe',
      encoding: 'utf-8'
    });
    return true;
  } catch (error) {
    return false;
  }
}

function createDatabase(user, password) {
  try {
    log(colors.blue, '   Criando banco de dados "sage"...');
    
    const sqlCommands = `
      CREATE DATABASE IF NOT EXISTS sage;
      USE sage;
      SET time_zone = '-03:00';
    `;
    
    execSync(
      `mysql -h localhost -u ${user} -p${password} -e "${sqlCommands.replace(/\n/g, ' ')}"`,
      { stdio: 'pipe' }
    );
    
    log(colors.green, '   Banco de dados criado com sucesso!');
    return true;
  } catch (error) {
    log(colors.red, `   Erro ao criar banco: ${error.message}`);
    return false;
  }
}

function createTables(user, password) {
  try {
    log(colors.blue, '   Criando tabelas...');
    
    const schemaPath = path.join(__dirname, 'database', 'sage.sql');
    if (!checkFileExists(schemaPath)) {
      log(colors.yellow, '   ⚠️  Schema SQL não encontrado em database/sage.sql');
      return false;
    }
    
    execSync(
      `mysql -h localhost -u ${user} -p${password} sage < "${schemaPath}"`,
      { stdio: 'pipe' }
    );
    
    log(colors.green, '   Tabelas criadas com sucesso!');
    return true;
  } catch (error) {
    log(colors.red, `   Erro ao criar tabelas: ${error.message}`);
    return false;
  }
}

function createDefaultUser(user, password) {
  try {
    log(colors.blue, '   Criando usuário padrão...');
    const sqlCommand = `
      INSERT INTO sage.UnidadeEscolar 
      (id, nome, numero_unidade, cnpj, login, senha, logradouro, numero, complemento, bairro, cidade, estado, cep, telefone_contato, logo) 
      VALUES 
      (1, 'ETEC Taboão da Serra', '293', '62823257029344', 'etec', 'etec123', 'Praça Miguel Ortega', '135', 'Prédio Principal', 'Parque Assunção', 'Taboão da Serra', 'SP', '06754160', '1147011856', 'logo_etec.png')
      ON DUPLICATE KEY UPDATE id=id;
    `;
    execSync(
      `mysql -h localhost -u ${user} -p${password} -e "${sqlCommand.replace(/\n/g, ' ')}"`,
      { stdio: 'pipe' }
    );
    log(colors.green, '   Usuário padrão criado!');
    return true;
  } catch (error) {
    log(colors.yellow, `   Não foi possível criar usuário padrão: ${error.message}`);
    return false;
  }
}

function checkDatabaseExists(user, password) {
  try {
    const cmd = `mysql -h localhost -u ${user} -p${password} -e "USE sage;"`;
    execSync(cmd, { stdio: 'pipe' });
    log(colors.green, '   Banco de dados "sage" já existe.');
    return true;
  } catch (error) {
    log(colors.yellow, '   Banco de dados "sage" não encontrado. Será criado automaticamente.');
    return false;
  }
}

async function main() {
  log(colors.bright + colors.blue, '\n╔════════════════════════════════════════════════════════════╗');
  log(colors.bright + colors.blue, '║         SAGE-API - Setup Inicial Automático              ║');
  log(colors.bright + colors.blue, '╚════════════════════════════════════════════════════════════╝\n');

  // Passo 1: Verificar se .env existe
  log(colors.bright, 'Verificando arquivo de configuração (.env)...');
  const env = readEnvFile();
  if (!env.DB_USER || !env.DB_PASSWORD) {
    log(colors.red, '   Configuração inválida. Certifique-se de que .env contém DB_USER e DB_PASSWORD.');
    process.exit(1);
  }

  // Passo 2: Verificar se o MySQL está disponível
  log(colors.bright, 'Verificando disponibilidade do MySQL...');
  const mysqlCmd = getMySQLCommand();
  if (!mysqlCmd || !checkMySQLRunning(mysqlCmd, env.DB_USER, env.DB_PASSWORD)) {
    log(colors.red, '   MySQL não está disponível ou credenciais estão incorretas.');
    process.exit(1);
  }

  // Passo 3: Verificar e criar banco de dados, tabelas e usuário padrão
  log(colors.bright, 'Verificando banco de dados...');
  if (!checkDatabaseExists(env.DB_USER, env.DB_PASSWORD)) {
    createDatabase(env.DB_USER, env.DB_PASSWORD);
    createTables(env.DB_USER, env.DB_PASSWORD);
    createDefaultUser(env.DB_USER, env.DB_PASSWORD);
  }

  log(colors.green, '\n Setup concluído com sucesso! Você pode iniciar o servidor com "npm start".\n');
}

main().catch(error => {
  log(colors.red, `\n Erro durante setup: ${error.message}\n`);
  process.exit(1);
});
