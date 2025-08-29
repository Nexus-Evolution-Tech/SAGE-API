const dispositivosService = require('./deviceService');
const controlId = require('../utils/controlId-utils');
const { verificaSeFotoUserExiste, deletarFotoUserPorId } = require('../utils/photo-user-utils');
const gerarCardValue = require('../utils/gerarCardValue');
const gerarNumero8Digitos = require('../utils/gerarNumero8Digitos');

// OBS: TA CRIANDO, MAS QUANDO O CARTAO RFID É O MESMO ELE NÃO DA EXCEÇÃO, SIMPLESMENTE NÃO CRIA ATRIBUI O CARTÃO À PESSOA, DEVERIA TER PELO MENOS UM AVISO DE QUE NÃO PÔDE SER CRIADO
const criarNovaPessoaNasCatracas = async (novaPessoa) => {
  const catracaUserId = 110000000 + Number(novaPessoa.id);

  const dispositivos = await dispositivosService.listarTodos();
  const resultados = [];
  
  const qrcode = novaPessoa.qrcode !== null && novaPessoa.qrcode?.length === 8 ? Number(novaPessoa.qrcode) : gerarNumero8Digitos();
  
  for (const dispositivo of dispositivos) {
    const link = dispositivosService.linkCatraca(dispositivo);
    const session = await dispositivosService.obterSessao(link, dispositivo);

    if (!session) {
      resultados.push({ dispositivo: dispositivo.nome, sucesso: false, erro: 'Sessão inválida' });
      continue;
    }

    // 1. Criar usuário
    await controlId.criarUsuario(catracaUserId, novaPessoa, link, session, dispositivo, resultados);

    // 2. Criar cartão
    if (novaPessoa.cartao_rfid !== null && novaPessoa.cartao_rfid?.length === 8) {
      const value = await gerarCardValue(novaPessoa.cartao_rfid);
      await controlId.criarCartao(catracaUserId, value, link, session, dispositivo, resultados);
    }
    
    await controlId.criarCartao(catracaUserId, qrcode, link, session, dispositivo, resultados);
    
    // 3. Criar grupo
    await controlId.criarGrupo(catracaUserId, link, session, dispositivo, resultados);

    console.log(novaPessoa)
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

// ERRO: TA EDITANDO, MAS AINDA NÃO ESTÁ ATUALIZANDO O CARTÃO RFID
const editarPessoaNasCatracas = async (id, nome, cartao_rfid) => {
  const catracaUserId = 110000000 + Number(id);

  const dispositivos = await dispositivosService.listarTodos();
  const resultados = [];

  for (const dispositivo of dispositivos) {
    const link = dispositivosService.linkCatraca(dispositivo);
    const session = await dispositivosService.obterSessao(link, dispositivo);

    if (!session) {
      resultados.push({ dispositivo: dispositivo.nome, sucesso: false, erro: 'Sessão inválida' });
      continue;
    }

    await controlId.editarUsuario(catracaUserId, nome, link, session, dispositivo, resultados);

    if (cartao_rfid !== null){
      // await controlId.generateRFID(id, cartao_rfid);
      const sessionAdm = await controlId.obterSessaoAdmin(link, 'admin', 'admin');
      const value = await gerarCardValue(cartao_rfid);

      await controlId.deletarCartao(catracaUserId, link, sessionAdm, dispositivo, 'RFID');
      await controlId.criarCartao(catracaUserId, value, link, session, dispositivo, resultados);

      // await controlId.editarCartao(catracaUserId, cartao_rfid, link, session, dispositivo, resultados) -> A API NÃO DEIXA EDITAR O VALUE DO CARTÃO
    } else {
      await controlId.deletarCartao(catracaUserId, link, session, dispositivo, resultados);
    }
  }

  // Se algum dispositivo falhou, lança erro
  const falhas = resultados.filter(r => !r.sucesso);
  if (falhas.length > 0) {
    const msg = `Erro ao editar nome do usuário em ${falhas.length} catraca(s)`;
    const err = new Error(msg);
    err.detalhes = falhas;
    throw err; // lança o erro, o controller pode tratar
  }

  return resultados; // tudo ok
};

// OBS: TA DELETANDO, MAS MESMO QUANDO O ID NÃO EXISTE DA TRUE NAS DUAS CATRACAS
const deletarPessoaDasCatracas = async (id) => {
  const catracaUserId = 110000000 + Number(id);
  const dispositivos = await dispositivosService.listarTodos();
  const resultados = [];

  for (const dispositivo of dispositivos) {
    const link = dispositivosService.linkCatraca(dispositivo);
    const session = await dispositivosService.obterSessao(link, dispositivo);

    if (!session) {
      resultados.push({ dispositivo: dispositivo.nome, sucesso: false, erro: 'Sessão inválida' });
      continue;
    }

    // 1. Deletar usuário
    await controlId.deletarUsuario(catracaUserId, link, session, dispositivo, resultados);

    // 2. Deletar Cartao e 3. Deletar Grupo são automáticos

    // 4. Deletar imagem ***
    // se, e somente se, tiver um arquivo de imagem png na masta uploads/pessoas/pessoa_<id> do user
    if (await verificaSeFotoUserExiste(id))
      // await controlId.deletarImagemUser(catracaUserId, link, session, dispositivo, resultados); // automático na API da ControlId
      await deletarFotoUserPorId(Number(id));
    
  }

  // Se algum dispositivo falhou ao deletar o user, lança erro
  const falhas = resultados.filter(r => !r.sucesso);
  if (falhas.length > 0) {
    const msg = `Erro ao deletar usuário em ${falhas.length} catraca(s)`;
    const err = new Error(msg);
    err.detalhes = falhas;
    throw err;
  }

  return resultados;
};

const criarImagemUsuario = async (id) => {
  const catracaUserId = 110000000 + Number(id);

  const dispositivos = await dispositivosService.listarTodos();
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
