const {
    buscarEscolas,
    criarEscola,
    atualizarEscola,
    removerEscola
} = require('../config/school-db-utils');

async function listarEscolas() {
    return await buscarEscolas();
}

async function criarEscolaCompleta(dados) {
    return await criarEscola(dados);
}

async function editarEscola(id, updates) {
    await atualizarEscola(id, updates);
}

async function deletarEscola(id) {
    await removerEscola(id)
}


module.exports = { listarEscolas, criarEscolaCompleta, editarEscola, deletarEscola }