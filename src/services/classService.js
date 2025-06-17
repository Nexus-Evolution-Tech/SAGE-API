const {
    buscarTurmas,
    criarTurma,
    atualizarTurma,
    removerTurma
} = require('../config/class-db-utils');

async function listarTurmas() {
    return await buscarTurmas();
}

async function criarTurmaCompleta(dados) {
    return await criarTurma(dados);
}

async function editarTurma(id, updates) {
    await atualizarTurma(id, updates);
}

async function deletarTurma(id) {
    await removerTurma(id)
}


module.exports = { listarTurmas, criarTurmaCompleta, editarTurma, deletarTurma }