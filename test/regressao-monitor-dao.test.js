/**
 * Regressão: `processarNotificacaoMonitorDao` quebra quando o evento de push traz uma
 * identificação não cadastrada.
 *
 * BUG: `src/services/accessService.js` usa `tentativasNegadas++` (linhas ~479 e ~491) e
 * `tentativasNegadas` (linhas ~543, ~547) sem NUNCA declarar a variável. O operador `++` lê antes
 * de escrever, então lança `ReferenceError` — inclusive em modo não-strict.
 *
 * POR QUE IMPORTA MUITO: este é o caminho do **Monitor push** da catraca. O sistema hoje roda em
 * polling, o que explica o bug nunca ter aparecido. A Fase 2b torna o push o caminho PRIMÁRIO
 * (é o que entrega monitoramento em tempo real, ver ARQUITETURA-PROPOSTA §8.8.1). No momento em
 * que o push virar padrão, qualquer pessoa passando com credencial não cadastrada — cartão antigo,
 * visitante, aluno transferido — derruba o processamento da notificação.
 *
 * Cenário coberto: crachá cujo user_id não corresponde a nenhuma Pessoa.
 */
// `globals: true` no vitest.config.js — describe/it/expect vêm do ambiente (vitest 4 não
// permite require('vitest') em CommonJS).
const { temBancoDisponivel, criarBancoDeTeste } = require('./helpers/banco');

let banco = null;
let temBanco = false;

beforeAll(async () => {
  temBanco = await temBancoDisponivel();
  if (!temBanco) return;
  banco = await criarBancoDeTeste('monitordao');
  // O accessService usa o pool de src/config/database.js, que lê as env no require.
  // Aponta as env para o banco isolado ANTES de carregar o módulo.
  process.env.DB_NAME = banco.nome;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'chave_de_teste_com_mais_de_32_caracteres_ok';
}, 180000);

afterAll(async () => {
  if (banco) await banco.destruir();
});

describe('processarNotificacaoMonitorDao — identificação não cadastrada', () => {
  it('não deve lançar ReferenceError ao receber push de credencial desconhecida', async () => {
    if (!temBanco) {
      console.warn('[SKIP] MySQL indisponível — configure DB_HOST/DB_USER/DB_PASSWORD');
      return;
    }

    // Cadastra um dispositivo para o payload conseguir ser mapeado
    await banco.pool.query(
      `INSERT INTO Dispositivo (nome, modelo, endereco, porta, usuario, senha, control_id_device_id)
       VALUES ('Catraca Teste', 'IDBlock', '127.0.0.1', '80', 'admin', 'admin', 999001)`
    );

    const accessService = require('../src/services/accessService');

    // user_id 111000000 + 999999 → pessoa_id 999999, que não existe na tabela Pessoa
    const payload = {
      device_id: 999001,
      object_changes: [
        {
          object: 'access_logs',
          values: {
            id: 1,
            time: Math.floor(Date.now() / 1000),
            user_id: 111999999,
            portal_id: 1,
            card_value: '12345678'
          }
        }
      ]
    };

    // Antes da correção isto lança: ReferenceError: tentativasNegadas is not defined
    const resultado = await accessService.processarNotificacaoMonitorDao(payload);

    expect(resultado).toBeDefined();
    expect(resultado.ignorados).toBeGreaterThanOrEqual(1);
    expect(resultado.processados).toBe(0);
  }, 60000);
});
