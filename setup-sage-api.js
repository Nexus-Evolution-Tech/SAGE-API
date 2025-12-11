#!/usr/bin/env node

/**
 * setup-sage-api.js (v6 - Setup Seguro, Direto e Estável)
 * * Script de configuração que:
 * 1. Prepara o banco de dados.
 * 2. Cria o hash BCRYPT da senha padrão dinamicamente.
 * 3. Insere a Unidade Escolar (ETEC Taboão) diretamente via SQL de forma segura.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const bcrypt = require('bcrypt'); // Necessário para hashing

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

// ----- FUNÇÕES DE SETUP SQL -----

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

async function createDefaultUser(user, password) {
    const senhaTextoClaro = 'etec123'; 
    const saltRounds = 10;
    
    try {
        log(colors.blue, '   Gerando hash BCRYPT...');
        const senhaHashed = await bcrypt.hash(senhaTextoClaro, saltRounds); 
        
        // Não é mais necessário escapar '$' ou aspas simples, pois a query não passará pelo shell.
        
        // 1. A query é construída de forma limpa (sem escapes extras)
// Apenas altere o SQL dentro de createDefaultUser

        const sqlQuery = `
            INSERT INTO sage.UnidadeEscolar 
            (id, nome, numero_unidade, cnpj, login, senha, logradouro, numero, complemento, bairro, cidade, estado, cep, telefone_contato, logo) 
            VALUES 
            (1, 'ETEC Taboão da Serra', '293', '62823257029344', 'etec', '${senhaHashed}', 'Praça Miguel Ortega', '135', 'Prédio Principal', 'Parque Assunção', 'Taboão da Serra', 'SP', '06754160', '1147011856', 'logo_etec.png')
            ON DUPLICATE KEY UPDATE id=id
        `; // <-- Ponto e vírgula (;) removido daqui!
        
        // O comando shell agora apenas chama o MySQL, sem o '-e'
        const baseShellCommand = `mysql -h localhost -u ${user} -p${password} sage`;

        log(colors.blue, '   Executando inserção via STDIN...');
        
        // EXECUÇÃO FINAL: O Node.js executa o comando e envia a string SQL para ele.
        execSync(baseShellCommand, { 
          stdio: 'pipe',
          input: sqlQuery // <-- O comando SQL limpo é enviado como input.
        });
        
        log(colors.green, `   ✅ Unidade Escolar criada com sucesso! (Login: etec | Senha: ${senhaTextoClaro})`);
        return true;

    } catch (error) {
        log(colors.red, `   ❌ Erro ao criar Unidade Escolar. Verifique a sintaxe SQL e se o DB está rodando.`);
        
        // O erro real pode ser lido aqui, mas vamos manter a saída limpa
        // console.error(error.output.toString()); 
        
        return false;
    }
}

// --- FUNÇÃO MAIN ---

async function main() {
  log(colors.bright + colors.blue, '\n╔════════════════════════════════════════════════════════════╗');
  log(colors.bright + colors.blue, '║         SAGE-API - Setup Inicial Automático              ║');
  log(colors.bright + colors.blue, '╚════════════════════════════════════════════════════════════╝\n');

  // Passo 1: Verificar se .env existe
  log(colors.bright, '1. Verificando arquivo de configuração (.env)...');
  const env = readEnvFile();
  if (!env.DB_USER || !env.DB_PASSWORD) {
    log(colors.red, '   ❌ Configuração inválida. Certifique-se de que .env contém DB_USER e DB_PASSWORD.');
    process.exit(1);
  }

  // Passo 2: Verificar se o MySQL está disponível e rodando
  log(colors.bright, '2. Verificando MySQL...');
  const mysqlCmd = getMySQLCommand();
  if (!mysqlCmd) {
    log(colors.red, '   ❌ MySQL não encontrado. Verifique a instalação.');
    process.exit(1);
  }

  if (!checkMySQLRunning(mysqlCmd, env.DB_USER, env.DB_PASSWORD)) {
    log(colors.red, '   ❌ MySQL não está rodando ou as credenciais estão incorretas.');
    process.exit(1);
  }
  log(colors.green, '   ✅ MySQL rodando e acessível.');


  // Passo 3: Verificar e criar banco de dados e tabelas
  log(colors.bright, '\n3. Verificando/Criando banco de dados e tabelas...');
  if (!checkDatabaseExists(env.DB_USER, env.DB_PASSWORD)) {
    createDatabase(env.DB_USER, env.DB_PASSWORD);
    createTables(env.DB_USER, env.DB_PASSWORD);
  } else {
    log(colors.green, '   Banco de dados e tabelas parecem estar prontos.');
  }
  
  // Passo 4: Criar o usuário padrão (Unidade Escolar)
  log(colors.bright, '\n4. Inserindo dados iniciais (Unidade Escolar)...');
  await createDefaultUser(env.DB_USER, env.DB_PASSWORD); 

  log(colors.green, '\n Setup concluído com sucesso! Você pode iniciar o servidor com "npm start".\n');
}

main().catch(error => {
  log(colors.red, `\n ❌ Erro fatal durante setup: ${error.message}\n`);
  process.exit(1);
});