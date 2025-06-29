const {
  criarPessoaBase,
  criarAluno,
  criarProfessor,
  criarAdministrador,
  criarTerceirizado,
  criarProfAdm
} = require('../utils/people-db-utils');
const { hashSenha } = require('../utils/criptografia');

async function criarPessoaCompleta(dados) {
  const { nome, foto, rg, cpf, telefone, email, data_nascimento, genero, tipo, ...camposExtras } = dados;
  const pessoa = await criarPessoaBase({
    nome,
    foto,
    rg,
    cpf,
    telefone,
    email,
    unidade_id: camposExtras.unidade_id || null,
    qr_code: camposExtras.qr_code || null,
    cartao_rfid: camposExtras.cartao_rfid || null,
    senha_acesso: camposExtras.senha_acesso ? await hashSenha(camposExtras.senha_acesso) : null,
    data_nascimento,
    genero,
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

async function verificarPessoaPresente(id){
  // agora preciso ir até a tabela de acesso e verificar se existe algum registro com o idPessoa e data_hora >= dataHoje
  // Definir o início e o fim do dia atual
  const inicioDia = new Date();
  inicioDia.setHours(0, 0, 0, 0);
  const fimDia = new Date();
  fimDia.setHours(23, 59, 59, 999);

  const acesso = await global.db('Acesso')
    .where('pessoa_id', id)
    .andWhere('status', 'ENTRADA')
    .andWhere('data_hora', '>=', inicioDia)
    .andWhere('data_hora', '<=', fimDia)
    .first();

  const pessoa = await global.db('Pessoa')
    .where('id', id)
    .select('nome')
    .first();

  return {
    id: id,
    nome: pessoa ? pessoa.nome : null,
    status: acesso ? "PRESENTE" : "AUSENTE",
  };
}

async function verificarTodasPessoasPresentes() {
  const inicioDia = new Date();
  inicioDia.setHours(0, 0, 0, 0);
  const fimDia = new Date();
  fimDia.setHours(23, 59, 59, 999);

  // Busca todas as pessoas
  const pessoas = await global.db('Pessoa').select('id', 'nome');

  // Busca todos os acessos de entrada do dia
  const acessos = await global.db('Acesso')
    .where('status', 'ENTRADA')
    .andWhere('data_hora', '>=', inicioDia)
    .andWhere('data_hora', '<=', fimDia)
    .select('pessoa_id');

  // Cria um Set com os IDs das pessoas presentes
  const idsPresentes = new Set(acessos.map(a => a.pessoa_id));

  // Monta o resultado para cada pessoa
  return pessoas.map(pessoa => ({
    id: pessoa.id,
    nome: pessoa.nome,
    status: idsPresentes.has(pessoa.id) ? "PRESENTE" : "AUSENTE",
  }));
}

module.exports = {
  criarPessoaCompleta,
  verificarPessoaPresente,
  verificarTodasPessoasPresentes
};
