const db = require('../config/database');
const logger = require('../config/logger');

const ACOES = Object.freeze({ LOGIN_SUCESSO: 'LOGIN_SUCESSO', LOGOUT: 'LOGOUT',
  USUARIO_CRIADO: 'USUARIO_CRIADO', USUARIO_EDITADO: 'USUARIO_EDITADO',
  USUARIO_DESATIVADO: 'USUARIO_DESATIVADO', SENHA_REDEFINIDA: 'SENHA_REDEFINIDA',
  REGISTRO_CRIADO: 'REGISTRO_CRIADO', REGISTRO_EDITADO: 'REGISTRO_EDITADO',
  REGISTRO_DELETADO: 'REGISTRO_DELETADO',
  CATRACA_OBJETO_DELETADO: 'CATRACA_OBJETO_DELETADO',
  CATRACA_TIPO_ZERADO: 'CATRACA_TIPO_ZERADO',
  CATRACA_TUDO_ZERADO: 'CATRACA_TUDO_ZERADO',
  CATRACA_COMECAR_DO_ZERO: 'CATRACA_COMECAR_DO_ZERO',
  CATRACA_LOGS_ZERADOS: 'CATRACA_LOGS_ZERADOS' });

const ACOES_PERMITIDAS = new Set(Object.values(ACOES));
const CAMPOS_DETALHE = Object.freeze({ LOGIN_SUCESSO: [], LOGOUT: [],
  USUARIO_CRIADO: ['pessoa_id', 'papel'], USUARIO_EDITADO: ['campos'],
  USUARIO_DESATIVADO: [], SENHA_REDEFINIDA: [], REGISTRO_CRIADO: [],
  REGISTRO_EDITADO: [], REGISTRO_DELETADO: [],
  CATRACA_OBJETO_DELETADO: ['dispositivo_id', 'tipo_objeto', 'objeto_id', 'resultado', 'alteracoes'],
  CATRACA_TIPO_ZERADO: ['dispositivo_id', 'tipo_objeto', 'resultado', 'alteracoes'],
  CATRACA_TUDO_ZERADO: ['dispositivo_id', 'resultado'],
  CATRACA_COMECAR_DO_ZERO: ['dispositivo_id', 'resultado', 'backup_banco_verificado',
    'apagar_acessos', 'apagar_areas', 'apagar_pessoas'],
  CATRACA_LOGS_ZERADOS: ['dispositivo_id', 'resultado', 'backup_gerado', 'apagar_acessos'] });
const CAMPOS_EDICAO_AUDITAVEIS = new Set(['login', 'exibicao', 'papel', 'pessoa_id']);
const PAPEIS = new Set(['ADMINISTRADOR', 'SECRETARIA']);
const RESULTADOS = new Set(['TENTATIVA', 'SUCESSO', 'FALHA']);
const CHAVES_SENSIVEIS = /(?:nome|cpf|rg|email|e_mail|foto|qr|cartao|cartão|token|senha|password|jwt)/i;
const VALORES_SENSIVEIS = [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, /^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/,
  /^\d{1,2}\.?\d{3}\.?\d{3}-?[0-9xX]$/, /^\d{13,19}$/, /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/];

class ErroAuditoria extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function validarId(id) {
  return Number.isSafeInteger(id) && id > 0 && id <= 2147483647;
}

function objetoPlano(valor) {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor)
    && Object.getPrototypeOf(valor) === Object.prototype;
}

function validarValorSeguro(valor) {
  if (typeof valor === 'string') return !VALORES_SENSIVEIS.some((padrao) => padrao.test(valor));
  if (Array.isArray(valor)) return valor.every(validarValorSeguro);
  return valor === null || typeof valor === 'number' || typeof valor === 'boolean';
}

function validarDetalhe(acao, detalhe) {
  if (detalhe === null || detalhe === undefined) return null;
  if (!ACOES_PERMITIDAS.has(acao) || !objetoPlano(detalhe)) {
    throw new ErroAuditoria('AUDITORIA_DETALHE_INVALIDO');
  }
  const permitidos = CAMPOS_DETALHE[acao];
  for (const [chave, valor] of Object.entries(detalhe)) {
    if (!permitidos.includes(chave) || CHAVES_SENSIVEIS.test(chave) || !validarValorSeguro(valor)) {
      throw new ErroAuditoria('AUDITORIA_DETALHE_SENSIVEL');
    }
    if (chave === 'pessoa_id' && valor !== null && !validarId(valor)) {
      throw new ErroAuditoria('AUDITORIA_DETALHE_INVALIDO');
    }
    if (chave === 'papel' && !PAPEIS.has(valor)) {
      throw new ErroAuditoria('AUDITORIA_DETALHE_INVALIDO');
    }
    if (chave === 'campos' && (!Array.isArray(valor)
      || valor.some((campo) => !CAMPOS_EDICAO_AUDITAVEIS.has(campo)))) {
      throw new ErroAuditoria('AUDITORIA_DETALHE_INVALIDO');
    }
    if (chave === 'dispositivo_id' || chave === 'objeto_id' || chave === 'alteracoes') {
      if (!validarId(valor) && !(chave === 'alteracoes' && valor === 0)) {
        throw new ErroAuditoria('AUDITORIA_DETALHE_INVALIDO');
      }
    }
    if (chave === 'resultado' && !RESULTADOS.has(valor)) {
      throw new ErroAuditoria('AUDITORIA_DETALHE_INVALIDO');
    }
    if (chave === 'tipo_objeto' && !/^[a-z][a-z0-9_]{0,59}$/.test(valor)) {
      throw new ErroAuditoria('AUDITORIA_DETALHE_INVALIDO');
    }
  }
  return { ...detalhe };
}

function validarAutor(autorId) {
  if (!validarId(autorId)) throw new ErroAuditoria('AUDITORIA_AUTOR_OBRIGATORIO');
  return autorId;
}

async function registrarAuditoria(connection, { autorId, acao, entidade = 'Usuario', entidadeId = null, detalhe = null }) {
  if (!connection || typeof connection.query !== 'function') {
    throw new ErroAuditoria('AUDITORIA_CONEXAO_OBRIGATORIA');
  }
  validarAutor(autorId);
  if (!ACOES_PERMITIDAS.has(acao)) throw new ErroAuditoria('AUDITORIA_ACAO_INVALIDA');
  if (entidade !== null && (typeof entidade !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,59}$/.test(entidade))) {
    throw new ErroAuditoria('AUDITORIA_ENTIDADE_INVALIDA');
  }
  if (entidadeId !== null && !validarId(entidadeId)) {
    throw new ErroAuditoria('AUDITORIA_ENTIDADE_ID_INVALIDO');
  }
  const detalheSeguro = validarDetalhe(acao, detalhe);
  await connection.query(
    `INSERT INTO TrilhaAuditoria
       (usuario_id, acao, entidade, entidade_id, detalhe)
     VALUES (?, ?, ?, ?, ?)`,
    [autorId, acao, entidade, entidadeId, detalheSeguro === null ? null : JSON.stringify(detalheSeguro)]
  );
}

async function executarOperacaoAuditada({ req, acao, entidade, entidadeId, operacao }) {
  validarAutor(req?.user?.usuario_id);
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const resultado = await operacao(connection);
    const id = typeof entidadeId === 'function' ? entidadeId(resultado) : entidadeId;
    await registrarAuditoria(connection, {
      autorId: req.user.usuario_id, acao, entidade, entidadeId: id
    });
    await connection.commit();
    return resultado;
  } catch (error) {
    await connection.rollback().catch(() => logger.error('[AUDITORIA] codigo=ROLLBACK_FALHOU'));
    throw error;
  } finally {
    connection.release();
  }
}

async function registrarAuditoriaAutonoma({ req, acao, entidade = 'Dispositivo', entidadeId, detalhe }) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await registrarAuditoria(connection, {
      autorId: req?.user?.usuario_id, acao, entidade, entidadeId, detalhe
    });
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => logger.error('[AUDITORIA] codigo=ROLLBACK_FALHOU'));
    throw error;
  } finally {
    connection.release();
  }
}

async function executarOperacaoRemotaAuditada({ req, acao, entidade = 'Dispositivo', entidadeId, detalhe, operacao, prepararSucesso }) {
  await registrarAuditoriaAutonoma({
    req, acao, entidade, entidadeId, detalhe: { ...detalhe, resultado: 'TENTATIVA' }
  });

  let resultado;
  try {
    resultado = await operacao();
  } catch (error) {
    await registrarAuditoriaAutonoma({
      req, acao, entidade, entidadeId, detalhe: { ...detalhe, resultado: 'FALHA' }
    });
    throw error;
  }

  const sucesso = resultado?.ok !== false;
  if (!sucesso) {
    await registrarAuditoriaAutonoma({
      req, acao, entidade, entidadeId,
      detalhe: { ...detalhe, resultado: 'FALHA' }
    });
    return resultado;
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    if (prepararSucesso) await prepararSucesso(connection, resultado);
    await registrarAuditoria(connection, {
      autorId: req?.user?.usuario_id,
      acao, entidade, entidadeId,
      detalhe: {
        ...detalhe, resultado: 'SUCESSO',
        ...(Number.isSafeInteger(resultado?.changes) && { alteracoes: resultado.changes })
      }
    });
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => logger.error('[AUDITORIA] codigo=ROLLBACK_FALHOU'));
    throw error;
  } finally {
    connection.release();
  }
  return resultado;
}

module.exports = {
  ACOES,
  ErroAuditoria,
  validarAutor,
  validarDetalhe,
  registrarAuditoria,
  executarOperacaoAuditada,
  registrarAuditoriaAutonoma,
  executarOperacaoRemotaAuditada
};
