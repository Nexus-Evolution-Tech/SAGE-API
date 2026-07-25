/**
 * Fase 2 — E7 / RNF-12: bundle de diagnóstico.
 *
 * O sistema roda numa escola onde não convivemos. Este bundle é o que a secretaria envia quando
 * algo está errado, e funciona SEM internet — por isso é o alicerce da manutenção remota, não o
 * plano B.
 *
 * Dois testes carregam o peso:
 *   1. Nada pessoal e nenhum segredo saem (LGPD — dados de menores).
 *   2. O que precisa estar para responder chamado, está. Um bundle seguro mas inútil só troca um
 *      problema por outro: se ele não responde a pergunta, alguém liga de novo.
 */
const { temBancoDisponivel, criarBancoDeTeste } = require('./helpers/banco');
const diagnostico = require('../src/services/diagnostico');
const saudeDispositivos = require('../src/services/saudeDispositivos');

let banco = null;
let temBanco = false;

beforeAll(async () => {
  temBanco = await temBancoDisponivel();
  if (!temBanco) return;
  banco = await criarBancoDeTeste('diag');
  process.env.DB_NAME = banco.nome;
}, 180000);

afterAll(async () => {
  if (banco) await banco.destruir();
  saudeDispositivos.limpar();
});

describe('E7 — bundle de diagnóstico', () => {
  it('não contém nenhum dado pessoal nem segredo', async () => {
    if (!temBanco) {
      console.warn('[SKIP] MySQL indisponível');
      return;
    }

    // Cadastro realista, para o caso de alguma seção do bundle vazar dado por acidente.
    await banco.pool.query(
      `INSERT INTO Pessoa (id, nome, cpf, email, telefone, tipo, visivel)
       VALUES (1, 'Ana Clara Guedes Felisbino', '39812345678', 'ana@etec.sp.gov.br', '11987654321', 'ALUNO', 1)`
    );
    // Falha com dado pessoal na mensagem — o caminho mais provável de vazamento real.
    saudeDispositivos.registrarFalha(1, {
      nome: 'Catraca da entrada',
      operacao: 'obterSessao',
      motivo: 'falha ao sincronizar ana@etec.sp.gov.br (CPF 398.123.456-78)',
      alcancavel: false
    });

    const bundle = await diagnostico.gerarBundle({ db: banco.pool });
    const texto = JSON.stringify(bundle);

    for (const valor of ['Ana Clara', 'Felisbino', '39812345678', '398.123.456-78',
                          'ana@etec', '11987654321']) {
      expect(texto).not.toContain(valor);
    }
    // A senha real do banco vem do ambiente e NUNCA é escrita aqui — um valor literal num teste
    // versionado é, ele próprio, um vazamento de credencial.
    if (process.env.DB_PASSWORD) {
      expect(texto).not.toContain(process.env.DB_PASSWORD);
    }
  }, 120000);

  it('responde as perguntas de suporte que hoje exigem telefone', async () => {
    if (!temBanco) return;

    const bundle = await diagnostico.gerarBundle({ db: banco.pool });

    // "Qual versão está instalada?"
    expect(bundle.aplicacao).toHaveProperty('versao');
    // "O banco responde?" e "a instalação está completa?" (achado A-2)
    expect(bundle.autoDiagnostico.banco.ok).toBe(true);
    expect(bundle.autoDiagnostico.tabelas.ok).toBe(true);
    // "Quantos dados tem?" — contexto para queixa de lentidão em HD mecânico
    expect(bundle.autoDiagnostico).toHaveProperty('linhas_Acesso');
    // "O buffer pool está no padrão de 128 MB?" — pode explicar lentidão sem tocar em código
    expect(bundle.autoDiagnostico.innodb_buffer_pool).toHaveProperty('noPadrao');
    // "O disco está cheio?"
    expect(bundle.disco).toHaveProperty('livreGB');
    // "O Node está estourando memória?"
    expect(bundle.ambiente).toHaveProperty('memoriaProcessoMB');
    // "Qual o fuso da máquina?" — o desvio de 3h no DATETIME depende disto
    expect(bundle.ambiente).toHaveProperty('offsetMinutos');
    // "A configuração está certa?" — sem segredo, mas dizendo se está definido
    expect(bundle.configuracao).toHaveProperty('DB_HOST');
    expect(bundle.configuracao.DB_PASSWORD).toMatch(/DEFINIDO/);
  }, 120000);

  // Este teste existe porque a primeira versão do bundle passou nos testes de segurança e ainda
  // assim era INÚTIL: `plataforma`, `fusoDoSistema` e a mensagem de erro do dispositivo saíam como
  // [REDIGIDO]. Verificar existência de chave não basta — é preciso verificar que o VALOR sobreviveu.
  it('campos técnicos NÃO são redigidos — bundle seguro e vazio não serve para nada', async () => {
    if (!temBanco) return;

    saudeDispositivos.limpar();
    saudeDispositivos.registrarFalha(5, {
      nome: 'C5', operacao: 'obterSessao',
      motivo: 'connect ECONNREFUSED 192.168.0.126:81', alcancavel: false
    });

    const bundle = await diagnostico.gerarBundle({ db: banco.pool });

    expect(bundle.ambiente.plataforma).not.toBe('[REDIGIDO]');
    expect(bundle.ambiente.plataforma).toMatch(/\w/);
    expect(bundle.ambiente.fusoDoSistema).not.toBe('[REDIGIDO]');
    expect(bundle.ambiente.node).toMatch(/^v\d/);
    expect(bundle.aplicacao.pacote).not.toBe('[REDIGIDO]');
    expect(bundle.configuracao.DB_HOST).not.toBe('[REDIGIDO]');
    expect(bundle.configuracao.CATRACA_TIMEOUT ?? '10000').not.toBe('[REDIGIDO]');

    // A causa técnica da falha da catraca é o dado mais valioso do bundle inteiro.
    const d = bundle.dispositivos.find((x) => x.dispositivo_id === 5);
    expect(d.motivoTecnico).toMatch(/ECONNREFUSED/);
  }, 120000);

  it('preserva o estado das catracas, inclusive o histórico de falhas', async () => {
    if (!temBanco) return;

    saudeDispositivos.limpar();
    saudeDispositivos.registrarFalha(7, { nome: 'C7', motivo: 'ECONNREFUSED', alcancavel: false });
    saudeDispositivos.registrarFalha(7, { nome: 'C7', motivo: 'ETIMEDOUT', alcancavel: false });

    const bundle = await diagnostico.gerarBundle({ db: banco.pool });
    const d = bundle.dispositivos.find((x) => x.dispositivo_id === 7);

    expect(d).toBeDefined();
    expect(d.falhasConsecutivas).toBe(2);
    expect(d.alcancavel).toBe(false);
    expect(d.historico.length).toBe(2);
    expect(d.historico[0].motivoTecnico).toMatch(/ETIMEDOUT/);
  }, 120000);

  it('nome do arquivo identifica o momento e não carrega dado pessoal', () => {
    const nome = diagnostico.nomeArquivoBundle(new Date('2026-07-25T14:30:05Z'));

    expect(nome).toBe('sage-diagnostico-2026-07-25T14-30-05.json');
  });

  it('funciona mesmo sem banco — é o caminho que precisa sempre funcionar', async () => {
    const bundle = await diagnostico.gerarBundle({});

    expect(bundle.autoDiagnostico).toBeNull();
    // Ainda entrega o essencial de ambiente, que é o que resolve boa parte dos casos.
    expect(bundle.ambiente).toHaveProperty('plataforma');
    expect(bundle.disco).toHaveProperty('livreGB');
  }, 60000);
});
