require('../src/config/env');
const { spawn } = require('child_process');

async function verificarESetup() {
  // A conta da API não recebe DDL. O instalador aplica migrations com outra credencial; na
  // partida, o runtime apenas confere schema, checksums e estados antes de aceitar tráfego.
  const { verifyRuntimeSchema } = require('./runtime-schema-gate');
  await verifyRuntimeSchema();
}

// Executar verificação e depois iniciar servidor
verificarESetup()
  .then(() => {
    // A credencial de bootstrap é de uso único e não deve ser herdada pelo processo da API.
    delete process.env.SAGE_INITIAL_ADMIN_LOGIN;
    delete process.env.SAGE_INITIAL_ADMIN_PASSWORD;
    delete process.env.SAGE_INITIAL_SCHOOL_NAME;

    console.log(' Iniciando servidor...\n');
    
    // Iniciar com nodemon se estiver em dev, senão node normal
    const isProduction = process.env.NODE_ENV === 'production';
    const command = isProduction ? process.execPath : 'nodemon';
    const args = ['index.js'];
    
    const child = spawn(command, args, {
      stdio: 'inherit',
      detached: false // Garante que o child é kill junto com o parent
    });

    // Propagar sinais SIGINT (Ctrl+C) e SIGTERM para o child
    process.on('SIGINT', () => {
      child.kill('SIGINT');
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      child.kill('SIGTERM');
      process.exit(0);
    });

    child.on('exit', (code) => {
      process.exit(code);
    });
  })
  .catch((error) => {
    console.error(' Erro fatal:', error);
    process.exit(1);
  });
