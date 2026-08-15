const bcrypt = require('bcrypt');
const { criarBancoDeTeste, temBancoDisponivel } = require('./helpers/banco');

const describeMySql = await temBancoDisponivel() ? describe : describe.skip;

describeMySql('R1-03A — trilha append-only do ciclo de Usuario', () => {
  let banco;
  let db;
  let usuarioService;
  let auditoriaService;
  let autores;

  beforeAll(async () => {
    banco = await criarBancoDeTeste('r1_03a_auditoria');
    process.env.DB_NAME = banco.nome;
    db = require('../src/config/database');
    usuarioService = require('../src/services/usuarioService');
    auditoriaService = require('../src/services/auditoriaService');
    autores = [];
    for (const [login, papel] of [['autor.r1a.1', 'ADMINISTRADOR'], ['autor.r1a.2', 'ADMINISTRADOR']]) {
      const [insert] = await banco.pool.query(
        `INSERT INTO Usuario (login, senha_hash, nome_exibicao, papel)
         VALUES (?, ?, ?, ?)`,
        [login, await bcrypt.hash(`${login}-senha`, 10), `Exibicao ${login}`, papel]
      );
      autores.push(insert.insertId);
    }
  }, 120000);

  afterAll(async () => {
    if (db) await new Promise((resolve) => db.end(resolve));
    if (banco) await banco.destruir();
  });

  it('cria o modelo fechado, as duas chaves e os gatilhos append-only', async () => {
    const [columns] = await banco.pool.query(
      `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'TrilhaAuditoria'
        ORDER BY ORDINAL_POSITION`,
      [banco.nome]
    );
    expect(columns).toEqual([
      { COLUMN_NAME: 'id', DATA_TYPE: 'bigint', COLUMN_TYPE: 'bigint', IS_NULLABLE: 'NO', COLUMN_DEFAULT: null },
      { COLUMN_NAME: 'usuario_id', DATA_TYPE: 'int', COLUMN_TYPE: 'int', IS_NULLABLE: 'NO', COLUMN_DEFAULT: null },
      { COLUMN_NAME: 'acao', DATA_TYPE: 'varchar', COLUMN_TYPE: 'varchar(60)', IS_NULLABLE: 'NO', COLUMN_DEFAULT: null },
      { COLUMN_NAME: 'entidade', DATA_TYPE: 'varchar', COLUMN_TYPE: 'varchar(60)', IS_NULLABLE: 'YES', COLUMN_DEFAULT: null },
      { COLUMN_NAME: 'entidade_id', DATA_TYPE: 'int', COLUMN_TYPE: 'int', IS_NULLABLE: 'YES', COLUMN_DEFAULT: null },
      { COLUMN_NAME: 'detalhe', DATA_TYPE: 'json', COLUMN_TYPE: 'json', IS_NULLABLE: 'YES', COLUMN_DEFAULT: null },
      { COLUMN_NAME: 'ocorrido_em', DATA_TYPE: 'datetime', COLUMN_TYPE: 'datetime', IS_NULLABLE: 'NO', COLUMN_DEFAULT: 'CURRENT_TIMESTAMP' }
    ]);

    const [indexes] = await banco.pool.query(
      `SELECT INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX
         FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'TrilhaAuditoria'
          AND INDEX_NAME IN ('idx_trilha_auditoria_usuario_ocorrido', 'idx_trilha_auditoria_entidade')
        ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
      [banco.nome]
    );
    expect(indexes).toEqual([
      { INDEX_NAME: 'idx_trilha_auditoria_entidade', COLUMN_NAME: 'entidade', SEQ_IN_INDEX: 1 },
      { INDEX_NAME: 'idx_trilha_auditoria_entidade', COLUMN_NAME: 'entidade_id', SEQ_IN_INDEX: 2 },
      { INDEX_NAME: 'idx_trilha_auditoria_usuario_ocorrido', COLUMN_NAME: 'usuario_id', SEQ_IN_INDEX: 1 },
      { INDEX_NAME: 'idx_trilha_auditoria_usuario_ocorrido', COLUMN_NAME: 'ocorrido_em', SEQ_IN_INDEX: 2 }
    ]);

    await banco.pool.query(
      `INSERT INTO TrilhaAuditoria (usuario_id, acao, entidade, entidade_id, detalhe)
       VALUES (?, 'LOGIN_SUCESSO', 'Usuario', ?, NULL)`, [autores[0], autores[0]]
    );
    await expect(banco.pool.query(
      'UPDATE TrilhaAuditoria SET acao = ? WHERE usuario_id = ?', ['USUARIO_EDITADO', autores[0]]
    )).rejects.toThrow();
    await expect(banco.pool.query(
      'DELETE FROM TrilhaAuditoria WHERE usuario_id = ?', [autores[0]]
    )).rejects.toThrow();
    const [[foreignKey]] = await banco.pool.query(
      `SELECT REFERENCED_TABLE_NAME, DELETE_RULE
         FROM information_schema.REFERENTIAL_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = ? AND CONSTRAINT_NAME = 'fk_trilha_auditoria_usuario'`, [banco.nome]
    );
    expect(foreignKey).toEqual({ REFERENCED_TABLE_NAME: 'Usuario', DELETE_RULE: 'RESTRICT' });
  });

  it('registra login e operações com autores distintos e preserva usuário desativado', async () => {
    await expect(usuarioService.autenticar('autor.r1a.1', 'autor.r1a.1-senha')).resolves.toMatchObject({ ok: true });
    await expect(usuarioService.autenticar('autor.r1a.2', 'autor.r1a.2-senha')).resolves.toMatchObject({ ok: true });
    const [logins] = await banco.pool.query(
      `SELECT usuario_id, entidade_id FROM TrilhaAuditoria
        WHERE acao = 'LOGIN_SUCESSO' AND entidade = 'Usuario' AND entidade_id IN (?, ?)
        ORDER BY id`, autores
    );
    expect(logins).toEqual([
      { usuario_id: autores[0], entidade_id: autores[0] },
      { usuario_id: autores[1], entidade_id: autores[1] }
    ]);
    const criado = await usuarioService.criarUsuario({
      login: 'alvo.r1a', nome_exibicao: 'Alvo sintético', papel: 'SECRETARIA', senha: 'senha-alvo-8'
    }, autores[0]);
    await usuarioService.atualizarUsuario(criado.id, { nome_exibicao: 'Alvo editado' }, autores[1]);
    await usuarioService.redefinirSenha(criado.id, { nova_senha: 'senha-nova-8' }, autores[1]);
    await usuarioService.desativarUsuario(criado.id, autores[0]);

    const [eventos] = await banco.pool.query(
      `SELECT usuario_id, acao, entidade_id, detalhe
         FROM TrilhaAuditoria
        WHERE entidade = 'Usuario' AND entidade_id = ?
        ORDER BY id`, [criado.id]
    );
    expect(eventos.map(({ usuario_id, acao }) => [usuario_id, acao])).toEqual([
      [autores[0], 'USUARIO_CRIADO'],
      [autores[1], 'USUARIO_EDITADO'],
      [autores[1], 'SENHA_REDEFINIDA'],
      [autores[0], 'USUARIO_DESATIVADO']
    ]);
    const detalhes = eventos.map(({ detalhe }) => typeof detalhe === 'string' ? JSON.parse(detalhe) : detalhe);
    expect(detalhes).toEqual([
      { pessoa_id: null, papel: 'SECRETARIA' },
      { campos: ['exibicao'] },
      null,
      null
    ]);
    const [[persistido]] = await banco.pool.query('SELECT id, ativo FROM Usuario WHERE id = ?', [criado.id]);
    expect(persistido).toEqual({ id: criado.id, ativo: 0 });
  });

  it('recusa vocabulário desconhecido e cada classe de detalhe sensível', async () => {
    const { registrarAuditoria, ACOES } = auditoriaService;
    await expect(registrarAuditoria(banco.pool, {
      autorId: autores[0], acao: 'USUARIO_APAGADO', entidadeId: autores[0]
    })).rejects.toMatchObject({ code: 'AUDITORIA_ACAO_INVALIDA' });
    const proibidos = [
      ['nome', 'Pessoa Sintética'], ['cpf', '123.456.789-09'], ['rg', '12.345.678-9'],
      ['email', 'sintetico@example.invalid'], ['foto', 'imagem-sintetica'], ['qr', 'qr-sintetico'],
      ['cartao', '4111 1111 1111 1111'], ['token', 'eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0.assinatura'],
      ['senha', 'senha-sintetica-8']
    ];
    for (const [campo, valor] of proibidos) {
      await expect(registrarAuditoria(banco.pool, {
        autorId: autores[0], acao: ACOES.USUARIO_CRIADO, entidadeId: autores[0], detalhe: { [campo]: valor }
      })).rejects.toMatchObject({ code: 'AUDITORIA_DETALHE_SENSIVEL' });
    }
  });

  it('não inventa autor ausente e desfaz negócio quando a auditoria falha', async () => {
    await expect(usuarioService.criarUsuario({
      login: 'sem.autor.r1a', nome_exibicao: 'Sem autor', papel: 'SECRETARIA', senha: 'senha-sem-autor-8'
    })).rejects.toMatchObject({ code: 'AUDITORIA_AUTOR_OBRIGATORIO' });
    const [[semAutor]] = await banco.pool.query('SELECT COUNT(*) AS total FROM Usuario WHERE login = ?', ['sem.autor.r1a']);
    expect(Number(semAutor.total)).toBe(0);

    const trigger = `tr_r1_03a_auditoria_falha_${process.pid}`;
    await banco.pool.query(`CREATE TRIGGER ${trigger}
      BEFORE INSERT ON TrilhaAuditoria FOR EACH ROW
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'falha de auditoria controlada'`);
    try {
      await expect(usuarioService.criarUsuario({
        login: 'rollback.r1a', nome_exibicao: 'Rollback sintético', papel: 'SECRETARIA', senha: 'senha-rollback-8'
      }, autores[0])).rejects.toMatchObject({ code: 'USUARIOS_INDISPONIVEIS' });
    } finally {
      await banco.pool.query(`DROP TRIGGER ${trigger}`);
    }
    const [[rollback]] = await banco.pool.query('SELECT COUNT(*) AS total FROM Usuario WHERE login = ?', ['rollback.r1a']);
    expect(Number(rollback.total)).toBe(0);
  });
});
