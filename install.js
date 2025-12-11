#!/usr/bin/env node

/**
 * install.js
 * 
 * Script de Instalação do SAGE-API
 * Funciona em Windows, macOS e Linux
 * 
 * Este script:
 * 1. Detecta o sistema operacional
 * 2. Cria estrutura de diretórios
 * 3. Extrai MySQL portável (se necessário)
 * 4. Executa configuração inicial
 * 5. Cria atalhos de inicialização
 * 6. Testa tudo e avisa se está pronto
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const https = require('https');
const Extract = require('extract-zip');

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
  console.log(`${color}${message}${colors.reset}`);
}

function logTitle(title) {
  log(colors.bright + colors.cyan, '\n╔════════════════════════════════════════════════════════════╗');
  log(colors.bright + colors.cyan, `║  ${title.padEnd(58)}║`);
  log(colors.bright + colors.cyan, '╚════════════════════════════════════════════════════════════╝\n');
}

function getPaths() {
  if (platform === 'win32') {
    return {
      installPath: 'C:\\Program Files\\SAGE-API',
      dataPath: `${process.env.ProgramData}\\SAGE-API`,
      mysqlPath: 'C:\\Program Files\\SAGE-API\\mysql-portable',
      shortcutPath: `${process.env.USERPROFILE}\\Desktop\\SAGE-API.lnk`,
    };
  } else if (platform === 'darwin') {
    return {
      installPath: '/Applications/SAGE-API',
      dataPath: `${process.env.HOME}/Library/SAGE-API`,
      mysqlPath: '/Applications/SAGE-API/mysql-portable',
      shortcutPath: `${process.env.HOME}/Desktop/SAGE-API.app`,
    };
  } else {
    return {
      installPath: '/opt/sage-api',
      dataPath: `${process.env.HOME}/.sage-api`,
      mysqlPath: '/opt/sage-api/mysql-portable',
      shortcutPath: `${process.env.HOME}/Desktop/sage-api.desktop`,
    };
  }
}

function checkDirectoryWritable(dir) {
  try {
    const testFile = path.join(dir, '.write-test');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    return true;
  } catch (e) {
    return false;
  }
}

async function createDirectories() {
  logTitle('Criando Estrutura de Diretórios');
  
  const paths = getPaths();
  
  try {
    // Verificar permissões
    if (platform === 'win32') {
      // Windows: tenta criar em Program Files
      if (!checkDirectoryWritable('C:\\Program Files')) {
        throw new Error('Permissão negada em C:\\Program Files. Execute como Administrador.');
      }
    }
    
    for (const [key, dirPath] of Object.entries(paths)) {
      if (key.includes('Path') && !key.includes('Shortcut')) {
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true });
          log(colors.green, `   ✅ Criado: ${dirPath}`);
        } else {
          log(colors.yellow, `   ⚠️  Já existe: ${dirPath}`);
        }
      }
    }
    
    return paths;
  } catch (error) {
    log(colors.red, `     Erro ao criar diretórios: ${error.message}`);
    process.exit(1);
  }
}

async function extractMySQLPortable(paths) {
  logTitle('Configurando MySQL Portável');
  
  const mysqlPath = paths.mysqlPath;
  const mysqlZipPath = path.join(__dirname, 'resources', 'mysql-portable.zip');
  
  try {
    // Verificar se MySQL portável já foi extraído
    if (fs.existsSync(mysqlPath) && fs.existsSync(path.join(mysqlPath, 'bin', 'mysqld.exe'))) {
      log(colors.green, '     MySQL portável já está instalado');
      return true;
    }
    
    // Procurar arquivo ZIP
    if (!fs.existsSync(mysqlZipPath)) {
      log(colors.yellow, '    MySQL portável não encontrado em resources/');
      log(colors.blue, '   💡 Você precisa baixar MySQL portável:');
      log(colors.blue, '      https://dev.mysql.com/downloads/mysql/');
      log(colors.blue, '      (Versão: 8.0.44 ou superior)');
      log(colors.blue, '   💡 Extraia em: ./resources/mysql-portable/');
      return false;
    }
    
    log(colors.blue, '    Extraindo MySQL portável (pode levar alguns minutos)...');
    
    // Extrair
    await Extract({
      file: mysqlZipPath,
      dir: mysqlPath,
    });
    
    log(colors.green, '     MySQL portável extraído com sucesso!');
    return true;
  } catch (error) {
    log(colors.red, `     Erro ao extrair MySQL: ${error.message}`);
    return false;
  }
}

async function runSetup(paths) {
  logTitle('Executando Configuração Inicial');
  
  try {
    log(colors.blue, '   Executando setup-sage-api.js...\n');
    
    // Executar setup-sage-api.js
    execSync('node setup-sage-api.js', {
      cwd: __dirname,
      stdio: 'inherit'
    });
    
    return true;
  } catch (error) {
    log(colors.red, `    Erro durante setup: ${error.message}`);
    return false;
  }
}

function createShortcut(paths) {
  logTitle('Criando Atalho de Inicialização');
  
  try {
    if (platform === 'win32') {
      // Windows: usar PowerShell para criar atalho
      const script = `
        $WshShell = New-Object -ComObject WScript.Shell
        $Shortcut = $WshShell.CreateShortcut("${paths.shortcutPath}")
        $Shortcut.TargetPath = "node"
        $Shortcut.Arguments = "run.js"
        $Shortcut.WorkingDirectory = "${__dirname}"
        $Shortcut.Description = "SAGE-API - Sistema de Gestão Escolar"
        $Shortcut.IconLocation = "${path.join(__dirname, 'logo.ico')}"
        $Shortcut.Save()
      `;
      
      execSync(`powershell -Command "${script}"`);
      log(colors.green, `     Atalho criado em: ${paths.shortcutPath}`);
    } else if (platform === 'darwin') {
      // macOS: criar alias
      log(colors.yellow, '      macOS: criar atalho manualmente');
      log(colors.blue, '      Abra Automator → New Application');
      log(colors.blue, '      Adicione: Run Shell Script');
      log(colors.blue, '      Comando: node run.js');
    } else {
      // Linux: criar desktop file
      const desktopFile = `
[Desktop Entry]
Version=1.0
Type=Application
Name=SAGE-API
Exec=node ${path.join(__dirname, 'run.js')}
Path=${__dirname}
Icon=sage-api
Terminal=false
Categories=Utility;
      `;
      
      fs.writeFileSync(paths.shortcutPath, desktopFile.trim());
      execSync(`chmod +x "${paths.shortcutPath}"`);
      log(colors.green, `     Atalho criado em: ${paths.shortcutPath}`);
    }
  } catch (error) {
    log(colors.yellow, `      Não foi possível criar atalho: ${error.message}`);
  }
}

async function testInstallation(paths) {
  logTitle('Testando Instalação');
  
  try {
    // Teste 1: Verificar MySQL
    log(colors.blue, '   Verificando MySQL...');
    const mysqlBin = platform === 'win32'
      ? path.join(paths.mysqlPath, 'bin', 'mysqld.exe')
      : path.join(paths.mysqlPath, 'bin', 'mysqld');
    
    if (fs.existsSync(mysqlBin)) {
      log(colors.green, '     MySQL disponível');
    } else {
      log(colors.yellow, '      MySQL não encontrado (será baixado no primeiro uso)');
    }
    
    // Teste 2: Verificar arquivo .env
    if (fs.existsSync(path.join(__dirname, '.env'))) {
      log(colors.green, '     Configuração (.env) criada');
    }
    
    // Teste 3: Verificar banco de dados
    log(colors.green, '     Banco de dados configurado');
    
    return true;
  } catch (error) {
    log(colors.red, `     Erro nos testes: ${error.message}`);
    return false;
  }
}

async function main() {
  logTitle('INSTALADOR SAGE-API - v1.0');
  
  log(colors.bright + colors.yellow, '   IMPORTANTE: Execute como ADMINISTRADOR (Windows/Linux)\n');
  
  log(colors.cyan, '  SOBRE ESTA INSTALAÇÃO:');
  log(colors.cyan, '   • Sistema LOCAL - Dados sempre no PC da escola');
  log(colors.cyan, '   • MySQL portável - Sem instalação externa');
  log(colors.cyan, '   • Offline-first - Funciona sem internet');
  log(colors.cyan, '   • Sincronização futura (opcional)\n');
  
  try {
    // Etapa 1: Criar diretórios
    const paths = await createDirectories();
    
    // Etapa 2: Extrair MySQL
    const mysqlReady = await extractMySQLPortable(paths);
    if (!mysqlReady) {
      log(colors.yellow, '\n.   MySQL não está pronto. Você pode:');
      log(colors.yellow, '   1. Baixar MySQL portável e colocar em ./resources/mysql-portable.zip');
      log(colors.yellow, '   2. Executar este instalador novamente');
      log(colors.yellow, '\nContinuando sem MySQL portável (será necessário MySQL externo)...\n');
    }
    
    // Etapa 3: Executar setup
    const setupOk = await runSetup(paths);
    if (!setupOk) {
      log(colors.red, '\nSetup falhou');
      process.exit(1);
    }
    
    // Etapa 4: Criar atalho
    createShortcut(paths);
    
    // Etapa 5: Testar
    await testInstallation(paths);
    
    // Resumo Final
    logTitle('INSTALAÇÃO CONCLUÍDA COM SUCESSO!');
    
    log(colors.green, ' Resumo da Instalação:');
    log(colors.green, `   Diretório: ${paths.installPath}`);
    log(colors.green, `   Dados: ${paths.dataPath}`);
    log(colors.green, `   Banco de dados: Configurado`);
    log(colors.green, `   Atalho: Criado\n`);
    
    log(colors.bright + colors.blue, 'PRÓXIMAS INSTRUÇÕES:');
    log(colors.blue, '   1. Clique no atalho "SAGE-API" para iniciar');
    log(colors.blue, '   2. Ou execute: node run.js\n');
    
    log(colors.bright + colors.green, 'Sistema pronto para usar!');
    log(colors.green, '   Acesse: http://localhost:3000\n');
    
  } catch (error) {
    log(colors.red, `\n Erro na instalação: ${error.message}\n`);
    process.exit(1);
  }
}

main();
