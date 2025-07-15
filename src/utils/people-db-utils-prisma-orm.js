const prisma = require('./prismaClient');

async function criarPessoaBase(data) {
  return await prisma.pessoas.create({ data });
}

async function criarAluno(id, data) {
  return await prisma.alunos.create({
    data: { id, ...data }
  });
}

async function criarProfessor(id, data) {
  return await prisma.professores.create({
    data: { id, ...data }
  });
}

async function criarAdministrador(id, data) {
  return await prisma.administradores.create({
    data: { id, ...data }
  });
}

async function criarTerceirizado(id, data) {
  return await prisma.terceirizados.create({
    data: { id, ...data }
  });
}

module.exports = {
  criarPessoaBase,
  criarAluno,
  criarProfessor,
  criarAdministrador,
  criarTerceirizado
};
