#!/usr/bin/env node

/**
 * start-sage.js
 * 
 * Script inteligente de inicialização
 * Detecta se é primeira execução e roda setup automaticamente
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const envPath = path.join(__dirname, '.env');
const setupCompletePath = path.join(__dirname, '.setup-complete');

function envExists() {
  return fs.existsSync(envPath);
}

function setupWasCompleted() {
  return fs.existsSync(setupCompletePath);
}

function markSetupComplete() {
  fs.writeFileSync(setupCompletePath, new Date().toISOString(), 'utf-8');
}

function runSetup() {
  console.log('\nPrimeira execução detectada. Executando setup automático...\n');
  
  try {
    execSync('node setup-sage-api.js', { 
      cwd: __dirname,
      stdio: 'inherit'
    });
    
    markSetupComplete();
    console.log('\nSetup concluído! Iniciando SAGE-API...\n');
  } catch (error) {
    console.error('\nErro durante setup\n');
    process.exit(1);
  }
}

function startServer() {
  console.log('Iniciando SAGE-API...\n');
  
  try {
    execSync('node index.js', { 
      cwd: __dirname,
      stdio: 'inherit'
    });
  } catch (error) {
    process.exit(1);
  }
}

// Lógica principal
if (!envExists() || !setupWasCompleted()) {
  runSetup();
}

startServer();
