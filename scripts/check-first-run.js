const fs = require('fs');

// Verificar se é primeira instalação
async function checkFirstRun() {
  try {
    // Criar diretórios necessários
    const dirs = ['logs', 'uploads', 'exports'];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    // Verificar se .env existe
    if (!fs.existsSync('.env')) {
      if (fs.existsSync('.env.example')) {
        console.log('\nCriando arquivo .env...');
        fs.copyFileSync('.env.example', '.env');
        console.log('Arquivo .env criado');
        console.log('IMPORTANTE: Configure suas credenciais em .env\n');
      }
    }
  } catch (error) {
    // Silenciar erros no postinstall
  }
}

checkFirstRun();
