const bcrypt = require('bcrypt');
const crypto = require('crypto');
const path = require('path');
const mysql = require('mysql2/promise');
const { execFile } = require('child_process');
const { promisify } = require('util');
const {
  temBancoDisponivel,
  configConexao
} = require('./helpers/banco');

const execFileAsync = promisify(execFile);
const RAIZ = path.join(__dirname, '..');
const bancosCriados = new Set();

function novoBanco(rotulo) {
  const nome = `sage_verif_bootstrap_${process.pid}_${rotulo}_teste`;
  bancosCriados.add(nome);
  return nome;
}

function credencialInicial() {
  return {
    login: `admin_${crypto.randomBytes(6).toString('hex')}`,
    senha: crypto.randomBytes(24).toString('base64url'),
    nome: `Unidade ${crypto.randomBytes(4).toString('hex')}`
  };
}

async function executarSetup(nomeBanco, credencial, envExtra = {}) {
  const cfg = configConexao();
  const env = {
    ...process.env,
    DB_HOST: cfg.host,
    DB_PORT: String(cfg.port),
    DB_USER: cfg.user,
    DB_PASSWORD: cfg.password,
    DB_NAME: nomeBanco,
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    JWT_SECRET: crypto.randomBytes(32).toString('hex'),
    ...envExtra
  };

  delete env.SAGE_INITIAL_ADMIN_LOGIN;
  delete env.SAGE_INITIAL_ADMIN_PASSWORD;
  delete env.SAGE_INITIAL_SCHOOL_NAME;

  if (credencial) {
    env.SAGE_INITIAL_ADMIN_LOGIN = credencial.login;
    env.SAGE_INITIAL_ADMIN_PASSWORD = credencial.senha;
    env.SAGE_INITIAL_SCHOOL_NAME = credencial.nome;
  }

  try {
    const resultado = await execFileAsync(
      process.execPath,
      [path.join(RAIZ, 'scripts', 'setup-database.js')],
      { cwd: RAIZ, env, timeout: 120000 }
    );
    return { ...resultado, codigo: 0 };
  } catch (erro) {
    return {
      codigo: typeof erro.code === 'number' ? erro.code : 1,
      stdout: erro.stdout || '',
      stderr: erro.stderr || ''
    };
  }
}

async function apagarBancos() {
  const admin = await mysql.createConnection(configConexao());
  try {
    for (const nome of bancosCriados) {
      await admin.query(`DROP DATABASE IF EXISTS \`${nome}\``);
    }
    bancosCriados.clear();
  } finally {
    await admin.end();
  }
}

const temBanco = await temBancoDisponivel();
const describeBanco = temBanco ? describe : describe.skip;

describeBanco('F8.1 — bootstrap seguro', () => {
  afterEach(apagarBancos);

  it('cria credencial gerada no banco limpo e nunca a redefine em upgrade', async () => {
    const nomeBanco = novoBanco('upgrade');
    const inicial = credencialInicial();
    const primeiraExecucao = await executarSetup(nomeBanco, inicial);

    expect(primeiraExecucao.codigo).toBe(0);
    expect(primeiraExecucao.stdout + primeiraExecucao.stderr).not.toContain(inicial.senha);

    const db = await mysql.createConnection({ ...configConexao(), database: nomeBanco });
    const [criadas] = await db.query(
      'SELECT id, nome, login, senha FROM UnidadeEscolar ORDER BY id'
    );
    expect(criadas).toHaveLength(1);
    expect(criadas[0].nome).toBe(inicial.nome);
    expect(criadas[0].login).toBe(inicial.login);
    expect(criadas[0].senha).not.toBe(inicial.senha);
    expect(await bcrypt.compare(inicial.senha, criadas[0].senha)).toBe(true);
    const [usuarios] = await db.query(
      'SELECT id, login, senha_hash, papel FROM Usuario WHERE login = ?', [inicial.login]
    );
    expect(usuarios).toHaveLength(1);
    expect(usuarios[0]).toMatchObject({ login: inicial.login, papel: 'ADMINISTRADOR' });
    expect(await bcrypt.compare(inicial.senha, usuarios[0].senha_hash)).toBe(true);

    const hashOriginal = criadas[0].senha;
    const tentativaDeReset = credencialInicial();
    const upgrade = await executarSetup(nomeBanco, tentativaDeReset);
    expect(upgrade.codigo).toBe(0);

    const [preservadas] = await db.query(
      'SELECT id, login, senha FROM UnidadeEscolar ORDER BY id'
    );
    const [usuariosPreservados] = await db.query('SELECT login FROM Usuario');
    await db.end();

    expect(preservadas).toHaveLength(1);
    expect(preservadas[0].login).toBe(inicial.login);
    expect(preservadas[0].senha).toBe(hashOriginal);
    expect(await bcrypt.compare(tentativaDeReset.senha, preservadas[0].senha)).toBe(false);
    expect(usuariosPreservados).toHaveLength(1);
  });

  it.each([
    ['login', { ...credencialInicial(), login: '' }, 'SAGE_INITIAL_ADMIN_LOGIN'],
    ['senha', { ...credencialInicial(), senha: '' }, 'SAGE_INITIAL_ADMIN_PASSWORD']
  ])('falha alto e não cria usuário padrão quando falta %s', async (rotulo, credencial, erroEsperado) => {
    const nomeBanco = novoBanco(`ausente_${rotulo}`);
    const resultado = await executarSetup(nomeBanco, credencial);

    expect(resultado.codigo).not.toBe(0);
    expect(resultado.stdout + resultado.stderr).toContain(erroEsperado);

    const db = await mysql.createConnection({ ...configConexao(), database: nomeBanco });
    const [unidades] = await db.query('SELECT id, login FROM UnidadeEscolar');
    await db.end();

    expect(unidades).toEqual([]);
  });

  it('prepara o schema sem conta quando o onboarding local está habilitado', async () => {
    const nomeBanco = novoBanco('onboarding');
    const resultado = await executarSetup(nomeBanco, null, {
      SAGE_ALLOW_FIRST_RUN_ONBOARDING: 'true'
    });
    expect(resultado.codigo).toBe(0);
    const db = await mysql.createConnection({ ...configConexao(), database: nomeBanco });
    const [unidades] = await db.query('SELECT id FROM UnidadeEscolar');
    const [tabelas] = await db.query(
      'SELECT COUNT(*) AS total FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?', [nomeBanco]
    );
    await db.end();
    expect(unidades).toEqual([]);
    expect(tabelas[0].total).toBeGreaterThan(0);
  });

  it('serializa duas instalacoes concorrentes e preserva um par de credenciais', async () => {
    const nomeBanco = novoBanco('concorrente'); expect((await executarSetup(nomeBanco, null, { SAGE_ALLOW_FIRST_RUN_ONBOARDING: 'true' })).codigo).toBe(0);
    const primeira = credencialInicial(); const segunda = credencialInicial(); const resultados = await Promise.all([executarSetup(nomeBanco, primeira), executarSetup(nomeBanco, segunda)]);
    expect(resultados.every(({ codigo }) => codigo === 0)).toBe(true); const db = await mysql.createConnection({ ...configConexao(), database: nomeBanco });
    const [[resultado]] = await db.query('SELECT (SELECT COUNT(*) FROM UnidadeEscolar) unidades, (SELECT COUNT(*) FROM Usuario) usuarios, (SELECT login FROM UnidadeEscolar LIMIT 1) unidade_login, (SELECT senha FROM UnidadeEscolar LIMIT 1) unidade_senha, (SELECT login FROM Usuario LIMIT 1) usuario_login, (SELECT senha_hash FROM Usuario LIMIT 1) usuario_hash'); await db.end();
    const vencedora = [primeira, segunda].find(({ login }) => login === resultado.unidade_login); expect(resultado).toMatchObject({ unidades: 1, usuarios: 1, usuario_login: resultado.unidade_login }); expect(vencedora).toBeDefined(); expect(await bcrypt.compare(vencedora.senha, resultado.unidade_senha)).toBe(true); expect(await bcrypt.compare(vencedora.senha, resultado.usuario_hash)).toBe(true);
  });

  it('faz rollback dos dois inserts quando o Usuario falha', async () => {
    const nomeBanco = novoBanco('rollback_usuario'); expect((await executarSetup(nomeBanco, null, { SAGE_ALLOW_FIRST_RUN_ONBOARDING: 'true' })).codigo).toBe(0);
    const db = await mysql.createConnection({ ...configConexao(), database: nomeBanco }); await db.query("CREATE TRIGGER falha_usuario_bootstrap BEFORE INSERT ON Usuario FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'rollback deterministico'"); await db.end();
    expect((await executarSetup(nomeBanco, credencialInicial())).codigo).not.toBe(0); const consulta = await mysql.createConnection({ ...configConexao(), database: nomeBanco });
    const [[totais]] = await consulta.query('SELECT (SELECT COUNT(*) FROM UnidadeEscolar) unidades, (SELECT COUNT(*) FROM Usuario) usuarios'); await consulta.end(); expect(totais).toEqual({ unidades: 0, usuarios: 0 });
  });
});
