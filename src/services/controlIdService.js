const dispositivosService = require('./deviceService');
const controlId = require('../utils/controlId-utils');
const { verificaSeFotoUserExiste, deletarFotoUserPorId } = require('../utils/photo-user-utils');
const gerarCardValue = require('../utils/gerarCardValue');
const gerarNumero8Digitos = require('../utils/gerarNumero8Digitos');

// Função para inserir na tabela sync_pendente caso ocorra um erro na sincronização
const registrarSyncPendente = async (pessoaId, dispositivoId, action) => {
  try {
    await db.query('INSERT INTO sync_pendente (pessoa_id, dispositivo_id, actions) VALUES (?, ?, ?)', [pessoaId, dispositivoId, action]);
    console.log(`Registro de sincronização pendente inserido para pessoa ${pessoaId} e dispositivo ${dispositivoId}`);
  } catch (err) {
    console.error('Erro ao registrar sincronização pendente:', err);
  }
};

// OBS: TA CRIANDO, MAS QUANDO O CARTAO RFID É O MESMO ELE NÃO DA EXCEÇÃO, SIMPLESMENTE NÃO CRIA ATRIBUI O CARTÃO À PESSOA, DEVERIA TER PELO MENOS UM AVISO DE QUE NÃO PÔDE SER CRIADO
// O PROBLEMA DISSO É QUE EU NÃO CONSIGO VER SE A VERIFICAÇÃO ESTÁ PENDENTE, SE ESTIVER, PROVAVELMENTE VOU PRECISAR SALVAR O ID DA PESSOA EM UMA TABELA A PARTE
// DEVE CADASTRAR NO BANCO MESMO SE DER PROBLEMA NA REDE, MAS O PRÓPRIO SISTEMA DEVERÁ CHECAR CASO NÃO SINCRONIZE DIRETO

// se der excecao em cada uma dessas funções eu preciso inserir o id da pessoa na tabela sync_pendente
const criarNovaPessoaNasCatracas = async (novaPessoa, dispositivoId = null) => {
  const catracaUserId = 110000000 + Number(novaPessoa.id);
  const dispositivos = dispositivoId ? [dispositivos.find(d => d.id === dispositivoId)] : await dispositivosService.listarTodos();

  const resultados = [];
  const qrcode = novaPessoa.qrcode !== null && novaPessoa.qrcode?.length === 8 ? Number(novaPessoa.qrcode) : gerarNumero8Digitos();

  for (const dispositivo of dispositivos) {
    const link = dispositivosService.linkCatraca(dispositivo);
    const session = await dispositivosService.obterSessao(link, dispositivo);

    if (!session) {
      // Registra a falha na tabela de pendente
      await registrarSyncPendente(novaPessoa.id, dispositivo.id, 'Sessão inválida');
      resultados.push({ dispositivo: dispositivo.nome, sucesso: false, erro: 'Sessão inválida' });
      continue;
    }

    try {
      // 1. Criar usuário
      await controlId.criarUsuario(catracaUserId, novaPessoa, link, session, dispositivo, resultados);

      // 2. Criar cartão RFID, se existir
      if (novaPessoa.cartao_rfid !== null && novaPessoa.cartao_rfid?.length === 8) {
        const value = await gerarCardValue(novaPessoa.cartao_rfid);
        await controlId.criarCartao(catracaUserId, value, link, session, dispositivo, resultados);
      }

      // Criar cartão QR code
      await controlId.criarCartao(catracaUserId, qrcode, link, session, dispositivo, resultados);

      // 3. Criar grupo
      await controlId.criarGrupo(catracaUserId, link, session, dispositivo, resultados);
    } catch (error) {
      // Se algum erro ocorrer, registra na tabela `sync_pendente` com detalhes
      await registrarSyncPendente(novaPessoa.id, dispositivo.id, 'CREATE', error.message || 'Erro desconhecido');
      resultados.push({ dispositivo: dispositivo.nome, sucesso: false, erro: error.message || 'Erro desconhecido' });
    }
  }

  // Se algum dispositivo falhou, lança erro
  const falhas = resultados.filter(r => !r.sucesso);
  if (falhas.length > 0) {
    const msg = `Erro ao criar usuário em ${falhas.length} catraca(s)`;
    const err = new Error(msg);
    err.detalhes = falhas;
    throw err;
  }

  return resultados; // tudo ok
};

const editarPessoaNasCatracas = async (id, nome, cartao_rfid, dispositivoId = null) => {
  const catracaUserId = 110000000 + Number(id);
  const dispositivos = dispositivoId ? [dispositivos.find(d => d.id === dispositivoId)] : await dispositivosService.listarTodos();
  const resultados = [];

  for (const dispositivo of dispositivos) {
    const link = dispositivosService.linkCatraca(dispositivo);
    const session = await dispositivosService.obterSessao(link, dispositivo);

    if (!session) {
      // Registra falha na tabela de pendente
      await registrarSyncPendente(id, dispositivo.id, 'Sessão inválida');
      resultados.push({ dispositivo: dispositivo.nome, sucesso: false, erro: 'Sessão inválida' });
      continue;
    }

    try {
      await controlId.editarUsuario(catracaUserId, nome, link, session, dispositivo, resultados);

      if (cartao_rfid !== null) {
        const sessionAdm = await controlId.obterSessaoAdmin(link, 'admin', 'admin');
        const value = await gerarCardValue(cartao_rfid);

        await controlId.deletarCartao(catracaUserId, link, sessionAdm, dispositivo, 'RFID');
        await controlId.criarCartao(catracaUserId, value, link, session, dispositivo, resultados);
      } else {
        await controlId.deletarCartao(catracaUserId, link, session, dispositivo, resultados);
      }
    } catch (error) {
      // Se erro ocorrer, registra na tabela de pendente
      await registrarSyncPendente(id, dispositivo.id, 'UPDATE', error.message || 'Erro desconhecido');
      resultados.push({ dispositivo: dispositivo.nome, sucesso: false, erro: error.message || 'Erro desconhecido' });
    }
  }

  // Se algum dispositivo falhou, lança erro
  const falhas = resultados.filter(r => !r.sucesso);
  if (falhas.length > 0) {
    const msg = `Erro ao editar nome do usuário em ${falhas.length} catraca(s)`;
    const err = new Error(msg);
    err.detalhes = falhas;
    throw err;
  }

  return resultados; // tudo ok
};

// OBS: TA DELETANDO, MAS MESMO QUANDO O ID NÃO EXISTE DA TRUE NAS DUAS CATRACAS
const deletarPessoaDasCatracas = async (id, dispositivoId = null) => {
  const catracaUserId = 110000000 + Number(id);
  const dispositivos = dispositivoId ? [dispositivos.find(d => d.id === dispositivoId)] : await dispositivosService.listarTodos();
  const resultados = [];

  for (const dispositivo of dispositivos) {
    const link = dispositivosService.linkCatraca(dispositivo);
    const session = await dispositivosService.obterSessao(link, dispositivo);

    if (!session) {
      // Registra falha na tabela de pendente
      await registrarSyncPendente(id, dispositivo.id, 'Sessão inválida');
      resultados.push({ dispositivo: dispositivo.nome, sucesso: false, erro: 'Sessão inválida' });
      continue;
    }

    try {
      // 1. Deletar usuário
      await controlId.deletarUsuario(catracaUserId, link, session, dispositivo, resultados);

      // 2. Deletar Cartao e 3. Deletar Grupo são automáticos

      // 4. Deletar imagem se existir
      if (await verificaSeFotoUserExiste(id)) {
        await deletarFotoUserPorId(Number(id));
      }
    } catch (error) {
      // Registra falha na tabela de pendente
      await registrarSyncPendente(id, dispositivo.id, 'DELETE', error.message || 'Erro desconhecido');
      resultados.push({ dispositivo: dispositivo.nome, sucesso: false, erro: error.message || 'Erro desconhecido' });
    }
  }

  // Se algum dispositivo falhou ao deletar, lança erro
  const falhas = resultados.filter(r => !r.sucesso);
  if (falhas.length > 0) {
    const msg = `Erro ao deletar usuário em ${falhas.length} catraca(s)`;
    const err = new Error(msg);
    err.detalhes = falhas;
    throw err;
  }

  return resultados;
};

const criarImagemUsuario = async (id, dispositivoId = null) => {
  const catracaUserId = 110000000 + Number(id);

  const dispositivos = dispositivoId ? [dispositivos.find(d => d.id === dispositivoId)] : await dispositivosService.listarTodos();

  const resultados = [];

  for (const dispositivo of dispositivos) {
    const link = dispositivosService.linkCatraca(dispositivo);
    const session = await dispositivosService.obterSessao(link, dispositivo);

    if (!session) {
      resultados.push({ dispositivo: dispositivo.nome, sucesso: false, erro: 'Sessão inválida' });
      continue;
    }
    
    await controlId.criarImagemUser(catracaUserId, link, session, dispositivo, resultados);
  }

  // Se algum dispositivo falhou, lança erro
  const falhas = resultados.filter(r => !r.sucesso);
  if (falhas.length > 0) {
    const msg = `Erro ao criar usuário em ${falhas.length} catraca(s)`;
    const err = new Error(msg);
    err.detalhes = falhas;
    throw err;
  }

  return resultados; // tudo ok
};

const generateQrCode = async (id) => {
  const catracaUserId = 110000000 + Number(id);

  const dispositivos = await dispositivosService.listarTodos();
  const resultados = [];

  const value = gerarNumero8Digitos(); //8 dígitos, mesmo id do user
  const tipo = 'QRCODE';

  for (const dispositivo of dispositivos) {
    const link = dispositivosService.linkCatraca(dispositivo);
    const session = await dispositivosService.obterSessao(link, dispositivo);

    if (!session) {
      resultados.push({ dispositivo: dispositivo.nome, sucesso: false, erro: 'Sessão inválida' });
      continue;
    }

    // Criar cartão
    const sessionAdm = await controlId.obterSessaoAdmin(link, 'admin', 'admin');
    await controlId.deletarCartao(catracaUserId, link, sessionAdm, dispositivo, tipo);
    await controlId.criarCartao(catracaUserId, value, link, session, dispositivo, resultados);
    // await controlId.editarCartao(catracaUserId, value, link, sessionAdm, dispositivo, tipo)
  }

  // Se algum dispositivo falhou, lança erro
  const falhas = resultados.filter(r => !r.sucesso);
  if (falhas.length > 0) {
    const msg = `Erro ao criar usuário em ${falhas.length} catraca(s)`;
    const err = new Error(msg);
    err.detalhes = falhas;
    throw err;
  }

  return { resultados, qrcode: value };
};

const generateRFID = async (id, cartao_rfid) => {
  const catracaUserId = 110000000 + Number(id);

  const dispositivos = await dispositivosService.listarTodos();
  const resultados = [];

  const value = await gerarCardValue(cartao_rfid);
  const tipo = 'RFID';

  for (const dispositivo of dispositivos) {
    const link = dispositivosService.linkCatraca(dispositivo);
    const session = await dispositivosService.obterSessao(link, dispositivo);

    if (!session) {
      resultados.push({ dispositivo: dispositivo.nome, sucesso: false, erro: 'Sessão inválida' });
      continue;
    }

    // Criar cartão
    const sessionAdm = await controlId.obterSessaoAdmin(link, 'admin', 'admin');
    await controlId.deletarCartao(catracaUserId, link, sessionAdm, dispositivo, tipo);
    await controlId.criarCartao(catracaUserId, value, link, session, dispositivo, resultados);
    // await controlId.editarCartao(catracaUserId, value, link, sessionAdm, dispositivo, tipo)
  }

  // Se algum dispositivo falhou, lança erro
  const falhas = resultados.filter(r => !r.sucesso);
  if (falhas.length > 0) {
    const msg = `Erro ao criar usuário em ${falhas.length} catraca(s)`;
    const err = new Error(msg);
    err.detalhes = falhas;
    throw err;
  }

  return resultados; // tudo ok
};

module.exports = {
  criarNovaPessoaNasCatracas,
  editarPessoaNasCatracas,
  deletarPessoaDasCatracas,
  criarImagemUsuario,
  generateQrCode,
  generateRFID
}
