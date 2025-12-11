#!/usr/bin/env node

/**
 * run.js
 * 
 * Launcher do SAGE-API
 * 
 * Este script:
 * 1. Inicia MySQL portável (se configurado)
 * 2. Aguarda MySQL ficar disponível
 * 3. Inicia o servidor Node.js
 * 4. Abre navegador automaticamente
 * 5. Monitora ambos os processos
 * 6. Limpa ao encerrar
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, exec } = require('child_process');
const http = require('http');

const platform = os.platform();
const config = require('./config.json');

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(color, message) {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`${color}[${timestamp}] ${message}${colors.reset}`);
}

function logTitle(title) {
  console.log(colors.bright + colors.cyan + '\n╔════════════════════════════════════════════════════════════╗');
  console.log(`║  ${title.padEnd(58)}║`);
  console.log('╚════════════════════════════════════════════════════════════╝\n' + colors.reset);
}

let mysqlProcess = null;
let nodeProcess = null;
let isStopping = false;

function cleanup() {
  if (isStopping) return;
  isStopping = true;
  
  log(colors.yellow, 'Encerrando processos...');
  
  if (mysqlProcess) {
    log(colors.blue, 'Parando MySQL...');
    mysqlProcess.kill();
  }
  
  if (nodeProcess) {
    log(colors.blue, 'Parando servidor...');
    nodeProcess.kill();
  }
  
  log(colors.green, 'Encerrado com sucesso');
  process.exit(0);
}

// Sinais de encerramento
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

async function startMySQL() {
  return new Promise((resolve) => {
    if (!config.database.portable.enabled) {
      log(colors.yellow, '⚠️  MySQL portável desativado');
      resolve(true);
      return;
    }
    
    log(colors.blue, '🚀 Iniciando MySQL portável...');
    
    const mysqlPath = config.database.portable.path;
    let mysqldExe;
    
    if (platform === 'win32') {
      mysqldExe = path.join(mysqlPath, 'bin', 'mysqld.exe');
    } else {
      mysqldExe = path.join(mysqlPath, 'bin', 'mysqld');
    }
    
    // Verificar se MySQL existe
    if (!fs.existsSync(mysqldExe)) {
      log(colors.yellow, `MySQL não encontrado em ${mysqldExe}`);
      log(colors.blue, 'Tentando usar MySQL do sistema...');
      resolve(true);
      return;
    }
    
    try {
      // Inicia como processo separado
      if (platform === 'win32') {
        mysqlProcess = spawn('cmd.exe', ['/c', mysqldExe, '--skip-grant-tables']);
      } else {
        mysqlProcess = spawn(mysqldExe, ['--skip-grant-tables']);
      }
      
      mysqlProcess.stdout.on('data', (data) => {
        log(colors.cyan, `MySQL: ${data.toString().trim()}`);
      });
      
      mysqlProcess.stderr.on('data', (data) => {
        log(colors.yellow, `MySQL: ${data.toString().trim()}`);
      });
      
      // Aguardar MySQL ficar disponível
      let attempts = 0;
      const maxAttempts = 30; // 30 segundos
      
      const checkMySQL = setInterval(() => {
        attempts++;
        
        http.get(`http://localhost:${config.server.port}/health-check-db`, {
          method: 'GET',
        }, (res) => {
          if (res.statusCode === 200) {
            clearInterval(checkMySQL);
            log(colors.green, '✅ MySQL disponível');
            resolve(true);
          }
        }).on('error', () => {
          if (attempts >= maxAttempts) {
            clearInterval(checkMySQL);
            log(colors.yellow, '⚠️  MySQL levando mais tempo (continuando mesmo assim)');
            resolve(true);
          }
        });
      }, 1000);
      
    } catch (error) {
      log(colors.yellow, `⚠️  Erro ao iniciar MySQL: ${error.message}`);
      resolve(true); // Continua mesmo assim
    }
  });
}

async function startServer() {
  return new Promise((resolve) => {
    log(colors.blue, 'Iniciando servidor SAGE-API...');
    
    nodeProcess = spawn('node', ['index.js'], {
      cwd: __dirname,
      stdio: 'inherit'
    });
    
    nodeProcess.on('error', (err) => {
      log(colors.red, `Erro ao iniciar servidor: ${err.message}`);
      resolve(false);
    });
    
    // Aguardar servidor iniciar
    setTimeout(() => {
      log(colors.green, 'Servidor iniciado');
      resolve(true);
    }, 3000);
  });
}

async function openBrowser() {
  const url = `http://localhost:${config.server.port}`;
  
  try {
    if (platform === 'win32') {
      exec(`start ${url}`);
    } else if (platform === 'darwin') {
      exec(`open ${url}`);
    } else {
      exec(`xdg-open ${url}`);
    }
    
    log(colors.green, `Browser aberto: ${url}`);
  } catch (error) {
    log(colors.yellow, `Não foi possível abrir browser: ${error.message}`);
    log(colors.blue, `Abra manualmente: ${url}`);
  }
}

async function main() {
  logTitle('SAGE-API - Inicializador');
  
  log(colors.cyan, '📋 Informações:');
  log(colors.cyan, `   • Platform: ${platform}`);
  log(colors.cyan, `   • Node: ${process.version}`);
  log(colors.cyan, `   • Porta: ${config.server.port}`);
  log(colors.cyan, `   • Banco: ${config.database.credentials.database}\n`);
  
  try {
    // 1. Iniciar MySQL
    await startMySQL();
    
    // 2. Iniciar Servidor
    const serverOk = await startServer();
    if (!serverOk) {
      log(colors.red, 'Falha ao iniciar servidor');
      process.exit(1);
    }
    
    // 3. Abrir Browser
    await openBrowser();
    
    log(colors.bright + colors.green, '\n✨ SAGE-API está rodando!\n');
    
    log(colors.cyan, 'Informações úteis:');
    log(colors.cyan, `   • API: http://localhost:${config.server.port}`);
    log(colors.cyan, `   • Swagger: http://localhost:${config.server.port}/docs`);
    log(colors.cyan, '   • Pressione Ctrl+C para parar\n');
    
  } catch (error) {
    log(colors.red, `Erro: ${error.message}\n`);
    process.exit(1);
  }
}

main();
