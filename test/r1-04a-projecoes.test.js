const fs = require('fs');
const path = require('path');

const projecoes = require('../src/config/projecoes');
const { criarRegistro } = require('../src/utils/generic-db-utils');
const db = require('../src/config/database');
const schoolController = require('../src/controllers/schoolController');
const deviceController = require('../src/controllers/deviceController');
const deviceService = require('../src/services/deviceService');

function respostaFake() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

function esperarSemSegredo(body, valores = []) {
  const chaves = [];
  const visitar = (valor) => {
    if (!valor || typeof valor !== 'object') return;
    for (const [chave, filho] of Object.entries(valor)) { chaves.push(chave); visitar(filho); }
  };
  visitar(body);
  expect(chaves).not.toContain('senha');
  expect(chaves).not.toContain('usuario');
  expect(chaves).not.toContain('recuperacao_chave_hash');
  for (const valor of valores) expect(JSON.stringify(body)).not.toContain(valor);
}

function colunasDoDdl(tabela) {
  const base = fs.readFileSync(path.join(__dirname, '..', 'database', 'sage.sql'), 'utf8');
  const migrations = fs.readdirSync(path.join(__dirname, '..', 'database', 'migrations'))
    .map((nome) => fs.readFileSync(path.join(__dirname, '..', 'database', 'migrations', nome), 'utf8'))
    .join('\n');
  const colunas = new Set();
  const create = new RegExp(`CREATE TABLE IF NOT EXISTS ${tabela}\\s*\\(([\\s\\S]*?)\\n\\);`, 'i').exec(base);
  for (const linha of create?.[1]?.split('\n') || []) {
    const coluna = /^\s*`?([a-z_][a-z0-9_]*)`?\s+/i.exec(linha)?.[1];
    if (coluna && !/^(constraint|primary|foreign|unique|check|index|key)$/i.test(coluna)) colunas.add(coluna);
  }
  const alter = new RegExp(`ALTER TABLE\\s+${tabela}\\s+([\\s\\S]*?);`, 'gi');
  for (const trecho of migrations.matchAll(alter)) {
    for (const coluna of trecho[1].matchAll(/ADD COLUMN(?: IF NOT EXISTS)?\s+`?([a-z_][a-z0-9_]*)`?/gi)) {
      colunas.add(coluna[1]);
    }
  }
  return colunas;
}

describe('R1-04A - projecoes de leitura', () => {
  it('declara as duas entidades e falha fechado em conflito', () => {
    expect(projecoes.UnidadeEscolar).toBeDefined();
    expect(projecoes.Dispositivo).toBeDefined();
    expect(() => projecoes.validarDeclaracoes({
      Teste: { leitura: ['segredo'], escrita: [], segredo: ['segredo'] }
    })).toThrowError(/PROJECAO_INVALIDA/);
  });

  it('mantem leitura, escrita e segredo dentro do DDL', () => {
    for (const tabela of ['UnidadeEscolar', 'Dispositivo']) {
      const colunas = colunasDoDdl(tabela);
      for (const conjunto of ['leitura', 'escrita', 'segredo']) {
        for (const coluna of projecoes[tabela][conjunto]) {
          expect(colunas, `${tabela}.${conjunto}.${coluna}`).toContain(coluna);
        }
      }
      expect(projecoes[tabela].leitura.filter((coluna) => projecoes[tabela].segredo.includes(coluna))).toEqual([]);
    }
  });

  it('guarda as tabelas referenciadas pelos controllers deste pacote', () => {
    const controllers = {
      UnidadeEscolar: 'schoolController.js',
      Dispositivo: 'deviceController.js'
    };
    for (const [tabela, arquivo] of Object.entries(controllers)) {
      const fonte = fs.readFileSync(path.join(__dirname, '..', 'src', 'controllers', arquivo), 'utf8');
      expect(projecoes[tabela], tabela).toBeDefined();
      expect(fonte).toContain(`const tabela = '${tabela}'`);
      expect(fonte).toContain('gerarController(tabela');
    }
  });

  it('projetarRegistro remove segredo novo sem alterar controller', () => {
    const declaracao = {
      ...projecoes.Dispositivo,
      segredo: [...projecoes.Dispositivo.segredo, 'senha_backup']
    };
    const resposta = projecoes.projetarRegistro('Dispositivo', {
      id: 7, nome: 'Catraca sintetica', senha: 'nao-deve-sair', senha_backup: 'tambem-nao'
    }, declaracao);
    expect(resposta).toEqual({ id: 7, nome: 'Catraca sintetica' });
    expect(resposta).not.toHaveProperty('senha_backup');
  });

  it('rele a criacao com SELECT projetado, nunca SELECT *', async () => {
    const queries = [];
    const connection = {
      query: async (sql) => {
        queries.push(sql);
        if (sql.startsWith('INSERT')) return [{ insertId: 19 }];
        return [[{ id: 19, nome: 'Catraca sintetica', usuario: 'admin', senha: 'segredo' }]];
      }
    };
    const resposta = await criarRegistro('Dispositivo', {
      nome: 'Catraca sintetica', usuario: 'admin', senha: 'segredo'
    }, connection);
    expect(queries[1]).toContain('SELECT id, nome, modelo');
    expect(queries[1]).not.toContain('SELECT *');
    expect(resposta).not.toHaveProperty('usuario');
    expect(resposta).not.toHaveProperty('senha');
  });
});

describe('R1-04A - respostas dos handlers', () => {
  const escola = { id: 3, nome: 'Escola sintetica', senha: 'hash-escola', login: 'admin' };
  const dispositivo = { id: 4, nome: 'Catraca sintetica', usuario: 'cat-admin', senha: 'credencial-catraca' };

  afterEach(() => vi.restoreAllMocks());

  it('GET /escolas e GET /escolas/:id entregam corpos sem segredo', async () => {
    vi.spyOn(db, 'query').mockImplementation(async (sql) => {
      if (sql.includes('COUNT(*)')) return [[{ total: 1 }]];
      return [[escola]];
    });
    const lista = respostaFake();
    await schoolController.listar({ query: { page: 91, limit: 91 } }, lista);
    const porId = respostaFake();
    await schoolController.listarPorId({ params: { id: 391 } }, porId);
    esperarSemSegredo(lista.body, ['hash-escola']);
    esperarSemSegredo(porId.body, ['hash-escola']);
  });

  it('POST /escolas responde com a linha criada projetada', async () => {
    const connection = {
      query: vi.fn(async (sql) => sql.startsWith('INSERT INTO TrilhaAuditoria') ? [{}] : sql.startsWith('INSERT') ? [{ insertId: 5 }] : [[escola]]),
      beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn()
    };
    vi.spyOn(db, 'getConnection').mockResolvedValue(connection);
    const res = respostaFake();
    await schoolController.criar({ user: { usuario_id: 8 }, body: { nome: escola.nome, login: escola.login, senha: 'senha-nova' } }, res);
    expect(res.statusCode).toBe(201);
    esperarSemSegredo(res.body, ['hash-escola', 'senha-nova']);
  });

  it('POST /dispositivos e quickAdd projetam a resposta antes do res.json', async () => {
    vi.spyOn(db, 'query').mockImplementation(async (sql) => {
      if (sql.startsWith('INSERT')) return [{ insertId: dispositivo.id }];
      if (sql.includes('LAST_INSERT_ID')) return [[{ id: dispositivo.id }]];
      return [[dispositivo]];
    });
    vi.spyOn(deviceService, 'configurarMonitorNaCatraca').mockResolvedValue({ ok: true });
    vi.spyOn(deviceService, 'testarConexaoCatraca').mockResolvedValue(true);
    const criado = respostaFake();
    await deviceController.criar({ body: dispositivo }, criado);
    const quick = respostaFake();
    await deviceController.quickAdd({ body: { ip: '127.0.0.1', port: 80, usuario: dispositivo.usuario, senha: dispositivo.senha } }, quick);
    expect(criado.statusCode).toBe(201);
    expect(quick.statusCode).toBe(201);
    esperarSemSegredo(criado.body, ['credencial-catraca']);
    esperarSemSegredo(quick.body, ['credencial-catraca']);
  });
});
