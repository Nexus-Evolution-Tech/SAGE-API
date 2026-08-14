const fs = require('fs/promises');
const path = require('path');
const { criarBancoDeTeste, temBancoDisponivel } = require('./helpers/banco');

const MIGRATION = path.join(__dirname, '..', 'database', 'migrations', '0003_usuario_sistema.sql');
const describeMySql = await temBancoDisponivel() ? describe : describe.skip;

describeMySql('R1-01A: migration de Usuario (MySQL real)', () => {
  let banco;

  beforeAll(async () => {
    banco = await criarBancoDeTeste('r1_01a_usuario');
  }, 120000);

  afterAll(async () => {
    if (banco) await banco.destruir();
  });

  it('cria exatamente o schema de Usuario e suas regras', async () => {
    const [columns] = await banco.pool.query(
      `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT,
              CHARACTER_MAXIMUM_LENGTH
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'Usuario'
        ORDER BY ORDINAL_POSITION`,
      [banco.nome]
    );

    expect(columns).toEqual([
      { COLUMN_NAME: 'id', DATA_TYPE: 'int', COLUMN_TYPE: 'int', IS_NULLABLE: 'NO', COLUMN_DEFAULT: null, CHARACTER_MAXIMUM_LENGTH: null },
      { COLUMN_NAME: 'login', DATA_TYPE: 'varchar', COLUMN_TYPE: 'varchar(100)', IS_NULLABLE: 'NO', COLUMN_DEFAULT: null, CHARACTER_MAXIMUM_LENGTH: 100 },
      { COLUMN_NAME: 'senha_hash', DATA_TYPE: 'varchar', COLUMN_TYPE: 'varchar(255)', IS_NULLABLE: 'NO', COLUMN_DEFAULT: null, CHARACTER_MAXIMUM_LENGTH: 255 },
      { COLUMN_NAME: 'nome_exibicao', DATA_TYPE: 'varchar', COLUMN_TYPE: 'varchar(100)', IS_NULLABLE: 'NO', COLUMN_DEFAULT: null, CHARACTER_MAXIMUM_LENGTH: 100 },
      { COLUMN_NAME: 'papel', DATA_TYPE: 'enum', COLUMN_TYPE: "enum('ADMINISTRADOR','SECRETARIA')", IS_NULLABLE: 'NO', COLUMN_DEFAULT: null, CHARACTER_MAXIMUM_LENGTH: 13 },
      { COLUMN_NAME: 'ativo', DATA_TYPE: 'tinyint', COLUMN_TYPE: 'tinyint(1)', IS_NULLABLE: 'NO', COLUMN_DEFAULT: '1', CHARACTER_MAXIMUM_LENGTH: null },
      { COLUMN_NAME: 'pessoa_id', DATA_TYPE: 'int', COLUMN_TYPE: 'int', IS_NULLABLE: 'YES', COLUMN_DEFAULT: null, CHARACTER_MAXIMUM_LENGTH: null },
      { COLUMN_NAME: 'precisa_trocar_senha', DATA_TYPE: 'tinyint', COLUMN_TYPE: 'tinyint(1)', IS_NULLABLE: 'NO', COLUMN_DEFAULT: '0', CHARACTER_MAXIMUM_LENGTH: null },
      { COLUMN_NAME: 'falhas_login', DATA_TYPE: 'int', COLUMN_TYPE: 'int', IS_NULLABLE: 'NO', COLUMN_DEFAULT: '0', CHARACTER_MAXIMUM_LENGTH: null },
      { COLUMN_NAME: 'bloqueado_ate', DATA_TYPE: 'datetime', COLUMN_TYPE: 'datetime', IS_NULLABLE: 'YES', COLUMN_DEFAULT: null, CHARACTER_MAXIMUM_LENGTH: null },
      { COLUMN_NAME: 'ultimo_acesso', DATA_TYPE: 'datetime', COLUMN_TYPE: 'datetime', IS_NULLABLE: 'YES', COLUMN_DEFAULT: null, CHARACTER_MAXIMUM_LENGTH: null },
      { COLUMN_NAME: 'created_at', DATA_TYPE: 'datetime', COLUMN_TYPE: 'datetime', IS_NULLABLE: 'NO', COLUMN_DEFAULT: 'CURRENT_TIMESTAMP', CHARACTER_MAXIMUM_LENGTH: null },
      { COLUMN_NAME: 'updated_at', DATA_TYPE: 'datetime', COLUMN_TYPE: 'datetime', IS_NULLABLE: 'NO', COLUMN_DEFAULT: 'CURRENT_TIMESTAMP', CHARACTER_MAXIMUM_LENGTH: null }
    ]);

    const [status] = await banco.pool.query('SHOW TABLE STATUS LIKE \'Usuario\'');
    expect(status[0].Engine).toBe('InnoDB');

    const [uniqueLogin] = await banco.pool.query(
      `SELECT COLUMN_NAME FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'Usuario'
          AND INDEX_NAME <> 'PRIMARY' AND NON_UNIQUE = 0
        ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
      [banco.nome]
    );
    expect(uniqueLogin.map(({ COLUMN_NAME }) => COLUMN_NAME)).toEqual(['login']);

    const [foreignKeys] = await banco.pool.query(
      `SELECT kcu.COLUMN_NAME, kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME,
              rc.DELETE_RULE
         FROM information_schema.KEY_COLUMN_USAGE kcu
         JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
           ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
          AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
        WHERE kcu.CONSTRAINT_SCHEMA = ?
          AND kcu.TABLE_NAME = 'Usuario'
          AND kcu.REFERENCED_TABLE_NAME IS NOT NULL`,
      [banco.nome]
    );
    expect(foreignKeys).toEqual([{
      COLUMN_NAME: 'pessoa_id',
      REFERENCED_TABLE_NAME: 'Pessoa',
      REFERENCED_COLUMN_NAME: 'id',
      DELETE_RULE: 'SET NULL'
    }]);
  });

  it('migra a credencial legada, preserva colunas e reexecuta sem duplicar', async () => {
    const login = `legacy_r1_01a_${process.pid}`;
    const senhaHash = `$2b$10$${'x'.repeat(53)}`;
    const [unidade] = await banco.pool.query(
      'INSERT INTO UnidadeEscolar (nome, login, senha) VALUES (?, ?, ?)',
      ['Unidade legada de teste', login, senhaHash]
    );
    const [pessoa] = await banco.pool.query(
      "INSERT INTO Pessoa (nome, unidade_id, tipo) VALUES (?, ?, 'ADMINISTRADOR')",
      ['Pessoa de teste da migration', unidade.insertId]
    );
    const sql = await fs.readFile(MIGRATION, 'utf8');

    await banco.pool.query(sql);

    const [migrated] = await banco.pool.query(
      `SELECT login, senha_hash, nome_exibicao, papel, ativo, precisa_trocar_senha, pessoa_id
         FROM Usuario WHERE login = ?`,
      [login]
    );
    expect(migrated).toEqual([{
      login,
      senha_hash: senhaHash,
      nome_exibicao: 'Unidade legada de teste',
      papel: 'ADMINISTRADOR',
      ativo: 1,
      precisa_trocar_senha: 1,
      pessoa_id: null
    }]);

    await banco.pool.query('UPDATE Usuario SET pessoa_id = ? WHERE login = ?', [pessoa.insertId, login]);
    await banco.pool.query('DELETE FROM Pessoa WHERE id = ?', [pessoa.insertId]);
    const [afterPessoaDelete] = await banco.pool.query(
      'SELECT id, login, senha_hash, pessoa_id FROM Usuario WHERE login = ?',
      [login]
    );
    expect(afterPessoaDelete).toHaveLength(1);
    expect(afterPessoaDelete[0]).toMatchObject({ login, senha_hash: senhaHash, pessoa_id: null });

    await banco.pool.query(sql);
    const [[count]] = await banco.pool.query('SELECT COUNT(*) AS total FROM Usuario WHERE login = ?', [login]);
    const [[sameCredential]] = await banco.pool.query(
      'SELECT login, senha_hash FROM Usuario WHERE login = ?',
      [login]
    );
    expect(count.total).toBe(1);
    expect(sameCredential).toEqual({ login, senha_hash: senhaHash });

    const [legacyColumns] = await banco.pool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'UnidadeEscolar'
          AND COLUMN_NAME IN ('login', 'senha')
        ORDER BY COLUMN_NAME`,
      [banco.nome]
    );
    expect(legacyColumns.map(({ COLUMN_NAME }) => COLUMN_NAME)).toEqual(['login', 'senha']);
  });
});
