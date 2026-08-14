const bcrypt = require('bcrypt');
const { criarBancoDeTeste, temBancoDisponivel } = require('./helpers/banco');

const describeMySql = await temBancoDisponivel() ? describe : describe.skip;

describeMySql('R1-01B1a — serviço de Usuario e sessão', () => {
  let banco;
  let db;
  let usuarioService;
  let usuarios;

  beforeAll(async () => {
    banco = await criarBancoDeTeste('r1_01b1a_usuario_service');
    process.env.DB_NAME = banco.nome;
    db = require('../src/config/database');
    usuarioService = require('../src/services/usuarioService');
    const senhas = ['senha-um-8', 'senha-dois-8'];
    for (let i = 0; i < senhas.length; i++) {
      const [insert] = await banco.pool.query(
        `INSERT INTO Usuario (login, senha_hash, nome_exibicao, papel)
         VALUES (?, ?, ?, 'SECRETARIA')`,
        [`usuario.r1b1a.${i}`, await bcrypt.hash(senhas[i], 10), `Usuario ${i}`]
      );
      usuarios = [...(usuarios || []), { id: insert.insertId, login: `usuario.r1b1a.${i}`, senha: senhas[i] }];
    }
  }, 120000);

  afterAll(async () => {
    if (db) await new Promise((resolve) => db.end(resolve));
    if (banco) await banco.destruir();
  });

  it('autentica dois usuarios corretos com IDs distintos', async () => {
    const resultados = await Promise.all(usuarios.map((usuario) => usuarioService.autenticar(usuario.login, usuario.senha)));
    expect(resultados.every((resultado) => resultado.ok)).toBe(true);
    expect(resultados[0].usuario.id).not.toBe(resultados[1].usuario.id);
  });

  it('recusa usuario inativo e inexistente', async () => {
    await banco.pool.query('UPDATE Usuario SET ativo = FALSE WHERE id = ?', [usuarios[0].id]);
    expect((await usuarioService.autenticar(usuarios[0].login, usuarios[0].senha)).ok).toBe(false);
    expect(await usuarioService.buscarParaSessao(usuarios[0].id)).toBeUndefined();
    expect((await usuarioService.autenticar('nao.existe.r1b1a', 'qualquer')).ok).toBe(false);
    await banco.pool.query('UPDATE Usuario SET ativo = TRUE WHERE id = ?', [usuarios[0].id]);
  });

  it('mantem quatro falhas sem bloqueio e bloqueia na quinta', async () => {
    for (let i = 0; i < 4; i++) {
      expect((await usuarioService.autenticar(usuarios[0].login, 'senha-errada')).bloqueado).toBe(false);
    }
    const quinta = await usuarioService.autenticar(usuarios[0].login, 'senha-errada');
    expect(quinta).toMatchObject({ ok: false, bloqueado: true });
    const [[estado]] = await banco.pool.query('SELECT falhas_login, bloqueado_ate FROM Usuario WHERE id = ?', [usuarios[0].id]);
    expect(estado.falhas_login).toBe(5);
    expect(estado.bloqueado_ate).not.toBeNull();
  });

  it('recusa bloqueio ativo e permite nova tentativa após expirar, limpando o estado', async () => {
    await banco.pool.query(
      'UPDATE Usuario SET falhas_login = 5, bloqueado_ate = DATE_ADD(NOW(), INTERVAL 15 MINUTE) WHERE id = ?',
      [usuarios[1].id]
    );
    expect((await usuarioService.autenticar(usuarios[1].login, usuarios[1].senha)).bloqueado).toBe(true);
    await banco.pool.query(
      'UPDATE Usuario SET falhas_login = 5, bloqueado_ate = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id = ?',
      [usuarios[1].id]
    );
    expect((await usuarioService.autenticar(usuarios[1].login, 'senha-errada')).bloqueado).toBe(false);
    const [[estado]] = await banco.pool.query('SELECT falhas_login, bloqueado_ate FROM Usuario WHERE id = ?', [usuarios[1].id]);
    expect(estado).toEqual({ falhas_login: 1, bloqueado_ate: null });
  });

  it('limpa falhas e bloqueio após login correto', async () => {
    await banco.pool.query(
      'UPDATE Usuario SET falhas_login = 4, bloqueado_ate = NULL WHERE id = ?', [usuarios[1].id]
    );
    expect((await usuarioService.autenticar(usuarios[1].login, usuarios[1].senha)).ok).toBe(true);
    const [[estado]] = await banco.pool.query('SELECT falhas_login, bloqueado_ate FROM Usuario WHERE id = ?', [usuarios[1].id]);
    expect(estado).toEqual({ falhas_login: 0, bloqueado_ate: null });
  });

  it('aceita a credencial migrada curta preservada', async () => {
    await banco.pool.query(
      'UPDATE Usuario SET senha_hash = ?, precisa_trocar_senha = TRUE, falhas_login = 0, bloqueado_ate = NULL WHERE id = ?',
      [await bcrypt.hash('curta', 10), usuarios[0].id]
    );
    const resultado = await usuarioService.autenticar(usuarios[0].login, 'curta');
    expect(resultado).toMatchObject({ ok: true, usuario: { id: usuarios[0].id, precisa_trocar_senha: 1 } });
  });

  it('faz rollback quando a transacao falha', async () => {
    const nomeTrigger = `tr_r1_01b1a_rollback_${process.pid}`;
    await banco.pool.query(`CREATE TRIGGER ${nomeTrigger} BEFORE UPDATE ON Usuario FOR EACH ROW
      BEGIN
        IF OLD.login = 'usuario.r1b1a.0' THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'falha transacional controlada';
        END IF;
      END`);
    await expect(usuarioService.autenticar(usuarios[0].login, 'senha-errada')).rejects.toThrow();
    const [[estado]] = await banco.pool.query('SELECT falhas_login, bloqueado_ate FROM Usuario WHERE id = ?', [usuarios[0].id]);
    expect(estado).toEqual({ falhas_login: 0, bloqueado_ate: null });
    await banco.pool.query(`DROP TRIGGER ${nomeTrigger}`);
  });
});
