const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { criarBancoDeTeste, configConexao, temBancoDisponivel } = require('./helpers/banco');

const execFileAsync = promisify(execFile);
const root = path.join(__dirname, '..');
const describeMySql = await temBancoDisponivel() ? describe : describe.skip;

describeMySql('convergência do schema legado', () => {
  let banco;

  beforeAll(async () => {
    banco = await criarBancoDeTeste('schema_legado');
    const [foreignKeys] = await banco.pool.query(
      `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Sala'
          AND COLUMN_NAME = 'unidade_id' AND REFERENCED_TABLE_NAME IS NOT NULL`
    );
    for (const { CONSTRAINT_NAME } of foreignKeys) {
      await banco.pool.query('ALTER TABLE Sala DROP FOREIGN KEY ??', [CONSTRAINT_NAME]);
    }
    await banco.pool.query('ALTER TABLE Sala DROP COLUMN unidade_id');
    await banco.pool.query('ALTER TABLE HorarioAula DROP COLUMN divisao');
    await banco.pool.query('ALTER TABLE HorarioAula MODIFY COLUMN horario TIME NOT NULL');
    await banco.pool.query('ALTER TABLE Presenca DROP COLUMN horario_previsto');
    await banco.pool.query('ALTER TABLE UnidadeEscolar DROP COLUMN recuperacao_gerada_em');
    await banco.pool.query('DROP TABLE schema_migrations');
  }, 180000);

  afterAll(async () => {
    if (banco) await banco.destruir();
  });

  it('converge Sala, HorarioAula e Presenca sem apagar colunas legadas', async () => {
    const cfg = configConexao();
    await execFileAsync(process.execPath, [path.join(root, 'scripts', 'setup-database.js')], {
      cwd: root,
      timeout: 120000,
      env: {
        ...process.env,
        DB_HOST: cfg.host,
        DB_PORT: String(cfg.port),
        DB_USER: cfg.user,
        DB_PASSWORD: cfg.password,
        DB_NAME: banco.nome,
        NODE_ENV: 'test',
        LOG_LEVEL: 'error',
        SAGE_ALLOW_FIRST_RUN_ONBOARDING: 'true'
      }
    });

    const [columns] = await banco.pool.query(
      `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, CHARACTER_MAXIMUM_LENGTH
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND (TABLE_NAME, COLUMN_NAME) IN (
            ('Sala', 'unidade_id'), ('HorarioAula', 'divisao'),
            ('HorarioAula', 'horario'), ('Presenca', 'horario_previsto'),
            ('UnidadeEscolar', 'recuperacao_gerada_em')
          )`
    );
    const byName = new Map(columns.map((column) => [
      `${column.TABLE_NAME}.${column.COLUMN_NAME}`.toLowerCase(),
      column
    ]));
    expect([...byName.keys()].sort()).toEqual([
      'horarioaula.divisao', 'horarioaula.horario',
      'presenca.horario_previsto', 'sala.unidade_id',
      'unidadeescolar.recuperacao_gerada_em'
    ]);
    expect(byName.get('horarioaula.horario')).toMatchObject({
      DATA_TYPE: 'varchar', CHARACTER_MAXIMUM_LENGTH: 11
    });
    expect(byName.get('horarioaula.divisao').COLUMN_TYPE).toBe("enum('INT','DIV A','DIV B')");
  }, 180000);
});
