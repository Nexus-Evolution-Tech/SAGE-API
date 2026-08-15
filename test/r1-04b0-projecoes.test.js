const fs = require('fs');
const path = require('path');

const projecoes = require('../src/config/projecoes');

const tabelasB0 = [
  'Area', 'Acesso', 'Empresa', 'Turma', 'Curso', 'Sala', 'UnidadeFoto',
  'Presenca', 'Materia', 'SolicitacaoAcesso', 'Pessoa'
];

function blocoDaTabela(ddl, tabela) {
  return new RegExp(`CREATE TABLE IF NOT EXISTS ${tabela}\\s*\\(([\\s\\S]*?)\\)\\s*(?:ENGINE[^;]*)?;`, 'i').exec(ddl)?.[1] || '';
}

function colunasDoBloco(bloco) {
  return [...bloco.split('\n').reduce((colunas, linha) => {
    const match = /^\s*`?([a-z_][a-z0-9_]*)`?\s+/i.exec(linha);
    if (match && !/^(constraint|primary|foreign|unique|check|index|key)$/i.test(match[1])) colunas.push(match[1]);
    return colunas;
  }, [])];
}

function inventarioDdl() {
  const ddl = fs.readFileSync(path.join(__dirname, '..', 'database', 'sage.sql'), 'utf8');
  const tabelas = new Map();
  for (const tabela of Object.keys(projecoes)) {
    const bloco = blocoDaTabela(ddl, tabela);
    tabelas.set(tabela, {
      colunas: colunasDoBloco(bloco),
      criptografadas: colunasDoBloco(bloco).filter((coluna) => {
        const linha = bloco.split('\n').find((item) => new RegExp('^\\s*`?' + coluna + '`?\\s+', 'i').test(item));
        return /criptograf/i.test(linha || '');
      })
    });
  }
  const migrations = fs.readdirSync(path.join(__dirname, '..', 'database', 'migrations'))
    .map((nome) => fs.readFileSync(path.join(__dirname, '..', 'database', 'migrations', nome), 'utf8')).join('\n');
  for (const [tabela, inventario] of tabelas) {
    for (const trecho of migrations.matchAll(new RegExp(`ALTER TABLE\\s+${tabela}\\s+([\\s\\S]*?);`, 'gi'))) {
      for (const coluna of trecho[1].matchAll(/ADD COLUMN(?: IF NOT EXISTS)?\s+`?([a-z_][a-z0-9_]*)`?/gi)) inventario.colunas.push(coluna[1]);
    }
  }
  return tabelas;
}

function validarContraDdl(declaracoes, inventario) {
  for (const [tabela, declaracao] of Object.entries(declaracoes)) {
    const schema = inventario.get(tabela);
    if (!schema) throw new Error(`PROJECAO_INVALIDA: tabela fora do DDL: ${tabela}`);
    const colunas = new Set(schema.colunas);
    for (const conjunto of ['leitura', 'escrita', 'segredo']) {
      for (const coluna of declaracao[conjunto]) {
        if (!colunas.has(coluna)) throw new Error(`PROJECAO_INVALIDA: coluna fora do DDL: ${tabela}.${coluna}`);
      }
    }
    const conflito = declaracao.leitura.find((coluna) => declaracao.segredo.includes(coluna));
    if (conflito) throw new Error(`PROJECAO_INVALIDA: conflito: ${tabela}.${conflito}`);
    for (const coluna of schema.criptografadas) {
      if (!declaracao.segredo.includes(coluna)) throw new Error(`PROJECAO_INVALIDA: segredo ausente: ${tabela}.${coluna}`);
    }
  }
}

describe('R1-04B0 - declarações e guard de completude', () => {
  const inventario = inventarioDdl();

  it('declara todas as onze tabelas do pacote', () => {
    expect(tabelasB0).toHaveLength(11);
    for (const tabela of tabelasB0) expect(projecoes[tabela], tabela).toBeDefined();
  });

  it('deriva leitura, escrita e segredo do DDL', () => {
    validarContraDdl(projecoes, inventario);
    for (const tabela of tabelasB0) {
      const declaracao = projecoes[tabela];
      const colunas = inventario.get(tabela).colunas;
      const segredo = new Set(declaracao.segredo);
      expect(declaracao.leitura).toEqual(colunas.filter((coluna) => !segredo.has(coluna)));
      expect(declaracao.escrita).toEqual(colunas.filter((coluna) => !['id', 'created_at', 'updated_at'].includes(coluna)));
    }
    expect(projecoes.Pessoa.segredo).toEqual(['senha_acesso']);
    expect(projecoes.Pessoa.escrita).toContain('senha_acesso');
    expect(projecoes.Pessoa.leitura).not.toContain('senha_acesso');
    expect(projecoes.Pessoa.leitura).toEqual(expect.arrayContaining(['qr_code', 'cartao_rfid']));
  });

  it('reprova coluna fora do DDL, conflito e segredo criptografado ausente', () => {
    const base = { Teste: { leitura: [], escrita: [], segredo: [] } };
    const schema = new Map([['Teste', { colunas: ['id'], criptografadas: [] }]]);
    expect(() => validarContraDdl({ Teste: { ...base.Teste, leitura: ['nao_existe'] } }, schema)).toThrow(/fora do DDL/);
    expect(() => validarContraDdl({ Teste: { leitura: ['id'], escrita: [], segredo: ['id'] } }, schema)).toThrow(/conflito/);
    const segredoAusente = new Map([['Teste', { colunas: ['id'], criptografadas: ['senha'] }]]);
    expect(() => validarContraDdl({ Teste: base.Teste }, segredoAusente)).toThrow(/segredo ausente/);
  });

  it('guarda todo controller genérico alcançável e falha fechado para tabela nova', () => {
    const diretorio = path.join(__dirname, '..', 'src', 'controllers');
    const controladores = fs.readdirSync(diretorio)
      .filter((arquivo) => arquivo.endsWith('.js'))
      .map((arquivo) => ({ arquivo, fonte: fs.readFileSync(path.join(diretorio, arquivo), 'utf8') }))
      .filter(({ arquivo, fonte }) => arquivo !== 'genericControllerFactory.js' && fonte.includes('gerarController(tabela'));
    expect(controladores.length).toBeGreaterThanOrEqual(13);
    for (const { arquivo, fonte } of controladores) {
      const tabela = /const tabela = '([^']+)'/.exec(fonte)?.[1];
      expect(tabela, arquivo).toBeTruthy();
      expect(() => projecoes.exigirProjecao(tabela)).not.toThrow();
    }
    expect(() => projecoes.exigirProjecao('ControllerNovoSemDeclaracao')).toThrow(/PROJECAO_INVALIDA/);
  });
});
