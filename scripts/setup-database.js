// Carregar .env no início para ter todas as variáveis disponíveis
require('dotenv').config();

const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const logger = require('../src/config/logger');
const fs = require('fs').promises;
const path = require('path');

// Configuração do banco (agora com variáveis do .env carregadas)
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
};

const dbName = process.env.DB_NAME || 'sage';

async function verificarConexaoMySQL() {
  try {
    const connection = await mysql.createConnection(dbConfig);
    logger.info(' Conexão com MySQL estabelecida');
    await connection.end();
    return true;
  } catch (error) {
    logger.error(` Erro ao conectar no MySQL: ${error.message}`);
    logger.error(`   Host: ${dbConfig.host}:${dbConfig.port}`);
    logger.error(`   User: ${dbConfig.user}`);
    logger.error(`   Verifique se MySQL está rodando e credenciais estão corretas no .env`);
    return false;
  }
}

async function verificarBancoDadosExiste() {
  try {
    const connection = await mysql.createConnection(dbConfig);
    const [rows] = await connection.query(
      `SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?`,
      [dbName]
    );
    await connection.end();
    return rows.length > 0;
  } catch (error) {
    logger.error(`Erro ao verificar banco de dados: ${error.message}`);
    return false;
  }
}

async function criarBancoDados() {
  try {
    logger.info(` Criando banco de dados '${dbName}'...`);
    const connection = await mysql.createConnection(dbConfig);
    
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` 
      CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    
    logger.info(` Banco de dados '${dbName}' criado com sucesso`);
    await connection.end();
    return true;
  } catch (error) {
    logger.error(` Erro ao criar banco de dados: ${error.message}`);
    return false;
  }
}

async function executarMigration(filePath) {
  try {
    logger.info(`📄 Executando migration: ${path.basename(filePath)}`);
    
    const sql = await fs.readFile(filePath, 'utf8');
    const connection = await mysql.createConnection({
      ...dbConfig,
      database: dbName,
      multipleStatements: true
    });

    // Parser robusto de DELIMITER blocks
    const statements = [];
    const lines = sql.split('\n');
    let currentStatement = '';
    let inDelimiterBlock = false;
    let blockDelimiter = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Detectar DELIMITER
      if (trimmed.startsWith('DELIMITER ')) {
        if (currentStatement.trim()) {
          statements.push(currentStatement.trim());
          currentStatement = '';
        }
        blockDelimiter = trimmed.split(' ')[1];
        inDelimiterBlock = true;
        continue;
      }

      // Detectar fim de bloco DELIMITER
      if (inDelimiterBlock && trimmed === `DELIMITER ;`) {
        if (currentStatement.trim()) {
          // Substitui o delimitador customizado por ; (escape seguro)
          let stmt = currentStatement.split(blockDelimiter).join(';').trim();
          if (!stmt.endsWith(';')) stmt += ';';
          statements.push(stmt);
          currentStatement = '';
        }
        inDelimiterBlock = false;
        blockDelimiter = '';
        continue;
      }

      // Ignorar comentários puros e linhas vazias
      if (trimmed.length === 0 || trimmed.startsWith('--')) {
        continue;
      }

      currentStatement += line + '\n';

      // Se não está em bloco DELIMITER, verificar se a linha termina com ;
      if (!inDelimiterBlock && trimmed.endsWith(';')) {
        statements.push(currentStatement.trim());
        currentStatement = '';
      }
    }

    // Pegar último statement se houver
    if (currentStatement.trim()) {
      statements.push(currentStatement.trim());
    }

    // Normalizar delimitadores residuais (caso ainda exista $$ no buffer)
    for (let i = 0; i < statements.length; i++) {
      statements[i] = statements[i].replace(/\$\$/g, ';');
    }

    // Executar cada statement individualmente
    let executados = 0;
    for (const statement of statements) {
      if (!statement.trim()) continue;

      let stmt = '';
      try {
        // Normaliza sintaxe MySQL 8.0+
        stmt = statement;
        stmt = stmt.replace(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS/gi, 'CREATE INDEX');
        stmt = stmt.replace(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS/gi, 'ADD COLUMN');

        await connection.query(stmt);
        executados++;
      } catch (error) {
        // Ignorar erros de "já existe"
        if (!error.message.includes('already exists') && 
            !error.message.includes('Duplicate key name') &&
            !error.message.includes('Duplicate column name') &&
            !error.message.includes("doesn't exist in table")) {
          logger.error(`    Falha no statement (trecho): ${stmt.slice(0,200)}...`);
          logger.error(`    Statement completo: ${stmt}`);
          throw error;
        }
      }
    }

    await connection.end();
    logger.info(` Migration executada: ${path.basename(filePath)} (${executados} statements)`);
    return true;
  } catch (error) {
    logger.error(` Erro ao executar migration ${path.basename(filePath)}: ${error.message}`);
    return false;
  }
}

async function verificarTabelasExistem() {
  try {
    const connection = await mysql.createConnection({
      ...dbConfig,
      database: dbName
    });

    const [rows] = await connection.query(
      `SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'Pessoa'`,
      [dbName]
    );

    await connection.end();
    return rows[0].count > 0;
  } catch (error) {
    return false;
  }
}

async function executarSeeds() {
  try {
    logger.info('🌱 Verificando estrutura inicial...');
    
    const connection = await mysql.createConnection({
      ...dbConfig,
      database: dbName
    });

    // Verificar tabelas essenciais
    const [tables] = await connection.query(
      `SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('Pessoa', 'Dispositivo', 'Acesso', 'UnidadeEscolar')`,
      [dbName]
    );
    
    if (tables[0].count >= 4) {
      logger.info(' Estrutura do banco validada');
    } else {
      logger.warn('⚠️ Algumas tabelas podem estar faltando');
    }

    // Seed: UnidadeEscolar inicial (ETEC Taboão da Serra)
    const [existingSchool] = await connection.query(
      `SELECT id, login FROM UnidadeEscolar WHERE id = 1 LIMIT 1`,
      []
    );

    // Hash da senha 'etec123'
    const senhaHashed = await bcrypt.hash('etec123', 10);

    if (existingSchool.length === 0) {
      logger.info('🌱 Inserindo unidade escolar inicial: ETEC Taboão da Serra');
      
      const sqlQuery = `
        INSERT INTO UnidadeEscolar 
        (id, nome, numero_unidade, cnpj, login, senha, logradouro, numero, complemento, bairro, cidade, estado, cep, telefone_contato, logo, created_at) 
        VALUES 
        (1, 'ETEC Taboão da Serra', '293', '62823257029344', 'etec', ?, 'Praça Miguel Ortega', '135', 'Prédio Principal', 'Parque Assunção', 'Taboão da Serra', 'SP', '06754160', '1147011856', 'logo_etec.png', NOW())
        ON DUPLICATE KEY UPDATE id=id
      `;
      
      await connection.query(sqlQuery, [senhaHashed]);
      logger.info(' Unidade escolar inicial inserida com sucesso');
    } else {
      // Força credenciais padrão para evitar divergência entre ambientes
      logger.info('🏫 Unidade escolar já existe, atualizando credenciais padrão (etec/etec123)');
      await connection.query(
        `UPDATE UnidadeEscolar SET login = 'etec', senha = ? WHERE id = 1`,
        [senhaHashed]
      );
    }

    // Seed: Área padrão (para dispositivos/catracas)
    const [existingArea] = await connection.query(
      `SELECT id FROM Area WHERE nome = 'Portaria Principal' LIMIT 1`,
      []
    );
    if (existingArea.length === 0) {
      logger.info('🌱 Inserindo área padrão: Portaria Principal');
      await connection.query(
        `INSERT INTO Area (nome, unidade_id, foto) VALUES ('Portaria Principal', NULL, NULL)`,
        []
      );
      logger.info(' Área padrão inserida');
    }

    await connection.end();
    return true;
  } catch (error) {
    logger.error(` Erro ao verificar estrutura: ${error.message}`);
    return false;
  }
}

async function setupBancoDados() {
  logger.info(' Iniciando setup do banco de dados...');
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const migrationsDir = path.join(__dirname, '../database');

  // 1. Verificar conexão MySQL
  logger.info('\n1️⃣ Verificando conexão com MySQL...');
  const conexaoOk = await verificarConexaoMySQL();
  if (!conexaoOk) {
    logger.error('\n Setup abortado: Não foi possível conectar ao MySQL');
    logger.error('   Verifique se o MySQL está rodando:');
    logger.error('   - macOS: brew services start mysql');
    logger.error('   - Linux: sudo systemctl start mysql');
    process.exit(1);
  }

  // 2. Verificar/criar banco de dados
  logger.info('\n2️⃣ Verificando banco de dados...');
  const bancoExiste = await verificarBancoDadosExiste();
  
  if (!bancoExiste) {
    logger.info(`   Banco '${dbName}' não existe`);
    const criado = await criarBancoDados();
    if (!criado) {
      logger.error('\n Setup abortado: Não foi possível criar banco de dados');
      process.exit(1);
    }
  } else {
    logger.info(`    Banco '${dbName}' já existe`);
  }

  // 3. Verificar se tabelas existem
  logger.info('\n3️⃣ Verificando estrutura do banco...');
  const tabelasExistem = await verificarTabelasExistem();

  if (!tabelasExistem) {
    logger.info('   Tabelas não existem, executando migrations...');
    
    // 4. Executar migrations principais
    logger.info('\n4️⃣ Executando migration única: sage.sql');
    const filePath = path.join(migrationsDir, 'sage.sql');
    try {
      await fs.access(filePath);
      await executarMigration(filePath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.error('   ❌ Arquivo sage.sql não encontrado em /database');
        throw error;
      } else {
        logger.error(`    Erro ao executar sage.sql: ${error.message}`);
        throw error;
      }
    }
  } else {
    logger.info('    Estrutura do banco já existe');
  }

  // 4.1 Aplicar melhorias incrementais (idempotente: ignora colunas/índices existentes)
  logger.info('\n4️⃣ Aplicando melhorias incrementais (melhorias_sistema.sql)...');
  const melhoriasPath = path.join(migrationsDir, 'melhorias_sistema.sql');
  try {
    await fs.access(melhoriasPath);
    await executarMigration(melhoriasPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      logger.warn('   Arquivo melhorias_sistema.sql não encontrado em /database; pulando.');
    } else {
      logger.error(`    Erro ao executar melhorias_sistema.sql: ${error.message}`);
      throw error;
    }
  }

  // 4.2 Aplicar migrações incrementais (migration_*.sql) — idempotentes
  const migrationFiles = await fs.readdir(migrationsDir).catch(() => []);
  const migrations = migrationFiles
    .filter((f) => f.startsWith('migration_') && f.endsWith('.sql'))
    .sort();
  for (const file of migrations) {
    const migrationPath = path.join(migrationsDir, file);
    try {
      await executarMigration(migrationPath);
    } catch (error) {
      logger.error(`    Erro ao executar ${file}: ${error.message}`);
      throw error;
    }
  }

  // 5. Validar estrutura
  logger.info('\n5️⃣ Validando estrutura...');
  await executarSeeds();

  logger.info('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.info(' Setup do banco de dados concluído com sucesso!');
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  return true;
}

// Executar se chamado diretamente
if (require.main === module) {
  setupBancoDados()
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error(`Erro fatal: ${error.message}`);
      process.exit(1);
    });
}

module.exports = { setupBancoDados };
