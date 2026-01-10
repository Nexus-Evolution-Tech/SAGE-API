const pLimit = require('p-limit');
const { listarTodos } = require('./deviceService');
const { obterSessao, linkCatraca } = require('./deviceService');
const controlId = require('../utils/controlId-utils');
const { verificaSeFotoUserExiste, deletarFotoUserPorId } = require('../utils/photo-user-utils');
const gerarCardValue = require('../utils/gerarCardValue');
const gerarNumero8Digitos = require('../utils/gerarNumero8Digitos');
const logger = require('../config/logger');

// Constantes
const USER_ID_OFFSET = parseInt(process.env.CATRACA_USER_ID_OFFSET || '110000000');
const PARALLEL_LIMIT = parseInt(process.env.SYNC_PARALLEL_LIMIT || '3');

// Limitar concorrência para não sobrecarregar as catracas
const limit = pLimit(PARALLEL_LIMIT);

// ==================== HELPERS ====================

// Compat: alguns módulos antigos podem referenciar esta função.
// Mantemos um stub que retorna false para evitar SELECTs de deduplicação.
// async function existeRegistroPendentePorDispositivo() {
//   return false;
// }

// ==================== CRIAR PESSOA ====================

/**
 * Processa criação de pessoa em um dispositivo específico (PARALELO)
 */
const processarCriacaoDispositivo = async (dispositivo, novaPessoa, catracaUserId, qrcode) => {
  const link = linkCatraca(dispositivo);
  
  try {
    const session = await obterSessao(link, dispositivo);
    
    if (!session) {
      // await registrarSyncPendente(novaPessoa.id, dispositivo.id, 'CREATE', 'Sessão inválida');
      return { dispositivo: dispositivo.nome, sucesso: false, erro: 'Sessão inválida' };
    }

    const resultados = [];

    // 1. Criar usuário
    await controlId.criarUsuario(catracaUserId, novaPessoa, link, session, dispositivo, resultados);

    // 2. Criar cartão RFID, se existir
    if (novaPessoa.cartao_rfid && novaPessoa.cartao_rfid.length === 8) {
      const value = await gerarCardValue(novaPessoa.cartao_rfid);
      await controlId.criarCartao(catracaUserId, value, link, session, dispositivo, resultados);
    }

    // 3. Criar cartão QR code
    await controlId.criarCartao(catracaUserId, qrcode, link, session, dispositivo, resultados);

    // 4. Criar grupo
    await controlId.criarGrupo(catracaUserId, link, session, dispositivo, resultados);

    logger.info(` Pessoa ${novaPessoa.nome} criada em ${dispositivo.nome}`);
    return { dispositivo: dispositivo.nome, sucesso: true, catracaId: catracaUserId };

  } catch (error) {
    // await registrarSyncPendente(novaPessoa.id, dispositivo.id, 'CREATE', error.message);
    logger.error(` Erro ao criar pessoa em ${dispositivo.nome}: ${error.message}`);
    return { dispositivo: dispositivo.nome, sucesso: false, erro: error.message };
  }
};

/**
 * Cria pessoa em todas as catracas (ou em uma específica) - PROCESSAMENTO PARALELO
 */
const criarNovaPessoaNasCatracas = async (novaPessoa, dispositivoId = null) => {
  const catracaUserId = USER_ID_OFFSET + Number(novaPessoa.id);
  const todosDispositivos = await listarTodos();
  
  // Filtrar dispositivos (todos ou específico)
  const dispositivos = dispositivoId !== null
    ? [todosDispositivos.find(d => d.id == dispositivoId.dispositivoId)].filter(Boolean)
    : todosDispositivos;

  if (dispositivos.length === 0) {
    throw new Error('Nenhum dispositivo encontrado');
  }

  const qrcode = novaPessoa.qrcode && novaPessoa.qrcode.length === 8 
    ? Number(novaPessoa.qrcode) 
    : gerarNumero8Digitos();

  logger.info(`Iniciando criação paralela de ${novaPessoa.nome} em ${dispositivos.length} catraca(s)`);

  //  PROCESSAMENTO PARALELO com limit
  const promessas = dispositivos.map(dispositivo =>
    limit(() => processarCriacaoDispositivo(dispositivo, novaPessoa, catracaUserId, qrcode))
  );

  const resultados = await Promise.all(promessas);

  // Verificar falhas
  const falhas = resultados.filter(r => !r.sucesso);
  if (falhas.length > 0) {
    logger.warn(` ${falhas.length}/${resultados.length} catraca(s) falharam ao criar ${novaPessoa.nome}`);
    const err = new Error(`Erro ao criar usuário em ${falhas.length} catraca(s)`);
    err.detalhes = falhas;
    throw err;
  }

  logger.info(` Pessoa ${novaPessoa.nome} criada com sucesso em todas as catracas`);
  return resultados;
};

// ==================== EDITAR PESSOA ====================

/**
 * Processa edição de pessoa em um dispositivo específico (PARALELO)
 */
const processarEdicaoDispositivo = async (dispositivo, id, nome, cartao_rfid, qrcode, catracaUserId) => {
  const link = linkCatraca(dispositivo);
  
  try {
    const session = await obterSessao(link, dispositivo);
    
    if (!session) {
      // await registrarSyncPendente(id, dispositivo.id, 'UPDATE', 'Sessão inválida');
      return { dispositivo: dispositivo.nome, sucesso: false, erro: 'Sessão inválida' };
    }

    const resultados = [];

    // Editar nome do usuário
    await controlId.editarUsuario(catracaUserId, nome, link, session, dispositivo, resultados);

    const sessionAdm = await controlId.obterSessaoAdmin(
      link,
      process.env.CATRACA_ADMIN_USER,
      process.env.CATRACA_ADMIN_PASSWORD
    );

    // Editar/deletar cartão RFID
    if (cartao_rfid !== null && cartao_rfid.length === 8) {
      const value = await gerarCardValue(cartao_rfid);

      await controlId.deletarCartao(catracaUserId, link, sessionAdm, dispositivo, 'RFID');
      await controlId.criarCartao(catracaUserId, value, link, session, dispositivo, resultados);
    } else {
      await controlId.deletarCartao(catracaUserId, link, session, dispositivo, resultados);
    }

    // QRCODE é atualizado sempre, mesmo que não tenha mudado efetivamente
    const value = Number(qrcode);

    await controlId.deletarCartao(catracaUserId, link, sessionAdm, dispositivo, 'QRCODE');
    await controlId.criarCartao(catracaUserId, value, link, session, dispositivo, resultados);

    // UPLOAD_PHOTO
    await controlId.criarImagemUser(catracaUserId, link, session, dispositivo);

    logger.info(` Pessoa ${id} editada em ${dispositivo.nome}`);
    return { dispositivo: dispositivo.nome, sucesso: true };

  } catch (error) {
    // Fila a atualização; duplicatas são ignoradas pelo índice único
    // await registrarSyncPendente(id, dispositivo.id, 'UPDATE', error.message);

    logger.error(` Erro ao editar pessoa em ${dispositivo.nome}: ${error.message}`);
    return { dispositivo: dispositivo.nome, sucesso: false, erro: error.message };
  }
};

/**
 * Edita pessoa em todas as catracas (ou em uma específica) - PROCESSAMENTO PARALELO
 */
const editarPessoaNasCatracas = async (id, nome, cartao_rfid, qrcode, dispositivoId = null) => {
  const catracaUserId = USER_ID_OFFSET + Number(id);
  const todosDispositivos = await listarTodos();
  
  const dispositivos = dispositivoId !== null
    ? [todosDispositivos.find(d => d.id == dispositivoId.dispositivoId)].filter(Boolean)
    : todosDispositivos;

  if (dispositivos.length === 0) {
    throw new Error('Nenhum dispositivo encontrado');
  }

  logger.info(`Iniciando edição paralela de pessoa ${id} em ${dispositivos.length} catraca(s)`);

  //  PROCESSAMENTO PARALELO
  const promessas = dispositivos.map(dispositivo =>
    limit(() => processarEdicaoDispositivo(dispositivo, id, nome, cartao_rfid, qrcode, catracaUserId))
  );

  const resultados = await Promise.all(promessas);

  // Verificar falhas
  const falhas = resultados.filter(r => !r.sucesso);
  if (falhas.length > 0) {
    logger.warn(` ${falhas.length}/${resultados.length} catraca(s) falharam ao editar pessoa ${id}`);
    const err = new Error(`Erro ao editar usuário em ${falhas.length} catraca(s)`);
    err.detalhes = falhas;
    throw err;
  }

  logger.info(` Pessoa ${id} editada com sucesso em todas as catracas`);
  return resultados;
};

// ==================== DELETAR PESSOA ====================

/**
 * Processa deleção de pessoa em um dispositivo específico (PARALELO)
 */
const processarDelecaoDispositivo = async (dispositivo, id, catracaUserId) => {
  const link = linkCatraca(dispositivo);
  
  try {
    const session = await obterSessao(link, dispositivo);
    
    if (!session) {
      // await registrarSyncPendente(id, dispositivo.id, 'DELETE', 'Sessão inválida');
      return { dispositivo: dispositivo.nome, sucesso: false, erro: 'Sessão inválida' };
    }

    const resultados = [];

    // Deletar usuário (cartões e grupos são deletados automaticamente)
    await controlId.deletarUsuario(catracaUserId, link, session, dispositivo, resultados);

    logger.info(` Pessoa ${id} deletada de ${dispositivo.nome}`);
    return { dispositivo: dispositivo.nome, sucesso: true };

  } catch (error) {
    // await registrarSyncPendente(id, dispositivo.id, 'DELETE', error.message);
    logger.error(` Erro ao deletar pessoa em ${dispositivo.nome}: ${error.message}`);
    return { dispositivo: dispositivo.nome, sucesso: false, erro: error.message };
  }
};

/**
 * Deleta pessoa de todas as catracas (ou de uma específica) - PROCESSAMENTO PARALELO
 */
const deletarPessoaDasCatracas = async (id, dispositivoId = null) => {
  const catracaUserId = USER_ID_OFFSET + Number(id);
  const todosDispositivos = await listarTodos();
  
  const dispositivos = dispositivoId !== null
    ? [todosDispositivos.find(d => d.id == dispositivoId.dispositivoId)].filter(Boolean)
    : todosDispositivos;

  if (dispositivos.length === 0) {
    throw new Error('Nenhum dispositivo encontrado');
  }

  logger.info(`Iniciando deleção paralela de pessoa ${id} em ${dispositivos.length} catraca(s)`);

  //  PROCESSAMENTO PARALELO
  const promessas = dispositivos.map(dispositivo =>
    limit(() => processarDelecaoDispositivo(dispositivo, id, catracaUserId))
  );

  const resultados = await Promise.all(promessas);

  // Deletar foto se existir
  try {
    if (await verificaSeFotoUserExiste(id)) {
      await deletarFotoUserPorId(Number(id));
      logger.info(` Foto da pessoa ${id} deletada`);
    }
  } catch (error) {
    logger.error(`Erro ao deletar foto: ${error.message}`);
  }

  // Verificar falhas
  const falhas = resultados.filter(r => !r.sucesso);
  if (falhas.length > 0) {
    logger.warn(` ${falhas.length}/${resultados.length} catraca(s) falharam ao deletar pessoa ${id}`);
    const err = new Error(`Erro ao deletar usuário em ${falhas.length} catraca(s)`);
    err.detalhes = falhas;
    throw err;
  }

  logger.info(` Pessoa ${id} deletada com sucesso de todas as catracas`);
  return resultados;
};

// ==================== OUTRAS OPERAÇÕES ====================

const criarImagemUsuario = async (id, dispositivoId = null) => {
  const catracaUserId = USER_ID_OFFSET + Number(id);
  const todosDispositivos = await listarTodos();
  const dispositivos = dispositivoId
    ? [todosDispositivos.find(d => d.id === dispositivoId)].filter(Boolean)
    : todosDispositivos;

  logger.info(`Criando imagem para pessoa ${id} em ${dispositivos.length} catraca(s)`);

  const promessas = dispositivos.map(dispositivo =>
    limit(async () => {
      const link = linkCatraca(dispositivo);
      const session = await obterSessao(link, dispositivo);

      if (!session) {
        return { dispositivo: dispositivo.nome, sucesso: false, erro: 'Sessão inválida' };
      }

      const resultados = [];
      await controlId.criarImagemUser(catracaUserId, link, session, dispositivo, resultados);
      return resultados[0] || { dispositivo: dispositivo.nome, sucesso: true };
    })
  );

  const resultados = await Promise.all(promessas);
  
  const falhas = resultados.filter(r => !r.sucesso);
  if (falhas.length > 0) {
    const err = new Error(`Erro ao criar imagem em ${falhas.length} catraca(s)`);
    err.detalhes = falhas;
    throw err;
  }

  return resultados;
};

const generateQrCode = async (id) => {
  const catracaUserId = USER_ID_OFFSET + Number(id);
  const dispositivos = await listarTodos();
  const value = gerarNumero8Digitos();

  logger.info(`Gerando QR Code para pessoa ${id}`);

  const promessas = dispositivos.map(dispositivo =>
    limit(async () => {
      const link = linkCatraca(dispositivo);
      const session = await obterSessao(link, dispositivo);

      if (!session) {
        return { dispositivo: dispositivo.nome, sucesso: false, erro: 'Sessão inválida' };
      }

      const sessionAdm = await controlId.obterSessaoAdmin(
        link,
        process.env.CATRACA_ADMIN_USER,
        process.env.CATRACA_ADMIN_PASSWORD
      );

      const resultados = [];
      await controlId.deletarCartao(catracaUserId, link, sessionAdm, dispositivo, 'QRCODE');
      await controlId.criarCartao(catracaUserId, value, link, session, dispositivo, resultados);
      
      return resultados[0] || { dispositivo: dispositivo.nome, sucesso: true };
    })
  );

  const resultados = await Promise.all(promessas);
  
  const falhas = resultados.filter(r => !r.sucesso);
  if (falhas.length > 0) {
    const err = new Error(`Erro ao gerar QR Code em ${falhas.length} catraca(s)`);
    err.detalhes = falhas;
    throw err;
  }

  return { resultados, qrcode: value };
};

const generateRFID = async (id, cartao_rfid) => {
  const catracaUserId = USER_ID_OFFSET + Number(id);
  const dispositivos = await listarTodos();
  const value = await gerarCardValue(cartao_rfid);

  logger.info(`Gerando RFID para pessoa ${id}`);

  const promessas = dispositivos.map(dispositivo =>
    limit(async () => {
      const link = linkCatraca(dispositivo);
      const session = await obterSessao(link, dispositivo);

      if (!session) {
        return { dispositivo: dispositivo.nome, sucesso: false, erro: 'Sessão inválida' };
      }

      const sessionAdm = await controlId.obterSessaoAdmin(
        link,
        process.env.CATRACA_ADMIN_USER,
        process.env.CATRACA_ADMIN_PASSWORD
      );

      const resultados = [];
      await controlId.deletarCartao(catracaUserId, link, sessionAdm, dispositivo, 'RFID');
      await controlId.criarCartao(catracaUserId, value, link, session, dispositivo, resultados);
      
      return resultados[0] || { dispositivo: dispositivo.nome, sucesso: true };
    })
  );

  const resultados = await Promise.all(promessas);
  
  const falhas = resultados.filter(r => !r.sucesso);
  if (falhas.length > 0) {
    const err = new Error(`Erro ao gerar RFID em ${falhas.length} catraca(s)`);
    err.detalhes = falhas;
    throw err;
  }

  return { resultados, rfid: cartao_rfid };
};

module.exports = {
  criarNovaPessoaNasCatracas,
  editarPessoaNasCatracas,
  deletarPessoaDasCatracas,
  criarImagemUsuario,
  generateQrCode,
  generateRFID,
  // registrarSyncPendente,
  // registrarSyncPendentesEmLote,
  // existeRegistroPendente,
  // existeRegistroPendentePorDispositivo
};
