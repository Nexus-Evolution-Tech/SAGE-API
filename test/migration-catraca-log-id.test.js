/**
 * Fase 2b — identidade do acesso garantida pelo banco.
 *
 * O resync pode reapresentar o mesmo log com outro horário por causa da conversão de fuso, e duas
 * passagens legítimas podem acontecer no mesmo segundo. A identidade precisa ser o id emitido pela
 * catraca, limitado ao equipamento que mantém esse contador, para nenhum dos casos virar perda ou
 * duplicação silenciosa.
 *
 * Este teste usa o instalador real porque a migration existir no repositório não basta: ela precisa
 * ser descoberta, aplicada e continuar segura quando o instalador a executar novamente.
 */
const fs = require('fs');
const path = require('path');
const { temBancoDisponivel, criarBancoDeTeste } = require('./helpers/banco');

const CAMINHO_MIGRATION = path.join(
  __dirname,
  '..',
  'database',
  'migration_acesso_catraca_log_id.sql'
);

let banco = null;
let temBanco = false;
let pessoaId = null;
let dispositivoPrincipalId = null;
let dispositivoSecundarioId = null;

async function inserirAcesso({ dispositivoId, catracaLogId, dataHora }) {
  return banco.pool.query(
    `INSERT INTO Acesso
       (pessoa_id, dispositivo_id, catraca_log_id, status, permitido, metodo_auth, data_hora)
     VALUES (?, ?, ?, 'ENTRADA', 1, 'QR_CODE', ?)`,
    [pessoaId, dispositivoId, catracaLogId, dataHora]
  );
}

async function contarAcessosPorLogs(logIds) {
  const [[linha]] = await banco.pool.query(
    'SELECT COUNT(*) AS total FROM Acesso WHERE catraca_log_id IN (?)',
    [logIds]
  );
  return linha.total;
}

beforeAll(async () => {
  temBanco = await temBancoDisponivel();
  if (!temBanco) return;

  banco = await criarBancoDeTeste('catraca_log_id');

  const [pessoa] = await banco.pool.query(
    "INSERT INTO Pessoa (nome, tipo, visivel) VALUES ('Pessoa Migration', 'ALUNO', 1)"
  );
  pessoaId = pessoa.insertId;

  const [dispositivos] = await banco.pool.query(
    `INSERT INTO Dispositivo (nome, modelo, endereco, porta, usuario, senha)
     VALUES
       ('Catraca Migration A', 'IDBlock', '127.0.0.1', '80', 'admin', 'teste'),
       ('Catraca Migration B', 'IDBlock', '127.0.0.2', '80', 'admin', 'teste')`
  );
  dispositivoPrincipalId = dispositivos.insertId;
  dispositivoSecundarioId = dispositivos.insertId + 1;
}, 240000);

afterAll(async () => {
  if (banco) await banco.destruir();
});

describe('F2b — migration da identidade do acesso', () => {
  it('instala catraca_log_id como BIGINT que aceita NULL', async ({ skip }) => {
    skip(!temBanco, 'MySQL indisponível');

    const [colunas] = await banco.pool.query(
      `SELECT DATA_TYPE, IS_NULLABLE
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'Acesso' AND COLUMN_NAME = 'catraca_log_id'`,
      [banco.nome]
    );

    expect(colunas).toHaveLength(1);
    expect(colunas[0]).toMatchObject({ DATA_TYPE: 'bigint', IS_NULLABLE: 'YES' });
  });

  it('cria índice UNIQUE na ordem dispositivo_id, catraca_log_id', async ({ skip }) => {
    skip(!temBanco, 'MySQL indisponível');

    const [colunas] = await banco.pool.query(
      `SELECT COLUMN_NAME, NON_UNIQUE
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'Acesso'
         AND INDEX_NAME = 'uq_acesso_dispositivo_catraca_log'
       ORDER BY SEQ_IN_INDEX`,
      [banco.nome]
    );

    // Sem o prefixo por dispositivo, a sync perde o índice de varredura que motivou esta ordem.
    expect(colunas.map((coluna) => coluna.COLUMN_NAME)).toEqual([
      'dispositivo_id',
      'catraca_log_id'
    ]);
    expect(colunas.every((coluna) => coluna.NON_UNIQUE === 0)).toBe(true);
  });

  it('rejeita o mesmo log da mesma catraca mesmo quando data_hora muda', async ({ skip }) => {
    skip(!temBanco, 'MySQL indisponível');

    await inserirAcesso({
      dispositivoId: dispositivoPrincipalId,
      catracaLogId: 31003,
      dataHora: '2026-07-26 09:00:00'
    });

    // O horário diferente reproduz o resync sob desvio de fuso que antes inseria a mesma passagem.
    await expect(inserirAcesso({
      dispositivoId: dispositivoPrincipalId,
      catracaLogId: 31003,
      dataHora: '2026-07-26 12:00:00'
    })).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });

    expect(await contarAcessosPorLogs([31003])).toBe(1);
  });

  it('aceita o mesmo catraca_log_id em catracas diferentes', async ({ skip }) => {
    skip(!temBanco, 'MySQL indisponível');

    await inserirAcesso({
      dispositivoId: dispositivoPrincipalId,
      catracaLogId: 41004,
      dataHora: '2026-07-26 13:00:00'
    });
    await inserirAcesso({
      dispositivoId: dispositivoSecundarioId,
      catracaLogId: 41004,
      dataHora: '2026-07-26 13:00:01'
    });

    // Cada equipamento mantém seu próprio contador; unicidade global perderia a segunda passagem.
    expect(await contarAcessosPorLogs([41004])).toBe(2);
  });

  it('aceita duas passagens no mesmo segundo quando os ids dos logs diferem', async ({ skip }) => {
    skip(!temBanco, 'MySQL indisponível');

    await inserirAcesso({
      dispositivoId: dispositivoPrincipalId,
      catracaLogId: 51005,
      dataHora: '2026-07-26 14:00:00'
    });
    await inserirAcesso({
      dispositivoId: dispositivoPrincipalId,
      catracaLogId: 51006,
      dataHora: '2026-07-26 14:00:00'
    });

    // Deduplicar por segundo descartava uma passagem legítima da mesma pessoa na mesma catraca.
    expect(await contarAcessosPorLogs([51005, 51006])).toBe(2);
  });

  it('mantém seis acessos com catraca_log_id NULL', async ({ skip }) => {
    skip(!temBanco, 'MySQL indisponível');

    const valores = Array.from({ length: 6 }, (_, indice) => [
      pessoaId,
      dispositivoPrincipalId,
      'ENTRADA',
      1,
      'QR_CODE',
      `2026-07-26 15:00:0${indice}`
    ]);

    await banco.pool.query(
      `INSERT INTO Acesso
         (pessoa_id, dispositivo_id, status, permitido, metodo_auth, data_hora)
       VALUES ?`,
      [valores]
    );

    // Linhas históricas e acessos manuais não têm id de catraca; restringir NULL quebra upgrades.
    const [[linha]] = await banco.pool.query(
      `SELECT COUNT(*) AS total FROM Acesso
       WHERE dispositivo_id = ? AND catraca_log_id IS NULL`,
      [dispositivoPrincipalId]
    );
    expect(linha.total).toBeGreaterThanOrEqual(6);
  });

  it('pode executar a migration duas vezes sem erro nem índice duplicado', async ({ skip }) => {
    skip(!temBanco, 'MySQL indisponível');

    const migration = fs.readFileSync(CAMINHO_MIGRATION, 'utf8');

    // O instalador reaplica migrations em toda atualização, portanto a segunda execução é normal.
    await banco.pool.query(migration);
    await banco.pool.query(migration);

    const [indicesEquivalentes] = await banco.pool.query(
      `SELECT INDEX_NAME
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'Acesso' AND NON_UNIQUE = 0
       GROUP BY INDEX_NAME
       HAVING GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX)
         = 'dispositivo_id,catraca_log_id'`,
      [banco.nome]
    );

    expect(indicesEquivalentes).toEqual([
      { INDEX_NAME: 'uq_acesso_dispositivo_catraca_log' }
    ]);
  });
});
