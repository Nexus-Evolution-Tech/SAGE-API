const {
  criarPessoaBase,
  criarAluno,
  criarProfessor,
  criarAdministrador,
  criarTerceirizado,
  criarProfAdm,
  buscarTodasPessoas,
  atualizarPessoaCompleta,
  removerPessoa
} = require('../config/people-db-utils');

async function criarPessoaCompleta(dados) {
  const { nome, email, telefone, foto, tipo, ...camposExtras } = dados;
  const pessoa = await criarPessoaBase({
    nome,
    email,
    telefone,
    foto,
    unidade_id: camposExtras.unidade_id || null,
    qr_code: camposExtras.qr_code || null,
    cartao_rfid: camposExtras.cartao_rfid || null,
    senha_acesso: camposExtras.senha_acesso || null,
    tipo
  });

  const idPessoa = pessoa.id;

  switch (tipo) {
    case 'ALUNO':
      await criarAluno(idPessoa, camposExtras);
      break;
    case 'PROFESSOR':
      await criarProfessor(idPessoa, camposExtras);
      break;
    case 'ADMINISTRADOR':
      await criarAdministrador(idPessoa, camposExtras);
      break;
    case 'TERCEIRIZADO':
      await criarTerceirizado(idPessoa, camposExtras);
      break;
    case 'PROFADM':
      await criarProfAdm(idPessoa, camposExtras);
      break;
    default:
      throw new Error('Tipo de pessoa inválido');
  }

  return { idPessoa, tipoCriado: tipo };
}

async function listarPessoas() {
  return await buscarTodasPessoas();
}

async function editarPessoa(id, updates) {
  await atualizarPessoaCompleta(id, updates);
}

async function deletarPessoa(id) {
  await removerPessoa(id);
}

module.exports = {
  criarPessoaCompleta,
  listarPessoas,
  editarPessoa,
  deletarPessoa
};
