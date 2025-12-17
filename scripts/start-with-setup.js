require('dotenv').config({ debug: false });
const { spawn } = require('child_process');

async function verificarESetup() {
  try {
    // Verificar se banco está acessível
    const mysql = require('mysql2/promise');
    const dbConfig = {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '3306'),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD,
    };

    console.log('\n Verificando banco de dados...');
    
    let connection;
    try {
      connection = await mysql.createConnection(dbConfig);
      
      // Verificar se banco existe
      const dbName = process.env.DB_NAME || 'sage';
      const [rows] = await connection.query(
        `SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?`,
        [dbName]
      );

      if (rows.length === 0) {
        console.log(' Banco de dados não encontrado. Executando setup...\n');
        await connection.end();
        
        // Executar setup
        const { setupBancoDados } = require('./setup-database');
        await setupBancoDados();
        console.log('\n Setup concluído!\n');
      } else {
        // Verificar se tabelas existem
        const [tables] = await connection.query(
          `SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.TABLES 
           WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'Pessoa'`,
          [dbName]
        );

        if (tables[0].count === 0) {
          console.log(' Estrutura do banco não encontrada. Executando migrations...\n');
          await connection.end();
          
          const { setupBancoDados } = require('./setup-database');
          await setupBancoDados();
          console.log('\n Setup concluído!\n');
        } else {
          console.log(' Banco de dados OK\n');
          await connection.end();
        }
      }
    } catch (error) {
      if (connection) await connection.end();
      
      if (error.code === 'ER_ACCESS_DENIED_ERROR') {
        console.error(' Erro de autenticação MySQL');
        console.error('   Verifique DB_USER e DB_PASSWORD no arquivo .env\n');
        process.exit(1);
      } else if (error.code === 'ECONNREFUSED') {
        console.error(' MySQL não está rodando');
        console.error('   macOS: brew services start mysql');
        console.error('   Linux: sudo systemctl start mysql\n');
        process.exit(1);
      } else {
        throw error;
      }
    }

  } catch (error) {
    console.error(` Erro: ${error.message}\n`);
    process.exit(1);
  }
}

// Executar verificação e depois iniciar servidor
verificarESetup()
  .then(() => {
    console.log(' Iniciando servidor...\n');
    
    // Iniciar com nodemon se estiver em dev, senão node normal
    const isProduction = process.env.NODE_ENV === 'production';
    const command = isProduction ? 'node' : 'nodemon';
    const args = ['index.js'];
    
    const child = spawn(command, args, {
      stdio: 'inherit'
    });

    child.on('exit', (code) => {
      process.exit(code);
    });
  })
  .catch((error) => {
    console.error(' Erro fatal:', error);
    process.exit(1);
  });
