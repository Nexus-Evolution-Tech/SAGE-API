const {
  buscarCursos,
  criarCurso,
  atualizarCurso,
  removerCurso
} = require('../config/course-db-utils');

async function listarCursos() {
  return await buscarCursos();
}

async function criarCursoCompleto(dados) {
  return await criarCurso(dados);
}

async function editarCurso(id, updates) {
  await atualizarCurso(id, updates);
}

async function deletarCurso(id) {
  await removerCurso(id);
}

module.exports = {
  listarCursos,
  criarCursoCompleto,
  editarCurso,
  deletarCurso
};
