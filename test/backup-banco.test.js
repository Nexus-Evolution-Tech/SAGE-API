/**
 * Fase 2 — E4: backup não verificado não é backup.
 *
 * Um arquivo que ninguém nunca restaurou é uma promessa, não uma garantia. A hora de descobrir que
 * ele está truncado, vazio ou só com a estrutura não pode ser a hora em que a escola precisa dele.
 *
 * Por isso o teste que mais importa aqui é o de **restauração real**: gera o dump, restaura num
 * banco temporário e confere que as contagens batem com a origem. Verificar tamanho de arquivo ou
 * código de saída do mysqldump não prova nada.
 */
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { temBancoDisponivel, criarBancoDeTeste } = require('./helpers/banco');
const backup = require('../src/services/backupBanco');

describe('E4 — política de retenção (função pura)', () => {
  const dia = 24 * 3600 * 1000;
  const agora = new Date('2026-07-25T12:00:00Z');
  const arq = (nome, diasAtras) => ({ nome, modificadoEm: new Date(agora.getTime() - diasAtras * dia) });

  it('remove os que passaram do prazo', () => {
    const remover = backup.selecionarParaRemover(
      [arq('a', 30), arq('b', 20), arq('c', 5), arq('d', 1), arq('e', 0)],
      { reterDias: 14, reterMinimo: 3 },
      agora
    );

    expect(remover.sort()).toEqual(['a', 'b']);
  });

  it('NUNCA deixa menos que o mínimo, mesmo se todos estiverem velhos', () => {
    // Cenário real: PC de escola sem NTP, com relógio adiantado, faria todo backup parecer antigo.
    // Sem essa trava, a rotina de limpeza apagaria absolutamente tudo.
    const remover = backup.selecionarParaRemover(
      [arq('a', 100), arq('b', 99), arq('c', 98), arq('d', 97)],
      { reterDias: 14, reterMinimo: 3 },
      agora
    );

    expect(remover).toHaveLength(1);
    expect(remover).toEqual(['a']); // o mais antigo
  });

  it('não remove nada quando tudo está dentro do prazo', () => {
    const remover = backup.selecionarParaRemover(
      [arq('a', 3), arq('b', 2), arq('c', 1)],
      { reterDias: 14, reterMinimo: 3 },
      agora
    );

    expect(remover).toEqual([]);
  });

  it('com menos arquivos que o mínimo, não remove nada', () => {
    const remover = backup.selecionarParaRemover(
      [arq('a', 500), arq('b', 400)],
      { reterDias: 14, reterMinimo: 3 },
      agora
    );

    expect(remover).toEqual([]);
  });

  it('nome do arquivo é ordenável por data e não colide entre si', () => {
    const n1 = backup.nomeArquivo(new Date('2026-01-02T03:04:05Z'));
    const n2 = backup.nomeArquivo(new Date('2026-01-02T03:04:06Z'));

    expect(n1).toMatch(/^sage-backup-2026-01-02T03-04-05\.sql$/);
    expect(n1 < n2).toBe(true);
  });
});

describe('E4 — backup restaurado de verdade (integração)', () => {
  let banco = null;
  let temBanco = false;
  let dirTemp = null;
  let envAnterior = {};

  beforeAll(async () => {
    temBanco = await temBancoDisponivel();
    if (!temBanco) return;
    banco = await criarBancoDeTeste('backup');
    dirTemp = await fs.mkdtemp(path.join(os.tmpdir(), 'sage-backup-'));
    envAnterior = { DB_NAME: process.env.DB_NAME, BACKUP_DIR: process.env.BACKUP_DIR };
    process.env.DB_NAME = banco.nome;
    process.env.BACKUP_DIR = dirTemp;
  }, 180000);

  afterAll(async () => {
    if (banco) await banco.destruir();
    if (dirTemp) await fs.rm(dirTemp, { recursive: true, force: true }).catch(() => {});
    for (const [k, v] of Object.entries(envAnterior)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('gera o backup e a restauração comprova que ele serve', async () => {
    if (!temBanco) {
      console.warn('[SKIP] MySQL indisponível');
      return;
    }

    // Dados de teste — obviamente fictícios (o projeto lida com dados de menores).
    await banco.pool.query(
      `INSERT INTO Pessoa (nome, tipo, visivel) VALUES ('Pessoa Teste 1', 'ALUNO', 1), ('Pessoa Teste 2', 'PROFESSOR', 1)`
    );

    const gerado = await backup.gerarBackup();
    expect(gerado.bytes).toBeGreaterThan(0);

    const verificacao = await backup.verificarBackup(gerado.caminho);

    expect(verificacao.problemas).toEqual([]);
    expect(verificacao.ok).toBe(true);
    // A prova de que não é só estrutura: as linhas vieram junto.
    expect(verificacao.contagens.Pessoa.backup).toBe(verificacao.contagens.Pessoa.origem);
    expect(verificacao.contagens.Pessoa.backup).toBeGreaterThanOrEqual(2);
  }, 180000);

  it('backup truncado é REPROVADO na verificação', async () => {
    if (!temBanco) return;

    const gerado = await backup.gerarBackup();
    // Simula o modo de falha mais traiçoeiro: arquivo existe, tem tamanho, e está pela metade.
    const conteudo = await fs.readFile(gerado.caminho, 'utf8');
    await fs.writeFile(gerado.caminho, conteudo.slice(0, Math.floor(conteudo.length / 2)));

    const verificacao = await backup.verificarBackup(gerado.caminho);

    expect(verificacao.ok).toBe(false);
    expect(verificacao.problemas.length).toBeGreaterThan(0);
  }, 180000);

  it('não deixa banco temporário de verificação para trás', async () => {
    if (!temBanco) return;

    const gerado = await backup.gerarBackup();
    await backup.verificarBackup(gerado.caminho);

    const [linhas] = await banco.pool.query(
      "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE 'sage_verif_%'"
    );
    expect(linhas).toHaveLength(0);
  }, 180000);
});
