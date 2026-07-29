const fs = require('fs');
const { ensureDataDirs } = require('../src/config/paths');
const { appRoot, configFile } = require('../src/config/env');
const path = require('path');

// Verificar se é primeira instalação
async function checkFirstRun() {
  try {
    // Criar diretórios necessários
    ensureDataDirs();

    // Verificar a configuração pelo contrato absoluto, sem depender do cwd do npm.
    const exampleFile = path.join(appRoot, '.env.example');
    if (!fs.existsSync(configFile)) {
      if (fs.existsSync(exampleFile)) {
        console.log('\nCriando arquivo de configuração...');
        fs.mkdirSync(path.dirname(configFile), { recursive: true });
        fs.copyFileSync(exampleFile, configFile);
        console.log('Arquivo .env criado');
        console.log('IMPORTANTE: Configure suas credenciais em .env\n');
      }
    }
  } catch (error) {
    // Silenciar erros no postinstall
  }
}

checkFirstRun();
