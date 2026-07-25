/**
 * RNF-11 / LGPD — o teste que torna a regra real.
 *
 * "Nenhum dado pessoal sai da escola" é uma regra que se cumpre por engenharia ou não se cumpre.
 * São dados de MENORES DE IDADE. Um único `logger.error(pessoa)` basta para vazar nome e CPF para
 * um serviço de terceiro.
 *
 * O teste central é o último: pega um objeto `Pessoa` REALISTA, completo, e afirma que **nenhum**
 * dos valores pessoais aparece na saída, qualquer que seja a forma. Se alguém adicionar um campo
 * novo ao cadastro e esquecer o sanitizador, é aqui que precisa quebrar.
 */
const { sanitizar, sanitizarTexto, sanitizarConfiguracao, REDIGIDO } = require('../src/services/sanitizador');

describe('LGPD — campos pessoais nunca saem', () => {
  it('redige campos pessoais conhecidos em qualquer profundidade', () => {
    const entrada = {
      pessoa_id: 42,
      nome: 'Maria Aparecida da Silva',
      aninhado: { cpf: '12345678901', dados: { rg: '123456789', email: 'a@b.com' } }
    };

    const s = sanitizar(entrada);

    expect(s.pessoa_id).toBe(42); // id técnico permanece: é o que permite diagnosticar
    expect(s.nome).toBe(REDIGIDO);
    expect(s.aninhado.cpf).toBe(REDIGIDO);
    expect(s.aninhado.dados.rg).toBe(REDIGIDO);
    expect(s.aninhado.dados.email).toBe(REDIGIDO);
  });

  it('chave DESCONHECIDA com texto livre é redigida (falha fechado)', () => {
    // Lista de bloqueio falharia aqui: ninguém previu `apelido_do_aluno`.
    const s = sanitizar({ apelido_do_aluno: 'Dudu', campo_novo_qualquer: 'texto sensível' });

    expect(s.apelido_do_aluno).toBe(REDIGIDO);
    expect(s.campo_novo_qualquer).toBe(REDIGIDO);
  });

  it('redige CPF, e-mail e telefone dentro de texto livre', () => {
    const t = sanitizarTexto(
      'Falha ao gravar pessoa 123.456.789-01, contato maria@escola.sp.gov.br, tel (11) 98765-4321'
    );

    expect(t).not.toMatch(/123\.456\.789-01/);
    expect(t).not.toMatch(/maria@escola/);
    expect(t).not.toMatch(/98765-4321/);
    // O que sobra ainda serve para diagnosticar:
    expect(t).toMatch(/Falha ao gravar pessoa/);
  });

  it('redige caminho de foto (carrega id e nome de arquivo)', () => {
    const t = sanitizarTexto('ENOENT: src/uploads/pessoas/pessoa_922_maria.png não encontrado');

    expect(t).not.toMatch(/pessoa_922_maria/);
    expect(t).toMatch(/ENOENT/);
  });

  it('preserva o que serve para diagnóstico: códigos, contadores, estados', () => {
    const s = sanitizar({
      dispositivo_id: 3, status: 'OFFLINE', codigo: 'ECONNREFUSED',
      statusHttp: 502, falhasConsecutivas: 7, alcancavel: false, total: 48057
    });

    expect(s).toEqual({
      dispositivo_id: 3, status: 'OFFLINE', codigo: 'ECONNREFUSED',
      statusHttp: 502, falhasConsecutivas: 7, alcancavel: false, total: 48057
    });
  });

  it('trata Error preservando stack útil, mas sanitizado', () => {
    const erro = new Error('Falha para o aluno joao@escola.br');
    const s = sanitizar({ erro });

    expect(s.erro.mensagem).not.toMatch(/joao@escola/);
    expect(s.erro.name).toBe('Error');
    expect(typeof s.erro.stack).toBe('string');
  });

  it('sobrevive a estrutura cíclica e a profundidade excessiva', () => {
    const a = { pessoa_id: 1 };
    a.self = a;

    expect(() => sanitizar(a)).not.toThrow();
    expect(sanitizar(a).self).toBe('[CICLICO]');
  });

  it('configuração sai sem segredo', () => {
    const c = sanitizarConfiguracao({
      DB_HOST: 'localhost',
      DB_PASSWORD: 'senha_secreta_do_banco',
      JWT_SECRET: 'chave_super_secreta',
      CATRACA_TIMEOUT: '10000',
      SMTP_PASS: '',
      HOME: '/Users/alguem'
    });

    expect(c.DB_HOST).toBe('localhost');
    expect(c.CATRACA_TIMEOUT).toBe('10000');
    expect(c.HOME).toBeUndefined(); // nada de caminho de usuário

    // Segredo nunca vaza o valor, MAS diz se está configurado — é a pergunta que resolve chamado
    // quando o banco não conecta ("a senha está preenchida?").
    expect(c.DB_PASSWORD).toBe('[DEFINIDO]');
    expect(c.JWT_SECRET).toBe('[DEFINIDO]');
    expect(c.SMTP_PASS).toBe('[NAO_DEFINIDO]');
    expect(JSON.stringify(c)).not.toContain('senha_secreta_do_banco');
    expect(JSON.stringify(c)).not.toContain('chave_super_secreta');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // O TESTE QUE MAIS IMPORTA
  // ─────────────────────────────────────────────────────────────────────────────
  it('NENHUM valor pessoal de um cadastro real aparece na saída, em nenhuma forma', () => {
    const pessoa = {
      id: 922,
      nome: 'Ana Clara Guedes Felisbino',
      cpf: '39812345678',
      rg: '482913756',
      orgao_emissor_rg: 'SSP-SP',
      email: 'ana.felisbino@etec.sp.gov.br',
      telefone: '11987654321',
      data_nascimento: '2009-04-17',
      foto: 'pessoas/pessoa_922.png',
      cartao_rfid: '20612345',
      qr_code: '48271956',
      senha_acesso: '$2b$10$abcdefghijklmnop',
      ra: '00011159266761',
      rm: '202320600042',
      tipo: 'ALUNO',
      turma_id: 7,
      unidade_id: 1
    };

    const saida = JSON.stringify(sanitizar({ contexto: 'sync', pessoa }));

    const valoresPessoais = [
      'Ana Clara', 'Guedes', 'Felisbino', '39812345678', '482913756', 'SSP-SP',
      'ana.felisbino', 'etec.sp.gov.br', '11987654321', '2009-04-17',
      'pessoa_922.png', '20612345', '48271956', '$2b$10$', '00011159266761', '202320600042'
    ];

    for (const valor of valoresPessoais) {
      expect(saida).not.toContain(valor);
    }

    // E o que precisa sobrar, sobrou — senão o diagnóstico remoto fica inútil:
    const obj = JSON.parse(saida);
    expect(obj.pessoa.id).toBe(922);
    expect(obj.pessoa.tipo).toBe('ALUNO');
    expect(obj.pessoa.turma_id).toBe(7);
    expect(obj.pessoa.unidade_id).toBe(1);
  });
});
