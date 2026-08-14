// Carregar configuração por caminho absoluto antes de ler as variáveis.
const { FIRST_RUN_BOOTSTRAP_LOCK } = require('../src/config/env');

const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const logger = require('../src/config/logger');
const fs = require('fs').promises;
const path = require('path');
const { ensureLegacyBaseline } = require('./legacy-baseline');
const { runMigrations } = require('./migration-runner');
const APP_VERSION = process.env.SAGE_APP_VERSION || require('../package.json').version;

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

async function normalizarLegado(migrationsDir) {
  logger.info('\n4️⃣ Normalizando migrations legadas...');
  const melhoriasPath = path.join(migrationsDir, 'melhorias_sistema.sql');
  try {
    await fs.access(melhoriasPath);
    if (!await executarMigration(melhoriasPath)) {
      throw new Error('melhorias_sistema.sql falhou — veja os erros acima');
    }
  } catch (error) {
    if (error.code === 'ENOENT') logger.warn('   melhorias_sistema.sql ausente; pulando.');
    else throw error;
  }

  const migrationFiles = await fs.readdir(migrationsDir);
  const migrations = migrationFiles
    .filter((file) => file.startsWith('migration_') && file.endsWith('.sql'))
    .sort();
  for (const file of migrations) {
    if (!await executarMigration(path.join(migrationsDir, file))) {
      throw new Error(`${file} falhou — veja os erros acima`);
    }
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
  let connection;
  try {
    logger.info('🌱 Verificando estrutura inicial...');
    
    connection = await mysql.createConnection({
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

    // A credencial inicial só é consumida quando ainda não existe unidade. Em upgrades, qualquer
    // valor presente no ambiente deve ser ignorado para nunca redefinir acesso existente.
    const initialLogin = (process.env.SAGE_INITIAL_ADMIN_LOGIN || '').trim();
    const initialPassword = process.env.SAGE_INITIAL_ADMIN_PASSWORD || '';
    const initialName = (process.env.SAGE_INITIAL_SCHOOL_NAME || 'Unidade Escolar').trim();
    const onboardingLocal = process.env.SAGE_ALLOW_FIRST_RUN_ONBOARDING === 'true' &&
      !process.env.SAGE_INITIAL_ADMIN_LOGIN && !process.env.SAGE_INITIAL_ADMIN_PASSWORD &&
      !process.env.SAGE_INITIAL_SCHOOL_NAME;
    let lockAcquired = false;
    try {
      if (!onboardingLocal) {
        const [[lock]] = await connection.query(
          'SELECT GET_LOCK(?, 5) AS acquired', [FIRST_RUN_BOOTSTRAP_LOCK]
        );
        lockAcquired = Number(lock.acquired) === 1;
        if (!lockAcquired) throw new Error('Nao foi possivel adquirir lock do bootstrap');
      }
    const [existingSchool] = await connection.query(
      `SELECT id FROM UnidadeEscolar ORDER BY id LIMIT 1`
    );

    if (existingSchool.length === 0) {
      const login = initialLogin;
      const senha = initialPassword;
      const nome = initialName;

      if (!onboardingLocal && (login.length < 3 || login.length > 100)) {
        throw new Error('SAGE_INITIAL_ADMIN_LOGIN é obrigatório e deve ter entre 3 e 100 caracteres');
      }
      if (!onboardingLocal && senha.length < 8) {
        throw new Error('SAGE_INITIAL_ADMIN_PASSWORD é obrigatório e deve ter ao menos 8 caracteres');
      }
      if (!onboardingLocal && !nome) {
        throw new Error('SAGE_INITIAL_SCHOOL_NAME não pode ser vazio');
      }

      if (onboardingLocal) {
        logger.info(' Schema preparado; cadastro inicial será concluído na tela local do SAGE');
      } else {
        logger.info('🌱 Inserindo unidade escolar e credencial administrativa inicial');
        const senhaHashed = await bcrypt.hash(senha, 10);
        await connection.beginTransaction();
        try {
          await connection.query(
            `INSERT INTO UnidadeEscolar (nome, login, senha) VALUES (?, ?, ?)`,
            [nome, login, senhaHashed]
          );
          await connection.query(
            `INSERT INTO Usuario
             (login, senha_hash, nome_exibicao, papel, ativo, precisa_trocar_senha)
             VALUES (?, ?, ?, 'ADMINISTRADOR', TRUE, FALSE)`,
            [login, senhaHashed, nome]
          );
          await connection.commit();
        } catch (error) {
          await connection.rollback().catch(() => logger.warn('[SETUP] codigo=ROLLBACK_SEED_FALHOU'));
          throw error;
        }
        logger.info(' Unidade escolar inicial inserida com sucesso');
      }
    } else {
      logger.info('🏫 Unidade escolar já existe; credencial preservada');
    }

    } finally {
      if (lockAcquired) {
        await connection.query(
          'SELECT RELEASE_LOCK(?)', [FIRST_RUN_BOOTSTRAP_LOCK]
        ).catch(() => logger.warn('[SETUP] codigo=LOCK_RELEASE_FALHOU'));
      }
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

    return true;
  } catch (error) {
    logger.error(` Erro ao verificar estrutura: ${error.message}`);
    throw error;
  } finally {
    if (connection) await connection.end().catch(() => {});
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
      // A-2: executarMigration NAO lanca — ela captura tudo e devolve false. Ignorar esse
      // retorno era o motivo de a instalacao falhar inteira e ainda terminar com exit 0.
      const ok = await executarMigration(filePath);
      if (!ok) {
        throw new Error('sage.sql falhou — veja os erros acima');
      }
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

  // O baseline só é registrado depois de o schema legado atingir todas as sentinelas. A partir
  // dele, upgrades usam exclusivamente arquivos versionados com checksum e estado persistido.
  const migrationConnection = await mysql.createConnection({
    ...dbConfig,
    database: dbName,
    multipleStatements: true
  });
  try {
    await ensureLegacyBaseline({
      connection: migrationConnection,
      appVersion: APP_VERSION,
      normalizeLegacy: () => normalizarLegado(migrationsDir)
    });
    await runMigrations({
      connection: migrationConnection,
      appVersion: APP_VERSION,
      migrationsDir: path.join(migrationsDir, 'migrations')
    });
  } finally {
    await migrationConnection.end().catch(() => {});
  }

  // 5. Validar estrutura
  logger.info('\n5️⃣ Validando estrutura...');
  await executarSeeds();

  // 5.1 (A-2) Nunca declarar sucesso sem conferir. Antes daqui, a instalação podia criar ZERO
  // tabelas e ainda assim reportar "concluído com sucesso" e sair com código 0 — que é o pior
  // modo de falha possível numa escola: "instalei, deu certo" e nada funciona.
  const TABELAS_ESSENCIAIS = ['UnidadeEscolar', 'Pessoa', 'Dispositivo', 'Acesso', 'Turma'];
  const conexaoValidacao = await mysql.createConnection({ ...dbConfig, database: dbName });
  try {
    const [linhas] = await conexaoValidacao.query(
      `SELECT LOWER(TABLE_NAME) AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?`,
      [dbName]
    );
    const existentes = new Set(linhas.map((l) => l.t));
    const faltando = TABELAS_ESSENCIAIS.filter((t) => !existentes.has(t.toLowerCase()));
    if (existentes.size === 0) {
      throw new Error(
        `Nenhuma tabela foi criada em '${dbName}'. A instalação NÃO foi concluída.`
      );
    }
    if (faltando.length > 0) {
      throw new Error(
        `Instalação incompleta em '${dbName}': faltam as tabelas ${faltando.join(', ')}.`
      );
    }
    logger.info(`    ${existentes.size} tabelas verificadas em '${dbName}'`);
  } finally {
    await conexaoValidacao.end().catch(() => {});
  }

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
